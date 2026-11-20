/**
 * K24 Virtual Printer, main process. Owns the listener on the network, the drawer state, the saved settings, the list
 * of receipts and PDF making. The screen only asks for things over IPC, and never receives a free-form file path to
 * open: receipts are opened by id.
 */
import { BrowserWindow, Menu, app, clipboard, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrinterServer } from '../core/printer-server.mjs';
import { PAPER, defaultSettings, mergeSettings, receiptFileBase } from '../core/settings.mjs';
import { buildTestReceipt } from '../core/test-receipt.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = join(here, '..', 'ui');
const iconPath = join(here, '..', '..', 'assets', 'icon.png');
const MAX_JOBS = 100;
const MAX_DRAWER_LOG = 30;
const RECEIVING_RESET_MS = 4000;

app.setAppUserModelId('com.zayaanit.karbar24.virtualprinter');
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let pdfWin = null;
let settings;
let settingsFile;
let jobsDir;
/** Newest first. */
let jobs = [];
const printer = { status: 'off', message: '', listeningPort: null };
const drawer = { open: false, since: null, log: [] };
let drawerTimer = null;
let receivingTimer = null;
let listenerQueue = Promise.resolve();
let pdfQueue = Promise.resolve();

const server = new PrinterServer({
  getPaperDots: () => PAPER[settings.paper].printableDots,
  isDrawerOpen: () => drawer.open,
});

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function loadSettings() {
  const defaults = defaultSettings(join(app.getPath('documents'), 'K24 Virtual Printer'));
  try {
    return mergeSettings(defaults, JSON.parse(readFileSync(settingsFile, 'utf8')));
  } catch {
    return defaults;
  }
}

function saveSettings() {
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

function loadJobs() {
  mkdirSync(jobsDir, { recursive: true });
  const loaded = [];
  for (const name of readdirSync(jobsDir)) {
    try {
      const job = JSON.parse(readFileSync(join(jobsDir, name), 'utf8'));
      // A save cut off by closing the app is reported, not left spinning forever.
      if (job.status === 'saving') job.status = 'failed';
      loaded.push(job);
    } catch {
      rmSync(join(jobsDir, name), { force: true });
    }
  }
  return loaded.sort((a, b) => b.number - a.number).slice(0, MAX_JOBS);
}

function persistJob(job) {
  writeFileSync(join(jobsDir, `${job.id}.json`), JSON.stringify(job));
}

function summary(job) {
  const { blocks: _blocks, ...rest } = job;
  return rest;
}

function networkAddresses() {
  const found = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }
  }
  return found.sort((a, b) => Number(b.startsWith('192.168.')) - Number(a.startsWith('192.168.')));
}

function publicState() {
  const addresses = networkAddresses();
  const host = settings.scope === 'network' && addresses.length ? addresses[0] : '127.0.0.1';
  return {
    settings,
    printer: { ...printer, address: `${host}:${settings.port}`, networkAddresses: addresses },
    drawer,
    jobs: jobs.map(summary),
    version: app.getVersion(),
  };
}

function pushState() {
  send('vp:state', publicState());
}

function setPrinter(status, message = '') {
  printer.status = status;
  printer.message = message;
  clearTimeout(receivingTimer);
  if (status === 'receiving') receivingTimer = setTimeout(() => setPrinter('on'), RECEIVING_RESET_MS);
  pushState();
}

/** Stops and restarts the listener to match the settings. Calls run one after another. */
function applyListener() {
  listenerQueue = listenerQueue.then(async () => {
    await server.stop();
    printer.listeningPort = null;
    if (!settings.power) {
      setPrinter('off');
      return;
    }
    try {
      await server.start({ host: settings.scope === 'network' ? '0.0.0.0' : '127.0.0.1', port: settings.port });
      printer.listeningPort = settings.port;
      setPrinter('on');
    } catch (error) {
      const message =
        error.code === 'EADDRINUSE'
          ? `Another app is already using port ${settings.port}. Close that app or choose another port in Settings.`
          : error.code === 'EACCES'
            ? `Windows did not allow this app to use port ${settings.port}. Choose another port in Settings.`
            : `The printer could not start: ${error.message}`;
      setPrinter('error', message);
    }
  });
  return listenerQueue;
}

