# Changelog — K24 Virtual Printer

All notable changes to this project are written here, newest first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html): a fix raises the last number (1.0.1), a new feature the
middle one (1.1.0), and a change that breaks how the POS connects the first one (2.0.0).

## [Unreleased]

## [1.0.0] — 2026-11-20

The first release.

### Added

- **Network printer:** a pretend thermal receipt printer that listens like a LAN printer (port `9100` by default) and
  reads the ESC/POS commands a POS sends. It can answer this computer only, or other devices on the network too.
- **Receipt preview:** every receipt is drawn as it arrives, with bold, underline, reverse, sizes, fonts A and B,
  alignment, line spacing, tabs, feeds, cuts, and raster and column pictures (so Bangla text sent as pictures shows).
- **PDF per receipt:** each receipt is saved as a PDF named by date, time and number, in
  `Documents\K24 Virtual Printer` or a folder you choose. A receipt whose PDF could not be saved says why and has
  **Try saving again**. Optionally, the raw printer bytes are saved next to it as a `.bin` file.
- **Cash drawer:** the POS's drawer kick (`ESC p`, `DLE DC4`) slides the drawer open; you close it, or it closes
  itself after 5, 10 or 30 seconds. Status questions (`DLE EOT`, `GS r`) get real printer answers, including the
  drawer switch.
- **Power switch** on the printer, to test what the POS does when the printer is off.
- **58 mm and 80 mm paper**, with a warning on a receipt that was made for wider paper.
- **Warnings on the receipt** for barcodes and QR codes (shown as text) and for printer commands it does not
  recognise.
- **How it works** tab: the exact values to enter in the Karbar24 POS, what to know (closing the drawer, POS on
  another device, web POS, Bangla text), the POS switch that makes prints match the screen, and fixes for common
  problems.
- **Test receipt** button, to check the app without a POS.
- **Settings:** PDF folder, paper width, who can print, port number, drawer timer, sound and raw-byte saving.
- Light and dark appearance, following Windows.
- **App logo** as the icon of the window, taskbar, Start menu and Desktop shortcuts and the installer, and as the
  mark in the app header: a printer with a paper and a blue swirl.
- **Windows installer** for the current user (no administrator rights needed), with Desktop and Start menu shortcuts.
  Installing a newer version keeps your settings and receipts.
- Only one copy of the app runs at a time; starting it again brings the open window forward.
- Tests for the ESC/POS decoder and the network listener (`npm test`).

[Unreleased]: #unreleased
[1.0.0]: #100--2026-11-20
