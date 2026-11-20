# K24 Virtual Printer

A pretend thermal receipt printer and cash drawer for testing a POS without hardware. It listens on the network like a
LAN printer, reads the ESC/POS commands it receives, shows the receipt, saves it as a PDF and animates the drawer.

## Run

```bash
npm install
npm start           # opens the app
npm run shortcut    # Desktop and Start menu shortcuts that run from this folder
npm test            # decoder and network tests
npm run package     # Windows installer in dist/
```

## Connect the Karbar24 POS

Settings, Printers & Hardware, New Printer: Connection `Network (LAN / Wi-Fi)`, Command language `ESC/POS (thermal)`,
Target address `127.0.0.1:9100`. The same steps are on the app's How it works tab.

## Layout

| Path | What it is |
|---|---|
| `src/core/` | Plain Node, no Electron: decoder, TCP listener, settings rules, test receipt. Covered by `test/`. |
| `src/main/` | Electron main process: window, drawer state, receipt list, PDF making, and the IPC bridge. |
| `src/ui/` | The screens, plain HTML/CSS/JS with no build step. `receipt-render.js` draws both the preview and the PDF. |
| `scripts/` | Icon maker (`npm run icon` builds `assets/icon.png`, `assets/icon.ico` and `src/ui/logo.png` from `assets/logo.png`) and shortcut maker. |

Settings and the receipt list are kept in `%APPDATA%\karbar24-virtual-printer`. PDFs go to `Documents\K24 Virtual Printer`
unless changed in Settings.

## Supported printer commands

Text styles (bold, underline, reverse, sizes, fonts A and B), alignment, line spacing, feeds, cuts (a cut ends a
receipt), raster and column pictures, drawer kick (`ESC p`, `DLE DC4`), status replies (`DLE EOT`, `GS r`). Barcodes and
QR codes are shown as text with a warning on the receipt. Other known commands are skipped safely.
