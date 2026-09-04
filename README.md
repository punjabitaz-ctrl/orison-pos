# Orison POS

A self-hosted, offline-first, mobile-first point-of-sale PWA for **Orison Electronics**. Replace Base44 per-seat POS costs with a lean, zero-cost stack and a web app cashiers install on their own phones/tablets. Works fully offline — sales are queued locally and sync when a connection returns.

## Features

- **Offline-first**: products, users, and every sale are stored in the browser (IndexedDB). Cashiers can sell with zero connectivity; completed sales sync automatically when online.
- **Sync with First-Committed-Wins**: devices reconcile against the backend. Double-selling the same IMEI is rejected; the losing device is marked **VOIDED** and its stock restored locally.
- **Serialized (IMEI) inventory**: scan or type a serial per unit. Serialized items are tracked individually through stock, sale, history, and receipt.
- **Split tender**: Cash / Store Credit / Net-30, with change calculation and quick-round keypad.
- **Receipts**: 80mm thermal-friendly print (CSS `@media print`), plus Share via Web Share API or clipboard.
- **Scanning**: HID barcode scanner via the search field, with camera barcode fallback where supported.
- **Role-gated dashboard**: admin/manager see store KPIs, a 14-day revenue chart, top sellers, low-stock alerts, and one-tap Drive export; cashiers get their own daily numbers.
- **Admin tools** (in-app): create products, adjust non-serialized stock, add serials.
- **POS lock**: staff sign in with a PIN pad.

## Stack

- **Backend**: Google Apps Script Web App backed by **Google Sheets** + **Drive**. API bridge, sync, serial tracking, and admin mutations all run server-side. Zero hosting cost.
- **Client**: Vanilla ES modules PWA — no build step. Service worker caches the shell (API is never cached).
- **Auth**: shared `APP_TOKEN` (Script Property) on every call, plus an HMAC-signed 12-hour session token issued at login.

## Setup

### 1. Deploy the backend (once, ~5 minutes)

See [`backend/README.md`](backend/README.md) for the full Apps Script deploy guide. In short:

1. Create a new Apps Script project, paste `backend/Code.gs`.
2. Add Script Properties: `APP_TOKEN` (choose a long secret) and optionally `SPREADSHEET_ID` / `FOLDER_ID`.
3. Run `setup` once (authorizes + seeds users, products, serials). Call it again later to reset the sheet to a clean seed.
4. Deploy as a **Web App** — Execute as Me, access: Anyone.
5. Copy the `/exec` URL.

### 2. Point the app at it

Serve `public/` statically anywhere (GitHub Pages, a local web server, or an intranet box). On first launch, tap **Backend** on the login screen and paste the `/exec` URL + `APP_TOKEN`. Each app install remembers it.

> After a fresh start, the old service worker may serve a cached page. Hard reload (Ctrl+Shift+R) once after updating `public/`.

## Demo logins (seeded by the backend)

| Role | Email | PIN |
| ---- | ----- | --- |
| Admin | `tariq@orisonigt.com` | `1234` |
| Manager | `sarah@orisonigt.com` | `3456` |
| Cashier | `amara@orisonigt.com` | `5678` |
| Cashier | `diego@orisonigt.com` | `9012` |

Store: **Orison Electronics — Main Street** (code `ORSTN-01`)

## Install as an app

1. Open the app URL in Chrome/Edge on the Android device.
2. Menu → **Add to Home screen** (or the browser's "Install App" prompt).
3. Launch the installed icon; it opens standalone with no browser chrome.

## Hosting at pos.orisonigt.com (Google login · worldwide · near-real-time)

The app is a static PWA, so it can live on any HTTPS host. For a subdomain
secured behind Google sign-in, see **[DEPLOY.md](DEPLOY.md)** (recommended:
Cloudflare Pages + Cloudflare Access, $0 for ≤50 users). Sales sync to the
backend **the moment they're completed when the device is online**; the
**30-minute window (configurable in Settings) is only the offline fallback**
— offline terminals queue sales and catch up on reconnect and on that window.
Set an owner device to 2–5 min for a near-live view.

## Development

```bash
# Backend logic against an in-memory mock of Apps Script (no network, fast)
npm run test:backend

# Headless-browser E2E against a deployed backend
#   $env:E2E_GAS_URL='https://…/exec';  $env:E2E_APP_TOKEN='secret'
npm run test:e2e

# Local static serve of the PWA shell (backend still comes from the /exec URL)
npm run serve   # http://127.0.0.1:8080
```

The browser E2E (tests/e2e.mjs) also runs against any same-origin backend when you host the app yourself (`E2E_BASE`). It needs a **freshly seeded** backend because it sells specific serials.

## Layout

```
backend/Code.gs      Google Apps Script backend (API bridge, sync, seed)
backend/README.md    Deploy guide for the Apps Script backend
public/index.html    PWA shell
public/js/app.js     Router/boot, tab bar, role-gated tabs, session restore
public/js/api.js     GAS transport (envelope, token, session, offline flag)
public/js/sync.js    Outbox push/pull, First-Committed-Wins + VOIDED handling
public/js/screens/*.js  login, register, checkout, history, inventory, settings, dashboard
public/css/style.css Full UI + @media print receipt mode
tests/backend-sim.mjs  Backend logic tests vs an in-memory Apps Script mock
tests/e2e.mjs          Headless-browser end-to-end test
```

## Notes / known constraints

- Auth/session data lives in each browser's IndexedDB; it is **not** shared across devices. Every device syncs to the same backend.
- The dashboard sync clock (`watermark`) is sheet-based; keep your seeded sheet as the single source of truth.
- Sheet-level writes are serialized with Apps Script `LockService` (single instance) — not built for extreme horizontal scaling.
- Admin + manager roles can create products, adjust stock, and add serials; cashiers cannot.