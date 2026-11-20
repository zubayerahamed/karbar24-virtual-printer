/**
 * Reads the byte stream a POS sends to a thermal printer (Epson ESC/POS) and turns it into receipts the app can draw.
 *
 * Works on a stream: `feed()` takes bytes as they arrive and keeps an unfinished command for the next chunk, so status
 * questions and drawer signals are answered at once instead of at the end of the job. Paper cuts split the stream into
 * separate documents. No Electron or DOM in here, so it is covered by plain Node tests.
 *
 * All sizes are printer dots (8 dots per millimetre on a 203 dpi head).
 */
const ESC = 0x1b;
const GS = 0x1d;
const DLE = 0x10;
const FS = 0x1c;
const LF = 0x0a;
const CR = 0x0d;
const HT = 0x09;
const FF = 0x0c;

const DEFAULT_LINE_DOTS = 30;
const FONTS = { A: { width: 12, height: 24 }, B: { width: 9, height: 17 } };

/** Parameter byte counts for commands with a fixed length, keyed by the character after the prefix. */
const ESC_FIXED = {
  ' ': 1, '!': 1, $: 2, '%': 1, '-': 1, 2: 0, 3: 1, '<': 0, '=': 1, '?': 1, '@': 0, B: 2, E: 1, G: 1, J: 1, L: 0, M: 1,
  R: 1, S: 0, T: 1, U: 1, V: 1, '\\': 2, a: 1, c: 2, d: 1, e: 1, f: 2, p: 3, r: 1, t: 1, '{': 1,
};
const GS_FIXED = {
  '!': 1, '/': 1, ':': 0, B: 1, E: 1, H: 1, I: 1, L: 2, P: 2, T: 1, W: 2, '\\': 2, '^': 3, a: 1, b: 1, f: 1, h: 1, r: 1,
  w: 1,
};

/** A printer's status byte: fixed bits 1 and 4 set, nothing wrong. Bit 2 reflects the drawer switch. */
const STATUS_BASE = 0x12;
const DRAWER_BIT = 0x04;

function emptyDocument() {
  return { blocks: [], drawerKick: false, cut: false, unknownCommands: 0, skipped: [], widestDots: 0 };
}

function hasContent(doc) {
  return doc.blocks.some(
    (b) => b.t === 'image' || b.t === 'placeholder' || (b.t === 'line' && b.runs.some((r) => r.text.trim() !== '')),
  );
}

function trimTrailingBlank(doc) {
  while (doc.blocks.length) {
    const last = doc.blocks[doc.blocks.length - 1];
    if (last.t === 'space' || (last.t === 'line' && last.runs.every((r) => r.text.trim() === ''))) doc.blocks.pop();
    else break;
  }
}

function sameStyle(a, b) {
  return (
    a.font === b.font &&
    a.bold === b.bold &&
    a.underline === b.underline &&
    a.reverse === b.reverse &&
    a.w === b.w &&
    a.h === b.h
  );
}

export class EscPosDecoder {
  /**
   * @param {{paperDots?: number, onReply?: (bytes: Buffer) => void, onDrawer?: (pulse: {pin: number}) => void,
   *   isDrawerOpen?: () => boolean}} options paperDots is the printable width; the callbacks fire during `feed()`.
   */
  constructor({ paperDots = 576, onReply = () => {}, onDrawer = () => {}, isDrawerOpen = () => false } = {}) {
    this.paperDots = paperDots;
    this.onReply = onReply;
    this.onDrawer = onDrawer;
    this.isDrawerOpen = isDrawerOpen;
    this.buffer = Buffer.alloc(0);
    this.finished = [];
    this.current = emptyDocument();
    this.qrData = '';
    this.resetStyle();
    this.resetLine();
  }

  resetStyle() {
    this.style = { font: 'A', bold: false, underline: false, reverse: false, w: 1, h: 1 };
    this.align = 'left';
    this.lineDots = DEFAULT_LINE_DOTS;
  }

  resetLine() {
    this.runs = [];
    this.usedDots = 0;
    this.lineAlign = null;
    this.skipNextLf = false;
  }