function setDrawer(open, by) {
  if (drawer.open === open) return;
  const now = Date.now();
  const openFor = !open && drawer.since ? now - drawer.since : null;
  drawer.open = open;
  drawer.since = open ? now : null;
  drawer.log.unshift({ at: now, action: open ? 'open' : 'close', by, openFor });
  drawer.log.length = Math.min(drawer.log.length, MAX_DRAWER_LOG);
  clearTimeout(drawerTimer);
  if (open && settings.autoCloseSeconds > 0) {
    drawerTimer = setTimeout(() => setDrawer(false, 'timer'), settings.autoCloseSeconds * 1000);
  }
  send('vp:drawer', { open, by });
  pushState();
}

function warningsFor(doc, paper) {
  const warnings = [];
  if (doc.widestDots > PAPER[paper].printableDots) {
    warnings.push(`This receipt was made for wider paper than ${paper} mm. Set the same paper width here and in your POS.`);
  }
  const skipped = [...new Set(doc.skipped)];
  if (skipped.length) warnings.push(`Shown as text because this app does not draw it: ${skipped.join(', ')}.`);
  if (doc.unknownCommands) warnings.push(`${doc.unknownCommands} printer command(s) were not recognised and were ignored.`);
  return warnings;
}

async function ensurePdfWindow() {
  if (pdfWin && !pdfWin.isDestroyed()) return pdfWin;
  pdfWin = new BrowserWindow({
    show: false,
    width: 700,
    height: 900,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  await pdfWin.loadFile(join(uiDir, 'pdf.html'));
  return pdfWin;
}

/** Draws the receipt with the same code as the screen, one continuous page as wide as the paper. */
async function makePdf(job) {
  const page = await ensurePdfWindow();
  const heightPx = await page.webContents.executeJavaScript(`window.layoutReceipt(${JSON.stringify(job)})`);
  return page.webContents.printToPDF({
    printBackground: true,
    pageSize: { width: PAPER[job.paper].mm / 25.4, height: Math.ceil(heightPx + 4) / 96 },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });
}

/** Saves one receipt to the folder. One at a time, because they share the hidden drawing window. */
function savePdf(job, raw = null) {
  pdfQueue = pdfQueue.then(async () => {
    job.status = 'saving';
    job.error = null;
    send('vp:job-updated', summary(job));
    try {
      const pdf = await makePdf(job);
      mkdirSync(settings.folder, { recursive: true });
      const target = join(settings.folder, `${job.fileBase}.pdf`);
      await writeFile(target, pdf);
      if (raw && settings.saveRaw) await writeFile(join(settings.folder, `${job.fileBase}.bin`), raw);
      job.status = 'saved';
      job.pdfPath = target;
      job.fileName = basename(target);
    } catch (error) {
      job.status = 'failed';
      job.error = `The PDF could not be saved to ${settings.folder}. ${error.message}`;
    }
    persistJob(job);
    send('vp:job-updated', summary(job));
  });
  return pdfQueue;
}

function addDocuments({ docs, raw, remote }) {
  docs.forEach((doc, index) => {
    const now = new Date();
    const number = settings.nextNumber;
    settings = mergeSettings(settings, { nextNumber: number + 1 });
    const job = {
      id: randomUUID(),
      number,
      receivedAt: now.getTime(),
      paper: settings.paper,
      remote,
      blocks: doc.blocks,
      drawerKick: doc.drawerKick,
      warnings: warningsFor(doc, settings.paper),
      fileBase: receiptFileBase(now, number),
      fileName: `${receiptFileBase(now, number)}.pdf`,
      pdfPath: null,
      status: 'saving',
      error: null,
    };
    jobs.unshift(job);
    persistJob(job);
    send('vp:job-added', summary(job));
    savePdf(job, index === 0 ? raw : null);
  });
  saveSettings();
  for (const old of jobs.splice(MAX_JOBS)) rmSync(join(jobsDir, `${old.id}.json`), { force: true });
  setPrinter('on');
}

server.on('receiving', () => setPrinter('receiving'));
server.on('idle', () => setPrinter('on'));
server.on('documents', addDocuments);
server.on('drawer', () => setDrawer(true, 'pos'));
server.on('rejected', ({ reason }) => {
  send('vp:notice', { kind: 'error', text: reason });
  setPrinter('on');
});

function sendTestReceipt() {
  if (printer.listeningPort === null) {
    return Promise.resolve({ ok: false, error: 'Turn the printer on first.' });
  }
  return new Promise((resolve) => {
    const socket = net.connect(printer.listeningPort, '127.0.0.1', () => {
      socket.end(buildTestReceipt({ paper: settings.paper, when: new Date() }), () => resolve({ ok: true }));
    });
    socket.setTimeout(5000, () => {
      socket.destroy();
      resolve({ ok: false, error: 'The printer did not answer in time.' });
    });
    socket.once('error', (error) => resolve({ ok: false, error: `The test could not reach the printer. ${error.message}` }));
  });
}

async function updateSettings(patch) {
  const before = settings;
  settings = mergeSettings(settings, patch);
  saveSettings();
  if (before.port !== settings.port || before.scope !== settings.scope || before.power !== settings.power) {
    await applyListener();
  }
  if (before.autoCloseSeconds !== settings.autoCloseSeconds) clearTimeout(drawerTimer);
  if (drawer.open && before.autoCloseSeconds !== settings.autoCloseSeconds && settings.autoCloseSeconds > 0) {
    drawerTimer = setTimeout(() => setDrawer(false, 'timer'), settings.autoCloseSeconds * 1000);
  }
  pushState();
  return publicState();
}

async function openFolder() {
  mkdirSync(settings.folder, { recursive: true });
  const error = await shell.openPath(settings.folder);
  return error ? { ok: false, error } : { ok: true };
}

function findSaved(id) {
  const job = jobs.find((j) => j.id === id);
  if (!job?.pdfPath) return { error: 'This receipt has no saved PDF yet.' };
  if (!existsSync(job.pdfPath)) return { error: 'The PDF is no longer in the folder. It may have been moved or deleted.' };
  return { job };
}

async function clearJobs() {
  const answer = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Clear the list', 'Keep the list'],
    defaultId: 1,
    cancelId: 1,
    title: 'Clear the receipt list?',
    message: 'Clear the receipt list?',
    detail: 'The list in this app is emptied. Your PDF files stay in the folder.',
  });
  if (answer.response !== 0) return false;
  for (const job of jobs) rmSync(join(jobsDir, `${job.id}.json`), { force: true });
  jobs = [];
  pushState();
  return true;
}

