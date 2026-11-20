import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EscPosDecoder } from '../src/core/escpos-decoder.mjs';

const ESC = 0x1b;
const GS = 0x1d;
const b = (...parts) =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
const textOf = (block) => block.runs.map((r) => r.text).join('');

function decode(bytes, options) {
  const decoder = new EscPosDecoder(options);
  decoder.feed(bytes);
  return decoder.takeDocuments();
}

test('reads text, alignment, bold and double size', () => {
  const [doc] = decode(
    b([ESC, 0x40, ESC, 0x61, 1, ESC, 0x45, 1, GS, 0x21, 0x11], 'Shop\n', [GS, 0x21, 0, ESC, 0x45, 0], 'x\n'),
  );
  const [title, next] = doc.blocks;
  assert.equal(textOf(title), 'Shop');
  assert.equal(title.align, 'center');
  assert.deepEqual([title.runs[0].bold, title.runs[0].w, title.runs[0].h], [true, 2, 2]);
  assert.equal(next.runs[0].bold, false);
  assert.equal(next.runs[0].w, 1);
});

test('a cut splits copies into separate documents and ignores a cut with nothing before it', () => {
  const docs = decode(b([GS, 0x56, 0], 'one\n', [GS, 0x56, 0], 'two\n', [GS, 0x56, 1]));
  assert.equal(docs.length, 2);
  assert.equal(textOf(docs[1].blocks[0]), 'two');
  assert.equal(docs[1].cut, true);
});

test('the POS order of print, cut, then drawer kick marks that receipt', () => {
  let pulses = 0;
  const docs = decode(b('Sale\n', [ESC, 0x64, 1, GS, 0x56, 0, ESC, 0x70, 0, 25, 250]), { onDrawer: () => pulses++ });
  assert.equal(pulses, 1);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].drawerKick, true);
});

test('a bare drawer kick (no sale) opens the drawer but makes no document', () => {
  let pulses = 0;
  assert.deepEqual(decode(b([ESC, 0x40, ESC, 0x70, 0, 25, 250]), { onDrawer: () => pulses++ }), []);
  assert.equal(pulses, 1);
});

test('reads a raster picture exactly as the POS sends Bangla lines', () => {
  const data = [0xff, 0x00, 0x0f, 0xf0];
  const [doc] = decode(b([GS, 0x76, 0x30, 0, 2, 0, 2, 0], data, [GS, 0x56, 0]));
  const [image] = doc.blocks;
  assert.deepEqual([image.t, image.widthDots, image.height], ['image', 16, 2]);
  assert.deepEqual([...Buffer.from(image.data, 'base64')], data);
});

test('a command split across network chunks is still read correctly', () => {
  const whole = b('A\n', [GS, 0x76, 0x30, 0, 1, 0, 3, 0, 1, 2, 3], 'B\n', [ESC, 0x70, 0, 25, 250]);
  let pulses = 0;
  const decoder = new EscPosDecoder({ onDrawer: () => pulses++ });
  for (const byte of whole) decoder.feed(Buffer.from([byte]));
  const [doc] = decoder.takeDocuments();
  assert.deepEqual(
    doc.blocks.map((x) => x.t),
    ['line', 'image', 'line'],
  );
  assert.equal(pulses, 1);
});

test('text wider than the paper wraps like a real printer', () => {
  const [doc] = decode(b('x'.repeat(50), '\n'), { paperDots: 384 });
  assert.deepEqual(
    doc.blocks.map((x) => textOf(x).length),
    [32, 18],
  );
});

test('double-width text wraps at half the columns', () => {
  const [doc] = decode(b([GS, 0x21, 0x10], 'y'.repeat(30), '\n'), { paperDots: 384 });
  assert.deepEqual(
    doc.blocks.map((x) => textOf(x).length),
    [16, 14],
  );
});

test('answers status questions with the drawer state', () => {
  const replies = [];
  const decoder = new EscPosDecoder({ onReply: (r) => replies.push(r[0]), isDrawerOpen: () => true });
  decoder.feed(Buffer.from([0x10, 0x04, 1, 0x10, 0x04, 4, GS, 0x72, 2]));
  assert.deepEqual(replies, [0x16, 0x12, 1]);
});

test('commands it does not act on are consumed, not printed as junk', () => {
  const [doc] = decode(b([ESC, 0x74, 16, GS, 0x4c, 0, 0, ESC, 0x7b, 0], 'ok\n'));
  assert.equal(doc.blocks.length, 1);
  assert.equal(textOf(doc.blocks[0]), 'ok');
  assert.equal(doc.unknownCommands, 0);
});

test('barcodes and QR codes become readable placeholders and are reported', () => {
  const qr = [GS, 0x28, 0x6b, 7, 0, 49, 80, 48, 65, 66, 67, 68, GS, 0x28, 0x6b, 3, 0, 49, 81, 48];
  const [doc] = decode(b([GS, 0x6b, 4], '123', [0], qr));
  assert.deepEqual(
    doc.blocks.map((x) => x.text),
    ['Barcode: 123', 'QR code: ABCD'],
  );
  assert.deepEqual(doc.skipped, ['barcode', 'QR code']);
});

test('reads column pictures and does not add a blank line after them', () => {
  const [doc] = decode(b([ESC, 0x2a, 33, 1, 0, 0x80, 0, 0], '\n', 'after\n'));
  assert.deepEqual(
    doc.blocks.map((x) => x.t),
    ['image', 'line'],
  );
  assert.equal(doc.blocks[0].height, 24);
  assert.equal(Buffer.from(doc.blocks[0].data, 'base64')[0], 0x80);
});
