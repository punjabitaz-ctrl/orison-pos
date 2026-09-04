'use strict';

/* Orison POS — PWA bootstrap & router. Boots to Login or Register based on
   the persisted session, wires the tab bar, and reacts to connectivity. */

import { idb } from './db.js';
import { api } from './api.js';
import { syncNow } from './sync.js';
import { screen as login } from './screens/login.js';
import { screen as register } from './screens/register.js';
import { screen as checkout } from './screens/checkout.js';
import { screen as history } from './screens/history.js';
import { screen as inventory } from './screens/inventory.js';
import { screen as settings } from './screens/settings.js';
import { screen as dashboard } from './screens/dashboard.js';

const SCREENS = { dashboard, login, register, checkout, history, inventory, settings };

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline/unsupported */ });
  });
}

const state = {
  user: null,
  cart: new Map(),
  cartVersion: 0,
  store: null,
};

let current = null;
let cleanup = null;
let syncTimer = null;

async function armSync() {
  if (syncTimer) clearTimeout(syncTimer);
  const m = await idb.get('meta', 'config').catch(() => ({})) || {};
  const minutes = Math.max(1, Number(m.syncIntervalMin || 30) || 30);
  syncTimer = setTimeout(async () => {
    /* The periodic window is only a fallback. Online terminals already
       synced the sale at completion; offline ones catch up on the online
       event. So skip the sweep while offline. */
    if (navigator.onLine) await syncNow().catch(() => {});
    armSync();
  }, minutes * 60000);
}

function refreshOnFocus() {
  window.addEventListener('focus', () => {
    if (!navigator.onLine) return;
    idb.get('meta', 'config').then((m) => {
      const last = m && m.lastSyncAt ? new Date(m.lastSyncAt).getTime() : 0;
      if (Date.now() - last > 60000) syncNow().catch(() => {});
    }).catch(() => {});
  });
}

const router = {
  async show(name) {
    const def = SCREENS[name];
    if (!def) return;
    if (cleanup) { try { cleanup(); } catch (_) {} cleanup = null; }
    current = def;
    const root = document.getElementById('screen');
    cleanup = (await def.render(ctx, root)) || null;
    document.querySelectorAll('[data-tab]').forEach((t) => {
      t.classList.toggle('on', t.dataset.tab === def.tab);
    });
    applyRoleTabs();
    window.scrollTo(0, 0);
  },
};

function applyRoleTabs() {
  const role = (state.user || {}).role || 'cashier';
  const canManage = role === 'admin' || role === 'manager';
  document.querySelectorAll('[data-tab]').forEach((t) => {
    const restricted = t.dataset.tab === 'inventory' && !canManage;
    t.classList.toggle('hidden', restricted);
  });
}

const ctx = { idb, api, state, router };

async function boot() {
  const root = document.getElementById('screen');

  // Restore session.
  const m = await idb.get('meta', 'config');
  if (m && m.user) {
    state.user = m.user;
    state.store = m.store || null;
    // Schedule an opportunistic sync; failures are silent.
    setTimeout(() => syncNow().catch(() => {}), 600);
  }
  if (m && m.store) state.store = m.store;

  // Tab bar.
  document.getElementById('tabbar').querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => router.show(tab.dataset.tab));
  });

  // Connectivity reflex: when we come back online, catch up.
  const debounced = (() => {
    let t;
    return () => { clearTimeout(t); t = setTimeout(() => syncNow().catch(() => {}), 800); };
  })();
  window.addEventListener('online', debounced);
  window.addEventListener('offline', () => {
    const pill = document.querySelector('.scr-status');
    if (pill) { pill.classList.remove('online'); pill.classList.add('offline'); }
  });

  window.addEventListener('orison:sync-interval', armSync);
  armSync();
  refreshOnFocus();

  await router.show(state.user ? 'dashboard' : 'login');
}

boot().catch((err) => {
  console.error(err);
  const root = document.getElementById('screen');
  if (root) root.innerHTML = `<div class="empty"><p>Failed to boot: ${esc(err.message)}</p></div>`;
});

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}