<p align="center">
  <img src="assets/icon.png" alt="K24 Virtual Printer logo" width="160">
</p>

<h3 align="center">K24 Virtual Printer</h3>

<p align="center">
  A pretend thermal receipt printer and cash drawer for testing the Karbar24 POS without any hardware.
</p>

<p align="center">
  <img alt="Version 1.0.0" src="https://img.shields.io/badge/version-1.0.0-F47A1F">
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-0B2545">
  <img alt="Electron 33" src="https://img.shields.io/badge/Electron-33-0B2545">
  <img alt="Node.js 22+" src="https://img.shields.io/badge/Node.js-22%2B-0B2545">
  <img alt="ESC/POS" src="https://img.shields.io/badge/printer%20language-ESC%2FPOS-0B2545">
</p>

---

## What it is

The K24 Virtual Printer behaves like a LAN thermal printer on port `9100`. The Karbar24 POS (or any app that prints
ESC/POS to a network printer) sends receipts to it. The app reads the printer commands, shows the receipt on screen,
saves each one as a PDF, and slides its cash drawer open when the POS asks. You can test printing, receipt layout and
drawer handling at your desk, with no printer, paper or drawer.

| Feature | What it does |
|---|---|
| **Network printer** | Listens on port `9100` (changeable), for this computer only or for other devices on the network too |
| **Receipt preview** | Draws every receipt as it arrives: text styles, sizes, alignment, pictures, cuts |
| **PDF per receipt** | Saves files like `2026-11-20_14-32-05_receipt-0007.pdf` to `Documents\K24 Virtual Printer` or a folder you choose |
| **Cash drawer** | Opens when the POS sends a drawer kick; you close it, or it closes itself after 5, 10 or 30 seconds |
| **Status replies** | Answers the POS's status questions like a real printer, including whether the drawer is open |
| **Power switch** | Turn the printer off to test what your POS does when the printer is unreachable |
| **Paper width** | 58 mm or 80 mm, matching the printer set up in the POS |
| **Built-in guide** | The **How it works** tab has the exact values to enter in the Karbar24 POS, and fixes for common problems |
| **Test receipt** | One button prints a sample receipt without the POS |

Light and dark appearance follow Windows.

## Install

Run `K24-Virtual-Printer-Setup-<version>.exe` (made by `npm run package`, below). It installs for the current user, so
no administrator rights are needed, and adds Desktop and Start menu shortcuts. The installer is not code-signed: if
Windows SmartScreen warns, choose **More info**, then **Run anyway**.

Installing a newer version over an older one keeps your settings and receipts.

## Connect the Karbar24 POS

In the POS: **Settings → Printers & Hardware → New Printer**.

| Field | Value |
|---|---|
| Connection | `Network (LAN / Wi-Fi)` |
| Command language | `ESC/POS (thermal)` |
| Target address | `127.0.0.1:9100` (the app shows the exact address, with a Copy button) |
| Paper width | the same as in this app's Settings (58 mm or 80 mm) |

Save the printer, open it again, press **Test print**, then **Open drawer**, and watch the **Printer** tab here.

- **POS on another device:** in this app's Settings choose **Other devices too**, and allow the app if Windows Firewall
  asks. Use the address the app shows (this PC's network address). Both devices must be on the same network.
- **Web POS:** a browser cannot send to a network printer, so the web POS opens the normal print window instead. Use
  the desktop or Android POS.

## Development

Needs **Node.js 22 or newer** and **Windows** (the app and its installer are Windows-only).

```bash
npm install          # Electron and electron-builder
npm start            # opens the app from this folder
npm test             # decoder and network tests (node --test)
npm run shortcut     # Desktop and Start menu shortcuts that run this folder
npm run icon         # rebuilds the app icons from assets/logo.png
npm run package      # Windows installer → dist/K24-Virtual-Printer-Setup-<version>.exe
```

Running from a VS Code terminal? VS Code sets `ELECTRON_RUN_AS_NODE`, which makes Electron start as plain Node, so
`npm start` and `npm run icon` fail. Clear it first: `set ELECTRON_RUN_AS_NODE=` (cmd) or
`Remove-Item Env:ELECTRON_RUN_AS_NODE` (PowerShell).

### Changing the logo

Replace `assets/logo.png` (a square PNG with a see-through background, about 1000 px or larger), then:

```bash
npm run icon         # writes assets/icon.png, assets/icon.ico and src/ui/logo.png
npm run package      # so the installed .exe, the installer and the shortcuts get it too
```

## Project layout

| Path | What it is |
|---|---|
| `src/core/` | Plain Node, no Electron: the ESC/POS decoder, the TCP printer listener, settings rules and the test receipt. Covered by `test/` |
| `src/main/` | Electron main process: the window, drawer state, receipt list, PDF making and the bridge to the screens |
| `src/ui/` | The screens, plain HTML, CSS and JavaScript with no build step. `receipt-render.js` draws both the preview and the PDF, so they always match |
| `assets/` | `logo.png` (the source picture) and the icons made from it |
| `scripts/` | The icon maker and the shortcut maker |
| `test/` | `node --test` tests for the decoder and the network listener |
| `builder.json` | electron-builder settings for the Windows installer |

## Where it keeps things

| What | Where |
|---|---|
| Settings and the receipt list | `%APPDATA%\karbar24-virtual-printer` |
| Receipt PDFs | `Documents\K24 Virtual Printer`, or the folder chosen in Settings |
| Raw printer bytes (optional, in Settings) | a `.bin` file next to each PDF |

## Supported printer commands

| Area | Commands |
|---|---|
| Text | bold, underline, reverse, sizes, fonts A and B, alignment, line spacing, tabs |
| Paper | feeds and cuts (a cut ends a receipt) |
| Pictures | raster and column images, so Bangla text the POS sends as pictures shows correctly |
| Cash drawer | drawer kick (`ESC p`, `DLE DC4`) |
| Status | `DLE EOT` and `GS r` replies, including the drawer switch |

Barcodes and QR codes are shown as text, with a warning on the receipt. Other known commands are skipped safely.
Commands the app does not recognise are ignored, and the receipt warns how many there were.

## Good to know

- A POS can open a drawer but never close one. A real drawer is pushed shut by hand, so here you press **Close
  drawer**, or set a timer in Settings.
- Line layout, sizes and pictures follow the printer commands. Letter shapes come from this computer's font, so they
  look a little different from a real printer's.
- Only one copy of the app runs at a time. Starting it again brings the open window forward.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

---

<p align="center">Made by Zayaan IT for testing the Karbar24 POS.</p>
