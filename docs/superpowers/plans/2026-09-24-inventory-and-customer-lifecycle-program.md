# Inventory and customer lifecycle — v1.51 → v1.55

**Date:** 2026-09-24 · **Source:** owner planning session on what a
single-location UAE shop actually uses.

**Goal:** turn what the shop already records (stock, serials, sales, repairs,
warranties, trade-ins, customers) into two working surfaces it can run the
business from:

1. **Dynamic inventory management** — how much stock is worth on the shelf,
   how fast each thing sells, and the full life of every serial.
2. **Customer lifecycle management** — everything a customer is to the shop
   in one place, and the reminders the shop needs to act on.

**Owner scope choices (2026-09-24):** inventory **health & valuation**,
**serial/IMEI lifecycle trace**, **sell-through analytics**. Customers:
**customer 360 profile**, **lifecycle reminders**. Delivery: repo-convention
plan doc, one release per sprint.

**Explicitly out of scope** (refused or not chosen, so this plan does not
build them):

- **Multi-location / transfers / warehouses.** The shop is one room; stock
  velocity and valuation only.
- **Smart reordering / suggested purchase orders.** The reorder worksheet
  stays the buying tool; this program does not touch ordering.
- **Customer segments, mailing lists and WhatsApp/email outreach.** Not
  chosen. The shop talks to people at the counter.
- **Loyalty points and gift cards.** Gift cards were refused by the owner
  (2026-09-13); loyalty stays closed.
- **Per-role permission switches, external report platforms.** Refused
  (v1.23.0, v1.41.0 owner decisions).

**Baseline:** v1.50.0 · backend-sim **1126 / 0** · client **557 / 0** ·
demo **32 / 0** · pdf-smoke unrunnable here.

Every sprint follows the `AGENTS.md` protocol: one tagged revision, docs in
lockstep (sw.js/purl/package/CHANGELOG/RELEASE_NOTES/README/DEPLOY/SECURITY/
backend README/HANDOVER), all gates green, and every new string translated
into Arabic and Urdu through the `scripts/i18n` pipeline.

---

## Decisions taken on the owner's behalf

Defaults, all of them plain to change later. None opens a new settings
surface now.

| # | Question | Default chosen | Why |
|---|---|---|---|
| D1 | Who sees inventory health, sell-through and serial trace | **Admin and manager** (like Inventory tools and the Sales report; never a cashier). | These surfaces show cost and margin from sales, both hidden from cashiers everywhere else. |
| D2 | Velocity / cover window | **90 days**, computed from the same sales data the reorder worksheet already uses; a 30-day view for sell-through. | 30 days is too noisy for an electronics counter; 90 matches existing reorder math. |
| D3 | "Slow" and "dead" definition | **Slow:** cover > 180 days or ≤ 1 unit sold in 90 days. **Dead:** nothing sold in 180 days. Reported, not auto-hidden or discounted. | Categories decide markdowns, not the POS. No new settings. |
| D4 | Serial trace access | Trace **admin and manager** (it shows purchase cost and source). The existing IMEI lookup at the Counter stays any role. | Cost of a serial is cashier-invisible everywhere else in the app. |
| D5 | Lifecycle reminder surfacing | A **Reminders panel on the Dashboard** (like the open-items panels), admin and manager. No push, no email, no WhatsApp. | Remembering to act happens on open; acting happens in a screen. |
| D6 | Upgrade-candidate rule | A customer who bought a serialized device sold brand-new **≥ 24 months ago** and whose warranty has expired is an upgrade candidate. | A reasonable refresh cycle for phones and laptops in a UAE shop; the list is advisory only. |

---

## Sprint 1 — v1.51.0 · Inventory health and valuation

How much money is on the shelf, at cost and at retail, and where the slow
money sits.

- **Stock value, two ways.** For every product (and every category): units ×
  shelf price (retail) and units × latest received cost (cost). Cost reuses
  the PO-received weighted cost; serialized products value each serial at
  `Serials.cost` when present, falling back to the product cost.
- **Days of cover.** Units on hand ÷ the 90-day average units per day sold by
  that product, the same number the reorder worksheet already computes.
- **The slow list.** Each product is classified *fast / slow / dead* (D3) with
  its cover, units sold and value. Reported on screen and CSV — never
  auto-hidden, never a price change.
- **A Stock health screen**, grouped under *Stock & customers* in the nav,
  admin and manager. Opens with a category picker and a search box, like
  Products.
- `/api/inventory/health` on the backend (admin and manager), returning the
  rows, the totals at retail and cost, and the classified lists. Audited as a
  read like Reports (no `logAudit_` mutation — but gated and rate-limited the
  same way).
