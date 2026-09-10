'use strict';

/* Customer display link — the register's side of a second-screen mirror.

   The register publishes what the shopper is allowed to see (line names,
   quantities, prices, the amount due, change) on a BroadcastChannel; the
   display page at display.html subscribes and renders it. Nothing about
   cost, margin, customer balances, staff or the till ever crosses this
   channel: what is not published cannot be shown on a screen facing the
   shop floor.

   The channel is same-origin and local to the device — no network hop — so
   the mirror keeps working with the shop offline. A last-message copy lives
   in localStorage so a display opened mid-sale paints immediately instead of
   waiting for the next keystroke, and so browsers without BroadcastChannel
   still follow along through storage events. */

import { getMoneyFormat } from './ui.js';

export const DISPLAY_CHANNEL = 'orison:display';
export const DISPLAY_STATE_KEY = 'orison:display:last';
export const DISPLAY_ENABLED_KEY = 'orison:display:on';

let channel = null;

function chan() {
  if (channel) return channel;
  try {
    if ('BroadcastChannel' in window) channel = new BroadcastChannel(DISPLAY_CHANNEL);
  } catch (_) { channel = null; }
  return channel;
}

export function displayEnabled() {
  try { return localStorage.getItem(DISPLAY_ENABLED_KEY) === '1'; } catch (_) { return false; }
}

export function setDisplayEnabled(on) {
  try { localStorage.setItem(DISPLAY_ENABLED_KEY, on ? '1' : '0'); } catch (_) {}
  if (!on) publish({ view: 'idle' });
}

/* Send one frame. Every publish also lands in localStorage, which doubles as
   the transport for browsers with no BroadcastChannel and as the snapshot a
   newly-opened display reads on boot. */
export function publish(frame) {
  if (!frame || typeof frame !== 'object') return;
  /* The display is a separate document with no session and no catalog, so it
     cannot look the store's money format up for itself — every frame carries
     it. Locale and currency are the only store facts that ever cross. */
  const msg = { ...frame, money: getMoneyFormat(), at: Date.now() };
  try { localStorage.setItem(DISPLAY_STATE_KEY, JSON.stringify(msg)); } catch (_) {}
  const c = chan();
  if (c) { try { c.postMessage(msg); } catch (_) {} }
}

function safeLines(lines) {
  return (lines || []).slice(0, 60).map((l) => ({
    name: String(l.name || 'Item'),
    qty: Number(l.qty) || 1,
    amount: Number(l.amount) || 0,
    discountPct: Number(l.discountPct) || 0,
    serial: l.serial ? String(l.serial) : '',
  }));
}

export function publishCart({ lines, total, count, store }) {
  if (!displayEnabled()) return;
  publish({
    view: (lines || []).length ? 'cart' : 'idle',
    store: store || '',
    lines: safeLines(lines),
    total: Number(total) || 0,
    count: Number(count) || 0,
  });
}

export function publishCheckout({ lines, subtotal, discount, tax, total, due, tendered, store }) {
  if (!displayEnabled()) return;
  publish({
    view: 'checkout',
    store: store || '',
    lines: safeLines(lines),
    subtotal: Number(subtotal) || 0,
    discount: Number(discount) || 0,
    tax: Number(tax) || 0,
    total: Number(total) || 0,
    due: Number(due) || 0,
    tendered: Number(tendered) || 0,
  });
}

export function publishThanks({ total, change, store }) {
  if (!displayEnabled()) return;
  publish({
    view: 'thanks',
    store: store || '',
    total: Number(total) || 0,
    change: Number(change) || 0,
  });
}

export function publishIdle(store) {
  if (!displayEnabled()) return;
  publish({ view: 'idle', store: store || '' });
}

/* Open the display. When the browser exposes the Window Management API and
   the user has granted it, the window is placed on a screen that is not the
   one the register is on — that is the whole point of a customer display. If
   permission is refused or there is only one screen, it opens as an ordinary
   window the operator can drag across, and says so. */
export async function openDisplay() {
  const url = new URL('display.html', window.location.href).href;
  const feature = (l, t, w, h) => `popup=yes,left=${Math.round(l)},top=${Math.round(t)},width=${Math.round(w)},height=${Math.round(h)}`;

  if ('getScreenDetails' in window) {
    try {
      const details = await window.getScreenDetails();
      const other = details.screens.find((s) => s !== details.currentScreen);
      if (other) {
        const win = window.open(url, 'orisonCustomerDisplay',
          feature(other.availLeft, other.availTop, other.availWidth, other.availHeight));
        if (win) {
          try { win.moveTo(other.availLeft, other.availTop); } catch (_) {}
          return { opened: true, secondScreen: true };
        }
        return { opened: false, secondScreen: false, reason: 'blocked' };
      }
      const win1 = window.open(url, 'orisonCustomerDisplay', feature(80, 80, 900, 640));
      return { opened: !!win1, secondScreen: false, reason: win1 ? 'single-screen' : 'blocked' };
    } catch (_) {
      /* permission denied or unavailable — fall through to a plain window */
    }
  }

  const win = window.open(url, 'orisonCustomerDisplay', feature(80, 80, 900, 640));
  return { opened: !!win, secondScreen: false, reason: win ? 'no-window-management' : 'blocked' };
}
