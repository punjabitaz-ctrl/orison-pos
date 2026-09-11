# Operational Readiness Program — v1.21 → v1.30

**Goal:** take Orison POS from "demos well" to "runs the shop" — nothing lost, everything traceable, and the hardware on the counter working from day one.

**Baseline:** v1.20.0 · backend-sim 462 · client units 326 · pdf-smoke unrunnable in this environment.

**Owner instruction (2026-09-11), in the owner's stated priority order:**

1. No sale is ever lost if a terminal is interrupted.
2. Receipts numbered `Orison-S######`.
3. Backups to a Drive folder **POS Backup**, each file stamped with date and time.
4. Never load more than 100 transactions at once; search by customer, amount and other terms instead.
5. Daily / weekly / monthly reports emailed automatically to an assigned admin.
6. Record a sale made on e-commerce or elsewhere, so stock and activity stay true.
7. A general audit log with timestamps, reviewable by **admin only**.
8. Management and ownership functions restricted to **admin only**.
9. Cash drawer and thermal printer working from day one.
10. A plan covering every remaining open item.

Every release keeps the `AGENTS.md` protocol: one feature, one tagged revision, docs in lockstep, all gates green before commit.

---

## Decisions needed from the owner

These change what gets built. Everything else proceeds on the stated assumption.

| # | Question | Assumption if unanswered |
|---|---|---|
| D1 | **Printer and drawer make/model, and how they connect** (USB, serial, Bluetooth, network). | Epson-compatible ESC/POS over USB, drawer kicked through the printer's RJ11 port. |
| D2 | **Receipt numbers:** start at 1, never reset? | `Orison-S000001`, six digits, zero-padded, monotonic forever, never reset. |
| D3 | **Do you take card payments?** | Yes — a `card` tender is added in v1.29.0. |
| D4 | **Trading jurisdiction** (drives tax-invoice fields, e.g. a UAE TRN). | US/NJ. No TRN block on the receipt. |
| D5 | **Which admin receives scheduled reports?** | Set in Settings by an admin; no default. |
| D6 | **Managers keep stock and money-out powers?** (see v1.23.0 table) | Yes — managers keep daily trade, admins keep the business. |

---

## v1.21.0 — No sale is lost

**The owner's first priority.** `state.cart` is a plain `Map` in memory. A phone
killing a backgrounded PWA loses a part-rung sale, and that is routine on this
device class. Serialised lines are worse: `addCartLine` removes the serial from
the local mirror, and it returns only through an explicit remove, which a crash
never reaches — so a crash silently loses a phone from stock.

**Build**

- Persist the cart to the IndexedDB `meta` store on every mutation (add, remove,
  quantity, discount, serial capture), debounced to one write per ~200ms.
- Rehydrate on boot. If a cart is recovered, say so plainly: *"Recovered a sale
  in progress — 3 items, $124.00"* with **Resume** and **Discard**.
