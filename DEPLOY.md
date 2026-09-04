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
shared `APP_TOKEN` (never exposed to end users beyond the one terminal setup).

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
- **Alerting (optional)**: add a small Apps Script **time-driven trigger** (e.g.
  every 10 min) that calls `/api/conflicts` in the script and emails the owner
  when `openConflicts > 0` — cheap, no extra infra.

The Google Sheets file itself is also a live read-only ops view for the owner
(any cell-phone) and follows whoever edits it, in real time, if you want a
web-accessible status page without app load.

---

## Security checklist before going live

- [ ] `APP_TOKEN` is a long random secret; terminals only have it locally.
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

## Common workflows

| Task | How |
| ---- | --- |
| Add a cashier phone | Google-ns it in Access (or hand out OTP) → open `pos.orisonigt.com` → sign in → add to Home screen → paste backend URL + token once. |
| Change sync cadence | Settings → *Offline sync window (minutes)* → Save. Default 30. Sales sync instantly when online. |
| Owner live view | Set cadence to 2–5 min; dashboard reloads on focus/sync. |
| Weekly sales file | Backend → *Export today → Drive* (store-wide for admin/manager). |
| See conflicts | Home → amber banner → Review → Keep winner / Dismiss. |
| Bulk recall/restock | Apps Script `setup` re-seed (writes a backup CSV of transactions to Drive first). |

## Costs (monthly)

| Item | Cost |
| ---- | ---- |
| Cloudflare Pages + Access (≤50 users) | $0 |
| Google Workspace / standard Gmail for SSO | existing / $0 |
| Apps Script + Sheets + Drive | $0 (within generous quotas) |
| TLS (Cloudflare Universal SSL) | $0 |
| Domain | existing `orisonigt.com` |