# Orison POS — Project Handover

Living handover for another AI agent (or human) to take over this project.
**Read this first**, then `AGENTS.md` (release protocol), then `README.md` /
`SECURITY.md` / `DEPLOY.md` / `backend/README.md` as needed. Git history is the
record of truth; every feature is one tagged revision.

---

## 1. State snapshot

| | |
|---|---|
| Project | Offline-first, mobile-first point-of-sale PWA for **Orison Electronics** |
| Repo | `github.com/punjabitaz-ctrl/orison-pos` (`main`, all releases tagged) |
| Current version | **v1.30.0** — the remaining open items (`2026-09-11`) |
| Validation bar | `backend-sim` **PASS 583 / FAIL 0** · client units **PASS 350 / FAIL 0** · `node --check` clean · **pdf-smoke UNRUN** — see §6 |
| Backend | Single-file Google Apps Script Web App on Sheets + Drive (`backend/Code.gs`, ~5,110 lines) |
| Frontend | Vanilla ES modules PWA, no build step (`public/`), service-worker cached shell + a second-screen `display.html` |
| Node | ≥ 20 (dev/test only) |

## 2. Mission & context

Replace the per-seat Base44 POS for a single electronics store with a
zero-cost stack: a web app staff install on their own phones/tablets, an Apps
Script backend (free), Sheets as the store of truth, Drive for exports. Sales
must work with zero connectivity: everything is queued locally and synced
First-Committed-Wins. Serials/IMEIs are the high-value stock and sold per-unit.

## 3. Architecture

```
Terminal PWA (vanilla JS + IndexedDB + SW cache)
     │  POST /exec {action, method, params, payload, appToken, session}
     ▼
Apps Script doPost → dispatch_(action) → handler (LockService-guarded writes)
     │                    Google Sheets tabs · Drive export · CacheService
     ▼
Sync: pull (products/users/store/watermark/openConflicts) + push (FCW)
Money: integer-cents engine server-side; client figures are advisory.
Auth:  shared APP_TOKEN + HMAC-SHA256 session token (12 h, uid claim)
       + server-issued offline credential for no-network terminals.
```

Hosting: static PWA on Cloudflare Pages (or GitHub Pages); backend is an Apps
Script Web App gated by APP_TOKEN (see `DEPLOY.md`).

## 4. Feature inventory (by version — all validated + tagged)

- **v1.0.x** Core register: catalog (IndexedDB), cart, split tender, receipts
  (print/share/clipboard), serial-checkout.
- **v1.2.x** Security hardening: salted PIN hashes, session tokens +
  per-user/per-device revocation, login lockout (5 fails → 15 min), offline
  credentials (opaque server-issued key, PIN never stored client-side), CSP +
  no inline scripts, conflict registry + review, role-gated UI.
- **v1.3.x** Admin: create products/users, add serials, inventory adjust,
  store config; history screen with sync states + refunds.
- **v1.4.0** Money model upgrade: integer-cents engine, discounts (line +
  order %), stored tax basis.
- **v1.4.1** Customers: accounts, net-30 tenders, per-customer ledger,
  collections, receivables, 30/60/90+ aging.
- **v1.5.0** Till shifts: open/close with denomination count, *declared /
  expected / over-short* per cashier.
- **v1.6.0** Reports & analytics: `/api/reports` KPIs, by day/category/cashier/
  tender, top products/customers, GP from live costs, CSV export.
- **v1.7.0** Suppliers & purchase orders: vendor records, PO lifecycle
  (draft → ordered → partial/received → cancelled), receiving that posts stock
  with weighted-average cost + per-unit serial intake + `purchase` ledger
  trail.
- **v1.8.0** Price history & tracking: every cost/retail change recorded per
  product — `create` baseline, `patch` on manual edit (no-op quiet), `po` on
  weighted-cost receipt (tagged with PO number) — written atomically beside the
  product update and browsable from Products 📈 via `/api/price-history`.
- **v1.9.0** Customer statements: chronological debit/credit statement of
  account with running balance (sales on account debit; store-credit refunds
  and collections credit) via `/api/customers/statement`, closing exactly on
  the ledger balance; printed on 80 mm thermal or exported to CSV (formula-
  injection guard) from Customers → ledger → *Statement*.
- **v1.10.0** Inventory aging: how long on-hand stock has been sitting —
  clock starts at product creation and re-sets on every PO receipt (its
  `PriceHistory` timestamp); buckets 0–30/31–60/61–90/90+ with units + value
  at cost via `/api/inventory/aging`, viewed read-only from Products → *Aging*
  (serialized stock counted from `IN_STOCK` serials).
- **v1.11.0** Offline sync hardening: **VOIDED re-pushes are re-evaluated**
  (a failed sale is retried fresh and a success **rewrites the failure in
  place** — same transaction id, never a duplicate row); same-batch
  `clientTxId` duplicates resolve like re-pushes; refunds see sale + prior
  refunds **within the same batch**; gross profit uses the **cost captured at
  sale time** (`unitCost`) instead of the live editing cost, and refunds carry
  the original's captured cost; `byCategory`/`byProduct` apply line + order
  discounts in cents; reports + Drive export bucket by the **store's local
  calendar day** (`store_tz_offset`, minutes via `adminStore_`); every
  read+validate for PO receiving, suppliers, products/serials, and shift
  open/close is **inside the script lock**; `round2_` is sign-safe
  half-away-from-zero; `uuid_()` dead code removed; payouts/payments/refunds
  attribute to the authenticated cashier; first-run seed is crash-safe against
  a partial seed.
