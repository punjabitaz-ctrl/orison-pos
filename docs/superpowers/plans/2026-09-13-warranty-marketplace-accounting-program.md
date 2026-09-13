# Warranty, marketplace sync and accounting — v1.41 → v1.43

**Owner decisions (2026-09-13):**

| Topic | Decision |
|---|---|
| Warranty | **30 days**, or **1 year for brand-new hardware** |
| Gift cards | **Not wanted** |
| Accounting | **Generally accepted accounting principles**, **no platform** (no QuickBooks, Xero or Zoho) |
| Marketplace sync | **Driven by a Google Sheets file** |
| Per-role permission switches | **Not wanted** |

Trade-in/buyback and layaway were not answered and stay open.

**Baseline:** v1.40.0 · backend-sim 869 · client 481.

---

## How the decisions are read

| # | Reading | Why |
|---|---|---|
| W1 | Every product carries a warranty: **1 year** (brand-new hardware), **30 days**, or **none**. New products default to 30 days and services to none. An admin or manager marks brand-new hardware as 1 year. | The shop sells used and liquidated stock as well as new, so "1 year" cannot be assumed from a product being serialized. |
| W2 | The warranty is **captured on the sale line** and runs from the sale date. Editing a product later does not change warranties already sold. A refunded unit's warranty ends. | Same principle as cost captured at sale. |
| M1 | The shop keeps its marketplace orders in **one Google Sheet** with a fixed template. The POS imports rows it has not seen, writes back a status on each row, and keeps a **Stock** tab current so listings can be updated from it. | "Based on a Google Sheets file" names the sheet as the source of truth for orders, not an API. |
| M2 | Each order becomes a sale on the `marketplace` channel through the same push path as a till sale: stock moves, serials are claimed first-committed-wins, a receipt number is issued. Re-importing is idempotent. Prices come in as the platform charged them, with no POS tax added, because the platform collects the tax. | One path for stock, so marketplace and shelf can never disagree. |
| A1 | **Accrual basis, double entry.** A journal is derived on demand from the ledger for any period. Every entry balances, and the trial balance must balance. | GAAP revenue recognition at the point of sale; deposits and store credit are liabilities; COGS is matched to revenue at the cost captured at sale. |
| A2 | **Revenue is recorded net of discounts**, split into product and service revenue. Sales tax and VAT go to a payable account. Refunds go to a sales-returns contra account. Purchases are debited to inventory and credited to accounts payable. | Standard small-retail chart of accounts; each account is named so a bookkeeper can map it. |
| A3 | Admin only. The output is on screen and as CSV (journal, trial balance, P&L). **No external platform.** | Owner decision. |

---

## Sprint 1 — v1.41.0 · Warranty per sale

- `Products.warranty_days` (0 / 30 / 365), set on create and edit with the
  choices *No warranty* / *30 days* / *1 year — brand-new hardware*.
- Sale lines capture `warrantyDays`. Receipts print "Warranty: 1 year, until
  DATE" under each covered line.
- `/api/warranty?q=` (any role) takes an IMEI or a receipt number. It returns
  each covered line with its product, sale date, receipt, customer and expiry,
  and a status: *active*, *expired* or *refunded*.
- Repairs: booking in a device whose IMEI was sold here records the warranty
  status on the ticket, and the ticket shows *Under warranty until …* or
  *Warranty expired …*.
- The Repairs screen gets a **Check warranty** lookup.

## Sprint 2 — v1.42.0 · Marketplace sync from a Google Sheet ✅ shipped

- Admin setting: the sheet's URL or ID. The template tab **Orders** has the
  columns *Order ref · Date · Channel · SKU · IMEI / Serial · Quantity · Unit
  price · Status · Note*. The POS creates the tab and headers if they are
  missing.
- `/api/marketplace/import` (admin, manager), and a trigger installed by
  `installMarketplaceTrigger()` that runs hourly:
  - rows with an empty Status are grouped by order ref
  - each order is validated (SKU exists, IMEI in stock, quantity on hand)
  - each order is pushed as a marketplace sale
  - the row is marked *Imported Orison-S…* or *Error: reason*
- A **Stock** tab is rewritten on each run with SKU, name, available and price.
- Settings card: sheet link, *Import now*, last run summary. Audited as
  `marketplace.import`.

## Sprint 3 — v1.43.0 · Accounting (GAAP, in-app) ✅ shipped

- Chart of accounts:

  | Code | Account |
  |---|---|
  | 1000 | Cash |
  | 1010 | Card clearing |
  | 1020 | Bank transfers |
  | 1030 | Cash in transit (pick-ups) |
  | 1100 | Accounts receivable |
  | 1150 | Marketplace receivable |
  | 1200 | Inventory |
  | 2000 | Sales tax / VAT payable |
  | 2100 | Customer deposits |
  | 2200 | Store credit |
  | 2300 | Accounts payable |
  | 4000 | Product sales |
  | 4010 | Service sales |
  | 4100 | Sales returns |
  | 5000 | Cost of goods sold |
  | 5100 | Inventory shrinkage |
  | 6000 | Paid out |
  | 6100 | Staff expenses |
  | 6900 | Rounding |

- `/api/accounting` (admin) builds, for a period:
  - the journal, one balanced entry per transaction and stock take
  - the trial balance
  - a profit and loss statement: revenue, returns, net sales, COGS, gross
    profit, expenses, net income
  - balance movements for cash, receivables, inventory, tax payable, deposits,
    store credit and payables
- An **Accounts** screen (admin): period picker, P&L, trial balance, CSV exports
  of the journal and the trial balance.
- Sim checks prove that every entry balances, the trial balance nets to zero,
  and the figures reconcile with Reports.

---

## Closed by decision

- **Gift cards / store credit as an object:** not wanted.
- **Accounting platform integration:** not wanted; accounting is in-app
  (Sprint 3).
- **Per-role permission switches:** not wanted; manager approval covers it.

## Still open

- Trade-in / buyback: the cost basis.
- Layaway on sales.
