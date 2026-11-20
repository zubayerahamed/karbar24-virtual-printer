/**
 * `npm run icon`: turns the logo (assets/logo.png) into the app icons. Writes assets/icon.png (window and taskbar),
 * assets/icon.ico (exe, installer, Start menu and Desktop shortcuts) and src/ui/logo.png (the mark in the app header).
 * Runs inside Electron because it uses Chromium to centre the logo on a square see-through canvas. Run it again after
 * the logo changes, then `npm run package` so the installed exe gets the new icon.
 */
import { BrowserWindow, app, nativeImage } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'assets');
const CANVAS = 512;
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const HEADER_SIZE = 128;

/** Packs PNG pictures into one .ico file (PNG-in-ICO, which Windows Vista and later read). */
function toIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((png) => png.data)]);
}

/** Scales the square master picture down in halving steps, which keeps small sizes sharper than one big jump. */
function scaled(master, size) {
  let image = master;
  let current = master.getSize().width;
  while (current / 2 >= size) {
    current = Math.round(current / 2);
    image = image.resize({ width: current, height: current, quality: 'best' });
  }
  return current === size ? image : image.resize({ width: size, height: size, quality: 'best' });
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const logo = `data:image/png;base64,${readFileSync(join(assets, 'logo.png')).toString('base64')}`;
  const win = new BrowserWindow({
    width: CANVAS,
    height: CANVAS,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  win.webContents.setZoomFactor(1);
  const html = `<!doctype html><body style="margin:0;background:transparent">
    <img src="${logo}" style="display:block;width:${CANVAS}px;height:${CANVAS}px;object-fit:contain"></body>`;
  const painted = new Promise((resolve) => win.webContents.once('paint', () => setTimeout(resolve, 300)));
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await painted;
  const shot = await win.webContents.capturePage();
  const master = nativeImage.createFromBuffer(shot.toPNG()).resize({ width: CANVAS, height: CANVAS, quality: 'best' });

  writeFileSync(join(assets, 'icon.png'), scaled(master, 256).toPNG());
  writeFileSync(join(assets, 'icon.ico'), toIco(ICO_SIZES.map((size) => ({ size, data: scaled(master, size).toPNG() }))));
  writeFileSync(join(root, 'src', 'ui', 'logo.png'), scaled(master, HEADER_SIZE).toPNG());
  console.log('assets/icon.png, assets/icon.ico and src/ui/logo.png written from assets/logo.png');
  app.quit();
});
