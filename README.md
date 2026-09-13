# Orison POS

A self-hosted, offline-first, mobile-first point-of-sale PWA for **Orison Electronics**. It replaces per-seat Base44 POS costs with a zero-cost stack and a web app cashiers install on their own phones, tablets or desktops. It works fully offline: sales are queued locally and sync when a connection returns.

**Current version: v1.41.0.** Full history in [`CHANGELOG.md`](CHANGELOG.md); what each release means for the shop in [`RELEASE_NOTES.md`](RELEASE_NOTES.md).

## Features

### Selling

- **Register**: search by name, SKU or barcode, scan with a handheld reader or the camera, or tap a tile. The running total is pinned above the tab bar, and a cart survives a crash or refresh and is offered back on the next start.
- **Serialized (IMEI) stock**: one unit at a time, captured at sale and bound to it through history, refunds and receipts.
- **Split tender**: Cash, **Card** (recorded; kept out of the expected drawer), Store Credit and On-account (Net-30), with change and a quick-round keypad.
- **Discounts and tax**: line and order discounts, and tax on the taxable portion only. The store picks its **tax jurisdiction**: **United States** (sales tax added to prices) or **United Arab Emirates** (5 % VAT included in prices, receipts printed as a **Tax Invoice** with the shop's TRN and the customer's TRN). Discounts have per-role limits (cashier 10 %, manager 50 % by default); going over one needs a manager's approval.
- **Manager approval at the till**: a manager types their own email and PIN on the cashier's screen to approve a refund, an over-limit discount, a no-sale drawer open or a deposit refund. The cashier stays signed in.
- **Receipts**: gap-free numbers (`Orison-S000001`) allocated at sync. Print through a receipt printer, an ordinary office printer, or straight to a **Bluetooth** receipt printer. You can also send a PDF or text by WhatsApp or email.
- **Cash drawer**: opens on a cash sale through a Bluetooth printer. Managers get **Open Drawer** with a reason, and every no-sale open is audited.
- **Customer display**: a second screen mirrors the cart, totals and change due, and never shows cost, margin or customer records.
- **Sold Elsewhere**: record an online, marketplace or phone sale so stock and reports stay true.
- **Services are not refundable**, on screen or on the server.
- **Warranty**: each product carries 1 year (brand-new hardware), 30 days or none. The warranty is fixed at the moment of sale, printed on the receipt with its end date, and checkable by IMEI or receipt number.

### Repairs

- **Tickets** (`Orison-R000001`): device, reported fault, condition and accessories, with statuses from intake to collected, plus unrepairable, cancelled and voided.
- **Parts and labour**: parts come off the shelf when fitted and go back if returned or the job is closed.
- **Deposits** at intake are held as a liability, not revenue, and applied automatically when the customer collects. A manager can give one back.
- **Warranty at intake**: a device we sold is flagged on the ticket as under warranty or expired, with its original receipt.

### Money and accountability

- **Till shifts**: open with a float, close with a count in the store's own notes and coins, and see *declared / expected / over-or-short*.
- **Cash out by reason**: Paid Out, Cash Pick Up and Staff Expense are separate kinds, and each is split in reports and the export.
- **Refunds**: validated against the original sale and any earlier refunds, with stock returned, for what the customer actually paid. A cashier refunds with a manager's approval.
- **Customers**: Net-30 accounts with optional credit limits, a per-customer ledger, collections, receivables with 30/60/90+ day aging, and printable or CSV statements. Any cashier can add a customer at checkout and see what they owe before charging to account; going past a credit limit needs a manager's approval.
- **Audit log** (admin only): append-only, filterable, exportable. It covers refunds and cash-outs, stock adjustments with a reason, product and price edits, purchase orders, staff and PIN changes, sign-ins and lockouts, repairs and drawer opens.

### Stock

- **Catalog**: products and services, serialized or counted, with cost, retail, category, reorder point and a lock switch.
- **Suppliers and purchase orders**: draft → ordered → partial/received, or cancelled. Receiving posts weighted-average cost and takes serials unit by unit.
- **Price history**: every cost and retail change, with who made it, when, and why.
- **Inventory tools**:
  - bulk price update by rule, previewed before it writes
  - stock take, with variance valued at cost
  - Code 128 shelf labels
  - a reorder worksheet built from sales velocity
- **Aging and alerts**: 0–30 / 31–60 / 61–90 / 90+ day buckets, plus out-of-stock, low, locked and slow-moving items.

### Reporting and the business

