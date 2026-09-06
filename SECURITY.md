# Orison POS — Security

How staff sign in, what protects the till from someone guessing their way in,
and the two weaknesses you should know about before deploying this.

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
user id, role and a 12-hour expiry. Signatures are compared byte by byte in
constant time, and the payload is rejected outright if it has expired.

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
offline-PIN fallback. Appending a uniquely-named marker needs no lock and loses
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

## Roles

`admin`, `manager`, `cashier`, checked server-side by `requireRole_` on every
privileged action. The role is carried in the signed session token, so a role
change takes effect at next sign-in rather than immediately.

| Route | Roles |
|---|---|
| `/api/admin/products`, `/serials`, `/inventory`, `/products/patch` | admin, manager |
| `/api/conflicts`, `/api/conflicts/review` | admin, manager |
| `/api/admin/unlock` | admin, manager |
| `/api/admin/pin` | admin |
| `/api/pin` | any signed-in user, own PIN only |

## The shared app token

`APP_TOKEN` is **one secret shared by every device**, entered once per
installation and stored in that browser's IndexedDB alongside the session token.

Two consequences worth planning around:

1. A single compromised device — or any script running on the origin — yields
   the credential that authorizes every device's requests.
2. Rotating it means re-provisioning every device by hand.

`public/_headers` currently sets `nosniff`, `Referrer-Policy`,
`X-Frame-Options` and a restrictive `Permissions-Policy`, but **no
Content-Security-Policy**. The app has no inline scripts and no third-party
origins, so a strict one costs nothing and is worth adding:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' https://script.google.com; frame-ancestors 'none'; base-uri 'self'
```

Longer term, per-device tokens the backend can revoke individually would remove
the shared-secret problem entirely.

## Offline behaviour

The PWA is offline-first: sales are queued locally and sync on reconnect. When
the backend is unreachable, `login.js` falls back to a PIN hash cached in
IndexedDB at the last successful sign-in, so the terminal keeps working. That is
a deliberate availability choice — a till that stops when the network does is not
usable — but it carries three consequences worth stating plainly:

1. A stolen device can still transact until it is next online.
2. Server-side throttling does not apply offline; the fallback compares locally.
3. **That cached hash is an unsalted SHA-256 of the PIN.** Six digits is a
   million candidates, so anyone who can read the device's IndexedDB recovers
   the PIN essentially instantly. It is per-device and only reachable by someone
   who already has the unlocked device or script execution on the origin — which
   is also why the missing CSP above is worth fixing — but it is not a
   meaningful protection and should not be relied on as one. Salting it per
   device, or storing a server-issued opaque token instead of a PIN hash, would
   close it.
