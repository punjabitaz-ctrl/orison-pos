# Backend — Google Apps Script

`Code.gs` is the entire backend: a Web App that fronts a **Google Sheet** for data and **Google Drive** for exports and backups. No VM, no runtime cost, no database to run.

## Deploy (once)

1. **New Apps Script project** at script.google.com → paste all of `backend/Code.gs` → save.
2. **Project Settings → Script Properties**:
   - `APP_TOKEN` — a long random secret (e.g. `openssl rand -hex 32`). The app asks for it at first launch.
   - optional `SPREADSHEET_ID` — if omitted, a spreadsheet named "Orison POS" is created and its id stored here.
   - optional `FOLDER_ID` — the Drive folder for daily exports (defaults to "Orison POS Export").
3. **Select `setup` and Run.** The first run asks you to approve the script's Google permissions: Sheets, Drive, triggers and mail. It then creates the workbook and seeds the starter accounts and catalog. Open **View → Executions**, open that run, and copy the **one-time 6-digit PIN printed for each starter account**. They are never shown again. `setup` is safe to run again: a seeded workbook is left alone, and a workbook with sales in it is refused.
4. **Run `installBackupTrigger`** once. Nightly backups start at 02:00.
5. **Run `installReportTriggers`** once. Daily, weekly and monthly reports are then *able* to run. Each cadence stays **off** until an admin switches it on in Settings → Scheduled reports.
6. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Anyone** (the `APP_TOKEN` is the real gate). Copy the **`/exec` URL**.

Then paste that URL and the `APP_TOKEN` into the app (**Backend** on the sign-in screen).

**Updating.** Paste the new `Code.gs`, then **Deploy → Manage deployments → Edit → Version: New version**. An old version keeps serving until you do. Deploy the backend **before** pushing a new front end.

## What it provides

