# Repairs — design

**Date:** 2026-09-12
**Releases:** v1.31.0 (the ticket) and v1.32.0 (the money)
**Status:** approved by the owner 2026-09-12

---

## Why

Orison Electronics is a phone and electronics shop. It takes repairs in every
day, and the POS has never known about them. That costs the shop three things:

1. **Stock drifts.** A screen fitted to a customer's phone leaves the building
   but stays on the shelf in the system. Every other part of the
   operational-readiness program (v1.21–v1.30) existed to make on-hand true;
   repairs are the largest remaining hole in it.
2. **Work is tracked on paper.** Which phone belongs to whom, what was wrong
   with it, what was quoted, whether it is ready — none of it is in the system
   anyone is already looking at.
3. **Money is invisible.** Repair labour is revenue the reports do not see, and
   deposits are cash in the drawer that nothing accounts for.

The program plan named repairs *"the biggest product gap for a phone shop"* and
deferred it to be scoped on its own. This is that scope.

## What this is not

- Not a repairs *business* system: no technician scheduling, no bench queue
  prioritisation, no parts-supplier integration, no customer-facing status page.
- Not warranty tracking. That is cheap once repairs exist (the two share the
  serial-history view) and follows separately.
- Not SMS/email notification of the customer. The ticket records a phone number;
  telling the customer their phone is ready stays a human action for now.

---

## Decisions taken (and the ones rejected)

| Decision | Chosen | Rejected, and why |
|---|---|---|
| **Money at intake** | **A deposit is taken at intake.** | *No money until collection* was simpler, but the shop already takes deposits, and a system that pretends otherwise pushes that cash off the books. |
| **When parts leave stock** | **When fitted to the job.** | *At invoice* leaves on-hand overstated while jobs are open — the shelf claims a screen that is already in somebody's phone. *Reserve-then-consume* is the most accurate but adds a third stock state to every product view and to the availability maths, for a case the shop can handle by fitting the part when it fits it. |
| **Device intake fields** | Make, model, IMEI/serial, reported fault, visible condition, accessories left. | **No passcode field.** The backing store is a Google Sheet, copied nightly into Drive backups. A plaintext customer credential there is a liability with no offsetting benefit — the bench can ask for it verbally. |
| **Release shape** | **Two releases.** | One release would be a week-long unverifiable lump. The ticket half and the money half are independently useful and independently testable, which is what the one-feature-one-tag protocol is for. |
| **Offline** | **Online-only.** | See *Deliberate limits*. |

---

## v1.31.0 — the ticket

### Data

A new `Repairs` tab, following the `PurchaseOrders` shape already in the
codebase: an open document carrying a status and a JSON payload, which resolves
into a ledger transaction when it closes.

```
REPAIR_HEADERS = [
  'id', 'store_id', 'ticket_no',
  'customer_id', 'customer_name', 'customer_phone',
  'device_make', 'device_model', 'device_serial',
  'reported_fault', 'condition_note', 'accessories',
  'status', 'parts_json', 'labour_json',
  'estimate_total', 'deposit_total', 'final_total',
  'assigned_to', 'note',
  'created_by', 'created_at', 'updated_at',
  'promised_at', 'closed_at', 'invoice_tx_id',
]
```

`deposit_total`, `final_total` and `invoice_tx_id` are written in v1.31.0 as
zero/empty and filled by v1.32.0. They are in the header from the start so the
sheet is not migrated twice.

### Ticket numbers

`Orison-R000001`, allocated server-side under the script lock, reusing the
v1.24.0 reservation machinery (`reserveReceiptNumbers_`) with an `R` prefix and
its own counter. Gap-free and sequential, for the same reason receipts are: a
customer-facing document that skips numbers invites the question of what
happened to the missing one.

### Status flow

```
intake → diagnosed → awaiting_parts → in_progress → ready → collected
                                                          ↘ unrepairable
                                                          ↘ cancelled
```

`unrepairable` (returned to the customer, nothing charged) and `cancelled`
(customer withdrew) are terminal, as is `collected`.

Transitions are validated server-side, not merely in the UI:

- Nothing reaches `collected` without an `invoice_tx_id` (v1.32.0 sets it; in
  v1.31.0 `collected` is unreachable and the UI does not offer it).
- A terminal ticket cannot be reopened or re-closed.
- Any status may move to `cancelled` or `unrepairable` **except** `collected`.

### Parts

Adding a part to a ticket consumes stock **immediately**, through the same code
path a sale uses, under the script lock:

- Non-serialized: `on_hand − quantity`.
- Serialized: a specific serial moves `AVAILABLE → SOLD` against the ticket id.
- Removing a part, or cancelling the ticket, returns it (`AVAILABLE`, on-hand
  restored).
