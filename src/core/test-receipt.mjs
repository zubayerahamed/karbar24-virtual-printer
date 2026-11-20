/** The bytes behind "Send test receipt": real printer commands, so the test travels the same path as a POS job. */
const ESC = 0x1b;
const GS = 0x1d;

/** A ticked circle as a 1-bit picture, so the test also proves pictures come through. */
function badge(size) {
  const widthBytes = Math.ceil(size / 8);
  const bytes = Buffer.alloc(widthBytes * size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot(x - c, y - c);
      const u = (x - c) / c;
      const v = (y - c) / c;
      const onShort = u >= -0.5 && u <= -0.1 && Math.abs(v - (u + 0.5) - 0.02) < 0.12;
      const onLong = u >= -0.1 && u <= 0.52 && Math.abs(v - (0.42 - (u + 0.1) * 1.25)) < 0.12;
      if ((radius <= c && radius >= c * 0.84) || onShort || onLong) {
        bytes[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return Buffer.concat([
    Buffer.from([GS, 0x76, 0x30, 0, widthBytes & 0xff, widthBytes >> 8, size & 0xff, size >> 8]),
    bytes,
  ]);
}

/**
 * @param {{paper: 58|80, when: Date, drawerKick?: boolean}} options
 * @returns {Buffer}
 */
export function buildTestReceipt({ paper, when, drawerKick = true }) {
  const width = paper === 58 ? 32 : 48;
  const parts = [];
  const raw = (...bytes) => parts.push(Buffer.from(bytes));
  const text = (value) => parts.push(Buffer.from(`${value}\n`, 'latin1'));
  const row = (left, right) => text(left + ' '.repeat(Math.max(1, width - left.length - right.length)) + right);
  const center = () => raw(ESC, 0x61, 1);
  const left = () => raw(ESC, 0x61, 0);
  const bold = (on) => raw(ESC, 0x45, on ? 1 : 0);
  const size = (w, h) => raw(GS, 0x21, ((w - 1) << 4) | (h - 1));
  const divider = () => text('-'.repeat(width));

  raw(ESC, 0x40);
  center();
  parts.push(badge(96));
  raw(ESC, 0x64, 1);
  bold(true);
  size(2, 2);
  text('Test receipt');
  size(1, 1);
  bold(false);
  text('K24 Virtual Printer');
  text('Not a real sale');
  left();
  divider();
  row('Date', when.toLocaleDateString('en-GB'));
  row('Time', when.toLocaleTimeString('en-GB'));
  row('Paper', `${paper} mm`);
  divider();
  row('2 x Tea', 'Tk 60.00');
  row('1 x Chicken sandwich', 'Tk 180.00');
  row('3 x Water bottle', 'Tk 75.00');
  divider();
  row('Subtotal', 'Tk 315.00');
  row('VAT 5%', 'Tk 15.75');
  bold(true);
  size(1, 2);
  row('Total', 'Tk 330.75');
  size(1, 1);
  bold(false);
  row('Cash', 'Tk 500.00');
  row('Change', 'Tk 169.25');
  divider();
  center();
  text('If you can read this, printing works.');
  raw(ESC, 0x64, 3);
  raw(GS, 0x56, 0);
  if (drawerKick) raw(ESC, 0x70, 0, 25, 250);
  return Buffer.concat(parts);
}