- **Dashboard**: KPIs with trend chips, today by hour, and top sellers with margin. Cashiers see their own day.
- **Reports**: gross sales, refunds, cash out by reason, collections, deposits, net revenue, gross profit at the cost captured at sale, and average ticket. Broken down by day, category, cashier, tender and channel, with CSV export.
- **Scheduled reports**: daily, weekly and monthly emails to the admins you choose. Every cadence ships off.
- **Nightly backups** to a Drive folder **POS Backup**. The last 30 nights and the first of each of the last 12 months are kept.
- **History search**: find sales by receipt number, customer, item, IMEI or amount. Pages load 100 at a time, never more. Cashiers see their own sales, and can switch to *Whole shop* to look up any sale for a return or warranty check.

### Staff and security

- **Time clock**: punch in and out on your own clock, and it works offline. Managers see who is on the floor and per-cashier performance, correct a missed or wrong punch (with a reason, audited), close a shift someone left open, unlock a locked-out colleague and reset a cashier's PIN.
- **Roles**: admin, manager and cashier, enforced on the server for every privileged action. The full who-can-do-what table is in [`docs/superpowers/specs/2026-09-12-roles-and-gaps-review.md`](docs/superpowers/specs/2026-09-12-roles-and-gaps-review.md).
- **Sign-in**: a PIN pad. Five wrong PINs lock the account for 15 minutes.
- **Sessions**: signed and revocable per person or per terminal.
- **Strict CSP**: no third-party code. See [`SECURITY.md`](SECURITY.md).

### Languages and currencies

- **English, العربية, اردو**: pick on the sign-in screen or per terminal in Settings. Arabic and Urdu lay the whole app out right to left. Receipts and the customer display follow the store's language.
- **18 currencies**, each with its real notes and coins for counting a drawer, chosen by the first admin at setup.

### Works everywhere

- **Offline-first**: products, users and every sale live in IndexedDB. A server-issued offline credential keeps a terminal selling while the network is down.
- **First-Committed-Wins sync**: the same IMEI sold twice is settled on the server. The losing sale is marked **VOIDED** and logged for a manager to review.
- **Phone, tablet and desktop layouts**: three thumb-sized tabs on a phone, and a sidebar with a live cart panel on a desktop.

## Stack

- **Backend**: a single-file Google Apps Script Web App (`backend/Code.gs`) backed by **Google Sheets** and **Drive**. Zero hosting cost.
- **Client**: vanilla ES modules PWA with no build step. A service worker caches the shell; the API is never cached.
- **Auth**: a shared `APP_TOKEN` (Script Property) on every call, an HMAC-signed 12-hour session token issued at login, and a server-issued offline credential.

## Setup

### 1. Deploy the backend (once, ~5 minutes)

See [`backend/README.md`](backend/README.md) for the full guide. In short:

1. Create an Apps Script project and paste `backend/Code.gs`.
2. Add Script Properties: `APP_TOKEN` (a long secret), and optionally `SPREADSHEET_ID` / `FOLDER_ID`.
3. Run `setup` once. It authorizes and seeds users, products and serials. It refuses to re-seed a workbook that already has transactions.
4. Run `installBackupTrigger()` and `installReportTriggers()` once each. Backups and scheduled reports do not start until you do.
5. Deploy as a **Web App**: Execute as **Me**, access **Anyone**. Copy the `/exec` URL.

### 2. Point the app at it

Serve `public/` statically. Cloudflare Pages is the documented target (see [`DEPLOY.md`](DEPLOY.md)): **Connect to Git** → repo → branch `main` → preset **None**, build command *empty*, output directory **`public`**. On first launch, tap **Backend** on the login screen and paste the `/exec` URL and `APP_TOKEN`. Each install remembers it.

### 3. First run

The first admin picks the shop's **language, country and currency**. Then:

- Change every seeded PIN.
- Add real staff under Settings.
- Set scheduled-report recipients if you want them.
- Set up the printer per terminal under **Settings → Printer & cash drawer**.

> After an update, an old service worker may serve a cached page. Hard reload (Ctrl+Shift+R) once.

## Starter logins (seeded by the backend)

The backend seeds four accounts on its first run and generates a **random 6-digit PIN for each**, written to the execution log. Apps Script keeps that log, so treat these as first-day credentials: hand them out, then have everyone change theirs. The `Users` sheet only holds a salted hash.

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

Add real staff from **Settings → Staff** (admin) and deactivate the `@example.com` placeholders there. Existing accounts cannot yet be edited in the app; change a name or email in the `Users` sheet. Staff change their own PIN in **Settings → Change PIN** (`POST /api/pin`).

Five wrong PINs lock an account for 15 minutes from the most recent failure. To release it sooner:

- An admin or manager can release it with `POST /api/admin/unlock`. There is no button for this in the app yet.
- Or run `clearLoginLockout("someone@example.com")` in the Apps Script editor.