- **v1.12.0** Client unit test harness: **154 `node:test` checks** for the
  register-side layer — `money.js` (rounding/drift, discounts/tax, refund +
  payout builders), `sync.js` (enqueue→push→SYNCED, offline short-circuit,
  rejected→VOIDED + local stock restore, unique clientTxIds, outboxStats/
  getSyncState, SYNC_EVENT), `db.js` (CRUD, bulkPut + keyFn, by_upc/by_sku/
  by_category indexes, meta upsert, open() singleton), `alerts.js` (available,
  reorderThreshold, inventoryAlerts severity sort + aging suppression,
  agingBucket, bucketLabel), `ui.js` (fmt, fmtQty, esc, debounce). Loaded via a
  browser-globals shim (`tests/helpers/setup-globals.mjs`: fake-indexeddb,
  window/navigator/document stubs, event-recording dispatchEvent, fetch-mock
  harness shaped like the api.js envelope). `npm run test:client` wired into
  `test:all`; the only new dependency is `fake-indexeddb`. Documents two
  float-drift facts of the client `round2` (`±1.005 → ±1`) that the
  sign-safe backend `round2_` does not share — a future money alignment target.
- **v1.13.0** Theme polish + responsive shell: layered softer shadows
  (`--shadow`/`--shadow-sm`/`--shadow-lg`), `--ease` motion curve, `--dur`
  transitions, stronger header blur/saturation, 14px search radius + focus
  ring, 40px chip targets, card hover lift, `:focus-visible` outlines,
  tabular-numeral money alignment. **Desktop (≥1024px):** toggleable sidebar
  replaces the bottom tabbar (240px expanded ↔ 64px icon rail, hamburger,
  persisted in `localStorage` `orison:nav`, role-gated tabs + alerts badge
  shared with the tabbar); boot now binds nav clicks on **all** `[data-tab]`
  elements (both navs); `html[data-viewport]` = mobile/tablet/desktop via
  `matchMedia` + `orison:viewport` event (bug: first paint on mobile skipped
  the attribute because the default coincidentally matched — the attribute is
  now set unconditionally); **dual-panel register** (sticky 440px embedded
  cart right, shared `bindCart` renderer, sheet path untouched below 1024);
  checkout renders as a right-anchored 440px sheet column (`root` gains
  `screen-checkout` class, cleaned up on leave); detail/edit sheets slide in
  from the right. **Fixed:** alerts `tab-badge` toggled a non-existent `.show`
  class so it never rendered — now toggles `.hidden`.
- **v1.30.0** The remaining `HANDOVER` §10 items, and the end of the
  operational-readiness program. **Fixed:** `/api/config` handed the staff
  roster to every role (with the account lockout, one cashier could lock out the
  shop) — now manager/admin only; **time-clock punches queue offline** through
  the outbox carrying the moment they happened and are sent before the sale
  batch; the **customer display goes idle** after a 3-minute-old frame rather
  than showing a stale basket forever; **per-call timeouts** (60s for reports,
  exports, backups, audit, reorder) so a slow report is not reported as
  "offline". 9 new sim checks.
- **v1.29.0** Card tender. A card sale previously had to be rung as cash, so it
  inflated the expected drawer and closed every shift short by the card total.
  **Card** is now a tender (recorded, not authorised) and is excluded from the
  drawer in both directions. **Fixed:** the export's `NET CASH` netted by
  *kind*, so store-credit and on-account sales counted as cash — a new
  **`CASH IN DRAWER`** line nets by *tender* and is the figure that reconciles
  against a physical count; `NET CASH` left unchanged for comparability.
  9 new sim checks. ⚠️ **v1.28.0 (drawer + thermal printer) is PARKED** pending
  the hardware model — the version number is deliberately unused.
- **v1.27.0** Sales made elsewhere. `channel` + `external_ref` on every
  transaction (`in_store` default, `online`, `marketplace`, `phone`, `other`;
  unknown values fall back to `in_store`). **Sold Elsewhere** launcher dialog
  (manager/admin) records a marketplace sale against the same stock with IMEI
  capture, using `cart.js` availability so it cannot claim a unit an open till
  sale holds. Reports gain `byChannel`; the order reference and channel are
  searchable. 13 new sim checks including that the counter refuses a unit the
  marketplace already took. **Not** a marketplace API integration — someone
  still types it in.
