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
backend/Code.gs          Single-file Apps Script backend (~6,000 lines)
public/index.html        PWA shell
public/js/app.js         Router, session restore, language boot
public/js/api.js         /exec transport (envelope, APP_TOKEN, session, per-call timeouts)
public/js/db.js          IndexedDB layer
public/js/sync.js        Outbox push/pull + VOIDED handling
public/js/cart.js        Cart persistence + availability (never mutates the catalog)
public/js/money.js       Money math, refund groups (services locked)
public/js/nav.js         Navigation model (primaryTabs, menuTiles, isRestricted)
public/js/components.js  Destinations as markup (tile, tileGrid, navButton, appHeaderHtml)
public/js/money-dialogs.js  drawer-dialog.js   Dialogs the launcher opens directly
public/js/approval-dialog.js  Manager approval prompt (own layer above any dialog; requestApproval())
public/js/warranty.js    Warranty options, status chip and the Check warranty lookup
public/js/stats.js       Shared aggregation (day totals, trends, hourly buckets, top sellers, hours)
public/js/labels.js      Code 128-B encoder + shelf-label markup
public/js/print-sheet.js Full-page printing (labels, worksheets, receipts on a standard printer)
public/js/lang.js        $t / $tn / N_ / tIn, plurals, dir, dateLocale, arrow
public/js/lang/ar.js  lang/ur.js   Translation catalogues (English text is the key)
public/js/receipt-doc.js  receipt-labels.js  receipt-render.js   One receipt model → roll HTML, page HTML, canvas
public/js/escpos.js  printer.js  printing.js   ESC/POS bytes; printer decisions (no DOM); browser wiring
public/js/customer-display.js  Register side of the second-screen mirror
public/display.html + public/js/display.js + public/css/display.css   The customer-facing display
public/js/screens/*.js   login menu register checkout history customers repairs reports purchases inventory
                         inventory-tools external-sale alerts dashboard staff audit settings printer-settings store-setup
public/js/receipt-send.js  Receipt PDF / WhatsApp / email (PDF hidden for scripts Courier cannot carry)
public/css/style.css     UI (logical properties for RTL) + @media print receipt modes
public/sw.js             Service worker (VERSION bumped every release; SHELL lists every module)
tests/backend-sim.mjs    Backend logic suite against an in-memory Apps Script mock
tests/client-*.mjs       Client suites (incl. lang catalogues, nav, printer, escpos, repairs)
tests/e2e.mjs            Headless E2E (needs a freshly-seeded live backend)
tests/pdf-send-smoke.mjs Receipt PDF/share smoke test
docs/superpowers/        specs/ (designs, reviews) and plans/ (one per release program)
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
node tests/pdf-send-smoke.mjs     # receipt PDF/share — unrunnable on the current dev machine (Edge headless); report it as NOT RUN, never as a pass
npm run test:client               # client unit tests, incl. the translation-catalogue check
node tests/demo-build.mjs         # the demo: Code.gs on the in-browser emulator, sample shop, site build
```

Baseline at v1.45.0: backend-sim **983 / 0**, client **493 / 0**, demo **28 / 0**.

- The demo (`demo/`, published by `.github/workflows/demo-pages.yml`) runs the
  current `backend/Code.gs` in the browser. A Code.gs change that uses a Google
  service or method the emulator lacks (see `demo/gas-emulator.js`) breaks the
  demo: extend the emulator in the same commit. New demo files must be tracked
  by git, because the build only copies tracked files.

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
- **Never hard-code a currency symbol or a cash denomination.** Money prints
  through `fmt()` (store locale + currency, installed at boot/login/pull);
  a currency symbol in a label comes from `currencySymbol()`, a note or coin
  from `denomLabel()`, and the ladder itself from `store.denoms`.
- **Screen structure comes from `components.js`.** Headers, section heads, stat
  rows, rank rows and tables have shared builders; do not hand-roll that markup
  in a screen. Text fields are escaped by default — use the explicit `*Html`
  field when a screen genuinely composes markup.
- **Navigation is data.** Add a destination to `public/js/nav.js`; never paste a
  button into `index.html`. Both navs and the launcher render from that model,
  and role gating comes from `isRestricted`, not a hard-coded id list.
- New backend endpoints: register in `dispatch_`, add a handler block with a
  `requireRole_` gate for privileged actions, call `logAudit_` for anything an
  owner would want to trace, then add sim coverage. Update the route table in
  `SECURITY.md` and the matrix in the roles review.
- New UI screens: register the screen in `app.js` `SCREENS`, add the
  destination to `nav.js` with its roles, **and** add every new module to
  `sw.js` `SHELL`. A guard test walks the import graph and fails if one is
  missing — an offline till otherwise cannot boot after an update.
- **Every string a person reads goes through `lang.js`.** `$t('English text')`,
  `$tn(one, other, n)` for counts, `N_()` to mark strings stored as data,
  `tIn(storeLanguage(), …)` on receipts and the customer display. Never call
  `$t` at module scope (catalogues load asynchronously) and never name a local
  `t`. Add the new key to **both** `lang/ar.js` and `lang/ur.js`; the catalogue
  test fails on anything missing, stale, untranslated or with a dropped
  placeholder.
- **RTL:** use logical CSS properties (`margin-inline-start`, `inset-inline-end`,
  `text-align: start`), never left/right. Money on screen goes through `fmt()`
  (it isolates itself in RTL); receipts use `fmtFor(doc.dir)`; anything that
  must stay ASCII (CSV, ESC/POS text, the PDF) strips isolates.

## Security invariants (do not regress)

- Every privileged endpoint calls `requireRole_` before doing work.
- Money routes (refund / payout / pickup / expense / payment, deposit refund,
  no-sale drawer open) are admin/manager-only — except that refund, drawer and
  deposit refund accept a cashier carrying a valid manager approval
  (`verifyApproval_`). Never let an approval verify as a session, never answer a
  failed approval with 401, and bind every approval to a reference chosen
  before it was requested.
- Sales over the seller's discount limit need a `discount` approval; the
  limit is checked server-side on the deepest effective line discount. Net-30
  past a customer's `credit_limit` needs a `credit` approval. Read approvals
  through `approvalFor_(tx, action)` — a sale may carry several.
- A customer's money is computed in one place, `customerMoney_`. Don't add a
  second copy of that arithmetic.
- **Tax can be inclusive.** `saleTotals_` / `saleTotals` take an `inclusive`
  flag (the store's `pricesIncludeTax`); never compute tax as `rate × subtotal`
  inline. A sale's revenue before tax is `saleNetExTax_(row)`; use it for any
  profit figure. Receipt tax wording comes from `taxRules(store)` in
  `receipt-labels.js`.
- `deposit` and `deposit_refund` are server-written only; a device can never
  push them or tender `deposit`.
- Services are never refundable (`service_not_refundable`), checked first.
- Admin-only stays admin-only (v1.23.0 owner decision): staff, PINs, terminals,
  store settings, suppliers, PO cancel, bulk price, stock take, repair void,
  backups, scheduled reports, audit log.
- Purchase receipts write `kind: 'purchase'` ledger rows that never count as
  sales in reports or exports.
- Sessions are revoked on sign-out, PIN change, role change, and admin
  kill-switch; a stolen terminal's device row blocks re-login.
- APP_TOKEN is a Script Property; no secrets are ever committed.