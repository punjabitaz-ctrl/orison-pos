# Changelog

All notable changes to Orison POS are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.23.0] — 2026-09-11

Management and ownership functions are now admin only, at the owner's
instruction.

### Changed

Four routes moved from **admin + manager** to **admin only**:

| Route | Why |
|---|---|
| `/api/admin/products/bulk-price` | Repricing the catalog is an ownership act, not a daily one. |
| `/api/admin/stock-take` | Committing a count rewrites stock on the owner's authority. |
| `/api/suppliers` | Who the shop buys from is an ownership decision. |
| `/api/purchase-orders/cancel` | Cancelling an order destroys a commitment. |

Managers keep the daily trade: refunds, all three cash-out kinds, product
create/edit, serials, stock adjustment, purchase orders (create and receive),
reports, price history, ageing, the reorder worksheet, customers, ledgers,
statements, collections, conflict review and login unlocks.

The Stock take and Bulk price entries are hidden from the Products → Tools menu
for managers; the server refuses them regardless of what the interface shows.

### Note for deployment

**This takes powers away from existing managers.** Tell staff before it goes
out, or a manager will hit a refusal mid-task with no explanation.

### Tests

17 new sim checks: each moved route refused for a manager and accepted for an
admin, each retained route still working for a manager, and cashiers gaining
nothing. Four existing supplier and purchase-order tests were written as manager
calls and were updated to admin — they were asserting the old rule.

## [1.22.0] — 2026-09-11

Receipt numbers and an audit log — the two things that make the ledger
answerable after the fact.

### Added

- **Gap-free receipt numbers, `Orison-S000001`.** The counter lives in `Meta`
  and is read and advanced **inside the same script lock that appends the
  transaction**, so two terminals syncing at once cannot take the same number.
  The prefix is a store setting (`receipt_prefix`), defaulting to `Orison-S`.
- **Numbers are allocated at sync, not on the device.** An offline terminal
  cannot know what the next one is, so a receipt printed before sync shows its
  client id and says **"Receipt number pending sync"**; when the push lands the
  receipt repaints with the real number. This is what makes the series gap-free,
  and it is visible rather than hidden.
- **Only customer documents are numbered** — a sale or a refund. Internal cash
  movements are not documents and would put holes in the series. A sale blocked
  by first-committed-wins never burns a number.
- **`AuditLog` sheet and `/api/audit`** — append-only, **admin only**, newest
  first, capped at 100 per page with a cursor, filterable by actor, action and
  date. There is no update or delete path in the API by design: a log that can
  be edited is not evidence.
- **Audit screen** on the launcher, admin only, with per-action filters and a
  CSV export.
- 18 sim checks covering the series, batch allocation, the VOIDED case, role
  gating and the log's contents.

### Changed

- `receipt_no` added to the Transactions schema and returned by
  `/api/transactions`; History shows the receipt number in place of the client
  id, and a shared receipt is named after it.
- `push()` returns its per-row results so the register can repaint the receipt,
  and stores `receiptNo` on the local record.
- Audit entries are written on store-settings changes, bulk repricing, stock
  takes, staff changes and terminal revocations.

## [1.21.0] — 2026-09-11

First release of the operational-readiness program
(`docs/superpowers/plans/2026-09-11-operational-readiness-program.md`), and the
owner's first priority: **no sale is lost if a terminal is interrupted.**

### Added

- **`public/js/cart.js`** — the cart's own module: availability maths and
  persistence. The cart is written to IndexedDB on every change (debounced to
  one write per 200ms) and offered back on the next boot.
- **Recovery prompt.** A terminal that died mid-sale opens with *"Recovered a
  sale in progress — 6 items, $996.50"* and **Resume** or **Discard**. It is
  offered, never silently restored: the cashier may have re-rung it already.
- 24 unit checks in `tests/client-cart.mjs` covering the derived availability,
  the save/restore round trip, a product deleted since saving, a corrupt record
  that would otherwise produce a zero-quantity line, and that saving the cart
  never disturbs the rest of the stored config.

### Changed

- **The catalog mirror is no longer mutated.** The register used to decrement
  `product.onHand` and splice `product.serials` as lines went in. Availability
  is now derived — `serverOnHand − quantityInCart` — and the shelf figure on
  each tile repaints with the cart.
- `productTile()` takes an `available` figure from the caller rather than
  reading `onHand` itself.

### Fixed

- **A crash used to lose stock permanently.** Units were taken off the local
  mirror when added to the cart and returned only by an explicit remove, which
  a crashed tab never reaches. A serialized phone could disappear from the
  terminal's stock entirely.
- **A sync mid-cart could drift the figures.** `pull()` replaces product objects
  wholesale; the open cart held stale references, so displayed stock and the
  quantities the cart would restore could disagree. Deriving availability at
  render time removes the class of bug rather than patching it.

### Removed

- `lineRemove()` and `inCartSerial()` — both existed only to undo mutations
  that no longer happen.

## [1.20.0] — 2026-09-10

Closes the last outstanding item from the interface-v2 spec: every screen now
renders its structure from `components.js` instead of hand-rolling it. Adds the
permanent project credit.

### Added

- **`screenHead()`, `sectionHead()`, `statRow()`, `rankRow()`, `rankList()` and
  `dataTable()`** in `components.js`. Each takes escaped-by-default text fields
  plus an explicit `*Html` field for the cases where a screen composes its own
  markup — keeping the two apart is what stops "it needed markup here" from
  quietly becoming an unescaped value somewhere else.
- **"An AYiN Advisors Project"** as a permanent footer on the app shell and on
  the customer display.
- 27 unit checks for the new components, including that a `rankRow` index of
  **zero** still renders (zero is a real count on the inventory-alert rows).

### Changed

- **All 12 screens now use `screenHead()`.** The same header block had been
  written out twelve times.
- `staff.js`, `dashboard.js`, `reports.js` and `inventory-tools.js` use
  `dataTable()`, `statRow()`, `rankList()` and `sectionHead()` in place of their
  own copies — 9 rank rows, 6 tables, 3 stat rows and 4 section heads
  consolidated.
- Screens keep building their own `<tr>`s: `dataTable()` owns only the wrap, the
  head and the numeric alignment, which is what actually repeated. Forcing every
  table through one row model would have made the code worse, not better.

### Verified

Every one of the ten reachable screens was walked in-browser after the sweep and
renders with its header and zero JS console errors.

## [1.19.0] — 2026-09-10

Last of the three interface-v2 releases. Cash leaving the drawer is now
attributable by reason — the question "how much went out as staff expense this
month?" is answerable from the ledger instead of by reading every note.

### Added

- **Two new transaction kinds, `pickup` and `expense`**, beside the existing
  `payout`. All three are cash out, all three carry the same admin/manager
  guard, and they differ only in the reason recorded:
  - `payout` — Paid out (a supplier or a bill)
  - `pickup` — Cash pick-up (to the bank, the safe, or the owner)
  - `expense` — Staff expense (cash reimbursed to a member of staff)
