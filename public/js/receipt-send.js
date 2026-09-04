'use strict';

/* Receipt delivery: real PDF generation (no dependencies), WhatsApp and email
   handoff, native share-with-file when the platform supports it, plus a
   plain download fallback. Thermal printing stays on the register's Print
   button (CSS @media print, 72mm). */

import { esc, toast } from './ui.js';

/* --- WhatsApp / email helpers ------------------------------------------- */

// Digits only; nigerian-style leading 0 becomes +234; requires >= 10 digits.
export function normalPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0')) d = '234' + d.slice(1);
  if (d.length < 10) return null;
  return d;
}

export function whatsappLink(phone, text) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(email, subject, body) {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/* --- Minimal single-page text PDF -------------------------------------- */

const PDF_GLYPHS = {
  '\u00d7': 'x',       // multiplication sign
  '\u2212': '-', '\u2013': '-', '\u2014': '--',
  '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"',
  '\u2022': '*', '\u2026': '...', '\u2192': '->',
  '\u2713': 'OK', '\u2714': 'OK', '\u00a0': ' ',
  '\u20ac': 'EUR ', '\u00a3': 'GBP ', '\u00a5': 'JPY ',
  '\u20a6': 'NGN ', '\u20b2': 'NGN ', '\u20b9': 'INR ', '\u20a9': 'KRW ',
};

// Strip everything the Type1/Courier + PDF literal can't carry to ASCII.
function toPdfLine(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    if (Object.prototype.hasOwnProperty.call(PDF_GLYPHS, ch)) { out += PDF_GLYPHS[ch]; continue; }
    out += ch.codePointAt(0) < 128 ? ch : '?';
  }
  return out;
}

function pdfEsc(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// One A4-ish page, Courier, wrapped lines, xref-consistent output. All text
// is ASCII so byte offsets equal string lengths.
export function pdfFromLines(rawLines) {
  const W = 612;          // points (US Letter ~ 612x792)
  const H = 792;
  const M = 30;
  const n = rawLines.length || 1;
  const size = n > 26 ? 8.5 : 9;
  const lead = Math.max(9.5, Math.min(12, (H - 2 * M - 24) / n));
  const widthChars = Math.max(20, Math.floor((W - 2 * M) / (size * 0.6)));

  const wrapped = [];
  for (const raw of rawLines) {
    let s = toPdfLine(raw).replace(/\t/g, '   ');
    if (s.length > widthChars) s = s.slice(0, widthChars - 2) + '..';
    s = s.trim().length ? s : ' ';
    wrapped.push(s);
  }

  const content = ['BT', `/F1 ${size} Tf`, `${M} ${H - M - 24} Td`, `${lead} TL`];
  for (const line of wrapped) content.push(`(${pdfEsc(line)}) T*`);
  content.push('ET');
  const stream = content.join('\n') + '\n';

  let out = '';
  const offsets = [];
  const add = (s) => { offsets.push(out.length); out += s; };

  add('%PDF-1.4\n');
  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  add('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n');
  add('4 0 obj\n<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream\nendobj\n');
  add('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n');

  const xrefPos = out.length;
  add('xref\n0 6\n');
  add('0000000000 65535 f \n');
  for (let i = 1; i <= 5; i++) add(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
  add('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

  return new TextEncoder().encode(out);
}

export async function pdfBlobFromLines(lines) {
  return new Blob([pdfFromLines(lines)], { type: 'application/pdf' });
}

/* --- Sharing: PDF file share with download/clipboard fallback ------------ */

function newFile(blob, filename) {
  try { return new File([blob], filename, { type: 'application/pdf' }); } catch (_) { return null; }
}

function canShareFiles() {
  return !!navigator.canShare && !!navigator.share && typeof navigator.canShare === 'function';
}

export async function sharePdfOrDownload(blob, filename, text) {
  const file = canShareFiles() ? newFile(blob, filename) : null;
  if (file && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return 'downloaded+clip'; } catch (_) {}
  }
  return 'downloaded';
}

/* --- Mount the send UI --------------------------------------------------- */

// rc: { lines: string[], title, filename } (filename without extension)
export async function mountSendButtons(host, rc) {
  const { idb } = await import('./db.js');
  const m = (await idb.get('meta', 'config').catch(() => ({}))) || {};

  host.innerHTML = `
    <div class="receipt-send">
      <div class="rs-fields">
        <input id="rsPhone" type="tel" inputmode="tel" autocomplete="tel"
          placeholder="Customer phone · WhatsApp" value="${esc(m.lastReceiptPhone || '')}">
        <input id="rsEmail" type="email" inputmode="email" autocomplete="email"
          placeholder="customer@example.com · Email" value="${esc(m.lastReceiptEmail || '')}">
      </div>
      <div class="rs-actions">
        <button class="btn" id="rsPdf">PDF</button>
        <button class="btn" id="rsWa">WhatsApp</button>
        <button class="btn" id="rsMail">Email</button>
      </div>
    </div>`;

  const phoneEl = host.querySelector('#rsPhone');
  const emailEl = host.querySelector('#rsEmail');
  const lines = (rc.lines || []).slice();
  const text = lines.join('\n');
  const filename = rc.filename + '.pdf';

  const saveContact = async () => {
    const cfg = (await idb.get('meta', 'config').catch(() => ({}))) || {};
    cfg.lastReceiptPhone = phoneEl.value.trim();
    cfg.lastReceiptEmail = emailEl.value.trim();
    await idb.put('meta', cfg, 'config');
  };

  host.querySelector('#rsPdf').addEventListener('click', async () => {
    const r = await sharePdfOrDownload(await pdfBlobFromLines(lines), filename, text);
    if (r === 'downloaded') toast('PDF saved', 'ok');
    else if (r === 'downloaded+clip') toast('PDF saved · receipt copied', 'ok');
  });

  host.querySelector('#rsWa').addEventListener('click', async () => {
    const phone = normalPhone(phoneEl.value);
    if (!phone) { toast('Enter a valid customer phone', 'warn'); phoneEl.focus(); return; }
    await saveContact();

    const file = canShareFiles() ? newFile(await pdfBlobFromLines(lines), filename) : null;
    if (file && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: rc.title }); toast('Sending PDF via WhatsApp…', 'ok'); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    window.open(whatsappLink(phone, text), '_blank');
  });

  host.querySelector('#rsMail').addEventListener('click', async () => {
    const email = (emailEl.value || '').trim();
    if (!email) { toast('Enter a customer email', 'warn'); emailEl.focus(); return; }
    await saveContact();

    const file = canShareFiles() ? newFile(await pdfBlobFromLines(lines), filename) : null;
    if (file && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: rc.title }); toast('Sending PDF to ' + email + '…', 'ok'); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    location.href = mailtoLink(email, 'Your Orison POS receipt', text);
  });
}