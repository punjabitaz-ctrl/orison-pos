'use strict';

/* Orison POS — PWA bootstrap & router. Boots to Login or Register based on
   the persisted session, wires the tab bar, and reacts to connectivity. */

import { idb } from './db.js';
import { api, setSessionExpiredHandler } from './api.js';
import { syncNow, SYNC_EVENT, applyStoreFormat, outboxStats } from './sync.js';
import { inventoryAlerts } from './alerts.js';
import { screen as login } from './screens/login.js';
import { screen as register } from './screens/register.js';
import { screen as checkout } from './screens/checkout.js';
import { screen as history } from './screens/history.js';
import { screen as customers } from './screens/customers.js';
import { screen as reports } from './screens/reports.js';
import { screen as purchases } from './screens/purchases.js';
import { screen as inventory } from './screens/inventory.js';
import { screen as settings } from './screens/settings.js';
import { screen as dashboard } from './screens/dashboard.js';
import { screen as alerts } from './screens/alerts.js';
import { screen as staff } from './screens/staff.js';
import { screen as menu } from './screens/menu.js';
import { screen as audit } from './screens/audit.js';
import { screen as repairs } from './screens/repairs.js';
import { primaryTabs, menuTiles, isRestricted } from './nav.js';
import { navButton, appHeaderHtml } from './components.js';

const SCREENS = { dashboard, login, register, checkout, history, customers, reports, purchases, inventory, settings, alerts, staff, menu, audit, repairs };

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
    /* a launcher destination lights the Menu tab, because that is the button
       that got you there. */
    const barIds = primaryTabs().map((t) => t.id);
    document.querySelectorAll('[data-tab]').forEach((t) => {
      const active = t.dataset.tab === def.tab
        || (t.dataset.tab === 'menu' && !barIds.includes(def.tab));
      t.classList.toggle('on', active);
    });
    applyRoleTabs();
    const tb = document.getElementById('tabbar');
    const sb = document.getElementById('sidebar');
    const ab = document.getElementById('appbar');
    if (tb && sb) sb.classList.toggle('hidden', tb.classList.contains('hidden'));
    if (tb && ab) ab.classList.toggle('hidden', tb.classList.contains('hidden'));
    window.scrollTo(0, 0);
  },
};

function applyRoleTabs() {
  const role = (state.user || {}).role || 'cashier';
  document.querySelectorAll('#sbNav [data-tab]').forEach((t) => {
    t.classList.toggle('hidden', isRestricted(t.dataset.tab, role));
  });
}

/* Both navs are renderings of the same model, so a destination is added in
   nav.js and appears in both - never a button pasted into index.html twice. */
function renderNav() {
  const role = (state.user || {}).role || 'cashier';
  const tiles = menuTiles(role);
  const bar = document.getElementById('tabbar');
  if (bar) bar.innerHTML = primaryTabs(role).map((t) => navButton(t)).join('');
  const side = document.getElementById('sbNav');
  if (side) {
    side.innerHTML = [
      ...primaryTabs(role).filter((t) => t.id !== 'menu'),
      ...tiles,
    ].map((d) => navButton({ id: d.id, label: d.label, primary: false })).join('');
  }
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const hit = tiles.find((d) => d.id === tab.dataset.tab);
      if (hit && hit.dialog === 'external') {
        import('./screens/external-sale.js').then((m) => m.openExternalSaleDialog(ctx));
        return;
      }
      if (hit && hit.dialog) {
        import('./money-dialogs.js').then((m) => m.openCashOutDialog(ctx, hit.dialog));
        return;
      }
      router.show(hit ? hit.screen : tab.dataset.tab);
    });
  });
  refreshAlertBadge();
}

function renderHeader() {
  const bar = document.getElementById('appbar');
  if (!bar) return;
  const u = state.user || {};
  bar.innerHTML = appHeaderHtml({
    storeName: (state.store && state.store.name) || 'Orison POS',
    userName: [u.firstName, u.lastName].filter(Boolean).join(' '),
    role: u.role,
  });
  const userBtn = document.getElementById('appUser');
  if (userBtn) userBtn.addEventListener('click', () => router.show('settings'));
  tickClock();
  refreshStatus();
}

let clockTimer = null;
function tickClock() {
  const el = document.getElementById('appClock');
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (!clockTimer) clockTimer = setInterval(tickClock, 1000);
}