- **v1.26.0** Scheduled reports. `/api/reports/schedule` (admin only) sets
  recipients and per-cadence on/off, reports last-sent times, and can send one
  immediately. Three time-driven triggers (daily 06:00, weekly, monthly) via
  **`installReportTriggers()`** — ⚠️ **run it once or nothing is ever sent**.
  Each report covers the period that just closed; figures come from `reports_()`
  so a mailed report and the Reports screen cannot disagree. All cadences
  default **off**. A failing send logs `report.failed` rather than throwing out
  of the trigger. Settings panel with recipients, toggles and Send-one-now.
  23 new sim checks.
- **v1.25.0** Never load more than 100. `/api/transactions` hard-capped at
  **100** (was 500) with **keyset paging** on `created_at` via `cursor`, plus
  **server-side search** (`q`) across receipt number, client id, customer,
  cashier, item name, serial/IMEI, note, kind and exact amount, and `from`/`to`
  bounds. History gained a search box, match count and Load-100-more. **The
  dashboard stopped slabbing the ledger**: today's KPIs/hourly page through
  today (bounded 10 pages) and the 14-day chart + 30-day top sellers now come
  from `/api/reports` — uncapped and discount-accurate. 14 new sim checks
  including a 2,198-row ledger.
- **v1.24.0** Backups. Nightly Apps Script trigger at 02:00 copies the whole
  workbook to a Drive folder **`POS Backup`** as
  `Orison-POS-Backup_YYYY-MM-DD_HHmm.xlsx` in store-local time; 30 nightly + 12
  monthly retained. `backupDaily()` never throws (a throwing trigger stops being
  scheduled) — a failure emails every admin, logs `backup.failed`, and shows in
  Settings. `/api/backup/status` + `/api/backup/run` are admin only.
  ⚠️ **Run `installBackupTrigger()` once from the Apps Script editor** or no
  backup ever runs. **Fixed:** `setup` would re-seed a live workbook and destroy
  its history; it now refuses when transactions exist unless `CONFIRM_RESEED`
  is `yes`. 18 new sim checks.
- **v1.23.0** Management is admin only. `adminBulkPrice_`, `adminStockTake_`,
  `suppliers_` and `purchaseOrderCancel_` moved from admin+manager to
  **admin**; Stock take and Bulk price hidden from Products → Tools for
  managers. Managers keep the daily trade (refunds, cash out, products,
  serials, stock adjust, POs create/receive, reports, customers, conflicts).
  ⚠️ Takes powers away from existing managers — warn staff before deploying.
  17 new sim checks; four existing supplier/PO tests updated from manager to
  admin because they asserted the old rule.
- **v1.22.0** Receipt numbers + audit log. Gap-free `Orison-S000001` series:
  counter in `Meta`, advanced **inside the same lock that appends the
  transaction**, allocated **at sync** (an offline terminal cannot know the next
  number, so its receipt says "pending sync" and repaints when the push lands).
  Only sales and refunds are numbered — internal cash movements and VOIDED rows
  never take one, which is what keeps the series gap-free. New **`AuditLog`**
  sheet + `/api/audit` (**admin only**, append-only, 100/page with cursor) and an
  Audit screen with filters and CSV export. 18 new sim checks.
- **v1.21.0** No sale is lost — first of the operational-readiness program.
  New **`public/js/cart.js`** owns the cart: availability is **derived**
  (`serverOnHand − quantityInCart`) instead of mutating the catalog mirror, and
  the cart persists to IndexedDB on every change, offered back on boot with
  Resume/Discard. Fixes two live bugs: a crash used to lose stock permanently
  (units came off the mirror and only an explicit remove put them back), and a
  `pull()` mid-cart drifted the figures under the open cart. `lineRemove()` and
  `inCartSerial()` deleted — both only undid mutations that no longer happen.
  24 new client checks.
- **v1.20.0** Shared components sweep — closes the last interface-v2 item.
  `screenHead`, `sectionHead`, `statRow`, `rankRow`, `rankList` and `dataTable`
  added to `components.js`; all 12 screens use `screenHead`, and
  staff/dashboard/reports/inventory-tools use the rest (9 rank rows, 6 tables,
  3 stat rows, 4 section heads consolidated). Each component escapes text by
  default with an explicit `*Html` field for composed markup. Adds the permanent
  **"An AYiN Advisors Project"** footer to the shell and the customer display.
- **v1.19.0** Three money-out kinds — last of the interface-v2 releases.
  **`pickup`** (cash pick-up) and **`expense`** (staff expense) join `payout`;
  `processPayout_` generalised to `processCashOut_(…, kind)` behind a new
  `isCashOutKind_()`, which `shiftClose_`, `transactions_` GP and the ledger
  labels now ask instead of testing for `payout` by name. `reports_` gains
  `pickups`/`expenses`/`cashOut` and nets all three out of `netRevenue`; the
  Drive export gains **CASH PICK-UP** and **STAFF EXPENSE** lines and NET CASH
  subtracts all three. Client: `createCashOut({kind,…})` (with `createPayout`
  kept as a wrapper), `kindInfo` entries, three launcher tiles each with its own
  icon and dialog wording, `dayTotals()` splitting the reasons, and the
  dashboard's **Cash out** KPI with the three-way split.
  **Compatibility:** legacy `payout` rows are untouched and nothing migrates;
  an older shell can only send `payout`, which still works.
  ⚠️ **Deploy the backend first** — a new shell can send kinds an old backend
  would reject.