Every call is an `action` string posted to `/exec` (see [Envelope](#envelope)). Roles are checked server-side by `requireRole_`; the full who-can-do-what table is in [`../docs/superpowers/specs/2026-09-12-roles-and-gaps-review.md`](../docs/superpowers/specs/2026-09-12-roles-and-gaps-review.md).

### Auth, staff and terminals

- **Auth:**
  - shared `APP_TOKEN` plus a per-login HMAC session token (12 h)
  - per-user and per-device revocation
  - login lockout
  - offline credentials for terminals
- `/api/login`, `/api/logout`, `/api/pin` (own PIN).
- `/api/admin/unlock` (admin, manager).
- `/api/admin/pin` (admin; a manager for cashiers only). `/api/admin/users/list` (admin, manager).
- `/api/admin/revoke`, `/api/admin/devices`, `/api/admin/revoke-device` (admin).
- `/api/admin/users`, `/users/patch` (admin). Create staff and change `firstName`, `lastName`, `email` (unique), `role` or `active`. A role or email change, or a deactivation, revokes that person's sessions. An admin cannot demote or deactivate themself.
- `/api/config` returns the store, currencies and, to managers and admins only, the staff roster.

### Selling and sync

- **Sync:** `/api/sync/pull` (products, users, store, watermark, `openConflicts`) and `/api/sync/push`. Push is First-Committed-Wins under `LockService`: a duplicate serial is rejected and the losing sale is marked `VOIDED`. A re-push of an already-recorded transaction is idempotent.
- **Transaction kinds:**
  - `sale`
  - `refund`, `payout`, `pickup`, `expense`, `payment`: admin and manager only. Refused per row with `unauthorized_role`.
  - `purchase`: written by PO receiving; never counted as a sale.
  - `deposit` and `deposit_refund`: **server-only**. A device can neither push them nor tender `deposit`.
- **Refunds** are validated against the original sale and earlier refunds. **Any service line is refused whole** (`service_not_refundable`, v1.33.0). A cashier's refund needs a `refund` approval for its `clientTxId`, and the approval may cap the amount (`approval_amount_exceeded`).
- **Manager approval** (v1.37.0): `/api/approve` takes `{ email, pin, action, ref, pct?, amount?, note? }`, where action is `refund` | `discount` | `drawer` | `deposit_refund` | `credit`. It returns `{ approval, approver, expiresAt }`. A wrong PIN is 403 and counts toward the sign-in lockout. The approver must be a different, active manager or admin. See SECURITY.md → Manager approval.
- **Discount limits** (v1.37.0): the store carries `discountLimitCashier` (10) and `discountLimitManager` (50), set through `/api/admin/store`. A sale whose deepest line, `1 − (1 − line%)(1 − order%)`, exceeds the seller's limit is refused with `discount_over_limit` unless it carries a `discount` approval covering it. Transactions record `approved_by`.
- **Tenders:** cash, card, store credit, Net-30 (on account). Card is recorded, and excluded from the expected drawer.
- **Receipt numbers** (v1.22.0): `Orison-S000001`, gap-free. The number is allocated at push, inside the lock that appends the sale, and only for sales and refunds. The prefix is `Meta` `receipt_prefix`.
- **Channels** (v1.27.0): `channel` (`in_store`, `online`, `marketplace`, `phone`, `other`) and `external_ref` on every transaction. Reports carry `byChannel`. A non-`in_store` sale from a cashier is refused (v1.36.0).
- **Conflict registry:** `SERIAL_CLAIM`, `DUPLICATE_CLIENT` and `CLOCK_SKEW` rows in `Conflicts`, via `/api/conflicts` and `/api/conflicts/review` (`dismiss` | `resolve`), admin and manager.
- **History:** `/api/transactions`, capped at 100 rows with keyset paging (`cursor`) and server-side search (`q`: receipt number, client id, customer, item, IMEI, amount). A cashier gets their own rows; with `lookup=1` and a query of at least four characters, a cashier searches every sale and refund in the shop (20 rows, `own` flag, no cost or margin).
- **Cash drawer** (v1.34.0): `/api/drawer/open` records a no-sale open with its reason and terminal in the audit log. Admin and manager act alone; a cashier needs a single-use `drawer` approval (v1.37.0).

### Repairs (v1.31.0–v1.32.0)

- `/api/repairs`: create a ticket (`Orison-R000001`), or list them (paged 100, search, status filter).
- `/api/repairs/detail`.
- `/api/repairs/parts`: fit a part (stock moves when fitted) or return one.
- `/api/repairs/labour`.
- `/api/repairs/status`: `intake → diagnosed → awaiting_parts → in_progress → ready → collected`, or `unrepairable` / `cancelled`. Closing without collection returns every fitted part to stock.
- `/api/repairs/deposit`: taken at intake; held as a liability, not revenue.
- `/api/repairs/collect`: writes the sale directly, applies the deposit, and moves no stock.
- All of the above are open to every role.
- `/api/repairs/deposit-refund` (admin, manager; a cashier with a single-use `deposit_refund` approval whose ref is `ticketId|nonce`). `/api/repairs/void` (admin only, for a ticket that should never have existed).
- Every repair action is audited.

### Warranty (v1.41.0)

- `Products.warranty_days` is 365 (brand-new hardware), 30 or 0, set via `warrantyDays` on create or patch. A missing value reads as 0 for a service and 30 otherwise.
- Sale lines capture `warrantyDays`; refund lines do not.
- `/api/warranty?q=` (any role) takes an IMEI, a serial or a receipt number. It returns the matching sales, newest first, each with its covered lines, `expiresAt`, `daysLeft` and `status` (`active` | `expired` | `refunded`).
- `/api/repairs` create looks up the device serial and stores `warranty_status`, `warranty_until` and `warranty_receipt` on the ticket.

### Marketplace sync (v1.42.0)

- `/api/marketplace/settings` (set the sheet: admin): `{ sheet }` takes a Google Sheets link or ID. The sheet must open, and the **Orders** tab is created if missing. It is stored in the Script Property `MARKETPLACE_SHEET_ID`, with `Meta.marketplace_user` as the account for scheduled runs. Reading (admin, manager) returns `configured`, `last`, and, for admins, the link.
- `/api/marketplace/import` (admin, manager) and the `marketplaceImport` trigger (`installMarketplaceTrigger()`, hourly):
  - imports **Orders** rows with an empty *Status*, one sale per *Order ref*
  - validates SKU, IMEI and quantity on hand, counting earlier orders in the run
  - pushes through `syncPush_` as device `marketplace-sheet`, with clientTxId `mkt-<hash of ref>`, tender `marketplace` and no tax added
  - writes *Status* and *Note* back, rewrites the **Stock** tab, and records `Meta.marketplace_last`

### Trade-ins (v1.44.0)

- `/api/tradein`:
  - **Roles:** admin or manager. A cashier needs a single-use `tradein` approval whose ref is `IMEI|nonce` and whose amount covers the price.
  - **Payload:** `{ customerId, productId, serialNumber, condition, notes, amount, paidBy, idType, idRef }`.
    - `condition`: `like_new` | `good` | `fair` | `faulty`
    - `paidBy`: `cash` | `store_credit`
    - `idType`: `driving_licence` | `passport` | `national_id` | `other`
    - `idRef`: 2 to 6 characters, never the full document number
  - **Stock:** the product must be serialized. An IMEI already `IN_STOCK` is a 409. A `SOLD` serial row is reused (bought back).
  - **Writes:**
    - the serial, with `cost` = amount and `source = 'tradein'`
    - a `tradein` Transactions row (tender = paidBy, `external_ref` = `Orison-T######` from `Meta.tradein_seq`)
    - a `TradeIns` row and the `tradein.create` audit entry
- `/api/tradeins` (admin, manager): the register, newest first, `?q=` search, with `inStock`.
- **When sold, fitted or refunded:** a serial's own `cost` wins over the product cost. `source = 'tradein'` caps `warrantyDays` at 30 (`USED_WARRANTY_MAX`).

### Customers and receivables

- `/api/customers` (search) and `/api/admin/customers` (create) are open to any role since v1.38.0. Only a manager or admin can set a credit limit when creating a customer.
- `/api/customers/balance?customerId=` (any role): `owes`, `storeCredit`, `balance`, `creditLimit`, `available`. Totals only.
- `/api/admin/customers/patch` (admin, manager): `creditLimit` (0 = none), `trn`, `name`, `phone`, `email`, `note`. Audited as `customer.update`. A customer's `trn` (15 digits in the UAE) is printed on tax invoices and returned as `customerTrn` on transactions.
- **Credit limits at push:** a Net-30 charge that takes `owes` past `credit_limit` is refused with `credit_over_limit` unless the sale carries a `credit` approval for at least the overage. Earlier sales in the same batch count. A sale can carry `approvals: { discount, credit }`.
- `/api/customers/ledger`, `/api/customers/receivables` (30/60/90+ aging) and `/api/customers/statement` (chronological debit and credit lines, with a running balance that closes on the ledger balance). All three are admin and manager.
- **Customer 360 profile** `/api/customers/profile?customerId=` (admin, manager, v1.54.0): everything one customer is. `summary` — `totalSpent` and `netOfRefunds` on the Sales-report money rules (gross is what completes at the till, refunds reduce it), `visits` (every completed transaction that named them), `averageSale`, `firstVisit`/`lastVisit`, `balance`/`owes`/`storeCredit`/`creditLimit` (same numbers as the ledger). `devices` — every serialized unit on their completed sales with `price` (what they paid, line discount applied), `warrantyDays`, `expiresAt`, `daysLeft` and `status` (`active`/`expired`/`refunded`/`none`), matching the Warranty screen's answer. `repairsOpen` (intake → ready) and `repairsCollected` (with `finalTotal`), joined on the repair's customer. `ledger` — the same credit/account/balance, aging buckets and last 100 transactions a manager sees.

### Shifts and time clock

- `/api/shifts/open` and `/api/shifts/close` are own-shift only, for any role. Close takes a denomination count and returns *declared / expected / over-or-short*.
  - Expected cash is the cash side of every movement on that shift: sales, collections and repair deposits in; refunds, paid out, pick ups, staff expenses and deposits given back out. Card is excluded.
  - `/api/shifts` returns the store-wide roster to managers and admins; a cashier gets their own.
- `/api/timeclock/punch` toggles the caller's own clock; offline punches carry the moment they happened. `/api/timeclock/correct` (admin, manager; own punches admin only) sets `clockIn`/`clockOut` with a required `reason`, recomputes minutes, marks the entry `corrected`, and is audited with the original times.
- `/api/shifts/force-close` (admin, manager) closes someone else's open shift with a required `reason`. With `denoms` the over/short is computed; without, `declaredCash` and `overShort` stay empty and the shift is *not counted*. `closedBy` is recorded and the close is audited. `/api/timeclock` gives a cashier their own punches, and managers and admins the roster and an `onFloor` count.

### Stock

- `/api/products` and the pull snapshot. Cost prices go to managers and admins only.
- `/api/admin/products`, `/products/patch`, `/serials`, `/inventory` (admin, manager): create, edit, add serials, adjust counted stock (`reason` is recorded in the audit log).
- **Suppliers** `/api/suppliers` (list: admin, manager; add: admin). **Purchase orders** `/api/purchase-orders`, `/detail`, `/receive` (admin, manager): receiving posts weighted-average cost, serials unit by unit, and a `purchase` ledger row. `/cancel` is admin only. Receipts record `supplier_id` and `po_id` (v1.48.0).
- **What a delivery is owed** (v1.49.0): `poNetGoodsC_(po, subtotalC)` applies the order's discount, `poTaxShareC_(po, subtotalC)` its tax pro rata on the ordered cost. Receiving works both out cumulatively (the order's owing after this delivery less its owing before), so the deliveries of an order always add up to `po.total` and the last one carries the rounding. The discount is inside the cost blended into the product and written on a serial (`Serials.cost`, `source: po`); the tax is not — it goes on the receipt as `tax_amount` and the books debit it to 2000. `/receive` returns `goodsValue`, `taxValue` and `receivedValue` (their sum); `/detail` adds `netUnitCost` per line.
- **Supplier payments** (v1.48.0):
  - `/api/suppliers/payables` (admin, manager): per supplier, `received`, `paid`, `balance` and `overdue` (deliveries past `termsDays_(payment_terms)` less payments, oldest first), plus `orders[]` with payment state; `totalOwed`, `totalOverdue`.
  - `/api/suppliers/statement?supplierId` (admin, manager): the same, plus `lines[]` with a running balance.
  - `/api/suppliers/payment` (admin, manager): `{ supplierId, amount, method: cash|bank|cheque, reference (required unless cash), poId?, note? }`. It refuses more than is owed on the order or to the supplier, and writes a server-only `supplier_payment` row.
  - `/api/suppliers/payment/void` (admin): `{ id, reason }` sets that row to VOIDED.
  - Older receipts are linked by `payableLinks_` (the `po-<id8>` client id, or the supplier name).
- **Price history** `/api/price-history` (admin, manager): sources `create`, `patch`, `po` and `bulk`.
- **Inventory aging** `/api/inventory/aging` and **reorder worksheet** `/api/inventory/reorder` (admin, manager).
- **Inventory health** `/api/inventory/health` (admin, manager, v1.51.0): what the whole shelf is worth at retail and at cost — and who is selling. `days` (1–365, default 90) is the velocity window. Sale units and revenue come from the ledger; on-hand comes from the catalog. `perDay` is ledger units against window days (not a calendar rate), and `daysOfCover` is current on-hand divided by it. A product is `slow` (cover > 180 days, or ≤ 1 unit sold in the window) or `dead` (0 units sold in 180 days) — reported, never auto-hidden or discounted. Serialized stock is valued at known serial costs (a serial bought back keeps its original cost) plus the product cost for unallocated units; stock with no price history carries the product cost. Returns the summary, per-category aggregation, and every item server-side sorted, `onHand > 0`, excluding services and inactive products.
- **Inventory velocity** `view=velocity` on `/api/inventory/health` (admin, manager, v1.52.0): the same window read as sell-through. Each row adds `avgShelfValue` (window-average on-hand × retail), `turnover` (net revenue ÷ avg shelf value; `null` at ≤ 0 revenue so it is never negative), `perDay`, `daysOfCover`, `grossProfit`, `margin`, `receivedUnits` and a `buyAgain` flag — `netUnits > 0 && netUnits > receivedUnits && (onHand === 0 or cover < days)` after refunds net at what the customer actually paid and line discounts apply per the health rules. Rows before the first movement get `avgShelfValue` 0 and `turnover` null. Services and inactive products are excluded; serialized lines count serials in stock. Returns summary, categories, items sorted by net revenue, and a `buyAgain` shortlist sorted by net units.
- **Serial lifecycle trace** `/api/serials/trace` (admin, manager, v1.53.0): given an IMEI or serial number (`q`, at least three characters), returns the serial's identity and an ordered timeline of every leg it has walked, `steps`, each `{ kind, date, ... }`. Kinds: `intake` (from the Serials row — `source` `po`/`tradein`, `money` the value paid, dated by the immutable `created_at` intake stamp now recorded on every intake path; a bought-back serial keeps its original stamp, so it is one intake, not two), `sale` and `restock` (matched to sale and refund rows whose `items_json` carries that `serialNumber`, with `money` the line value, `receipt`, `customer` resolved via `customer_id`), `repair` (repairs whose `device_serial` matches, with `ticket`, `repaired` status, `issue`), and `tradein` (TradeIns rows for that serial, `money` the buy-back value, `seller`). Returns `found:false` for unknown serials; read-only, admin and manager only.
- **Bulk price update** `/api/admin/products/bulk-price` (admin). The client sends a rule, never prices. `preview: true` writes nothing.
- **Stock take** `/api/admin/stock-take` (admin). Read and write happen in one lock, every line is recorded, and one bad line rolls back the count.

### Reports, exports and the business

- **Reports** `/api/reports` (admin, manager):
  - summary: gross sales, refunds, paid out, pick ups, expenses, collections, deposits in / applied / refunded, net revenue, tax, gross profit at the cost captured at sale, discounts given and how many sales had an approved discount
  - breakdowns by day, hour (`byHour`), category, cashier, tender and channel; `byCashier` rows carry `userId`, `grossSales`, `refunds`, `refundCount`, `avgSale`, `itemsPerSale` and `margin`
  - top products and top customers
- **Sales report** `/api/reports/sales` (admin, manager; a cashier is forced to their own `userId` and never gets cost, profit or margin):
  - **params:**
    - `from`, `to`
    - `groupBy`: `day` | `hour` | `staff` | `category` | `product` | `tender` | `channel` | `customer`
    - filters: `userId`, `category`, `productId`, `tender`, `channel`, `customerId`, `kind` (`sale` | `refund`)
    - paging: `offset`, `limit` (≤ 5000)
  - **Line money:** `salesLines_()` splits each transaction's net, tax and cost across its lines with `splitCents_()` (largest remainder), so the lines add back exactly. Refund tax comes from `refundSplit_`, and `tenderAmountsC_()` takes change off cash.
  - **Filters:** category and product filters keep only the matching lines.
  - **Returns:** `summary`, `groups`, `rows` (with `lines`), `rowsTotal`, and `options` for the filter lists.
- **Drive export** `/api/drive/export`:
  - admins and managers export the store's day, with a summary block: SALES, TAX COLLECTED, REFUNDS, PAID OUT, CASH PICK-UP, STAFF EXPENSE, COLLECTIONS, DEPOSITS IN / APPLIED / REFUNDED, CARD, CASH IN DRAWER, NET CASH
  - cashiers export their own rows
- **Accounting** `/api/accounting` (admin, v1.43.0), `?from=&to=` like Reports:
  - GAAP double entry derived from the ledger on an accrual basis; `CHART_OF_ACCOUNTS` runs from 1000 Cash to 6900 Rounding
  - one balanced entry per completed transaction (`sale`, `refund`, `payout`, `pickup`, `expense`, `payment`, `deposit`, `deposit_refund`, `purchase`) and per stock-take session
  - tenders map through `TENDER_ACCOUNTS`; change is taken off cash; refund tax is the original sale's tax share (`refundSplit_`), which Reports gross profit also uses
  - posting is in cents, with residuals squared to 6900 Rounding
  - returns `pnl`, `trialBalance` (`balanced`), `movements`, `journal`, `checks`
- **Scheduled reports** `/api/reports/schedule` (admin): recipients and per-cadence switches.
  - Triggers: `reportDaily` 06:00, `reportWeekly` 07:00, `reportMonthly` 08:00 every 30 days.
  - Each covers the period that just closed. **Monthly is a rolling 30 days, not a calendar month.**
- **Backups** `/api/backup/status` and `/api/backup/run` (admin).
  - The `backupDaily` trigger writes a date-and-time-stamped copy of the workbook to the Drive folder **POS Backup**.
  - It keeps the last 30 daily copies and the first of each of the last 12 months.
  - A failure is recorded, never thrown.
- **Audit log** `/api/audit` (admin): append-only, 100 per page, filter by actor, action and date. There is no update or delete path.
  - Records money (refunds and cash-outs as they sync, drawer opens, exports), stock (adjustments with a reason, stock takes, product create and edit, bulk pricing, serials, suppliers, purchase orders), repairs, and people and access (sign-ins, lockouts, unlocks, staff create and edit, PIN resets, revocations, customers, conflict reviews), plus store settings, reports and backups.
  - The full action list is in SECURITY.md → Audit log.
- **Tax jurisdiction** (v1.40.0), in the same route: `taxJurisdiction` (`US` | `AE` | `NONE`), `taxRegNo` (a UAE TRN is 15 digits, spaces stripped) and `pricesIncludeTax`. Switching to `AE` adopts 5 % and inclusive prices unless the call says otherwise. With inclusive prices, `saleTotals_` charges the shelf price and extracts the tax as `gross × rate ÷ (100 + rate)`. Sale rows record `tax_inclusive` and `tax_rate`. Gross profit everywhere uses `saleNetExTax_` (subtotal − order discount − included tax, in cents).
- **Store settings** `/api/admin/store` (admin): any subset of `taxRate`, `tzOffsetMin`, `locale`, `country`, `currency`, `denoms`, the discount limits and the tax fields above. Only fields that are sent are written. Changing currency without a ladder adopts that currency's notes and coins. The store `locale` also picks the receipt and customer-display language (en, ar, ur).

## Tab layout in the Sheet

Tabs are created, and new columns added, on first use; nothing needs creating by hand.

| Tab | Columns |
| --- | --- |
| `Meta` | `key`, `value` — store settings (`store_*`, incl. locale, country, currency, denoms, tax rate, tz offset; `tax_jurisdiction`, `tax_reg_no`, `prices_include_tax`; `discount_limit_*`), counters (`receipt_seq`, `repair_seq`), prefixes, report schedule |
| `Users` | id, store_id, first_name, last_name, email, pin_salt, pin_hash, role, active, created_at |
| `Devices` | id, user_id, device_id, first_seen, last_seen, revoked |
| `Products` | id, sku, upc, name, category, cost_price, retail_price, is_serialized, on_hand, item_type (`product`/`service`), locked, reorder_point, last_sold_at, active, updated_at, taxable, warranty_days |
| `Serials` | id, product_id, serial_number, status (`IN_STOCK`/`SOLD`/`VOIDED`), tx_id, updated_at |
| `Transactions` | id, store_id, user_id, device_id, client_tx_id, kind, original_client_tx, counterparty, grand_total, status, tenders_json, items_json, note, created_at, subtotal, tax_amount, discount_pct, customer_id, receipt_no, channel, external_ref, approved_by, tax_inclusive, tax_rate |
| `Customers` | id, store_id, name, phone, email, note, created_at, credit_limit, trn |
| `Shifts` | id, store_id, user_id, device_id, opened_at, closed_at, opening_float, cash_expected, cash_declared, over_short, tenders_json, note, status, closed_by |
| `TimeClock` | id, store_id, user_id, device_id, clock_in, clock_out, minutes, note, status, corrected_by |
| `Conflicts` | id, store_id, type, serial_number, device_id, loser_client_tx, winner_tx_id, summary, status, created_at, reviewed_at, reviewed_by, dedupe_key |
| `Suppliers` | id, store_id, name, phone, email, address, payment_terms, active, created_at |
| `PurchaseOrders` | id, store_id, supplier_id, po_number, order_date, expected_date, status, items_json, received_json, subtotal, discount_pct, tax_amount, total, note, created_by, created_at, updated_at |
| `PriceHistory` | id, store_id, product_id, product_name, field, old_value, new_value, source, po_id, changed_by, created_at |
| `StockTakes` | id, store_id, session_id, product_id, product_name, sku, expected, counted, variance, unit_cost, value_delta, counted_by, note, created_at |
| `Repairs` | id, store_id, ticket_no, customer_id, customer_name, customer_phone, device_make, device_model, device_serial, reported_fault, condition_note, accessories, status, parts_json, labour_json, estimate_total, deposit_total, final_total, assigned_to, note, created_by, created_at, updated_at, promised_at, closed_at, invoice_tx_id, warranty_status, warranty_until, warranty_receipt |
| `AuditLog` | id, store_id, at, user_id, user_name, role, action, target_type, target_id, summary, device_id |

Only `APP_TOKEN` holders can reach the data through the API. Anyone with edit access to the Sheet can change it directly, and that leaves no audit entry, so keep Sheet sharing tight.

## Editor functions

| Function | Purpose |
| --- | --- |
| `setup()` | First-run seed and permissions. Safe to re-run. |
| `installBackupTrigger()` | Nightly backup at 02:00. Re-running replaces the trigger. |
| `installReportTriggers()` | Daily, weekly and monthly report triggers. Re-running replaces them. |
| `installMarketplaceTrigger()` | Hourly import of marketplace orders from the configured Google Sheet. Re-running replaces it. |
| `clearLoginLockout(email)` | Release a login lockout from the editor. |

## Envelope

Every call is an HTTP `POST` to the `/exec` URL with `Content-Type: text/plain;charset=utf-8` (this avoids a CORS preflight) and a JSON body:

```json
{
  "action": "/api/login",
  "method": "POST",
  "params": {},
  "payload": { "email": "…", "pin": "…" },
  "appToken": "…",
  "session": "…"
}
```

Responses are always `{ "ok": true, "data": … }` or `{ "ok": false, "status": 401|403|404|409|400|500, "error": "…" }`.

## Testing

`tests/backend-sim.mjs` runs `Code.gs` in `node:vm` against an in-memory mock of the Apps Script services (`SpreadsheetApp`, `Utilities`, `LockService`, `DriveApp`, `ContentService`, `PropertiesService`, `CacheService`). No network or Google account is needed:

```bash
npm run test:backend   # 1126 checks
```

The mock's `LockService` always grants the lock, so concurrency bugs are not caught there.

## Starting over

There is no reset function, by design.

- A workbook that holds sales is refused unless the `CONFIRM_RESEED` Script Property is `yes`.
- To start clean:
  1. Clear `SPREADSHEET_ID` and delete the `SEEDED` property, so a new workbook is created.
  2. Run `setup` again.
  3. The old workbook stays in Drive untouched. The nightly backups are separate copies.

## Caveats

- `SpreadsheetApp` and `LockService` are single-instance: fine for one store or a few.
- Watch the Apps Script quotas (6-minute execution, daily trigger and mail limits). A busy single store is well under them.
- Sheet edits made by hand bypass every role check and the audit log.