function refreshStatus() {
  const el = document.getElementById('appStatus');
  if (!el) return;
  const online = navigator.onLine;
  el.classList.toggle('online', online);
  el.classList.toggle('offline', !online);
  const txt = el.querySelector('.ab-status-text');
  if (txt) txt.textContent = online ? 'Online' : 'Offline';
  if (!online) return;
  outboxStats()
    .then((st) => {
      if (txt) txt.textContent = st.pending ? `${st.pending} queued` : 'Online';
    })
    .catch(() => {});
}
window.addEventListener('online', refreshStatus);
window.addEventListener('offline', refreshStatus);
window.addEventListener(SYNC_EVENT, refreshStatus);

function refreshAlertBadge() {
  idb.getAll('products')
    .then((prods) => {
      const n = inventoryAlerts(prods).length;
      /* Menu carries the count too, so a manager on a phone sees it without
         opening the launcher first. */
      document.querySelectorAll('[data-tab="alerts"] .tab-badge, [data-tab="menu"] .tab-badge').forEach((el) => {
        el.textContent = n > 99 ? '99+' : String(n);
        el.classList.toggle('hidden', n === 0);
      });
    })
    .catch(() => {});
}
window.addEventListener(SYNC_EVENT, refreshAlertBadge);

const ctx = { idb, api, state, router };

// A revoked or expired session (e.g. a lost device whose sessions an admin
// killed) invalidates the current token. Drop it, wipe the local offline
// vault (this terminal's cached sign-in credentials), and return to sign-in.
setSessionExpiredHandler(async () => {
  await api.clearToken().catch(() => {});
  const m = (await idb.get('meta', 'config').catch(() => ({}))) || {};
  delete m.offlineCreds;
  delete m.offlinePins;
  delete m.user;
  state.user = null;
  await idb.put('meta', m, 'config').catch(() => {});
  renderNav();
  renderHeader();
  if (current && current.id !== 'login') router.show('login');
});

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
  /* install the store's money format before the first screen paints, so no
     figure is ever briefly shown in the wrong currency. */
  applyStoreFormat(state.store);

  renderNav();
  renderHeader();

  // Connectivity reflex: when we come back online, catch up.
  const debounced = (() => {
    let t;
    return () => { clearTimeout(t); t = setTimeout(() => syncNow().catch(() => {}), 800); };
  })();
  window.addEventListener('online', debounced);


  window.addEventListener('orison:sync-interval', armSync);
  armSync();
  refreshOnFocus();

  await router.show(state.user ? 'register' : 'login');
}

boot().catch((err) => {
  console.error(err);
  const root = document.getElementById('screen');
  if (root) root.innerHTML = `<div class="empty"><p>Failed to boot: ${esc(err.message)}</p></div>`;
});

/* ---- Responsive state: html[data-viewport] = mobile | tablet | desktop ---- */
let viewport = 'mobile';
const viewportQueries = [
  ['desktop', '(min-width: 1024px)'],
  ['tablet', '(min-width: 720px) and (max-width: 1023px)'],
  ['mobile', '(max-width: 719px)'],
];
function trackViewport() {
  if (!('matchMedia' in window)) return;
  const apply = () => {
    const hit = viewportQueries.find(([, q]) => matchMedia(q).matches);
    const v = hit ? hit[0] : 'mobile';
    document.documentElement.dataset.viewport = v;
    if (v !== viewport) {
      viewport = v;
      window.dispatchEvent(new CustomEvent('orison:viewport', { detail: viewport }));
    }
  };
  viewportQueries.forEach(([, q]) => matchMedia(q).addEventListener('change', apply));
  apply();
}

/* ---- Desktop sidebar: icon rail vs expanded, persisted per device ---- */
function initSidebar() {
  const root = document.documentElement;
  const btn = document.getElementById('sbToggle');
  if (!btn) return;
  let nav = 'expanded';
  try { nav = localStorage.getItem('orison:nav') === 'rail' ? 'rail' : 'expanded'; } catch (_) {}
  root.dataset.nav = nav;
  btn.addEventListener('click', () => {
    nav = nav === 'expanded' ? 'rail' : 'expanded';
    root.dataset.nav = nav;
    try { localStorage.setItem('orison:nav', nav); } catch (_) {}
  });
}

trackViewport();
initSidebar();

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}