  /** Adds received bytes. Anything that is not yet a whole command waits for the next call. */
  feed(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    let offset = 0;
    while (offset < this.buffer.length) {
      const used = this.step(offset);
      if (used === 0) break;
      offset += used;
    }
    this.buffer = this.buffer.subarray(offset);
  }

  /** Returns every finished document, including one still open (no cut yet), and starts fresh. */
  takeDocuments() {
    this.flushLineIfAny();
    if (hasContent(this.current)) this.closeDocument(false);
    else this.current = emptyDocument();
    const docs = this.finished;
    this.finished = [];
    return docs;
  }

  closeDocument(cut) {
    const doc = this.current;
    doc.cut = cut;
    trimTrailingBlank(doc);
    this.finished.push(doc);
    this.current = emptyDocument();
  }

  /** Decodes one item at `at`. Returns the bytes used, or 0 when the item is not complete yet. */
  step(at) {
    const byte = this.buffer[at];
    if (byte === ESC) return this.stepEsc(at);
    if (byte === GS) return this.stepGs(at);
    if (byte === DLE) return this.stepDle(at);
    if (byte === FS) return this.stepFs(at);
    if (byte === LF) {
      if (this.skipNextLf) this.skipNextLf = false;
      else this.flushLine();
      return 1;
    }
    this.skipNextLf = false;
    if (byte === FF) {
      this.flushLine();
      return 1;
    }
    if (byte === HT) {
      const column = Math.floor(this.usedDots / FONTS[this.style.font].width);
      this.addText(' '.repeat(8 - (column % 8)));
      return 1;
    }
    if (byte < 0x20) return 1;
    let end = at;
    while (end < this.buffer.length && this.buffer[end] >= 0x20) end++;
    this.addText(this.buffer.toString('latin1', at, end));
    return end - at;
  }

  stepEsc(at) {
    if (at + 1 >= this.buffer.length) return 0;
    const name = String.fromCharCode(this.buffer[at + 1]);
    if (name === '*') return this.stepColumnImage(at);
    if (name === 'D') return this.stepUntilNul(at + 2, at);
    if (name === '(') return this.stepExtended(at);
    const params = ESC_FIXED[name];
    if (params === undefined) {
      this.current.unknownCommands++;
      return 2;
    }
    if (at + 2 + params > this.buffer.length) return 0;
    this.applyEsc(name, at + 2);
    return 2 + params;
  }

  applyEsc(name, p) {
    const b = this.buffer;
    switch (name) {
      case '@':
        this.flushLineIfAny();
        this.resetStyle();
        break;
      case '!': {
        const n = b[p];
        this.style = {
          ...this.style,
          font: n & 1 ? 'B' : 'A',
          bold: !!(n & 0x08),
          h: n & 0x10 ? 2 : 1,
          w: n & 0x20 ? 2 : 1,
          underline: !!(n & 0x80),
        };
        break;
      }
      case '-':
        this.style = { ...this.style, underline: [1, 2, 49, 50].includes(b[p]) };
        break;
      case 'E':
      case 'G':
        this.style = { ...this.style, bold: !!(b[p] & 1) };
        break;
      case 'M':
        this.style = { ...this.style, font: b[p] === 1 || b[p] === 49 ? 'B' : 'A' };
        break;
      case 'a':
        this.align = ['left', 'center', 'right'][b[p] >= 48 ? b[p] - 48 : b[p]] ?? 'left';
        break;
      case '2':
        this.lineDots = DEFAULT_LINE_DOTS;
        break;
      case '3':
        this.lineDots = b[p];
        break;
      case 'd':
        this.flushLineIfAny();
        this.addSpace(b[p] * this.lineDots);
        break;
      case 'J':
        this.flushLineIfAny();
        this.addSpace(b[p]);
        break;
      case 'p':
        this.drawerPulse(b[p] >= 48 ? b[p] - 48 : b[p]);
        break;
      default:
        break;
    }
  }

