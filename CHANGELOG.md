# Changelog

All notable changes to Orison POS are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.58.0] — 2026-09-25

Two Tier-0 gaps in one release, because they are one story: the profit and
loss and the cash position both stop being fiction.

### Added

- **Running costs** (Menu → Running Costs, manager and admin). Rent, power,
  the phone bill, the accountant, bank charges. Until now the only money-out
  this system knew was petty cash from the till, so the P&L read revenue,
  cost of goods and pocket money, and net income was fiction.
  - Ten categories, each with its own account in the books (6300 Rent through
    6390 Other running costs), so an accountant gets a chart they recognise.
  - Paid by **cash from the till, bank transfer or cheque** — cash comes off
    the drawer count, a transfer does not touch it.
  - Who was paid, the reference, a note. Listed newest first with totals by
    category for any period, filterable, exportable as CSV.
  - An admin can **void** one with a reason; it stays on record and leaves
    every total and the books.
  - Reports gains *Running costs* with a per-category split; the day export
    gains a **RUNNING COSTS** line.
  - **Petty cash is untouched:** *Paid out* and *Staff expense* stay exactly
    as they are — the till's own small movements.
- **Banking the cash** (Menu → Bank the Cash, manager and admin). A cash
  pick-up moved notes from the till into a bag and the books called it *Cash
  in transit* — then nothing ever moved them on, so that account grew for ever
  and the balance sheet showed a large imaginary asset.
  - A deposit says the bag reached the bank: Cash in transit becomes money in
    the bank, against the paying-in slip.
  - **What is in transit is derived, never stored**: every pick-up less every
    deposit that has not been voided. The shop cannot bank more than it is
    carrying.
  - Reports gains *Banked*; the day export gains a **BANKED** line. An admin
    can void a deposit, and the money is carried again.
- **Demo:** the sample shop now pays rent, power, phone, marketing and bank
  charges, and banks $200 of its takings.

### Fixed

- **The profit and loss listed a fixed set of expense lines**, so the ten new
  accounts would have been inside the total and invisible on the screen — the
  same shape of bug that hid Wages in v1.56.0. The books now return every
  expense account that moved in the period, and the screen renders whatever it
  is given.

### Note

Recurring bills that post themselves are deliberately not modelled. A bill
nobody looked at is a bill nobody checked, and a POS that invents transactions
is worse than one that waits to be told.

## [1.57.0] — 2026-09-24

### Added

- **Opening balances** (Accounts, **admin only**). A shop that switches to this
  system on a Tuesday already has stock on the shelf, notes in the drawer and
  money in the bank. Until now the books opened at zero and the balance sheet
  claimed the shop owned nothing — wrong from the first hour, and wrong in
  every comparison afterwards.
  - The Accounts screen says so plainly when they have not been set, with the
    way to fix it beside the wrong numbers.
  - **The stock figure is offered, not asked for**: what is on the shelf right
    now at cost, on the same basis the books and the Stock health screen use,
    so the three can never disagree. The admin can override it.
  - It posts one entry dated as of that day — Dr Cash, Dr Bank transfers,
    Dr Inventory, Cr **3000 Opening balance equity** (a new account).
  - **It is not a movement.** No sale, no drawer, no shift, no Reports figure
    and no line on the day export changes. Net income is untouched.
  - Entered once. If it was wrong, an admin **voids** it with a reason (kept on
    record) and enters it again.
  - `/api/opening-balances` and `/void`, admin only. New `OpeningBalances`
    sheet. Audited as `opening.set` / `opening.void`.
- **Demo:** the sample shop now opens with $300 in the till, $14,500 in the
  bank and its stock at cost, so its balance sheet is a real one.

### Note

The books are period-scoped, as they always have been: an opening entry
belongs to the period containing its date. A report for a later month shows
that month's movements, not the opening position.

## [1.56.0] — 2026-09-24

### Added

- **Payroll** (Menu → Payroll, **admin only**). The time clock already knew who
  was on the floor and for how long; now it turns into what the team is owed,
  and into the books.
  - **A rate per person** (Time Clock → *Pay rate*): by the hour, or a monthly
    salary. Only an admin can see or set it — a manager runs the floor, not the
    payroll, and the staff list carries no pay at all for anyone else.
  - **A pay run** for a period (last month, this month so far, the last seven
    days, or any dates). Hourly staff are paid the minutes their clock
    **closed** inside the period; a shift still open is worth nothing yet and
    the line says so, however many minutes sit on it. Salaried staff are paid
    their monthly figure. Nobody without a rate is on the run.
  - **Adjustments** on any line while the run is a draft: a bonus, a deduction,
    an advance already handed over — each with a reason, kept on the line and
    audited. A deduction cannot take a line below zero.
  - **Paying it** records one wages entry — cash from the till, a bank transfer
    or a cheque (with its reference). Cash comes off the drawer the shift
    expects; a transfer does not touch it.
  - **Voiding a run** (with a reason) takes its money back out of the drawer,
    Reports, the day export and the books, exactly as voiding a supplier
    payment does. The run stays on record with the reason.
  - `/api/payroll`, `/detail`, `/line`, `/pay`, `/void`, all admin. New
    `PayRuns` sheet; `Users` gains `pay_type`, `pay_rate`, `pay_updated_at`.
    Audited as `payroll.draft` / `payroll.adjust` / `payroll.pay` /
    `payroll.void`.
- **The books gained account 6200 Wages**, and the wage bill now shows in
  Reports (*Wages paid*), the day export (*WAGES PAID*), the drawer, the
  dashboard net and the P&L as its own line.

### Fixed

- **The P&L hardcoded which expense accounts it summed**, so an account added
  later would have been silently missing from net income. It now sums every
  expense account in the chart except cost of goods sold, which is already
  inside gross profit.

### Deliberately not modelled

Statutory overtime multipliers, end-of-service gratuity, pension and tax
withholding. Those are jurisdiction rules that change, and a wrong automatic
number is worse than an honest manual one: they go on the run as an adjustment
with a reason, where the accountant can see why.

## [1.55.2] — 2026-09-24

### Fixed

- **Every step on a serial's trace read "Step".** The timeline's chip passed a
  kind where the label function expected a whole step, so *Intake*, *Sale*,
  *Refunded & restocked*, *Repair* and *Trade-in bought back* all fell through
  to the generic word. The label now takes either, and a client test holds
  both call shapes.
- **The Reminders panel never appeared at all.** The Dashboard read `.data`
  off a payload that `api.get()` had already unwrapped, so the panel was
  always empty and hid itself — v1.55.0's headline feature has been invisible
  since it shipped, while every server-side test for it passed. Found by
  opening the demo, not by reading the code.
- **A clickable reminder row carried two `class` attributes**, so the second
  one — the pointer affordance — was dropped by the parser and the rows did
  not look clickable.
- **The Dashboard re-read the whole ledger on every load.** `/api/reminders`
  scans every transaction, customer and repair, and the Dashboard asks for it
  each time a manager or admin opens the home screen. It is now cached for two
  minutes per store; the refresh button asks for `fresh=1` and rebuilds, so
  the reminder list is never stale when somebody actually checks it. A payload
  too large for the cache is served uncached rather than failing.

### Added

- Client tests for the two screens that had none: the reminders panel (it
  renders a payload, hides itself on nothing, and writes one class attribute)
  and the serial trace's step labels.

- **The shelf's value is now tied to the books by a test.** A delivery
  received at a discount is valued on the Stock health screen at exactly what
  the books debited to Inventory for it, and selling one takes its own cost
  off — not its list price.

### Changed

- **`.gitattributes`:** git stores LF whatever the checkout does. Four files
  committed from a Windows checkout during v1.51.0 → v1.55.0 had flipped to
  CRLF, which made `style.css` show 3,446 changed lines for a two-line edit.
- Docs that had fallen behind the code are current again: the `AGENTS.md`
  baseline, the check counts in `README.md` and `backend/README.md`, and the
  demo guide, which said nothing about the five lifecycle screens.

## [1.55.1] — 2026-09-24

### Fixed

- **Serial trace no longer falsifies a device's life.** VOIDED transactions
  are excluded from the timeline instead of rendering as real steps, so a
  void doesn't look like a sale that happened.
- **Average sale divides by sales only.** The Customer 360 profile's
  `averageSale` counted every completed transaction (refunds, payments and
  trade-ins) as a "sale the customer made"; it now divides by sales the way
  the Sales report does, so one refund can't drag the average toward the
  wrong number.
- **The trace search can't run on a stale query.** Pressing Enter (a barcode
  scanner's keystroke) raced the 200ms debounce and searched the previous
  value; the button now reads the input at press time.
- **Repair statuses translate on the trace.** The status slug from the server
  was used as a translation key and fell back to English; the trace now uses
  the same labels as the Repairs screen.