function registerIpc() {
  ipcMain.handle('vp:get-state', () => publicState());
  ipcMain.handle('vp:get-job', (_e, id) => jobs.find((j) => j.id === id) ?? null);
  ipcMain.handle('vp:update-settings', (_e, patch) => updateSettings(patch ?? {}));
  ipcMain.handle('vp:send-test', () => sendTestReceipt());
  ipcMain.handle('vp:set-drawer', (_e, open) => setDrawer(open === true, 'you'));
  ipcMain.handle('vp:open-folder', () => openFolder());
  ipcMain.handle('vp:clear-jobs', () => clearJobs());
  ipcMain.handle('vp:copy', (_e, text) => clipboard.writeText(String(text)));
  ipcMain.handle('vp:open-pdf', async (_e, id) => {
    const { job, error } = findSaved(id);
    if (error) return { ok: false, error };
    const failure = await shell.openPath(job.pdfPath);
    return failure ? { ok: false, error: failure } : { ok: true };
  });
  ipcMain.handle('vp:show-pdf', (_e, id) => {
    const { job, error } = findSaved(id);
    if (error) return { ok: false, error };
    shell.showItemInFolder(job.pdfPath);
    return { ok: true };
  });
  ipcMain.handle('vp:retry-pdf', async (_e, id) => {
    const job = jobs.find((j) => j.id === id);
    if (job) await savePdf(job);
  });
  ipcMain.handle('vp:pick-folder', async () => {
    const picked = await dialog.showOpenDialog(win, {
      title: 'Choose where to save receipts',
      defaultPath: settings.folder,
      properties: ['openDirectory', 'createDirectory'],
    });
    return picked.canceled ? publicState() : updateSettings({ folder: picked.filePaths[0] });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 400,
    minHeight: 560,
    title: 'K24 Virtual Printer',
    icon: iconPath,
    backgroundColor: '#e3e5ef',
    show: false,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.loadFile(join(uiDir, 'index.html'));
  win.on('closed', () => {
    win = null;
    if (pdfWin && !pdfWin.isDestroyed()) pdfWin.destroy();
    app.quit();
  });
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  settingsFile = join(app.getPath('userData'), 'settings.json');
  jobsDir = join(app.getPath('userData'), 'jobs');
  settings = loadSettings();
  jobs = loadJobs();
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  applyListener();
});

app.on('before-quit', () => {
  server.stop();
});
