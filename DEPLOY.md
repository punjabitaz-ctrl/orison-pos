# Deploying to `pos.orisonigt.com` — behind Google login, accessible worldwide

Goal: the PWA served at **https://pos.orisonigt.com**, gated by **Google sign-in**,
reachable from anywhere, with up-to-date business data and a default sync
cadence of **30 minutes** (configurable per terminal).

Architecture:

```
Cashier/owner phone  ──HTTPS──▶ pos.orisonigt.com (Cloudflare edge: Google SSO shield)
                                      │  serves static PWA shell
Owner's device  ◀──same PWA dashboard──┤  (charts, KPIs, conflicts, Drive export)
        PWA ──POST /exec (JSON envelope)──▶ Apps Script Web App (Google Sheets + Drive)
```

The Apps Script backend stays the single source of truth. The web app is
protected by the Google-SSO shield; the backend is additionally gated by the
shared `APP_TOKEN`, which is entered once per terminal and stays readable on
that terminal (see the security checklist below).

---

## Recommended: Cloudflare (Pages + Access) — $0, Google SSO at the edge

### A. Stand up the static site — Git-connected auto-deploy

1. **Connect the repo**:
   - Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
   - Authorize GitHub, pick **orison-pos**, branch **main**.
   - **Production branch:** `main` · **Framework preset:** None · **Build command:**
     *(leave empty)* · **Build output directory:** `public`.
   - Project name suggestion: `orison-pos`.
   - First deploy finishes in ~1 minute. Your site is instantly live at
     `<project-name>.pages.dev` with free TLS, no DNS work — hardware staff
     terminals can start using that URL today.