  stepGs(at) {
    if (at + 1 >= this.buffer.length) return 0;
    const name = String.fromCharCode(this.buffer[at + 1]);
    if (name === 'V') return this.stepCut(at);
    if (name === 'v') return this.stepRaster(at);
    if (name === 'k') return this.stepBarcode(at);
    if (name === '(') return this.stepExtended(at);
    if (name === '*') {
      if (at + 4 > this.buffer.length) return 0;
      const total = 4 + this.buffer[at + 2] * this.buffer[at + 3] * 8;
      return at + total > this.buffer.length ? 0 : total;
    }
    const params = GS_FIXED[name];
    if (params === undefined) {
      this.current.unknownCommands++;
      return 2;
    }
    if (at + 2 + params > this.buffer.length) return 0;
    const n = this.buffer[at + 2];
    if (name === '!') this.style = { ...this.style, w: ((n >> 4) & 7) + 1, h: (n & 7) + 1 };
    else if (name === 'B') this.style = { ...this.style, reverse: !!(n & 1) };
    else if (name === 'r') this.onReply(Buffer.from([(n === 2 || n === 50) && this.isDrawerOpen() ? 1 : 0]));
    return 2 + params;
  }

  stepDle(at) {
    if (at + 1 >= this.buffer.length) return 0;
    const name = this.buffer[at + 1];
    if (name === 0x04) {
      if (at + 3 > this.buffer.length) return 0;
      const open = this.buffer[at + 2] === 1 && this.isDrawerOpen();
      this.onReply(Buffer.from([STATUS_BASE | (open ? DRAWER_BIT : 0)]));
      return 3;
    }
    if (name === 0x14) {
      if (at + 5 > this.buffer.length) return 0;
      if (this.buffer[at + 2] === 1) this.drawerPulse(this.buffer[at + 3]);
      return 5;
    }
    if (name === 0x05) return at + 3 > this.buffer.length ? 0 : 3;
    return 1;
  }

  stepFs(at) {
    if (at + 1 >= this.buffer.length) return 0;
    const name = String.fromCharCode(this.buffer[at + 1]);
    if (name === '&' || name === '.') return 2;
    if (name === 'C' || name === '!' || name === '-' || name === 'S') {
      const params = name === 'S' ? 2 : 1;
      return at + 2 + params > this.buffer.length ? 0 : 2 + params;
    }
    if (name === 'p') {
      if (at + 4 > this.buffer.length) return 0;
      this.current.skipped.push('stored logo');
      return 4;
    }
    this.current.unknownCommands++;
    return 2;
  }

  stepUntilNul(from, at) {
    const nul = this.buffer.indexOf(0, from);
    return nul === -1 ? 0 : nul + 1 - at;
  }

  /** ESC ( x and GS ( x: two length bytes then the data. Only the QR code function is read. */
  stepExtended(at) {
    if (at + 5 > this.buffer.length) return 0;
    const length = this.buffer[at + 3] | (this.buffer[at + 4] << 8);
    const total = 5 + length;
    if (at + total > this.buffer.length) return 0;
    const isGs = this.buffer[at] === GS;
    if (isGs && this.buffer[at + 2] === 0x6b && length >= 3 && this.buffer[at + 5] === 49) {
      const fn = this.buffer[at + 6];
      if (fn === 80) this.qrData = this.buffer.toString('latin1', at + 8, at + total);
      if (fn === 81) {
        this.flushLineIfAny();
        this.addPlaceholder(`QR code: ${this.qrData}`, 'QR code');
      }
    }
    return total;
  }

  stepCut(at) {
    if (at + 3 > this.buffer.length) return 0;
    const mode = this.buffer[at + 2];
    const total = mode === 65 || mode === 66 ? 4 : 3;
    if (at + total > this.buffer.length) return 0;
    this.flushLineIfAny();
    if (hasContent(this.current)) this.closeDocument(true);
    return total;
  }

  /** GS v 0: a block of 1-bit rows, the format the Karbar24 POS uses for Bangla lines. */
  stepRaster(at) {
    if (at + 8 > this.buffer.length) return 0;
    const widthBytes = this.buffer[at + 4] | (this.buffer[at + 5] << 8);
    const height = this.buffer[at + 6] | (this.buffer[at + 7] << 8);
    const total = 8 + widthBytes * height;
    if (at + total > this.buffer.length) return 0;
    const mode = this.buffer[at + 3] >= 48 ? this.buffer[at + 3] - 48 : this.buffer[at + 3];
    this.flushLineIfAny();
    this.addImage(
      widthBytes,
      height,
      this.buffer.subarray(at + 8, at + total),
      mode === 1 || mode === 3 ? 2 : 1,
      mode === 2 || mode === 3 ? 2 : 1,
    );
    return total;
  }

