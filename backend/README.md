# Backend — Google Apps Script

`Code.gs` is the entire backend: a Web App that fronts a **Google Sheet** for data and **Google Drive** for the sales export. No VM, no runtime cost, no database to run.

## What it provides

- `POST /exec` bridge — every endpoint is an `action` string in the JSON body (see envelope below).
- Auth: shared `APP_TOKEN` + per-login HMAC session token (12 h), per-user + per-device revocation, login lockout, offline credentials for terminals, admin/manager role gates on every money and admin route (payouts, collections, and refunds are admin/manager-only).
- Seed: 4 users (admin/manager/cashier/cashier), 42 products, serialized IMEI stock, store config, one supplier, transactions tab, watermark.
- Sync: pull (`products`, `users`, `store`, `watermark`, `openConflicts`) and First-Committed-Wins push that rejects duplicate serials (loser → `VOIDED`), under `LockService`. Re-pushes of an already-recorded transaction are idempotent (`ALREADY_SYNCED`).
- **Conflict registry**: when two devices disagree, a row is recorded in the `Conflicts` tab and surfaced via `/api/conflicts` (admin/manager) and in every sync pull as `openConflicts`. Types: `SERIAL_CLAIM` (same IMEI sold by two devices), `DUPLICATE_CLIENT` (same terminal+purchase pushed twice with different contents), `CLOCK_SKEW` (device clock far outside range — sale accepted but flagged). Admin/manager review them with `/api/conflicts/review` (`dismiss` | `resolve`).
- **Customers & receivables**: accounts, net-30 terms, per-customer ledger, collections (`kind: payment`), and 30/60/90+ day aging buckets via `/api/customers/ledger` and `/api/customers/receivables`.
- **Customer statements** (`/api/customers/statement`, admin/manager): the
  customer's whole book as a chronological debit/credit statement — sales
  charged on account debit, store-credit refunds and collections credit —
  with a running balance that closes exactly on the ledger balance. Each line
  names the cashier and reference for disputes.