- **Three launcher tiles**, each with its own icon and its own dialog wording
  — who the money went to is asked differently for a vendor, a bank run and a
  staff reimbursement.
- `reports_` gains `summary.pickups`, `summary.expenses` and `summary.cashOut`;
  `netRevenue` now subtracts all three reasons.
- The Drive export gains **CASH PICK-UP** and **STAFF EXPENSE** lines beside
  PAID OUT, and NET CASH subtracts all three.
- `createCashOut({ kind, ... })` in `money.js` (with `createPayout` kept as a
  thin wrapper), `CASH_OUT_KINDS`, and `kindInfo` entries for both new kinds.
- `dayTotals()` splits `payouts` / `pickups` / `expenses` and totals `cashOut`;
  `signedNet()` treats all three as money out.
- The dashboard's "Paid out" KPI becomes **Cash out**, with the three-way split
  beneath it.
- 16 new sim checks and 9 new client checks: each kind keeping its own identity
  rather than collapsing to `payout`, the role guard applying equally, zero
  amounts refused, reports splitting correctly, the drawer losing the cash for
  all three at shift close, and NET CASH reconciling against its own lines.

### Changed

- `processPayout_` generalised to `processCashOut_(…, kind)`, dispatched via a
  new `isCashOutKind_()`; `CASH_OUT_KINDS` on the server carries the labels the
  customer ledger prints.
- `shiftClose_`, `transactions_` gross profit, and the ledger labels all ask
  `isCashOutKind_()` instead of testing for `payout` by name.

### Compatibility

Existing `kind: 'payout'` rows are untouched and keep meaning *paid out*.
Nothing migrates, and a terminal still running an older shell can only ever
send `payout`, which the server continues to accept exactly as before.

## [1.18.0] — 2026-09-10

Second of the three interface-v2 releases: the Sell screen and the charge
screen. The running total stops disappearing.

### Added

- **Pinned cart bar** on phones and tablets — count, running total and Charge,
  above the tab bar, updating as items go in. Its body opens the full cart
  sheet; its button charges. It renders nothing at all when the cart is empty.
- **`catColor()`, `categoryChip()`, `productTile()` and `cartBar()`** in
  `components.js`, with 18 unit checks: colour stability per category, chip
  active state, out-of-stock and IMEI badges, serialized items counting serials
  rather than a stale `onHand`, services carrying no stock figure, and every
  rendered field escaped.

### Changed

- **Adding an item no longer throws a sheet over the catalog.** The cart sheet
  is now opened deliberately, and is only re-rendered while it is already open.
  Desktop keeps its side panel, unchanged.
- **Product tiles** — category colour as the identifying chip, a two-line name
  clamp so long names stop breaking the grid, a larger price, and clearer stock,
  IMEI and Locked badges.
- **Category chips** carry the category's colour as a dot, matching the
  launcher's language.
- **Checkout** — the line list collapses behind a `N items · total` summary that
  expands on tap, **Amount due** becomes the largest figure on the screen, and
  Complete Sale is the only action styled as primary (Add tender is secondary).
- `catColor()` had a second copy in `inventory.js`; both now import one.

### Fixed

- **The remove button in the cart has never worked.** Its handler read
  `b.dataset.key`, but the ✕ carries its key in `data-remove`, so the line
  lookup never matched and the click did nothing. `lineRemove()` also restored
  stock without deleting the line from the cart. Both fixed: removing a line now
  removes it, restores the stock, updates the bar, and closes the sheet when the
  cart empties.

### Note

The spec called for out-of-stock tiles to be "dimmed and non-tappable". They
ship dimmed but still tappable, because tapping raises a toast naming the item
and why it cannot be sold. A dead control teaches nothing, and the premise of
this redesign is that nothing should have to be learned.

## [1.17.0] — 2026-09-10

First release of the interface-v2 rebuild
(`docs/superpowers/specs/2026-09-10-pos-interface-v2-design.md`): the shell and
its navigation. The app opens on Sell, and one large button opens a flat grid
of every job the signed-in account can do.

### Added

- **`public/js/nav.js`** — the navigation model. One list of destinations plus
  `primaryTabs()`, `menuTiles(role)` and `isRestricted(id, role)`. Pure, so the
  shape of the app's navigation is asserted in tests rather than discovered by
  tapping around a phone.
- **`public/js/components.js`** — `ICONS`, `icon()`, `tile()`, `tileGrid()`,
  `navButton()` and `appHeaderHtml()`: destinations rendered as markup. `ui.js`
  keeps primitives that know nothing about this app; this is the layer that
  knows what a destination is.
- **The launcher** (`public/js/screens/menu.js`) — one flat grid of big
  labelled tiles, colour chip and icon, **no group headings and no submenus**.
  Ten tiles for an admin or manager (Refund, Paid Out, Time Clock, Customers,
  Products, Alerts, Purchases, Reports, Dashboard, Settings); a cashier sees the
  three their role permits. Role gating removes a tile rather than disabling it.
- **App header** — store name, a live clock, one connectivity indicator with the
  queued-push count, and a user chip that opens Settings. Rendered once for the
  whole app instead of per screen.
- **`public/js/money-dialogs.js`** — `openPayoutDialog(ctx, onDone)`, lifted out
  of `dashboard.js` so the launcher's Paid Out tile opens Paid Out instead of
  dropping someone on a screen to hunt for a button.
- 37 unit checks in `tests/client-nav.mjs` covering the model and the markup:
  tab count and order per role, cashier scoping, unknown roles falling back to
  cashier rather than admin, every destination having an icon and a label that
  fits, and every rendered field being escaped.

### Changed

- **Three-item bottom bar — Menu · Sell · History** — replacing ten destinations
  in a horizontally scrolling strip. Menu is left-most, thumb-nearest and
  visually heavier, and carries the inventory-alert count so a manager sees it
  without opening the launcher. Every target is now 125×61px on a 375px phone.
- **Both navs render from the model.** The same ten buttons used to be written
  twice in `index.html`, once per nav, which is how they drifted — the sidebar's
  alerts badge carried a different id from the tab bar's. `index.html` drops
  ~100 lines of duplicated inline SVG. Adding a destination is one line in
  `nav.js`.
- **The desktop sidebar lists every destination flat**, in the launcher's order,
  with no headings — the two navigations are one list in two shapes.
- **The app opens on Sell**, not the dashboard.
- `applyRoleTabs()` asks the model instead of hard-coding a list of restricted
  ids.
- The register's own connectivity pill is gone; the header owns it, so two
  indicators can no longer disagree.

### Fixed

- **Desktop shell layout** — at ≥1024px `.app` is a flex row, so a bare header
  became a 240px column beside the sidebar rather than a bar above the content.
  The header and screen now share a `.main` column, which also survives the
  rail toggle changing the sidebar's width.

### Removed

- The v1.14.0 horizontal-scroll rules on `.tabbar` and the `scrollIntoView` call
  that went with them. Both existed only to fit ten destinations on a phone.
- The dead `.scr-status` rules.

## [1.16.0] — 2026-09-10