- **v1.18.0** Sell & checkout — second of the three interface-v2 releases.
  **Pinned cart bar** on phones/tablets (count, running total, Charge) so the
  total is never out of sight; adding an item no longer opens a sheet over the
  catalog, and the cart sheet is only re-rendered while already open. Desktop's
  side panel is unchanged. `catColor`, `categoryChip`, `productTile` and
  `cartBar` moved into `components.js` (18 checks); `inventory.js` lost its
  duplicate `catColor`. Product tiles gained a two-line name clamp and clearer
  badges; chips carry the category colour. Checkout collapses its line list,
  promotes **Amount due** to the largest figure, and leaves one primary action.
  **Fixed a live bug: the ✕ on a cart line had never worked** — the handler read
  `data-key` while the button carries `data-remove`, and `lineRemove()` restored
  stock without deleting the line. **Departure from the spec:** out-of-stock
  tiles are dimmed but still tappable, so the toast can say why.
- **v1.17.0** Shell & navigation — first of three releases from
  `docs/superpowers/specs/2026-09-10-pos-interface-v2-design.md`. New
  **`nav.js`** holds the navigation model (`primaryTabs`, `menuTiles(role)`,
  `isRestricted`) and **`components.js`** renders it (`tile`, `tileGrid`,
  `navButton`, `appHeaderHtml`, `ICONS`); both navs are now renderings of that
  one model, so `index.html` lost ~100 lines of duplicated SVG and a
  destination is added in one line. **Three-item bottom bar** (Menu · Sell ·
  History) replaces the ten-item scrolling strip, Menu being the primary
  control and carrying the alert badge. New **launcher** screen (`menu`): one
  flat grid, no headings, no nesting, 10 tiles for a manager and 3 for a
  cashier. New **app header** (store, live clock, one connectivity indicator
  with queued count, user chip). `openPayoutModal` moved out of `dashboard.js`
  into **`money-dialogs.js`** so the Paid Out tile opens Paid Out. The app now
  **opens on Sell**. **Fixed:** at ≥1024px a bare `#appbar` became a column
  beside the sidebar — header and screen now share a `.main` column.
  **Removed:** the v1.14.0 tabbar scroll rules and `scrollIntoView`, and the
  dead `.scr-status` rules. 37 new unit checks in `tests/client-nav.mjs`.
- **v1.16.0** Store localisation & multi-currency: `getStore_()` carries
  **`locale` / `country` / `currency` / `denoms` / `configured`**; admin-only
  `/api/admin/store` validates and writes any subset of them (every field
  optional — it used to reset the sales tax on any call); `/api/config` serves
  the **currency catalogue** so the client can't offer what the server would
  reject. **First-run setup dialog** (`screens/store-setup.js`) asks the first
  admin on an unconfigured store for language, country and currency, with a
  live price sample and that currency's cash ladder; re-openable from Settings.
  `ui.js` gained `setMoneyFormat`/`getMoneyFormat`/`currencySymbol`/
  `denomLabel` — `fmt(n)` keeps its shape but formats through the store, and
  boot/login/pull all install it. **Fixed:** the till counted a hard-coded ₦
  ladder whatever the store traded in (now the store's own, in integer cents,
  ignoring notes it does not hold), and the payout/collections dialogs were
  labelled ₦ regardless. **Known limitation:** the locale drives formatting;
  interface copy is still English (see §10).
- **v1.15.1** Post-review hardening (see §10 for what is still open):
  **CSP `connect-src` now allows `script.googleusercontent.com`** — an Apps
  Script `/exec` answers with a redirect there and CSP applies to every hop, so
  the old policy blocked every API call on any host that honours `_headers`
  (Cloudflare Pages does; GitHub Pages ignores it, which is why nobody hit it);
  **prototype-shaped keys no longer corrupt data** — a category or tender named
  `__proto__` used to drop its line from the report, `constructor` wrote onto a
  shared built-in, and an IMEI reading `constructor`/`toString` was **silently
  discarded as a duplicate** by `adminSerials_` (all such maps are now
  `Object.create(null)`; the new assertions fail against the old code);
  **`adminInventory_` + `adminProductsPatch_` read under the lock** (completing
  the v1.11.0 sweep — their guards and the price-history "old value" could
  describe a row another terminal had replaced); **`constantEquals_`** now
  backs both the session MAC and the PIN hash check (the latter was `!==`); and
  **dialogs are keyboard-usable** — Escape closes the top-most one, focus moves
  in on open (never on touch, where it would throw up the keyboard), and panels
  are marked `aria-modal`.
