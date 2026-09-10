# Orison POS — Release Notes

Every release is a **tagged commit** on `main` (`vX.Y.Z`), validated before
ship, with docs/assets kept in the same commit. This file highlights the
current release and the run that led here; `CHANGELOG.md` carries the full,
line-by-line detail for every version.

---

## Latest: v1.12.0 — client test harness

**2026-09-09.** The register-side money engine, sync queue, IndexedDB layer,
alert classifier, and UI formatters now have an automated suite. The backend
had 359 checks; the client had **zero**. That gap is closed.

**What shipped**

- `node:test` unit suites (154 checks, pure-Node, no new framework):
  - **`money.js`** — rounding/drift edge cases, discount + tax math, and the
    refund/payout builders against a mocked sync + fake IndexedDB.
  - **`sync.js`** — outbox enqueue→push→SYNCED round-trip, offline
    short-circuit, rejected→VOIDED with local stock restore.
  - **`db.js`** — CRUD, `bulkPut`, and the `by_upc`/`by_sku`/`by_category`
    indexes against a real in-memory IndexedDB (`fake-indexeddb`).
  - **`alerts.js`** — severity classification, sort order, aging buckets.
  - **`ui.js`** — currency formatting, HTML escaping, debounce.
- `tests/helpers/setup-globals.mjs` — the browser-globals shim that makes
  client ESM importable in Node, with an event-recording `dispatchEvent` and a
  fetch-mock harness shaped like `api.js`'s envelope.
- `npm run test:client` wired into `test:all`.

**Validation:** backend-sim **PASS 359 / FAIL 0** · client units **PASS 154 / FAIL 0** ·
pdf-smoke **PASS 19 / FAIL 0**.

### Deploying

1. No backend change — `backend/Code.gs` is untouched this release.
2. Cloudflare Pages keeps serving `public/` unchanged (`sw.js` version bump is
   cosmetic; the shell is otherwise identical).
3. No redeploy needed unless you want the new `test:client` script locally:

```bash
npm install      # pulls fake-indexeddb
npm run test:client
```

---

## The road here (1.11.0 → 1.12.0)

| Version | What shipped |
| --- | --- |
| **v1.12.0** | **Client test harness** — 154 unit checks for money math, sync outbox/IPC, IndexedDB CRUD + indexes, alert classification, and UI formatters via `node:test` + `fake-indexeddb` (browser-globals shim in `tests/helpers`); `test:client` wired into `test:all`. |
| **v1.11.0** | Offline sync hardening — VOIDED re-pushes re-evaluated and rewritten in place, same-batch dup `clientTxId`s resolve without double-applying, refunds see the same batch, GP uses captured cost-at-sale, category/product breakdowns apply discounts, store-TZ day windows, lock-scope fixes across PO/suppliers/products/serials/shifts, sign-safe `round2_`. |
| **v1.10.0** | Inventory aging — how long on-hand stock has been sitting, in 0–30 / 31–60 / 61–90 / 90+ day buckets with units and value at cost (clock starts at creation, re-sets on PO receipts); read-only view from Products → Aging. |
| **v1.9.0** | Customer statements — chronological debit/credit statement of account with a running balance (sales on account debit; store-credit refunds and collections credit), printable and CSV-exportable from the ledger. |
| **v1.8.0** | Price history & tracking — per-product audit of every cost/retail change (create baseline, manual patch, PO weighted-cost receipt with the order number) browsable from the Products screen. |
| **v1.7.1** | Post-review hardening — refunds admin/manager-only, role changes revoke sessions immediately, export stops counting purchase receipts as SALES and nets collections as money-in, service-worker cache un-stuck (v1.7.1 versioned + precaches new screens), docs locked in step. |
| **v1.7.0** | Suppliers & **purchase orders** — vendor records, PO lifecycle (draft → ordered → partial/received → cancelled), receiving that posts stock at weighted-average cost with per-unit serial intake and a ledger trail that never touches drawer math. |
| **v1.6.0** | Reports & analytics — KPIs (gross sales, refunds, payouts, collections, net revenue, GP) plus by-day/category/cashier/tender views, top products & customers, CSV export. |
| **v1.6.0** | Reports & analytics — KPIs (gross sales, refunds, payouts, collections, net revenue, GP) plus by-day/category/cashier/tender views, top products & customers, CSV export. |
| **v1.5.0** | Till shifts — open with a float, close with a denomination count, *declared / expected / over-short* per cashier, `kind`-aware cash math. |
| **v1.4.1** | Receivables grow teeth — record payments against customer accounts, receivables view, 30/60/90+ aging buckets, net-30 tenders. |
| **v1.4.0** | Customers — attach any sale to a customer account; store-credit and on-account tenders from checkout. |
| **v1.3.1** | Profit visibility — gross profit derived from tracked costs on the reports/overview screens. |
| **v1.3.0** | Staff accounts in-app — create users with a one-time PIN from Settings; role management without hand-editing the sheet. |
| **v1.2.7** | Sync-conflict email alerts — coalesced digest to admin/manager when offline conflicts land. |
| **v1.2.6** | Discounts & sales tax — per-line and per-order percentage discounts, taxable flags, store tax rate, all in integer cents. |
| **v1.2.5** | Offline sign-in hardening — the offline credential no longer stores bare PIN hashes; rotated server-side. |
| **v1.2.4** | Per-device revocation — cut off a single lost terminal without rotating the shared token; v4 UUID seed PINs reshaped. |
| **v1.2.3** | Token revocation + lost-device reflex + strict Content-Security-Policy across the static site. |

Releases before v1.2.3 (`v1.0.x`–`v1.2.2`, tags only) predate the changelog:
core register (catalog, cart, split tender, receipts, serial checkout) and the
first security pass (salted PIN hashes, session tokens, login lockout, offline
credentials, conflict registry). `v0.2.1` was the login-path security release.

## Full changelog

See [CHANGELOG.md](CHANGELOG.md) for the complete, per-version detail.