- The simulator reconciles its totals against the seed store's known buys
  and sales.

## Sprint 2 — v1.52.0 · Sell-through analytics

How fast things actually move, so buying decisions have numbers behind them.

- **Velocity per product.** Units and AED sold and refunded in the period
  (30/90 days), and per category on the same screen.
- **Turnover.** AED sold ÷ average shelf value over the period, per product
  and per category — the retail turnover ratio, one number each row, no
  graphs.
- **What to buy again.** The products whose velocity exceeded their stock
  cover: the ones the shop is already *selling through* faster than it's
  replacing. A one-line list, CSV export.
- Sieved on the same **Stock health screen** as a *Velocity* view or filter —
  no new nav destination, no new shell entry.
- `/api/inventory/health` gains `?view=velocity` and a 30-day window (D2),
  sharing the Sales-report money rules (net sale, tax excluded, gross profit
  with margin per row).
- The sim cross-checks velocity against the seeded sales and the report's own
  numbers.

## Sprint 3 — v1.53.0 · Serial/IMEI lifecycle trace

The whole life of every device the shop has touched, in one place.

- **A timeline per serial** joining what the shop already records:
  1. **Intake** — PO receiving (`source: po`), or a trade-in intake.
  2. **Sale** — the receipt number, customer and date; warranty starts here.
  3. **Refund / restock** — a refunded unit's serial comes back and the
     timeline says so.
  4. **Repair** — every ticket that IMEI was on, with what failed and what was
     fitted (parts come off stock and serials tie to jobs).
  5. **Trade-in back** — a sold serial bought back, with the intake value,
     then on a fresh resale.
- **Look-up points.** From a sale line on the Sales report, from a repair
  ticket, from Warranty, and a serial search box on the new screen. The
  Counter IMEI lookup and the Warranty check are unchanged.
- **A Serial trace screen** under *Stock & customers*, admin and manager (D4).
  Each step shows date and, where it exists, the customer and the money (sale
  value, intake value).
- `/api/serials/trace` (admin and manager): one IMEI → the ordered steps, with
  a `kind` for each. Reuses the serials sheet, sales rows, refund rows, repair
  tickets and trade-ins that already exist; no new storage column beyond what
  trace needs to join (a safety check before landing).
- The sim traces a seeded serial from PO intake to sale to refund and back to
  resale, and asserts the steps.

## Sprint 4 — v1.54.0 · Customer 360 profile

Everything a customer is to the shop, on one screen, so a staff member
standing with them can see it.

- **The profile** on the Customers screen (opening a customer):
  - **Summary:** total spent and net of refunds, visits (sales in the period),
    average sale, balance and credit limit, store credit left, first and last
    visit.
  - **Devices they bought:** every serialized unit with its sale date, warranty
    status and expiry — the shop knows what's in the customer's hands.
  - **Their ledger:** the existing receivables/payments list, unchanged in
    behaviour, now alongside the profile.
  - **Open repairs:** repair numbers, devices and *On the bench / Awaiting
    parts / Ready* status, and **collected** ones with the invoice total.
  - **Warranty status** per device, matching the Warranty screen's answers.
- `/api/customers/<id>/profile` (any allowed role, replicating the Customers
  screen's gating) joining sales, refunds, serials-by-sale, repairs and the
  ledger. The simulator asserts the profile numbers against seeded sales and
  repairs for two customers.
- All figures use the Sales-report money rules so the profile never
  contradicts a report.

## Sprint 5 — v1.55.0 · Lifecycle reminders

What the shop should act on, surfaced on the Dashboard where the owner or
manager opens the day (D5).

- **Warranty expiring** — active warranties ending within the next 30 days,
  with the customer, device and expiry. (Exact-date warning from data already
  captured at sale.)
- **Repairs ready** — every ticket at *Ready for collection* with days
  waiting, customer and deposit held, one tap to the Repairs screen.
- **Upgrade candidates** — customers of serialized brand-new devices sold
  ≥ 24 months ago with expired warranties (D6), with what they own.
- **Store credit left** — customers holding store credit and how much, so it
  isn't forgotten as a liability.
- One **Reminders** panel on the Dashboard, admin and manager, read-only with
  links into Sales report, Repairs, Warranty and Customers. No settings, no
  schedules, no notifications outside the app.
- Backend: a `/api/reminders` (admin and manager) that derives all four lists
  from existing data. Sim asserts each list against seeded sales and tickets.

---

**Outcome when done:** v1.55.0 · backend-sim and client counts growing per
sprint · pdf-smoke still unrunnable here and reported as such. The shop knows
what the shelf is worth, what to buy, where every device went, everything a
customer has done with it — and what to do about it today — without a single
feature that only country is too big to use.