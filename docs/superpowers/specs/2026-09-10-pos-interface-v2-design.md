# Orison POS — interface v2

**Status:** approved design, not yet planned
**Date:** 2026-09-10
**Baseline:** v1.16.0 (backend-sim 446, client units 237, pdf-smoke 19)

## Why

The shop runs a Base44 POS whose home screen is a launcher: twelve tiles, one
per job — seven product categories plus Refund, Paid Out, Cash Pick Up, Time
Clock and Employee Expense. Staff know it. `orison-pos` is the replacement, and
across v1.0–v1.16 it grew a much larger feature set than the app it replaces —
customers and ledgers, purchase orders, reports, inventory tools, a time clock,
a customer display — without its interface being designed for that size. The
result is ten destinations in a horizontally scrolling bottom bar, a cart that
appears and disappears as a sheet, and a header that each screen re-invents.

This redesign keeps every capability and rebuilds the surface around the job
staff actually do, using Square, Shopify POS and Toast as the reference for
what "clean" means on a till.

## Decisions taken (owner, 2026-09-10)

| Question | Decision |
|---|---|
| What is the screenshot? | The live Base44 POS. `orison-pos` is its replacement; the screenshot is a reference for flow and clarity, not a codebase. |
| Home screen | **Register-first**, Square/Shopify model. |
| Palette | **Keep the repo's light navy/gold.** The screenshot informs layout and flow only, not colour. |
| Hardware | **All three** — phone portrait, counter tablet, desktop terminal. |
| Navigation | **Four tabs + More**, with the launcher grid living in More. |
| Paid Out / Cash Pick Up / Employee Expense | **Three distinct actions**, three transaction kinds, reported and reconciled separately. |

## Goals

1. A cashier ringing a sale touches fewer controls than today, and never loses
   sight of the cart.
2. Every destination — eleven screens, checkout, and the five inventory tools —
   remains reachable, none buried more than two taps from anywhere.
3. Cash leaving the drawer is attributable by reason without reading notes.
4. Every screen works at 375px, 834px and 1280px — not "adapts", works.

## Non-goals

- **No translation of interface copy.** v1.16.0 made the locale drive
  formatting; translating the strings is separate work, costed in
  `HANDOVER.md` §10.
- **No change to how money is computed.** Integer cents server-side, client
  figures advisory; totals, discounts and tax are untouched. §4 adds new
  transaction *kinds* to the ledger, which is a different thing from changing
  the arithmetic.
- **No change to sync, auth or the offline model.**
- **No new product imagery.** The catalog has no images and this design does
  not assume any; category colour carries identity instead.

## Risk accepted

Register-first plus four tabs means the launcher grid staff use today is no
longer the first thing they see. It survives as the **More** screen, but the
opening move changes from "pick a job" to "ring a sale". This is the design's
main relearning cost and the owner accepted it knowingly. Mitigation: More is
one tap from every screen, and its tiles keep the visual language of the
screen staff already know (colour chip, icon, plain label).

---

## 1. Shell

### App header

One header, rendered once, replacing the `.scr-head` block every screen
currently writes for itself.

- Store name (`state.store.name`)
- **Live clock**, from the Base44 screen — a till is a place people ask the
  time. One `setInterval` owned by `app.js`, cleared on teardown.
- Connectivity pill: online/offline plus queued-count from `outboxStats()`
- User chip: initial + role, tapping opens Settings

Screens keep a title line for their own name and any screen-specific action
(Refresh, + New, Tools). They stop rendering their own status pills — the
register's `.scr-status` moves into the header.

### Bottom bar — always four slots

The bar's *shape* never changes; the third slot fits the person. Two layouts
would mean two things to test and two muscle memories; one layout with one
variable slot does not.

| Role | Slots |
|---|---|
| cashier | Sell · History · Staff · More |
| manager, admin | Sell · History · Customers · More |

Staff is a cashier's third-most-used destination because it holds their time
clock. Implemented as a pure function `primaryTabs(role)` in `app.js`,
returning four screen ids — unit-testable without a DOM.

### More

A routed screen (`more`), so Back behaves, presented full-height. It carries
the launcher grid: colour-chip icon, icon, label — the visual language of the
screen staff already use. Grouped:

- **Money** — Refund, Paid Out, Cash Pick Up, Employee Expense, Open/Close Shift
- **Stock** — Products, Alerts, Purchases, and the five inventory tools
  (Reorder worksheet, Stock take, Bulk price, Labels, Aging)
- **Records** — Customers, Staff & time clock, Reports, Dashboard
- **System** — Settings, Customer display

Role gating is unchanged: a tile the caller's role cannot use is not rendered.
The existing `applyRoleTabs()` restriction list (inventory, alerts, customers,
reports, purchases) governs the grid as well as the bar.

### Desktop (≥1024px)

The sidebar stays and shows every destination, grouped under those same four
headings. More is hidden there — a More button where the screen has room for
the real list is hiding things for no reason. The v1.13 rail/expanded toggle
and its `localStorage` key (`orison:nav`) are unchanged.

---

## 2. Sell

### Phone portrait

```
[ app header                    ]
[ search (scanner-focused)      ]
[ category chips  ▸             ]
[ product grid, 2 columns       ]
[            …                  ]
[ CART BAR  3 items   $124.00 ▸ ]   ← pinned
[ Sell  History  Staff  More    ]
```