Store localisation. The app used to print every figure as US dollars while the
till was counted against a fixed ₦1000/500/200/100/50/20 ladder — a drawer
reconciled against a currency it did not hold. A store now says what language,
country and currency it trades in, once, at first run.

### Added

- **First-run store setup** (`public/js/screens/store-setup.js`) — the first
  admin to reach the dashboard of an unconfigured workbook is asked to choose
  **language, country and currency**, and gets the cash ladder that currency
  circulates. Picking a country fills in its currency and notes; a live sample
  shows what a price will read before anything is saved. Reachable afterwards
  from **Settings → Store → Language, country & currency**.
- **Store localisation in the backend** — `getStore_()` gains `locale`
  (BCP-47), `country` (ISO-3166), `currency` (ISO-4217), `denoms` (the cash
  ladder) and `configured`. `/api/admin/store` (admin only) validates and
  writes each of them; `/api/config` now also returns the **currency
  catalogue** the setup dialog offers, so the client can never present a
  currency the server would reject. 18 currencies ship with default ladders,
  and any ladder can be replaced with the store's own.
- **`setMoneyFormat()` / `getMoneyFormat()` / `currencySymbol()` /
  `denomLabel()`** in `ui.js`. `fmt(n)` keeps its one-argument shape — every
  screen calls it — but now formats through the store's locale and currency.
  Boot, login and every sync pull install the store's choice, so a terminal
  never prints last week's currency after an admin changes it.

### Fixed

- **The till counted notes the store may not hold.** `shiftDenomsValue_` had
  the ₦ ladder hard-coded, and the close-shift dialog rendered `₦` labels
  regardless of the store. Both now use the store's ladder, and a quantity sent
  for a denomination that is **not** in it is ignored rather than trusted — a
  terminal cannot inflate a declared drawer by inventing a note. The ladder
  sums in integer cents, so a coin ladder cannot produce
  `0.15000000000000002`.
- **The payout and collections dialogs said ₦** whatever the store traded in.
  Both now label the amount with the store's own currency symbol.
- **`/api/admin/store` reset settings it was not asked to change.** It read
  `num_(payload.taxRate)` unconditionally, so a call that meant to change the
  time zone silently set the store's sales tax to zero. Every field is now
  optional and only written when sent.

### Known limitation

The locale drives **formatting** — currency, number grouping, dates. The
interface copy itself is still English; translating it is a separate piece of
work (a string catalogue plus a pass over every screen) and is written up in
`HANDOVER.md` §10.

## [1.15.1] — 2026-09-10

Post-review hardening. A full security and usability pass over the codebase
after v1.15.0; this release lands the findings that were cheap and safe to fix
now. The rest are written up in `HANDOVER.md` §11 with what each would cost.

### Fixed

- **Deployment blocker — the CSP forbade the backend.** `connect-src` allowed
  only `https://script.google.com`, but an Apps Script `/exec` call answers with
  a redirect to `https://script.googleusercontent.com`, and CSP is enforced
  against each redirect hop. On any host that actually applies `_headers`
  (Cloudflare Pages does; GitHub Pages ignores the file, which is why this has
  gone unnoticed) every API call would have been blocked with no visible error.
  The redirect target is now allowed.
- **Prototype-shaped data silently corrupted reports and serial intake.**
  `reports_` accumulated into plain object literals keyed by client-supplied
  strings, so a tender type or product category named `__proto__` landed on the
  prototype chain instead of the map — the line vanished from the report — and
  one named `constructor` wrote onto a shared built-in. Worse, `adminSerials_`
  tested duplicates against a plain object, so an IMEI reading `constructor` or
  `toString` was **silently discarded as a duplicate**. All maps keyed by
  operator- or client-supplied text are now `Object.create(null)`. Closes
  acknowledged weakness #5. Regression-tested both ways: the new assertions
  fail against the old code.
- **Two writes still validated against a pre-lock snapshot.** `adminInventory_`
  and `adminProductsPatch_` read the product *before* taking the script lock,
  then wrote inside it — so the serialized/service guards, and the "old value"
  recorded in price history, could describe a row another terminal had already
  replaced. Both now read and write inside one lock, completing the v1.11.0
  lock-scope sweep.
- **Dialogs were a keyboard trap.** Modals and sheets had no `aria-modal`, did
  not take focus, and could not be dismissed with Escape — on the desktop shell
  added in v1.13.0 a keyboard user could tab straight out of an open dialog
  into the register behind it. Escape now closes the top-most dialog, focus
  moves into it on open (never on a touch device, where pulling focus to an
  input throws the keyboard up over the dialog), and the panel is marked
  `aria-modal`.

## [1.15.0] — 2026-09-10

Customer display and the inventory tools that keep a shelf honest: a
second-screen mirror for the shopper, bulk repricing by rule, a stock-take
that records its own variance, printable barcode labels, and a reorder
worksheet driven by real sales velocity.

### Added

- **Customer display** — `display.html` renders a shopper-facing mirror of the
  cart, the checkout breakdown and a thank-you with change due, driven by the
  register over a same-origin `BroadcastChannel` (`public/js/customer-display.js`).
  No network hop, so the mirror keeps working with the shop offline; a
  last-frame copy in `localStorage` paints a display opened mid-sale
  immediately and doubles as the transport where `BroadcastChannel` is
  missing. Settings → **Customer display** turns mirroring on per terminal and
  opens the window — on a **second screen** where the Window Management API is
  granted, otherwise as an ordinary window with an explanation.
- **Bulk price update** — `/api/admin/products/bulk-price` takes a *rule*
  (scope: all or one category, or explicit ids; field: retail or cost; mode:
  percentage / amount / set; optional rounding step) and recomputes each price
  server-side under the script lock, so a stale catalog on a terminal can never
  dictate a price. `preview: true` returns the same change list without
  writing. Every applied change lands in `PriceHistory` with source `bulk`.
- **Stock take** — `/api/admin/stock-take` takes a count sheet, compares each
  line to the on-hand it is about to overwrite (read and write inside one
  lock), writes the counted figure and records expected / counted / variance /
  value-at-cost to a new **`StockTakes`** sheet. Serialized stock and services
  are refused — serials are counted by scanning, not by typing a number — and
  a single bad line rolls the whole count back. The UI counts by scanner
  (scan-then-Enter increments) or by search.
- **Barcode labels** — `public/js/labels.js` implements Code 128-B (no
  third-party script; the CSP forbids one) and renders labels as inline SVG
  with name, code and price. Items are labelled by UPC where they have one,
  otherwise by SKU. 25 unit checks in `tests/client-labels.mjs` verify the
  pattern table symbol by symbol, the modulo-103 check symbol, bar/space
  alternation, escaping and the per-run label cap.
- **Reorder worksheet** — `/api/inventory/reorder` computes units sold over a
  window (refunds give units back), demand per day, days of cover, and a
  suggested quantity that tops the shelf up to a target cover but never below
  the reorder point, priced at the last cost that actually delivered and
  tagged with the supplier and PO that did. Printable, and exportable as CSV.
