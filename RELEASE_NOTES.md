# Orison POS — Release Notes

Every release is a **tagged commit** on `main` (`vX.Y.Z`), validated before
ship, with docs/assets kept in the same commit. This file highlights the
current release and the run that led here; `CHANGELOG.md` carries the full,
line-by-line detail for every version.

---

## Latest: v1.55.2 — a review of the lifecycle sprints, from outside them

**2026-09-24.**

A second pair of eyes over v1.51.0 → v1.55.0. The features are sound; three
things needed fixing and the docs needed catching up.

- **Fixed: every step on a serial's trace said "Step"** instead of *Intake*,
  *Sale*, *Repair* or *Trade-in bought back*. The chip passed a kind where the
  label wanted a whole step, and the mismatch failed quietly.
- **Fixed: the Reminders panel had never once appeared.** v1.55.0's headline
  feature read one level too deep into the server's answer, so the Dashboard
  quietly rendered nothing. Every server test for it passed; opening the demo
  is what found it.
- **Fixed: the Dashboard re-read the entire ledger every time it opened.** The
  reminders list is now cached for two minutes, and the refresh button asks
  for the truth. On a shop with a year of history this is the difference
  between a home screen that opens and one that crawls.
- **Added: a test that ties the shelf to the books.** Stock received at a
  discount is worth, on the Stock health screen, exactly what the books
  debited to Inventory — and selling one takes its own cost off, not its list
  price. Two numbers that must agree, now held together.
- **Housekeeping:** one line ending in the repository, the check counts in the
  docs made true again, and the demo guide now tells the team about the five
  lifecycle screens it never mentioned.

**Validation:** backend-sim **PASS 1213 / FAIL 0** · client units **PASS 583 /
FAIL 0** · demo **PASS 32 / FAIL 0**.
- Four mutations confirm the new tests bite: the cache never read, the refresh
  flag ignored, the shelf valued at retail, and the trace label reading a
  string as an object.
- Checked in the browser as the manager: the Reminders panel lists 14 things
  to act on and survives a refresh, and a traded-in IMEI's timeline reads
  *Intake* and *Trade-in bought back* rather than *Step*, *Step*.

### Deploying

**Backend redeploy required** for the reminders cache. Nothing to run.

---

## v1.55.1 — review pass on the lifecycle sprints

**2026-09-24.**

- **A cross-sprint review (v1.51.0 → v1.55.0) found no security issues and
  two figures worth correcting before the merge to `main`.**
  - The serial trace now excludes VOIDED transactions, so a void can't render
    as a real step on a device's timeline.
  - The Customer 360 profile's *average sale* divides by sales only (the same
    count the Sales report uses), not by every completed transaction — a
    refund or a payment can no longer drag the figure toward the wrong number.
  - The trace search reads the input at press time instead of racing its
    200ms debounce, so an Enter keystroke (barcode scanner) always searches
    what was typed.
  - Repair statuses on the trace use the Repairs screen's localized labels
    instead of the raw server slug; malformed dates fall back cleanly instead
    of throwing or leaking raw HTML.
- Everything else came back clean: role gates, money rules, refunds, warranty
  and repair logic, serial conflict handling, and the client screens.

**Validation:** backend-sim **PASS 1205 / FAIL 0** · client units **PASS 572 /
FAIL 0** · demo **PASS 32 / FAIL 0** · pdf-smoke **NOT RUN** here.
- The profile sim section's average-sale assertion now expects 420 (two sales
  of 810 and 30 split by a 10 refund) to lock in the corrected semantics.

---

## v1.55.0 — lifecycle reminders

**2026-09-24.**

- **What the shop should act on, surfaced on the Dashboard.** The owner or
  manager opens the day to one read-only *Reminders* panel with four lists
  derived from data the shop already captures — nothing new to fill in, no
  schedules, no outside notifications:
  - **Warranty expiring** — active warranties ending within the next 30 days,
    with the customer, device and expiry.
  - **Repairs ready** — every ticket at *Ready for collection*, days waiting,
    customer and deposit held, one tap to the Repairs screen.
  - **Upgrade candidates** — customers of serialized brand-new devices sold 24+
    months ago with expired warranties, with what they own.
  - **Store credit left** — customers still holding store credit and how much,
    so it isn't forgotten as a liability.
- Each list caps at the 25 most pressing entries and reuses the Sales-report
  money rules and the Warranty screen's status answers; every row links into
  the screen where the shop acts on it (Sales report, Repairs, Warranty
  lookup, Customers).
- The panel loads only for online admin/manager sessions and simply stays out
  of the way offline, so a till never hangs on a reminders fetch.

**Validation:** backend-sim **PASS 1205 / FAIL 0** · client units **PASS 572 /
FAIL 0** · demo **PASS 32 / FAIL 0** · pdf-smoke **NOT RUN** here.
- The reminders sim section sells a warranty expiring in weeks and a device
  sold far past its cover, books a repair to *ready* with a deposit held, and
  refunds a sale to store credit — then asserts each list's membership, exact
  customer/device/deposit values, the 25-item cap, and the cashier/admin/
  manager role guards. The Arabic and Urdu dictionaries gained the panel's 12
  strings (6-form Arabic plurals, 2-form Urdu).

