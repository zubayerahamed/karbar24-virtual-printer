/**
 * Draws a decoded receipt. The screen preview and the PDF both use this, so what you see is what is saved.
 * Everything is measured in printer dots through the CSS variable --dot. Text from the network only ever goes into
 * textContent, never HTML.
 */
(function () {
  const PAPER = { 58: { printable: 384, total: 464 }, 80: { printable: 576, total: 640 } };
  const FONTS = { A: { width: 12, height: 24 }, B: { width: 9, height: 17 } };
  const MAX_CANVAS_SIDE = 32000;

  /** Width of one character as a share of the font size, so 48 columns fill the paper exactly. */
  const glyphRatio = (() => {
    const context = document.createElement('canvas').getContext('2d');
    context.font = '100px Consolas, "Courier New", monospace';
    return context.measureText('M').width / 100;
  })();

  const dots = (n) => `calc(var(--dot) * ${n})`;

  function make(className) {
    const element = document.createElement('div');
    element.className = className;
    return element;
  }

  function drawLine(block) {
    const line = make(`r-line r-${block.align}`);
    line.style.height = dots(block.dots);
    for (const run of block.runs) {
      const font = FONTS[run.font];
      const box = document.createElement('span');
      box.className = `r-run${run.reverse ? ' r-reverse' : ''}`;
      box.style.width = dots(run.text.length * font.width * run.w);
      box.style.height = dots(font.height * run.h);
      const glyphs = document.createElement('span');
      glyphs.className = `r-glyphs${run.bold ? ' r-bold' : ''}${run.underline ? ' r-underline' : ''}`;
      glyphs.textContent = run.text;
      glyphs.style.transform = `scale(${(font.width / 12) * run.w}, ${(font.height / 24) * run.h})`;
      box.append(glyphs);
      line.append(box);
    }
    return line;
  }

  function imageUrl(block) {
    const canvas = document.createElement('canvas');
    canvas.width = block.widthDots;
    canvas.height = block.height;
    const context = canvas.getContext('2d');
    const pixels = context.createImageData(block.widthDots, block.height);
    const binary = atob(block.data);
    for (let y = 0; y < block.height; y++) {
      for (let x = 0; x < block.widthDots; x++) {
        const byte = binary.charCodeAt(y * block.widthBytes + (x >> 3));
        const on = (byte & (0x80 >> (x & 7))) !== 0;
        const at = (y * block.widthDots + x) * 4;
        pixels.data[at] = pixels.data[at + 1] = pixels.data[at + 2] = 0;
        pixels.data[at + 3] = on ? 255 : 0;
      }
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png');
  }

  function drawImage(block, paper) {
    const row = make(`r-image r-${block.align}`);
    if (block.widthDots > MAX_CANVAS_SIDE || block.height > MAX_CANVAS_SIDE) return row;
    const image = document.createElement('img');
    image.alt = '';
    image.src = imageUrl(block);
    // Wider than the paper: shrink to fit so nothing is lost. The job also carries a warning.
    const width = block.widthDots * block.sx;
    const shrink = Math.min(1, paper.printable / width);
    image.style.width = dots(width * shrink);
    image.style.height = dots(block.height * block.sy * shrink);
    row.append(image);
    return row;
  }

  function drawPlaceholder(block) {
    const row = make(`r-placeholder r-${block.align}`);
    const label = document.createElement('span');
    label.textContent = block.text;
    row.append(label);
    return row;
  }

  /** Replaces the contents of `root` with the drawn job. */
  function renderReceipt(root, job) {
    const paper = PAPER[job.paper];
    root.classList.add('receipt');
    root.style.setProperty('--total-dots', String(paper.total));
    root.style.setProperty('--glyph', String(12 / glyphRatio));
    root.style.width = dots(paper.total);
    root.style.paddingInline = dots((paper.total - paper.printable) / 2);
    root.replaceChildren(
      ...job.blocks.map((block) => {
        if (block.t === 'line') return drawLine(block);
        if (block.t === 'image') return drawImage(block, paper);
        if (block.t === 'placeholder') return drawPlaceholder(block);
        const space = make('r-space');
        space.style.height = dots(block.dots);
        return space;
      }),
    );
  }

  window.renderReceipt = renderReceipt;
})();