- **Malformed dates can't blank the trace or leak raw HTML.** `date()` threw
  on unparseable input and `shortDate()` returned the raw string unescaped;
  both now guard and fall back cleanly.
- **Hardenings in the review pass:** profile maps use null-prototype objects,
  the seeded serial-insert path stamps `created_at`, and two dead variables
  were removed.

## [1.55.0] — 2026-09-24

### Added

- **Lifecycle reminders** (`/api/reminders`, admin and manager): what the shop
  should act on, derived from data already captured — no new settings, no
  schedules, no notifications outside the app.
  - **Warranty expiring.** Every active warranty ending within the next 30
    days, with the customer, the device and its expiration date.
  - **Repairs ready.** Every ticket at *Ready for collection*, with days
    waiting, the customer and the deposit held.
  - **Upgrade candidates.** Customers of serialized brand-new devices
    (`warrantyDays` covering at least a year) sold 24+ months ago, whose
    warranty has since expired — grouped by customer with what they own.
  - **Store credit left.** Customers still holding store credit and how much,
    so a liability isn't forgotten.
  - Each list is capped at the 25 most pressing entries; every figure reuses
    the Sales-report money rules and the Warranty screen's status answers.
- **Reminders panel on the Dashboard.** A single read-only panel for admin
  and manager, loading when an online staff tab opens the Dashboard, with one
  tap into the Sales report, Repairs, Warranty lookup and Customers screens.
  The panel simply hides when the remotes feed is unreachable, so an offline
  till still opens.
- **Demo & tests:** the sim seeds two reminder customers and a ready repair
  (a warranty expiring in weeks, a device sold far past its cover, a deposit-
  held repair, and a store-credit refund) and asserts list membership, exact
  customer/device/deposit values, the 25-item cap, and the cashier/admin/
  manager role guards. All reminder figures share the profile's derivation.

## [1.54.0] — 2026-09-24

### Added

- **Customer 360 profile** (`/api/customers/profile`, admin and manager):
  everything the shop knows about one customer on one screen.
  - **Who they are and what they're worth.** Total spent, net of refunds,
    visits (every completed transaction that named them), average sale, first
    and last visit, what they owe on account, what they hold in store credit,
    their overall balance, and their credit limit — money figures following
    the same rule as the Sales report (gross completes at the till, refunds
    reduce it).
  - **The devices they bought, with their warranty cover.** Every serialized
    unit on their completed sales, priced what they paid, with the same
    warranty answer as the Warranty screen — active/expired/refunded, the
    expiry date and days left. Refunded units are covered nothing.
  - **Their repairs.** Open tickets on the bench (intake through ready) and
    collected repairs with what they cost, joined on the repair's customer.
  - **The ledger they see.** The same credit/account/balance plus aging
    buckets and the last 100 transactions — behind the same admin/manager
    gate as the ledger and statement.
- **Profile screen on the client.** Customers → *Ledger* now loads the full
  profile: summary grid, balance with aging chips and actions, the devices
  list, open and collected repairs, and the ledger — instead of just the
  numbers.
- **Demo & tests:** the sim drives a full profile (serialized warranty sale,
  account sale, store-credit refund, a repair booked to the customer) and
  asserts the summary, the device warranty status, repairs, ledger rows and
  aging; plus the role and 404 guards and a second-customer cross-check
  against the seeded ledger numbers.

## [1.53.0] — 2026-09-24

### Added

- **Serial / IMEI lifecycle trace** (`/api/serials/trace`, admin and manager):
  one IMEI or serial number, and its whole working life on one timeline.
  - **Every leg a serial has walked.** Intake (PO or trade-in, with the value
    paid), the sales that carried that exact unit, refunds that brought it
    back into stock, repair tickets filed against that device, and trade-ins
    where the store bought it back — ordered oldest to newest from the ledger.
  - **Immutable intake stamp.** Each serial now records when it entered the
    store (`created_at`) on every intake path — PO receive, trade-in intake,
    and manual serial entry. Buy-back of a unit already sold here keeps the
    original intake stamp, so a bought-back serial is one serial, not two.
  - **Screen and export.** The new Serial Trace screen (Stock & customers)
    traces by IMEI or serial with a read-only step table; no bookkeeping
    mutation, same role guard as stock health.
- **Demo & tests:** the trade-in sim section now traces serials and asserts
  the timeline shape, ordering, a single intake stamp, and the role guard.

## [1.52.0] — 2026-09-24

### Added

- **Inventory velocity** (`view=velocity` on `/api/inventory/health`, admin
  and manager): how fast each line actually sells through, how hard the money
  tied up in it is working, and when its next reorder makes sense.
  - **Sell-through and turnover.** Ledger units and revenue against the
    on-hand now on the shelf: `perDay`, `daysOfCover`, and `turnover` (net
    revenue ÷ average shelf value over the window; `null` at ≤ 0 revenue) give
    a movement number for every product and category. `avgShelfValue` uses the
    absorbed cost this shelf is carrying, so turnover is money-driven, not
    unit-driven.
  - **Buy again.** A line is a buy-again when it actually out-sold what came
    back in (`netUnits > receivedUnits`), and the shelf now needs the restock
    (`onHand === 0`, or current cover is shorter than the window). Idle or
    refund-swamped lines are never buy-agains.
  - **Window and view.** `days` (1–365) is clamped like the health view, and
    the client adds a 90-day preset. The screen toggles Health ↔ Velocity
    without losing its filters, and CSV export gains a velocity layout
    (`orison-stock-velocity.csv`).
  - **Same guardrails as health.** Serialized lines count serials in stock,
    services and inactive products are excluded, turnover is never negative,
    and no client or server code ever hides or discounts a product.
