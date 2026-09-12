'use strict';

/* ESC/POS — the command language of receipt printers.

   Pure byte building, no I/O, so every command can be tested exactly. Two ways
   to put a receipt on paper:

   - Text. Fast and small, but a printer maps bytes to glyphs through its own
     code page, so only plain ASCII prints reliably across models. `£`, `€`,
     `₨`, `د.إ` and any Arabic or Urdu would come out as garbage.
   - Raster. The receipt is drawn to a canvas and sent as a 1-bit image, which
     prints any script and any symbol on any ESC/POS printer. Slower over
     Bluetooth, so it is used only when text would not be faithful.

   printer.js decides which, using isPlainAscii(). */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const INIT = Uint8Array.of(ESC, 0x40);
export const CUT = Uint8Array.of(GS, 0x56, 0x42, 0x03);

/* A tall image in one GS v 0 command overruns the buffer on many cheap
   printers; bands of this many rows are safe everywhere. */
export const RASTER_BAND = 200;

const align = (n) => Uint8Array.of(ESC, 0x61, n);
const bold = (on) => Uint8Array.of(ESC, 0x45, on ? 1 : 0);
const size = (n) => Uint8Array.of(GS, 0x21, n);
const feed = (n) => Uint8Array.of(ESC, 0x64, n);

/* ESC p m t1 t2: pulse the drawer connector. Pin 2 is m=0, pin 5 is m=1.
   25 x 2ms on, 250 x 2ms off is the pulse drawers expect. */
export function drawerKick(pin = 2) {
  return Uint8Array.of(ESC, 0x70, Number(pin) === 5 ? 1 : 0, 0x19, 0xfa);
}

export function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function chunk(bytes, size = 180) {
  const out = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
  return out;
}

function textBytes(s) {
  const str = String(s);
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    out[i] = c < 128 ? c : 0x3f; /* '?' - only reached if isPlainAscii was ignored */
  }
  return out;
}

const line = (s) => concat(textBytes(s), Uint8Array.of(LF));

/* Wrap `left` to the width and put `right` flush right on its last line, or on
   a line of its own when there is no room. */
export function columns(left, right, cols) {
  const words = String(left || '').split(/\s+/).filter(Boolean);
  const rows = [];
  let cur = '';
  for (const w of words) {
    let word = w;
    while (word.length > cols) {
      if (cur) { rows.push(cur); cur = ''; }
      rows.push(word.slice(0, cols));
      word = word.slice(cols);
    }
    if (!cur) cur = word;
    else if ((cur + ' ' + word).length <= cols) cur += ' ' + word;
    else { rows.push(cur); cur = word; }
  }
  if (cur || !rows.length) rows.push(cur);

  const r = String(right || '');
  if (!r) return rows.join('\n');
  const last = rows[rows.length - 1];
  if (last.length + 1 + r.length <= cols) {
    rows[rows.length - 1] = last + ' '.repeat(cols - last.length - r.length) + r;
  } else {
    rows.push(' '.repeat(Math.max(0, cols - r.length)) + r);
  }
  return rows.join('\n');
}

/* Every string the receipt would print, formatted amounts included. */
function printedStrings(doc, fmt) {
  const out = [doc.brand, doc.store, doc.reference, doc.changeLabel, doc.pendingLabel, ...doc.meta, ...doc.footer];
  for (const l of doc.lines) out.push(l.name, fmt(l.amount), fmt(l.unitPrice));
  for (const t of doc.totals) out.push(t.label, fmt(t.amount));
  for (const t of doc.tenders) out.push(t.label, fmt(t.amount));
  out.push(fmt(doc.change));
  return out;
}

export function isPlainAscii(doc, fmt) {
  // eslint-disable-next-line no-control-regex
  return printedStrings(doc, fmt).every((s) => /^[\x20-\x7e]*$/.test(String(s == null ? '' : s)));
}

export function escposFromDoc(doc, cols, fmt, opts = {}) {
  const rule = line('-'.repeat(cols));
  const parts = [INIT];
  if (opts.kick) parts.push(drawerKick(opts.kick));

  parts.push(align(1), bold(true), size(0x11), line(doc.brand), size(0), bold(false));
  if (doc.store) parts.push(line(doc.store));
  for (const m of doc.meta) parts.push(line(m));
  parts.push(align(0), rule);

  for (const l of doc.lines) {
    parts.push(line(columns(l.name, fmt(l.amount), cols)));
    const detail = [];
    if (l.qty > 1) detail.push(`${l.qty} x ${fmt(l.unitPrice)}`);
    if (l.discountPct) detail.push(`${l.discountPct}% off`);
    if (detail.length) parts.push(line('  ' + detail.join(', ')));
  }
  parts.push(rule);

  for (const t of doc.totals) {
    const label = t.key === 'tax' && t.rate ? `${t.label} (${t.rate}%)` : t.label;
    if (t.strong) parts.push(bold(true));
    parts.push(line(columns(label, fmt(t.amount), cols)));
    if (t.strong) parts.push(bold(false));
  }
  for (const td of doc.tenders) parts.push(line(columns(td.label, fmt(td.amount), cols)));
  if (doc.change > 0) parts.push(line(columns(doc.changeLabel, fmt(doc.change), cols)));

  parts.push(rule, align(1));
  for (const f of doc.footer) parts.push(line(f));
  parts.push(line(doc.reference));
  if (doc.pending) parts.push(line(doc.pendingLabel));
  parts.push(align(0), feed(3), CUT);
  return concat(...parts);
}

/* 1-bit, most significant bit first, dark = 1. Transparent is paper. */
export function packBits(rgba, width, height, threshold = 160) {
  const rowBytes = Math.ceil(width / 8);
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3] < 128) continue;
      const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      if (lum < threshold) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

/* GS v 0 m xL xH yL yH d...  in bands of RASTER_BAND rows. */
export function rasterImage(bits, width, height) {
  const rowBytes = Math.ceil(width / 8);
  const parts = [];
  for (let y = 0; y < height; y += RASTER_BAND) {
    const h = Math.min(RASTER_BAND, height - y);
    parts.push(Uint8Array.of(GS, 0x76, 0x30, 0x00,
      rowBytes & 0xff, (rowBytes >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff));
    parts.push(bits.subarray(y * rowBytes, (y + h) * rowBytes));
  }
  return concat(...parts);
}

export function escposRaster(bits, width, height, opts = {}) {
  const parts = [INIT];
  if (opts.kick) parts.push(drawerKick(opts.kick));
  parts.push(align(1), rasterImage(bits, width, height), feed(3), CUT);
  return concat(...parts);
}