- **v1.15.0** Customer display + inventory tools: **`display.html`** mirrors
  the cart / checkout / thank-you on a shopper-facing second screen over a
  same-origin `BroadcastChannel` (`customer-display.js` publishes; the display
  is publish-only, holds no session and calls no API — cost, margin, customer
  and till figures are absent from the frame by construction). Settings →
  *Customer display* toggles mirroring per terminal and opens the window on a
  second screen via the Window Management API where granted. **Products →
  Tools** menu adds: **bulk price update** (`/api/admin/products/bulk-price` —
  the client sends a *rule*, the server recomputes under the lock; `preview`
  writes nothing; changes recorded as source `bulk`), **stock take**
  (`/api/admin/stock-take` → new **`StockTakes`** sheet, read+write in one
  lock, serialized/service refused, one bad line rolls back the count),
  **barcode labels** (`labels.js` Code 128-B encoder — no third-party script;
  25 unit checks verify the pattern table symbol by symbol), and the
  **reorder worksheet** (`/api/inventory/reorder` — velocity net of refunds,
  days of cover, suggested qty, last supplier; print or CSV).
  `print-sheet.js` prints sheets in their own window so the 80mm receipt page
  geometry is untouched. **Security:** shared `csvCell()`/`csvRows()` in
  `ui.js` now formula-guard **and** quote every client CSV (closed
  acknowledged weakness #4; the statement export had the opposite bug —
  guarded but unquoted, so a comma shifted columns), and the service worker no
  longer falls an offline `display.html` back to the register app.
- **v1.14.0** Screen refresh + dashboard context + staff tools: new
  **`TimeClock`** sheet with `/api/timeclock` + `/api/timeclock/punch` (own
  clock only, one OPEN entry per account, closed in place with elapsed
  minutes); new **Staff** screen (own clock + hours + punches + shift history
  for everyone; *On the floor*, *Team performance* over today/7/30 days with
  hours and sales-per-hour, and the till-reconciliation table for
  managers/admins); dashboard **trend chips** (vs yesterday, vs 7-day average),
  **Today by hour** chart across the trading window with the busiest hour
  named, **top sellers as a table** (units/revenue/margin %), and a **shift
  strip** (open now / closed today / over-short today). New pure module
  **`public/js/stats.js`** owns all of that aggregation (36 unit checks in
  `tests/client-stats.mjs`). `ui.js` gained `skeleton()` + `emptyState()`.
  **Security:** `/api/shifts?status=all` let any cashier read every till
  reconciliation — the escape hatch is gone and the roster is
  `isStoreRole_`-gated. **Fixed:** 44px touch targets everywhere; the bottom
  tab bar now scrolls (64px tabs) rather than shaving targets across ten
  destinations, and the active tab scrolls into view; KPI grid is 2/3/4 columns
  by width so the trend line fits on a phone.
- **v1.7.1** Post-review hardening: **refunds now admin/manager-only**;
  role changes revoke sessions immediately; Drive export no longer counts
  purchase receipts as SALES and nets collections as money-in (`COLLECTIONS`
  line); dashboard 14-day chart nets payments the same way; `config_()` hides
  deactivated users; **service worker versioned v1.7.1** and precaching the
  customers/reports/purchases screens (un-sticks installed terminals frozen at
  v1.2.0); `package.json` version synced + `test:pdf` wired into `test:all`;
  all docs in lockstep.

## 5. Data model — Sheets tabs

`Meta` (kv) · `Users` · `Products` · `Serials` (`AVAILABLE`/`SOLD`/`VOIDED`) ·
`Transactions` · `Conflicts` · `Devices` · `Customers` · `Shifts` ·
`Suppliers` · `PurchaseOrders` · `PriceHistory` · `TimeClock` · `StockTakes`.

Ledger kinds: `sale` (incl. legacy `''`), `refund`, `payout`, `payment`
(= collection, money-in), `purchase` (PO receipt — must never count as sales
anywhere). Every money kind has a `requireRole_` gate: payout/payment/refund =
admin/manager.

## 6. Validation & test map

- `tests/backend-sim.mjs` — the contract. In-memory mock of Apps Script
  (`SpreadsheetApp`/`LockService`/`DriveApp`/`CacheService`/`PropertiesService`)
  runs `Code.gs` in `node:vm`. **583 checks**: auth, throttle, FCW serial conflicts,
  refund guards, payouts, customer ledger/aging, shifts, reports/GP/export,
  PO receive math, role gates, the time clock (punch toggle, 409 guards,
  cashier-scoped reads, the `?status=all` shift-roster fix), and the v1.15.0
  inventory tools (reorder velocity/cover/suggestion, bulk-price preview vs
  apply + validation + price-history trail, stock-take variance/value/rollback),
  and the v1.15.1 review fixes (prototype-shaped categories/tenders/serials,
  the guards that now read under the lock).
- `tests/client-*.mjs` — pure-Node client unit tests (`node:test` +
  `fake-indexeddb`, browser-globs shim in `tests/helpers/setup-globals.mjs`).
  **350 checks**: money math (`round2`/`cents`/`clampPct`/`saleTotals`/`kindInfo`),
  refund/payout builders against an IDB-backed mock, outbox enqueue/push/
  VOIDED-rollback/offline paths, db CRUD + indexes, alerts classification/buckets,
  ui `fmt`/`esc`/`debounce`/`csvCell`/`emptyState`/`skeleton`, (v1.15.0)
  `labels.js` — the Code 128-B pattern table symbol by symbol, the modulo-103
  check symbol, bar/space alternation, escaping and the label cap — and
  (v1.14.0) `stats.js` — day totals by kind,
  signed net, trends against a zero/negative baseline, baseline averages that
  exclude their own day, hourly buckets + trading window, top sellers/margin,
  hours from open and closed punches.
