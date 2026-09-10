# Changelog

All notable changes to Orison POS are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
