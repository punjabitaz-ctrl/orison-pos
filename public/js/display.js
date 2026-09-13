'use strict';

/* Customer-facing display. Subscribes to the register's BroadcastChannel and
   paints big, legible type for the person on the other side of the counter.
   It is a pure renderer: it never talks to the backend, never reads the
   catalog, and shows only what the register chose to publish. */

import { DISPLAY_CHANNEL, DISPLAY_STATE_KEY } from './customer-display.js';
import { tIn, tnIn, ensureLoaded, dirOf } from './lang.js';

/* The language the customer reads: the store's, carried on every frame. */
let lang = 'en';

const root = document.getElementById('cd');
const IDLE_AFTER_THANKS_MS = 45000;
/* A register tab that closes mid-sale leaves the last frame on the customer
   screen indefinitely. Anything older than this is treated as idle, so a
   shopper never reads somebody else's basket. */
const STALE_FRAME_MS = 3 * 60 * 1000;

/* The register tells the display which currency the shop trades in; until a
   frame arrives, nothing is on screen to mis-format. */
let money = { locale: 'en-US', currency: 'USD' };
let formatter = null;

function useMoney(next) {
  if (!next || (next.locale === money.locale && next.currency === money.currency)) return;
  money = { locale: next.locale || money.locale, currency: next.currency || money.currency };
  formatter = null;
}

/* `sign` sits inside the isolate so a discount reads "−$5.00" in Arabic too. */
function fmt(n, sign = '') {
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(money.locale, { style: 'currency', currency: money.currency });
    } catch (_) {
      formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    }
  }
  const s = sign + formatter.format(Number(n) || 0);
  return document.documentElement.dir === 'rtl' ? '\u2066' + s + '\u2069' : s;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function storeName(frame) {
  return esc((frame && frame.store) || tIn(lang, 'Orison Electronics'));
}

function renderIdle(frame) {
  return `
    <div class="cd-idle">
      <div class="cd-brand">${storeName(frame)}</div>
      <p>${esc(tIn(lang, 'Welcome — we’ll ring you up in a moment.'))}</p>
    </div>`;
}

function lineRows(frame) {
  const lines = (frame.lines || []);
  if (!lines.length) return `<div class="cd-empty">${esc(tIn(lang, 'Your basket is empty'))}</div>`;
  return `<div class="cd-lines">${lines.map((l) => `
    <div class="cd-line">
      <div class="cd-line-main">
        <span class="cd-name">${esc(l.name)}</span>
        ${l.serial ? `<span class="cd-serial">${esc(l.serial)}</span>` : ''}
        ${l.discountPct ? `<span class="cd-disc">${esc(tIn(lang, '{pct}% off', { pct: l.discountPct }))}</span>` : ''}
      </div>
      <span class="cd-qty">${l.qty > 1 ? '×' + esc(String(l.qty)) : ''}</span>
      <span class="cd-amt">${fmt(l.amount)}</span>
    </div>`).join('')}</div>`;
}

function renderCart(frame) {
  return `
    <header class="cd-head"><span>${storeName(frame)}</span><span class="cd-count">${esc(tnIn(lang, '{n} item', '{n} items', frame.count || 0))}</span></header>
    ${lineRows(frame)}
    <footer class="cd-foot">
      <span>${esc(tIn(lang, 'Total'))}</span>
      <strong>${fmt(frame.total)}</strong>
    </footer>`;
}

function renderCheckout(frame) {
  const due = Number(frame.due) || 0;
  return `
    <header class="cd-head"><span>${storeName(frame)}</span><span class="cd-count">${esc(tIn(lang, 'Checkout'))}</span></header>
    ${lineRows(frame)}
    <div class="cd-break">
      <div><span>${esc(tIn(lang, 'Subtotal'))}</span><b>${fmt(frame.subtotal)}</b></div>
      ${Number(frame.discount) > 0 ? `<div><span>${esc(tIn(lang, 'Discount'))}</span><b class="cd-neg">${fmt(frame.discount, '−')}</b></div>` : ''}
      ${Number(frame.tax) > 0 ? `<div><span>${esc(tIn(lang, 'Tax'))}</span><b>${fmt(frame.tax)}</b></div>` : ''}
      ${Number(frame.tendered) > 0 ? `<div><span>${esc(tIn(lang, 'Paid'))}</span><b>${fmt(frame.tendered)}</b></div>` : ''}
    </div>
    <footer class="cd-foot ${due > 0 ? 'cd-due' : 'cd-clear'}">
      <span>${esc(due > 0 ? tIn(lang, 'Amount due') : tIn(lang, 'Total'))}</span>
      <strong>${fmt(due > 0 ? due : frame.total)}</strong>
    </footer>`;
}

function renderThanks(frame) {
  return `
    <div class="cd-thanks">
      <div class="cd-tick" aria-hidden="true">✓</div>
      <div class="cd-brand">${esc(tIn(lang, 'Thank you!'))}</div>
      <p>${storeName(frame)}</p>
      <div class="cd-totals">
        <div><span>${esc(tIn(lang, 'Paid'))}</span><b>${fmt(frame.total)}</b></div>
        ${Number(frame.change) > 0 ? `<div><span>${esc(tIn(lang, 'Change'))}</span><b>${fmt(frame.change)}</b></div>` : ''}
      </div>
    </div>`;
}

let idleTimer = null;

async function paint(frame) {
  if (!frame || !root) return;
  useMoney(frame.money);
  const next = frame.lang || lang;
  if (await ensureLoaded(next) || next === 'en') {
    lang = next;
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
  }
  clearTimeout(idleTimer);
  const view = frame.view || 'idle';
  root.dataset.view = view;
  if (view === 'cart') root.innerHTML = renderCart(frame);
  else if (view === 'checkout') root.innerHTML = renderCheckout(frame);
  else if (view === 'thanks') {
    root.innerHTML = renderThanks(frame);
    idleTimer = setTimeout(() => paint({ view: 'idle', store: frame.store, lang: frame.lang }), IDLE_AFTER_THANKS_MS);
  } else root.innerHTML = renderIdle(frame);
}

function readLast() {
  try {
    const raw = localStorage.getItem(DISPLAY_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

/* Paint whatever the register last published, so a display opened mid-sale is
   correct immediately rather than blank until the next tap. */
function freshOrIdle(frame) {
  if (!frame) return { view: 'idle' };
  const age = Date.now() - (Number(frame.at) || 0);
  return age > STALE_FRAME_MS ? { view: 'idle', store: frame.store, lang: frame.lang } : frame;
}

paint(freshOrIdle(readLast()));

/* And keep checking: a display left open after the register closed should fall
   back to the welcome screen on its own. */
setInterval(() => {
  const last = readLast();
  if (!last || root.dataset.view === 'idle') return;
  if (Date.now() - (Number(last.at) || 0) > STALE_FRAME_MS) paint({ view: 'idle', store: last.store, lang: last.lang });
}, 30000);

try {
  if ('BroadcastChannel' in window) {
    const bc = new BroadcastChannel(DISPLAY_CHANNEL);
    bc.onmessage = (e) => paint(e.data);
  }
} catch (_) { /* fall back to storage events below */ }

/* Storage events fire in other tabs of the same origin: the fallback path for
   browsers without BroadcastChannel, and harmless duplication where both work. */
window.addEventListener('storage', (e) => {
  if (e.key !== DISPLAY_STATE_KEY || !e.newValue) return;
  try { paint(JSON.parse(e.newValue)); } catch (_) {}
});
