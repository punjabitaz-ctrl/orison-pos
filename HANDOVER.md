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
| Current version | **v1.12.0** — client test harness (`2026-09-09`) |
| Validation bar | `backend-sim` **PASS 359 / FAIL 0** · client units **PASS 154 / FAIL 0** · pdf-smoke **PASS 19 / FAIL 0** · `node --check` clean |
| Backend | Single-file Google Apps Script Web App on Sheets + Drive (`backend/Code.gs`, ~3,340 lines) |
| Frontend | Vanilla ES modules PWA, no build step (`public/`), service-worker cached shell |
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
`Suppliers` · `PurchaseOrders` · `PriceHistory`.

Ledger kinds: `sale` (incl. legacy `''`), `refund`, `payout`, `payment`
(= collection, money-in), `purchase` (PO receipt — must never count as sales
anywhere). Every money kind has a `requireRole_` gate: payout/payment/refund =
admin/manager.

## 6. Validation & test map

- `tests/backend-sim.mjs` — the contract. In-memory mock of Apps Script
  (`SpreadsheetApp`/`LockService`/`DriveApp`/`CacheService`/`PropertiesService`)
  runs `Code.gs` in `node:vm`. 359 checks: auth, throttle, FCW serial conflicts,
  refund guards, payouts, customer ledger/aging, shifts, reports/GP/export,
  PO receive math, role gates.
- `tests/client-*.mjs` — pure-Node client unit tests (`node:test` +
  `fake-indexeddb`, browser-globs shim in `tests/helpers/setup-globals.mjs`).
  154 checks: money math (`round2`/`cents`/`clampPct`/`saleTotals`/`kindInfo`),
  refund/payout builders against an IDB-backed mock, outbox enqueue/push/
  VOIDED-rollback/offline paths, db CRUD + indexes, alerts classification/buckets,
  ui `fmt`/`esc`/`debounce`.
- `tests/pdf-send-smoke.mjs` — real headless browser, receipt PDF/share.
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

1. **Roadmap (user-directed order):**
   - ~~**Price history & tracking**~~ — shipped in **v1.8.0**.
   - ~~**Customer statements**~~ — shipped in **v1.9.0**.
   - ~~**Aging inventory**~~ — shipped in **v1.10.0**.
   - ~~**Deferred hardening list**~~ — **all shipped in v1.11.0** (lock-scope
     races, VOIDED re-push idempotency, same-batch refunds/duplicates, GP
     cost-at-sale, discounts in breakdowns, store-TZ day windows).
   - ~~**Client test harness for `money.js`/`sync.js`**~~ — shipped in
     **v1.12.0** (154 unit checks across money/sync/db/alerts/ui).
2. **Deploy current version** — v1.12.0 changes **no runtime files** (tests +
   scripts + docs only), so no backend redeploy and Cloudflare Pages serves the
   same shell. If you want the new `test:client` locally: `npm install` then
   `npm run test:client`.
3. **Visual roadmap (user-approved order):**
   - ~~v1.12.0~~ **done** — client test harness.
   - **v1.13.0** — theme polish + responsive infrastructure: typography/
     spacing scales, softer shadows, refined transitions (same navy/gold);
     **toggleable desktop sidebar** (collapsed icon rail ↔ expanded) replacing
     the bottom tabbar at ≥1024px; **dual-panel register** (product grid left,
     cart right on desktop); side-sheet checkout on wide screens; `app.js`
     responsive state (`mobile`/`tablet`/`desktop`) via `matchMedia`.
   - **v1.14.0** — screen refresh + enhanced dashboard + staff tools: trend
     KPIs, hourly chart, top-seller table, shift summary; new staff screen
     (time clock, shift history, per-cashier performance); consistent spacing,
     empty states, loading skeletons, 44px touch targets across every screen.
   - **v1.15.0** — customer display + inventory tools: BroadcastChannel mirror
     mode with a **second-screen-only option**; bulk price update, stock-take
     mode, barcode label printing, low-stock reorder worksheet.

## 10. Session context / reconstructability

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