- **Demo:** velocity exercises the existing health fixtures (the sim health
  section's products double as velocity shops).

## [1.51.0] — 2026-09-24

### Added

- **Stock Health** (`/api/inventory/health`, admin and manager): what the whole
  shelf is worth at retail and at cost, and how fast each product actually
  sells. This is the first delivery of the inventory-and-customer-lifecycle
  program; plan in
  `docs/superpowers/plans/2026-09-24-inventory-and-customer-lifecycle-program.md`.
  - **Valuation is on the ledger, not the cache.** Units sold and revenue come
    from `Transactions`; on-hand comes from the catalog; serialized stock is
    valued at known serial costs with unallocated units at the product cost.
  - **A manager picks the window** (30/90/180/365 days, default 90). `perDay`
    is ledger units against window days, and `daysOfCover` is current on-hand
    divided by that. Movement is reported, never applied: `slow` (cover > 180
    days, or ≤ 1 unit sold in the window) and `dead` (0 units sold in 180 days)
    appear on the screen and in the CSV, and no client or server code ever
    hides or discounts them.
  - **Screen** (Menu → Stock Health, admin/manager): KPI tiles (cost value,
    retail value, units, slow, dead), per-category aggregation, product table
    sorted by cost value, movement chips, and CSV export with stable English
    columns and spreadsheet-safe quoting.
- **Demo:** no changes this version (stock health reads the existing ledger).

## [1.50.0] — 2026-09-22

### Added

- **Parts a job is waiting for.** A repair that needed a part the shop did not
  have could only be marked *Awaiting parts*: what it was waiting for lived in
  the technician's head, Purchases could not see it, and when the box arrived
  nobody knew which job it freed.
  - **On the ticket** (*Waiting on parts*): record the part, how many, and a
    note ("black, with frame"). Each line says where the part actually is —
    *On the shelf*, *On order* with the order number and its expected date, or
    *Nobody has ordered it*.
  - Recording the first part moves a ticket at intake or diagnosed to
    **Awaiting parts**, so the board says what the job is doing.
  - **Fit it** takes the part off the shelf onto the job in one tap, and the
    line comes off the waiting list with it. Fitting the last one moves the
    ticket from *Awaiting parts* back to *On the bench*.
  - **In Purchases** (*The bench is waiting for*): every open job's parts,
    grouped by part, with what is needed, what is on the shelf, what is on
    order and how short the shop is — and which tickets are waiting.
    **Order what is short** opens a purchase order filled in from it.
  - **Raising that order marks the jobs**, so each ticket shows the order it
    is on and when it is due. Cancelling the order puts them back to waiting.
  - **Receiving stock says which jobs can go ahead**, oldest request first and
    only as far as the delivery actually covers.
  - `/api/repairs/needs` (any signed-in role: it is the bench's own list).
    Without a payload it returns the whole board; with one it adds or drops a
    line. `/api/repairs/parts` takes a `needIndex` to answer a need as it
    fits. `/api/purchase-orders` takes `linkNeeds`; `/receive` returns
    `unblocked`. New Repairs column `needs_json`. Audited as `repair.need`.
  - **Nothing is reserved.** A part a job is waiting for can still be sold at
    the counter — the board shows what is on the shelf against what the bench
    wants so the clash is visible, rather than quietly holding stock back from
    a paying customer.
- **Demo:** two jobs on the bench are waiting for parts — an iPhone screen
  that is on the order due Friday, and a Pixel charge port nobody has ordered.

## [1.49.0] — 2026-09-17

### Fixed

- **A delivery is owed what the supplier will invoice.** An order's discount
  and its tax were ignored when stock was received, so an order on 5% trade
  terms showed about 5% more owed than the invoice would say, and the tax on it
  was never owed at all.
  - **The discount is now in the cost of the stock.** A line ordered at 10 on a
    10%-discount order comes in at 9: that is what it cost, so that is the
    weighted-average cost, the cost written on a serial, and the cost the
    margin is worked out against.
  - **The order's tax is owed, but is not stock cost.** It is treated as input
    tax the store reclaims, posted to *Sales tax / VAT payable* (2000) rather
    than to Inventory. A store that cannot reclaim its purchase tax should
    leave the order's tax at zero and carry the tax in the line costs.
  - **A part delivery carries its share of both**, worked out as what the order
    owes once the delivery has arrived less what it owed before. However many
    deliveries an order arrives in, the amounts add up to exactly the order's
    own total, and the last delivery carries the rounding.
  - Receiving shows what the delivery will be owed before it is posted, and
    splits stock from tax when the order has tax on it. A purchase order's
    lines show their cost after the discount.
- **A fully delivered order stayed on PARTIAL** when its lines arrived in
  separate deliveries: a line finished by an earlier delivery was not counted,
  so the order never reached *Received*.
- **A delivery of only some of an order's lines went against the wrong lines.**
  What had arrived was read off by position, so receiving the second line of an
  order showed the quantity against the first. Receiving now matches a delivery
  to its line by product.
- **The receive dialog would not take a line at zero**, so a delivery of only
  part of an order could not be entered at all. A line left at zero is now a
  line that did not arrive; at least one has to have.
- **The daily export counted stock bought as cost of goods sold**, and counted
  the tax on a receipt as tax the shop had collected. *TOTAL COST* is now what
  was sold (stock received and trade-ins bought are not), and *TAX COLLECTED*
  is tax on sales only.
- **Serials received on a purchase order now carry what they cost** (`cost`,
  `source: po`), so an IMEI's profit is its own rather than the product's
  current cost price.
- **The test suite left the store an hour ahead of UTC**, which failed every
  "today" section of the backend sim for the hour before midnight UTC. The
  clock is put back after the check that needed it.

## [1.48.0] — 2026-09-17

### Added

- **Paying suppliers** (Purchases). Accounts payable used to only grow: stock
  received was owed and nothing recorded paying for it.
  - **What is owed.** Purchases opens with *Owed to suppliers* and *Overdue*.
    Each supplier card shows their balance and any overdue amount.
    - A supplier is owed what was delivered less what was paid.
    - The overdue part is deliveries past the supplier's terms ("Net 30" is
      30 days; no terms means due on delivery), less payments made, oldest
      first.
  - **Supplier account** (tap a supplier):
    - received, paid, owed and overdue
    - each order's received, paid and owed, marked *Paid*, *Part paid* or
      *Unpaid*
    - a statement of deliveries (with due dates) and payments (with method,
      reference, order and who paid), with a running balance
  - **Record payment** (`/api/suppliers/payment`, admin and manager): bank
    transfer, cheque or cash from the till, for one order or on account.
    - A transfer or cheque needs its reference.
    - It cannot pay more than is owed on the order or to the supplier; the POS
      holds no supplier credit.
    - An order's detail shows its payment state and a *Pay* button.
  - **Void a payment** (`/api/suppliers/payment/void`, admin, with a reason).
    The row is marked VOIDED, so it leaves every total while staying on
    record. It is audited as `supplier.payment` / `supplier.payment_void`.
  - `/api/suppliers/payables` and `/api/suppliers/statement` (admin, manager).
- **The new server-only ledger kind `supplier_payment` is counted everywhere
  money is classified:**
  - Shift drawer: cash payments come out.
  - Day export: a *SUPPLIERS PAID* line; cash leaves the drawer.
  - Reports: *Suppliers paid*, apart from sales and expenses; the cash tender
    goes down.
  - Books: Dr Accounts payable, Cr Cash or Bank transfers. Bank and cheque
    tenders map to account 1020.
  - Dashboard net and History label.
- **Linking receipts to suppliers.** Purchase receipts now record their
  supplier and order (new Transactions columns `supplier_id`, `po_id`).
  Receipts from before are traced through their `po-<id>` client id, or the
  supplier name.
- **Demo:** Swift Supplies is owed $110, all overdue, after a $100 part
  payment, so the flow can be tried straight away.

### Fixed

- **Managers could not open Purchases.** The supplier list was admin only and
  the screen could not load without it, so a manager could not receive stock
  from the screen. Reading suppliers is now open to managers; adding one stays
  with the admin, whose *+ Supplier* button is the only one shown.

## [1.47.0] — 2026-09-16

Sprint B of team feedback on the demo: "reports should be more detailed and
have a dedicated sales report function".

### Added

- **Sales report** (Menu → Insights → *Sales Report*; `/api/reports/sales`).
  - **Filters:** period, staff member, category, product, payment method,
    channel, customer, and sales/refunds. The choices come from the period, so
    picking one never empties the others. A "Clear n filters" button resets
    them.
  - **Headline figures:**
    - net sales, sold and refunded
    - sales and refund counts, average sale, items per sale
    - units sold and returned, tax (with tax refunded), discounts given
    - gross profit and margin (managers and admins)
  - **Breakdown by** day, hour of the day, staff member, category, product,
    payment method, channel or customer. Each row shows sales and refund
    counts, units, sold, refunded, net, gross profit, margin and share.
    Tapping a staff member, category, product, payment method, channel or
    customer applies that filter.
  - **The sales themselves:** every sale and refund (newest first, 100 at a
    time) with time, receipt, staff member, customer, items, payment, total
    and gross profit.
    - Opening one shows its lines: quantity, price, discount, tax, total, cost
      and profit, with how it was paid, the channel, and for a refund the
      receipt it reverses.
  - **Exports:**
    - *Summary CSV*: the headline figures and the breakdown.
    - *Sales CSV*: one row per sold or returned line, in the till's local date
      and time, up to 5,000 sales. Text is formula-safe; money stays numeric,
      refunds included.
    - *Print*: a clean page without the navigation.
  - **Cashiers** can open it for **their own sales only**. The server forces
    the staff filter, and cost, profit and margin are never sent.
- **Line-level money.** A sale's discount, tax and cost are shared across its
  lines in whole cents (largest remainder), so the lines always add back to
  the sale exactly. A category or product filter shows only that part of a
  mixed basket, and marks the row *part*. An item-less refund is kept as one
  line.
  - The simulator reconciles gross sales, refunds, tax, discounts and gross
    profit with Reports, and net sales before tax with the books, over the
    whole day's ledger. It checks that every transaction's lines add back to
    the cent, and that every grouping adds up to net sales.
- **Reports, in more detail.**
  - *By staff member* (was *By cashier*) adds each person's sales count,
    average sale, items per sale, refunds and margin (`byCashier` gains
    `grossSales`, `refunds`, `refundCount`, `avgSale`, `itemsPerSale`,
    `margin`, `userId`).
  - A new *Sales by hour of the day* chart (`byHour`).
  - Every breakdown has a *Details* link to the Sales report for the same
    period and grouping, and the header has a *Sales report* button.
  - The Reports CSV gains those columns and a `BY_HOUR` block.

### Fixed

- **A new screen now opens at its top.** The screen scroll area kept the
  previous screen's position, so opening a screen from a long one could land
  halfway down it.

## [1.46.1] — 2026-09-16

### Added

- **Every category tile on the Sell screen has an icon**, drawn in the
  category's colour on a light tint of it.
  - Categories are the shop's own words, so the icon is chosen by matching the
    words in the name (`categoryIconKey()` in `components.js`).
  - There are 17 kinds: phones, tablets, laptops, monitors, audio, wearables,
    cables, power, storage, gaming, cameras, networking, smart home, services,
    accessories, pre-owned and printers.
  - A name that matches none of them gets a price tag.
  - "Headphones" is audio and "Used iPhones" is pre-owned. Both rules are
    tested.
- Category tiles are a little taller to fit the icon.

## [1.46.0] — 2026-09-16

Sprint A of team feedback on the demo: "the main interface is too cluttered;
the products should show under the category" (plan:
`docs/superpowers/plans/2026-09-16-declutter-and-sales-report.md`).

### Changed

- **The Sell screen opens on the categories.**
  - Each category is a large tile in its colour, with how many products it
    holds and, when some are sold out, how many are available.
  - Tapping a category shows its products, with an *All categories* back
    link.
  - Search and barcode scans still find any product from any view, labelled
    with its category.
  - The category chip row is gone. `public/js/catalog.js` holds the pure view
    logic, with a new client test.
