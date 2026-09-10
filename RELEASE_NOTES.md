# Orison POS — Release Notes

Every release is a **tagged commit** on `main` (`vX.Y.Z`), validated before
ship, with docs/assets kept in the same commit. This file highlights the
current release and the run that led here; `CHANGELOG.md` carries the full,
line-by-line detail for every version.

---

## Latest: v1.15.1 — post-review hardening

**2026-09-10.** A full security and usability pass over the codebase after
v1.15.0. This release lands the findings that were cheap and safe to fix now;
the rest are written up in `HANDOVER.md` §10 with what each would cost.

**What shipped**

- **The CSP would have blocked the backend.** `connect-src` allowed only
  `script.google.com`, but Apps Script answers `/exec` with a redirect to
  `script.googleusercontent.com` and CSP is enforced against every redirect
  hop — so on any host that honours `_headers` (Cloudflare Pages, the
  documented target) every API call would fail with nothing useful in the
  console. Fixed. **Anyone deploying to Cloudflare Pages needs this release.**
- **Prototype-shaped data corrupted reports and dropped stock.** A product
  category or tender type named `__proto__` silently vanished from
  `/api/reports`, one named `constructor` wrote onto a shared built-in, and —
  the real damage — an IMEI reading `constructor` or `toString` was **silently
  discarded as a duplicate** on serial intake. Every map keyed by
  operator- or client-supplied text is now null-prototype.
- **Two writes still validated against a pre-lock snapshot.**
  `adminInventory_` and `adminProductsPatch_` now read and write inside one
  lock, so their guards — and the "old value" recorded in price history —
  describe the row actually being overwritten.
- **Constant-time secret comparison** for the PIN hash as well as the session
  MAC (the PIN check had been a plain `!==`).
- **Dialogs are keyboard-usable.** Escape closes the top-most modal or sheet,
  focus moves into it on open (never on a touch device), and panels carry
  `aria-modal`.

**Validation:** backend-sim **PASS 427 / FAIL 0** · client units **PASS 228 / FAIL 0** ·
pdf-smoke **PASS 19 / FAIL 0** · `node --check` clean. The prototype-key
assertions were run against the pre-fix code and fail there, so they bite.

### Deploying

1. **Backend redeploy required** — paste `backend/Code.gs` into Apps Script
   and deploy a new Web App version.
2. Push `public/` to Cloudflare Pages. **`public/_headers` changed**; confirm
   the new `Content-Security-Policy` is being served (browser devtools →
   Network → the document → Response Headers) before calling the deploy done.
3. Terminals pick up the **v1.15.1** shell on next load.

---

## v1.15.0 — customer display & inventory tools

**2026-09-10.** The shopper gets a screen of their own, and the stockroom gets
the four tools it was missing.

**What shipped**

- **Customer display** — a second-screen mirror of the cart, the checkout
  breakdown and a thank-you with change due. Driven over a same-origin
  `BroadcastChannel`, so it works with the shop offline and never shows cost,
  margin, customer records or anything about the till. Settings → *Customer
  display* turns it on and opens the window, placing it on a second screen
  where the browser allows.
- **Bulk price update** — reprice a category or the whole catalog by rule
  (percent / amount / set, with optional rounding). Preview first; the server
  recomputes every price itself and records each change in price history.
- **Stock take** — scan or search, enter what is on the shelf, commit. Each
  line records expected, counted, variance and what that variance is worth at
  cost, into a new `StockTakes` audit tab. One bad line rolls back the count.
- **Barcode labels** — printable Code 128 shelf labels with name and price,
  encoded in-app (no third-party script), by UPC where an item has one.
- **Reorder worksheet** — what to buy next from real sales velocity: units
  sold, demand per day, days of cover, a suggested quantity, the last supplier
  who delivered it and the estimated cost. Print or export to CSV.
- **Security fixes** — the client CSV export now neutralises leading formula
  characters (closing a documented gap), the customer statement CSV is quoted
  so a comma in a name can no longer shift its columns, and the service worker
  no longer falls an offline customer display back to the register app.

**Validation:** backend-sim **PASS 413 / FAIL 0** · client units **PASS 228 / FAIL 0** ·
pdf-smoke **PASS 19 / FAIL 0** · `node --check` clean on every touched client file.
Verified in a real browser at 375px and 1280px: labels render and encode, the
stock-take sheet totals its variance, and a second tab mirrors the cart live.

### Deploying

1. **Backend redeploy required** — `backend/Code.gs` gained
   `/api/inventory/reorder`, `/api/admin/products/bulk-price` and
   `/api/admin/stock-take`. Paste it into Apps Script and deploy a new Web App
   version; the `StockTakes` tab is created on first count.
2. Push `public/` to Cloudflare Pages as usual (no build step). `display.html`
   ships alongside `index.html` and is precached.
3. On each terminal that needs it: Settings → **Customer display** → *Mirror
   this terminal* → **Open display window**, then drag to the customer-facing
   screen and full-screen it. Allow pop-ups for the site once.

---

## v1.14.0 — screen refresh, dashboard context & staff tools

**2026-09-10.** The dashboard stops reporting bare figures and starts saying
whether today is good; the store gets a time clock; and managers get a real
read on who sold what, for how long.

**What shipped**

- **Time clock** — punch in and out from the new **Staff** tab. One open entry
  per account, closed in place with the elapsed minutes. Nobody can punch for
  anyone else. Backed by a new `TimeClock` sheet and `/api/timeclock`,
  `/api/timeclock/punch`.
- **Staff screen** — everyone sees their clock, their hours (today / 7 days)
  and their shift history. Managers and admins also get **On the floor**,
  **Team performance** (sales, tickets, avg ticket, margin, hours, sales per
  hour over today / 7 / 30 days) and the **till reconciliation** table.
- **Dashboard with context** — trend chips on net revenue, ticket count and
  average ticket (vs yesterday) and gross profit (vs the 7-day average); a
  **Today by hour** chart with the busiest hour called out; top sellers as a
  units / revenue / margin table; a shift strip showing open, closed and
  over/short for the day.
- **Screen refresh** — shared `skeleton()` loading placeholders and a single
  `emptyState()` component, 44px touch targets across buttons, chips, segments
  and steppers, and a horizontally scrolling tab bar (64px tabs) now that a
  manager has ten destinations.
- **Security fix** — `/api/shifts?status=all` let any cashier read every other
  cashier's float, expected drawer and over/short. Gone; the store roster is
  role-gated like every other store-scope read.

**Validation:** backend-sim **PASS 374 / FAIL 0** · client units **PASS 190 / FAIL 0** ·
pdf-smoke **PASS 19 / FAIL 0** · `node --check` clean on every touched client file.
Shell verified headless at 375px and 1024px+ with zero JS console errors.

### Deploying

1. **Backend redeploy required** — `backend/Code.gs` gained the time-clock
   endpoints and the `shifts_` fix. Paste the file into Apps Script and deploy
   a new Web App version; the `TimeClock` tab is created on first use.
2. Push `public/` to Cloudflare Pages as usual (no build step).
3. Terminals pick up the **v1.14.0** shell on next load; the service worker
   drops the old cache and precaches `stats.js` + the Staff screen.

---

## v1.13.0 — theme polish + responsive shell

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