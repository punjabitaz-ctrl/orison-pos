# Orison POS — Release Notes

Every release is a **tagged commit** on `main` (`vX.Y.Z`), validated before
ship, with docs/assets kept in the same commit. This file highlights the
current release and the run that led here; `CHANGELOG.md` carries the full,
line-by-line detail for every version.

---

## Latest: v1.8.0 — price history & tracking

**2026-09-09.** Every price now has a story. Cost and retail changes — made by
hand in Item settings or made silently by a purchase-order receipt blending
the weighted-average cost — are recorded per product, with **who**, **when**,
and **why**, and browsable from the Products screen.

**What shipped**

- **📈 Price history on every product.** `/api/price-history` (admin/manager,
  optional `productId` filter) and a modal view on each product row showing
  `Retail price / Cost price: old → new`, the changer's full name, and a
  timestamp.
- **Recorded at every money-touching event:**
  - `create` — baseline cost + retail when an item is added.
  - `patch` — a manual edit in Item settings; no-op saves leave no trace.
  - `po` — receiving a delivery records the weighted-average cost update,
    tagged with the purchase order number.
- New `PriceHistory` workbook tab, auto-created with header migration like the
  rest.
- Each price change and its audit trail are written in the **same script
  lock**, so the record is atomic with the product update.

**Validation:** backend-sim **PASS 318 / FAIL 0** · pdf-smoke **PASS 19 / FAIL 0** ·
`node --check` clean.

### Deploying

1. Paste the new `backend/Code.gs` into the Apps Script editor and Deploy →
   Manage deployments → Update. The new `PriceHistory` tab auto-creates on the
   next read (or the next `setup`).
2. Cloudflare Pages keeps serving `public/` from the repo root — the new shell
   (v1.8.0 service worker) rolls out to terminals on their next load.
3. One hard reload if anything looks stale on an installed terminal.

---

## The road here (1.7.1 → 1.8.0)

| Version | What shipped |
| --- | --- |
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