---

## v1.54.0 — customer 360 profile

**2026-09-24.**

- **Everything one customer is, on one screen.** Customers → *Ledger* is now
  a full Customer 360 profile: total spent, net of refunds, visits, average
  sale, first and last visit — alongside what they owe, their store credit,
  and their credit limit.
- **The devices they bought, and their warranty cover.** Every serialized
  unit on their sales, priced at what they actually paid, with the same
  warranty answer as the Warranty screen as of today — active, expired, or
  refunded — plus the expiry date and days left.
- **Their repairs, open and collected.** Tickets still on the bench (intake
  through ready) and repairs they've collected with the final total, joined
  on the repair's customer.
- **The same ledger managers already see**, with aging buckets, behind the
  same admin/manager gate as the ledger and statement.

**Validation:** backend-sim **PASS 1190 / FAIL 0** · client units **PASS 572 /
FAIL 0** · demo **PASS 32 / FAIL 0**.
- The profile sim section sells a serialized warranty phone on account,
  refunds part of it to store credit, and books a repair against the same
  customer, then asserts the summary money, the device's active warranty, the
  open repair ticket, the ledger rows and aging, the role and 404 guards, and
  a second customer cross-checked against the seeded ledger numbers.

---

## v1.53.0 — serial lifecycle trace

**2026-09-24.**

- **One IMEI, its whole life in one timeline.** Serial Trace
  (`/api/serials/trace`, admin and manager) takes a serial number or IMEI and
  lists every leg that serial has walked — the intake that brought it in
  (purchase order or trade-in, at the value actually paid), every sale that
  carried that exact unit, refunds that returned it to stock, repair tickets
  filed against that device, and trade-ins where the store bought it back —
  oldest to newest.
- **Immutable intake stamp.** Each serial now records when it entered the
  store on every intake path (PO receive, trade-in intake, manual entry).
  Buying back a unit this store already sold keeps the original intake stamp,
  so a serial bought back is still one serial, not a second intake.
- **Read-only, same guardrails as stock health.** The screen and timeline
  never write a bookkeeping row; serialized stock still counts by serial, and
  admin and manager only.

**Validation:** backend-sim **PASS 1172 / FAIL 0** · client units **PASS 572 /
FAIL 0** · demo **PASS 32 / FAIL 0**.
- The trace sim section drives a full trade-in lifecycle (take in, resell,
  buy back, resell, refund) and asserts the timeline shape, date ordering, the
  single intake stamp on a bought-back serial, the min-length and role guards,
  and the "not found" case.

---

## v1.52.0 — inventory velocity

**2026-09-24.**

- **How hard is the shelf working?** Velocity puts a movement number on each
  product: units and revenue per day, days of cover, and turnover — net
  revenue divided by the average value of the stock sitting on the shelf over
  the window. A line that took 300 days to clear shows it; a fast mover with a
  full shelf shows it.
- **Buy again.** A product earns a buy-again when it genuinely out-sold what
  came back in *and* the shelf is running low (nothing on hand, or cover
  shorter than the 30/90-day window). Idle stock and refund-swamped lines
  never qualify, so the reorder shortlist is not padded with last year's
  mistakes.
- **Health ↔ Velocity, one screen.** Toggle the two views without losing the
  filters; each exports its own CSV (`orison-stock-health.csv` /
  `orison-stock-velocity.csv`).
- **Same guardrails as stock health.** Serialized stock is counted by serial,
  services and inactive products are excluded, turnover is never negative, and
  the report is read-only — it never writes a bookkeeping row.

**Validation:** backend-sim **PASS 1166 / FAIL 0** · client units **PASS 572 /
FAIL 0** · demo **PASS 32 / FAIL 0**.
- Mutation cases confirm the velocity maths bites: net revenue netting off
  refunds at what the customer actually paid, refund units not counted as sold,
  a 50%-discount line pushing turnover to null rather than a negative number,
  serialized lines valued by serial count, buy-again false when restock from a
  purchase order outpaces sales, idle lines flat and profitless, services and
  inactive products staying out of the count, and the 90-day window and 365-day
  clamp.

---

## v1.51.0 — stock health

**2026-09-24.**

- **What is the shelf actually worth?** Stock Health values the whole catalog
  at retail and at cost — serialized items at their known serial cost — so the
  shopkeeper can see, in one number, how much cash is sitting on the shelf.
- **Who is selling?** Over a 30/90/180/365-day window, each product shows what
  actually left the door: units sold, revenue, days of cover. *Slow* (cover
  over 180 days, or one unit or less sold) and *dead* (nothing sold in 180
  days) are flagged.
- **Reported, never auto-hidden.** The screen and the CSV point a manager at
  what is tying up money; nothing gets hidden, held back or discounted by the
  system.
- **Admin and manager only**, read-only — the health report never writes a
  bookkeeping row.