- **Products → Tools** — one menu for reorder, stock take, bulk pricing,
  labels and aging, instead of five buttons fighting for the header.
- **`public/js/print-sheet.js`** — full-page printing for label sheets and
  worksheets in their own window, so the app's 80mm receipt page geometry is
  left untouched and the register never blinks to hidden mid-print.

### Fixed

- **Security — client CSV export could carry a formula.** `reports.js` quoted
  its cells but did not neutralise a leading `= + - @`, so an item or customer
  name could execute when the export was opened in a spreadsheet. New shared
  `csvCell()` / `csvRows()` / `downloadCsv()` in `ui.js` prefix formula
  characters *and* always quote; reports and customer statements now use them.
  This closes acknowledged weakness #4 in `SECURITY.md`.
- **Customer statement CSV could shift its own columns.** `statementCsv()`
  guarded formulas but never quoted, so a comma in a customer name, note or
  description broke every column to its right. Now quoted and escaped.
- **Service worker served the register to the customer display.** Every
  navigation fell back to `./index.html`, so an offline `display.html` would
  have shown the till-facing app. Navigations now fall back to their own
  document.

## [1.14.0] — 2026-09-10

Screen refresh, an enhanced dashboard, and the staff tools that were missing:
a time clock everyone can punch, per-cashier performance for managers, and a
dashboard that answers "is today good?" instead of only "what is today?".

### Added

- **Time clock** — new `TimeClock` sheet and two endpoints. `/api/timeclock/punch`
  toggles the caller's **own** clock (one OPEN entry per account; punching out
  closes that row in place with the elapsed minutes, never appending a second),
  and `/api/timeclock` lists punches with an `onFloor` count. Nobody can punch
  for anybody else, so an entry is always evidence about the account that made
  it. Double punch-in → 409, punch-out with nothing open → 409.
- **Staff screen** (`public/js/screens/staff.js`, new `staff` tab in both navs)
  — every role gets their own clock card (state, punch button, hours today /
  last 7 days, recent punches) and their shift history. Managers and admins
  additionally get **On the floor** (who is clocked in, and for how long),
  **Team performance** over today / 7 days / 30 days (sales, tickets, avg
  ticket, margin, hours worked, sales per hour) and the **till reconciliation**
  table with a net over/short footer.
- **Dashboard trend chips** — net revenue, ticket count and average ticket
  carry a direction chip against yesterday, and gross profit against the
  trailing 7-day average. A zero baseline prints the absolute move rather than
  a fabricated percentage.
- **Today by hour** — an hourly sales chart for the current day (managers see
  the store, cashiers see themselves), drawn across the trading window only so
  an empty overnight can't flatten the day, with the busiest hour called out.
- **Top sellers table** — the rank list became a real table: units, revenue,
  gross profit and margin %, ranked by revenue over the last 30 days.
- **Shift summary on the dashboard** — open now / closed today / over-short
  today as a stat strip, the three most recent closes, and a jump to Staff.
- **`public/js/stats.js`** — one pure aggregation module (day totals, signed
  net, trends, baseline averages, hourly buckets, trading window, top sellers,
  hours from punches, duration formatting) shared by Dashboard and Staff so
  every surface agrees on the numbers. 36 new unit checks in
  `tests/client-stats.mjs`.
- **`skeleton()` and `emptyState()`** in `ui.js` — one loading placeholder that
  holds the layout, and one empty state (glyph, what's missing, why, and the
  action that fills it) for every screen.

### Fixed

- **Security — shift roster leak.** `/api/shifts` honoured `?status=all` from
  any caller, so a cashier could read every other cashier's opening float,
  expected drawer, declared cash and over/short. The parameter is gone; the
  store-wide roster is `isStoreRole_`-gated and a cashier's open-shift count is
  now their own rather than the store's.
- **Touch targets** — buttons, chips, segments, quantity steppers and icon
  buttons all meet 44px; the bottom tab bar scrolls horizontally (64px tabs)
  now that a manager has ten destinations on it, instead of shaving every
  target below the thumb minimum. The active tab scrolls itself into view.
- **KPI grid on phones** — two columns below 560px (three to 900px, four above)
  so a KPI, its figure and its trend line fit without wrapping mid-phrase.

### Removed

- Dead `lowStock()` helper in `dashboard.js`, and the local `topSellers`/`last30`
  copies now that `stats.js` owns them.

## [1.13.0] — 2026-09-09

Theme polish + responsive infrastructure. The desktop terminal finally gets a
real working layout: a persistent sidebar replaces the bottom tab bar, the
register becomes a two-column sales floor (catalog left, live cart right), and
checkout and detail sheets slide in as right-hand panels — while phones and
tablets keep the familiar bottom bar and bottom-sheet flows untouched.

### Changed

- **Theme polish** — layered softer shadows (`--shadow`/`--shadow-sm`/`--shadow-lg`),
  an eased motion curve (`--ease`), consistent `--dur` transitions, stronger
  header blur + saturation, larger rounded search field with a focus ring,
  40px chip touch targets, card hover lift on mouse devices, `:focus-visible`
  outlines, and tabular-numeral alignment on every money figure.
- **Sidebar shell (desktop ≥1024px)** — toggleable app nav replaces the bottom
  tab bar: expanded 240px labels ↔ collapsed 64px icon rail, hamburger in the
  rail header, choice persisted in `localStorage` (`orison:nav`). Role-gated
  tabs, the active pill, and the alerts badge work identically in both navs.
- **Responsive state** — `app.js` now tracks `html[data-viewport]` =
  `mobile`/`tablet`/`desktop` via `matchMedia` and emits `orison:viewport` on
  breakpoint crossings; the register listens and re-mounts its cart slot.
- **Dual-panel register** — on desktop the catalog keeps the left column while
  a sticky 440px cart panel sits right; on phones/tablets the cart still opens
  as a bottom sheet (one shared `bindCart` renderer drives both).
- **Checkout & sheets on wide screens** — checkout renders as a right-anchored
  440px sheet column inside the page; detail/edit sheets slide in from the
  right instead of the bottom.
- **Fixed** — the alerts `tab-badge` was toggling a non-existent `.show` class
  so the counter never appeared; it now toggles `.hidden` correctly in both
  the tab bar and the sidebar.

## [1.12.0] — 2026-09-09

Client unit test harness. The register-side money engine, sync queue, IndexedDB
layer, alert classifier, and UI formatters finally have an automated suite —
previously only the backend was covered (the biggest known test gap).

### Added

