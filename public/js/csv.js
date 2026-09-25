'use strict';

import { csvCell, downloadCsv } from './ui.js';

/* One way to turn what a screen is showing into a spreadsheet.
 *
 * Every export in the app goes through here, so they all quote the same way,
 * all defend against a cell that looks like a formula (csvCell does that), and
 * all name their file the same shape: orison-<what>-<when>.csv.
 *
 * Column headers stay in English on purpose. A CSV is for a spreadsheet, an
 * accountant or an importer, not for reading on the screen — and a column
 * called "التاريخ" in one export and "Date" in another cannot be joined.
 */

export function csvText(title, columns, rows, extra) {
  const lines = [];
  if (title) lines.push([title].map(csvCell).join(','));
  for (const block of extra || []) {
    if (block.title) { lines.push(''); lines.push([block.title].map(csvCell).join(',')); }
    if (block.columns) lines.push(block.columns.join(','));
    for (const r of block.rows || []) lines.push(r.map(csvCell).join(','));
  }
  if (columns && columns.length) {
    if (extra && extra.length) lines.push('');
    lines.push(columns.join(','));
  }
  for (const r of rows || []) lines.push(r.map(csvCell).join(','));
  return lines.join('\n');
}

/* A file name a person can find again: what it is, and when it was taken. */
export function csvName(what, range) {
  const part = range && range.from && range.to ? `-${range.from}-to-${range.to}`
    : range && range.on ? `-${range.on}`
      : `-${new Date().toISOString().slice(0, 10)}`;
  return `orison-${String(what).toLowerCase().replace(/[^a-z0-9]+/g, '-')}${part}.csv`;
}

export function exportCsv(what, { title, columns, rows, extra, range } = {}) {
  downloadCsv(csvName(what, range), csvText(title, columns, rows, extra));
}

/* The button every screen shows, so they all look and read the same. */
export function exportButton(id, label) {
  return `<button class="btn btn-sm btn-ghost" id="${id}" type="button">${label}</button>`;
}
