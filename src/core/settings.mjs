/** The app's settings: defaults and the check every change from the screen goes through. */
export const PAPER = {
  58: { printableDots: 384, totalDots: 464, mm: 58 },
  80: { printableDots: 576, totalDots: 640, mm: 80 },
};

export const AUTO_CLOSE_CHOICES = [0, 5, 10, 30];

export function defaultSettings(folder) {
  return {
    folder,
    paper: 80,
    scope: 'local',
    port: 9100,
    autoCloseSeconds: 0,
    sound: true,
    saveRaw: false,
    power: true,
    nextNumber: 1,
  };
}

/** Merges `patch` into `current`, keeping the old value for anything invalid. */
export function mergeSettings(current, patch) {
  const next = { ...current };
  if (typeof patch.folder === 'string' && patch.folder.trim()) next.folder = patch.folder;
  if (Number(patch.paper) === 58 || Number(patch.paper) === 80) next.paper = Number(patch.paper);
  if (patch.scope === 'local' || patch.scope === 'network') next.scope = patch.scope;
  const port = Number(patch.port);
  if (patch.port !== undefined && Number.isInteger(port) && port >= 1 && port <= 65535) next.port = port;
  if (patch.autoCloseSeconds !== undefined && AUTO_CLOSE_CHOICES.includes(Number(patch.autoCloseSeconds))) {
    next.autoCloseSeconds = Number(patch.autoCloseSeconds);
  }
  for (const flag of ['sound', 'saveRaw', 'power']) {
    if (typeof patch[flag] === 'boolean') next[flag] = patch[flag];
  }
  if (Number.isInteger(patch.nextNumber) && patch.nextNumber >= 1) next.nextNumber = patch.nextNumber;
  return next;
}

/** `2026-11-10_14-32-05_receipt-0007`, local time, safe for a Windows file name. */
export function receiptFileBase(date, number) {
  const two = (n) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  const time = `${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}`;
  return `${day}_${time}_receipt-${String(number).padStart(4, '0')}`;
}
