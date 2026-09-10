# Orison POS — Release Notes

Every release is a **tagged commit** on `main` (`vX.Y.Z`), validated before
ship, with docs/assets kept in the same commit. This file highlights the
current release and the run that led here; `CHANGELOG.md` carries the full,
line-by-line detail for every version.

---

## Latest: v1.13.0 — theme polish + responsive shell

**2026-09-09.** The desktop terminal finally gets a real working layout. A
persistent sidebar replaces the bottom tab bar, the register becomes a
two-column sales floor (catalog left, live cart right), and checkout and
detail sheets slide in from the right — while phones and tablets keep the
familiar bottom bar and bottom-sheet flows untouched.

**What shipped**

- **Theme polish** — layered softer shadows, eased motion, stronger header
  blur, focus rings, larger rounded search field, 40px chip targets, card
  hover lift, and tabular-numeral alignment on every money figure (navy/gold
  identity unchanged).
- **Toggleable sidebar (desktop ≥1024px)** — expanded 240px labels ↔ collapsed
  64px icon rail via the hamburger; choice persists in `localStorage`.
  Role-gated tabs, active pill, and alerts badge work in both navs.
- **Responsive state** — `html[data-viewport]` = `mobile`/`tablet`/`desktop`
  via `matchMedia`, with an `orison:viewport` event cross-breakpoint.
- **Dual-panel register** — desktop: catalog left + sticky 440px live cart
  right; phones/tablets keep the bottom-sheet cart (one shared renderer).
- **Checkout & sheets on wide screens** — checkout is a right-anchored 440px
  sheet column; detail/edit sheets slide in from the right.
- **Fixed** — the alerts badge was toggling a non-existent `.show` class so
  the on-shelf counter never appeared; it now toggles `.hidden` correctly.

**Validation:** backend-sim **PASS 359 / FAIL 0** · client units **PASS 154 / FAIL 0** ·
pdf-smoke **PASS 19 / FAIL 0** · `node --check` clean on all touched JS.
Shell smoke-tested headless at 1366/834/390px (21 assertions, 0 console errors).

### Deploying

1. No backend change — `backend/Code.gs` is untouched this release.
2. Cloudflare Pages keeps serving `public/` as-is (no build). On next load,
   the service worker serves the **v1.13.0** shell and drops the old cache.
3. Nothing to run; terminals pick the new shell up automatically.

---

## The road here (1.12.0 → 1.13.0)

| Version | What shipped |
| --- | --- |
| **v1.13.0** | **Theme polish + responsive shell** — layered shadows/easing/focus rings/tabular numerals; toggleable 240px↔64px sidebar at ≥1024px (persisted); `matchMedia` viewport state (`mobile`/`tablet`/`desktop`); dual-panel register (catalog + sticky 440px cart) and right-anchored checkout/sheets on desktop; alerts badge fixed (`.hidden` not `.show`). |
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