- **`tests/client-*.mjs`** — pure-Node unit suites run via `node:test`
  (built-in, zero new framework):
  - `client-money.mjs` — `round2`/`cents`/`clampPct`/`saleTotals`/`kindInfo`
    edge cases (float drift, discount + tax boundaries, taxable-only) and the
    `createRefund`/`createPayout` builders against a mocked sync + fake IDB.
  - `client-sync.mjs` — outbox lifecycle: enqueue→push→SYNCED round-trip,
    offline short-circuit, rejected→VOIDED with local stock restore, unique
    `clientTxId`s, `outboxStats`/`getSyncState` counts, `SYNC_EVENT` name.
  - `client-db.mjs` — `idb` CRUD, `bulkPut` + keyFn, `allByIndex` across the
    `by_upc`/`by_sku`/`by_category` indexes, meta upsert, `open()` singleton.
  - `client-alerts.mjs` — `available`, `reorderThreshold`,
    `inventoryAlerts` (severity sort, aging suppression, defaults),
    `agingBucket`, `bucketLabel`.
  - `client-ui.mjs` — `fmt` (currency rounding), `fmtQty`, `esc` (XSS
    escaping), `debounce` (single-fire + argument passing).
  - `tests/helpers/setup-globals.mjs` — browser-globals shim (`fake-indexeddb`,
    window/navigator/document stubs, `dispatchEvent` recording, fetch mock
    harness) required before importing any client module in Node.
- **`npm run test:client`** and wiring into `test:all`; new `devDependency`
  `fake-indexeddb` (the only addition — `node:test` is built into Node 20+).
- Suites document two float-drift facts about the client `round2`: `round2(±1.005)`
  resolves toward 0 (`±1`) because it is a plain `Math.round`; the *backend*
  `round2_` is sign-safe (half-away-from-zero). A future money-layer alignment
  should flip the client to match.

**Validation:** backend-sim **PASS 359 / FAIL 0** · client units **PASS 154 / FAIL 0** ·
pdf-smoke **PASS 19 / FAIL 0**.

## [1.11.0] — 2026-09-09

Hardening pass: the offline sync path can no longer lie, race, or mis-bucket.

### Fixed

- **VOIDED re-pushes are re-evaluated, not gaslit into "already synced".** A
  sale that failed (locked product, serial claimed elsewhere) is retried fresh
  on every re-push — and when the blocker clears, the success **rewrites the
  original failure in place** (same transaction id, never a second row). A
  retry that still fails reports the fresh reasons against the same id.
- **Same-batch duplicate `clientTxId`s** now resolve like re-pushes: the second
  identical entry answers `ALREADY_SYNCED`, a conflicting one flags
  `DUPLICATE_CLIENT` — in both cases without double-applying.
- **Refunds now see the same batch.** A sale and its refund arriving in one
  request (an offline void) finds the original sale in-batch, and earlier
  same-batch refunds count toward the refundable balance.
- **Gross profit uses the cost captured at sale time** (`unitCost` in the sale
  row), not today's product cost — editing a cost no longer rewrites history.
  Refunds carry the original sale's captured cost too.
- **Category/product breakdowns apply discounts**: line `discountPct` then the
  order-level discount, in rounded cents, on both revenue and profit.
- **Store time-zone-correct day windows.** `Reports` and the Drive export now
  bucket sales by the store's local calendar day (`tzOffsetMin`, settable via
  `adminStore_`); a 23:30 UTC sale in UTC+1 lands on the next local day.
- **Lock-scope fixes.** All reads + validation for purchase-order receiving,
  supplier creation, product/serial CRUD, and shift open/close now happen
  inside the script lock (previously reads/recheck raced a concurrent writer).
- **`round2_` is now a true half-away-from-zero** (sign-safe); dead `uuid_()`
  helper removed; payouts/payments/refunds attribute to the authenticated
  cashier when their session id matches an account; first-run seeding is
  crash-safe against a partial seed re-running.

### Added

- Hardening sim section (18 checks) locking the above, including: aging stays
  gross of store-credit refunds; `config_` roster width is active-only.
- `getStore_`/admin response expose `tzOffsetMin` for the client.

## [1.10.0] — 2026-09-09

Dead stock is now visible before it becomes a write-off.

### Added

- **Inventory aging.** `/api/inventory/aging` (admin/manager) answers "how long
  has this been sitting?" for every stocked item: a product's clock starts at
  creation and re-sets every time a purchase-order receipt brings more in.
- **Products → *Aging* button** (admin/manager): one screen of 0–30 / 31–60 /
  61–90 / 90+ day buckets with unit counts and value-at-cost per bucket, plus
  an oldest-first item list (units left, days sitting, value at cost). The
  summary totals reconcile exactly with the item list.
- Serialized stock ages by **available serial count**, matching how the rest of
  the app counts serialized on-hand.

### Changed

- Nothing — read-only view; receipts already flowed through `PriceHistory`
  since v1.8.0, which is what makes "last in" available for the aging clock.

## [1.9.0] — 2026-09-09

A customer's book can now be handed over as a proper document.

### Added

- **Statement of account.** `/api/customers/statement` (admin/manager) turns
  every completed transaction a customer has touched into a chronological
  debit/credit statement with a **running balance** — sales charged net-30/on
  account debit the account, store-credit refunds and collections credit it.
- **Statement view from Customers** — open a ledger, tap *Statement*, and get
  date / details / debit / credit / balance rows plus the closing balance.
- **Print & CSV.** Print uses the register's 80 mm thermal recipe; CSV exports
  the full statement with formula-injection guard (`= + - @` prefixed) and no
  tax on the export.

### Changed

- Every statement line carries the original reference, the cashier's name, and
  the note — so a disputed balance can be traced back to the till it came from.
- Closing balance on the statement reconciles exactly with the ledger balance
  (one shared walk of the same transaction set).

## [1.8.0] — 2026-09-09

Every price now has a story. Cost and retail changes — whether made by hand in
Product settings or spun into stock by a purchase-order receipt — are recorded
per product, with who, when, and why, and browsed from the Products screen.

### Added

- **Price history.** `/api/price-history` (admin/manager, optional
  `productId` filter, newest first) and a 📈 modal on every product row that
  shows each recorded change as *Retail price / Cost price: old → new* with
  the changer's name and time.
- **Recording happens at every money-touching event:**
  - `create` — baseline cost + retail when a product or service is first added.
  - `patch` — a manual edit from Item settings only records when the value
    actually changed (a no-op save leaves no trace).
  - `po` — receiving a delivery records the **weighted-average cost** update
    (old unit cost → new blended cost), tagged with the purchase order number.
- New `PriceHistory` workbook tab (id, product, field, old_value, new_value,
  source, po_id, changed_by, created_at) — auto-created and header-migrated
  like every other tab.

### Changed

- Item settings / receiving now write the history rows inside the same script
  lock as the product update, so a price change and its audit trail are atomic.

## [1.7.1] — 2026-09-09

Post-review hardening. A full code / process / scope / UX / security review
surfaced a handful of real defects; this revision closes the ones with teeth
and syncs every doc and asset to the latest version.

### Security

- **Refunds are now admin/manager only.** A cashier refund reached the server
  with no role check (unlike payouts and collections), so any signed-in
  cashier could reverse any sale on any device. It now voids with
  `unauthorized_role`, and the client hides the Refund button from cashiers.
- **Role changes revoke sessions immediately.** Demoting someone from admin /
  manager no longer waits up to 12 h for the old token to expire — the change
  kicks their sessions out at the first request after the downgrade.
- `config_()` stops leaking **deactivated** staff into the device roster.

### Money & ledger