- Stop mutating the catalog mirror. Derive availability as
  `serverOnHand − quantityInCart` at render time, which also fixes the drift
  when a `pull()` replaces product objects mid-cart (open item #3).
- Clear the persisted cart on completion, and on an explicit discard only.

**Done when** a hard reload, a killed tab and a crashed PWA each resume the exact
cart including captured IMEIs; and a `pull()` mid-cart never changes what the
cart will restore.

**Tests** Client units for persist/rehydrate/clear and the derived-availability
maths; browser check across a forced reload with a serialised line in the cart.

---

## v1.22.0 — Receipt numbers and the audit log

Two pieces of the same job: making the ledger answerable after the fact.

**Receipt numbers.** A server-allocated, gap-free sequence. `Orison-S000001`.

- Counter in the `Meta` tab, incremented **inside the existing script lock** in
  the same critical section that appends the transaction, so two terminals can
  never take the same number.
- Allocated at **sync**, not on the device — an offline terminal cannot know the
  next number. The device keeps its `clientTxId`; the receipt number is assigned
  when the sale lands and syncs back to the terminal.
- Because of that, a receipt printed offline carries the client id and the words
  *"Receipt number pending sync"*; reprinting after sync shows the real number.
  This is the honest behaviour and it must be visible, not hidden.
- Printed on the receipt, shown in History, included in reports, the Drive
  export and search.

**Audit log.** A new `AuditLog` sheet: `id, store_id, at, user_id, user_name,
role, action, target_type, target_id, summary, device_id, ip_hint`.

- `logAudit_(session, action, target, summary)` called from every privileged
  write: role change, PIN reset, session/device revocation, store and tax
  settings, bulk price, stock take, inventory adjust, product create/patch,
  refund, all three cash-out kinds, PO receive and cancel, conflict review,
  backup run, and sign-in/sign-out.
- Append-only. No update or delete path exists in the API.
- `/api/audit` — **admin only**, paged, filterable by actor, action and date.
- New **Audit** screen on the launcher, visible to admins only.

**Done when** every privileged action appears in the log within one action of
being performed, and a manager calling `/api/audit` gets a 403.

---

## v1.23.0 — Admin-only management

Today 22 routes accept manager, 8 accept admin only. The owner wants management
and ownership functions admin-only. Proposed split — **D6 confirms or changes it**:

| Moves to **admin only** | Stays **admin + manager** |
|---|---|
| Store settings, tax rate, locale/currency | Refunds |
| Bulk price update | Paid Out / Cash Pick Up / Staff Expense |
| Stock take commit | Products: create, edit, serials, stock adjust |
| Supplier create/edit | Purchase orders: create, receive, cancel |
| Purchase order **cancel** | Reports, price history, ageing, reorder |
| Audit log | Customers, ledgers, statements, collections |
| Backup run / restore | Conflict review, login unlock |
| Scheduled report recipients | Stock take **entry** (commit is admin) |

Reasoning: a manager runs the day — sells, refunds, receives stock, chases
debtors. An admin owns the business — what things cost, who works here, what the
books say, and what can be destroyed.

**Build** Move the routes, hide the launcher tiles by role (the model in
`nav.js` already drives this), and add sim coverage asserting a manager gets 403
on every moved route. **Note:** this changes what today's managers can do — tell
staff before deploying.

---

## v1.24.0 — Backups to Drive

**Build**

- Apps Script **time-driven trigger**, nightly at a store-local hour.
- Writes to a Drive folder named exactly **`POS Backup`**, created if absent,
  separate from the export folder.
- One file per run, every tab included:
  `Orison-POS-Backup_YYYY-MM-DD_HHmm.xlsx` (a full spreadsheet copy — restorable
  by opening it, unlike loose CSVs).
- Retention: keep the last 30 daily, 12 monthly; prune the rest so Drive doesn't
  fill silently.
- **Back up now** button in Settings (admin only), and the result — file name,
  size, time — written to the audit log.
- A failed backup emails the assigned admin. A silent backup failure is worse
  than no backup, because it is believed.

**Also:** `setup` currently reseeds the workbook and is one wrong click from
destroying the shop's history. Guard it — refuse to run when transactions exist
unless a `CONFIRM_RESEED` script property is set.

**Done when** a trigger run produces a dated file in `POS Backup`, an
intentionally broken run sends mail, and `setup` refuses to wipe a live sheet.

---

## v1.25.0 — Never load more than 100

Today `/api/transactions` reads the **entire** Transactions sheet into memory and
returns up to 500. So does every report, export, shift close and reorder. That is
the scalability ceiling and nobody has measured it.

**Build**

- `/api/transactions` gains a hard cap of **100** per page, a `cursor` for the
  next page, and a `q` search evaluated **server-side** across: receipt number,
  customer name, cashier, item name, serial/IMEI, note, kind, exact amount and
  amount range, plus a date range.
- History screen: a search box, applied filters shown as removable chips, and a
  **Load more** button. No infinite scroll — staff need to know where they are.
- Same cap and cursor on `/api/audit` and the customer ledger.
- **Load test** to 20,000 transactions in the sim and record where the six-minute
  Apps Script execution limit actually bites. If reports breach it, add a date
  window requirement rather than discovering it on a Saturday.

**Done when** no endpoint returns more than 100 rows, search finds a sale by
receipt number, customer, IMEI or amount, and the 20k figure is written into
`HANDOVER.md`.

---

## v1.26.0 — Scheduled reports to an admin

**Build**

- Time-driven triggers: **daily** (after close), **weekly** (Monday), **monthly**
  (1st).
- Recipients set in Settings by an admin (D5), each cadence independently
  toggleable.
- Email carries the figures inline — takings, refunds, cash out by reason,
  collections, net, gross profit, average ticket, top sellers, over/short by
  cashier — with the period CSV attached.
- Send failures are logged to the audit log and retried once.

**Watch:** Apps Script's `MailApp` daily quota is 100 recipients/day on a
consumer account, 1,500 on Workspace. Fine here; worth stating in the docs.

---

## v1.27.0 — Sales made elsewhere

So an eBay or marketplace sale decrements stock and lands in the same ledger
rather than drifting.

**Build**

- `channel` on every transaction: `in_store` (default), `online`, `marketplace`,
  `phone`, `other`.
- **Record external sale** on the launcher: pick the channel, the item(s) —
  including IMEI capture for serialised stock — the price actually received, an
  external reference (eBay order id), and the date. Stock decrements, the ledger
  records it, and reports split by channel.
- Reports and the export gain a channel breakdown; the dashboard shows in-store
  vs elsewhere.
- Not an eBay API integration — that is a separate project. This makes the POS
  the single source of truth for stock as long as someone records the sale.

---

## v1.28.0 — Cash drawer and thermal printer

**Blocked on D1** — the build differs by connection type; confirm the model first.

**Build (assuming ESC/POS over USB, drawer on the printer's RJ11)**

- `public/js/escpos.js`: byte-level receipt builder — init, alignment, double
  height for the total, the receipt number, a Code 128 barcode of it, cut, and
  the **drawer kick** (`ESC p 0 25 250`).
- Transport via **WebUSB**, paired once in Settings; Chrome and Edge only, which
  matches the counter terminals. The existing browser-print path stays as the
  fallback for phones and unpaired devices.
- **Open drawer** as its own launcher action, admin/manager only, and **every
  use is written to the audit log** — an unlogged drawer is how cash leaves.
- Drawer kicks automatically on completing a sale paid wholly or partly in cash,
  not on card-only or account sales.
- Settings: pair device, print test receipt, open drawer test.

**Done when** a sale prints in one action on the thermal roll and the drawer
opens, with no OS print dialog.

---

## v1.29.0 — Card tender

Currently a card sale must be rung as cash, which inflates expected cash and
closes every shift short by the card total.

**Build** A `card` tender excluded from expected cash at shift close, reported
and exported on its own line, and available in the checkout segment. Not a
gateway integration — the terminal beside the till does the authorising and the
POS records the amount (D3).

---

## v1.30.0 — Remaining open items

Small, already scoped in `HANDOVER.md` §10, done together:

- Time-clock punches queue through the outbox so staff can clock in offline.
- `/api/config` stops handing the staff roster to cashiers.
- The customer display treats a frame older than a few minutes as idle.
- Per-call timeouts in `api.js` instead of one 15-second value for everything.

---

## Deferred, with reasons

Not "ignored" — each is a real piece of work that should be scoped on its own.

| Item | Why it waits |
|---|---|
| **Repairs workflow** (ticket, status, collection) | The biggest product gap for a phone shop, and a feature in its own right — a week minimum. Scope it separately. |
| **Trade-in / buyback** | Needs a decision on cost basis and IMEI intake for used stock before any code. |
| **Warranty per serial** | Cheap once repairs exist; they share the serial-history view. |
| **Layaway / deposits** | Real money held against an undelivered sale; needs its own liability account. |
| **Store credit as an object** | Today it is a tender plus a customer ledger entry. A transferable credit note with its own balance and expiry is a different model. |
| **Accounting integration** (QuickBooks/Xero/Zoho) | CSV covers month-end today. Pick the package first. |
| **eBay/marketplace API sync** | v1.27.0 makes manual recording reliable. Automatic sync is a separate integration. |
| **UI translation and RTL** | Still the owner's decision (`HANDOVER.md` §10 #1): which languages, and is RTL in scope. |
| **Sequential-invoice tax compliance** | Depends on D4. v1.22.0 gives gap-free numbering, which is the hard half. |

---

## Sequencing note

These releases are **sequential, not parallel**. v1.22 (receipt numbers) and
v1.25 (paging/search) both rewrite `transactions_`; v1.23 (roles) touches every
route v1.22 adds; v1.28 (printer) prints the receipt number v1.22 creates. Each
must land, be tagged and be verified before the next begins, exactly as the
`AGENTS.md` protocol requires.
