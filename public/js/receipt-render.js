'use strict';

/* Turn a receipt model (receipt-doc.js) into something a printer takes:
   roll HTML for the print dialog, a full page for an office printer, or a
   canvas image for a Bluetooth printer's raster mode. Direction-aware, so a
   right-to-left receipt mirrors its columns rather than just its words. */

import { esc } from './ui.js';

function detailOf(l, fmt) {
  const bits = [];
  if (l.qty > 1) bits.push(`${l.qty} × ${fmt(l.unitPrice)}`);
  if (l.discountPct) bits.push(`${l.discountPct}%`);
  return bits.join(' · ');
}

function totalLabel(t) {
  return t.key === 'tax' && t.rate ? `${t.label} (${t.rate}%)` : t.label;
}

function titleOf(doc) {
  return doc.title ? String(doc.title) : '';
}

export function rollHtml(doc, fmt) {
  const dir = doc.dir === 'rtl' ? 'rtl' : 'ltr';
  return `
    <div class="receipt" dir="${dir}">
      <h1>${esc(doc.brand)}</h1>
      ${doc.store ? `<p class="r-store">${esc(doc.store)}</p>` : ''}
      ${titleOf(doc) ? `<p class="r-title">${esc(titleOf(doc))}</p>` : ''}
      ${doc.meta.map((m) => `<p class="r-mid">${esc(m)}</p>`).join('')}
      <div class="r-rule"></div>
      ${doc.lines.map((l) => {
    const d = detailOf(l, fmt);
    return `<div class="r-line"><span>${esc(l.name)}${d ? ` <em>${esc(d)}</em>` : ''}</span><b>${esc(fmt(l.amount))}</b></div>`;
  }).join('')}
      <div class="r-rule"></div>
      ${doc.totals.map((t) => `<div class="r-line${t.strong ? ' total' : ''}"><span>${esc(totalLabel(t))}</span><b>${esc(fmt(t.amount))}</b></div>`).join('')}
      ${doc.tenders.map((t) => `<div class="r-line"><span>${esc(t.label)}</span><b>${esc(fmt(t.amount))}</b></div>`).join('')}
      ${doc.change > 0 ? `<div class="r-line"><span>${esc(doc.changeLabel)}</span><b>${esc(fmt(doc.change))}</b></div>` : ''}
      <div class="r-rule"></div>
      ${doc.footer.map((f) => `<p class="r-mid">${esc(f)}</p>`).join('')}
      <p class="r-mid small">${esc(doc.reference)}</p>
      ${doc.pending ? `<p class="r-mid small">${esc(doc.pendingLabel)}</p>` : ''}
    </div>`;
}

/* Plain lines, for sharing a receipt as text or a PDF from the same model. */
export function docToLines(doc, fmt) {
  const lines = [doc.brand];
  if (doc.store) lines.push(doc.store);
  if (titleOf(doc)) lines.push(titleOf(doc));
  lines.push(...doc.meta, '—');
  for (const l of doc.lines) lines.push(`${l.name}${l.qty > 1 ? ` x${l.qty}` : ''} — ${fmt(l.amount)}`);
  lines.push('—');
  for (const t of doc.totals) lines.push(`${totalLabel(t)} — ${fmt(t.amount)}`);
  for (const t of doc.tenders) lines.push(`${t.label} — ${fmt(t.amount)}`);
  if (doc.change > 0) lines.push(`${doc.changeLabel} — ${fmt(doc.change)}`);
  lines.push(...doc.footer, doc.reference);
  if (doc.pending) lines.push(doc.pendingLabel);
  return lines;
}

/* A full page for an ordinary printer: the same receipt, laid out as an
   invoice-style table. Styled by print-sheet.js's sheet CSS. */
