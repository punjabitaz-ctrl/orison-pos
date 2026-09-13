# Roles, permissions and business gaps — review at v1.35.0

> **Status:** being closed sprint by sprint —
> [`../plans/2026-09-13-staff-gaps-and-uae-program.md`](../plans/2026-09-13-staff-gaps-and-uae-program.md).
> ✅ v1.36.0 closed Admin #1 (audit gaps), #3 (token exposure), #4 (staff
> edits) and #6 (channel gate).

**Date:** 2026-09-12 · **Baseline:** v1.35.0 · **Method:** every route in
`backend/Code.gs` `dispatch_` was read for its `requireRole_` gate and any role
check inside the handler; every launcher tile in `public/js/nav.js` and every
role check in the screens was read for what the interface offers. Nothing below
is from memory.

The owner's roles decision still stands: managers run the daily trade, and
admins keep the business (v1.23.0). This review does not reopen that decision.
It lists what that line leaves staff unable to do, and what the business review
of 2026-09-11 left open.

---

## 1. Who can do what today

✅ can · — cannot · *own* = only their own records

### Selling and money

| Task | Cashier | Manager | Admin |
|---|:-:|:-:|:-:|
| Ring a sale: cash, card, store credit, Net-30 to an **existing** customer | ✅ | ✅ | ✅ |
| Line discount (0/10/15/20/25/50 %) and any order discount % | ✅ | ✅ | ✅ |
| Search customers at checkout | ✅ | ✅ | ✅ |
| Create a customer (checkout or Customers) | — | ✅ | ✅ |
| Customer ledger, statement, receivables, take a payment on account | — | ✅ | ✅ |
| Refund a sale (services are never refundable, v1.33.0) | — | ✅ | ✅ |
| Paid Out, Cash Pick Up, Staff Expense | — | ✅ | ✅ |
| Open the drawer with no sale (with a reason, audited) | — | ✅ | ✅ |
| Record a sale made elsewhere | — | ✅ | ✅ |
| History and receipt reprints | *own* | ✅ | ✅ |
| Open and close a till shift | *own* | *own* | *own* |
| See every shift's reconciliation | — | ✅ | ✅ |
| Export the day to Drive | *own rows* | ✅ | ✅ |
| Dashboard | *own day* | store | store |
| Reports | — | ✅ | ✅ |

### Repairs

| Task | Cashier | Manager | Admin |
|---|:-:|:-:|:-:|
| Book in, fit parts, add labour, move status, take deposit, collect | ✅ | ✅ | ✅ |
| Give a deposit back | — | ✅ | ✅ |
| Void a ticket | — | — | ✅ |

### Stock

| Task | Cashier | Manager | Admin |
|---|:-:|:-:|:-:|
| See stock and price on the register tiles | ✅ | ✅ | ✅ |
| Products screen, alerts, cost prices | — | ✅ | ✅ |
| Create or edit a product, add serials, adjust stock | — | ✅ | ✅ |
| Price history, ageing, reorder worksheet, shelf labels | — | ✅ | ✅ |
| Create and receive purchase orders | — | ✅ | ✅ |
| Suppliers, cancel a PO, bulk price update, stock take | — | — | ✅ |

### People, terminals and the business

| Task | Cashier | Manager | Admin |
|---|:-:|:-:|:-:|
| Punch in and out | *own* | *own* | *own* |
| Time-clock roster and staff performance | — | ✅ | ✅ |
| Change own PIN | ✅ | ✅ | ✅ |
| Review sync conflicts (Dashboard) | — | ✅ | ✅ |
| Release a login lockout | — | ✅ ¹ | ✅ ¹ |
| Add staff, deactivate, reset a PIN | — | — | ✅ |
| Change a staff member's role, name or email | — | — | ✅ ¹ |
| Revoke a person's sessions or one terminal | — | — | ✅ |
| Store settings (currency, tax, language), scheduled reports, backups | — | — | ✅ |
| Audit log | — | — | ✅ |
| This terminal's language, printer, customer display, sync window, backend URL and token | ✅ | ✅ | ✅ |
| Correct a time punch, or close someone else's forgotten shift | — | — | — |

