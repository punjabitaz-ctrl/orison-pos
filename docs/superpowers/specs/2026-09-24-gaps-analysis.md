# Gaps analysis — what a trading shop needs that this build does not have

**2026-09-24, against v1.50.0.**

Read from the code, not from memory: every route in `dispatch_`, the chart of
accounts, the ledger kinds, the screens in `public/js/screens/`, and the
offline paths. Where something is a judgement call about how the shop actually
works, it says so, and the owner's answer may change the size of the job.

## What is already there

Worth stating, because the gaps below are narrow and it would be easy to read
them as "the thing is half built". Selling, refunds and approvals; serials per
unit; offline-first sync with First-Committed-Wins; cash drawer and shifts;
repairs from intake to collection, with parts and the bench's waiting list;
trade-ins; customers on account with statements; suppliers, purchase orders,
payables, statements and payments; marketplace import; warranty; double-entry
books derived from the ledger; reports, a sales report and a daily export;
audit log; time clock; nightly backup; three languages. That is a working till
and a working workshop.

The gaps are **not in selling**. They are in what happens to the money after
the sale, and in the things a business does that are not selling.

---

## Tier 0 — the shop cannot run its books without these

### 1. No opening balances — **built in v1.57.0**

A business that is already trading has stock on the shelves, cash in the
drawer, customers who owe it money and suppliers it owes. Products can be
created with a quantity on hand, so **stock can be loaded**. Nothing else can:
there is no way to enter opening cash, an opening customer balance, an opening
supplier balance, or opening equity.

Day one therefore starts every account at zero, and the balance sheet says the
shop owns its stock and owes nobody, which is false from the first hour. Every
report that compares to "before" is comparing to a void.

**Shipped in v1.57.0** for the shop's own position: till, bank and stock at
cost, posted against 3000 Opening balance equity, voidable, admin only.
**Still open:** what customers owed and what was owed to suppliers on that day
— those belong to a named counterparty rather than a lump sum, and are their
own release.

### 2. Card money is never reconciled — **closed: the shop takes no cards (owner, 2026-09-24)**

`card` is a tender label. There is no terminal integration, no settlement
import, and no way to say "the acquirer paid us this much today". Account
1010 *Card clearing* is debited by every card sale and **nothing ever credits
it**, so it grows forever and the bank balance it implies never arrives.

The shop will take most of its money this way. Without reconciliation nobody
can answer "did we actually get paid for Saturday?" — which is the question
card fraud and terminal faults are caught by.

**Owner decision first:** do they key totals into a standalone terminal (most
likely), or is there an integrated reader? If standalone, the fix is a
*card settlement* entry — "the acquirer deposited X for these days" — that
clears 1010 to the bank, plus a report of unsettled card sales. Medium.

### 3. Cash banking is a dead end

A cash pick-up debits 1030 *Cash in transit* and nothing clears it. There is
no "deposited at the bank" step. Over a year, 1030 is the sum of every pick-up
ever made and the books show a large imaginary asset in a bag.

**What it takes:** a bank-deposit entry that clears 1030 to 1020, with the
slip reference. Small, and it pairs naturally with the card settlement above.

### 4. Real operating expenses cannot be recorded

The only money-out reasons are *Paid out*, *Staff expense* and *Cash pick-up*,
and the only expense accounts are 6000 Paid out, 6100 Staff expenses and 5100
Shrinkage. There is nowhere to put **rent, wages, utilities, phone, internet,
marketing, bank charges, software, insurance, or the accountant's fee** — no
categories, no payee, nothing recurring, and no way to record an expense paid
by bank transfer rather than out of the till.

So the P&L reads: revenue, cost of goods, and petty cash. Net income is
fiction, and the shop cannot tell whether it made money last month.

**What it takes:** expense categories against real accounts, an expense entry
that takes any payment method (not just cash from the drawer), and optionally
a payee. Medium, and it is the single biggest hole in the accounting.

---

## Tier 1 — needed within weeks of opening

### 5. Stock cannot go back to a supplier

Nothing in the ledger returns goods. A faulty or wrong delivery can only be
written off as shrinkage: the shop eats the cost and still owes the supplier
for it. (Flagged before v1.49.0; still open.)

**What it takes:** a supplier return / credit note that takes the stock out,
retires the serial, debits Accounts payable, and flows through payables, the
statement, the books and the export. Medium, and well understood — it is the
mirror of v1.48.0.

### 6. No exchange

Swapping a case for a different one is a refund and then a sale: two
transactions, the customer's money round-tripping, and two receipts. Exchanges
are a daily event in a phone shop.

**What it takes:** an exchange that nets the difference in one movement and
prints one receipt. Medium; the refund engine and the money engine already
exist, the work is the flow and the receipt.

