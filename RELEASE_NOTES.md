# Orison POS — Release Notes

Every release is a **tagged commit** on `main` (`vX.Y.Z`), validated before
ship, with docs/assets kept in the same commit. This file highlights the
current release and the run that led here; `CHANGELOG.md` carries the full,
line-by-line detail for every version.

---

## Latest: v1.25.0 — never load more than 100

**2026-09-11.** Fifth of the operational-readiness program.

`/api/transactions` is now hard-capped at **100 rows** — it allowed 500, and the
dashboard was asking for 300. Reading a slab of the ledger into a terminal is
precisely what stops working as the shop grows.

**Search moved to the server.** History has a search box that finds a sale by
**receipt number, customer, cashier, item name, IMEI, note or amount** — typing
`949` finds a $949.00 sale — with a match count and **Load 100 more**. Paging is
keyset-based on the timestamp, so sales arriving at the top cannot shuffle a
page under whoever is reading it.

**The dashboard stopped pulling a slab.** Its KPIs and hourly chart page through
today only; the 14-day chart and 30-day top sellers now come from
`/api/reports`, the server's own aggregate — uncapped, and more accurate, since
it applies the line and order discounts the client could only approximate.

**Validation:** backend-sim **PASS 529 / FAIL 0** (14 new, including a
2,198-row ledger) · client units **PASS 350 / FAIL 0**.

### Deploying

**Backend redeploy required.**

---

## v1.24.0 — backups

**2026-09-11.** Fourth of the operational-readiness program.

The whole business lives in one spreadsheet and nothing was copying it
anywhere. Now a full copy of the workbook lands nightly at 02:00 in its own
Drive folder **`POS Backup`**, named `Orison-POS-Backup_2026-09-11_0200.xlsx`
in the store's own local time. The last 30 nights and 12 months are kept.

**A failed backup shouts.** The trigger never throws — one that throws stops
being scheduled, which would end all backups silently — it emails every admin,
writes to the audit log, and shows the failure in Settings. A silent backup
failure is worse than no backup, because it is believed.

**Also fixed:** `setup` would happily re-seed a live workbook, rewriting users
and the catalog. One wrong run in the Apps Script editor took the shop's
history with it. It now refuses when transactions exist unless a
`CONFIRM_RESEED` script property says otherwise.

**Validation:** backend-sim **PASS 515 / FAIL 0** (18 new) · client units
**PASS 350 / FAIL 0**.

### Deploying

1. **Backend redeploy required.**
2. **Run `installBackupTrigger()` once** from the Apps Script editor to schedule
   the nightly job, and approve the trigger permission prompt.
3. Check Settings → Backups shows a time after the first run.

---

## v1.23.0 — management is admin only

**2026-09-11.** Third of the operational-readiness program.

Four things moved from manager to **admin only**: **bulk repricing**,
**committing a stock take**, **supplier records** and **cancelling a purchase
order**. The reasoning is one line — a manager runs the day, an admin owns the
business: what things cost, who the shop buys from, and what can be destroyed.

Managers keep everything else: refunds, cash out, products, serials, stock
adjustment, purchase orders, reports, customers, ledgers, collections,
conflicts and login unlocks.

⚠️ **This takes powers away from your current managers.** Tell staff before
deploying, or someone hits a refusal mid-task with no explanation.

**Validation:** backend-sim **PASS 497 / FAIL 0** (17 new) · client units
**PASS 350 / FAIL 0**.

### Deploying

**Backend redeploy required** — the role gates live in `Code.gs`.

---

## v1.22.0 — receipt numbers and the audit log

**2026-09-11.** Second of the operational-readiness program.

- **Receipts are numbered `Orison-S000001`**, gap-free. The counter is advanced
  inside the same lock that writes the sale, so two terminals cannot take the
  same number.
- **Allocated at sync, not on the device.** An offline terminal cannot know the
  next number, so an offline receipt prints its client id and says *"Receipt
  number pending sync"*, then repaints when the push lands. That is what keeps
  the series gap-free, and it is stated on the receipt rather than hidden.
- **Only sales and refunds are numbered.** Paid-outs and cash pick-ups are not
  customer documents and would put holes in the series; a sale blocked by
  first-committed-wins never burns a number either.
- **An append-only audit log**, admin only: who did what, when, in what role.
  No update or delete path exists in the API — a log that can be edited is not
  evidence. New Audit screen with filters and CSV export.

**Validation:** backend-sim **PASS 480 / FAIL 0** (18 new) · client units
**PASS 350 / FAIL 0**.

### Deploying

**Backend redeploy required** — new schema column, new sheet and a new endpoint.
Paste `backend/Code.gs` into Apps Script and deploy a new version, then push
`public/`. The `receipt_no` column and `AuditLog` tab are created automatically;
existing transactions keep an empty receipt number.

---

## v1.21.0 — no sale is lost

**2026-09-11.** First of the operational-readiness program, and the owner's
first priority.