- **Quieter Sell screen.**
  - The title is *Sell*; the terminal ID and cashier line is dropped.
  - Product tiles inside a category no longer repeat the category label.
- **Discounts fold away.** A cart line shows a small *Discount* control
  instead of six buttons. Picking a discount folds the choices back into a
  chip such as *15% off*.
- **Grouped navigation.** The sidebar and the Menu screen group destinations
  under *Counter*, *Cash*, *Stock & customers*, *Insights* and *Team*, with
  Settings last, instead of one list of twenty.
  - A role with eight destinations or fewer (a cashier) keeps one short list
    without headings.
  - `navGroups()` in `nav.js` drives both, and is tested.

### Fixed

- **The navigation and header now rebuild when a different user signs in.**
  Before, the sidebar was built for whoever was signed in when the app
  started. A manager or admin signing in after a cashier (or on a fresh
  start) did not get their extra entries in the sidebar, and the header's
  initial stayed blank.

## [1.45.1] — 2026-09-16

### Changed

- **The register's cart floats at the right of the screen** on wide screens
  (1024px and up).
  - It is a card pinned between the header and the footer, and only as tall as
    its lines need. An empty cart is a small card.
  - Past the space available, the lines scroll inside it, and **Total and
    Charge never leave view**.
  - Its width follows the screen: `--cart-w: clamp(320px, 30vw, 420px)`.
  - The catalog keeps a gutter of that width, so the cart never covers a
    product, a category chip or the search box.
  - `register.js` measures the visible screen on load and on resize, so a
    taller header or the scrollbar cannot push it out of place.
  - In Arabic and Urdu it mirrors to the left, with the sidebar on the right.
- In the floating card, each cart line puts the name beside its price and
  remove button, the quantity under the name, and the discount buttons on one
  row across the line.

### Fixed

- **The Charge button could not be reached on a full cart.** The old sticky
  cart could be taller than the visible screen, which put its total and Charge
  button below the fold.

## [1.45.0] — 2026-09-16

A demo the Orison team can test without a deployment.

### Added