  /** ESC *: column-format pictures from older POS drivers, turned into the same 1-bit rows. */
  stepColumnImage(at) {
    if (at + 5 > this.buffer.length) return 0;
    const mode = this.buffer[at + 2];
    const columns = this.buffer[at + 3] | (this.buffer[at + 4] << 8);
    const bytesPerColumn = mode === 32 || mode === 33 ? 3 : 1;
    const total = 5 + columns * bytesPerColumn;
    if (at + total > this.buffer.length) return 0;
    const rows = bytesPerColumn * 8;
    const widthBytes = Math.ceil(columns / 8);
    const out = Buffer.alloc(widthBytes * rows);
    for (let x = 0; x < columns; x++) {
      for (let y = 0; y < rows; y++) {
        const source = this.buffer[at + 5 + x * bytesPerColumn + (y >> 3)];
        if (source & (0x80 >> (y & 7))) out[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    this.flushLineIfAny();
    this.addImage(widthBytes, rows, out, mode === 0 || mode === 32 ? 2 : 1, bytesPerColumn === 1 ? 3 : 1, columns);
    this.skipNextLf = true;
    return total;
  }

  stepBarcode(at) {
    if (at + 3 > this.buffer.length) return 0;
    const type = this.buffer[at + 2];
    let start = at + 3;
    let end;
    if (type <= 6) {
      end = this.buffer.indexOf(0, start);
      if (end === -1) return 0;
    } else {
      if (at + 4 > this.buffer.length) return 0;
      start = at + 4;
      end = start + this.buffer[at + 3];
      if (end > this.buffer.length) return 0;
    }
    this.flushLineIfAny();
    this.addPlaceholder(`Barcode: ${this.buffer.toString('latin1', start, end)}`, 'barcode');
    return (type <= 6 ? end + 1 : end) - at;
  }

  drawerPulse(pin) {
    const target = hasContent(this.current) || this.runs.length ? this.current : this.finished[this.finished.length - 1];
    if (target) target.drawerKick = true;
    this.onDrawer({ pin });
  }

  addText(text) {
    const { font, w } = this.style;
    const charDots = FONTS[font].width * w;
    for (const ch of text) {
      if (this.usedDots + charDots > this.paperDots) this.flushLine();
      if (this.lineAlign === null) this.lineAlign = this.align;
      const last = this.runs[this.runs.length - 1];
      if (last && sameStyle(last, this.style)) last.text += ch;
      else this.runs.push({ ...this.style, text: ch });
      this.usedDots += charDots;
    }
    this.current.widestDots = Math.max(this.current.widestDots, this.usedDots);
  }

  flushLineIfAny() {
    if (this.runs.length) this.flushLine();
  }

  flushLine() {
    const tallest = this.runs.reduce((max, r) => Math.max(max, FONTS[r.font].height * r.h + (r.h > 1 ? 6 : 0)), 0);
    this.current.blocks.push({
      t: 'line',
      align: this.lineAlign ?? this.align,
      runs: this.runs,
      dots: Math.max(tallest, this.lineDots),
    });
    this.resetLine();
  }

  addSpace(dots) {
    if (dots > 0) this.current.blocks.push({ t: 'space', dots });
  }

  addImage(widthBytes, height, data, sx, sy, widthDots = widthBytes * 8) {
    if (!widthBytes || !height) return;
    this.current.widestDots = Math.max(this.current.widestDots, widthDots * sx);
    this.current.blocks.push({
      t: 'image',
      align: this.align,
      widthBytes,
      widthDots,
      height,
      sx,
      sy,
      data: Buffer.from(data).toString('base64'),
    });
  }

  addPlaceholder(text, skippedName) {
    this.current.blocks.push({ t: 'placeholder', align: this.align, text });
    this.current.skipped.push(skippedName);
  }
}