A part-rung sale now survives the terminal dying. The cart is written to
IndexedDB on every change and offered back on the next boot — *"Recovered a
sale in progress — 6 items, $996.50"*, with **Resume** or **Discard**. It is
offered rather than silently restored, because the cashier may have re-rung it.

**The bug underneath it.** The register used to decrement the local catalog as
lines went into the cart. A crash therefore lost those units for good — nothing
ran to put them back — and a serialized phone could vanish from the terminal's
stock entirely. Availability is now *derived* (`serverOnHand − quantityInCart`),
which also fixes a second bug: a `pull()` mid-cart replaced the product objects
under the open cart, so the displayed stock and the quantities the cart would
restore could disagree.

**Validation:** backend-sim **PASS 462 / FAIL 0** (untouched) · client units
**PASS 350 / FAIL 0** (24 new). Verified in-browser: the shelf counts down live
as items go in, the sixth of five is refused, and a hard reload mid-sale brings
back all six lines including the exact IMEI.

### Deploying

Front-end only — `backend/Code.gs` untouched, no Apps Script redeploy.

---

## v1.20.0 — shared components sweep

**2026-09-10.** Closes the last outstanding item from the interface-v2 spec, and
adds the permanent project credit.

**What shipped**

- **Every screen renders its structure from `components.js`.** `screenHead()`,
  `sectionHead()`, `statRow()`, `rankRow()`, `rankList()` and `dataTable()`
  replace markup that had been hand-written across the app: the same header
  block appeared in **12** screens, plus 9 rank rows, 6 tables, 3 stat rows and
  4 section heads.
- **"An AYiN Advisors Project"** now appears permanently in the footer of the
  app shell and the customer display.
- Screens still build their own table rows. `dataTable()` owns the wrap, the
  head and numeric alignment — the part that actually repeated. Forcing every
  table through one row model would have made the code worse.

**Validation:** backend-sim **PASS 462 / FAIL 0** (untouched) · client units
**PASS 328 / FAIL 0** · `node --check` clean. All ten reachable screens walked
in-browser after the sweep: every header renders, zero JS console errors.

### Deploying

1. **Front-end only** — `backend/Code.gs` is untouched.
2. Push `public/` to Cloudflare Pages as usual.

---

## v1.19.0 — three money-out kinds

**2026-09-10.** The last of the three interface-v2 releases. Cash leaving the
drawer is now attributable by reason.

**What shipped**

- **Paid Out, Cash Pick Up and Staff Expense are three separate things** — three
  transaction kinds (`payout`, `pickup`, `expense`), three launcher tiles, three
  dialogs that ask for the counterparty in the words that fit the reason. All
  three are cash out and all three keep the admin/manager guard.
- **Reports split them** — `summary.pickups`, `summary.expenses`, and a
  `cashOut` total; net revenue subtracts all three.
- **The Drive export gains CASH PICK-UP and STAFF EXPENSE lines**, and NET CASH
  subtracts all three.
- **The drawer loses the cash for all three** at shift close.
- The dashboard's "Paid out" KPI became **Cash out**, with the split beneath it.

**Compatibility:** existing `payout` rows are untouched and keep meaning *paid
out*. Nothing migrates, and an older shell can still only send `payout`, which
the server accepts exactly as before.

**Validation:** backend-sim **PASS 462 / FAIL 0** · client units
**PASS 301 / FAIL 0** · pdf-smoke **PASS 19 / FAIL 0** · `node --check` clean.

### Deploying

1. **Backend redeploy required** — `backend/Code.gs` gained the two kinds.
   Paste it into Apps Script and deploy a new Web App version.
2. Push `public/` to Cloudflare Pages as usual.
3. Deploy the backend **first**: a terminal on the new shell can send `pickup`
   and `expense`, which an older backend would reject.

---

## v1.18.0 — Sell & checkout

**2026-09-10.** Second of the three interface-v2 releases. The running total
stops disappearing, and the charge screen leads with the number that matters.

**What shipped**

- **A pinned cart bar** on phones and tablets — count, running total and Charge,
  above the tab bar. Adding an item **no longer throws a sheet over the
  catalog**: the bar updates, the catalog stays put, and the cart sheet opens
  only when someone asks for it. Desktop keeps its side panel, unchanged.
- **Product tiles** — category colour as the identifying chip, a two-line name
  clamp so long names stop breaking the grid, a bigger price, clearer stock,
  IMEI and Locked badges. Category chips carry the same colour as a dot.
- **Checkout** — the line list collapses behind a `N items · total` summary,
  **Amount due** is now the largest figure on the screen, and Complete Sale is
  the only action styled as primary.

**Bug found and fixed:** the ✕ on a cart line has never worked. Its handler read
`b.dataset.key` while the button carries its key in `data-remove`, so the lookup
never matched; `lineRemove()` also restored stock without deleting the line.
Removing a line now actually removes it.

