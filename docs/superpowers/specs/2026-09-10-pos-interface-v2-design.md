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
| Navigation | **Register is home; the launcher is one tap away.** A flat tile grid, like the screen staff use now — no group headings, no submenus. Revised 2026-09-10 after the first draft: navigation must be simple enough that nothing has to be learned. |
| Paid Out / Cash Pick Up / Employee Expense | **Three distinct actions**, three transaction kinds, reported and reconciled separately. |

## Goals

1. A cashier ringing a sale touches fewer controls than today, and never loses
   sight of the cart.
2. Every destination is reachable in two taps or fewer, and nothing requires
   remembering where it lives — one button opens a grid of every job, labelled
   in plain words.
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

The opening move changes from "pick a job" to "ring a sale". That is the only
relearning in this design, and it is bounded: **Menu** is the largest,
left-most, thumb-nearest control on every screen, and it opens the same flat
grid of big labelled tiles staff use today. Someone who learns nothing else
can press Menu and be where they already know how to be.

Everything else in this design is aimed at the same constraint. Navigation is
never more than two levels. There are no group headings to parse, no
disclosure triangles, no long-press, no swipe-to-reveal, and no control whose
meaning depends on remembering a previous screen. Every destination is a tile
with a plain word under it.

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

### Bottom bar — three items

**Menu · Sell · History.** Three, not four. A cashier who can only ever learn
three things should not be given four, and three items across a 375px phone
gives each a target half again as wide as four would.

**Menu is the primary control**: left-most (nearest the thumb), visually
heavier than the other two — a filled navy tile with a 3×3 grid glyph — so it
reads as *the* way to get anywhere. It opens the launcher.

*Changed from the first draft*, which had four slots including a role-dependent
one (Customers for managers, Staff for cashiers). A slot that means different
things to different people is exactly the kind of thing that has to be learned.
Time clock and Customers both live on the launcher instead; punching in becomes
Menu → Time Clock, two taps, twice a day.

### The launcher

A routed screen (`menu`), so Back behaves, presented full-height. One flat grid
of big tiles — colour chip, icon, one plain word — in the visual language of
the screen staff use today. **No group headings and no nesting.**

| | | |
|---|---|---|
| Refund | Paid Out | Cash Pick Up |
| Employee Expense | Shift | Time Clock |
| Customers | Products | Alerts |
| Purchases | Reports | Dashboard |
| Settings | | |

Thirteen tiles for an admin, against the twelve on the screen staff use now.
Role gating removes what a role cannot use rather than disabling it, so a
cashier sees four: Shift, Time Clock, Settings, and Dashboard. The existing
`applyRoleTabs()` restriction list (inventory, alerts, customers, reports,
purchases) governs the grid.

Three decisions inside that grid, each made to keep it at roughly the density
of the screen it replaces:

1. **No product-category tiles.** The screenshot puts seven of them on the home
   grid, but Sell *is* home now and its category chips are already the first
   thing on screen. Two ways to do one thing is the opposite of simple. §2
   makes those chips look like the tiles they replace, so the muscle memory
   survives even though the control changed.
2. **The five inventory tools stay behind Products → Tools**, where v1.15.0 put
   them. They are the one nesting exception: they operate *on* the product list,
   they are manager-only, and hoisting them would take the grid to eighteen
   tiles, most of which no cashier may open. This is the only place in the app
   where anything is two levels deep.
3. **Customer display moves into Settings.** It is configured once per terminal
   and never touched again; it does not earn a permanent tile.

### Desktop (≥1024px)

The sidebar stays and lists every destination — flat, in the launcher's order,
no headings, so the two navigations are the same list in two shapes. Menu is
hidden there: a button that opens a list, next to the list, is noise. The v1.13
rail/expanded toggle and its `localStorage` key (`orison:nav`) are unchanged.

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
[ Menu     Sell        History  ]
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

### Category chips

The chips above the grid inherit the launcher's visual language — chunky,
coloured, one plain word — so the "tap the category" habit staff have today
survives the control changing from a tile on a home screen to a chip on the
sell screen. They scroll horizontally and the active one is filled.

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
- Three tiles on the launcher — Paid Out, Cash Pick Up, Employee Expense —
  each opening the same dialog with its kind and wording fixed.
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

App header with live clock; three-item bottom bar with Menu as the primary
control; the `menu` launcher screen carrying one flat role-gated tile grid;
flat desktop sidebar; `components.js` with `tile`/`tileGrid`/`appHeader`;
Customer display moved into Settings.

*Done when:* every destination is reachable in ≤2 taps from any screen (the
five inventory tools being the only three-tap items, by design); the bottom bar
never scrolls at 375px and every target clears 44px; a cashier's launcher shows
exactly the four tiles their role permits; and no screen's internals change
beyond dropping its duplicated header.

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
