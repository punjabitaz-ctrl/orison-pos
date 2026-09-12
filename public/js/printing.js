'use strict';

/* The app's printing entry points. Screens call these; the decisions live in
   printer.js, where they are unit-tested, and the drawing in receipt-render.js.
   This file only wires in the browser: the real Bluetooth stack, the real
   renderers, the store's currency, and plain-language results. */

import { idb } from './db.js';
import { fmt } from './ui.js';
import { printSheet } from './print-sheet.js';
import { rollHtml, sheetHtml, docToImage } from './receipt-render.js';
import {
  bluetoothSupported, createBluetoothTransport, loadPrinterSettings, openDrawer,
  printReceipt, savePrinterSettings, shouldKickForSale,
} from './printer.js';

export const bluetooth = createBluetoothTransport(typeof navigator === 'undefined' ? undefined : navigator);

export const canUseBluetooth = () => bluetoothSupported(typeof navigator === 'undefined' ? undefined : navigator);

export const getPrinterSettings = () => loadPrinterSettings(idb);
export const setPrinterSettings = (s) => savePrinterSettings(idb, s);

/* Print in the page rather than a pop-up, so the register never blinks away.
   A 58 mm roll uses its own named @page (see style.css). */
function renderRoll(doc, paper) {
  let host = document.getElementById('receiptPrint');
  if (!host) {
    host = document.createElement('div');
    host.id = 'receiptPrint';
    document.body.appendChild(host);
  }
  host.className = `print-root print-job paper-${paper}`;
  host.innerHTML = rollHtml(doc, fmt);
  document.body.classList.add('printing');
  requestAnimationFrame(() => {
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing');
      host.innerHTML = '';
    }, 600);
  });
}

function renderSheet(doc, page) {
  const size = page === 'letter' ? 'letter' : page === 'a4' ? 'A4' : 'auto';
  return printSheet(sheetHtml(doc, fmt), '', size);
}

export const REASONS = {
  not_connected: 'The Bluetooth printer is not connected. Connect it in Settings → Printer.',
  popup_blocked: 'The browser blocked the print window. Allow pop-ups for this site, then try again.',
  no_drawer: 'No cash drawer is set up on this terminal.',
};

export async function printDoc(doc, { kick = false } = {}) {
  const settings = await getPrinterSettings();
  try {
    const r = await printReceipt(doc, {
      settings, fmt, transport: bluetooth, renderRoll, renderSheet,
      renderCanvas: (d, width) => docToImage(d, width, fmt), kick,
    });
    return { ...r, message: r.ok ? '' : (REASONS[r.reason] || 'Could not print') };
  } catch (e) {
    return { ok: false, reason: 'error', message: `Printer error: ${(e && e.message) || e}` };
  }
}

export async function kickDrawer() {
  const settings = await getPrinterSettings();
  try {
    const r = await openDrawer({ settings, transport: bluetooth });
    return { ...r, message: r.ok ? '' : (REASONS[r.reason] || 'Could not open the drawer') };
  } catch (e) {
    return { ok: false, reason: 'error', message: `Drawer error: ${(e && e.message) || e}` };
  }
}

/* After a sale the drawer and the receipt want different timing. The drawer
   opens at once - the cashier needs change now. The receipt waits for the
   server's receipt number (see checkout), then prints if the terminal is set
   to print automatically. */
export async function maybeKickForSale(tenders) {
  const settings = await getPrinterSettings();
  if (!shouldKickForSale(tenders, settings)) return { ok: true, skipped: true };
  return kickDrawer();
}

export async function maybeAutoPrint(doc) {
  const settings = await getPrinterSettings();
  if (!settings.autoPrint) return { ok: true, skipped: true };
  return printDoc(doc);
}
