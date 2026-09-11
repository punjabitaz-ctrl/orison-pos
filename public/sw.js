'use strict';

/* Orison POS service worker
   - App shell: cache-first (offline-first)
   - /api/*: never cached, network only
*/

const VERSION = 'orison-pos-v1.27.0';

const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/api.js',
  './js/sync.js',
  './js/ui.js',
  './js/alerts.js',
  './js/nav.js',
  './js/cart.js',
  './js/components.js',
  './js/money-dialogs.js',
  './js/stats.js',
  './js/labels.js',
  './js/print-sheet.js',
  './js/customer-display.js',
  './js/money.js',
  './js/receipt-send.js',
  './js/screens/login.js',
  './js/screens/register.js',
  './js/screens/checkout.js',
  './js/screens/history.js',
  './js/screens/inventory.js',
  './js/screens/settings.js',
  './js/screens/dashboard.js',
  './js/screens/alerts.js',
  './js/screens/staff.js',
  './js/screens/menu.js',
  './js/screens/audit.js',
  './js/screens/external-sale.js',
  './js/screens/inventory-tools.js',
  './js/screens/store-setup.js',
  './js/screens/customers.js',
  './js/screens/reports.js',
  './js/screens/purchases.js',
  './display.html',
  './js/display.js',
  './css/display.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache API

  /* Navigations are network-first with a cached fallback. The app is a single
     page, but display.html is its own document: falling every navigation back
     to index.html would hand an offline customer display the register. */
  if (event.request.mode === 'navigate') {
    const isDisplay = url.pathname.endsWith('/display.html');
    const shellKey = isDisplay ? './display.html' : './index.html';
    event.respondWith(
      fetch(event.request)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(shellKey, copy)); return res; })
        .catch(() => caches.match(shellKey).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(event.request, copy)).catch(() => {});
        return res;
      });
    })
  );
});