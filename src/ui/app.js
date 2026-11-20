/** The screen: draws the state the app sends, and turns clicks into requests. All decisions stay in the main process. */
(function () {
  const $ = (id) => document.getElementById(id);
  const all = (selector) => [...document.querySelectorAll(selector)];

  let state = null;
  let view = 'printer';
  let selectedId = null;
  let drawnId = null;
  let toastTimer = null;
  let audio = null;

  function iconSvg(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'icon');
    svg.innerHTML = window.ICONS[name] ?? '';
    return svg;
  }

  function setIcon(element, name) {
    element.replaceChildren(iconSvg(name));
  }

  function bind(key, value) {
    for (const element of all(`[data-bind="${key}"]`)) element.textContent = value;
  }

  function toast(text, kind = 'info') {
    const element = $('toast');
    element.textContent = text;
    element.dataset.kind = kind;
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (element.hidden = true), kind === 'error' ? 7000 : 3200);
  }

  function report(result) {
    if (result && result.ok === false) toast(result.error, 'error');
  }

  const clock = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function receiptName(job) {
    return `Receipt ${String(job.number).padStart(4, '0')}`;
  }

  function dayLabel(at) {
    const date = new Date(at);
    const today = new Date();
    return date.toDateString() === today.toDateString()
      ? clock(at)
      : `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${clock(at)}`;
  }

  // ----- views ---------------------------------------------------------------------------------------------------

  function showView(next) {
    view = next;
    for (const tab of all('.tab')) {
      if (tab.dataset.view === next) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    for (const name of ['printer', 'guide', 'settings']) $(`view-${name}`).hidden = name !== next;
    document.querySelector('main').scrollTop = 0;
  }

  // ----- printer ---------------------------------------------------------------------------------------------------

  function printerWords() {
    const { status } = state.printer;
    if (status === 'on') return { chip: `Ready at ${state.printer.address}`, face: 'Ready' };
    if (status === 'receiving') return { chip: 'Receiving a print', face: 'Printing' };
    if (status === 'error') return { chip: 'Printer could not start', face: 'Problem' };
    return { chip: 'Printer off', face: 'Off' };
  }

  function drawPrinter() {
    const { printer, settings } = state;
    const words = printerWords();
    const on = printer.status === 'on' || printer.status === 'receiving';
    $('printer').dataset.state = printer.status;
    $('chip-printer').dataset.state = printer.status;
    $('chip-printer-text').textContent = words.chip;
    $('printer-status-text').textContent = words.face;
    $('printer-model').textContent = `Thermal ${settings.paper} mm`;
    $('power').setAttribute('aria-checked', String(settings.power));

    const notice = printer.status === 'error' ? printer.message : '';
    $('printer-notice').hidden = !notice;
    $('printer-notice-text').textContent = notice;

    for (const button of all('[data-send-test]')) {
      button.disabled = !on;
      button.title = on ? '' : 'Turn the printer on first';
    }

    bind('address', printer.address);
    bind('folder', settings.folder);
    bind('paper', String(settings.paper));
    bind('version', state.version);
    bind(
      'status-sentence',
      on ? 'Right now it is on.' : printer.status === 'error' ? 'Right now it has a problem, shown on the Printer tab.' : 'Right now it is off. Use the switch on its front.',
    );
  }

  // ----- drawer ----------------------------------------------------------------------------------------------------

  const DRAWER_BY = { pos: 'by the POS', you: 'by you', timer: 'by the timer' };

  function logLine(entry) {
    const verb = entry.action === 'open' ? 'Opened' : 'Closed';
    const after = entry.openFor ? ` after ${Math.max(1, Math.round(entry.openFor / 1000))}\u00a0s` : '';
    return `${verb} ${DRAWER_BY[entry.by]}${after}`;
  }

  function drawDrawer() {
    const { open, log } = state.drawer;
    const { autoCloseSeconds } = state.settings;
    $('till').dataset.open = String(open);
    $('till').setAttribute('aria-label', open ? 'Cash drawer, open. Press to close.' : 'Cash drawer, closed. Press to open.');
    $('chip-drawer').dataset.open = String(open);
    setIcon($('chip-drawer-icon'), open ? 'lock-open' : 'lock');
    $('chip-drawer-text').textContent = open ? 'Drawer open' : 'Drawer closed';
    setIcon($('till-landing-icon'), 'lock');
    $('till-landing-text').textContent = 'Drawer closed';

    const toggle = $('drawer-toggle');
    toggle.replaceChildren(iconSvg(open ? 'lock' : 'lock-open'), document.createTextNode(open ? 'Close drawer' : 'Open drawer'));
    toggle.classList.toggle('primary', open);
    if (open) {
      $('drawer-hint').textContent = autoCloseSeconds
        ? `It closes by itself after ${autoCloseSeconds} seconds.`
        : 'A POS can only open a drawer. Close it here, as you would push a real one shut.';
    } else {
      $('drawer-hint').textContent = 'It slides open when your POS sends the drawer signal.';
    }

    $('drawer-log').replaceChildren(
      ...log.slice(0, 3).map((entry) => {
        const row = document.createElement('li');
        const time = document.createElement('time');
        time.textContent = clock(entry.at);
        const text = document.createElement('span');
        text.textContent = logLine(entry);
        row.append(text, time);
        return row;
      }),
    );
  }

  /** A short till bell made on the fly, so the app ships no sound files. */
  function ringBell() {
    if (!state.settings.sound) return;
    audio ??= new AudioContext();
    const start = audio.currentTime;
    [
      [1568, 0],
      [2093, 0.09],
    ].forEach(([frequency, delay]) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + delay);
      gain.gain.exponentialRampToValueAtTime(0.16, start + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.5);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start + delay);
      oscillator.stop(start + delay + 0.55);
    });
  }

  // ----- receipts --------------------------------------------------------------------------------------------------

  const JOB_ICON = { saving: 'refresh-cw', saved: 'file-check-2', failed: 'triangle-alert' };

  function drawList() {
    const { jobs } = state;
    $('job-count').textContent = jobs.length ? String(jobs.length) : '';
    $('rail-empty').hidden = jobs.length > 0;
    $('clear-jobs').hidden = jobs.length === 0;
    $('job-list').replaceChildren(
      ...jobs.map((job) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.className = 'job';
        button.dataset.status = job.status;
        if (job.id === selectedId) button.setAttribute('aria-current', 'true');
        button.addEventListener('click', () => select(job.id));

        const icon = document.createElement('span');
        icon.className = 'job-icon';
        icon.append(iconSvg(JOB_ICON[job.status]));

        const text = document.createElement('span');
        text.className = 'job-text';
        const name = document.createElement('strong');
        name.textContent = receiptName(job);
        const when = document.createElement('span');
        when.textContent = dayLabel(job.receivedAt);
        text.append(name, when);

        button.append(icon, text);
        if (job.drawerKick) {
          const kicked = document.createElement('span');
          kicked.className = 'job-drawer';
          kicked.title = 'This receipt opened the drawer';
          kicked.append(iconSvg('banknote'));
          button.append(kicked);
        }
        item.append(button);
        return item;
      }),
    );
  }

  async function select(id, { animate = false } = {}) {
    selectedId = id;
    drawList();
    drawJobBar();
    if (id === drawnId) return;
    const job = await window.vp.getJob(id);
    if (!job || selectedId !== id) return;
    drawnId = id;
    $('starter').hidden = true;
    const receipt = $('receipt');
    receipt.hidden = false;
    window.renderReceipt(receipt, job);
    const paper = $('paper');
    paper.style.setProperty('--total-dots', receipt.style.getPropertyValue('--total-dots'));
    paper.classList.add('printed');
    $('well').scrollTop = 0;
    paper.classList.remove('feeding');
    if (animate) {
      void paper.offsetWidth;
      paper.classList.add('feeding');
    }
  }

  function showStarter() {
    selectedId = null;
    drawnId = null;
    $('receipt').hidden = true;
    $('receipt').replaceChildren();
    $('starter').hidden = false;
    $('paper').classList.remove('printed', 'feeding');
    $('paper').style.setProperty('--total-dots', '640');
    drawJobBar();
  }

  function selectedJob() {
    return state.jobs.find((job) => job.id === selectedId) ?? null;
  }

  function drawJobBar() {
    const job = selectedJob();
    $('job-bar').hidden = !job;
    const warnings = $('job-warnings');
    warnings.hidden = !job || !job.warnings.length;
    if (!job) return;

    const saved = job.status === 'saved';
    const failed = job.status === 'failed';
    const stateIcon = $('job-state-icon');
    stateIcon.className = `job-state ${job.status}`;
    setIcon(stateIcon, JOB_ICON[job.status]);
    $('job-title').textContent = saved ? 'Saved as PDF' : failed ? 'PDF not saved' : 'Saving the PDF';
    $('job-detail').textContent = failed ? job.error || 'The app closed before this PDF was finished.' : job.fileName;
    $('job-open').disabled = !saved;
    $('job-show').disabled = !saved;
    $('job-retry').hidden = !failed;

    warnings.replaceChildren(
      ...job.warnings.map((text) => {
        const row = document.createElement('li');
        const message = document.createElement('span');
        message.textContent = text;
        row.append(iconSvg('triangle-alert'), message);
        return row;
      }),
    );
  }

  // ----- settings --------------------------------------------------------------------------------------------------

  function setRadio(name, value) {
    for (const input of all(`input[name="${name}"]`)) input.checked = input.value === String(value);
  }

  function drawSettings() {
    const { settings, printer } = state;
    setRadio('paper', settings.paper);
    setRadio('scope', settings.scope);
    setRadio('autoClose', settings.autoCloseSeconds);
    if (document.activeElement !== $('port')) $('port').value = String(settings.port);
    $('sound').checked = settings.sound;
    $('saveRaw').checked = settings.saveRaw;
    if (settings.scope === 'local') {
      $('scope-help').textContent = 'Only a POS on this computer can print. Nothing on your network can reach it.';
    } else if (printer.networkAddresses.length) {
      $('scope-help').textContent = `Any device on your network can print. This computer's addresses: ${printer.networkAddresses
        .map((address) => `${address}:${settings.port}`)
        .join(', ')}`;
    } else {
      $('scope-help').textContent = 'This computer is not connected to a network right now.';
    }
  }

  function draw() {
    drawPrinter();
    drawDrawer();
    drawList();
    drawJobBar();
    drawSettings();
    if (selectedId && !selectedJob()) {
      if (state.jobs.length) select(state.jobs[0].id);
      else showStarter();
    }
  }

  async function change(patch) {
    state = await window.vp.updateSettings(patch);
    draw();
  }

  // ----- wiring ----------------------------------------------------------------------------------------------------

  function wire() {
    for (const element of all('[data-icon]')) element.prepend(iconSvg(element.dataset.icon));

    for (const tab of all('.tab')) tab.addEventListener('click', () => showView(tab.dataset.view));
    for (const link of all('[data-goto]')) link.addEventListener('click', () => showView(link.dataset.goto));

    for (const button of all('[data-copy-address]')) {
      button.addEventListener('click', async () => {
        await window.vp.copy(state.printer.address);
        toast(`Copied ${state.printer.address}`);
      });
    }
    for (const button of all('[data-send-test]')) {
      button.addEventListener('click', async () => report(await window.vp.sendTest()));
    }

    $('power').addEventListener('click', () => change({ power: !state.settings.power }));
    $('printer-notice-action').addEventListener('click', () => showView('settings'));
    $('open-folder').addEventListener('click', async () => report(await window.vp.openFolder()));
    $('clear-jobs').addEventListener('click', async () => {
      if (await window.vp.clearJobs()) showStarter();
    });

    const toggleDrawer = () => window.vp.setDrawer(!state.drawer.open);
    $('till').addEventListener('click', toggleDrawer);
    $('drawer-toggle').addEventListener('click', toggleDrawer);

    $('job-open').addEventListener('click', async () => report(await window.vp.openPdf(selectedId)));
    $('job-show').addEventListener('click', async () => report(await window.vp.showPdf(selectedId)));
    $('job-retry').addEventListener('click', () => window.vp.retryPdf(selectedId));

    $('pick-folder').addEventListener('click', async () => {
      state = await window.vp.pickFolder();
      draw();
    });
    for (const input of all('input[name="paper"]')) input.addEventListener('change', () => change({ paper: input.value }));
    for (const input of all('input[name="scope"]')) input.addEventListener('change', () => change({ scope: input.value }));
    for (const input of all('input[name="autoClose"]')) {
      input.addEventListener('change', () => change({ autoCloseSeconds: input.value }));
    }
    $('sound').addEventListener('change', () => change({ sound: $('sound').checked }));
    $('saveRaw').addEventListener('change', () => change({ saveRaw: $('saveRaw').checked }));
    $('port').addEventListener('change', () => {
      const port = Number($('port').value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        toast('Enter a port number from 1 to 65535.', 'error');
        $('port').value = String(state.settings.port);
        return;
      }
      change({ port });
    });

    window.vp.on('vp:state', (next) => {
      state = next;
      draw();
    });
    window.vp.on('vp:drawer', ({ open, by }) => {
      if (open) ringBell();
      if (view !== 'printer' && by === 'pos') toast('Your POS opened the drawer');
    });
    window.vp.on('vp:job-added', async (job) => {
      state.jobs = [job, ...state.jobs.filter((other) => other.id !== job.id)];
      await select(job.id, { animate: true });
    });
    window.vp.on('vp:job-updated', (job) => {
      state.jobs = state.jobs.map((other) => (other.id === job.id ? job : other));
      drawList();
      if (job.id === selectedId) drawJobBar();
      if (view !== 'printer' && job.status === 'saved') toast(`Saved ${job.fileName}`);
      if (view !== 'printer' && job.status === 'failed') toast('A PDF could not be saved. See the Printer tab.', 'error');
    });
    window.vp.on('vp:notice', ({ text, kind }) => toast(text, kind));
  }

  async function start() {
    wire();
    state = await window.vp.getState();
    draw();
    if (state.jobs.length) await select(state.jobs[0].id);
    else showStarter();
  }

  start();
})();