- **The Drive export stopped counting purchase receipts as SALES.** Deliveries
  still appear in the CSV detail rows (kind `purchase`) but no longer inflate
  SALES or NET CASH — "a delivery is never drawer math" now holds for reports,
  shifts, and the spreadsheet export.
- **Collections net as money-in on the export.** `kind: payment` rows were
  being lumped into SALES; they now land on their own `COLLECTIONS` line that
  is included in NET CASH, and the dashboard 14-day chart nets them the same
  way instead of subtracting them.

### Assets & delivery

- **Service worker versioned to v1.7.1** and precaching `customers.js`,
  `reports.js`, `purchases.js` — installed terminals pinned to the stale
  v1.2.0 cache will finally upgrade instead of serving an ever-older shell.
- `package.json` version synced to the release line (was 0.2.1) and now wires
  `test:pdf` into `test:all`. `package-lock.json` follows the same release
  number (root + `packages.""` entries).
- **Docs in lockstep with the code**: README, DEPLOY, SECURITY, the backend
  guide, and this changelog all reflect v1.7.x. `AGENTS.md` encodes the
  release protocol so future revisions keep them current automatically.

## [1.7.0] — 2026-09-09

Buy stock like an office and receive it like a warehouse. Suppliers, purchase
orders, and receipts that post inventory in — with a cost that actually
accounts for what you paid.

### Added

- **Suppliers.** `/api/suppliers` (manager / admin) lists and creates vendors
  with phone, email, and payment terms.
- **Purchase orders.** `/api/purchase-orders` builds an order against a
  supplier with product lines, quantities, unit costs, a discount percent,
  expected date, and a note. Orders live as **DRAFT** until placed as
  **ORDERED**, then advance to **PARTIAL** / **RECEIVED** as stock arrives, or
  can be **CANCELLED** from draft or ordered.
- **Receiving.** `/api/purchase-orders/receive` posts what actually arrived:
  `on_hand` climbs, cost updates by weighted average against the current stock,
  serialized lines demand one serial number per unit, and each receipt writes a
  `purchase` row to the ledger so deliveries have a paper trail that never
  touches drawer math. Over-receipts and double-registered serials are refused.
- **Purchases screen.** A manager tab with suppliers, the order list (PO
  number, vendor, status chip, received/ordered counts), a New PO editor
  (product picker prefilled with current cost, live subtotal/total), an order
  detail view, and a receive dialog that validates quantities and serials
  before posting.

## [1.6.0] — 2026-09-09

Every number in the business, on one screen, recomputed from the ledger the
moment you open it — no nightly batch, no cached sheets.

### Added

- **Reports.** `/api/reports` (manager / admin only) answers "what happened in
  this window?" from live transaction rows: gross sales, refunds, payouts,
  collections, net revenue, sales count, units, tax, gross profit, and average
  ticket, filtered to a date range (defaults to the last 30 days).
- **Breakdowns.** Sales by day, by category, by cashier, and by tender — the
  tender view nets refunds back out and treats payouts as cash out, so every
  row agrees with the cash drawer.
- **Rankings.** Top products and top customers by period revenue, with the
  customer's live on-account balance attached.
- **Gross profit.** Line-cost margin recomputed at report time from current
  product costs — so a cost-of-goods correction retroactively fixes history.
- **Reports screen.** A new manager tab with Today / This week / This month /
  Last 30 days / Custom presets, a KPI row, a sales-by-day bar chart, and
  one-click CSV export of everything on screen.

## [1.5.0] — 2026-09-09

Till reconciliation without the spreadsheet gymnastics: open a shift with the
float, close it later by counting the drawer, and the register marks the
over/short against what the POS says the drawer should hold.

### Added

- **Shifts.** `/api/shifts/open` (any role) starts a shift with an opening
  float. `/api/shifts/close` takes a denomination breakdown of the physical
  drawer and reports *declared*, *expected*, and *over / short*. The lifecycle
  is soft on purpose — sales never require an open shift, so a terminal can
  never be locked out.
- **Expected drawer math.** `float + cash sales − cash refunds − payouts +
  cash collections`, scoped to the shift owner's window. One shift, one
  drawer, one person's cash.
- **Dashboard shift card.** Cashiers open and close their shift straight from
  the KPI row, count ₦1000 / 500 / 200 / 100 / 50 / 20 notes with a live total,
  and land on a clear close-out result ("the drawer balances exactly" or why it
  doesn't). Managers see the last five closes with over/short chips and how many
  tills currently sit open.
- `/api/shifts` listing: cashiers see their own; managers see everyone's.
- **Denominations ledgered.** The physical count is stored per shift
  (`tenders_json`) so a disputed close-out can be re-audited against the
  recorded stack.

## [1.4.1] — 2026-09-09

Receivables grow teeth. Managers can record payments against a customer account
and see how old each outstanding dollar really is.

### Added

- **Collections (`kind: payment`).** `/api/sync/push` now accepts a `payment`
  transaction — money in against a customer's account. Admin/manager only (a
  cashier deciding what counts as paid is an accounts hazard), amount must be
  positive, customer must exist. The ledger nets the account and the balance on
  the spot; the **Customers screen** gets a *Collect payment* button on positive
  balances (cash or transfer, optional note) that works offline through the
  queue like everything else.
- **Aging report.** Both the ledger and receivables now bucket the outstanding
  balance by how long it's been owed: current (< 30d), 30–59, 60–89, and
  90+. Payments settle the *oldest* dollars first (FIFO), so a pallet sold in
  January and never paid ages past 90 days no matter how many new sales the
  customer rings up. The Customers screen shows color-coded aging chips; the
  ledger modal dates the oldest dollar still owed.

### Fixed

- **Customer link survived sync.** The checkout picked a customer but
  `enqueueTransaction` never forwarded `customerId` to the push payload — the
  sale was recorded without its customer. Now the picker's link actually lands
  (it also persisted in the local transaction record).

## [1.4.0] — 2026-09-09

Customers are people, not rows. The store can now attach any sale (especially
Net-30 terms) to a named customer and watch the ledger balance build.

### Added

- **Customers workbook tab + API.** `/api/admin/customers` creates a customer
  (name, phone, email; admin/manager). `/api/customers?q=` searches name,
  phone, or email for any signed-in role — the reply never carries balances.
- **Sale → customer.** Checkout has a customer search box (optional). Managers
  can create a customer inline. A sale linked to a customer that doesn't exist
  is rejected rather than silently writing an unmatched receivable.
  Net-30 terms now require a customer to be picked first.
- **Customer ledger** (`/api/customers/ledger`, admin/manager). Every
  transaction against a customer plus their money state:
  - *account* — what they owe: net-30 / on-account tenders.
  - *credit* — store credit held: refunds to store credit, minus credit spent.
  - *balance* = account − credit (positive means they owe the store).
- **Customers screen** (admin/manager). Total outstanding receivables up top,
  a searchable list of every customer with a balance, and a per-customer
  ledger modal on tap.
- **Name on the receipt and in History.** Charged sales print the customer's
  name, and transaction details everywhere show who the sale belonged to.
