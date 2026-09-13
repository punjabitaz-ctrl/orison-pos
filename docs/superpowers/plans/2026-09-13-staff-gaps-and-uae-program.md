# Staff gaps and UAE tax — v1.36 → v1.40

**Goal:** close every gap in
[`../specs/2026-09-12-roles-and-gaps-review.md`](../specs/2026-09-12-roles-and-gaps-review.md)
§2, one user type at a time, and add the United Arab Emirates as a tax
jurisdiction next to the US.

**Owner instruction (2026-09-13):** work through each user type and its missing
items. Add the UAE for tax jurisdiction. Each sprint addresses one group of
missing items.

**Baseline:** v1.35.1 · backend-sim 719 · client 459 · pdf-smoke unrunnable
here.

**Outcome:** all five sprints shipped on 2026-09-13 as v1.36.0 → v1.40.0 ·
backend-sim 869 · client 481.

Every sprint follows the `AGENTS.md` protocol: one tagged revision, docs in
lockstep, all gates green, and every new string translated into Arabic and Urdu.

---

## Decisions taken on the owner's behalf

These are defaults, and each one is a setting the admin can change.

| # | Question | Default chosen | Why |
|---|---|---|---|
| S1 | Cashier discount limit | **10 %** effective per line | This is the smallest preset. Anything larger is a conversation. |
| S2 | Manager discount limit | **50 %** | This is the largest preset; admins are unlimited. |
| S3 | Who can approve | Any **manager or admin**, by their email and PIN on the cashier's screen | This is how a shop floor works. The cashier stays signed in. |
| S4 | Approvals offline | **Not possible.** A PIN is only ever checked by the server. | This keeps the offline credential model intact (SECURITY.md). |
| S5 | Managers resetting PINs | **Cashiers only**, audited | A manager must not be able to take over another manager or an admin. |
| S6 | Correcting your own punch | **Admins only** | A manager fixing their own hours is a conflict of interest. |
| S7 | UAE VAT | 5 %, **prices include VAT**, receipt titled *Tax Invoice* with the shop's TRN, VAT shown in AED | The UAE requires VAT-inclusive consumer prices and a tax invoice carrying the supplier's TRN. |

---

## Sprint 1 — v1.36.0 · Owner and admin controls

**Scope:** review §2 *Admin and owner*, items 1, 3, 4 and 6.

- **Audit gaps.** Add log entries for:
  - stock adjustments
  - product create and edit
  - serials added
  - admin PIN resets
  - new staff
  - lockout releases
  - revoke-all
  - conflict reviews
  - PO create, receive and cancel
  - supplier changes
  - customer creation
  - Drive exports
  - sign-ins, and lockouts triggered
  - refunds and cash-outs, as they sync

  `logAudit_` caches staff names for each execution, so a batch push does not
  re-read `Users` for every row.
- **The app token stops being shown.** Settings → Backend becomes admin-only and
  the token field is masked. The sign-in Backend prompt no longer pre-fills the
  token, and leaving it blank keeps the saved one.
- **Staff edits.** Admins can change role, first name, last name and email
  (unique, validated). Sessions are revoked on a role or email change.
- **Channels are gated on the server.** A sale on a non-`in_store` channel from a
  cashier is refused with `unauthorized_role`.

## Sprint 2 — v1.37.0 · Manager approval and discount limits

**Scope:** review §2 *Cashiers* #1 and *Admin and owner* #2.

- **Approval route.** `/api/approve` takes `{ email, pin, action, ref, pct? }` and
  checks the PIN under the login throttle.
  - The approver must be a manager or admin, and not the requester.
  - It returns a signed approval token bound to the action and the reference,
    valid for 24 hours, and writes an `approval.granted` audit entry.
- **What an approval unlocks:**
  - a refund pushed by a cashier
  - an over-limit discount
  - a no-sale drawer open
  - a deposit refund

  The approver is recorded on the transaction in a new `approved_by` column.
- **Discount limits** are stored as store settings `discount_limit_cashier` and
  `discount_limit_manager`.
  - The sale path computes each line's effective discount (line and order
    combined). Anything over the seller's limit needs a `discount` approval
    covering it, or the sale is refused with `discount_over_limit`.
  - Checkout asks for approval before charging.
- **Discounts report:** a `discounts` total in the summary and per cashier.

## Sprint 3 — v1.38.0 · Cashier gaps

**Scope:** review §2 *Cashiers* #2–#4.

- **Cashiers create customers** (name, phone, email). The ledger, statements and
  collections stay with managers.
- **Balance at checkout.** `/api/customers/balance` is open to any role and
  returns balance, credit limit and headroom.
  - Customers gain `credit_limit`, editable by managers.
  - A Net-30 amount over the headroom needs a `credit` approval, or the sale is
    refused with `credit_over_limit`.
- **Look up any sale.** In History, a cashier's search runs across the whole
  store, with no cost figures, so a return or warranty claim can be checked.
  Refunding still needs an approval.

## Sprint 4 — v1.39.0 · Manager gaps

**Scope:** review §2 *Managers* #0–#2.

- **Team list for managers** on the Staff screen (as built; planned for Settings), showing name, role and status.
  - *Unlock* works for anyone.
  - *Reset PIN* works for cashiers only.
- **Time punch correction.** `/api/timeclock/correct` sets clock-in or clock-out
  with a required reason, recomputes the minutes, and is audited. Correcting
  your own punch is admin only.
- **Close a forgotten shift.** `/api/shifts/force-close` lets a manager close
  someone else's open shift, with a count or marked *not counted*, and a reason.
  It is audited.

## Sprint 5 — v1.40.0 · Tax jurisdiction: United States and UAE

**Scope:** review §3, decision D4.

- **Store settings:**
  - `taxJurisdiction` (`US` | `AE` | `NONE`)
  - `taxRegNo` (the TRN: 15 digits for AE)
  - `pricesIncludeTax`
  - the tax label (*Sales tax* / *VAT*)

  Choosing the UAE at store setup defaults to AED, 5 %, and prices including VAT.
- **The money engine gains tax-inclusive pricing**, on the client and the server.
  VAT is extracted from the price as `gross × rate ÷ (100 + rate)` for taxable
  lines. Totals stay equal to the shelf price.
- **Receipts.** In the UAE, the receipt is titled *Tax Invoice* and carries:
  - the TRN
  - *VAT 5 %* and *Total incl. VAT*
  - the customer's TRN, when one is on file (a new customer field)

  Settings warns when the jurisdiction is AE and the currency is not AED.
- **Reports** label the tax line with the jurisdiction's name.

---

## Still waiting on the owner

These are not built in this program. Each needs an answer first.

- Trade-in / buyback: the cost basis.
- Warranty per serial: the terms.
- Layaway on sales, gift cards, accounting package, marketplace sync.