2. **Wiring the custom domain** (do this when you're ready — not required to start):
   - Pages → project → **Custom domains → Set up a custom domain** →
     `pos.orisonigt.com` → create the `CNAME` Cloudflare shows you (or point
     the whole zone at Cloudflare so TLS is automatic).
   - **Desired:** enable **Always Use HTTPS**; Universal SSL covers the zone.

3. **Optional: Cloudflare Access** (free ≤50 users) — gate `pos.orisonigt.com`
   behind **Google sign-in** so no uninvited device ever gets the PWA shell:
   - Zero Trust dashboard → **Access → Applications** → add application:
     domain `pos.orisonigt.com`, path **`/*`**, session duration (e.g. 24 h).
   - **Add a policy** → Include → **Select Google** as the identity provider
     (or "Emails containing `@orisonigt.com`", stricter).
   - Result: visiting `pos.orisonigt.com` forces a Google sign-in before any
     byte of the app or its cached shell is delivered.

4. **Optional deep control**: protect only the owner path with a stricter
   policy (e.g. `/` open to staff, `/dashboard` admin-only), or split paths:
   `Access → Policies` — each path can have its own rule.

5. **Lock down the backend on top**: the Apps Script stays a Web App with
   *Execute as Me / Anyone* access but the `APP_TOKEN` is set as a Script
   Property. Anyone with the URL but no token gets `401`, even logged-in
   Google users. Keep the token per terminal install.

> **New network each time?** Use the Access **one-time PIN (OTP)** setting
> instead of / in addition to policies — staff type a verification code shown
> by the owner. Keeps the store LAN-style hard to abuse from a rogue device.

---

## Alternative: Google Cloud IAP (if you already live in Google Cloud)

- Host the static site on **Cloud Run** (a tiny `nginx`/static container or
  the `gcr.io/…/static` image) and put **Identity-Aware Proxy** in front.
- IAP gives native **Google sign-in** for anyone on your Google Workspace
  domain, with per-user access lists.
- Roughly the same shape, but you manage GCP billing/setup instead of
  Cloudflare's free tier. Pick Cloudflare unless you're already on GCP.

---

## The demo site (for testing, not the store)

`.github/workflows/demo-pages.yml` publishes the demo to GitHub Pages
(https://punjabitaz-ctrl.github.io/orison-pos/) on every push to `main`. It
has no server and holds no store data: see `docs/DEMO.md`.

- **Pages setting:** repository **Settings → Pages → Source: GitHub Actions**.
  This is already set.
- **To take the demo down:** set that source to *None*, or disable the
  workflow.
- **Keep it separate.** Do not host the demo on the store's own domain.

## Pointing the PWA at the backend

On first launch (behind the Google shield) tap **Backend** on the login
screen and enter:

- **Deployment URL** — the Apps Script `/exec` URL from `backend/README.md`
- **App token** — matches the `APP_TOKEN` Script Property

The app stores both in its local IndexedDB; no server echoes them. One
terminal = one pasted token. To rotate the token later, change the Script
Property and re-enter it in **Settings → Backend** on each device.

---

## Real-time view of business operations

"Real time" over an offline-first PWA ≈ push-synced per terminal + pull clock
on the dashboard. What's wired in already:

- **Auto-sync**: a sale is pushed **the instant it's completed when the
  terminal is online**. If the device is offline it queues locally; the
  **30-minute window (default)** in Settings is the offline fallback — sales
  also flush on the `online` event, on tab focus, and at the window tick.
  Dashboard refreshes on focus and after every sync.
- **Live dashboard**: the Home screen reloads on every sync event and page
  focus. Set the *owner's* terminal cadence to 2–5 minutes for near-live
  store KPIs (revenue today, 14-day chart, top sellers, low stock, open
  conflicts).
- **Conflict review**: multi-terminal disagreements (two devices sold the
  same IMEI, duplicate id pushes, bad device clocks) appear immediately as
  an amber banner on the Home screen of admin/manager logins → **Review** →
  *Keep winner* or *Dismiss*. Pull responses also carry `openConflicts` so
  stale devices see the count.
- **Daily sales report**: admin/manager export the store day to Drive; each
  **cashier can also pull their own day report** (scoped server-side) from
  the dashboard.
- **Scheduled reports** (v1.26.0): after `installReportTriggers()` is run once,
  an admin sets recipients and switches on daily / weekly / monthly emails in
  Settings → Scheduled reports. Every cadence ships **off**.
- **Nightly backups** (v1.24.0): after `installBackupTrigger()` is run once, a
  copy of the workbook lands in Drive → **POS Backup** at 02:00. Admins see
  the last result and can back up on demand in Settings → Backups.
- **Alerting (not built)**: nothing emails on an exception such as an open
  conflict, a large over/short or low stock. A small time-driven trigger
  could do it; see the roles and gaps review.

The Google Sheets file itself is also a live read-only ops view for the owner
(any cell-phone) and follows whoever edits it, in real time, if you want a
web-accessible status page without app load.

---

## Security checklist before going live

- [ ] `APP_TOKEN` is a long random secret; terminals only have it locally.
      The app never displays it (v1.36.0), but it is in each terminal's
      storage — treat every terminal as holding it.
- [ ] If a marketplace sheet is used: it is shared with the account that runs
      the Apps Script, its link is saved in Settings, and
      `installMarketplaceTrigger()` has been run.
- [ ] `setup`, `installBackupTrigger` and `installReportTriggers` have each
      been run once from the Apps Script editor, and the seeded PINs were
      collected from **View → Executions** and changed.
- [ ] The Google Sheet is shared with nobody who does not need it — a hand
      edit bypasses every role check and the audit log.
- [ ] Apps Script **Execute as = Me** (data lives under your account, not the
      anonymous caller's).
- [ ] Cloudflare Access policy restricted to `@orisonigt.com` (or an IAM list
      from the domain) — no "everyone on the internet" passes.
- [ ] Custom domain has **Always Use HTTPS** and (Cloudflare) Universal SSL
      covering `pos.orisonigt.com`.
- [ ] Receipts (Share/Print) don't leak POS URLs; the share dialog only dumps
      receipt text.
- [ ] Turn on **session duration** in Access (default fine) so a lost phone
      can't stay logged in forever; the POS PIN tile still guards the app
      itself.
- [ ] Re-run `node tests/backend-sim.mjs` after backend changes (green bar
      above is the contract).
- [ ] After any release, the service-worker `VERSION` was bumped and the
      changelog/docs were updated in the same commit (see `AGENTS.md`) so
      installed terminals upgrade instead of serving a stale shell.

## Common workflows

| Task | How |
| ---- | --- |
| Add a cashier phone | Google-ns it in Access (or hand out OTP) → open `pos.orisonigt.com` → sign in → add to Home screen → paste backend URL + token once. |
| Change sync cadence | Settings → *Offline sync window (minutes)* → Save. Default 30. Sales sync instantly when online. |
| Owner live view | Set cadence to 2–5 min; dashboard reloads on focus/sync. |
| Today's sales file | Dashboard → *Export today → Drive* (store-wide for admin/manager, own rows for a cashier). |
| Daily numbers & GP | Reports → Today/Week/Month/Custom presets → CSV export (admin/manager). |
| What sold, by whom | Menu → *Sales Report* — pick a period and filters (staff, category, product, payment, channel, customer), group the breakdown, open a sale to see its lines; *Summary CSV*, *Sales CSV* (line by line) or *Print*. Cashiers see their own sales. |
| The books | Menu → *Accounts* (admin) — period presets; P&L, trial balance, balance movements, journal; *Journal CSV* / *Trial balance CSV* for the accountant. "Books balance" should always show; Accounts payable falls as supplier payments are recorded. |
| Pay a supplier | Purchases → tap the supplier → *Record payment* — bank transfer or cheque (with its reference) or cash from the till, for one order or on account. An order's detail has a *Pay* button. An admin can *Void* a payment from the statement. |
| Reports by email | Settings → *Scheduled reports* (admin) — recipients + daily/weekly/monthly switches. Needs `installReportTriggers()` run once. |
| Add a supplier | Purchases → Suppliers → *Add supplier* (**admin only** since v1.23.0). |
| Order stock | Purchases → *New PO* → lines with quantities + unit costs → Save draft / Place order (admin/manager). Cancelling a PO is admin only. |
| Receive a delivery | Purchases → order → *Receive* → enter what arrived (serials for serialized lines); the dialog shows what the delivery will be owed (stock + tax) before you post. Stock comes in at the order cost **less the order's discount**; the order's tax is owed to the supplier but reclaimed, not added to stock cost. Deliveries of one order always add up to the order's total. |
| Pay a bill | Menu → *Running Costs* → *Record a cost* — pick the category, the amount, who was paid and how (cash from the till, transfer or cheque). Petty cash out of the till is still *Paid Out* / *Staff Expense*. An admin can void one entered twice. |
| Bank the takings | Menu → *Bank the Cash* — shows what has been picked up and not yet banked, and records the deposit against its paying-in slip. Cash reaches the bag through a *Cash Pick Up*. |
| Say what the shop started with | Menu → *Accounts* (**admin only**) — it prompts until they are set. Enter what was in the till and the bank; the stock figure is offered from the shelf at cost. **Do this before the first trading day.** Wrong? Void it with a reason and enter it again. |
| Set what someone is paid | Time Clock → the team table → *Pay rate* (**admin only**) — by the hour or a monthly salary. Nobody without a rate appears on a pay run. |
| Pay the team | Menu → *Payroll* (**admin only**) → *New pay run* → pick the period → adjust any line with a reason → *Pay this run* (cash from the till, bank transfer or cheque). Cash comes off the drawer count. An admin can void a run entered twice. Overtime, gratuity and any withholding go on as adjustments — the app does not calculate them. |
| A job waiting for a part | Repairs → ticket → *Waiting on parts* → *Wait for a part*. It reserves nothing; it records what the job needs. Purchases → *The bench is waiting for* → *Order what is short* raises the order and marks those jobs. When the stock lands, the receipt names the jobs it frees, and *Fit it* on the ticket puts the part on the job. |
| An order on trade terms | Put the discount and the invoice tax on the order when you raise it (*New PO* → Discount %, Tax). What the supplier is owed then matches their invoice. If the shop cannot reclaim purchase tax, leave Tax at zero and build it into the line costs instead. |
| Reprice / count stock | Products → Tools → *Bulk price* or *Stock take* (**admin only**). |
| See why a price changed | Products → 📈 on any item (admin/manager). |
| Send a customer their statement | Customers → ledger → *Statement* (admin/manager). |
| Set a customer's credit limit | Customers → the customer → *Set credit limit* (admin/manager). 0 means none; going over at the till needs approval. |
| Check a return rung on another till | History → tick *Whole shop* → search the receipt number or IMEI (any cashier). |
| See what's sat in stock too long | Products → *Aging* (admin/manager). |
| Value the shelf & find dead stock | Menu → *Stock Health* (admin/manager) — valuation at cost and retail, and what is slow or dead over 30/90/180/365 days; CSV export. |
| Refund a sale | History → the sale → *Refund items*. A cashier's refund asks a manager to approve on the spot; **services are never refundable**. |
| Approve at the till | When a cashier's screen asks for approval, the manager types **their own** email and PIN. It needs a connection. |
| Trade in the UAE | Settings → Store → *Tax jurisdiction* → United Arab Emirates (admin): 5 % VAT included in prices. Enter the shop's 15-digit TRN, set the currency to AED, and add TRNs to business customers (Customers → *Credit limit & TRN*). Receipts print as a Tax Invoice. |
| Change discount limits | Settings → Store → *Discount limits* (admin). Defaults: cashier 10 %, manager 50 %. |
| Check a warranty | Repairs → *Check warranty* → scan the IMEI or type the receipt number (any role). |
| Set a product's warranty | Products → ⚙ on the item → *Warranty*: 1 year (brand-new hardware), 30 days or none (admin/manager). Applies to future sales. |
| Book in a repair | Menu → *Repairs* → *Book in a repair* (any role) — device, fault, condition, optional deposit. Parts, labour, status and collection from the ticket. Giving a deposit back is admin/manager; voiding a ticket is admin. |
| Buy a used device (trade-in) | Menu → *Trade-In* → *Buy a device* — seller (customer), ID checked + last characters, product (must be tracked by IMEI), IMEI, condition, amount, cash or store credit. A cashier hands the terminal to a manager to approve. Pay cash from the drawer; the register is below for managers. |
| Import marketplace orders | Put orders in the Google Sheet's **Orders** tab (Order ref, Date, Channel, SKU, IMEI / Serial, Quantity, Unit price; leave Status empty). Settings → *Marketplace orders* → *Import now*, or wait for the hourly run. Errors are written into the Status column — fix the row, clear Status, run again. |
| Record an online / marketplace sale | Menu → *Sold Elsewhere* (admin/manager) — channel + order reference; stock moves like any sale. |
| Open the drawer without a sale | Menu → *Open Drawer* — reason required, written to the audit log; a cashier needs a manager's approval. Needs a Bluetooth receipt printer with the drawer attached. |
| Set up a printer | Settings → *Printer & cash drawer* on each terminal — receipt printer (print dialog), standard printer, or Bluetooth (Chrome/Edge, not iPhone/iPad). Print a test receipt and test the drawer. |
| Change the language | Sign-in screen, or Settings → *Language* per terminal (English / العربية / اردو). Receipts follow the store's language (Settings → Store, admin). |
| Add, edit or switch off staff / reset a PIN | Settings → *Staff* (admin) — *Edit* changes name, email and role; *PIN* sets a new one; *Off* signs them out everywhere. |
| Someone is locked out / forgot their PIN | Menu → *Time Clock* → *Team* → *Unlock*, or *Reset PIN* (a manager resets cashiers; an admin resets anyone). |
| Fix a missed clock-out | Menu → *Time Clock* → *Team punches* → *Correct* — reason required, original times kept in the audit log. |
| A shift was left open | Menu → *Time Clock* → *Shifts still open* → *Close shift* — count the drawer if you can, reason required. |
| Lost or stolen terminal | Settings → *Security* (admin) → list the person's terminals → revoke the one that is gone, or revoke all. |
| Who did what | Menu → *Audit Log* (admin) — filter by action, export CSV. |
| See conflicts | Dashboard → amber banner → Review → Keep winner / Dismiss (admin/manager). |
| Restore from a backup | Drive → **POS Backup** → pick the copy → set its id as `SPREADSHEET_ID` in Script Properties. Terminals must sync again; anything sold after the copy was taken is not in it. |

## Costs (monthly)

| Item | Cost |
| ---- | ---- |
| Cloudflare Pages + Access (≤50 users) | $0 |
| Google Workspace / standard Gmail for SSO | existing / $0 |
| Apps Script + Sheets + Drive | $0 (within generous quotas) |
| TLS (Cloudflare Universal SSL) | $0 |
| Domain | existing `orisonigt.com` |