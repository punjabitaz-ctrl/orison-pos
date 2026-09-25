# Tier 1 — the daily events the build cannot represent

**Date:** 2026-09-25 · **Baseline:** v1.60.0 · backend-sim **1346 / 0** ·
client **639 / 0** · demo **41 / 0**.

Tier 0 is closed by owner decision. What follows is Tier 1 from
[`../specs/2026-09-24-gaps-analysis.md`](../specs/2026-09-24-gaps-analysis.md),
re-ordered by how often a phone shop actually hits each one.

**Closed and not to be reopened:** cards (the shop takes none), gift cards,
layaway, loyalty, per-role permission switches, an accounting platform,
multi-location. Payroll lives in this system. Opening balances for what
customers owed and what suppliers were owed on day one are **parked** — the
owner called Tier 0 finished, and the shop's own position is already in.

---

## Sprint 1 — v1.61.0 · Exchanges

**Why first:** it is the most common counter event the system cannot do. Today
a swap is a refund and then a sale: the customer's money round-trips, two
receipts print, and the day's figures carry a refund that never happened.

**What it is:** one transaction that takes goods back and gives goods out, and
settles only the difference — in either direction.

- Start from the original sale (the refund flow already finds it), pick the
  lines coming back, then add what is going out.
- **The difference is the only money that moves.** Customer owes more: take it
  by any tender. Shop owes them: give it back the way a refund does, store
  credit included.
- Stock: returned units go back on the shelf at the cost they left with, the
  new lines leave at their own cost — the machinery for both already exists.
- The books: one entry, not two. Sales returns and product sales both move;
  cost of goods sold nets.
- **Approval:** an exchange takes goods back, so it needs the same manager
  approval a refund needs. A cashier must not be able to unwind a sale alone.
- Serials: a returned IMEI comes back into stock and keeps its cost; the one
  going out is sold normally, with its own warranty from today.
- **Services are not exchangeable**, the same rule refunds already have.

**Open question for the owner:** when the shop owes the difference, is cash out
of the till acceptable, or should it always be store credit unless the original
was cash? *(Assumption if unanswered: same tenders a refund allows today.)*

**Size:** medium-large. The refund engine, the money engine and the receipt all
exist; the work is one flow, one ledger kind (`exchange`), and threading it
through the drawer, Reports, the export, the books and the client stats — the
same eight places every new kind goes.

---

## Sprint 2 — v1.62.0 · Stock back to a supplier

**Why second:** it is money, not convenience. A faulty delivery can only be
written off as shrinkage today: the shop eats the cost **and** still owes the
supplier for it.

**What it is:** a return against a purchase order or an account, which takes
the stock out and reduces what is owed.

- Pick the supplier, then the lines (or an IMEI); the quantity cannot exceed
  what was received and not already returned.
- Stock leaves at the cost it came in at — the same discounted cost v1.49.0
  established, and a serial retires rather than disappearing.
- The books: Dr Accounts payable, Cr Inventory. It shows on the supplier's
  statement and in payables, like every other movement on that account.
- Voidable by an admin with a reason, like a supplier payment.

**Open question for the owner:** does the supplier issue a **credit note**
against the account (the usual), or refund money back? *(Assumption if
unanswered: a credit note — it reduces what is owed. A money-back refund would
need a second movement and can follow later if it turns out to happen.)*

**Size:** medium. It is the mirror of v1.48.0 and v1.49.0, and those two set
every pattern it needs.

---

## Sprint 3 — v1.63.0 · Telling the customer

**Why third:** it is the cheapest thing on this list that a customer will
actually notice, and the bench already has the statuses it needs.

**What it is:** a message from a ticket — *your repair is ready*, *the part
you ordered has arrived* — sent the way receipts already go out.

- Reuses the existing send paths (WhatsApp, email). **No SMS gateway**: that
  is an account, a cost and a per-country rulebook, and it is not worth it
  until somebody asks.
- A template per status, in the customer's language where the shop knows it,
  with the ticket number and the shop's name and number.
- **Staff press send.** Nothing goes out automatically: a message the shop did
  not choose to send is a message it cannot take back, and an automatic one
  fires at 2am when a status is corrected.
- What was sent, when and by whom goes on the ticket and into the audit log.

**Open question for the owner:** WhatsApp only, or email too? *(Assumption if
unanswered: both, exactly as receipts work now.)*

**Size:** small-medium. Most of it is templates and a button.

---

## Sprint 4 — v1.64.0 · A tax return period

**Why last of the four:** the data is already right; this is a report over it.

**What it is:** for a period — tax collected on sales, tax paid on purchases,
and the difference owed or reclaimable — as a page to file from, with the
transactions behind each figure.

- Account 2000 already nets output tax against the input tax v1.49.0 started
  posting. This reads it, splits it, and shows the workings.
- PDF (for the filing) and CSV (for the accountant), the way everything else
  now exports.

**Open question for the owner:** is the shop VAT-registered in the UAE, and on
what cycle — quarterly? *(Assumption if unanswered: quarterly, with the
period selectable.)*

**Size:** small. It is a report, not a new movement.

---

## What is deliberately not in this program

- **Bank reconciliation** against a statement. Worth doing when an accountant
  asks for it; until then it is a large piece of matching machinery for a shop
  that can already see every deposit it made.
- **Recurring bills that post themselves** — the same reasoning as v1.58.0.
- **Purchase discounts on a supplier return** — a return of discounted stock
  goes back at what it cost, which is already right; nothing more is needed.

## How each sprint ships

The protocol in `AGENTS.md`, unchanged: one feature per tagged release, every
gate green before committing, docs in the same commit, both catalogues
translated, and the feature opened in a browser and used before it is called
done — that last one is what has caught the bugs the tests did not.
