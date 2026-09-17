# Session handoff — 2026-09-17

Written before compacting a long working session, for whoever (or whatever)
picks this up next. `HANDOVER.md` is the standing project handover and stays
canonical; this file is the *session* context that would otherwise be lost:
what was built in what order, why, the workflows used, and the traps hit.

## Where things stand

| | |
|---|---|
| Repo | `punjabitaz-ctrl/orison-pos` (public), branch `main` |
| Version | **v1.48.0**, tagged and pushed (`d21af95`) |
| Gates | backend-sim **1066 / 0** · client **538 / 0** · demo **29 / 0** |
| Demo | **https://punjabitaz-ctrl.github.io/orison-pos/** — redeploys itself on every push to `main` |
| Real store | **Not deployed.** No Apps Script deployment exists yet |
| Working tree | clean except the untracked `public/js/i18n.js` and `public/locales/` — **not mine, leave them alone, never `git add -A`** |

**The store's deployment is the one thing blocking real use.** Everything from
v1.41.0 onwards needs a backend redeploy, plus `installBackupTrigger()`,
`installReportTriggers()` and `installMarketplaceTrigger()` run once each. See
`DEPLOY.md`.

## What this session built, in order

Each is a tagged release on `main` with docs updated in the same commit.

| Release | What, and why |
|---|---|
| v1.42.0 | Marketplace orders imported from a Google Sheet (owner: a sheet, not a platform API) |
| v1.43.0 | In-app GAAP accounting: `/api/accounting`, Accounts screen. **Fixed** Reports gross profit on refunds (it subtracted cost, not margin) |
| v1.44.0 | Trade-ins. Owner said yes to trade-in, no to layaway. Cost basis is the price paid, per IMEI (`Serials.cost` / `source`); resale capped at 30 days' warranty |
| v1.45.0 | **The team demo**: `backend/Code.gs` runs in the browser on an emulator of Google's services, with a seeded sample shop, published to GitHub Pages. **Fixed** `sync.pull()` never storing products (since v1.1.0) |
| v1.45.1 | The register cart floats at the right, sized to its contents (Charge could fall below the fold) |
| v1.46.0 | Team feedback: category-first Sell screen, folded discounts, grouped navigation. **Fixed** nav/header built once for the boot-time role |
| v1.46.1 | Icons on the category tiles (asked for mid-sprint) |
| v1.47.0 | Dedicated **Sales report** (`/api/reports/sales`) with line-level money, and more detail in Reports |
| v1.48.0 | **Supplier payments**: payables, statements, payments, voids. **Fixed** managers could not open Purchases |

Plans behind them: `docs/superpowers/plans/2026-09-13-warranty-marketplace-accounting-program.md`
and `docs/superpowers/plans/2026-09-16-declutter-and-sales-report.md`.

## How work is done here (the protocol that is actually followed)

From `AGENTS.md`, and it has been followed release by release:

1. **One feature per tagged release on `main`.** No feature branches.
2. **Every gate green before committing:**
   ```bash
   node tests/backend-sim.mjs        # backend logic
   npm run test:client               # client units + translation catalogues
   node tests/demo-build.mjs         # the demo and its site build
   node --check <each touched client file>
   ```
   `tests/pdf-send-smoke.mjs` cannot run on this machine — report it NOT RUN, never as a pass.
3. **Docs in the same commit:** CHANGELOG, RELEASE_NOTES, HANDOVER, README, DEPLOY, SECURITY, `backend/README.md`, AGENTS baseline counts, and any plan/spec the work closes.
4. **Bump three places:** `public/sw.js` VERSION, `package.json` line 3, `package-lock.json` lines 3 and 9.
5. **Stage files by name** (never `-A`), then `git push origin main --tags`.
6. **New client module → add it to the SW `SHELL` list.** New user-visible string → translate it in both catalogues.

### Translations (tooling now lives in the repo)

It used to live only in a temp scratchpad. It is now `scripts/i18n/`, and a
rebuild reproduces the shipped catalogues byte for byte:

```bash
node scripts/i18n/collect-keys.mjs . scripts/i18n/keys.json
python scripts/i18n/build-catalogues.py ar          # report what is missing/extra
python scripts/i18n/build-catalogues.py ar --write  # write public/js/lang/ar.js
```

- A release's new strings go in a **new** parts file: `scripts/i18n/parts/ar_18.json` and `ur_18.json` next (17 is used).
- Plurals must be objects: Arabic needs `zero one two few many other`, Urdu `one other`.
- A string the app stopped using must be **deleted from its part**, or the catalogue test fails on "carries nothing the app no longer uses".

### The demo

```bash
npm run build:demo   # dist/demo-site, from public/ + demo/ + backend/Code.gs
npm run test:demo
```

