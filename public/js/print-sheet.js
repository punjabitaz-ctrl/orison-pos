'use strict';

/* Full-page printing for things that are not 80mm receipts.

   The app's own print path is tuned for a thermal roll (`@page { size: 80mm }`),
   and CSS gives no way to swap page geometry per element, so label sheets and
   worksheets print from their own window instead. That also keeps the register
   on screen: the operator never watches the whole app blink to hidden.

   The window carries only inline styles — no script, no fetch — which is all
   the app's Content-Security-Policy allows an inherited about:blank document
   to do. If the browser blocks the pop-up, the caller is told so it can say
   something useful rather than silently printing nothing. */

const SHEET_CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 10mm;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #17222f; background: #fff;
    font-variant-numeric: tabular-nums;
  }
  h1 { font-size: 14pt; margin: 0 0 6mm; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th, td { padding: 2mm 2.5mm; text-align: left; border-bottom: .3mm solid #d8dfe8; vertical-align: top; }
  thead th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .3pt; color: #64748b; }
  td.num, th.num { text-align: right; }
  tfoot td { font-weight: 700; border-top: .5mm solid #94a3b8; border-bottom: 0; }
  .muted { color: #64748b; font-size: 7.5pt; }
  .neg { color: #b91c1c; }
  .gp { color: #047857; }

  .lbl-sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
  .lbl {
    border: .3mm dashed #b6c2d1; border-radius: 2mm;
    padding: 3mm; text-align: center;
    display: flex; flex-direction: column; gap: 1.5mm;
    break-inside: avoid; page-break-inside: avoid;
  }
  .lbl-name { font-size: 8.5pt; font-weight: 700; line-height: 1.2; }
  .lbl-bc { display: block; width: 100%; height: 12mm; }
  .lbl-foot { display: flex; align-items: baseline; justify-content: space-between; gap: 2mm; }
  .lbl-code { font-size: 7pt; color: #475569; letter-spacing: .2pt; }
  .lbl-price { font-size: 11pt; font-weight: 800; }
  .lbl-store { font-size: 6.5pt; color: #94a3b8; }

  @page { size: auto; margin: 8mm; }
  @media print { body { padding: 0; } }
`;

export function printSheet(html, title = '') {
  const win = window.open('', 'orisonPrintSheet', 'popup=yes,width=980,height=760');
  if (!win) return false;
  const doc = win.document;
  doc.open();
  doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title></title></head><body></body></html>');
  doc.close();

  doc.title = title || 'Orison POS';
  const style = doc.createElement('style');
  style.textContent = SHEET_CSS;
  doc.head.appendChild(style);

  if (title) {
    const h1 = doc.createElement('h1');
    h1.textContent = title;
    doc.body.appendChild(h1);
  }
  const holder = doc.createElement('div');
  holder.innerHTML = html;
  doc.body.appendChild(holder);

  /* Give the layout a frame to settle before the print dialog freezes it. */
  win.setTimeout(() => {
    win.focus();
    win.print();
  }, 120);
  return true;
}
