# Changelog

All notable changes to Orison POS are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] — 2026-09-06

Security release covering the login path. No feature work, and nothing is
deployed from this repository yet, so no live account was ever exposed.

### Security

- **Published credentials.** `SEED_USERS` shipped four accounts with
  production-shaped `@orisonigt.com` addresses and the PINs `1234`, `3456`,
  `5678`, `9012`, seeded into the Users sheet on first run — and the README
  published them as a table, in a public repository. `seed_()` now generates a
  random 6-digit PIN per account and reports it once to the execution log;
  committed fixtures use `example.com` so they can never name a real mailbox.

- **Unthrottled PIN guessing.** `login_()` compared a salted SHA-256 of the PIN
  and issued a 12-hour session token, with no counter, delay or lockout anywhere
  in the backend — searching all 1,429 lines for `rate`, `lockout`, `attempt`,
  `throttle` or `backoff` returned nothing. Against a 4-digit PIN that is a
  10,000-candidate space an attacker can simply walk, and the resulting token
  authorizes the admin product, inventory and Drive-export endpoints, on a Web
  App reachable by anyone holding the URL. Five failures now lock the account for
  15 minutes. See [SECURITY.md](SECURITY.md#login-throttling).

- **PIN keyspace.** Seeded PINs went from 4 digits to 6, a hundredfold larger
  space. The generator draws from the hex positions RFC 4122 leaves random and
  uses rejection sampling: harvesting digits from a v4 UUID inherits its fixed
  version nibble, which — measured over 200,000 samples — made PINs end in `4`
  17.1% of the time instead of 10%.

### Fixed

Defects in the throttle itself, each found by review after the first
implementation and each covered by a test that fails against the commit before
it:

- **The counter never tripped under load.** `recordLoginFailure_` did an
  unlocked read-modify-write on Script Properties, and a Web App serves requests
  concurrently, so parallel guesses all read the same count and all wrote `n=1`.
  Failures are now one property per attempt, which needs no lock and loses no
  writes.
- **Taking the lock broke the client.** The lock added to fix the above sat
  behind `syncPush_`, which holds the script lock for seconds, so a failed login
  could exceed the client's 8-second timeout — which `api.js` maps to
  `err.offline` and `login.js` turns into the offline-PIN fallback, leaving a
  cashier silently offline instead of seeing the error. The same applied to
  `ensureSeed_`, which took the lock on **every** request to check a condition
  true once in a deployment's life; it now checks before taking it.
- **The lockout was shorter than advertised.** The window was measured from the
  first failure, so four failures at the start and a fifth just before it
  elapsed bought a lockout of about a second. It now runs from the most recent
  failure.
- **The store filled up.** Expired records were deleted only when the same
  address was looked up again, so one failure each against many addresses left a
  permanent property behind for every one — until the ~500 KB Script Properties
  store filled and `setProperty` began throwing, taking `SESSION_SECRET` and
  `SPREADSHEET_ID` writes with it. Expiry is now a sweep across all addresses,
  with a ceiling and per-account eviction.
- **Eviction released lockouts.** Once over that ceiling the sweep dropped the
  globally oldest markers, so roughly a thousand one-off failures against
  throwaway addresses deleted a locked victim's markers and handed them a clean
  slate — an attacker using the defence to undo itself. Eviction is per account,
  and skips accounts that are currently locked.
- **Delays billed the runtime quota.** A growing `Utilities.sleep` on each
  failure consumed the script's daily runtime and held a simultaneous-execution
  slot; roughly 1,350 failed logins would have exhausted a consumer account's 90
  minutes and taken the backend offline. Removed — the attempt cap is what
  bounds an attacker anyway.

### Added

- `POST /api/pin` — any signed-in user changes their own PIN, presenting the
  current one. Seed PINs are written to the execution log, which Apps Script
  retains, so this is what makes them stop working.
- `POST /api/admin/pin` — an admin sets a staff member's PIN and clears any
  lockout. This is the recovery path if the workbook is ever recreated, which
  reseeds and rotates all four starter PINs.
- `POST /api/admin/unlock` — an admin or manager releases a lockout from the
  till, rather than a shift waiting on someone to open the Apps Script editor.
- [SECURITY.md](SECURITY.md), covering the authentication model, the throttle
  and its known tradeoff, PIN handling, and the shared `APP_TOKEN`.
- Backend simulation coverage of all of the above. The suite goes from 71 to 109
  checks.

### Changed

- `npm test` runs the backend simulation only, which needs nothing external.
  `npm run test:all` adds the browser suite.
- `tests/e2e.mjs` takes both PINs from `E2E_PIN` and `E2E_CASHIER_PIN` and skips
  cleanly when they are absent, rather than failing. It no longer echoes a PIN
  into stdout and `tests/e2e-run.log` — harmless when that was `1234`, not now.

### Known limitations

- The lockout is keyed per account, and Apps Script exposes no client address,
  so someone who knows a staff email can keep that account locked by failing
  against it. `/api/admin/unlock` exists because of this. See
  [SECURITY.md](SECURITY.md#login-throttling).
- `APP_TOKEN` is one shared secret held by every device, and `public/_headers`
  sets no Content-Security-Policy. See
  [SECURITY.md](SECURITY.md#the-shared-app-token).
- The offline sign-in fallback compares against an **unsalted** SHA-256 of the
  PIN cached in IndexedDB, which is trivially reversible for a 6-digit PIN by
  anyone who can read the device's storage. See
  [SECURITY.md](SECURITY.md#offline-behaviour).
