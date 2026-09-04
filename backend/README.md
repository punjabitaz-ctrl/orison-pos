# Backend — Google Apps Script

`Code.gs` is the entire backend: a Web App that fronts a **Google Sheet** for data and **Google Drive** for the sales export. No VM, no runtime cost, no database to run.

## What it provides

- `POST /exec` bridge — every endpoint is an `action` string in the JSON body (see envelope below).
- Auth: shared `APP_TOKEN` + per-login HMAC session token (12 h).
- Seed: 4 users (admin/manager/cashier/cashier), 42 products, serialized IMEI stock, store config, transactions tab, watermark.
- Sync: pull (`products`, `users`, `store`, `watermark`, `openConflicts`) and First-Committed-Wins push that rejects duplicate serials (loser → `VOIDED`), under `LockService`. Re-pushes of an already-recorded transaction are idempotent (`ALREADY_SYNCED`).
- **Conflict registry**: when two devices disagree, a row is recorded in the `Conflicts` tab and surfaced via `/api/conflicts` (admin/manager) and in every sync pull as `openConflicts`. Types: `SERIAL_CLAIM` (same IMEI sold by two devices), `DUPLICATE_CLIENT` (same terminal+purchase pushed twice with different contents), `CLOCK_SKEW` (device clock far outside range — sale accepted but flagged). Admin/manager review them with `/api/conflicts/review` (`dismiss` | `resolve`).
- Admin: create product, add serials, inventory adjust (admin **or** manager).
- **Drive export** (`/api/drive/export`): admin/manager export the whole store's day to Drive; **cashiers can export their own day's report** (rows scoped server-side to their user id, distinct filename).

## Tab layout in the Sheet

| Tab | Purpose |
| --- | --- |
| `Meta` | key/value store — **header row required** (the API writes a header so the first row isn't misread) |
| `Users` | id, firstName, lastName, email, pinHash, role, active |
| `Products` | id, sku, name, category, retailPrice, unitCost, qty, isSerialized, serials (JSON), createdBy, createdAt |
| `Serials` | id/lot#, serial, productId, status (AVAILABLE/SOLD/VOIDED), createdAt |
| `Transactions` | the transaction ledger; header row written at seed time |
| `Conflicts` | multi-device disagreements (type, serial, losing client id, winning tx, summary, status OPEN/RESOLVED/DISMISSED, reviewedBy/at) |

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
npm run test:backend
```

Directories on the server (e.g. `/api/sync/push`) map to `action` strings in the Scripts — the Files want `doPost` to route on the same strings so the web/browser transport and mock transport match exactly.

## Re-seed / reset

Run `setup` again in the Apps Script editor to wipe all tabs and write a fresh seed. (The old transactions sheet is cleared too — a backup CSV is left in Drive.)

## Caveats

- `SpreadsheetApp` + `LockService` are single-instance; fine for one or a few stores.
- Serialized sale of a serial another device already sold → the whole transaction is rejected on the server and marked `VOIDED` on the losing device (client handles the conflict).
- Watch out for Apps Script quotas (6-min execution, daily triggers); a busy single store is well under them.