- **Demo build** (`demo/`, `npm run build:demo`, published to GitHub Pages at
  https://punjabitaz-ctrl.github.io/orison-pos/).
  - **Backend:** the unchanged `backend/Code.gs` runs in the browser on an
    emulator of the Google services it uses (`demo/gas-emulator.js`).
    - Sheets, Script Properties, Cache, Lock, Utilities (SHA-256 and HMAC
      implemented synchronously, checked against Node crypto), Drive, Mail
      and triggers.
    - State is saved to the browser's localStorage.
  - **App:** the app from `public/`, with one hook in `api.js`. When
    `globalThis.ORISON_DEMO` is set, requests go to the in-page backend.
  - **Sample shop** (`demo/seed-demo.js`), built through the real API routes
    as the staff who would do it:
    - four accounts with fixed demo PINs (admin, manager, two cashiers)
    - about 50 products, six customers (one buying on account), two weeks of
      sales, a refund, cash out and a payment on account
    - a received and an open purchase order, an open till shift
    - three repairs, a trade-in, and a built-in marketplace sheet with three
      orders waiting
  - **Demo guide** (the yellow DEMO tab): one-tap sign-in as each role, things
    to try, a viewer for the demo marketplace sheet, and **Reset demo data**.
  - `docs/DEMO.md` is the team's test guide.
  - `.github/workflows/demo-pages.yml` runs the demo checks and publishes the
    site on every push to `main`.
- `tests/demo-build.mjs` (`npm run test:demo`, 28 checks): the emulator's
  crypto, all four sign-ins, a session surviving a reload, the sample data
  (the books balance with no rounding and agree with Reports), the marketplace
  import, and the built site.

### Fixed

- **Sync pull never stored products or staff on a terminal.** This dates from
  v1.1.0. `pull()` passed the unresolved Promise from the async
  `mergeProducts()` to `bulkPut`, which threw "values is not iterable". The
  sign-in screen swallows pull errors, so a real terminal would have shown an
  empty register. Browser tests had hidden it by seeding IndexedDB directly;
  the demo found it. A new client test covers it.

## [1.44.0] — 2026-09-13

Owner decisions: **trade-ins yes, layaway no.** The cost basis is the standard
one: a traded-in device costs exactly what the shop paid for it, recorded on
that IMEI.

### Added

- **Trade-ins** (`/api/tradein`; Menu → *Trade-In*). The shop buys a used
  device from a customer.
  - **Seller identification:**
    - the seller must be a customer
    - the ID that was checked is recorded: driving licence, passport, national
      ID or other
    - only the **last 2 to 6 characters** of the ID are stored, never the whole
      document number
  - **Device details:** the IMEI, the product it goes into (it must be tracked
    by IMEI), its condition (like new, good, fair or faulty) and notes.
  - **Payment:** cash from the drawer, or store credit the seller can spend
    straight away.
  - **Who can do it:** admins and managers directly. A cashier needs a manager's
    approval bound to the IMEI and the amount, single use, like refunds.
  - **Duplicate protection:** an IMEI already in stock is refused. A device the
    shop sold before is bought back onto its existing serial row, and its old
    sale can no longer be refunded.
  - Every trade-in is numbered `Orison-T000001` and audited
    (`tradein.create`), naming the approver when there was one.
- **Trade-in register** (`/api/tradeins`, admin and manager). It lists date,
  device, seller with the ID checked, condition, amount paid and how, and
  whether the device is still in stock, with search.

### Changed

- **Cost per serial.** Serials gain `cost` and `source` columns.
  - A traded-in unit's cost is used when it is sold, fitted as a repair part
    or refunded.
  - Stock-aging value counts it at that cost, not at the product's average.
  - A refund from a basket holding two units of one product now restocks each
    unit at its own captured cost.
- **Used devices carry at most 30 days' warranty** when resold, even on a
  product set to one year. Brand-new units of the same product keep their
  year.
- The new `tradein` ledger kind is counted everywhere money is classified:
  - **Shift drawer:** cash paid out.
  - **Customer store credit, ledger, statement and receivables:** credit
    owed.
  - **Reports:** trade-ins bought, kept separate from sales; the cash tender
    goes down.
  - **Drive export:** a *TRADE-INS BOUGHT* line, with the drawer going down.
  - **Books:** Dr Inventory, Cr Cash or Store credit.
  - **Dashboard net:** money out.
  - Terminals cannot push a trade-in; it is a server-only kind.
- `.field select` is styled like other inputs in every form.

## [1.43.0] — 2026-09-13

Sprint 3, the last of the warranty, marketplace and accounting program. Owner
decision: **accounting follows generally accepted accounting principles, in the
app, with no external platform.**

### Added

- **The books** (`/api/accounting`, admin only). Double-entry accounts are
  derived from the ledger for any period, so they cannot drift from the sales
  they describe. The basis is accrual:
  - A sale is revenue when made, whether paid in cash, on account or through a
    marketplace that settles later.
  - Cost of goods sold is recognised with the sale, at the cost captured when
    it was sold.
  - A repair deposit is a liability until it is applied.
  - Tax collected is a liability, never revenue.
- **Chart of accounts.**
  - Assets: 1000 Cash, 1010 Card clearing, 1020 Bank transfers, 1030 Cash in
    transit, 1100 Accounts receivable, 1150 Marketplace receivable, 1200
    Inventory.
  - Liabilities: 2000 Sales tax / VAT payable, 2100 Customer deposits, 2200
    Store credit, 2300 Accounts payable.
  - Revenue: 4000 Product sales, 4010 Service sales, 4100 Sales returns.
  - Expenses: 5000 Cost of goods sold, 5100 Inventory shrinkage, 6000 Paid out,
    6100 Staff expenses, 6900 Rounding.
- **One balanced journal entry per event:**
  - **Sales:** tenders are debited to their accounts, and change handed back
    comes off cash. Revenue is split into products and services, tax goes to
    tax payable, and cost moves from inventory to cost of goods sold.
  - **Refunds:** sales returns plus the share of tax in the refund are debited,
    and the refund method is credited. The unit goes back to inventory at its
    cost.
  - **Paid out, staff expenses and cash pick-ups** (to cash in transit).
  - **Payments on account, deposits taken, and deposits refunded.**
  - **Stock received** from a purchase order goes to inventory and accounts
    payable.
  - **Stock-take differences** go to shrinkage.
  - Everything is posted in cents. An entry that does not balance to the cent
    is squared to Rounding and counted.
- The endpoint returns the **profit and loss** (net sales, gross profit,
  expenses, net income), the **trial balance**, **balance movements** for
  cash, receivables, inventory, tax, deposits, store credit and payables, and
  the **journal**.
- **Accounts screen** (Menu → *Accounts*, admin). It has period presets, a
  balance check, the P&L, balance movements, the trial balance and the latest
  50 journal entries, plus **Journal CSV** and **Trial balance CSV** exports
  with stable English column names for accounting software.

### Fixed

- **Reports gross profit after a refund.** A refund used to take the returned
  units' cost off gross profit, so a full refund left a sale showing a loss of
  its cost. It now takes off the refunded margin: the refund less the tax in
  it, less the cost restocked. This is the same rule the books use, and the
  simulator reconciles the two.

## [1.42.0] — 2026-09-13

Sprint 2 of the warranty, marketplace and accounting program. Owner decision:
**marketplace sync is driven by a Google Sheets file**, not a platform API.

### Added

- **Marketplace orders from a Google Sheet.** An admin pastes the sheet's link
  in Settings → *Marketplace orders* (`/api/marketplace/settings`).
  - The POS checks it can open the sheet, creates an **Orders** tab with the
    template headers if it is missing, and remembers the admin as the account
    that scheduled imports run under.
  - Template columns: *Order ref · Date · Channel · SKU · IMEI / Serial ·
    Quantity · Unit price · Status · Note*.
- **Import** (`/api/marketplace/import`, admin and manager; *Import now* in
  Settings), plus an hourly trigger installed once with
  `installMarketplaceTrigger()`.
  - Rows with an empty Status are grouped by order reference.
  - Each order is checked before anything moves: the SKU exists (in any
    case), services are refused, an IMEI is required for serialized stock with
    one per row, and quantities are whole.
  - **Quantity must be on hand, counting earlier orders in the same run.**
  - Each order is pushed as one sale through the same path as a till: stock
    comes off the shelf, IMEIs are claimed first-committed-wins, and a receipt
    number is issued.
  - It records the channel (from the Channel column, default `marketplace`),
    the order reference, a `marketplace` tender and the platform's price, with
    **no POS tax added** because the platform collects it.
  - Every row gets its **Status** written back: *Imported Orison-S…*, *Already
    imported* or *Error: reason*, plus a timestamp in *Note*.
  - Re-running is safe. An order's id is derived from its reference, so
    clearing a Status re-imports as *Already imported*, and that order is never
    re-checked against the stock it already took.
- **Stock tab.** Every run rewrites a **Stock** tab with SKU, name, available
  (0 when locked) and price, so listings can follow the shelf.
- Imports and sheet changes are audited (`marketplace.import`,
  `marketplace.settings`). The settings card shows the last run, and a failed
  scheduled run is recorded rather than thrown.
- **Marketplace** is a tender name on receipts, in History and in reports.

## [1.41.0] — 2026-09-13

Sprint 1 of the warranty, marketplace and accounting program. Plan:
`docs/superpowers/plans/2026-09-13-warranty-marketplace-accounting-program.md`.
Owner decision: warranty is **30 days, or 1 year for brand-new hardware**.

### Added

- **A warranty on every product.** The choices are *1 year — brand-new
  hardware*, *30 days* or *No warranty*, set on the product's create and
  settings forms (`Products.warranty_days`).
  - New products default to 30 days and services to none. Products with no
    setting yet read the same way, so nothing sold earlier loses cover.
  - Changing a product's warranty is audited and applies to future sales only.
- **The warranty is captured on the sale line** (`warrantyDays`) and runs from
  the sale date. A refund line carries none.
- **Receipts print the cover** under each line that has it, for example
  "1-year warranty until Sep 13, 2027". This applies on the screen, full-page,
  Bluetooth and ESC/POS receipts, and in shared text.
- **Check warranty** (Repairs screen, any role) looks up an IMEI, serial or
  receipt number through `/api/warranty` and shows each covered line. Its
  status is *Under warranty until …*, *Warranty expired* or *Refunded — no
  warranty*.
- **Repairs know about warranty.** Booking in a device we sold records its
  warranty status, end date and receipt on the ticket. The ticket shows it,
  and the booking toast says when the device is still covered.

## [1.40.0] — 2026-09-13

Sprint 5 of the staff-gaps program: tax jurisdictions. The United Arab Emirates
is added alongside the United States.

### Added

- **Tax jurisdiction** (Settings → Store, admin):
  - **United States**: sales tax added on top of shelf prices, as before.
  - **United Arab Emirates**: VAT included in shelf prices, and the receipt is
    a **Tax Invoice**.
  - **No tax**.

  Store settings gain `taxJurisdiction`, `taxRegNo` and `pricesIncludeTax`.
  Choosing the UAE adopts 5 % VAT and VAT-inclusive prices unless a rate or
  flag is given in the same call. A shop set up for the UAE country at first
  run starts under UAE VAT. The change is audited as `store.settings` with the
  fields that changed.
- **Tax-inclusive pricing** in the money engine, on both server and client:
  - The customer pays the shelf price, and the VAT is the part of it that is
    VAT: `gross × rate ÷ (100 + rate)` on taxable lines, after discounts.
  - Transactions record `tax_inclusive` and `tax_rate`, so a reprint or a
    report reads the sale as it was rung.
  - Repair invoices follow the same rules.
- **UAE tax invoice.** The receipt is titled *Tax Invoice* and carries:
  - the shop's address and **TRN**
  - the customer's TRN when one is on file
  - *Total incl. VAT*, followed by *VAT included (5 %)*

  The roll, full-page, Bluetooth-image and ESC/POS renderers all print the
  title. The TRN must be 15 digits.
- **Customer TRN.** Customers gain `trn`, set at creation or from *Credit limit
  & TRN* on the ledger. It is validated as 15 digits in the UAE and audited
  when changed.
- **Warnings in Settings** when a UAE store has no TRN, or trades in a currency
  other than AED (a UAE tax invoice shows VAT in AED).
- **Reports** label the tax line *VAT collected* in the UAE.

### Fixed

- **Gross profit counted VAT as profit.** It would have done so on any
  tax-inclusive sale. It now excludes the tax inside the price (sale, reports,
  category and product revenue, Drive export).
- **Gross profit rounded the order discount to whole currency units.** For
  example, 10 % of 99.99 was taken as 10, not 10.00 (`saleNetExTax_`, in
  cents). One reconciliation test had encoded the old rounding and was
  corrected.

## [1.39.0] — 2026-09-13

Sprint 4 of the staff-gaps program: what managers could not do.

### Added

- **The team, for managers.** Staff → *Team* lists everyone active, using
  `/api/admin/users/list`, which is now open to managers and still carries
  nothing credential-shaped.
  - **Unlock** lets a locked-out colleague sign in again. The server already
    allowed managers to do this; there was no button.
  - **Reset PIN** is for cashiers only when a manager uses it. Only an admin
    resets a manager's or an admin's PIN. Audited as `user.pin_reset`.
- **Correct a punch.** Staff → *Team punches* → *Correct*
  (`/api/timeclock/correct`, admin and manager).
  - Sets clock-in or clock-out, recomputes the minutes, and closes an open
    punch.
  - A reason is required. A punch cannot be in the future, end before it
    starts, or run past 24 hours.
  - Nobody but an admin corrects their own hours.
  - The entry is marked *corrected*, and the audit log (`timeclock.correct`)
    keeps the original times.
- **Close a forgotten shift.** Staff → *Shifts still open* → *Close shift*
  (`/api/shifts/force-close`, admin and manager), with a required reason.
  - With a denomination count, the over/short is real.
  - Without one, the shift closes as *not counted*: expected cash is still
    worked out, but declared and over/short are left empty rather than
    invented.
  - Records who closed it (`closed_by`). Audited as `shift.force_close`.

### Changed

- Shift close and force close share one expected-cash calculation
  (`shiftExpectedCash_`).
- The till reconciliation table shows *not counted* for a shift closed without
  a count.
- New columns: `Shifts.closed_by`, `TimeClock.corrected_by`.

## [1.38.0] — 2026-09-13

Sprint 3 of the staff-gaps program: what cashiers could not do.

### Added

- **Cashiers can create customers**, at checkout or through
  `/api/admin/customers`, which is now open to any signed-in role and audited
  to whoever made the customer. Only a manager or admin can give a credit limit
  at creation. Ledgers, statements and collections stay manager-only.
- **Balance at checkout.** Picking a customer shows what they owe, their credit
  limit and how much headroom is left. The data comes from
  `/api/customers/balance` (any role), which returns totals only and no ledger
  lines.
- **Credit limits.** Customers gain `credit_limit`, where 0 means no limit.
  - Managers set it from the customer's ledger via
    `/api/admin/customers/patch`, which also corrects name, phone, email and
    note, and is audited as `customer.update`.
  - At push, a Net-30 charge that would take the customer past the limit is
    refused with `credit_over_limit`, unless it carries a `credit` approval
    covering the overage.
  - Earlier sales in the same batch count toward the limit, so splitting a
    charge cannot slip under it.
  - Checkout shows the overage in red and asks for approval when the sale is
    completed.
- **Several approvals on one sale.** A transaction can carry
  `approvals: { discount, credit }`, so a sale that is both heavily discounted
  and past a credit limit needs both. A single `approval` still works.
- **Whole-shop lookup.** A cashier's History has a *Whole shop* switch that
  searches every sale and refund in the shop (`lookup=1`, at least four
  characters, 20 results). Other tills' sales are marked, and cost and margin
  are never included. Cash-outs are never returned. Refunding one still needs
  an approval.
- **History shows who approved** a sale or refund.

### Changed

- `/api/customers` search results and the customer ledger carry `creditLimit`.

## [1.37.0] — 2026-09-13

Sprint 2 of the staff-gaps program: manager approval and discount limits.

### Added

- **Manager approval on the cashier's screen.** A manager or admin enters
  their own email and PIN, and the cashier stays signed in.
  - `POST /api/approve` checks the PIN under the same throttle as sign-in and
    returns a signed approval.
  - The approval is bound to one action (`refund`, `discount`, `drawer`,
    `deposit_refund`, `credit`) and one reference the terminal chose first.
    It lasts 24 hours.
  - It is signed over a different message from a session token, so it can
    never be used as one.
  - It is re-checked when used: an approver switched off or demoted since no
    longer counts.
  - Nobody approves their own request, and every grant is audited as
    `approval.granted`.
  - Approvals need a connection, because PINs are only ever checked by the
    server.
- **Cashiers can now do these with a manager's approval:**
  - refund a sale. The approval can cap the amount.
  - give an over-limit discount
  - open the drawer without a sale. The approval is single-use.
  - give a repair deposit back. The approval is bound to the ticket and is
    single-use.

  The Refund and Open Drawer tiles now show for cashiers.
- **Discount limits** (store settings, admin): cashier **10 %**, manager
  **50 %**, admins unlimited.
  - The limit applies to the deepest discount on any line, with the line and
    order discounts combined (10 % + 10 % = 19 %).
  - The server refuses a sale over the seller's limit without an approval
    covering it (`discount_over_limit`).
  - A manager cannot approve past their own limit.
  - Checkout warns while the discount is over the limit, and asks for
    approval when the sale is completed.
- **Approver on the record.** Transactions gain `approved_by`, and History
  shows who approved a sale or refund.
- **Discounts in reports:** a *Discounts given* KPI, discounts and approvals
  per cashier, and matching columns in the CSV.

### Fixed

- **Refunding a discounted sale asked for the shelf price.** A $20 item sold at
  15 % off offered a $20 refund; the server refused it as more than the sale,
  after the terminal had already put the stock back. The refund picker now
  uses what the customer paid: line and order discounts, with tax spread in
  proportion. It never asks for more than the sale took.

### Notes

- **A wrong approval PIN returns 403, not 401.** The terminal signs anyone out
  on a 401, and the browser check caught exactly that happening.
- The discount-math sim test was pushed as a cashier at 14.5 % off. It now runs
  as an admin, since that sale is correctly over a cashier's limit.

## [1.36.0] — 2026-09-13

Sprint 1 of the staff-gaps program (owner and admin controls). Plan:
`docs/superpowers/plans/2026-09-13-staff-gaps-and-uae-program.md`.

### Added

- **The audit log now covers the actions that matter most for loss
  prevention.** New entries:
  - stock adjustments, with before, after and a reason
  - product create and edit, with each changed field before and after
  - serials added, by number
  - new staff and admin PIN resets
  - sign-ins, and the single attempt that trips a lockout. Not every failure,
    or anyone who knows an address could fill the log.
  - lockout releases and revoke-all
  - conflict reviews
  - supplier creation, and purchase orders created, received and cancelled
  - customer creation and Drive exports
  - **refunds, paid out, cash pick-ups, staff expenses and payments on account
    as they sync**, written in one batch after the push releases its lock

  Staff names are read once per execution rather than for every entry.
- **The audit screen** groups its filter by Money, Stock, Repairs, People and
  access, and The business, and shows a readable name for each action. A test
  fails if the server writes an action the screen has no label for.
- **Staff edits**: admins can change a person's first name, last name, email
  and role from Settings → Staff.
  - An email must be valid and not used by another account.
  - Changing the email or the role signs the person out everywhere.
  - An admin can correct their own name but cannot demote or switch off
    themself.
- **Stock adjustments ask why.** The count dialog has a reason field, required
  whenever the number changes.

### Changed

- **The app token is no longer shown.** Settings → Backend is admin-only and
  the token field is masked and never pre-filled; leaving it blank keeps the
  saved token. The sign-in screen's Backend prompt no longer pre-fills it
  either.
- **Sold Elsewhere is enforced on the server.** A cashier's sale on any channel
  other than in-store is refused with `unauthorized_role`.

### Fixed

- An admin editing their own record was refused outright ("You cannot
  deactivate or demote yourself"), even for a name change.
- The serials dialog's "currently in stock" line was still in English.

## [1.35.1] — 2026-09-12

The docs catch up with the code, and a review of what staff can and cannot do.

### Added

- **`setup()` in `Code.gs`.** Every deploy guide and the client handout said
  to *select `setup` and Run*, but no such function had ever existed. Seeding
  only happened on the first web request, so the step failed and the PINs
  were hard to find. `setup()` does the seed, logs the workbook id, and says
  whether PINs were issued. It is safe to run again: it leaves a seeded
  workbook alone and refuses one that has sales in it.
- **`docs/superpowers/specs/2026-09-12-roles-and-gaps-review.md`**:
  - a who-can-do-what matrix for every role, checked route by route against
    the server and the screens
  - what each role needs but cannot do
  - the business-review items still open
  - a recommended build order

### Fixed

- **Two strings were still in English** in Arabic and Urdu: *New customer* at
  checkout, and the supplier-name placeholder.
- **Documentation that described an older app:**
  - **README:** features stopped at v1.19; the roles line predated v1.23; the
    test counts were from v1.12; there was no repairs, printing, backups,
    reports, audit or languages.
  - **backend/README:** routes, tabs and columns updated for v1.20–v1.35.
    Serial statuses were wrong. The re-seed instruction could not work.
  - **SECURITY:** the role table still showed bulk price, stock take and
    suppliers as manager routes. There was no audit-log section. The workbook
    recovery described a reseed that the `SEEDED` flag prevents.
  - **DEPLOY:** the workflows table now covers repairs, printing, languages,
    staff, backups and restore. It no longer tells you to re-seed a live
    workbook.
  - **AGENTS:** the module map is current, and the translation and RTL rules
    are written down.
  - **Handout:** feature list, one-page setup guide and demo page updated;
    both PDFs regenerated.

### Documented, not yet changed

These are recorded in the review and in SECURITY.md:

- Settings → Backend shows the `APP_TOKEN` to every role.
- Many admin actions are not in the audit log, stock adjustments among them.
- Discounts have no ceiling.
- Managers may release a lockout, but no button exists for it.
- Staff role, name and email cannot be edited in the app.
- There is no manager-approval step.

## [1.35.0] — 2026-09-12

English, Arabic and Urdu, with right-to-left layouts. Owner decision: RTL is in
scope, and the language options must be offered in the app.

### Added

- **Three languages: English, العربية, اردو.** Every screen, dialog, toast,
  empty state and server error a cashier can see is translated. That is 1,070
  strings, including 26 that change with a count, which use each language's
  own plural rules (Arabic has six forms).
- **Language options in two places.** On the sign-in screen, so a cashier can
  pick before signing in. And per terminal under Settings → Language, where
  the default is **Match the store**. Switching reloads the app in the new
  language.
- **Receipts and the customer display use the store's language**, not the
  cashier's. An Urdu-speaking cashier in an English store still prints English
  receipts. Arabic and Urdu receipts mirror their columns and print as an image
  over Bluetooth.
- **Right-to-left layouts.** Arabic and Urdu mirror the whole app: sidebar,
  cart panel, checkout column, sheets sliding in from the left, dialog buttons,
  alert stripes and badges. Spacing, borders and offsets in `style.css` now use
  logical properties, so they follow the document direction without a second
  stylesheet.
- **Dates and times follow the screen language**, with Latin digits so they
  match the money beside them.

### Fixed

- **Money read backwards inside Arabic and Urdu text** ("0.00$"). Amounts on
  screen are now wrapped as a left-to-right run, including the signs on
  discounts and over/short. Receipts isolate money by the receipt's own
  direction. CSV, the text-mode receipt printer and the PDF strip the markers.
- **Arrows in date ranges and price changes point the reading way.**
- **The refund icon mirrors** in right-to-left.
- **An Arabic or Urdu receipt no longer makes a PDF of question marks.** The
  PDF is Courier, which has no Arabic or Urdu letters. When a receipt needs
  them, the PDF button is hidden and WhatsApp or email sends the receipt as
  text.

### Notes

- **No backend change.** The server's error messages are translated on the
  client, keyed by their English text.
- **The translations were written without a native speaker.** Have an Arabic
  and an Urdu speaker read through the app before go-live.
- A catalogue test scans the source for every translatable string. It fails on
  a missing, stale or untranslated entry, a dropped placeholder, a missing
  plural form, or markup in a translation.
- Still English: CSV column headers, the Google Sheets workbook, and the
  scheduled report emails.

## [1.34.0] — 2026-09-12

Printing and the cash drawer. Owner decision: support Bluetooth and standard
computer printers as well as the receipt printer and drawer first planned for
v1.28.0. That number is not reused — it would sit behind v1.33.0 and make the
app's version go backwards.

### Added

- **Printer & cash drawer settings, per terminal.** Three ways to print:
  - **Receipt printer** — through the computer's print dialog at 58 or 80 mm.
    Any receipt printer installed on the computer, USB or network.
  - **Standard printer** — a full page on an office or home printer, with
    A4, Letter or the printer's default.
  - **Bluetooth printer** — straight to a Bluetooth receipt printer with no
    dialog. The only way to open a cash drawer from a browser.
- **One receipt for every printer.** The screen, the paper and the Bluetooth
  printer render the same model, so they cannot disagree.
- **Receipts that print any currency and any script over Bluetooth.** Plain
  English receipts go as fast text; anything with `£`, `€`, `₨`,
  `د.إ` or Arabic/Urdu goes as a printed image, because printers mangle
  those through their code pages. Right-to-left receipts mirror their columns.
- **The cash drawer** opens on a cash sale when set to, pin 2 or pin 5. An
  **Open Drawer** tile for managers takes a reason and records every no-sale
  open in the audit log with the terminal.
- **Print receipt** in History (reprints) and after collecting a repair.
- An automatic receipt waits up to three seconds for the server's receipt
  number, so it does not always print "pending". The drawer does not wait.

### Fixed

- **The app could fail to start offline after an update.** Activating a new
  version deletes the old cache and keeps only the precache list, and
  `screens/repairs.js` had been left off it since v1.31.0. A guard test now
  follows every import from the app and fails on anything not precached.
- **History reprints showed the internal transaction id** instead of the
  receipt number.

### Before buying hardware

- Bluetooth printing needs **Chrome or Edge** on Windows, macOS, ChromeOS or
  Android. **Not an iPhone or iPad**, and not Firefox.
- The printer must support **Bluetooth Low Energy**. Browsers cannot reach
  Bluetooth Classic-only printers.
- The drawer opens only through the **Bluetooth** printer, with the drawer
  cable in the printer's drawer port. With the print dialog or a standard
  printer, the drawer opens with its key.

### Verification limits

No physical printer was available. ESC/POS bytes are tested exactly and
mutation-checked; the Bluetooth transport is tested against a fake printer; the
dialog, page and canvas output were checked in-browser. The first print on the
shop's own hardware is still the real test.

### Tests

5 new sim checks, 57 new client units. Backend **715 / 0**, client **427 / 0**.

## [1.33.0] — 2026-09-12

### Changed

- **Services are not refunded.** Owner decision. The server refuses any refund
  that includes a service product or repair labour, before anything else and as
  a whole, with the reason `service_not_refundable`. Before this, refunding a
  phone-setup service was accepted and issued a receipt number. The refund
  picker still lists service lines so the whole sale is visible, but locks them.

### Fixed

Three defects found while wiring that change, all present since the first
commit and all in screens the backend tests cannot see:

- **Items without a serial number could not be refunded from the screen.** The
  refund total used a dangling `else` that bound to the serial check, so plain
  items never counted: selecting two cables left the total at 0 and Confirm
  disabled. A mixed refund showed 400 while actually refunding 425.
- **Five buttons did nothing:** Refund in History; Collect payment and
  Statement on a customer; Print and CSV on a statement. Each dialog looked for
  the backdrop from inside it, got nothing, and threw before those buttons were
  wired.
- **Tapping anywhere inside those dialogs closed them** — including tapping
  the customer's name, or a refund quantity button.

### Tests

4 new sim checks, 7 new client units, including a guard that keeps both dialog
patterns out of every screen. Backend **710 / 0**, client **370 / 0**. Every
flow verified in-browser against current code with the service worker cleared.

## [1.32.0] — 2026-09-12

Repair deposits and collection. The money half of repairs, and the reason it
was split from v1.31.0: a deposit is cash in the drawer that is **not earned
revenue**, and almost every place the code classified money would have counted
it as a sale.

### Added

- **Take a deposit** when a device is booked in — cash, card or transfer.
  Written as a `deposit` ledger row: drawer cash, never sales.
- **Collect & charge.** The job is invoiced as a real sale for its full value
  (parts at the cost captured when fitted, labour, tax), with an `Orison-S`
  receipt number. The deposit held is applied as a `deposit` tender that the
  **server** adds — a client-supplied one is refused — and the customer pays
  the balance. The screen quotes the balance from the same function that
  charges it, so the two cannot drift.
- **Give a deposit back** (manager/admin), in full or in part, with a reason.
  Written as a `deposit_refund`: drawer cash out.
- **Deposits held** — the liability — in reports, the Drive export and the
  emailed scheduled report. Read from the tickets, because a balance is not
  something you sum over a date range.

### Fixed before it could ship

Each was found by reading the code before building, reproduced by a failing
test, then fixed:

- **A device could push a sale "paid" with a deposit tender.** It was accepted,
  took the stock off the shelf, and put nothing in the drawer. A pushed row of
  kind `deposit` fell through to the sale path and became a numbered sale.
  Deposit kinds are now server-only and a `deposit` tender is refused from any
  device.
- **The drawer ignored deposit cash.** A shift with a repair deposit would have
  closed over by the deposit amount.
- **The day export folded deposits into SALES** through a catch-all branch
  (`else if (k !== 'purchase') sales += v`).
- **History would have shown every deposit as a "Sale"** and printed it as a
  sale receipt: `kindInfo()` falls back to Sale for any kind it does not list.
- **"Net revenue today" would have counted deposits as revenue** — and deposit
  refunds as revenue too, with the wrong sign.
- **The screen would have quoted the wrong balance on a taxed store**, because
  the ticket total excluded tax while collection charged it.
- **Repair labour showed as a nameless "Item"** in the product breakdown.

### Rules

- Collection writes its sale directly under the lock, **not** through
  `/api/sync/push` — the sync sale path takes stock off the shelf, and the
  parts already left when they were fitted. A test pins that collection moves
  no stock.
- A deposit larger than the job must be refunded down before collecting.
- A ticket holding a deposit cannot be voided; that would orphan the liability.

### Known limits

- Refunding a repair invoice uses the normal refund screen: part lines refund
  and restock, but an ad-hoc labour line is rejected as `unknown_product`.
  Repair refunds are a warranty/rework policy and belong with warranty tracking.
- "Net revenue today" already counted collections (payments against account
  sales) as revenue before this release. Spotted while mapping deposits; not
  changed here.

### Tests

64 new sim checks and 4 new client units. The endpoint tests were written after
the endpoints, so the two key guards were deliberately mutated out and the suite
re-run — both mutants were caught. Backend **705 / 0**, client **363 / 0**.

## [1.31.0] — 2026-09-12

Repairs. The largest remaining hole in the stock figure: a screen fitted to a
customer's phone left the building but stayed on the shelf in the system.

### Added

- **Repair tickets.** Device intake (make, model, IMEI, reported fault, visible
  condition, accessories left), a guarded status flow, and a bench book that is
  searchable by ticket number, customer, phone or IMEI. Ticket numbers are
  `Orison-R000001`, sequential and gap-free, reusing the v1.24.0 machinery.
- **Parts leave stock when they are fitted**, not when the job is invoiced, so
  on-hand keeps describing what is physically in the building. Fitting runs the
  same code path a sale does, under the same lock: **the register cannot sell a
  serial the bench has fitted, and the bench cannot fit one the register has
  sold.** Removing a part, cancelling a job or marking it unrepairable returns
  every part — serials included.
- **Labour lines**, either a service product the shop already prices or one-off
  work typed at the bench.
- **Admin void** for a ticket that should never have existed (a duplicate, a
  mis-entry). Distinct from a cancel, which is a real customer changing their
  mind. Needs a reason, returns the parts, and stays on the sheet for the audit
  trail while dropping out of the working list.
- Every ticket mutation is audited (v1.22.0).

### Deliberately not in this release

- **Money.** Deposits, the collection invoice and the deposits-held liability
  are v1.32.0. `collected` is therefore unreachable, and the server refuses it:
  a repair is collected by invoicing it, not by picking a status, or a job could
  be closed as collected with no money taken. A client unit test pins that the
  UI never offers it either.
- **Offline.** Repairs are online-only, like purchase orders and customers. A
  ticket is a numbered document handed to a customer at the counter, and an
  offline terminal cannot know the next number without risking a collision.
  Selling offline is unaffected.
- **No passcode field.** The backing store is a Sheet copied nightly into Drive.
  A plaintext customer credential there is a liability with no offsetting
  benefit; the bench asks verbally.

### Fixed

- `HANDOVER.md` §5 described serial statuses as `AVAILABLE`/`SOLD`/`VOIDED`.
  The code has always used `IN_STOCK`.

### Tests

58 new sim checks and 9 new client units. Backend **641 / 0**, client
**359 / 0**.

## [1.30.0] — 2026-09-11

The four remaining items from `HANDOVER.md` §10, and the last release of the
operational-readiness program.

### Fixed

- **Any signed-in account could enumerate the staff roster.** `/api/config`
  returned every active user's name and email to every role. Combined with the
  account-based login lockout, one cashier could lock every colleague out of the
  till for fifteen minutes at a time. The roster is now manager/admin only;
  cashiers still get the store and currency list the app needs to run.
- **The time clock needed a connection.** A shop that can sell offline could not
  clock in offline. Punches now queue through the outbox carrying **the moment
  they happened**, and are sent when the line returns — before the sale batch, so
  the floor record is right even if a sale is rejected. A punch the server
  refuses is dropped rather than retried forever: the state it wanted is already
  true.
- **The customer display never went stale.** A register tab closing mid-sale
  left the last cart on the customer-facing screen indefinitely. Any frame older
  than three minutes now reads as idle, checked every thirty seconds, so a
  shopper never reads somebody else's basket.
- **One 15-second timeout for every call** mapped a slow report onto "offline"
  and hid the real cause. Reports, exports, backups, the audit log and the
  reorder worksheet get 60 seconds; everything else keeps 15.

### Tests

9 new sim checks, including that a queued punch keeps its own timestamp so the
hours worked are computed from when someone actually clocked in, not from when
the terminal happened to reconnect.

## [1.29.0] — 2026-09-11

A card tender. Until now a card sale had to be rung as cash, which inflated the
expected drawer and closed every shift short by the card total.

### Added

- **Card** as a tender alongside Cash, Store Credit and Net-30. It is *recorded*,
  not authorised — the terminal beside the till does the authorising and the POS
  records the amount.
- **Card is excluded from the expected drawer** at shift close, in both
  directions: a card sale adds nothing to the till and a card refund takes
  nothing out of it.
- Card appears as its own line in reports, and the Drive export gains **CARD**.
- 9 sim checks, including a split cash/card sale reconciling correctly.

### Fixed

- **The export's `NET CASH` was never drawer cash.** It netted by transaction
  *kind*, so store-credit and on-account sales counted as cash; card sales made
  it plainly wrong. A new **`CASH IN DRAWER`** line nets by *tender* — cash
  taken in on sales and collections, less cash refunds and all three cash-out
  reasons — which is the figure that reconciles against a physical count.
  `NET CASH` is left as it was so existing exports stay comparable.

### v1.28.0 skipped

The cash drawer and thermal printer release is **parked at the owner's request**
until the hardware is confirmed — USB, network and Bluetooth are materially
different builds. The version number is left unused rather than reassigned so
the plan and the tags keep matching.

## [1.27.0] — 2026-09-11

Record a sale that happened somewhere else, so marketplace stock stops drifting
from the shelf.

### Added

- **`channel` and `external_ref` on every transaction.** Channels are
  `in_store` (the default), `online`, `marketplace`, `phone` and `other`; an
  unrecognised value falls back to `in_store` rather than storing junk.
- **"Sold Elsewhere" on the launcher** (manager/admin): pick where it sold, give
  the order reference and the date, find the items — **including IMEI capture
  for serialised stock** — set the price actually received, and record it. The
  stock comes off exactly as it would at the counter.
- **Availability respects an open till sale.** The dialog counts what is free
  using the same `cart.js` maths, so an external sale cannot claim a unit
  somebody is mid-way through selling at the register.
- **Reports gain `byChannel`** — sales, count and units per channel — while
  channel sales still count in the overall totals.
- The order reference and the channel are **searchable**, so a sale is findable
  by its eBay order number.
- 13 sim checks, including that a unit sold on the marketplace can no longer be
  sold at the counter.

### Note

This is not a marketplace integration. Somebody still types the sale in. What it
buys is that when they do, the stock, the ledger and the reports stay honest —
and there is one place that knows what is actually in the building.

## [1.26.0] — 2026-09-11

Daily, weekly and monthly reports emailed automatically to the admins the owner
nominates.

### Added

- **`/api/reports/schedule`** (admin only): set recipients, switch each cadence
  on or off, read when each last went, and send one immediately.
- **Three time-driven triggers** — daily 06:00, weekly, monthly — installed once
  with `installReportTriggers()`, which clears its own previous triggers rather
  than stacking duplicates.
- **Each report covers the period that just closed.** A daily report sent at
  06:00 is about yesterday, not the morning it is sent in.
- The email carries gross sales, refunds, **cash out broken down by reason**,
  collections, net revenue, gross profit, sales and units, average ticket, a
  per-cashier breakdown and the top five sellers — with the period CSV attached.
- **Settings panel** for recipients, the three toggles, the last-sent times and
  a **Send one now** button.
- 23 sim checks including the trigger path, a switched-off cadence sending
  nothing, and a failing send.

### Notes

- **Nothing is scheduled until someone asks for it.** All three cadences default
  to off, so no one starts receiving mail because a release shipped.
- The figures come from `reports_()`, the same function the Reports screen uses,
  so a scheduled report and the screen can never disagree.
- A failing send does **not** throw out of the trigger — a trigger that throws
  stops being scheduled. It writes `report.failed` to the audit log and shows in
  Settings instead.
- Apps Script's `MailApp` quota is 100 recipients/day on a consumer account and
  1,500 on Workspace. Three reports to a handful of admins is nowhere near it.

## [1.25.0] — 2026-09-11

Never load more than 100 transactions, and search the ledger on the server
instead.

### Added

- **Server-side search** on `/api/transactions` via `q`: receipt number, client
  id, customer name, cashier, item name, serial/IMEI, note, kind, and an exact
  amount (typing `949` finds a $949.00 sale). Plus `from`/`to` date bounds and a
  `kind` filter.
- **Keyset paging** on `created_at` with a `cursor`, so new sales arriving at the
  top cannot shuffle a page under the reader.
- **History gets a search box** — receipt number, customer, item, IMEI or amount
  — with a match count, a clear link and **Load 100 more**.
- 14 sim checks including a 2,198-row ledger, pages that do not overlap, and
  that searching never widens a cashier's view beyond their own rows.

### Changed

- **`/api/transactions` is hard-capped at 100 rows.** It previously allowed 500
  and the dashboard asked for 300. Reading a slab of the ledger into a terminal
  is the thing that stops working as the shop grows.
- **The dashboard no longer pulls a slab.** Its KPIs and hourly chart page
  through **today only** (bounded at 10 pages), and the 14-day chart and 30-day
  top sellers now come from **`/api/reports`** — the server's own aggregate,
  which is uncapped and applies line and order discounts the client could only
  approximate.
- The audit log and the customer ledger use the same 100-row cap.

## [1.24.0] — 2026-09-11

Backups. The entire business lives in one spreadsheet; until now nothing copied
it anywhere.

### Added

- **Nightly backup** via an Apps Script time-driven trigger at 02:00, writing a
  full copy of the workbook to its own Drive folder **`POS Backup`**, named
  `Orison-POS-Backup_YYYY-MM-DD_HHmm.xlsx` in the **store's** local time.
  A copy of the spreadsheet, not loose CSVs — it restores by being opened.
- **Retention**: the last 30 nightly copies and the first of each of the last 12
  months. Drive filling up silently is its own kind of backup failure.
- **`installBackupTrigger()`** — run once from the Apps Script editor. Safe to
  run repeatedly: it clears its own previous trigger rather than stacking.
- **A failed backup shouts.** `backupDaily()` never throws (a trigger that
  throws stops being scheduled, which would end all backups silently); instead
  it emails every active admin, writes `backup.failed` to the audit log, and
  the failure shows in Settings.
- **`/api/backup/status` and `/api/backup/run`**, both admin only, with a
  **Back up now** button and the last-backup time in Settings.
- 18 sim checks, including that a failed scheduled run emails the admins and
  that installing the trigger twice does not create two.

### Fixed

- **`setup` would re-seed a live workbook.** Seeding rewrites users and the
  catalog, so one wrong run in the Apps Script editor took the shop's history
  with it. It now refuses when transactions exist unless a `CONFIRM_RESEED`
  script property is set to `yes`.

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
