# Orison POS — Security

How staff sign in, what protects the till from someone guessing their way in,
and the weaknesses you should know about before deploying this.

## Reporting

Found something? Open an issue, or contact the maintainer directly if you would
rather not disclose it publicly.

## The two secrets

| Secret | Where it lives | Scope |
|---|---|---|
| `APP_TOKEN` | Script Property, and every device's IndexedDB | One value, all devices |
| `SESSION_SECRET` | Script Property, auto-generated on first use | Server only |
| Staff PIN | Users sheet, salted SHA-256 | One person |

Every request carries `APP_TOKEN`. Everything except `/api/login` also carries a
session token: an HMAC-SHA256 signature over a base64url payload holding the
user id, role, an issued-at time and a 12-hour expiry. Signatures are compared
byte by byte in constant time, and the payload is rejected outright if it has
expired — or if the user's sessions have been revoked since it was issued (see
[Session revocation](#session-revocation)).

## Session revocation

Tokens are stateless, so there is no server-side list to consult per request.
Instead the backend keeps one "revoked at" timestamp per user in CacheService
(25 h TTL, outliving the longest-lived 12 h token). A token whose `iat` predates
that marker is rejected on the next request.

Session revocation happens at two granularities:

**Per user.** One "revoked at" timestamp per user in CacheService kills every
session for that account at once. This fires on:

- **Sign-out** — `POST /api/logout` (Settings → Sign out) revokes every session
  held by the signing-in user, so signing out of a terminal kills that device's
  token even if someone later recovers the storage it was written to.
- **Admin kill-switch** — `POST /api/admin/revoke { "email": "..." }`, surfaced
  as the Security card in Settings, revokes all sessions for a staff email. This
  is for a lost terminal where you don't know which device it was, or where
  every one of a person's devices is suspect.
- **PIN change** — changing your own PIN (`/api/pin`) or an admin resetting one
  (`/api/admin/pin`) revokes every prior session for that user. It is
  meaningless to keep old devices logged in to an account whose credentials
  changed because of a suspected compromise.
- **Role change** — demoting or promoting staff (`/api/admin/users/patch`)
  revokes their existing sessions on the spot, so a downgrade takes effect at
  the first request instead of waiting out up to 12 h of token expiry.

**Per device.** Each terminal submits a stable `deviceId` when it signs in, the
backend records it in a Devices sheet tab, and the token carries it as a `dev`
claim. Two mechanisms work together to kill one terminal without touching the
others:

1. A per-device "revoked at" marker in CacheService rejects that device's
   tokens immediately (current sessions die on next request).
2. A `revoked` flag on the device's row in the Devices sheet **blocks sign-in
   from that device** even with the correct PIN. This is what keeps a lost
   terminal dead after the 25 h cache marker lapses — without it, the device
   could simply sign back in once the marker aged out.

From the Settings Security card an admin lists a staff member's terminals
(`POST /api/admin/devices`), matches the short id shown against Settings →
Terminal ID on each physical device, then revokes just that one (`POST
/api/admin/revoke-device`). Per-user revoke-all also marks every device row for
that account, closing the re-login loophole there too.

A device that is stolen while **offline** keeps whatever it had until it next
connects; there is no way to reach it sooner. Revocation then takes effect on
first contact.

## Login throttling

Five consecutive failed PINs lock that account for **15 minutes**, measured from
the most recent failure. The lockout holds against the correct PIN too —
otherwise it would not slow an attacker down at all.

This matters more than it might seem. A 6-digit PIN is a million candidates, the
Apps Script Web App is reachable by anyone holding its URL, and a session token
authorizes the admin product, inventory and Drive-export endpoints. Without a
cost per attempt, guessing is simply a matter of time.

Failures are recorded as **one Script Property per attempt** rather than a
counter. A counter needs a read-modify-write, which Script Properties does not
make atomic, so it needs `LockService` — and that is the wrong trade on this
path: `tryLock` queues behind `syncPush_`, which holds the script lock for
seconds at a time, pushing the response past the client's 8-second timeout,
where `api.js` reports it as "offline" and `login.js` drops the cashier into the
offline credential fallback (a per-device key issued by the server — the PIN is
only ever checked online). Appending a uniquely-named marker needs no lock and loses
no writes.

Expired markers are swept on each attempt, across all addresses rather than only
the one being checked — otherwise one failure each against many addresses leaves
a property behind for every one, until the ~500 KB store fills and
`setProperty` starts throwing. Deletions are capped per request so a backlog
never stalls a login, and a ceiling evicts **per account**, skipping accounts
that are currently locked. Evicting the globally oldest markers instead would
let a flood of one-off failures clear a locked account.

There is deliberately **no delay** on a failed login. `Utilities.sleep` bills the
script's daily runtime quota and holds a simultaneous-execution slot, so a delay
long enough to matter is itself a way to take the till offline.

### Known tradeoff

Apps Script does not expose the caller's address, so the account is the only key
available. That means **someone who knows a staff email can keep that account
locked** by failing against it repeatedly. This is inherent to account-based
throttling with no second dimension, and the alternative — leaving PIN guessing
uncapped — is worse for a system that holds money and stock.

It is bounded rather than eliminated: the lockout expires on its own after 15
minutes, and an admin or manager can clear one immediately through the API (there
is no button for it in the app yet — review §2 Managers #0):

```
POST /api/admin/unlock   { "email": "someone@example.com" }
```

Or, from the Apps Script editor:

```js
clearLoginLockout("someone@example.com")
```

## PINs

Seeded PINs are 6 random digits, drawn from the hex positions RFC 4122 leaves
random and selected by rejection sampling — harvesting digits from a v4 UUID
inherits its fixed version nibble and skews the result badly (measured: PINs
ending in `4` 17% of the time rather than 10%).

**The seed writes those PINs to the execution log, and Apps Script keeps that
log.** They are therefore first-day credentials, not lasting ones. Hand them
out, then have everyone change theirs:

```
POST /api/pin          { "currentPin": "481902", "newPin": "246813" }   # yourself
POST /api/admin/pin    { "email": "...", "pin": "246813" }              # admin, for someone else
```

The admin route is the everyday recovery path for a forgotten PIN.

**If the workbook itself is lost:** `spreadSheet_` creates a new, empty one when
`openById` fails, but the `SEEDED` Script Property is already set, so it is
**not** reseeded and nobody can sign in. Recover by restoring a copy from Drive →
**POS Backup** and setting its id as `SPREADSHEET_ID`. With no backup, delete the
`SEEDED` property and run `setup()` — that seeds fresh starter accounts with new
PINs in that run's log.

The Users sheet stores only `salt` and `sha256(salt + ":" + pin)`. SHA-256 is
fast, which is the wrong property for a password hash; it is acceptable here only
because the throttle above bounds online guessing, and the sheet itself is
protected by Google account access rather than being public. If this ever moves
off Sheets, use a memory-hard hash.

New staff accounts created from Settings (`/api/admin/users`) also report a
one-time PIN to the execution log so the admin can hand it off — same
first-day-credential tradeoff as the seed, and staff should change it right
away via `/api/pin`.

## Roles

`admin`, `manager`, `cashier`, checked server-side by `requireRole_` on every
privileged action. The role is carried in the signed session token; because a
role **change** revokes that user's sessions immediately, a promotion or
demotion takes effect at the first request after the change (no 12-hour lag).

Verified route by route against `Code.gs` at v1.44.0. The task-level view —
what each role can actually do on screen, and what they cannot — is in
[`docs/superpowers/specs/2026-09-12-roles-and-gaps-review.md`](docs/superpowers/specs/2026-09-12-roles-and-gaps-review.md).

| Route | Roles |
|---|---|
| `/api/sync/push` — sale | any signed-in role |
| `/api/sync/push` — refund | admin, manager; a cashier with a `refund` approval for that clientTxId |
| `/api/sync/push` — sale over the seller's discount limit | needs a `discount` approval covering it (`discount_over_limit`) |
| `/api/sync/push` — payout, pickup, expense, payment (collection) | admin, manager (refused per row otherwise) |
| `/api/sync/push` — deposit, deposit_refund, or a `deposit` tender | nobody — server-written only |
| `/api/transactions`, `/api/shifts`, `/api/timeclock`, `/api/drive/export` | admin, manager see the store; a cashier is scoped to their own rows |
| `/api/shifts/open`, `/close`, `/api/timeclock/punch`, `/api/pin`, `/api/logout` | any signed-in user, own records only |
| `/api/products`, `/api/sync/pull` | any; cost prices only to admin, manager |
| `/api/config` | any; the staff roster only to admin, manager |
| `/api/customers` (search), `/api/customers/balance` (totals only), `/api/admin/customers` (create; no credit limit) | any signed-in role |
| `/api/warranty` (IMEI, serial or receipt; ≥4 characters) | any signed-in role |
| `/api/admin/customers/patch` (credit limit, details) | admin, manager |
| `/api/transactions?lookup=1` | a cashier, store-wide, sales and refunds only, ≥4-character search, 20 rows, no cost or margin |
| `/api/sync/push` — Net-30 charge past a customer's credit limit | needs a `credit` approval covering the overage (`credit_over_limit`) |
| `/api/repairs`, `/detail`, `/parts`, `/labour`, `/status`, `/deposit`, `/collect` | any signed-in role (all audited) |
| `/api/repairs/deposit-refund` | admin, manager; a cashier with a single-use `deposit_refund` approval for that ticket |
| `/api/tradein` (buy a used device) | admin, manager; a cashier with a single-use `tradein` approval bound to the IMEI, capped at the approved amount |
| `/api/tradeins` (the trade-in register) | admin, manager |
| `/api/repairs/void` | admin |
| `/api/drawer/open` | admin, manager; a cashier with a single-use `drawer` approval (audited) |
| `/api/approve` | any signed-in role asks; the approver must be a different, active manager or admin, and within their own discount limit |
| `/api/reports`, `/api/price-history`, `/api/inventory/aging`, `/api/inventory/reorder` | admin, manager |
| `/api/reports/sales` | admin, manager (whole shop, with cost); a cashier gets their own sales only (the server overrides `userId`) and no cost, profit or margin |
| `/api/customers/ledger`, `/receivables`, `/statement` | admin, manager |
| `/api/admin/products`, `/products/patch`, `/serials`, `/inventory` | admin, manager |
| `/api/purchase-orders`, `/detail`, `/receive` | admin, manager |
| `/api/conflicts`, `/api/conflicts/review`, `/api/admin/unlock` | admin, manager |
| `/api/admin/users/list` | admin, manager (no credential fields) |
| `/api/admin/pin` | admin for anyone; a manager for **cashiers only** |
| `/api/timeclock/correct` | admin, manager; only an admin corrects their own punches |
| `/api/shifts/force-close` | admin, manager; reason required |
| `/api/suppliers`, `/api/purchase-orders/cancel` | admin |
| `/api/marketplace/settings` (set the sheet) | admin; managers read status only (no link) |
| `/api/marketplace/import` | admin, manager (the hourly trigger runs as the admin who set the sheet) |
| `/api/admin/products/bulk-price`, `/api/admin/stock-take` | admin |
| `/api/admin/users`, `/users/patch` | admin |
| `/api/admin/revoke`, `/api/admin/devices`, `/api/admin/revoke-device` | admin |
| `/api/admin/store`, `/api/reports/schedule`, `/api/backup/status`, `/api/backup/run` | admin |
| `/api/accounting` (the books: P&L, trial balance, journal) | admin |
| `/api/audit` | admin |

A sale on any `channel` other than `in_store` (Sold Elsewhere) is refused from a
cashier with `unauthorized_role` (v1.36.0).

## Manager approval (v1.37.0)

Some actions a cashier may take only with a manager present: a refund, a discount over their limit, a no-sale drawer open, a deposit refund. The manager types their own email and PIN on the cashier's screen, and `POST /api/approve` returns a signed approval.

- **It is not a session.** It is signed over `'approval:' + body`, and a session token is signed over `body`. An approval fed in as a session fails verification.
- **It is narrow.** It is bound to one action and one reference that the terminal generated before asking (the refund's or sale's `clientTxId`, a drawer nonce, `ticketId|nonce`). It may carry a maximum discount (`p`) or amount (`m`).
- **It expires and is re-checked.** It lasts 24 hours, so a refund queued behind a dropped connection still lands. When it is used, the approver must still be active and still a manager or admin, and for a discount still within their limit.
- **Single-use where there is no transaction.** A drawer approval and a deposit-refund approval are remembered in CacheService for six hours. A refund or discount approval is bound to a `clientTxId`, which push idempotency already makes single-use.
- **Throttled like sign-in.** A wrong approval PIN counts toward that address's lockout. It answers **403, not 401**, because the terminal treats a 401 as its own session expiring and signs the cashier out.
- **Nobody approves themself**, and every grant is audited as `approval.granted`. The transaction records the approver in `approved_by`.
- **Approvals need a connection.** A PIN is only checked by the server; there is no offline approval, by design.

Discount limits (`discount_limit_cashier`, default 10; `discount_limit_manager`, default 50; admins unlimited) are enforced on the server against the deepest line: `1 − (1 − line%)(1 − order%)`.

## Audit log

`AuditLog` (v1.22.0) is append-only — the API has no update or delete path —
and readable by admins only. It records the actor, their role, the action, the
target, a summary and the terminal.

**Recorded (v1.36.0, approvals v1.37.0):**

- **Money:** refunds, paid out, cash pick-ups, staff expenses and payments on account, written as they sync; no-sale drawer opens; Drive exports.
- **Stock:** stock adjustments with a reason; stock takes; product create and edit, field by field; bulk repricing; serials added; suppliers; purchase orders created, received and cancelled.
- **Repairs:** every repair action.
- **People and access:** manager approvals; punches corrected; shifts closed by a manager; customer changes (credit limits); sign-ins; the attempt that trips a lockout; lockout releases; new staff; staff edits; PIN resets; revoke-all; terminal revocations; customer creation; conflict reviews.
- **The business:** store settings, scheduled reports and backups.

**Deliberately not recorded:**

- Ordinary sales. The ledger is their record.
- Individual failed sign-ins. Logging each one would let anyone who knows an address fill the log.

A test (`tests/client-audit.mjs`) fails if the server writes an action the audit screen cannot filter or name.

Anyone with edit access to the Google Sheet can change any row — the log
included — without going through the API. Keep the workbook's sharing to the
owner.

### Fixed in v1.14.0 — shift roster leak

`/api/shifts` treated `?status=all` as an opt-in to the store-wide roster
*before* checking the caller's role, so any signed-in cashier could read every
other cashier's opening float, expected drawer, declared cash and over/short.
The parameter is gone: the roster is `isStoreRole_`-gated like every other
store-scope read, and a cashier's open-shift count is now their own rather than
the store's. Covered by two sim assertions.

### Customer display (v1.15.0)

The second-screen mirror is a **publish-only, same-origin** channel: the
register posts a frame on a `BroadcastChannel` and `display.html` renders it.
The display never reads the catalog, never holds a session token and never
calls the backend, so a screen facing the shop floor cannot be turned into a
window onto the till.

Only shopper-facing fields are ever published — line names, quantities, line
amounts, discounts, the totals breakdown, amount due and change. Cost, margin,
customer identity or balance, cashier, terminal id and every till figure are
absent from the frame by construction: what is not published cannot be shown.
The last frame is cached in `localStorage` (same origin, same device) so a
display opened mid-sale paints immediately; it is cleared to an idle frame when
mirroring is switched off.

## The shared app token

`APP_TOKEN` is **one secret shared by every device**, entered once per
installation and stored in that browser's IndexedDB alongside the session token.

Three consequences worth planning around:

1. **It is still in the terminal's storage.** Since v1.36.0 the app never
   displays it: Settings → Backend is admin-only, the field is masked and
   never pre-filled, and the sign-in Backend prompt no longer shows the saved
   value. Anyone with developer tools on an unlocked device can still read
   IndexedDB.
2. A single compromised device — or any script running on the origin — yields
   the credential that authorizes every device's requests. Sessions themselves
   are revocable per user and per device (see [Session revocation](#session-revocation)),
   but the app token is not; rotating it means re-provisioning every device by hand.
3. Because it is shared, it cannot identify a device. If that matters, a
   per-device credential is the next step.

## The demo build (v1.45.0)

`https://punjabitaz-ctrl.github.io/orison-pos/` is a public demo with **no real
data and no server**. The backend runs in the visitor's browser and keeps its
state in that browser's localStorage. Its four accounts have **fixed, published
PINs**, which is acceptable only because there is nothing behind them.

- `api.js` routes requests to the in-page backend only when
  `globalThis.ORISON_DEMO` is set, and only `demo/boot.js` sets it. A
  production build never loads that file, so a page that could set the global
  would already be running injected script.
- The demo site ships **without `_headers`**. Its backend is built with
  `new Function`, which the production CSP (`script-src 'self'`, no eval)
  correctly forbids. Never serve the demo from the production origin.

## Content-Security-Policy

`public/_headers` sets `nosniff`, `Referrer-Policy`, `X-Frame-Options`, a
restrictive `Permissions-Policy` and a strict Content-Security-Policy:

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self' https://script.google.com https://script.googleusercontent.com; font-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'
```

The app has no inline scripts and no third-party origins: the only external
destination is the Apps Script backend (`connect-src`), and `'unsafe-inline'`
is granted to styles only, because the tab bar and screens set a handful of
inline `style` attributes. Everything else — scripts, images, fonts, workers,
the manifest — must come from the app's own origin.

**`connect-src` lists two Google hosts, and both are required.** An Apps Script
Web App answers `/exec` with a redirect to `script.googleusercontent.com`, and
CSP is enforced against every hop of a redirect, not just the URL the app
asked for. Allowing only `script.google.com` blocks each API call outright,
with no console error that names the cause. (Before v1.15.1 the policy did
exactly that; it went unnoticed because GitHub Pages ignores `_headers`
entirely — Cloudflare Pages, the documented target, applies them.)

## Offline behaviour

The PWA is offline-first: sales are queued locally and sync on reconnect. When
the backend is unreachable, `login.js` falls back to a cached **offline
credential** so the terminal keeps working. That is a deliberate availability
choice — a till that stops when the network does is not usable — but it carries
four consequences worth stating plainly:

1. A stolen device can still transact until it is next online.
2. Server-side throttling does not apply offline.
3. The offline credential is a **256-bit opaque key issued by the server at
   sign-in** (v1.2.5). Nothing on the device is derived from, or reveals, the
   PIN: a reader of the device's IndexedDB recovers the PIN *never*, and the
   key only works on the terminal that stored it. When an admin kills this
   device's sessions, the first sign that reaches the backend wipes the
   credential from storage.
4. Because the credential gates offline access, the PIN itself is only ever
   verified by the server. An attacker who takes a signed-out device that has
   cached a credential learns nothing about the account's PIN, so they cannot
   turn the theft into an online login.

   (The 1.2.4 and earlier releases cached an unsalted SHA-256 of the PIN for
   the same fallback; six digits is a million candidates, so that hash was
   recoverable essentially instantly. It is deleted from storage on the first
   sign-in after upgrading.)

## Acknowledged weaknesses (hardening backlog)

These are known, deliberately-documented tradeoffs — mostly consequences of
the offline-first design or the single-secret deployment model. Fixing them
is tracked; none is silent.

1. **Client-trusted money facts.** Because sales are recorded offline and
   synced later, `unitPrice`, `quantity`, and `tenders` arrive from the device
   and are recomputed server-side only for totals/discounts — the server does
   not enforce "price = retail" or "Σ tenders = total". A signed-in cashier can
   under-ring. Enforcing price/tender invariants server-side would require
   either online-only sales or a signed-price mechanism; both are bigger
   changes than a hardening release.
2. **Lost-terminal offline window.** A device stolen while offline keeps its
   cached offline credential until it next connects; there is no way to reach
   it sooner. Revocation (admin → Security → revoke device) closes it on first
   contact. This is inherent to offline-first point-of-sale.
3. **`APP_TOKEN` is shared** by every terminal and lives in each device's
   IndexedDB (see [The shared app token](#the-shared-app-token)). A single
   compromised install yields it; rotation is manual.
4. ~~**Client-side CSV export** does not prefix formula characters.~~ **Fixed
   in v1.15.0**: `ui.js` `csvCell()` neutralises a leading `= + - @` *and*
   always quotes (the statement export previously did the opposite — guarded
   formulas but never quoted, so a comma in a name shifted its columns).
   Reports, customer statements and the reorder worksheet all use it.
5. ~~**Client-supplied report keys** collide with prototype keys.~~ **Fixed in
   v1.15.1**, and it was not harmless: a category or tender named `__proto__`
   dropped its line from the report entirely, one named `constructor` wrote
   onto a shared built-in, and `adminSerials_` silently discarded an IMEI
   reading `constructor`/`toString` as a duplicate. Every map keyed by
   operator- or client-supplied text is now `Object.create(null)`.
6. **Account-based lockout is a cheap DoS** against a known email (see
   [Login throttling](#login-throttling)); an admin can clear it any time.
   Per-device/IP throttling would need call metadata the Web App does not
   expose.
7. **Salted single SHA-256 PIN hashes** are fast to brute-force if the
   workbook ever leaks; bounded by the login throttle and Google account
   access. Move to a memory-hard hash if the store moves off Sheets.
8. ~~**Discounts have no ceiling or approval.**~~ **Fixed in v1.37.0**: per-role
   limits enforced on the server, with approval over them, and discounts by
   cashier in reports. Weakness #1 still stands: the unit price itself is
   client-supplied.
9. ~~**No manager-approval step exists.**~~ **Fixed in v1.37.0**: see
   [Manager approval](#manager-approval-v1370).
