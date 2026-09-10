# Orison POS — Release Notes

Every release is a **tagged commit** on `main` (`vX.Y.Z`), validated before
ship, with docs/assets kept in the same commit. This file highlights the
current release and the run that led here; `CHANGELOG.md` carries the full,
line-by-line detail for every version.

---

## Latest: v1.7.1 — post-review hardening

**2026-09-09.** A full code / process / scope / UX / security review at v1.7.0
surfaced a handful of real defects; this revision closes the ones with teeth
and syncs every doc and asset to the latest number.

**Security**

- Refunds are now **admin/manager only** — a cashier refund previously reached
  the server with no role check and could reverse any sale; it now voids with
  `unauthorized_role` and the client hides the Refund button for cashiers.
- **Role changes revoke sessions immediately** — demotion no longer waits up to
  12 h for the old token to expire.
- `config_()` stops leaking deactivated staff into the device roster.

**Money & ledger**

- The Drive export no longer counts purchase receipts as SALES — deliveries
  stay in the CSV detail rows (`kind: purchase`) but never inflate SALES or NET
  CASH. "A delivery is never drawer math" now holds for reports, shifts, and
  the export.
- Collections (`kind: payment`) net as **money-in**: a new `COLLECTIONS` line
  feeds NET CASH (`sales − refunds − payouts + collections`), and the dashboard
  14-day chart nets them the same way instead of subtracting them.

**Assets & delivery**

- Service worker versioned to **v1.7.1** and precaching `customers.js`,
  `reports.js`, `purchases.js` — installed terminals pinned to the stale v1.2.0
  cache finally upgrade instead of serving an ever-older shell.
- `package.json` / `package-lock.json` versioned to the release line (was
  0.2.1), `test:pdf` wired into `test:all`.
- Docs in lockstep: README, DEPLOY, SECURITY, backend guide, changelog, plus
  new `AGENTS.md` (release protocol) and `HANDOVER.md` (project handover).

**Validation:** backend-sim **PASS 303 / FAIL 0** · pdf-smoke **PASS 19 / FAIL 0** ·
`node --check` clean on every touched client file.

### Deploying v1.7.1

1. Redeploy `backend/Code.gs` as the Apps Script Web App (past the new code in
   the editor, then Deploy → Manage deployments → Update; the new
   `Suppliers` / `PurchaseOrders` tabs auto-create on first use or the next
   `setup`).
2. Confirm Cloudflare Pages is serving `public/` (no build; output directory
   `public`). The PWA is committed from the repo root, so Pages picks up the
   new shell automatically.
3. Terminals update on their next load; if anything looks stale, one hard
   reload clears the old v1.2.0-era cache.

---

## The road here (1.2.3 → 1.7.1)

| Version | What shipped |
| --- | --- |
| **v1.7.0** | Suppliers & **purchase orders** — vendor records, PO lifecycle (draft → ordered → partial/received → cancelled), receiving that posts stock at weighted-average cost with per-unit serial intake and a ledger trail that never touches drawer math. |
| **v1.6.0** | Reports & analytics — KPIs (gross sales, refunds, payouts, collections, net revenue, GP) plus by-day/category/cashier/tender views, top products & customers, CSV export. |
| **v1.5.0** | Till shifts — open with a float, close with a denomination count, *declared / expected / over-short* per cashier, `kind`-aware cash math. |
| **v1.4.1** | Receivables grow teeth — record payments against customer accounts, receivables view, 30/60/90+ aging buckets, net-30 tenders. |
| **v1.4.0** | Customers — attach any sale to a customer account; store-credit and on-account tenders from checkout. |
| **v1.3.1** | Profit visibility — gross profit derived from tracked costs on the reports/overview screens. |
| **v1.3.0** | Staff accounts in-app — create users with a one-time PIN from Settings; role management without hand-editing the sheet. |
| **v1.2.7** | Sync-conflict email alerts — coalesced digest to admin/manager when offline conflicts land. |
| **v1.2.6** | Discounts & sales tax — per-line and per-order percentage discounts, taxable flags, store tax rate, all in integer cents. |
| **v1.2.5** | Offline sign-in hardening — the offline credential no longer stores bare PIN hashes; rotated server-side. |
| **v1.2.4** | Per-device revocation — cut off a single lost terminal without rotating the shared token; v4 UUID seed PINs reshaped. |
| **v1.2.3** | Token revocation + lost-device reflex + strict Content-Security-Policy across the static site. |

Releases before v1.2.3 (`v1.0.x`–`v1.2.2`, tags only) predate the changelog:
core register (catalog, cart, split tender, receipts, serial checkout) and the
first security pass (salted PIN hashes, session tokens, login lockout, offline
credentials, conflict registry). `v0.2.1` was the login-path security release.

## Full changelog

See [CHANGELOG.md](CHANGELOG.md) for the complete, per-version detail.