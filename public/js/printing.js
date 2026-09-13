'use strict';

/* The app's printing entry points. Screens call these; the decisions live in
   printer.js, where they are unit-tested, and the drawing in receipt-render.js.
   This file only wires in the browser: the real Bluetooth stack, the real
   renderers, the store's currency, and plain-language results. */

import { idb } from './db.js';
import { fmtFor } from './ui.js';
import { printSheet } from './print-sheet.js';
import { rollHtml, sheetHtml, docToImage } from './receipt-render.js';
import {
  bluetoothSupported, createBluetoothTransport, loadPrinterSettings, openDrawer,
  printReceipt, savePrinterSettings, shouldKickForSale,
} from './printer.js';
import { $t, N_ } from './lang.js';

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
  host.innerHTML = rollHtml(doc, fmtFor(doc.dir));
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
  return printSheet(sheetHtml(doc, fmtFor(doc.dir)), '', size);
}

export const REASONS = {
  not_connected: N_('The Bluetooth printer is not connected. Connect it in Settings → Printer.'),
  popup_blocked: N_('The browser blocked the print window. Allow pop-ups for this site, then try again.'),
  no_drawer: N_('No cash drawer is set up on this terminal.'),
};

export async function printDoc(doc, { kick = false } = {}) {
  const settings = await getPrinterSettings();
  const fmt = fmtFor(doc.dir);
  try {
    const r = await printReceipt(doc, {
      settings, fmt, transport: bluetooth, renderRoll, renderSheet,
      renderCanvas: (d, width) => docToImage(d, width, fmt), kick,
    });
    return { ...r, message: r.ok ? '' : $t(REASONS[r.reason] || N_('Could not print')) };
  } catch (e) {
    return { ok: false, reason: 'error', message: $t('Printer error: {reason}', { reason: (e && e.message) || e }) };
  }
}

export async function kickDrawer() {
  const settings = await getPrinterSettings();
  try {
    const r = await openDrawer({ settings, transport: bluetooth });
    return { ...r, message: r.ok ? '' : $t(REASONS[r.reason] || N_('Could not open the drawer')) };
  } catch (e) {
    return { ok: false, reason: 'error', message: $t('Drawer error: {reason}', { reason: (e && e.message) || e }) };
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