- Refunds inherit their sale's customer automatically.

### Security

- Balance figures (ledger + receivables) are admin/manager-only. Cashiers can
  look a customer up and attach them to a sale, but never see what they owe.

## [1.3.1] — 2026-09-09

Profit visibility, derived from the cost already tracked on each product —
and kept out of cashiers' hands. Cost is snapshotted per sale line at the
moment of the sale, so retroactively editing a product's cost never rewrites
historical profit.

### Added

- **Gross profit in the API.** Each transaction now reports its cost total and
  gross profit (net revenue minus cost, with refunds counted negative). Only
  admins and managers ever see the figures, and only when they read via the
  role-aware transactions endpoint.
- **Dashboard "Gross profit today"** KPI (admin/manager) and per-product
  margin next to revenue in Top sellers.
- **History detail.** Transaction modals show a Gross profit line, and each
  line item's cost basis is included in the manager's view.
- **Drive exports carry margin.** The CSV detail gains `cost` and
  `gross_profit` columns, and the summary block adds `TOTAL COST` and
  `GROSS PROFIT` rows — store copies only. A cashier's report is unchanged.

### Changed

- Line cost is captured at sale time into each pushed item, preserving the
  profit picture for historical reports even if costs change later.

### Security

- Margin, cost columns, and unit costs are gated behind the store role
  (`admin`/`manager`). A cashier receives no cost data in the API, history, or
  their own CSV export.

## [1.3.0] — 2026-09-09

Staff accounts are no longer hand-edited in the Users sheet.

### Added

- **Settings → Staff** (admin only): add a staff member, pick their role,
  reset a forgotten PIN, or deactivate a leaver.
- **One-time PIN on creation.** The server generates a fresh 6-digit PIN,
  returns it once to the creating admin, and never stores it — the sheet holds
  only the salted hash. Staff are told to change it at their own terminal.
- **Settings → Change PIN** (everyone): rotate your own sign-in PIN (verified
  against the current one); all of your terminals are signed out on change.
- **Deactivation.** Turning a staff member off immediately signs them out on
  every device and marks their terminals revoked, so a lost terminal cannot
  quietly re-login. Admins cannot deactivate or demote themselves.
- New backend endpoints `/api/admin/users` (create), `/api/admin/users/list`
  (roster, no credential material), `/api/admin/users/patch` (role / active).

### Changed

- The roster endpoint omits anything credential-shaped — identity, role, and
  active state only.

## [1.2.7] — 2026-09-09

### Added

- **Sync-conflict email alerts.** Whenever a sync push lands a new conflict row
  in the Conflicts tab, one coalesced email digest is sent to every active admin
  and manager. The message names the store and the conflict count, and lists each
  conflict's type, serial, device, loser client tx, and winning tx. A mail
  failure never fails a sale — the send is wrapped so the push still succeeds.

### Changed

- Conflict digests are emitted once per push (not once per row), so a burst of
  conflicting offline sales produces a single "N new sync conflict(s)" message.

## [1.2.6] — 2026-09-09

Discounts and sales tax, computed in integer cents so the register and the
server agree to the cent. Adds per-line and per-order percentage discounts,
taxable flags on products, and an administrator-set store tax rate.

### Added

- **Line discounts in the cart.** Each cart line has a quick-tap discount:
  Off / 10% / 15% / 20% / 25% / 50%. The discounted line price shows inline
  with the original struck through.
- **Order discount at checkout.** The cashier enters an order-level discount %
  (0–100), with a live Subtotal / Discount / Tax / Total due breakdown. The
  order percent prorates across all lines and is applied before tax.
- **Store sales tax.** Admins set a tax rate (0–100%) in Settings → Store; it is
  shown in checkout and on receipts. Taxable/non-taxable is a per-product flag
  (defaults on for existing products), editable in Inventory.
- **One money engine, mirrored.** `saleTotals()` in `public/js/money.js` mirrors
  `saleTotals_` in `backend/Code.gs` exactly (integer cents with a float-dust
  epsilon), so the displayed total is the total the server records.
- History shows the Subtotal / Discount / Tax split and per-item discount
  badges; receipts carry the breakdown too.

### Changed

- Sales pushed to the server now carry an envelope `discountPct` plus per-item
  `discountPct`; the server computes authoritative totals and stores `subtotal`,
  `tax_amount`, and `discount_pct` on the transaction row.
- The backend rejects any `/api/admin/store` `taxRate` outside 0–100.
- Pre-1.2.6 offline-queued sales (no `discountPct` on the envelope) keep their
  client totals and stay untaxed — never retroactively taxed.
- CSV export now includes a `tax` column and a `TAX COLLECTED` summary.

## [1.2.5] — 2026-09-09

Closes the last big credential gap: the offline sign-in fallback no longer
stores anything recoverable to a staff PIN.

### Security

- **Opaque offline credential replaces the cached PIN hash.** Offline login
  previously compared against an unsalted SHA-256 of the PIN left in the
  device's IndexedDB — six digits is a million candidates, so anyone who read
  that storage recovered the PIN essentially instantly. The server now issues a
  fresh 256-bit opaque key at every sign-in; the client stores only that key,
  and nothing on the device is derived from, or reveals, the PIN. It is
  per-terminal (login already submits the terminal id) and the session-expired
  handler wipes the whole vault once an admin's revoke reaches the device.
- Legacy `offlinePins` hashes are deleted from storage on the first sign-in
  after upgrading.
- Behavioural note: offline sign-in is now gated by the credential, not by a
  PIN check — server-side PIN verification happens only online, where it can
  actually be throttled.

## [1.2.4] — 2026-09-09

Finest-grained revocation yet: admin can cut off a **single lost terminal**
instead of every session a staff member holds. Extends the 1.2.3 token
revocation with per-device tracking and a sign-in block that survives the cache
marker's lifetime.

### Security

- **Per-device revocation.** Each login now submits the terminal's stable
  `deviceId`; the backend records it in a Devices sheet tab and stamps the
  issued token with a `dev` claim. Two layers kill a device: a per-device
  CacheService marker rejects its current tokens, and a `revoked` flag on the
  device row refuses sign-in from that device **even with the correct PIN** —
  which is what keeps a lost terminal dead after the 25 h marker lapses.
- **Terminal registry.** Settings' Security card (admin) lists a staff member's
  terminals with first/last-seen, lets the admin match the short id against
  each device's Settings → Terminal ID, then revoke just that one — or fall
  back to revoking all sessions, which now also flags every device row so no
  terminal can quietly re-login later.
- Device rows are also refreshed on `sync/pull` (max once per 10 minutes per
  terminal) so the registry stays live without a write on every request.

## [1.2.3] — 2026-09-08

Hardening for the portable-terminal rollout: a Content-Security-Policy on the
static site, and revocable session tokens so a lost device can be cut off
without rotating the shared `SESSION_SECRET`.

### Security