export function sheetHtml(doc, fmt) {
  const dir = doc.dir === 'rtl' ? 'rtl' : 'ltr';
  const cols = doc.columns || { qty: 'Qty', price: 'Price', amount: 'Amount' };
  const rows = doc.lines.map((l) => `
    <tr>
      <td>${esc(l.name)}${l.discountPct ? `<div class="muted">${esc(l.discountPct)}%</div>` : ''}</td>
      <td class="num">${esc(l.qty)}</td>
      <td class="num">${esc(fmt(l.unitPrice))}</td>
      <td class="num">${esc(fmt(l.amount))}</td>
    </tr>`).join('');
  const totals = doc.totals.map((t) => `
    <tr${t.strong ? ' class="strong"' : ''}><td colspan="3">${esc(totalLabel(t))}</td><td class="num">${esc(fmt(t.amount))}</td></tr>`).join('');
  const tenders = doc.tenders.map((t) => `
    <tr><td colspan="3">${esc(t.label)}</td><td class="num">${esc(fmt(t.amount))}</td></tr>`).join('');
  return `
    <div dir="${dir}">
      <p><strong>${esc(doc.brand)}</strong>${doc.store ? ` · ${esc(doc.store)}` : ''}</p>
      ${titleOf(doc) ? `<h2>${esc(titleOf(doc))}</h2>` : ''}
      ${doc.meta.map((m) => `<p class="muted">${esc(m)}</p>`).join('')}
      <table>
        <thead><tr><th></th><th class="num">${esc(cols.qty)}</th><th class="num">${esc(cols.price)}</th><th class="num">${esc(cols.amount)}</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>${totals}${tenders}${doc.change > 0 ? `<tr><td colspan="3">${esc(doc.changeLabel)}</td><td class="num">${esc(fmt(doc.change))}</td></tr>` : ''}</tfoot>
      </table>
      <p>${doc.footer.map((f) => esc(f)).join('<br>')}</p>
      <p class="muted">${esc(doc.reference)}${doc.pending ? ` · ${esc(doc.pendingLabel)}` : ''}</p>
    </div>`;
}

/* ---------- raster ---------- */

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Arabic", Tahoma, sans-serif';

function wrap(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const rows = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !cur) cur = next;
    else { rows.push(cur); cur = w; }
  }
  if (cur || !rows.length) rows.push(cur);
  return rows;
}

/* Draw the receipt at the printer's width in dots and return its pixels. Run
   twice: once to measure the height, once to draw. */
export function docToImage(doc, width, fmt) {
  const rtl = doc.dir === 'rtl';
  const pad = Math.round(width * 0.02);
  const inner = width - pad * 2;
  const base = width >= 576 ? 24 : 20;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const ops = [];
  let y = pad;
  const text = (s, { size = base, weight = 400, align = 'start', lh = 1.35 } = {}) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    for (const row of wrap(ctx, s, inner)) {
      ops.push({ kind: 'text', s: row, size, weight, align, y: y + size });
      y += Math.round(size * lh);
    }
  };
  const pair = (left, right, { size = base, weight = 400 } = {}) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const rw = ctx.measureText(right).width;
    const rows = wrap(ctx, left, inner - rw - size);
    rows.forEach((row, i) => {
      ops.push({ kind: 'text', s: row, size, weight, align: 'start', y: y + size });
      if (i === rows.length - 1) ops.push({ kind: 'text', s: right, size, weight, align: 'end', y: y + size });
      y += Math.round(size * 1.35);
    });
  };
  const rule = () => { y += Math.round(base * 0.4); ops.push({ kind: 'rule', y }); y += Math.round(base * 0.6); };

  text(doc.brand, { size: Math.round(base * 1.35), weight: 800, align: 'center' });
  if (doc.store) text(doc.store, { align: 'center' });
  if (titleOf(doc)) text(titleOf(doc), { size: Math.round(base * 1.1), weight: 800, align: 'center' });
  for (const m of doc.meta) text(m, { size: Math.round(base * 0.85), align: 'center' });
  rule();
  for (const l of doc.lines) {
    pair(l.name, fmt(l.amount));
    const d = detailOf(l, fmt);
    if (d) text(d, { size: Math.round(base * 0.8) });
  }
  rule();
  for (const t of doc.totals) pair(totalLabel(t), fmt(t.amount), t.strong ? { size: Math.round(base * 1.15), weight: 800 } : {});
  for (const t of doc.tenders) pair(t.label, fmt(t.amount));
  if (doc.change > 0) pair(doc.changeLabel, fmt(doc.change));
  rule();
  for (const f of doc.footer) text(f, { align: 'center' });
  text(doc.reference, { size: Math.round(base * 0.85), align: 'center' });
  if (doc.pending) text(doc.pendingLabel, { size: Math.round(base * 0.8), align: 'center' });
  y += pad;

  canvas.width = width;
  canvas.height = Math.max(1, Math.ceil(y));
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.direction = rtl ? 'rtl' : 'ltr';

  for (const op of ops) {
    if (op.kind === 'rule') {
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad, op.y);
      ctx.lineTo(width - pad, op.y);
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    ctx.font = `${op.weight} ${op.size}px ${FONT}`;
    /* 'start' and 'end' follow ctx.direction, so an RTL receipt puts the item
       on the right and the amount on the left without a second code path. */
    if (op.align === 'center') { ctx.textAlign = 'center'; ctx.fillText(op.s, width / 2, op.y); }
    else if (op.align === 'end') { ctx.textAlign = 'end'; ctx.fillText(op.s, rtl ? pad : width - pad, op.y); }
    else { ctx.textAlign = 'start'; ctx.fillText(op.s, rtl ? width - pad : pad, op.y); }
  }

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: img.width, height: img.height, data: img.data };
}