### 7. Wages are invisible — **built in v1.56.0**

The time clock records hours, but users have no pay rate and nothing turns
hours into money. Wages are usually the largest cost after stock, and they are
nowhere in the books.

**Owner decided (2026-09-24): payroll lives here.** Shipped in v1.56.0 — a
rate per person, a pay run from the time clock, adjustments with reasons, and
payment booked to Wages (6200). Statutory overtime, gratuity and withholding
are deliberately entered by hand as adjustments.

### 8. The customer is never told anything

A ticket moves to *Ready* and nobody outside the shop knows. There is no
"your repair is ready" message, no "the part you ordered arrived". Receipts
can go out by email or WhatsApp, so the plumbing is half there; status
notification is not.

**What it takes:** a message from a ticket, using the same send paths as
receipts, with a template per status. Small-to-medium, and it is the change
customers will notice most.

### 9. No bank reconciliation, and no tax-return figure

Bank transfers and cheques are recorded, but nothing matches them to a
statement. And while 2000 *Sales tax / VAT payable* now nets output tax
against input tax correctly, there is no "for this period: collected X, paid
Y, owed Z" report to file from.

**What it takes:** the tax-period report is small (the data is all there).
Statement matching is a bigger piece and may not be worth it before an
accountant asks.

---

## Tier 2 — ordinary retail the shop will ask for

None of these block trading; all of them are normal.

- **Promotions and pricing rules** — bundles, buy-one-get-one, a category on
  offer for a week. Today there are only manual line and order discounts with
  approval, keyed every time.
- **Loyalty or repeat-customer marketing** — customers exist with contact
  details; nothing uses them.
- **Quotes** for product sales (repairs have an estimate; nothing else does).
- **Appointments** for the bench.
- **Second location or stock transfers** — the schema carries `store_id`
  throughout, so it is not closed off, but nothing supports it.

**Owner has already closed:** gift cards, layaway, per-role permission
switches, an accounting platform (in-app GAAP instead), marketplace via a
Google Sheet. Do not reopen these.

---

## Tier 3 — risks that bite later, cheap to defuse now

### 10. Sheets as the database has a ceiling

`readRows_` reads **the entire sheet** on every call, and every report, the
books, payables and the bench board all call it. Nothing archives or rolls
over. At roughly fifty sales a day the Transactions sheet passes ten thousand
rows inside a year, and Apps Script has a six-minute execution limit.

It will not fail on day one. It will get slower every month until something
times out, probably during a report.

**Cheap defusal:** a year-end rollover that moves closed rows to an archive
sheet the reports read only when the period asks for it. Worth planning before
it is urgent.

### 11. Backups have never been restored

A nightly copy of the workbook lands in Drive. Nothing has ever restored one,
and there is no written restore procedure. An untested backup is a hope.

**What it takes:** restore one into a scratch workbook, write down the steps,
and put them in `DEPLOY.md`. An hour, and it converts hope into a plan.

### 12. Offline is selling-only

The register, cart, history and receipts work with no line. Repairs,
purchases, trade-ins, reports, accounts and the bench board all need the
server. If the connection drops, the counter keeps trading and the workshop
stops. That is the right priority, but the shop should be told rather than
discover it.

### 13. Lost sole-admin PIN has no way back

`setup()` refuses to re-seed a workbook that already has users, and PIN resets
need another admin. A one-admin shop that loses the PIN needs someone in the
Apps Script editor. Document the break-glass procedure, or add a second admin
as policy on day one.

### 14. Customer data has no retention or erasure path

Names, phone numbers, emails and device serials accumulate with no export for
a subject request and no way to erase one. Worth a policy decision before
volume makes it a chore.

### 15. Still unverified from earlier releases

A real printer and cash drawer have never been tested; the Arabic and Urdu
have never been read by a native speaker; the UAE invoice wording has never
been checked by a tax adviser.

---

## What I would do, in order

1. **Deploy and run a parallel week** with the owner on site — the single most
   informative thing available, and it will reorder everything below.
2. **Opening balances** (#1), because every number is wrong until they exist.
3. **Operating expenses** (#4) and **cash banking** (#3) — together they turn
   the P&L from a fragment into a real one.
4. **Card settlement** (#2), once the owner says how cards are actually taken.
5. **Supplier returns** (#5) and **exchanges** (#6) — the two daily events the
   build cannot represent.
6. **Customer notifications** (#8) — the cheapest visible win for the shop.
7. Then the Tier 2 list, by what the owner is actually asking for after a
   month of trading.

Tier 3 items 11 and 13 are an hour each and should be done on the deployment
day, not scheduled.