**Validation:** backend-sim **PASS 446 / FAIL 0** (untouched) · client units
**PASS 287 / FAIL 0** · pdf-smoke **PASS 19 / FAIL 0** · `node --check` clean.
Verified in-browser at 375px and 1280px: bar appears on add and hides when the
cart empties, sheet opens on demand, quantity/discount/remove all work, scanner
path unchanged (known SKU adds, unknown code toasts), desktop renders no bar.

### Deploying

1. **Front-end only.** `backend/Code.gs` is untouched — no Apps Script redeploy.
2. Push `public/` to Cloudflare Pages as usual (no build step).
3. Terminals pick up the **v1.18.0** shell on next load.

---

## v1.17.0 — shell & navigation

**2026-09-10.** The first of three releases rebuilding the interface around the
job staff actually do. The app opens on **Sell**, and one large button opens a
flat grid of every job — the screen the shop already knows, rebuilt.

**What shipped**

- **Three-item bottom bar — Menu · Sell · History**, replacing ten destinations
  in a scrolling strip. **Menu** is left-most, thumb-nearest and visually
  heavier, and carries the inventory-alert count. Each target is 125×61px on a
  375px phone.
- **The launcher** — one flat grid of big labelled tiles, colour chip and icon,
  no group headings and no submenus. Ten tiles for an admin or manager; a
  cashier sees the three their role permits, because role gating removes a tile
  rather than greying it out.
- **App header** on every screen — store name, live clock, one connectivity
  indicator with the queued-push count, and a user chip that opens Settings.
- **Navigation is data.** Both navs render from `nav.js`, so `index.html` loses
  ~100 lines of duplicated SVG and a destination is added in one line rather
  than as two buttons in two places.
- **Paid Out opens Paid Out.** Its dialog moved out of `dashboard.js` into
  `money-dialogs.js` so the tile does what its label says.

**Two deliberate departures from the spec,** both recorded in the plan:
`primaryTabs()` lives in `nav.js` rather than `app.js`, because `app.js` boots
on import and could not otherwise be unit-tested; and the launcher ships **10**
tiles rather than 13 — Cash Pick Up, Employee Expense and Shift arrive in
v1.19.0 with the transaction kinds they need, and no tile ships that does not
do what its label says.

**Validation:** backend-sim **PASS 446 / FAIL 0** (untouched this release) ·
client units **PASS 269 / FAIL 0** · pdf-smoke **PASS 19 / FAIL 0** ·
`node --check` clean on every touched file. Verified in-browser at 375px, 834px
and 1280px: bar never scrolls, role gating correct for both roles, all ten
tiles route, zero JS console errors.

### Deploying

1. **Front-end only.** `backend/Code.gs` is untouched — no Apps Script redeploy.
2. Push `public/` to Cloudflare Pages as usual (no build step).
3. Terminals pick up the **v1.17.0** shell on next load; the service worker
   drops the old cache and precaches `nav.js`, `components.js`,
   `money-dialogs.js` and the launcher.

---

## v1.16.0 — store localisation & multi-currency

**2026-09-10.** A store now says what language, country and currency it trades
in, and everything that prints or counts money follows.

**Why this release exists.** Every figure printed as US dollars, while the till
was counted against a fixed ₦1000/500/200/100/50/20 ladder — so *expected vs
declared* compared a drawer against a currency it did not hold.

**What shipped**

- **First-run setup** — the first admin to open the dashboard on an
  unconfigured store picks **language, country and currency** and gets that
  currency's notes and coins. Choosing a country fills the rest in; a live
  sample shows what a price will read before you save. Changeable later at
  **Settings → Store → Language, country & currency**.
- **18 currencies with real cash ladders**, and any ladder can be replaced
  with the store's own. The list the dialog offers comes from the server, so it
  can never present a currency the server would reject.
- **Everything follows the setting** — receipts, reports, exports, the
  dashboard, the customer display (each frame carries the format, since the
  display is a separate document), the payout and collections dialogs, and the
  close-of-shift count.
- **The drawer is valued against the store's own ladder**, in integer cents,
  and a quantity sent for a note the store does not hold is ignored rather than
  trusted.
- **Fixed:** `/api/admin/store` used to reset the sales tax to zero whenever it
  was called to change something else. Every field is now optional.

**Validation:** backend-sim **PASS 446 / FAIL 0** · client units **PASS 237 / FAIL 0** ·
pdf-smoke **PASS 19 / FAIL 0** · `node --check` clean. Verified in a real
browser: the dashboard prints ₦ for an NGN store, the setup dialog switches
currency, ladder and sample together, and Save posts exactly the chosen values.

**Known limitation:** the locale drives *formatting* — currency, number
grouping, dates. The interface copy is still English; translating it is a
separate piece of work, written up in `HANDOVER.md` §10.

### Deploying

1. **Backend redeploy required** — `backend/Code.gs` gained the localisation
   fields, the currency catalogue and the validating `/api/admin/store`.
2. Push `public/` to Cloudflare Pages.
3. **On first load after deploying, sign in as an admin** and complete the
   setup dialog. Until you do, the store reports `configured: false` and
   formats as en-US / USD with a US cash ladder.

---

## v1.15.1 — post-review hardening

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