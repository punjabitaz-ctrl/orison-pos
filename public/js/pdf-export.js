'use strict';

import { $t } from './lang.js';

/* PDF export, from the same data the CSV export uses.
 *
 * There is no PDF library here and there is not going to be: the app has no
 * build step, and its Content-Security-Policy does not admit one. What it has
 * is a print sheet — a clean window with print styles — and every browser can
 * save that as a PDF. That route also prints Arabic and Urdu correctly, which
 * the receipt's own built-in PDF writer (Courier, ASCII) cannot do.
 *
 * So: CSV is for a spreadsheet, and its headers stay English. PDF is for a
 * person — a landlord, an accountant, the owner's file — so it is translated,
 * laid out, and carries the shop's name, the period and when it was taken.
 */

import { esc, toast } from './ui.js';
import { printSheet } from './print-sheet.js';

function tableHtml(columns, rows, numericFrom) {
  if (!columns || !columns.length) return '';
  const isNum = (i) => numericFrom != null && i >= numericFrom;
  return `<table>
    <thead><tr>${columns.map((c, i) => `<th class="${isNum(i) ? 'num' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${(rows || []).map((r) => `<tr>${(r || []).map((cell, i) =>
      `<td class="${isNum(i) ? 'num' : ''}">${esc(cell == null ? '' : String(cell))}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
}

/* The same shape the CSV builders return: a title, columns and rows, plus any
   number of extra blocks that come first (a summary, what is owed, and so on). */
export function pdfHtml({ title, subtitle, columns, rows, extra, numericFrom, meta } = {}) {
  const parts = [];
  if (subtitle) parts.push(`<p class="sub">${esc(subtitle)}</p>`);
  for (const block of extra || []) {
    if (block.title) parts.push(`<h2>${esc(block.title)}</h2>`);
    parts.push(tableHtml(block.columns, block.rows, block.numericFrom));
  }
  if (columns && columns.length) {
    if (extra && extra.length && title) parts.push(`<h2>${esc(title)}</h2>`);
    parts.push(tableHtml(columns, rows, numericFrom));
  }
  if (!rows || !rows.length) {
    if (!extra || !extra.length) parts.push(`<p class="sub">${esc($t('Nothing to show for this period.'))}</p>`);
  }
  if (meta) parts.push(`<p class="sub">${esc(meta)}</p>`);
  return parts.join('\n');
}

/* Opens the print window. Returns false when the browser blocked it, having
   already said so — the caller does not need to repeat the message. */
export function exportPdf(what, opts = {}) {
  const store = opts.storeName || '';
  const when = opts.range && opts.range.from && opts.range.to
    ? $t('{from} to {to}', { from: opts.range.from, to: opts.range.to })
    : new Date().toLocaleDateString();
  const heading = [store, opts.title || what].filter(Boolean).join(' · ');
  const html = pdfHtml({
    ...opts,
    subtitle: opts.subtitle || when,
    meta: opts.meta || $t('Taken {date}', { date: new Date().toLocaleString() }),
  });
  const ok = printSheet(html, heading, opts.pageSize || 'A4');
  if (!ok) toast($t('The browser blocked the print window — allow pop-ups for this site'), 'warn', 4200);
  return ok;
}