¹ **Allowed by the server but not on any screen.** A lockout release is
`POST /api/admin/unlock`, and a role change is `/api/admin/users/patch`
`{ role }`. Neither has a button, so in practice they need the API or the
Apps Script editor (`clearLoginLockout`). Name and email can only be changed
by editing the `Users` sheet.

---

## 2. What employees need but cannot do

Ordered by how often it will stop work on the shop floor.

### Cashiers

1. **Returns and refunds need a manager to take over the till.** The manager
   signs in on the cashier's terminal, and signing the cashier out revokes
   **every** session that cashier holds (`logout_` revokes by user). So a
   refund costs the cashier a fresh sign-in, and on a busy day the customer
   waits for a manager to walk over.
   **Fix:** a *manager approval* prompt. The cashier starts the refund; a
   manager enters their PIN on the same screen for that one action. The server
   checks the PIN, records who approved it, and the cashier stays signed in.
   The same prompt then covers an over-limit discount, a no-sale drawer open
   and a deposit refund.
2. **A new customer cannot be put on account.** Net-30 needs an existing
   customer, and only managers can create one. With no manager in, the sale
   is either lost or rung as cash.
   **Fix:** let cashiers create a customer (name and phone). Keep the ledger,
   statements and collections manager-only.
3. **No balance check before charging to account.** The cashier cannot see
   what the customer already owes, and there is **no credit limit** anywhere
   in the system.
   **Fix:** show the outstanding balance at checkout. Add an optional credit
   limit per customer, where going over it needs manager approval.
4. **A sale rung by someone else cannot be looked up.** History is own-sales
   only for cashiers. They need that lookup to check a receipt or an IMEI
   before sending a return to a manager, or when a customer claims warranty.
   **Fix:** read-only lookup by receipt number or IMEI. No refund button, and
   no cost shown.
