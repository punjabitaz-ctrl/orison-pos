# Orison POS

A self-hosted, offline-first, mobile-first point-of-sale PWA for **Orison Electronics**. Replace Base44 per-seat POS costs with a lean server you run in-store, and a web app cashiers install on their own phones/tablets. Works fully offline — sales are queued locally and sync when a connection returns.

## Features

- **Offline-first**: products, users, and every sale are stored in the browser (IndexedDB). Cashiers can sell with zero connectivity; completed sales sync automatically when online.
- **Sync with First-Committed-Wins**: synchronized devices reconcile against the SQLite server. Double-selling the same IMEI is rejected; the losing device is marked **VOIDED** and its stock restored locally.
- **Serialized (IMEI) inventory**: scan or type a serial per unit. Serialized items are tracked individually through stock, sale, history, and receipt.
- **Split tender**: Cash / Store Credit / Net-30, with change calculation and quick-round keypad.
- **Receipts**: 80mm thermal-friendly print (CSS `@media print`), plus Share via Web Share API or clipboard.
- **Scanning**: HID barcode scanner via the search field, with camera barcode fallback where supported.
- **Admin tools** (in-app): create products, adjust non-serialized stock, add serials.
- **POS lock**: staff sign in with a PIN pad (hashed at rest/PIN forward).

## Stack

- **Server**: Node.js, Fastify, better-sqlite3 (single-file SQLite at `data/orison.db`).
- **Client**: Vanilla ES modules PWA — no build step. Service worker caches the shell (API is never cached).
- **Auth**: server-issued HMAC bearer token for the session; PIN stored as an scrypt hash server-side.

## Setup

```bash
npm install
npm start
```

The server listens on `0.0.0.0:8080` and **auto-seeds** a demo catalog + users on first boot. Open `http://<your-server-LAN-ip>:8080` from any phone/tablet on the same network.

> On Windows after a fresh start, the service worker may be served from the old page. Do a hard reload (Ctrl+Shift+R) once after updating `public/`.

### Demo logins (auto-seeded)

| Role | Email | PIN |
| ---- | ----- | --- |
| Admin | `tariq@orisonigt.com` | `1234` |
| Cashier | `amara@orisonigt.com` | `5678` |
| Cashier | `diego@orisonigt.com` | `9012` |

Store name: **Orison Electronics — Main Street**

> To start clean (drop the demo sales/serials), delete `data/orison.db` and restart — it reseeds.

## Install as an app

1. Open the server URL in Chrome/Edge on the Android device.
2. Menu → **Add to Home screen** (or the browser's "Install App" prompt).
3. Launch the installed icon once offline-verified; it opens standalone with no browser chrome.

## Development

```bash
# Run an end-to-end test against a fresh DB (drive real headless Edge)
node tests/e2e.mjs

# Smoke-test the admin API routes
powershell -File tests/admin-smoke.ps1
```

Both tests assume a freshly-seeded server is already running on `http://127.0.0.1:8080`, and they mutate the DB (deleting `data/orison.db` and reseeding is recommended between runs).

## Layout

```
server/index.js      Entry: Fastify, static serve, auto-seed, HMAC auth
server/routes.js     All API + sync logic (auth gate, commitTransaction, admin)
server/db.js         Schema, PIN scrypt hash/verify, secret management
server/seed.js       Demo catalog, users, serialized IMEI stock
public/index.html    PWA shell
public/js/app.js     Router/boot, tab bar, session restore
public/js/sync.js    Outbox push/pull, First-Committed-Wins + VOIDED handling
public/js/screens/*.js  login, register, checkout, history, inventory, settings
public/css/style.css Full UI + @media print receipt mode
tests/e2e.mjs        Headless-browser end-to-end test
tests/admin-smoke.ps1 Admin route smoke test
```

## Notes / known constraints

- Auth/session data lives in your browser's IndexedDB; it is **not** shared across devices. Each device syncs to the same server DB.
- The server is single-instance and single-file (SQLite); it is not built for horizontal scaling.
- Admin capability (create products, adjust stock, add serials) requires an `admin` role login.