An admin resets a forgotten PIN from **Settings → Staff** (`POST /api/admin/pin`), which also clears the lockout. If the workbook itself is lost, restore a copy from Drive → **POS Backup**; the full recovery path is in [`SECURITY.md`](SECURITY.md#pins).

The counter is per account, because Apps Script does not expose the caller's address. So someone who knows a staff email can keep that account locked. The unlock exists so a shift is never blocked waiting on the script editor.

Store: **Orison Electronics — Main Street** (code `ORSTN-01`)

## Install as an app

- **Android / Chrome**: menu **⋮ → Install app**.
- **iPhone / iPad**: **Share → Add to Home Screen**, in Safari.
- **Windows / Mac**: the install icon in the address bar.

The installed app opens full screen and keeps selling with no internet. Bluetooth printing needs Chrome or Edge, and is not available on iPhone or iPad.

## Hosting at pos.orisonigt.com

The app is a static PWA, so any HTTPS host works. For a subdomain behind Google sign-in, see **[DEPLOY.md](DEPLOY.md)** (Cloudflare Pages + Access, $0 for ≤50 users). Sales sync **the moment they are completed when the device is online**. The **30-minute window** in Settings is only the offline fallback.

## Development

```bash
npm test              # backend logic vs an in-memory Apps Script mock (886 checks)
npm run test:client   # client unit tests via node:test + fake-indexeddb (482 checks)
npm run test:e2e      # headless E2E against a live, freshly seeded backend (skips without one)
npm run test:pdf      # receipt PDF/share smoke test in a headless browser
npm run test:all      # all four
npm run serve         # static serve of public/ at http://127.0.0.1:8080
```

E2E needs `E2E_GAS_URL`, `E2E_APP_TOKEN`, `E2E_PIN` and `E2E_CASHIER_PIN`. The PINs come from the execution log; without them the suite skips rather than failing.

## Layout

```
backend/Code.gs                Apps Script backend (~6,000 lines): API, sync, repairs, reports, backups, audit
backend/README.md              Backend deploy guide, routes and sheet tabs
public/index.html              PWA shell            public/display.html  customer display
public/sw.js                   Service worker: VERSION bumped every release; SHELL precaches every module
public/css/style.css           UI, RTL via logical properties, @media print receipt modes
public/js/app.js               Boot, router, session restore, language
public/js/api.js               /exec transport (envelope, token, session, per-call timeouts)
public/js/db.js  sync.js       IndexedDB layer; outbox push/pull, First-Committed-Wins, VOIDED handling
public/js/cart.js              Cart persistence and availability
public/js/money.js  stats.js   Money math, refund builders; shared aggregation
public/js/nav.js  components.js  Navigation model and role gating; shared screen markup
public/js/lang.js  lang/*.js   Translation ($t, plurals, RTL) and the Arabic / Urdu catalogues
public/js/receipt-doc.js       One receipt model   receipt-render.js  roll, page and image renderers
public/js/printer.js  escpos.js  printing.js  Printer decisions, ESC/POS bytes, browser wiring
public/js/receipt-send.js      Receipt PDF, WhatsApp and email
public/js/screens/*.js         login menu register checkout history customers repairs reports purchases
                               inventory inventory-tools external-sale alerts dashboard staff audit
                               settings printer-settings store-setup
tests/backend-sim.mjs          Backend suite
tests/client-*.mjs             Client suites, including the translation-catalogue check
tests/e2e.mjs  tests/pdf-send-smoke.mjs
docs/superpowers/              Design specs, release plans and reviews
docs/handout/                  Client-facing feature list and setup guide
```

## Releases stay in lockstep

One feature = one validated revision = one git tag. Every release bumps `public/sw.js` `VERSION` and `package.json`, adds to `CHANGELOG.md` and `RELEASE_NOTES.md`, and keeps README / DEPLOY / SECURITY / the backend guide / `HANDOVER.md` current. [`AGENTS.md`](AGENTS.md) is the protocol; [`HANDOVER.md`](HANDOVER.md) is the living state snapshot.

## Notes / known constraints

- Auth and session data live in each browser's IndexedDB and are **not** shared across devices. Every device syncs to the same backend.
- Sheet writes are serialized with Apps Script `LockService`. That is fine for one store or a few; it is not built for heavy scale.
- **Roles, in short**:
  - **Cashiers**: sell, run their own shift and clock, and handle repairs. They add customers, see a customer's balance at checkout and look up any sale in the shop. With a manager's approval they also refund, give over-limit discounts, charge past a credit limit, open the drawer without a sale and give deposits back.
  - **Managers**: add refunds, cash out, customers, ledgers and credit limits, products and stock, purchase orders, reports, conflict review, approvals at the till, lockout release, cashier PIN resets, punch corrections and closing forgotten shifts.
  - **Admins alone**: staff, PINs, terminals, store settings, suppliers, bulk pricing, stock takes, PO cancellation, repair voids, backups, scheduled reports and the audit log.
- Still English by design: CSV column headers, the Sheets workbook and report emails.
- After any release, terminals pick up the new shell on next load.
