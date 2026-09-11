# Orison POS

## Features, Capabilities & Functions

*An AYiN Advisors Project*

---

## What it is

A point-of-sale system for Orison Electronics that runs in the browser, installs
on staff phones and tablets like an app, and keeps selling when the internet
goes down.

There are no per-seat licence fees and no monthly software bill. The back end
runs on a Google Apps Script web app with Google Sheets as the store of record
and Google Drive for exports — all inside the shop's existing Google account.
Adding a fifth terminal costs nothing.

---

## Selling

**Register.** Search by name or SKU, scan with a handheld barcode reader, or tap
a product tile. Category filters sit above the grid. The running total is pinned
above the tab bar at all times, so nobody has to open the cart to see what the
customer owes.

**Serialised stock (IMEI).** Phones, tablets and laptops are tracked one unit at
a time. Selling one requires capturing its IMEI or serial, which is then bound to
that sale for life — through history, refunds, receipts and the audit trail.

**Split tender.** A single sale can be paid part cash, part store credit, part on
account, with change calculated automatically and a quick-round keypad for notes.

**Discounts and tax.** Per-line discounts and an order-level discount, applied on
top of each other, with the store's sales-tax rate computed on the taxable
portion only.

**Receipts.** Print to an 80 mm thermal roll, share by the phone's native share
sheet, or copy to the clipboard. A PDF can be sent directly to the customer.

**Customer display.** A second screen facing the shopper mirrors the cart live:
item names, quantities, prices, amount due, and change. Cost, margin and customer
records never cross to that screen.

---

## Works offline

This is the part most systems get wrong.

Every sale is written to the terminal first and queued. When the connection
returns, the queue syncs automatically. Staff never wait for a spinner, and a
dropped connection never stops a sale.

When two terminals disagree — the same phone sold twice, say — the server settles
it **first-committed-wins**: the first sale through is kept, the second is marked
VOIDED, its stock is restored on that device, and the conflict is logged for a
manager to review. Nothing is silently lost.

A terminal that has been offline for a long stretch keeps working because the
server issues it a credential at sign-in. No PIN is ever stored on the device.

---

## Money and accountability

**Till shifts.** Open a shift with a float, close it with a denomination count in
the store's own notes and coins, and the system reports *declared / expected /
over-or-short* per cashier.

**Three kinds of cash out, tracked separately.** Paid Out (a supplier or bill),
Cash Pick Up (to the bank, the safe or the owner) and Staff Expense
(reimbursement) are three distinct records — not one free-text note. "How much
went out as staff expense last month?" is a question the ledger answers.

**Refunds.** Restricted to managers and admins, validated against the original
sale and any prior refunds, with stock returned automatically.

**Customer accounts.** Net-30 terms, a per-customer ledger, money-in collections,
outstanding receivables, and 30/60/90+ day ageing buckets.

**Statements of account.** A chronological debit/credit statement with a running
balance, printable on the thermal roll or exported to CSV.

---

## Stock control

**Catalog.** Products and services, serialised or counted, with cost price,
retail price, category, reorder point and a lock switch that holds an item back
from sale.

**Purchase orders.** Supplier records and a full PO lifecycle — draft, ordered,
partially received, received, cancelled. Receiving posts stock in at a
weighted-average cost, takes serials one unit at a time, and writes a purchase
ledger entry that never counts as a sale.

**Price history.** Every cost and retail change is recorded per product: who
changed it, when, and why — a manual edit, a bulk update, or a weighted cost from
a PO receipt, tagged with the PO number.

**Stock take.** Scan or search the shelf, enter the physical count, and commit.
Each line records what the book said, what was counted, the variance, and what
that variance is worth at cost.

**Bulk price update.** Reprice a category or the whole catalog by percentage,
amount, or a fixed price, with optional rounding. Preview every change before
anything is written; each applied change lands in price history.

**Reorder worksheet.** What to buy next, from real sales velocity — units sold
over a window, days of cover at the current rate, a suggested order quantity, the
last supplier who delivered it, and the estimated cost. Exportable to CSV.

**Shelf labels.** Code 128 barcodes with name and price, printed as a sheet.

**Inventory ageing.** How long stock has been sitting, in 0–30 / 31–60 / 61–90 /
90+ day buckets, valued at cost, so dead stock is visible before it becomes a
write-off.

**Alerts.** Out of stock, below reorder point, locked, and slow-moving items,
with a live count on the main menu.

---

## Reporting

Period KPIs — gross sales, refunds, cash out by reason, collections, net revenue,
gross profit, average ticket — broken down by day, category, cashier and payment
method, with top products and top customers.

Gross profit uses the cost captured **at the moment of sale**, so editing a
product's cost today never rewrites last month's margin.

One-tap CSV export to Google Drive with a cash summary block for reconciliation.
Everything buckets by the store's own calendar day, not UTC.

---

## Staff

**Time clock.** Punch in and out from any terminal. One open entry per person,
closed in place with elapsed minutes. Nobody can punch for anyone else.

**Performance.** Sales, tickets, average ticket, margin, hours worked and sales
per hour, per cashier, over today, seven days or thirty days.

**Roles.** Admin, manager and cashier, enforced on the server for every
privileged action — not merely hidden in the interface.

---

## Security

- PINs are salted and hashed; the PIN itself is never stored on a device.
- Sessions are signed, expire in 12 hours, and are revoked immediately on
  sign-out, PIN change, role change, or an admin kill switch.
- A lost or stolen terminal can be revoked individually; it is blocked at its
  next contact with the server.
- Five wrong PINs lock that account for 15 minutes.
- A strict Content-Security-Policy, no inline scripts, and no third-party code.
- Every field rendered from user data is escaped; CSV exports are guarded
  against spreadsheet formula injection.
- Cashiers cannot read other cashiers' till reconciliations, cost prices or
  transactions.

A written security posture, including the deliberate trade-offs of an
offline-first design, ships with the system.

---

## Runs on what you already own

Phones, tablets and desktop computers — the interface adapts to each. Install it
from the browser and it behaves like an app, full screen, with its own icon.

Eighteen currencies are supported, including **USD, GBP, EUR, AED and PKR**, each
with the correct notes and coins for counting a drawer. The shop picks its
language region, country and currency at setup.

---

## Quality

Every release is a single tagged revision, validated before it ships:

- **462** automated back-end checks against a simulated Google environment
- **326** automated front-end checks
- Receipt and PDF rendering smoke-tested in a real browser
- Every screen verified at phone, tablet and desktop widths

---

*An AYiN Advisors Project*
