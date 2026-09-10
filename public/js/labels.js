'use strict';

/* Shelf / product labels: a Code 128-B encoder and an SVG renderer, plus the
   markup for a printable label sheet.

   Encoding is done here rather than with a library because the app ships no
   build step and loads no third-party script (the CSP forbids it). Code 128-B
   covers the printable ASCII range 32–126, which is every SKU and UPC this
   catalog can hold. The scanner in the register reads the same symbology it
   already reads off manufacturer packaging. */

/* Bar/space widths for symbol values 0–106. Each entry is six widths (the
   stop pattern has seven), bars and spaces alternating, starting with a bar;
   every symbol is 11 modules wide, the stop is 13. */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

export function encodable(text) {
  const s = String(text == null ? '' : text);
  if (!s.length) return false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

/* Symbol values for a Code 128-B message: start, the data, the modulo-103
   check symbol, stop. */
export function code128bValues(text) {
  const s = String(text == null ? '' : text);
  if (!encodable(s)) throw new Error('Code 128-B can only encode printable ASCII (32-126)');
  const values = [START_B];
  for (let i = 0; i < s.length; i++) values.push(s.charCodeAt(i) - 32);

  let sum = START_B;
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103);
  values.push(STOP);
  return values;
}

/* Flatten to alternating bar/space runs, starting with a bar. */
export function code128bBars(text) {
  const runs = [];
  for (const value of code128bValues(text)) {
    const pattern = PATTERNS[value];
    for (let i = 0; i < pattern.length; i++) {
      runs.push({ width: Number(pattern[i]), bar: i % 2 === 0 });
    }
  }
  return runs;
}

export function moduleCount(text) {
  return code128bBars(text).reduce((n, r) => n + r.width, 0);
}

/* An inline SVG barcode. `module` is the width of one module in user units;
   a thermal or laser label at 2 units per module scans reliably at 203 dpi. */
export function barcodeSvg(text, { height = 42, module = 2, quiet = 10 } = {}) {
  let runs;
  try { runs = code128bBars(text); } catch (_) { return ''; }
  const total = runs.reduce((n, r) => n + r.width, 0);
  const width = (total + quiet * 2) * module;
  let x = quiet * module;
  let rects = '';
  for (const run of runs) {
    const w = run.width * module;
    if (run.bar) rects += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"></rect>`;
    x += w;
  }
  return `<svg class="lbl-bc" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Barcode ${escapeAttr(text)}">${rects}</svg>`;
}

function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* What actually goes under the bars: a UPC if the item has one (that is what
   a scanner at another shop would read), otherwise the SKU. Items with
   neither cannot be labelled. */
export function labelCode(product) {
  const upc = String((product && product.upc) || '').trim();
  const sku = String((product && product.sku) || '').trim();
  const code = upc || sku;
  return encodable(code) ? code : '';
}

export function labelsFor(products, quantities = {}) {
  const out = [];
  for (const p of products || []) {
    const code = labelCode(p);
    if (!code) continue;
    const n = Math.max(0, Math.min(200, Math.floor(Number(quantities[p.id]) || 0)));
    for (let i = 0; i < n; i++) {
      out.push({ id: p.id, name: String(p.name || ''), code, price: Number(p.retailPrice) || 0 });
    }
  }
  return out;
}

export function labelSheetHtml(labels, { fmt = (v) => String(v), store = '' } = {}) {
  if (!labels || !labels.length) return '<p class="empty">Nothing to print.</p>';
  return `<div class="lbl-sheet">${labels.map((l) => `
    <div class="lbl">
      <div class="lbl-name">${escapeAttr(l.name)}</div>
      ${barcodeSvg(l.code, { height: 38, module: 2, quiet: 8 })}
      <div class="lbl-foot">
        <span class="lbl-code">${escapeAttr(l.code)}</span>
        <span class="lbl-price">${escapeAttr(fmt(l.price))}</span>
      </div>
      ${store ? `<div class="lbl-store">${escapeAttr(store)}</div>` : ''}
    </div>`).join('')}</div>`;
}
