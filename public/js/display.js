'use strict';

/* Customer-facing display. Subscribes to the register's BroadcastChannel and
   paints big, legible type for the person on the other side of the counter.
   It is a pure renderer: it never talks to the backend, never reads the
   catalog, and shows only what the register chose to publish. */

import { DISPLAY_CHANNEL, DISPLAY_STATE_KEY } from './customer-display.js';

const root = document.getElementById('cd');
const IDLE_AFTER_THANKS_MS = 45000;

/* The register tells the display which currency the shop trades in; until a
   frame arrives, nothing is on screen to mis-format. */
let money = { locale: 'en-US', currency: 'USD' };
let formatter = null;

function useMoney(next) {
  if (!next || (next.locale === money.locale && next.currency === money.currency)) return;
  money = { locale: next.locale || money.locale, currency: next.currency || money.currency };
  formatter = null;
}

function fmt(n) {
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(money.locale, { style: 'currency', currency: money.currency });
    } catch (_) {
      formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    }
  }
  return formatter.format(Number(n) || 0);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function storeName(frame) {
  return esc((frame && frame.store) || 'Orison Electronics');
}

function renderIdle(frame) {
  return `
    <div class="cd-idle">
      <div class="cd-brand">${storeName(frame)}</div>
      <p>Welcome — we'll ring you up in a moment.</p>
    </div>`;
}

function lineRows(frame) {
  const lines = (frame.lines || []);
  if (!lines.length) return '<div class="cd-empty">Your basket is empty</div>';
  return `<div class="cd-lines">${lines.map((l) => `
    <div class="cd-line">
      <div class="cd-line-main">
        <span class="cd-name">${esc(l.name)}</span>
        ${l.serial ? `<span class="cd-serial">${esc(l.serial)}</span>` : ''}
        ${l.discountPct ? `<span class="cd-disc">${esc(String(l.discountPct))}% off</span>` : ''}
      </div>
      <span class="cd-qty">${l.qty > 1 ? '×' + esc(String(l.qty)) : ''}</span>
      <span class="cd-amt">${fmt(l.amount)}</span>
    </div>`).join('')}</div>`;
}

function renderCart(frame) {
  return `
    <header class="cd-head"><span>${storeName(frame)}</span><span class="cd-count">${frame.count || 0} item${frame.count === 1 ? '' : 's'}</span></header>
    ${lineRows(frame)}
    <footer class="cd-foot">
      <span>Total</span>
      <strong>${fmt(frame.total)}</strong>
    </footer>`;
}

function renderCheckout(frame) {
  const due = Number(frame.due) || 0;
  return `
    <header class="cd-head"><span>${storeName(frame)}</span><span class="cd-count">Checkout</span></header>
    ${lineRows(frame)}
    <div class="cd-break">
      <div><span>Subtotal</span><b>${fmt(frame.subtotal)}</b></div>
      ${Number(frame.discount) > 0 ? `<div><span>Discount</span><b class="cd-neg">−${fmt(frame.discount)}</b></div>` : ''}
      ${Number(frame.tax) > 0 ? `<div><span>Tax</span><b>${fmt(frame.tax)}</b></div>` : ''}
      ${Number(frame.tendered) > 0 ? `<div><span>Paid</span><b>${fmt(frame.tendered)}</b></div>` : ''}
    </div>
    <footer class="cd-foot ${due > 0 ? 'cd-due' : 'cd-clear'}">
      <span>${due > 0 ? 'Amount due' : 'Total'}</span>
      <strong>${fmt(due > 0 ? due : frame.total)}</strong>
    </footer>`;
}

function renderThanks(frame) {
  return `
    <div class="cd-thanks">
      <div class="cd-tick" aria-hidden="true">✓</div>
      <div class="cd-brand">Thank you!</div>
      <p>${storeName(frame)}</p>
      <div class="cd-totals">
        <div><span>Paid</span><b>${fmt(frame.total)}</b></div>
        ${Number(frame.change) > 0 ? `<div><span>Change</span><b>${fmt(frame.change)}</b></div>` : ''}
      </div>
    </div>`;
}

let idleTimer = null;

function paint(frame) {
  if (!frame || !root) return;
  useMoney(frame.money);
  clearTimeout(idleTimer);
  const view = frame.view || 'idle';
  root.dataset.view = view;
  if (view === 'cart') root.innerHTML = renderCart(frame);
  else if (view === 'checkout') root.innerHTML = renderCheckout(frame);
  else if (view === 'thanks') {
    root.innerHTML = renderThanks(frame);
    idleTimer = setTimeout(() => paint({ view: 'idle', store: frame.store }), IDLE_AFTER_THANKS_MS);
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
paint(readLast() || { view: 'idle' });

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