- `demo/gas-emulator.js` implements the Google services `Code.gs` calls (Sheets, Properties, Cache, Lock, Utilities with synchronous SHA-256/HMAC, Drive, Mail, triggers) over localStorage.
- **A `Code.gs` change that reaches for a Google service or method the emulator lacks breaks the demo** — extend the emulator in the same commit.
- `demo/seed-demo.js` builds the sample shop through the real API routes.
- Demo sign-ins (public on purpose): admin `tariq@example.com` / `246810`, manager `sarah@example.com` / `135791`, cashiers `amara@example.com` / `112233` and `diego@example.com` / `445566`.
- **A browser that already opened the demo keeps its old sample shop.** After changing the seed, testers must press *Reset demo data*.

### Checking changes in a browser

The local demo server is the quickest honest check (it has a working backend):

1. `.claude/launch.json` **in the parent folder `F:\ClaudeCode`** holds `orison-pos-demo` (port 8090, serving `dist/demo-site`). The repo's own `.claude/launch.json` only has the plain `orison-pos` static server, which has no backend.
2. After a rebuild, in the page: delete the caches, unregister the service worker, then reload — otherwise the service worker serves the previous build.
3. Sign in by driving the demo guide: `window.ORISON_DEMO.openGuide('home')` then click `[data-acct="0|1|2|3"]`.

## Traps hit this session (all fixed, all worth remembering)

- **`csvCell` prefixes a leading `-` with an apostrophe.** Money must be written raw in CSV or refunds become text in the spreadsheet. Text still goes through `csvCell`.
- **The app's scroller is `#screen`, not the window.** Anything about scroll position or a floating element's bounds must measure that element.
- **The nav and header were built once, for whoever was signed in at boot.** They now rebuild when the user changes (`whoKey()` in `app.js`).
- **An unawaited `async` helper** (`mergeProducts`) silently broke every sync pull since v1.1.0, hidden because the sign-in screen swallows pull errors. The demo is what exposed it.
- **Role checks on a list route can break a whole screen**: Purchases loaded the supplier list, which was admin-only, so managers got a blank screen.
- **Never chain `git commit ... ; git tag ... ; git push`** after a step that can fail. A failed doc edit once tagged and pushed an empty `v1.42.0` on the previous commit; it had to be deleted from GitHub. Use `&&` the whole way.
- **Bash heredocs and apostrophes/backticks fight**: write Python/JS helpers to a scratchpad file and run the file.
- **Windows checkout is CRLF**: `git` prints LF→CRLF warnings on every add. Harmless.
- **Tests must be checked by mutation.** Several passed first time; deliberately breaking the rule (change kept as cash, per-IMEI cost, overdue, cent splitting) proved they bite. Two didn't, and were strengthened.

## Money rules the whole codebase now shares

Change these in one place only, and reconcile in the simulator:

- `saleTotals_` — the one money engine (line discount, order discount, tax inclusive/exclusive).
- `saleNetExTax_` — what a sale earned before tax.
- `refundSplit_` — a refund's tax share of its original; Reports gross profit and the books both use it.
- Cost is the cost **captured on the line at sale**, falling back to the product's cost; a traded-in serial carries its own.
- Change handed back is never cash kept (Accounts, Sales report, drawer).
- `/api/accounting` is derived from the ledger, never stored, and the simulator checks it balances and agrees with `/api/reports`.

## Open follow-ups

**Owner decisions already made — do not re-litigate:** no gift cards, no
per-role permission switches, no layaway, no accounting platform (in-app GAAP
instead), marketplace via a Google Sheet, warranty 30 days or 1 year for
brand-new hardware, trade-in cost basis = price paid.

Nothing is queued by the owner. Candidates, in the order I would take them:

1. **Purchase discounts and tax into payables.** A delivery is owed at the line
   costs; a PO's discount and tax are ignored, so a 5%-discount order shows ~5%
   more owed than the supplier will invoice.
2. **Paying a supplier before delivery** (prepayment/credit) is refused today.
3. **A native speaker's review of the Arabic and Urdu**, which no one has done.
4. **A real printer and cash-drawer test** on the shop's hardware.
5. **A tax adviser's read of the UAE invoice wording** (v1.40.0).
6. `docs/DEMO.md` still says to send findings to "the Orison POS project lead" —
   put a real name or address there before handing it to the team.

## Map of the less obvious files

| Path | What |
|---|---|
| `backend/Code.gs` | The whole backend, ES5, ~8k lines. Routed from `dispatch_` |
| `tests/backend-sim.mjs` | Runs Code.gs in `node:vm` against an in-memory Sheets mock |
| `demo/` | The in-browser backend, sample shop and demo guide |
| `scripts/build-demo.mjs` | Builds the demo site from **git-tracked files only** |
| `scripts/i18n/` | Key collector, catalogue builder, and the translation parts |
| `public/js/nav.js` | One model for the sidebar and the Menu, grouped |
| `public/js/catalog.js` | The Sell screen's category/search view logic (pure) |
| `public/js/screens/salesreport.js` | Sales report, with pure exported helpers that are tested |
| `.github/workflows/demo-pages.yml` | Tests and publishes the demo on every push |