- A part that is no longer available is refused with the same first-committed-
  wins treatment a sale gets. The register cannot sell a part the bench has
  fitted, and the bench cannot fit a part the register has sold.

Availability is read through the existing derived rule (`serverOnHand −
quantityInCart`), never by mutating a local mirror — the v1.21.0 invariant holds
here too.

### Labour

A labour line is either a **service product** (`item_type === 'service'`, which
already exists and is exempt from stock) or an **ad-hoc description + amount**
for one-off work. Both carry into the invoice as ordinary sale lines in v1.32.0.

### Roles

| Action | Gate |
|---|---|
| Take a repair in, update status, fit or remove parts, add labour | any store role (counter work) |
| Void a ticket | admin |
| *(v1.32.0)* take a deposit | any store role — it is money in, like a sale |
| *(v1.32.0)* refund a deposit | admin/manager — money out, matching refunds and payouts |

Consistent with v1.23.0: money leaving the building needs a manager.

### Screens

- **Repairs** — a new launcher tile. List paged at 100 like the ledger (v1.25.0),
  filtered by status, searchable by ticket number, customer name, phone, or
  device serial.
- **Intake dialog** — device, fault, condition, accessories, customer (reusing
  the existing customer picker/create flow).
- **Ticket detail** — status control, parts, labour, running total, notes.

### Audit

Every status change, part movement and money movement writes an audit entry
(v1.22.0), so "who said this was ready" and "who took that screen" are
answerable.

---

## v1.32.0 — the money

### The problem

A deposit is cash in the drawer that is **not earned revenue**. Treating it as a
sale would inflate gross sales and gross profit for a job that may never
complete, and would make the day's figures wrong in a way that compounds.

### The model

This is the card-tender pattern from v1.29.0 applied to a liability:

- **New ledger kind `deposit`.** Money in. Counts toward expected drawer cash.
  Excluded from gross sales, net revenue and gross profit.
- **At collection**, the job is rung as a normal `sale` carrying the parts and
  labour lines — full `Orison-S` receipt, full reporting, full GP. The deposit
  already held is applied as a **tender of type `deposit`**, which is real money
  but *not drawer cash at that moment*, because the cash arrived earlier on the
  deposit transaction. The customer pays the balance in cash, card, or anything
  else the system already takes.
- **New ledger kind `deposit_refund`** for a cancelled or unrepairable job.
  Drawer cash out, admin/manager gated.

The invariant: **cash touches the drawer exactly once per pound.** A deposit
adds it, the deposit tender at collection does not add it again, and a refund
removes it.

### Reporting

- A **deposits held** figure: `Σ deposits − Σ applied − Σ refunded`. This is a
  liability, presented as one, not mixed into revenue.
- The Drive export gains a `DEPOSITS IN`, `DEPOSITS APPLIED` and `DEPOSITS
  REFUNDED` line, and `CASH IN DRAWER` accounts for all three.
- Scheduled reports (v1.26.0) carry deposits held, so the owner sees the
  outstanding liability without opening the app.

---

## Deliberate limits

**Repairs are online-only**, like purchase orders, customers and suppliers.
Sales continue to work offline exactly as before; taking a repair *in* during an
outage will not.

The reason is the same constraint receipt numbers have (v1.24.0): an offline
terminal cannot know the next sequential ticket number without risking a
collision, and a repair ticket is a document handed to a customer. Intake
happens at the counter with the customer standing there, so the failure is
visible and recoverable — write it on paper, enter it when the line returns —
rather than silent.

This is stated rather than hidden. If the shop finds it painful in practice, the
fix is the same one receipts use: queue the intake and allocate the number at
sync, accepting that the customer leaves without a ticket number.

---

## Testing

Sim coverage (`tests/backend-sim.mjs`), in addition to the existing 583:

- The full flow, intake through collection, ends with correct stock, correct
  ledger and a correct receipt.
- **A deposit never appears as revenue** — gross sales, net revenue and gross
  profit are all unmoved by taking one.
- **Cash touches the drawer once.** Deposit in, collect with the deposit tender,
  close the shift: expected cash is float + deposit + balance, not + deposit
  twice.
- A cancelled ticket returns every part, including serials, to `AVAILABLE`.
- A deposit refund takes the cash back out, and only an admin/manager can do it.
- A collected ticket cannot be collected again, cancelled, or reopened.
- The register cannot sell a serial the bench has fitted, and vice versa.
- Every role gate, positively and negatively.
- Ticket numbers are sequential and gap-free under concurrent creation.

Client units (`tests/client-*.mjs`) for the status-transition rules and the
ticket total maths.

---

## Sequencing

v1.31.0 must land, be tagged and be verified before v1.32.0 begins: v1.32.0
writes `deposit_total`, `final_total` and `invoice_tx_id` on the rows v1.31.0
creates, and adds tenders to the shift maths v1.31.0 leaves untouched.