**Validation:** backend-sim **PASS 1144 / FAIL 0** · client units **PASS 565 /
FAIL 0** · demo **PASS 32 / FAIL 0**.
- Eight mutation tests confirm the tests bite: category names that clobber
  `Object.prototype` (like a category literally named `toString`) nulling out
  of the JSON, every window being clamped, refund units not counting as sold,
  stock with no cover being neither slow nor dead, serialized stock valued
  wholesale outside the ledger, inactive and service lines reaching the count,
  on-hand-of-zero items being reported, and the summary not reconciling with
  the items it came from.

---

## v1.50.0 — parts a job is waiting for

**2026-09-22.**

- **A repair ticket now records the parts it is waiting for**, instead of just
  saying *Awaiting parts* and leaving the rest in someone's head.
- **Each line says where the part is**: on the shelf, on order (with the order
  number and the date it is due), or nobody has ordered it yet.
- **Purchases shows the whole bench** — every waiting job's parts grouped by
  part, with what is needed, what is here, what is coming and how short the
  shop is. One button raises a purchase order for the shortfall.
- **Raising that order marks the jobs waiting on it**, so the ticket says
  *on order, PO-0004, due Friday*. Cancelling the order puts them back.
- **Receiving stock names the jobs it frees**, oldest request first.
- **Fit it** puts the part on the job and clears the line in one tap; the last
  one moves the ticket off *Awaiting parts* on its own.
- **Nothing is reserved**: the part can still be sold at the counter. The
  board makes the clash visible rather than hiding stock from a customer.

**Validation:** backend-sim **PASS 1126 / FAIL 0** · client units **PASS 557 /
FAIL 0** · demo **PASS 32 / FAIL 0**.
- Nine mutations confirm the tests bite: the order not marking the jobs, a
  cancelled order keeping its mark, every waiting job reported whatever
  arrived, the fitted part not clearing its line, the shortfall ignoring what
  is on order, closed tickets staying on the board, the ticket not moving to
  *Awaiting parts*, jobs answered newest-first instead of oldest, and the
  ticket left waiting after its last part was fitted.
- Checked in the browser: recorded a part on a ticket, ordered the shortfall
  from Purchases, saw the ticket say which order it is on, received it, and
  fitted it from the ticket.

### Deploying

**Backend redeploy required.** The new Repairs column is added on first use.
Nothing to run. The demo updates itself.

---

## v1.49.0 — a delivery is owed what the invoice will say

**2026-09-17.**

- **An order's discount and tax now follow the stock in.** Before this, a
  delivery was owed its plain line costs: an order on 5% trade terms looked
  about 5% more expensive than the supplier's invoice, and any tax on the order
  was never owed at all.
- **The discount is part of what the stock cost.** Ordered at 10 with 10% off,
  it comes in at 9 — that is the cost on the shelf, on the serial, and in the
  profit on the sale.
