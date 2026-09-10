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
minutes, and an admin or manager can clear one immediately from the app:

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

The admin route is also the recovery path. `spreadSheet_` recreates the workbook
if `openById` ever fails, which reseeds and rotates all four starter PINs —
without a reset route that would leave nobody able to sign in.

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

| Route | Roles |
|---|---|
| `/api/sync/push` — sale    | any signed-in role |
| `/api/sync/push` — payout, payment (collection), refund | admin, manager |
| `/api/reports`, `/api/drive/export` (store scope) | admin, manager (cashiers export only their own rows) |
| `/api/shifts` (all shifts) | admin, manager (cashiers see their own) |
| `/api/customers/ledger`, `/api/customers/receivables` | admin, manager |
| `/api/suppliers`, `/api/purchase-orders`, `/api/purchase-orders/detail`, `/receive`, `/cancel` | admin, manager |
| `/api/admin/products`, `/serials`, `/inventory`, `/products/patch` | admin, manager |
| `/api/conflicts`, `/api/conflicts/review` | admin, manager |
| `/api/admin/unlock` | admin, manager |
| `/api/admin/users*` | admin |
| `/api/admin/revoke` | admin |
| `/api/admin/devices`, `/admin/revoke-device` | admin |
| `/api/admin/pin` | admin |
| `/api/admin/customers` | admin, manager |
| `/api/pin` | any signed-in user, own PIN only |
| `/api/logout` | any signed-in user, own sessions only |

## The shared app token

`APP_TOKEN` is **one secret shared by every device**, entered once per
installation and stored in that browser's IndexedDB alongside the session token.

Two consequences worth planning around:

1. A single compromised device — or any script running on the origin — yields
   the credential that authorizes every device's requests. Sessions themselves
   are revocable per user and per device (see [Session revocation](#session-revocation)),
   but the app token is not; rotating it means re-provisioning every device by hand.
2. Because it is shared, it cannot identify a device. If that matters, a
   per-device credential is the next step.

## Content-Security-Policy

`public/_headers` sets `nosniff`, `Referrer-Policy`, `X-Frame-Options`, a
restrictive `Permissions-Policy` and a strict Content-Security-Policy:

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self' https://script.google.com; font-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'
```

The app has no inline scripts and no third-party origins: the only external
destination is the Apps Script backend (`connect-src`), and `'unsafe-inline'`
is granted to styles only, because the tab bar and screens set a handful of
inline `style` attributes. Everything else — scripts, images, fonts, workers,
the manifest — must come from the app's own origin.

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
4. **Client-side CSV export** (`reports.js`) quotes cells but does not prefix
   formula characters (`= + - @`); the server-side `csvCell_` does. Export a
   server CSV (`/api/drive/export`) for spreadsheet-grade safety.
5. **Client-supplied report keys** (tender type, category) are used as object
   keys in `reports_`; a hostile payload could collide with prototype keys.
   Harmless today (data is single-store, post-auth) but should switch to
   `Object.create(null)` maps.
6. **Account-based lockout is a cheap DoS** against a known email (see
   [Login throttling](#login-throttling)); an admin can clear it any time.
   Per-device/IP throttling would need call metadata the Web App does not
   expose.
7. **Salted single SHA-256 PIN hashes** are fast to brute-force if the
   workbook ever leaks; bounded by the login throttle and Google account
   access. Move to a memory-hard hash if the store moves off Sheets.