The cart bar is the substantive change. Today the cart exists only as a sheet
that appears on add and vanishes on dismiss, so the running total is invisible
between actions and staff re-open the sheet to check it. A pinned bar showing
count and total, tapping to expand the full cart, is what Square does and it
removes that whole class of doubt. The bar is absent when the cart is empty.

### Tablet landscape and desktop

Grid left, cart pinned right — the v1.13 dual-panel layout, which already
works. The cart bar is not rendered at these sizes; the panel is always
visible, so there is nothing to summarise.

### Product tile

Category colour as the identifying chip (the screenshot's device), name capped
at two lines with ellipsis, price prominent, stock and IMEI as small badges,
out-of-stock dimmed and non-tappable. No image slot — the catalog has none.

---

## 3. Checkout

Same engine, calmer surface: collapsed line summary that expands on tap, one
very large amount due, tender as a segmented control, keypad, quick amounts,
and a single primary action. Right-anchored panel on desktop, as now.

The customer picker, split tender, order discount, change calculation and
receipt flow are unchanged in behaviour.

---

## 4. Three money-out kinds

Today one `payout` kind carries a free-text "To / reason", so "how much went
out as staff expenses this month?" cannot be answered without reading every
note. Three kinds answer it in the ledger itself.

### Backend

- New transaction kinds **`pickup`** (cash pick-up) and **`expense`** (employee
  expense) beside the existing **`payout`** (vendor payment / paid out).
- `processPayout_` generalises to `processCashOut_(…, kind)`; `syncPush_`
  dispatches all three to it. All three are cash-out, all three are
  admin/manager via the existing `requireRole_` gate — no new privilege.
- `shiftClose_`: expected cash subtracts all three.
- `reports_`: `summary` gains `pickups` and `expenses`; `netRevenue` subtracts
  all three; the cash tender is reduced by each.
- `driveExport_`: separate **PAID OUT**, **CASH PICK-UP** and **STAFF EXPENSE**
  lines; NET CASH subtracts all three.
- `transactions_`: gross profit is 0 for all three, as it is for `payout` now.

Legacy rows stay `kind: 'payout'` and keep meaning vendor payment / paid out.
Nothing migrates.

### Client

- `money.js`: `createPayout` generalises to
  `createCashOut({ kind, counterparty, grandTotal, note, user })`, keeping
  `createPayout` as a thin wrapper so existing callers are not broken mid-work.
- `kindInfo()` gains `pickup` and `expense` with their own labels and chips.
- Three tiles in More → Money, each opening the same dialog with its kind and
  wording fixed.
- Dashboard shows one **Cash out** KPI with the three-way split beneath it.

---

## 5. Design system

The tokens exist (navy/gold, `--shadow*`, `--ease`, `--dur`, 44px targets,
`skeleton()`, `emptyState()`). This adds:

- **`public/js/components.js`** — composed UI shared across screens: `tile()`,
  `tileGrid()`, `cartBar()`, `appHeader()`, `sectionHead()`. `ui.js` keeps
  primitives (`fmt`, `esc`, `toast`, modal/sheet, `skeleton`, `emptyState`,
  CSV helpers). The boundary: `ui.js` knows nothing about this app's screens;
  `components.js` does.
- A strict 4/8px spacing scale, so screens stop inventing their own padding.
- The category colour scale promoted out of the duplicate `catColor()` copies
  in `register.js` and `inventory.js` into one place.

---

## Testing

**Backend (`tests/backend-sim.mjs`)** — the three cash-out kinds: accepted and
attributed, role-gated, subtracted by `shiftClose_`, split by `reports_`,
present as their own export lines, and legacy `payout` rows still behaving.
Assertions must be written to fail against the pre-change code and verified to
do so, as the v1.15.1 prototype-key assertions were.

**Client (`tests/client-*.mjs`)** — `primaryTabs(role)` for each role;
`kindInfo` for the new kinds; `createCashOut` builders against the IDB mock;
`tile()` escaping every field it renders.

**Browser** — each release verified at 375px, 834px and 1280px with zero
console errors, and a screenshot of the changed surface.

The sim's `LockService` always grants the lock, so any read-modify-write path
touched here is reviewed by eye as well as tested.

---

## Release sequence

Too large for one revision. Three, each independently shippable, each tagged
under the `AGENTS.md` protocol (docs in lockstep, `sw.js` VERSION, tag, push).

### v1.17.0 — Shell & navigation

App header with live clock, `primaryTabs(role)`, four-tab bar, More screen with
the grouped launcher grid, grouped desktop sidebar, `components.js` with
`tile`/`tileGrid`/`appHeader`/`sectionHead`.

*Done when:* every destination reachable in ≤2 taps from any screen; the bar
never scrolls at 375px; role gating identical to today; no screen internals
changed beyond removing their duplicated headers.

### v1.18.0 — Sell & checkout

Register redesign: search, chips, two-column grid, new product tile, pinned
cart bar on phone, dual-panel unchanged above 1024px. Checkout resurfaced.

*Done when:* the running total is visible at all times on a phone without
opening the cart; adding, discounting, removing and charging all work at each
breakpoint; serial capture and scanner flow unchanged.

### v1.19.0 — Money-out kinds and the remaining screens

The three cash-out kinds end-to-end (backend, reports, export, shift close,
history, dashboard), then History, Customers, Reports, Purchases, Inventory,
Staff, Settings and Dashboard brought onto the shared components.

*Done when:* an owner can read cash-out by reason in reports and in the Drive
export; every screen uses `components.js` rather than its own markup; no
`catColor()` duplicate remains.

---

## Open questions

None. Every decision needed to start v1.17.0 is recorded above.