- **Token revocation.** Sessions were stateless HMAC tokens that could only be
  invalidated by expiry. Each token now carries an `iat`, and the backend keeps
  a per-user "revoked at" marker in CacheService (25 h TTL, longer than the 12 h
  token life); `verifyToken_` rejects any token issued before the marker. A user
  signs out (revoking their own sessions), an admin kills a staff member's
  sessions from Settings, and a PIN change or reset revokes every prior session.
  See [SECURITY.md](SECURITY.md#session-revocation).

- **Lost-device reflex.** The client now watches for 401s on any request outside
  login: a revoked or expired token clears the stale session and sends the
  terminal back to sign-in instead of silently carrying on.

- **Content-Security-Policy.** `public/_headers` now ships a strict policy
  (`default-src 'none'`; scripts, styles, images, fonts, workers and manifest
  all `'self'`; `connect-src` limited to `'self'` and `script.google.com`;
  `frame-ancestors 'none'`), with no third-party origins to accommodate. See
  [SECURITY.md](SECURITY.md#content-security-policy). The stale "no CSP" note
  in the known limitations is gone.

### Added

- `POST /api/logout` — revokes every active session for the calling user
  (called by Settings → Sign out).
- `POST /api/admin/revoke` — an admin revokes all sessions for a staff email,
  from a new Security card in Settings. This is the action for a lost device.
- Backend simulation coverage of revocation (revoke gating, post-revoke
  rejection, sign-out invalidation, PIN-change invalidation, admin PIN-reset
  invalidation). The suite goes from 125 to 138 checks.

### Changed

- `signToken_` payloads now include `iat`; all tokens issued before this
  version remain valid (they have no `iat`, so the revocation check skips them)
  until they expire naturally.

## [0.2.1] — 2026-09-06

Security release covering the login path. No feature work, and nothing is
deployed from this repository yet, so no live account was ever exposed.

### Security

- **Published credentials.** `SEED_USERS` shipped four accounts with
  production-shaped `@orisonigt.com` addresses and the PINs `1234`, `3456`,
  `5678`, `9012`, seeded into the Users sheet on first run — and the README
  published them as a table, in a public repository. `seed_()` now generates a
  random 6-digit PIN per account and reports it once to the execution log;
  committed fixtures use `example.com` so they can never name a real mailbox.

- **Unthrottled PIN guessing.** `login_()` compared a salted SHA-256 of the PIN
  and issued a 12-hour session token, with no counter, delay or lockout anywhere
  in the backend — searching all 1,429 lines for `rate`, `lockout`, `attempt`,
  `throttle` or `backoff` returned nothing. Against a 4-digit PIN that is a
  10,000-candidate space an attacker can simply walk, and the resulting token
  authorizes the admin product, inventory and Drive-export endpoints, on a Web
  App reachable by anyone holding the URL. Five failures now lock the account for
  15 minutes. See [SECURITY.md](SECURITY.md#login-throttling).

- **PIN keyspace.** Seeded PINs went from 4 digits to 6, a hundredfold larger
  space. The generator draws from the hex positions RFC 4122 leaves random and
  uses rejection sampling: harvesting digits from a v4 UUID inherits its fixed
  version nibble, which — measured over 200,000 samples — made PINs end in `4`
  17.1% of the time instead of 10%.

### Fixed

Defects in the throttle itself, each found by review after the first
implementation and each covered by a test that fails against the commit before
it:

- **The counter never tripped under load.** `recordLoginFailure_` did an
  unlocked read-modify-write on Script Properties, and a Web App serves requests
  concurrently, so parallel guesses all read the same count and all wrote `n=1`.
  Failures are now one property per attempt, which needs no lock and loses no
  writes.
- **Taking the lock broke the client.** The lock added to fix the above sat
  behind `syncPush_`, which holds the script lock for seconds, so a failed login
  could exceed the client's 8-second timeout — which `api.js` maps to
  `err.offline` and `login.js` turns into the offline-PIN fallback, leaving a
  cashier silently offline instead of seeing the error. The same applied to
  `ensureSeed_`, which took the lock on **every** request to check a condition
  true once in a deployment's life; it now checks before taking it.
- **The lockout was shorter than advertised.** The window was measured from the
  first failure, so four failures at the start and a fifth just before it
  elapsed bought a lockout of about a second. It now runs from the most recent
  failure.
- **The store filled up.** Expired records were deleted only when the same
  address was looked up again, so one failure each against many addresses left a
  permanent property behind for every one — until the ~500 KB Script Properties
  store filled and `setProperty` began throwing, taking `SESSION_SECRET` and
  `SPREADSHEET_ID` writes with it. Expiry is now a sweep across all addresses,
  with a ceiling and per-account eviction.
- **Eviction released lockouts.** Once over that ceiling the sweep dropped the
  globally oldest markers, so roughly a thousand one-off failures against
  throwaway addresses deleted a locked victim's markers and handed them a clean
  slate — an attacker using the defence to undo itself. Eviction is per account,
  and skips accounts that are currently locked.
- **Delays billed the runtime quota.** A growing `Utilities.sleep` on each
  failure consumed the script's daily runtime and held a simultaneous-execution
  slot; roughly 1,350 failed logins would have exhausted a consumer account's 90
  minutes and taken the backend offline. Removed — the attempt cap is what
  bounds an attacker anyway.

### Added

- `POST /api/pin` — any signed-in user changes their own PIN, presenting the
  current one. Seed PINs are written to the execution log, which Apps Script
  retains, so this is what makes them stop working.
- `POST /api/admin/pin` — an admin sets a staff member's PIN and clears any
  lockout. This is the recovery path if the workbook is ever recreated, which
  reseeds and rotates all four starter PINs.
- `POST /api/admin/unlock` — an admin or manager releases a lockout from the
  till, rather than a shift waiting on someone to open the Apps Script editor.
- [SECURITY.md](SECURITY.md), covering the authentication model, the throttle
  and its known tradeoff, PIN handling, and the shared `APP_TOKEN`.
- Backend simulation coverage of all of the above. The suite goes from 71 to 109
  checks.

### Changed

- `npm test` runs the backend simulation only, which needs nothing external.
  `npm run test:all` adds the browser suite.
- `tests/e2e.mjs` takes both PINs from `E2E_PIN` and `E2E_CASHIER_PIN` and skips
  cleanly when they are absent, rather than failing. It no longer echoes a PIN
  into stdout and `tests/e2e-run.log` — harmless when that was `1234`, not now.

### Known limitations

- The lockout is keyed per account, and Apps Script exposes no client address,
  so someone who knows a staff email can keep that account locked by failing
  against it. `/api/admin/unlock` exists because of this. See
  [SECURITY.md](SECURITY.md#login-throttling).
- `APP_TOKEN` is one shared secret held by every device. Sessions are now
  revocable per user, but the app token itself still is not. See
  [SECURITY.md](SECURITY.md#the-shared-app-token).
- The offline sign-in fallback compares against an **unsalted** SHA-256 of the
  PIN cached in IndexedDB, which is trivially reversible for a 6-digit PIN by
  anyone who can read the device's storage. See
  [SECURITY.md](SECURITY.md#offline-behaviour).