- **The tax is owed to the supplier but is not stock cost.** It goes to
  *Sales tax / VAT payable* as tax to reclaim. (If the shop cannot reclaim
  purchase tax, leave the order's tax at zero and put it in the line costs.)
- **A part delivery carries its share of both**, and the deliveries always add
  up to the order's own total — the last one carries the odd cent.
- **Receiving tells you what it will be owed** before you post it, and a
  purchase order's lines show their cost after the discount.
- **Fixed:** an order delivered line by line stayed on *Partial* for ever, and
  what had arrived was counted against the wrong line. Receiving now takes a
  line at zero, so part of an order can actually be entered.
- **Fixed:** the daily export counted stock bought as cost of goods sold, and
  the tax on a delivery as tax collected from customers.
- **Fixed:** serials received on an order now carry what they cost, so an
  IMEI's profit is its own.

**Validation:** backend-sim **PASS 1089 / FAIL 0** · client units **PASS 545 /
FAIL 0** · demo **PASS 30 / FAIL 0**.
- Nine mutations confirm the tests bite: the discount dropped from the goods,
  the tax never allocated, each delivery rounded on its own, a line closed by
  an earlier delivery ignored, a serial taking the ordered cost, the input tax
  capitalised into stock, stock bought counted as cost of sales, purchase tax
  counted as tax collected, and a delivery read off by position again.
- Checked in the browser: the manager receives the demo's 5%/35-tax order one
  line at a time — the dialog splits stock from tax, the two deliveries come to
  exactly the order's $1,853.30, and the admin's journal shows Dr Inventory,
  Dr VAT to reclaim, Cr Accounts payable on each.

### Deploying

**Backend redeploy required.** Nothing to run: existing orders and receipts are
untouched, and the ledger columns are already there. The demo updates itself.

---

## v1.48.0 — paying suppliers

**2026-09-17.**

- **Purchases shows what the shop owes its suppliers**, and how much is
  overdue by each supplier's terms.
- **Tap a supplier to see their account:**
  - every delivery with its due date
  - every payment with how it was paid and who paid it
  - the balance after each
  - which orders are paid, part paid or unpaid
- **Record payment** by bank transfer, cheque or cash from the till, against
  one order or the account. An admin can void a payment entered by mistake.
- **The drawer count, Reports, the daily export and the books all account for
  it.** Accounts payable now goes down when suppliers are paid.
- **Fixed:** managers can open Purchases again. It failed to load for them
  before.

**Validation:** backend-sim **PASS 1066 / FAIL 0** · client units **PASS 538 /
FAIL 0** · demo **PASS 29 / FAIL 0**.
- Mutation checks confirm the tests catch broken tracing of older receipts,
  broken drawer cash and a broken overdue rule.
- Checked in the browser as the manager: a payment refused without its
  reference, then recorded by cheque.

### Deploying

**Backend redeploy required.** The two new ledger columns are added on first
use. The demo updates on its own.

---

## v1.47.0 — the Sales report

**2026-09-16.** From the team's feedback on the demo.

- **Menu → Sales Report** answers "what did we sell?" any way you ask it.
  - **Choose** a period, a staff member, a category, a product, a payment
    method, a channel or a customer.
  - **See** net sales, the number of sales, the average sale, items per sale,
    refunds, tax, discounts, and gross profit with margin.
  - **Break it down** by day, hour, staff member, category, product, payment,
    channel or customer. Tap a row to look at just that.
  - **Every sale is listed underneath.** Tap one to see its items, discount,
    tax, cost and profit.
  - **Take it away:** a summary CSV, a line-by-line CSV for your accountant, or
    a printed page.
- **A category or product filter shows only that part of each basket**, so
  "Phones this month" is the phones' own sales and profit.
- **Cashiers can check their own sales**, without cost or profit.
- **Reports shows more:**
  - each staff member's average sale, items per sale, refunds and margin
  - sales by hour of the day
  - a *Details* link on every breakdown that opens the Sales report
- **Fixed:** screens now open at the top.

**Validation:** backend-sim **PASS 1022 / FAIL 0** · client units **PASS 530 /
FAIL 0** · demo **PASS 28 / FAIL 0**.
- The Sales report's totals are checked against Reports and the books over the
  simulator's whole ledger.
- Mutation checks confirm the tests catch a broken cent split and change being
  counted as cash.
- Checked in the browser as manager and cashier, at desktop and phone size.

### Deploying

**Backend redeploy required** (new `/api/reports/sales`, more detail in
`/api/reports`). The demo updates on its own.

---

## v1.46.1 — icons on the categories

**2026-09-16.**

- **Every category on the Sell screen now has an icon**: a phone for Phones,
  headphones for Audio, a gamepad for Gaming, and so on.
- **The icon follows the category name**, so categories the shop adds later
  get a fitting one too. A name the app can't place gets a price-tag icon.

**Validation:** client units **PASS 515 / FAIL 0** · demo **PASS 28 / FAIL 0**.
Checked in the browser.

### Deploying

Frontend only.

---

## v1.46.0 — a calmer Sell screen

**2026-09-16.** From the team's feedback on the demo.

- **Sell starts with the categories.** Tap *Phones* to see the phones, and
  *All categories* to go back. Search or scan still finds anything straight
  away.
- **Less on screen.**
  - Product tiles show name, price and stock.
  - Cart lines show a small *Discount* button instead of six, and a chosen
    discount shows as *15% off*.
- **The menu is in groups:** Counter, Cash, Stock & customers, Insights and
  Team. Cashiers, with fewer options, keep one short list.
- **Fixed:** a manager or admin signing in after a cashier now sees their full
  menu straight away.

**Validation:** client units **PASS 510 / FAIL 0** · backend-sim **PASS 983 /
FAIL 0** · demo **PASS 28 / FAIL 0**.
- Checked in the browser at desktop and phone sizes: categories, a category
  view, search, the discount toggle in both the floating cart and the phone
  cart sheet, and the grouped menu for cashier, manager and admin.

### Deploying

Frontend only: redeploy `public/`. The demo updates on its own.

---

## v1.45.1 — the cart floats at the right

**2026-09-16.**

- On a computer or large tablet, the cart is now a floating card at the right
  of the Sell screen.
- **It grows as you add items**, up to the height of the screen. After that
  the items scroll inside the card.
- **The total and Charge button are always visible**, and the card never covers
  the products, categories or search.
- In Arabic and Urdu it sits on the left.

**Validation:** client units **PASS 493 / FAIL 0** · demo **PASS 28 / FAIL 0**.
Checked in the browser at 1024×700, 1280×800 and 1920×1080, with an empty cart
and a six-line cart, in both directions.

### Deploying

Frontend only: redeploy `public/`. The demo updates on its own.

---

## v1.45.0 — a demo the team can test

**2026-09-16.**

- **Try Orison POS without installing anything:**
  https://punjabitaz-ctrl.github.io/orison-pos/
- **It is the real app and the real backend logic** with a sample shop:
  - two weeks of sales, customers, repairs, a trade-in and purchase orders
  - marketplace orders waiting to import
- **Everything runs in the tester's browser.** Nothing is sent anywhere, and
  each browser has its own shop until **Reset demo data**.
- **The yellow DEMO tab** signs you in as the admin, the manager or a cashier
  in one tap, and lists what to try.
- The test guide for the team is `docs/DEMO.md`.
- **Fixed:** terminals did not store the product list on sign-in (a bug since
  v1.1.0). The demo caught it.

**Validation:** backend-sim **PASS 983 / FAIL 0** · client units **PASS 493 /
FAIL 0** · demo **PASS 28 / FAIL 0**.
- Checked in the browser: sign-in from the guide, a card sale with a receipt,
  switching to admin, the marketplace import and its sheet, Accounts, and
  reset.
- The new pull test failed before the fix.

### Deploying

- **The live store's backend is unchanged.** Code.gs did not change.
- **The frontend fix matters for any live terminal.** Redeploy `public/`.

---

## v1.44.0 — trade-ins

**2026-09-13.**

- **Menu → Trade-In** buys a used phone or laptop from a customer.
  - Pick the seller and note the ID you checked. Only its last few characters
    are kept.
  - Pick the product it goes into, scan the IMEI, and choose its condition.
  - Pay cash from the drawer, or give store credit they can spend straight
    away.
- **Cashiers can take trade-ins** with a manager's approval for the amount.
- **The device costs what you paid for it.** When it sells, the profit is the
  real margin on that unit, and it is resold with 30 days of warranty.
- **Managers see the trade-in register:** every device bought in, from whom,
  for how much, and whether it has sold.
- The drawer count, customer store credit, Reports, the daily export and the
  books all account for trade-ins.

**Validation:** backend-sim **PASS 983 / FAIL 0** · client units **PASS 492 /
FAIL 0**. Mutation checks confirm the tests catch a missing warranty cap,
per-device cost, drawer cash and refund cost. Both the manager path and the
cashier approval path were checked in the browser.

**Layaway** is closed by owner decision.

### Deploying

**Backend redeploy required.** New sheet columns (`Serials.cost`,
`Serials.source`) and the `TradeIns` tab are created on first use.

---

## v1.43.0 — the books

**2026-09-13.** Sprint 3 of 3. The warranty, marketplace and accounting
program is complete.

- **Menu → Accounts** (admin) shows the shop's books for any period:
  - profit and loss
  - trial balance
  - how cash, receivables, inventory, tax, deposits, store credit and
    payables moved
  - the journal behind them
- **The books are kept to generally accepted accounting principles.**
  - Sales are revenue when made, with their cost recognised at the same time.
  - Tax and deposits are liabilities.
  - Change handed back never counts as cash kept.
  - A stock-take shortage is shrinkage.
- **Export** the journal and the trial balance as CSV for your accountant.
- **Fixed:** Reports now lowers gross profit by a refund's margin rather than
  its cost, so it agrees with the books.

**Validation:** backend-sim **PASS 945 / FAIL 0** · client units **PASS 482 /
FAIL 0**.
- Every journal entry balances to the cent, and the trial balance nets to zero.
- Revenue, gross profit, cash out and deposits reconcile with Reports over the
  same day, across all 2,000+ ledger rows in the simulator.
- Mutation checks confirm the tests fail if change is kept as cash or if the
  refund fix is reverted.
- The screen was checked in the browser.

**Supplier payments** are made outside the POS, so Accounts payable shows
stock received in the period.

### Deploying

**Backend redeploy required.**

---

## v1.42.0 — marketplace orders from a Google Sheet

**2026-09-13.** Sprint 2 of 3.

- **Keep marketplace orders in a Google Sheet.** The POS imports them as sales,
  takes the stock off the shelf and writes each row's status back into the
  sheet.
- **It runs every hour**, or on demand from Settings → *Marketplace orders*.
- **A Stock tab** in the same sheet always shows what is left to sell.
- Orders that would oversell, have an unknown SKU, or are missing an IMEI are
  marked with the reason and nothing moves. Fix the row, clear its Status, and
  the next run picks it up.

**Set up once:** share the sheet with the Google account that runs the POS
backend, paste its link in Settings, and run `installMarketplaceTrigger()` in
Apps Script for hourly imports.

**Validation:** backend-sim **PASS 914 / FAIL 0** · client units **PASS 482 /
FAIL 0**. The settings card was checked in the browser. The tests caught, and
the release fixes, an oversell across two orders in one run.

### Deploying

**Backend redeploy required.**

---

## v1.41.0 — warranties

**2026-09-13.** Sprint 1 of 3 in the warranty, marketplace and accounting
program.

- **Set each product's warranty**: 1 year for brand-new hardware, 30 days, or
  none. New products start at 30 days.
- **Receipts show the warranty** and when it ends.
- **Check warranty** from the Repairs screen by IMEI or receipt number.
- **Repair tickets say whether the device is still under warranty.**

**Before this goes out:** mark your brand-new hardware as *1 year* in Products
→ ⚙ Settings. Everything else keeps 30 days.

**Validation:** backend-sim **PASS 886 / FAIL 0** · client units **PASS 482 /
FAIL 0**. The warranty lookup was checked in the browser.

### Deploying

**Backend redeploy required.**

---

## v1.40.0 — United Arab Emirates VAT

**2026-09-13.** Sprint 5 of 5: the staff-gaps program is complete.

- **Choose the tax jurisdiction** in Settings → Store: United States, United
  Arab Emirates, or no tax.
- **In the UAE**, prices on the shelf include 5 % VAT, and the customer pays
  exactly that price. The receipt is a **Tax Invoice** with the shop's TRN, the
  VAT included, and the customer's TRN for business customers.
- **Reports no longer count VAT as profit.**

**Before trading in the UAE:** enter the shop's 15-digit TRN, set the currency
to AED, and add TRNs to business customers who need a full tax invoice. Have
the invoice wording checked against the shop's own tax advice.

**Validation:** backend-sim **PASS 869 / FAIL 0** · client units **PASS 481 /
FAIL 0**. A UAE sale was checked in the browser: VAT extracted from the price,
and the tax invoice showing both TRNs.

### Deploying

**Backend redeploy required.** Existing stores stay on United States rules
until an admin changes them.

---

## v1.39.0 — managers can fix the day's loose ends

**2026-09-13.** Sprint 4 of 5. Everything is on the Staff screen (Menu → Time
Clock).

- **Unlock** a colleague who got locked out, and **reset a cashier's PIN**.
- **Correct a punch**: a missed clock-out or a wrong time. A reason is
  required, and the original times stay in the audit log.
- **Close a shift someone left open**, with or without counting the drawer.

**Validation:** backend-sim **PASS 850 / FAIL 0** · client units **PASS 474 /
FAIL 0**. The team list, closing a shift and correcting a punch were checked
in the browser.

### Deploying

**Backend redeploy required.**

---

## v1.38.0 — cashiers can serve account customers

**2026-09-13.** Sprint 3 of 5.

- **Cashiers can add a new customer** at checkout.
- **Checkout shows what the customer owes**, their credit limit and what is
  left, before anything is charged to account.
- **Credit limits.** Managers set one on any customer. Going over it needs a
  manager's approval at the till.
- **Look up any sale in the shop** from History → *Whole shop*, to check a
  return or a warranty claim. Cost and margin are never shown.

**Validation:** backend-sim **PASS 821 / FAIL 0** · client units **PASS 474 /
FAIL 0**. Checked in the browser: the balance line, the credit-limit approval
and the whole-shop lookup.

### Deploying

**Backend redeploy required.** Existing customers start with no credit limit.

---

## v1.37.0 — a manager approves at the till

**2026-09-13.** Sprint 2 of 5.

- **Cashiers can refund, open the drawer, give a deposit back, or go past their
  discount limit.** Each one needs a manager to type their own email and PIN on
  the cashier's screen. Nobody is signed out.
- **Discount limits.** Cashiers can give up to 10 % and managers up to 50 %
  without asking. Admins can change both in Settings → Store.
- **Reports show the discounts each cashier gave**, and how many a manager
  approved.
- **Fixed:** refunding a discounted sale no longer asks for the full price.

**Before this goes out:** tell cashiers that discounts over 10 % will need a
manager, and tell managers their PIN approves at the till. Approvals need a
connection.

**Validation:** backend-sim **PASS 795 / FAIL 0** · client units **PASS 471 /
FAIL 0**. Discount approval (including a wrong PIN) and refund approval checked
in the browser.

### Deploying

**Backend redeploy required.**

---

## v1.36.0 — the owner sees everything that matters

**2026-09-13.** Sprint 1 of 5 in the staff-gaps program.

- **The audit log now records** stock adjustments (with a reason), product and
  price edits, serials, new staff, PIN resets, sign-ins, lockouts, purchase
  orders, suppliers, new customers, exports, and every refund and cash-out.
- **Staff can be edited**: name, email and role, from Settings → Staff.
- **The app token is hidden.** Only admins see the Backend settings, and the
  token is never displayed.
- **Only managers can record a sale made elsewhere**, enforced by the server.

**Tell managers before this goes out:** changing a stock count now asks for a
reason, and it is logged.

**Validation:** backend-sim **PASS 757 / FAIL 0** · client units **PASS 463 /
FAIL 0**. Settings, the staff editor and the audit screen checked in the
browser.

### Deploying

**Backend redeploy required.**

---

## v1.35.1 — documentation and a permissions review

**2026-09-12.** No new features; the paperwork now matches the app.

- **The deploy step works as written.** The guides said to run `setup` in Apps
  Script, but that function did not exist. It does now.
- **Every guide is current**: README, deploy, security, the backend guide and
  the client handout, including both PDFs.
- **A review of who can do what**: `docs/superpowers/specs/2026-09-12-roles-and-gaps-review.md`.
  It lists what cashiers and managers need but cannot do. The main gaps:
  - refunds need a manager to sign in on the till
  - there is no discount limit
  - cashiers cannot add a customer
  - nobody can fix a missed clock-out
  - there is no Unlock button

**Validation:** backend-sim **PASS 719 / FAIL 0** · client units **PASS 459 /
FAIL 0**.

### Deploying

**Backend redeploy recommended** (it adds `setup()`; nothing else changed).

---

## v1.35.0 — English, Arabic and Urdu

**2026-09-12.** The whole app speaks three languages, and Arabic and Urdu read
right to left.

- **Pick a language on the sign-in screen**, or per till under Settings →
  Language. The default follows the store.
- **Receipts and the customer display use the store's language**, whatever the
  cashier has chosen.
- **Arabic and Urdu mirror the whole layout.** Money, dates and phone numbers
  still read the right way round inside them.
- **Arabic and Urdu receipts go by WhatsApp or email as text**, because the PDF
  cannot carry those letters. Printed receipts are fine in every language.

**Before go-live:** the translations were not written by a native speaker.
Have an Arabic and an Urdu speaker read through the app.

**Validation:** backend-sim **PASS 715 / FAIL 0** · client units **PASS 459 /
FAIL 0**, including a catalogue check that every string on screen is
translated. Checked in-browser in English, Arabic and Urdu, on desktop and
phone widths.

### Deploying

**Frontend only.** No backend change in this release, but the backend is still
awaiting its first deploy. See HANDOVER §9.

---

## v1.34.0 — printing and the cash drawer

**2026-09-12.** Receipts print, and the drawer opens.

- **Pick the printer in Settings → Printer & cash drawer**, per till:
  a receipt printer through the print dialog, an ordinary office printer, or a
  Bluetooth receipt printer.
- **Bluetooth prints with no dialog** and can open the cash drawer on a cash
  sale. It prints pounds, euros, rupees, dirhams and Arabic or Urdu correctly,
  by sending anything a printer's character set would mangle as an image.
- **Open Drawer** for managers, with a reason, recorded in the audit log.
- **Print receipt** from History, and after collecting a repair.
- **Fixed:** after an update, an offline till could fail to start.

**Before buying a printer:** Bluetooth needs Chrome or Edge — not an iPhone or
iPad — and a printer that supports Bluetooth Low Energy. The drawer opens
only through the Bluetooth printer.

**Validation:** backend-sim **PASS 715 / FAIL 0** · client units **PASS 427 /
FAIL 0**. Every mode verified in-browser against a fake Bluetooth printer. No
physical printer was available.

### Deploying

**Backend redeploy required.**

---

## v1.33.0 — no refunds on services, and refunds that work

**2026-09-12.**

- **Services are not refunded.** Phone setup, repair labour and any other
  service line is locked in the refund picker, and the server refuses it too.
- **Refunds work again for everyday stock.** Cables, cases, chargers — anything
  without a serial number — could not be refunded: the total stayed at zero and
  Confirm never enabled.
- **Five dead buttons fixed:** Refund in History; Collect payment, Statement,
  Print and CSV in Customers.
- **Dialogs no longer close when you tap inside them.**

The last three were in the code from the very first version. None was ever
live, since nothing from this rebuild has been deployed.

**Validation:** backend-sim **PASS 710 / FAIL 0** · client units **PASS 370 /
FAIL 0**. Verified in-browser.

### Deploying

**Backend redeploy required.**

---

## v1.32.0 — repair deposits and collection

**2026-09-12.** Repairs can now take money.

- **Take a deposit** at the counter — held against the job, not counted as a
  sale.
- **Collect & charge** turns the job into a real sale with a receipt number.
  The deposit comes off automatically; the customer pays the balance by cash
  or card.
- **Give a deposit back** — managers and admins, in full or in part.
- **Deposits held** now shows in reports, the day export and the emailed
  report, so the owner can see what the shop is holding for customers.

**Seven ways a deposit would have gone wrong, caught before release.** The
biggest: a terminal could push a sale "paid" by deposit and walk goods out
with nothing in the drawer; shifts would have closed over by every deposit
taken; the export counted deposits as sales; and the dashboard's "Net revenue
today" would have shown them as revenue. Each was reproduced by a failing test
first. Full list in the CHANGELOG.

**Validation:** backend-sim **PASS 705 / FAIL 0** (64 new) · client units
**PASS 363 / FAIL 0** (4 new). Collect flow verified in-browser: a job of
159.50 including tax, less a 50.00 deposit, quotes and charges 109.50.

### Deploying

**Backend redeploy required.**

---

## v1.31.0 — repair tickets

**2026-09-12.** The shop takes repairs in every day and the POS never knew
about them. That was the largest remaining hole in the stock figure.

- **Book a device in** — make, model, IMEI, what is wrong with it, what
  condition it arrived in, what was left with it. Ticket numbers run
  `Orison-R000001`, sequential and gap-free.
- **Fitting a part takes it off the shelf there and then.** Same code path as a
  sale, same lock: the counter cannot sell a serial the bench has fitted, and
  the bench cannot fit one the counter has sold. Cancel a job and every part
  comes back.
- **A bench book you can search** by ticket number, customer, phone or IMEI,
  capped at 100 rows a page like the ledger.
- **Admin void** for a ticket entered in error, with a reason, kept on the sheet
  for the audit trail.

**Not in this release, on purpose:** deposits and the collection invoice are
v1.32.0, so `collected` is unreachable and the server refuses it — a repair is
collected by invoicing it, never by setting a status. Repairs are online-only;
selling offline is unaffected.

**Validation:** backend-sim **PASS 641 / FAIL 0** (58 new) · client units
**PASS 359 / FAIL 0** (9 new). Screen verified in-browser: renders, filters,
paginates, degrades to a visible empty state when the backend is unreachable,
zero console errors.

### Deploying

**Backend redeploy required.** The `Repairs` tab is created on first use.

---

## v1.30.0 — the remaining open items

**2026-09-11.** Last of the operational-readiness program.

- **A cashier could list every colleague.** `/api/config` handed the whole staff
  roster — names and emails — to any signed-in account. Next to a lockout that
  fires on five wrong PINs, that let one cashier lock the shop out of its own
  till. Roster is now manager/admin only.
- **Clocking in works offline.** Punches queue through the same outbox as sales,
  carrying the moment they actually happened, and go up before the sale batch so
  the floor record is right even if a sale is rejected.
- **The customer display goes idle.** A register tab closing mid-sale used to
  leave the last basket on the shopper-facing screen indefinitely.
- **Per-call timeouts.** A slow report was being reported as "offline".

**Validation:** backend-sim **PASS 583 / FAIL 0** (9 new) · client units
**PASS 350 / FAIL 0**. All fourteen launcher destinations walked in-browser with
zero console errors.

### Deploying

**Backend redeploy required.**

---

## v1.29.0 — card tender

**2026-09-11.** Ninth of the operational-readiness program. **v1.28.0 (cash
drawer and thermal printer) is parked** until the hardware is confirmed.

A card sale had to be rung as **cash**, so every card payment inflated the
expected drawer and every shift closed short by exactly the card total. There is
now a **Card** tender: recorded, not authorised — the terminal beside the till
authorises, the POS records the amount — and excluded from the drawer in both
directions, so a card refund takes nothing out of the till either.

**Also fixed:** the export's `NET CASH` was never actually drawer cash. It
netted by transaction *kind*, so store-credit and on-account sales counted as
cash; adding card made that plainly wrong. A new **`CASH IN DRAWER`** line nets
by *tender* — cash in on sales and collections, less cash refunds and all three
cash-out reasons — which is the figure that reconciles against a physical count.
`NET CASH` is unchanged so old exports stay comparable.

**Validation:** backend-sim **PASS 574 / FAIL 0** (9 new) · client units
**PASS 350 / FAIL 0**.

### Deploying

**Backend redeploy required.**

---

## v1.27.0 — sales made elsewhere

**2026-09-11.** Seventh of the operational-readiness program.

You list on marketplaces. When something sells there the stock leaves the shelf
and nothing here knew, so the counts drifted apart and the POS stopped being the
truth about what is in the building.

**Sold Elsewhere** on the launcher records that sale in the same ledger, against
the same stock: pick where it sold, give the order reference and date, find the
items (IMEI capture included), set the price actually received. Stock comes off
exactly as it would at the counter, and the sale gets a receipt number like any
other customer document.

It also cannot cheat: the dialog counts what is free using the same maths the
register does, so it cannot claim a unit someone is mid-way through selling —
and once a phone has sold on the marketplace, the counter refuses it.

Reports now break down **by channel**, and the order reference is searchable, so
a sale is findable by its eBay order number.

**This is not a marketplace integration.** Somebody still types it in. What it
buys is that when they do, the numbers stay honest.

**Validation:** backend-sim **PASS 565 / FAIL 0** (13 new) · client units
**PASS 350 / FAIL 0**.

### Deploying

**Backend redeploy required** — two new schema columns.

---

## v1.26.0 — scheduled reports

**2026-09-11.** Sixth of the operational-readiness program.

Daily, weekly and monthly figures now email themselves to the admins you
nominate in Settings. Each report covers **the period that just closed** — a
daily sent at 06:00 is about yesterday — and carries gross sales, refunds, cash
out broken down by reason, collections, net revenue, gross profit, average
ticket, a per-cashier breakdown and the top five sellers, with the period CSV
attached.

**Nothing is scheduled until you ask for it.** All three cadences default to
off, so nobody starts receiving mail because a release shipped. There is a
**Send one now** button to see what arrives before switching anything on.

The figures come from the same function the Reports screen uses, so a mailed
report and the screen can never disagree. A failing send does not throw out of
the trigger — that would silently end all future reports — it logs and surfaces
in Settings instead.

**Validation:** backend-sim **PASS 552 / FAIL 0** (23 new) · client units
**PASS 350 / FAIL 0**.

### Deploying

1. **Backend redeploy required.**
2. **Run `installReportTriggers()` once** from the Apps Script editor.
3. In Settings → Scheduled reports, add recipients, tick the cadences, save, and
   use **Send one now** to confirm delivery.

---

## v1.25.0 — never load more than 100

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