5. **A forgotten clock-out cannot be corrected by anyone.** The entry stays
   open, or has to be fixed by hand in the Sheet (see Managers #2).

### Managers

0. **A locked-out cashier cannot be let back in from the till.** Managers are
   allowed to release a lockout, but there is no button for it, so the
   cashier waits out the 15 minutes.
   **Fix:** an *Unlock* action on the staff list (Settings or Staff), for
   managers and admins. It is a small change.
1. **They cannot reset a cashier's PIN.** They can release a lockout, but a
   cashier who has forgotten their PIN cannot work until an admin is reached.
   **Fix:** managers may reset **cashier** PINs only, and every reset is
   audited.
2. **Time punches and shifts cannot be corrected.** Nobody can edit a punch
   or close a shift left open by someone who went home. Payroll hours and the
   drawer reconciliation are then wrong until the Sheet is edited by hand,
   which leaves no trail.
   **Fix:** a manager correction on both, with a required reason, written to
   the audit log.
3. **They cannot add staff for a new starter.** This is admin-only by the
   owner's decision. It is listed only so the owner can confirm it is
   intended for a shop where the admin is not always present.
4. **The audit log is admin-only** (owner decision, v1.22.0). It is not
   recommended to change this.

### Admin and owner

1. **The audit log misses the actions that matter most for loss
   prevention.** It does record store settings, bulk repricing, stock takes,
   role and active changes, terminal revokes, repairs, drawer opens, backups
   and reports.
   It does **not** record:
   - stock adjustments
   - product create or edit
   - serial additions
   - PIN resets
   - new staff accounts
   - lockout releases
   - revoke-all sessions
   - conflict reviews
   - purchase-order receive or cancel
   - supplier changes
   - customer creation
   - Drive exports
   - sign-ins

   Refunds and cash-outs are in the ledger, but not the log.
   **Fix:** a `logAudit_` call in each of those handlers. It is small, and
   stock adjustment should come first.
2. **Discounts are unrestricted and unreported.** Any cashier can take 50 %
   off a line and any percentage off the order. The server clamps only to
   0–100 % and accepts the unit price the device sends (SECURITY.md
   weakness #1). No report shows discounts by cashier.
   **Fix:** a discount limit per role, manager approval over the limit, and a
   *discounts given* breakdown by cashier in Reports.
3. **The shared `APP_TOKEN` is visible to anyone holding a terminal.** The
   Settings → Backend card shows it in plain text to every role, and the
   Backend prompt on the sign-in screen shows it before anyone signs in.
   **Fix:** show the Backend card to admins only, and mask the token there
   and in the prompt. Provisioning a new terminal still works.
4. **Staff can be added and switched off, but not edited.** A promotion
   from cashier to manager, or a corrected name or email, needs the API or
   a hand edit of the `Users` sheet.
   **Fix:** role, name and email edits on the staff list. The server already
   revokes sessions on a role change.
5. **There are only three fixed roles.** The owner cannot let a trusted
   senior cashier do refunds without making them a full manager.
   **Fix (later):** per-role permission flags edited in Settings, or a
   fourth *supervisor* role. Build the manager-approval prompt first, since
   it covers most of the need.
6. **"Sold Elsewhere" is gated in the interface, not on the server.** A sale
   pushed with a non-store channel is accepted from any role. The exposure is
   low, because it is still a sale that moves stock, but it breaks the rule
   that the server enforces every role.
   **Fix:** refuse a non-`in_store` channel from a cashier in `syncPush_`.

---

## 3. Business review items still open

From the operational-readiness program (2026-09-11), the *Deferred, with
reasons* table and the owner decisions:

| Item | Status at v1.35.0 | What it needs |
|---|---|---|
| Repairs workflow | ✅ Done, v1.31–v1.32 | — |
| UI translation and RTL | ✅ Done, v1.35.0 | A native-speaker read |
| D1 Printer and drawer | ✅ Built, v1.34.0 | A test on the real printer |
| **Trade-in / buyback** | Open | Owner decision on cost basis and used-stock IMEI intake. The largest remaining gap for a phone shop. |
| **Warranty per serial** | Open | The owner's warranty terms. Fitted serials already point at their invoice, so this is now cheap. |
| **Layaway / deposits on sales and special orders** | Open | Repairs hold deposits; a sale cannot. Needs a liability treatment like `deposit`. |
| **Store credit as an object / gift cards** | Open | Today, store credit is a tender plus a ledger line. A transferable balance with an expiry is a different model. |
| **Accounting integration** | Open | Pick the package (QuickBooks, Xero, Zoho). Month-end runs on CSV today. |
| **Marketplace API sync** | Open | v1.27.0 records these sales by hand. Automatic sync is a separate integration. |
| **D4 Tax jurisdiction and invoice compliance** | Open, assumed US/NJ | Confirm the jurisdiction. Gap-free numbering (v1.22.0) is already in place. |

## 4. Other missing features noticed during this review

- **Exchanges.** A swap is a refund, then a new sale: two receipts and two
  manager steps.
- **Repair-ready notifications.** Nothing tells the customer their device is
  ready. A WhatsApp link like the receipt one would be cheap.
- **Credit limits and emailed statements** for Net-30 customers.
- **Low-stock and over/short alerts by email.** Scheduled reports send
  figures, but nothing alerts on an exception.
- **One store only.** There is no multi-location stock or transfers.

## 5. Recommended order

1. Deploy what is built (HANDOVER §9 #1). Nothing above matters until the shop
   is running it.
2. **Close the audit gaps** (§2 Admin #1) and **restrict and mask the app token**
   (§2 Admin #3). Both are small, and both are controls. Add the **Unlock
   button** and **staff edits** (§2 Managers #0, Admin #4) in the same pass:
   the server already supports both.
3. **Manager approval prompt** (§2 Cashiers #1), then discount limits on top of
   it (§2 Admin #2).
4. **Cashiers create customers, balance at checkout, and read-only sale
   lookup** (§2 Cashiers #2–#4).
5. **Manager PIN reset for cashiers, and punch/shift corrections** (§2
   Managers #1–#2).
6. **Trade-in / buyback**, then **warranty per serial**, once the owner answers
   the cost-basis and warranty-terms questions.