- `tests/pdf-send-smoke.mjs` — real headless browser, receipt PDF/share.
  **⚠ UNRUN since the v1.18.0 gate.** Edge refuses to launch headless on this
  machine (`Failed to launch the browser process: Code: 0`), including against
  a clean temp profile, so every release from v1.19.0 onward shipped with this
  gate reported as *not run* rather than as a pass. The receipt-PDF path is
  otherwise unchanged across those releases, but it is untested — **re-run it
  on a machine where Edge or Chrome will launch headless before treating the
  receipt path as validated.**
- `tests/e2e.mjs` — online happy path only; **skips without a live backend**;
  offline toggle, queue-then-reconnect sync, refunds, customers, reports, and
  purchases are NOT e2e-tested. Biggest remaining test gap.
- Sim `LockService` always grants the lock → concurrency bugs invisible to CI.

## 7. Security posture (posture = good, with documented gaps)

Strong: constant-time token verify; salted hashes; per-user **and** per-device
revocation that survives cache expiry; lockout that avoids the script lock;
strict CSP + no inline scripts; `esc()` coverage client-side; server-side
CSV-cell formula guard; every privileged route gated (refunds now included).

Acknowledged gaps (tracked in `SECURITY.md` → "Acknowledged weaknesses"):
client-trusted price/quantity/tenders (offline-first necessity); lost-terminal
offline window; shared APP_TOKEN; client CSV not formula-prefixed; prototype-
key risk in `reports_`; account-based lockout DoS; single-round SHA-256 PINs.

## 8. Review outcomes (the full review, what's fixed vs deferred)

A complete code / process / scope / UX / security review was run at v1.7.0.
Status of every finding class:

**Fixed in v1.7.1** (with sim coverage):
- CRITICAL — refunds had no role check (cashier could reverse any sale). → admin/manager-only, UI hidden for cashiers.
- HIGH — purchase receipts counted as SALES in the Drive export. → excluded from SALES/NET CASH (detail rows remain).
- HIGH/MED — `kind: payment` lumped into export SALES, and the dashboard 14-day chart subtracted collections. → `COLLECTIONS` line, net cash = sales − refunds − payouts + collections; chart nets payments as money-in.
- HIGH — role demotion left old admin tokens valid up to 12 h. → revoke sessions on any role change.
- HIGH (operational) — service worker frozen at v1.2.0, missing new screens from the shell. → versioned v1.7.1 + precaches customers/reports/purchases.
- LOW — inactive users leaked via `config_`; `package.json` version drift; pdf smoke not in `npm` scripts; brittle E2E stock assertion.

**Deferred (do not silently leave):** — **all shipped in v1.11.0** (2026-09-09):

- ~~Lock scope: `purchaseOrderReceive_`, `suppliers_`, `adminProducts_`,
  `adminSerials_` read/validate *before* acquiring the script lock → two
  concurrent writes can clobber.~~ → every read+validate now runs inside the
  lock, and `shiftOpen_`/`shiftClose_` were brought under the lock too
  (`shiftClose_` updates in place via `applyPatches_`).
- ~~Idempotency: re-pushing a `VOIDED` row returns `ALREADY_SYNCED`/accepted
  (looks complete locally, sale never recorded); same-batch duplicate
  `clientTxId` can double-append.~~ → a VOIDED row is re-evaluated on every
  re-push and a success rewrites it in place (same id, no duplicate rows);
  same-batch duplicates resolve to `ALREADY_SYNCED`/`DUPLICATE_CLIENT` via a
  batch-level `batchSeen` index.
- ~~Reports GP uses live `cost_price` instead of captured `unitCost` → history
  rewrites after cost edits.~~ → `costOf_`/`byCategory`/`byProduct` prefer the
  captured `unitCost` (live cost fallback for legacy rows); refunds carry the
  original sale's captured cost.
- ~~`byCategory`/`byProduct` ignore discounts → can overstate vs store total.~~ →
  line `discountPct` + order discount applied per line, rounded cents.
- ~~Same-batch double refund validated against a pre-batch snapshot → both
  pass.~~ → `processRefund_` validates against the persisted ledger **plus
  this batch's accepted rows** (original sale and prior refunds both).
- ~~`shiftOpen_`/`shiftClose_` run without the script lock (double-open /
  lost-write on double-close).~~ → both now run under the lock; closing
  rewrites the shift row in place.
- ~~Aging buckets net store-credit refunds as the balance does.~~ → confirmed
  **already gross** (buckets only age net30/account tenders FIFO against
  payments); locked by a sim assertion documenting the semantics.
- ~~Day-windows key on UTC in reports/exports — wrong for UTC+ stores.~~ →
  `store_tz_offset` (minutes) via `adminStore_`; reports/export interpret
  date-only params and day keys in store-local time.
