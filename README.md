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

Serve `public/` statically anywhere (GitHub Pages, Cloudflare Pages — see
[`DEPLOY.md`](DEPLOY.md) — a local web server, or an intranet box). Cloudflare
Pages is one click: **Connect to Git** → repo → branch `main` → Framework
preset **None**, build command *empty*, output directory **`public`** → you're
live on `*.pages.dev` with free TLS in a minute. On first launch of the PWA,
tap **Backend** on the login screen and paste the `/exec` URL + `APP_TOKEN`.
Each app install remembers it.

> After a fresh start, the old service worker may serve a cached page. Hard reload (Ctrl+Shift+R) once after updating `public/`.

## Starter logins (seeded by the backend)

The backend seeds four accounts on its first run and generates a **random
6-digit PIN for each**, and writes them to the execution log. Apps Script keeps
that log, so treat these as first-day credentials rather than lasting ones —
hand them out, then have everyone change theirs. The `Users` sheet itself only
ever holds a salted hash. To read them:

1. In the Apps Script editor, open **View > Executions**.
2. Open the first execution (the one that created the workbook).
3. The log lists each address with its PIN:

   ```
   [orison-pos] seeded users - record these PINs now, they are not recoverable:
   [orison-pos]   tariq@example.com  PIN 481902  (admin)
   ...
   ```

| Role | Email |
| ---- | ----- |
| Admin | `tariq@example.com` |
| Manager | `sarah@example.com` |
| Cashier | `amara@example.com` |
| Cashier | `diego@example.com` |

Hand each person their PIN, then edit the `Users` sheet to replace the
`@example.com` placeholders with real addresses. Staff change their own PIN with
`POST /api/pin` (`{ "currentPin": "...", "newPin": "..." }`) — which is how the
logged starter PINs stop being usable.

Login is throttled: five wrong PINs lock that account for 15 minutes, measured
from the most recent failure. An admin or manager can release it from the till
(`POST /api/admin/unlock` with `{ "email": "someone@example.com" }`), or you can
run `clearLoginLockout("someone@example.com")` from the Apps Script editor.

An admin can also reset a forgotten PIN from the app (`POST /api/admin/pin` with
`{ "email": "...", "pin": "246813" }`), which clears any lockout at the same
time. That is also the recovery path if the workbook is ever recreated: doing so
reseeds the starter accounts with fresh random PINs, and the only record of them
is that run's execution log.

Note the tradeoff: because the counter is per-account and Apps Script does not
expose the caller's address, someone who knows a staff email can keep that
account locked by failing against it repeatedly. The unlock endpoint exists so
a shift is never blocked waiting on the script editor.

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
# Backend logic against an in-memory mock of Apps Script (no network, fast).
# This is what `npm test` runs — it needs nothing external.
npm test          # same as: npm run test:backend

# Headless-browser E2E against a deployed backend. Needs the deployment URL and
# token, plus the two PINs — they are generated per deployment and never
# committed, so read them from the execution log (see Starter logins above).
#   $env:E2E_GAS_URL='https://…/exec';  $env:E2E_APP_TOKEN='secret'
#   $env:E2E_PIN='481902';              $env:E2E_CASHIER_PIN='730155'
# Without E2E_PIN and E2E_CASHIER_PIN this suite skips rather than failing.
npm run test:e2e

# Both suites together
npm run test:all

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