- **Inventory aging** (`/api/inventory/aging`, admin/manager): how long stock
  has been sitting — a product's clock starts at creation and re-sets on every
  PO receipt (the receipt's own `PriceHistory` timestamp). Bucketed
  0-30 / 31-60 / 61-90 / 90+ days with units and value-at-cost per bucket,
  oldest first. Serialized stock counts `IN_STOCK` serials, matching the
  product DTO.
- **Till shifts**: `/api/shifts/open` (any role) and `/api/shifts/close` with denomination count → *declared / expected / over-or-short*, scoped per user with `kind`-aware cash math (sales + cash collections − cash refunds − payouts).
- **Reports**: `/api/reports` (manager/admin) — gross sales, refunds, payouts, collections, net revenue, GP, by day / category / cashier / tender, top products and customers, over a date window.
- **Suppliers & purchase orders**: `/api/suppliers`, `/api/purchase-orders` (draft → ordered → partial/received → cancelled), `/detail`, `/receive` (posts stock with weighted-average cost, per-unit serial intake, and a `purchase` ledger row that never touches drawer math), `/cancel`.
- **Price history** (`/api/price-history`, admin/manager): per-product audit of every cost/retail change — a `create` baseline when a product is added, a `patch` row when Item settings edit a value (no-op saves stay quiet), and a `po` row when receiving blends cost by weighted average (tagged with the PO number). Written atomically beside the product update, inside the same script lock.
- Admin: create products/users/customers, add serials, inventory adjust, PIN reset/unlock, revoke devices, store config.
- **Drive export** (`/api/drive/export`): admin/manager export the whole store's day to Drive with a SALES / REFUNDS / PAID OUT / COLLECTIONS / NET CASH summary (purchase receipts appear as detail rows but never inflate SALES); cashiers export their own day (rows scoped server-side to their user id, distinct filename).

## Tab layout in the Sheet

| Tab | Purpose |
| --- | --- |
| `Meta` | key/value store — **header row required** (the API writes a header so the first row isn't misread) |
| `Users` | id, firstName, lastName, email, pinHash (+pinSalt), role, active |
| `Products` | id, sku, name, category, retailPrice, unitCost, qty, isSerialized, serials (JSON), createdBy, createdAt |
| `Serials` | id/lot#, serial, productId, status (AVAILABLE/SOLD/VOIDED), createdAt |
| `Transactions` | the transaction ledger (kind sale/refund/payout/payment/purchase); header row written at seed time |
| `Conflicts` | multi-device disagreements (type, serial, losing client id, winning tx, summary, status OPEN/RESOLVED/DISMISSED, reviewedBy/at) |
| `Devices` | per-terminal rows (id, user, deviceId, first/last seen, revoked) backing per-device revocation |
| `Customers` | id, storeId, name, phone, email, note, createdAt |
| `Shifts` | id, userId, openedAt/closedAt, openingFloat, cashExpected, cashDeclared, overShort, tendersJson (denomination count), status |
| `Suppliers` | id, storeId, name, phone, email, address, paymentTerms, active, createdAt |
| `PurchaseOrders` | id, storeId, supplierId, poNumber, orderDate, expectedDate, status, itemsJson, receivedJson, subtotal, discountPct, taxAmount, total, note, createdBy |
| `PriceHistory` | id, storeId, productId, productName, field (cost_price/retail_price), oldValue, newValue, source (create/patch/po), poId, changedBy, createdAt |

Only `APP_TOKEN` knows which sheet is the "backend" — keep it secret.

## Deploy (once)

1. **New Apps Script project** → paste `backend/Code.gs` → save `Code.gs`.
2. **Project Settings → Script Properties**:
   - `APP_TOKEN` — long random secret (e.g. `openssl rand -hex 32`). The app asks for this at first-run setup.
   - optional `SPREADSHEET_ID` — if omitted, a new spreadsheet named "Orison POS" is created on first seed.
   - optional `FOLDER_ID` — Drive folder for CSV exports (defaults to a folder named "Orison POS Export").
3. **Run `setup`** from the Apps Script editor (first execution approves the `ScriptApp`, `SpreadsheetApp` and `DriveApp` scopes). This seeds the sheet.
4. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (the `APP_TOKEN` is the actual gate)
5. Copy the **Web app URL** (`…/script.google.com/macros/s/xxxx/exec`).

Then paste that URL + the `APP_TOKEN` into the app (**Backend** on the login screen, or Settings).

## Envelope

Every call is an HTTP `POST` to the `/exec` URL with `Content-Type: text/plain;charset=utf-8` (avoids CORS preflight) and a JSON body:

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

`Code.gs` is exercised locally by `tests/backend-sim.mjs` — an in-memory mock of the Apps Script services (`SpreadsheetApp`, `Utilities`, `LockService`, `DriveApp`, `ContentService`, `PropertiesService`) running `Code.gs` through `node:vm`. No network or Google account needed:

```bash
npm run test:backend   # 303 cases: auth, throttle, FCW, refunds, payouts, shifts,
                       # customers/aging, reports, purchase orders, exports
```

Directories on the server (e.g. `/api/sync/push`) map to `action` strings in the Scripts — the Files want `doPost` to route on the same strings so the web/browser transport and mock transport match exactly.

## Re-seed / reset

Run `setup` again in the Apps Script editor to wipe all tabs and write a fresh seed. (The old transactions sheet is cleared too — a backup CSV is left in Drive.)

## Caveats

- `SpreadsheetApp` + `LockService` are single-instance; fine for one or a few stores.
- Serialized sale of a serial another device already sold → the whole transaction is rejected on the server and marked `VOIDED` on the losing device (client handles the conflict).
- Watch out for Apps Script quotas (6-min execution, daily triggers); a busy single store is well under them.