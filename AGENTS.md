# Orison POS — Agent operating guide

This file tells AI agents (and human contributors) how this repo is built,
validated, and shipped. Read `HANDOVER.md` for the live state snapshot and the
full review backlog; read `README.md` for the product story.

## Project at a glance

Offline-first, mobile-first point-of-sale PWA for a small electronics store.
Vanilla ES-module front end + Google Apps Script backend on Sheets/Drive, no
hosting cost. Money model: integer-cents server engine; every privileged route
is role-gated (`admin` / `manager` / `cashier`); sales sync First-Committed-Wins.

## Layout

```
backend/Code.gs          Single-file Apps Script backend (~3,340 lines)
public/index.html        PWA shell
public/js/app.js         Router + session restore
public/js/api.js         /exec transport (envelope, APP_TOKEN, session, offline flag)
public/js/db.js          IndexedDB layer
public/js/sync.js        Outbox push/pull + VOIDED handling
public/js/money.js       Money math
public/js/stats.js       Shared aggregation (day totals, trends, hourly buckets, top sellers, hours)
public/js/screens/*.js   login register checkout history customers reports purchases inventory settings dashboard alerts staff
public/js/receipt-send.js  Receipt PDF/share
public/css/style.css     UI + @media print receipt mode
public/sw.js             Service worker (VERSION must be bumped every release)
tests/backend-sim.mjs    Backend logic suite against an in-memory Apps Script mock
tests/e2e.mjs            Headless E2E (needs a freshly-seeded live backend)
tests/pdf-send-smoke.mjs Receipt PDF/share smoke test
README.md  DEPLOY.md  SECURITY.md  CHANGELOG.md  RELEASE_NOTES.md  AGENTS.md  HANDOVER.md
```

## Release protocol (MANDATORY — one feature = one version)

Every feature/change ships as its own **tagged revision** on `main`:

1. Implement.
2. Validate (see below) — all green before anything is committed.
3. In the **same commit**, keep everything in lockstep:
   - `public/sw.js` `VERSION` → `orison-pos-vX.Y.Z`
   - `package.json` `version` → `X.Y.Z`
   - `CHANGELOG.md` → new `## [X.Y.Z]` section (Keep a Changelog style)
   - `RELEASE_NOTES.md` → move the latest-release section to the top with the
     new version, headline, and deploy notes
   - `README.md`, `DEPLOY.md`, `SECURITY.md`, `backend/README.md` → re-read and
     update anything they say that your change affects
   - `HANDOVER.md` → refresh state: version, features, sim count, standing
     todo, roadmap position
4. Commit with a subject of form `vX.Y.Z: <what it is>`; add `git tag vX.Y.Z`;
   `git push origin main --tags`.

**Never ship a revision whose docs describe the previous version.** If a doc
references an older capability, the task is not done. When a review or upgrade
lands, bump again (patch release) and refresh the same five docs.

## Validation cadence

```bash
node tests/backend-sim.mjs        # backend logic (expect PASS n FAIL 0)
node --check <touched public js>  # syntax on every touched client file
node tests/pdf-send-smoke.mjs     # receipt PDF/share (PASS 19 / FAIL 0)
npm run test:client               # client unit tests (money/sync/db/alerts/ui)
```

- `npm test` == backend sim only. `npm run test:client` runs the pure-Node
  client unit suites via `node:test` + `fake-indexeddb`. `npm run test:all`
  adds E2E (skips without a live backend) and the pdf smoke.
- The sim's `LockService` **always grants the lock** — concurrency bugs are NOT
  caught there; review read-modify-write paths manually.
- The sim exercises the reports DTO and export against the *server's own
  format*; never relax a failing export/GP assertion to match new server code
  without confirming the fix is real.
- Client unit tests need `--import ./tests/helpers/setup-globals.mjs` (browser
  globals shim + fetch mock harness). Never import a client module in a test
  without that shim loaded first.
- Git push output on Windows PowerShell renders as red "errors" — harmless;
  pushes succeed (verify `main -> main` and new tags).

## Conventions

- Backend `Code.gs` is deliberately ES5-ish (`var`, function statements) so it
  pastes cleanly into Apps Script. Client code is modern ES modules.
- **No comments in client code unless the user asks.** Backend keeps its
  existing explanatory comments (they are part of the module's contract docs).
- Tokens carry a `uid` claim, **not** `userId`. `requireRole_` returns 403.
  Payouts, collections (payments), and **refunds** are admin/manager-only.
- All user-supplied text rendered into the DOM goes through `esc()` from
  `public/js/ui.js`. Never use raw `innerHTML` with unescaped data.
- Server recomputes all money; the client's figures are advisory. Keep the
  integer-cents engine as the single source of truth for totals/discounts.
- New backend endpoints: register in `doPost` dispatch, add a handler block
  with a `requireRole_` gate for privileged actions, then add sim coverage.
  New UI tabs: register the screen in `app.js` `SCREENS` **and** the restricted
  tab list **and** add the file to `sw.js` `SHELL` (or the offline shell graph
  breaks for installed terminals).

## Security invariants (do not regress)

- Every privileged endpoint calls `requireRole_` before doing work.
- Money routes (payout / payment / refund) are admin/manager-only.
- Purchase receipts write `kind: 'purchase'` ledger rows that never count as
  sales in reports or exports.
- Sessions are revoked on sign-out, PIN change, role change, and admin
  kill-switch; a stolen terminal's device row blocks re-login.
- APP_TOKEN is a Script Property; no secrets are ever committed.