- ~~Win/Win small: `round2_` negative rounding, `uuid_()` dead code,
  `fallbackUserId_` attribution, `config_` roster width, seed gate only checks
  `store_id`.~~ → `round2_` sign-safe half-away-from-zero; `uuid_()` deleted;
  `fallbackUserId_(userRows, session)` prefers the authenticated account;
  `config_` active-only roster locked by sim; seed gate also requires users.

## 9. Standing todo (do these next)

The approved roadmap (v1.8–v1.16), the interface-v2 rebuild (v1.17–v1.20) and
the operational-readiness program (v1.21–v1.30) are all complete. What is left
is below, in the order it should be picked up.

1. **Deploy v1.30.0 — both halves.** The backend has changed in nearly every
   release since v1.16.0, so a frontend-only push ships a client that calls
   endpoints the server does not have.
   - Paste `backend/Code.gs` into Apps Script and **deploy a new Web App
     version**. New tabs (`TimeClock`, `StockTakes`, `Audit`) are created on
     first use.
   - Run **`installBackupTrigger()`** once — nightly Drive backups into the
     `POS Backup` folder do not start until it is installed.
   - Run **`installReportTriggers()`** once, then set recipients in
     Settings → *Scheduled reports*. **Every cadence ships off**; nobody
     starts receiving mail because a release landed.
   - Push `public/` to Cloudflare Pages. Terminals pick up the v1.30.0 shell
     on next load (`sw.js` VERSION is bumped).
   - Sign in as an admin once and complete the store setup dialog (language,
     country, currency) if this is a fresh deployment.
2. **Cash drawer + thermal printer — v1.28.0, parked.** Held at the owner's
   request until they speak to the business owners. **The version number is
   deliberately left unused** so the release can land under it. It is blocked
   on one decision, not on effort: **USB, network or Bluetooth** are
   materially different builds (a USB drawer kicks through the printer; a
   network printer is an IP and a raw 9100 socket; Bluetooth needs pairing per
   terminal). Picking wrong means rewriting rather than configuring, which is
   why it was not guessed at. See D1 in
   `docs/superpowers/plans/2026-09-11-operational-readiness-program.md`.
3. **Re-run `pdf-smoke`** somewhere Edge will launch headless — see §6.
4. **Translation — needs a decision from the owner.** The one open review
   finding; see §10.

## 10. Review findings — status (reviewed 2026-09-10, closed out 2026-09-11)

A full security + usability pass was run after v1.15.0. Everything cheap and
safe to fix shipped in **v1.15.1**. The rest was written up here with what each
would cost, and has since been worked through. **Seven of the eight are now
closed.** Nothing below was silently dropped.

### Closed

- ~~**The app cannot decide what currency it is in.**~~ **v1.16.0** —
  store-level locale / country / currency / cash ladder, a first-run dialog,
  and every money surface formatting through it.
- ~~**2. A cart lives only in memory.**~~ **v1.21.0** — the cart persists to
  IndexedDB on every mutation and rehydrates on boot, so a refresh, a tab
  eviction or a phone killing a backgrounded PWA no longer loses a part-rung
  sale.
- ~~**3. A sync mid-cart can drift the on-hand mirror.**~~ **v1.21.0** — the
  fix for #2 made this structural rather than incidental: `cart.js` **derives**
  availability as `serverOnHand − quantityInCart` at render time instead of
  mutating the catalog mirror, so a `pull()` mid-cart can no longer disagree
  with what is on screen. Nothing decrements stock locally any more, which is
  also why the external-sale dialog cannot claim a unit an open till sale is
  holding.
- ~~**4. The time clock needs a connection.**~~ **v1.30.0** — punches queue
  through the outbox carrying **the moment they happened**, and are sent before
  the sale batch so the floor record is right even if a sale is rejected.
- ~~**5. Any signed-in account can enumerate the staff roster.**~~ **v1.30.0**
  — `/api/config` returns the roster to manager/admin only. (The account-based
  lockout itself is the harder half and stays documented under §7.)
- ~~**6. The display never goes stale.**~~ **v1.30.0** — a frame older than
  three minutes reads as idle, rechecked every thirty seconds.
- ~~**7. `api.js` uses one 15s timeout for every call.**~~ **v1.30.0** —
  60s for reports, exports, backups, audit and the reorder worksheet; 15s for
  everything else, so a slow report is no longer reported as "offline".

### Open — the one that needs a decision

1. **The interface itself is not translated.** v1.16.0 made the *locale* real
   — currency, number grouping, dates all follow the store — but every string
   in the UI is still English. Translating it is a different shape of work:
   extract ~600–1,000 strings from 15 screens into a catalogue, add a `t()`
   lookup and a per-locale bundle, handle plurals, and re-check every layout
   that assumes English word lengths (German and French run 20–30% longer;
   Arabic and Urdu need RTL, which the CSS has never been tested against).
   Ballpark: 3–5 days for the machinery plus one screen-by-screen pass, then a
   real translator per language. **Worth asking:** which languages actually
   need it, and is RTL in scope? A half-translated UI is worse than an English
   one, so this should be all-or-nothing per language.

### Deferred by decision, not by oversight

Nine items were considered during the operational-readiness program and
deliberately left out, each with a reason recorded in
`docs/superpowers/plans/2026-09-11-operational-readiness-program.md`: repairs
workflow, trade-ins, warranty per serial, layaway, store credit as a
first-class object, accounting integration, marketplace API sync, UI
translation / RTL (the same as #1 above), and tax-compliance specifics.

### Confirmed still-correct (checked this pass, no action)

- Every privileged route calls `requireRole_`; refunds, payouts and
  collections remain admin/manager-only, and v1.23.0 moved bulk price, stock
  take, suppliers and PO cancellation to **admin-only**.
- `esc()` covers user text on every screen; `toast()` writes `textContent`;
  the receipt builder escapes line names built from product + serial.
- The customer display is publish-only and same-origin, and the frame carries
  no cost, margin, customer or till field.
- CSRF is not applicable: credentials live in IndexedDB and travel in the
  request body, so a cross-site page cannot make an authenticated call.
- Secret comparison is constant-time on both paths (`constantEquals_`).

## 11. Session context / reconstructability

- Every feature is its own tagged commit, so "what was I doing" is always:
  the newest tag + this doc.
- User standings: "continue building, don't stop until everything is done and
  tested"; release protocol is one feature = one validated tagged revision;
  docs must stay updated in the same commit as the code.
- Working checks: sim → syntax → pdf; the reports gotchas (UTC day keys from
  `toISOString().slice(0,10)`; fetch DTO *after* pushes; payout rows carry a
  cash tender — never iterate tenders on them) apply to any new report work.
- PowerShell: git push output looks like red errors but succeeds; verify the
  `main -> main` and `* [new tag]` lines.
- `AGENTS.md` is the operating guide future sessions should follow verbatim.

## 12. Session handover — 2026-09-11

What happened in one line: **the interface-v2 rebuild and the whole
operational-readiness program shipped — fourteen tagged releases, v1.17.0
through v1.30.0.**

### Shipped tonight

| Release | What it does |
|---|---|
| v1.17.0 | New shell and navigation — launcher-tile home, nav as data (`nav.js`) |
| v1.18.0 | Sell & checkout rebuilt |
| v1.19.0 | Three money-out kinds — paid out, cash pick-up, staff expense |
| v1.20.0 | Remaining screens brought onto the new shell |
| v1.21.0 | **No sale is lost if interrupted** — cart persists to IndexedDB; availability is *derived*, never mutated (`cart.js`) |
| v1.22.0 | Audit log, admin-only, with day/time stamps |
| v1.23.0 | Management and ownership functions moved to admin-only |
| v1.24.0 | Receipt numbering — `Orison-S000001`, allocated at sync |
| v1.25.0 | Drive backups into `POS Backup` (date+time in every filename) + the 100-row cap with search |
| v1.26.0 | Daily / weekly / monthly reports emailed to nominated admins |
| v1.27.0 | Record a sale made elsewhere — marketplace, own site, phone |
| v1.29.0 | Card tender — kept out of the drawer, counted as revenue |
| v1.30.0 | The four remaining §10 findings |

Two pre-existing bugs were found and fixed on the way: the `?status=all`
shift-roster leak (v1.17.0) and the dead cart ✕ button (v1.18.0).

### Two decisions that shaped the build

- **Receipt numbers are allocated at sync, not at sale.** An offline terminal
  cannot know the next number without risking a collision, so an offline
  receipt prints "Receipt number pending sync" and repaints when the push
  lands. The alternative — per-terminal number ranges — was rejected because
  it makes the numbering non-sequential, which is exactly what the owner asked
  for it *not* to be.
- **The 100-transaction cap had a knock-on the request did not mention.** The
  dashboard used to read the whole ledger. It now pages today only (bounded at
  10 pages) and sources the 14-day chart and 30-day top sellers from
  `/api/reports`, which is uncapped and discount-accurate. Without that the cap
  would have silently made the dashboard wrong rather than slow.

### Pick up here in the morning

1. **Deploy v1.30.0 — both halves, plus the two one-time trigger installs.**
   Full steps in §9. This is the gating item: everything above is tagged but
   none of it is live.
2. **The printer/drawer question** — v1.28.0 is parked on it, and it is a
   question for the business owners, not a build task. §9 item 2.
3. **`pdf-smoke`** — §6. It has been unrun since v1.18.0 and should not be
   assumed green.
4. **Translation** — §10, open finding #1, needs the owner to say which
   languages and whether RTL is in scope.

### Worth knowing before you touch it

- **The service worker will lie to you.** During browser verification it
  repeatedly served a stale build. Clear caches **and** unregister the SW
  before every check, or you will verify the previous release.
- **Never chain a gate into a commit and a tag with `&&`.** At v1.23.0 a
  `grep` in the chain matched nothing (a multibyte prefix), so the commit was
  skipped while `git tag` still ran — and the tag landed on the previous
  release's commit. It was caught, deleted locally and remotely, and redone.
  Run the gate, read it, then commit, then tag, as separate commands.
- The Bash heredoc breaks on very long commands (~6KB+); use the file-write
  tool for anything large.
