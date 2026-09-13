# Orison POS — Deployment Guide

**An AYiN Advisors Project** · Live on your domain, installed as an app · ~30 minutes

**1 · Back end — Google Apps Script.** At **script.google.com** create a project, paste all of `backend/Code.gs`, save. In **Project Settings → Script Properties** add `APP_TOKEN` — a long random secret (`openssl rand -hex 32`). Select the `setup` function and **Run**, approving the Google prompts — this builds the workbook and seeds the catalog. Open **View → Executions**, open the `setup` run, and copy the **one-time 6-digit PIN printed for each starter account**; they are never shown again. Run `installBackupTrigger` and `installReportTriggers` once each. Then **Deploy → New deployment → Web app**, Execute as **Me**, access **Anyone**, and copy the **`/exec` URL**. *The `APP_TOKEN` is the real gate — never publish it.*

**2 · Front end — put `public/` on a domain.** Plain files: no build step, no server. In Cloudflare Pages choose **Create → Pages → Connect to Git**, pick the repo, framework preset **None**, build command **empty**, output directory **`public`**, and deploy. Live on `*.pages.dev` in a minute; add your own address under **Custom domains**.

**3 · Connect the two.** Open the site, tap **Backend** on the sign-in screen, paste the **`/exec` URL** and the **`APP_TOKEN`**, and save. Pick a language — **English, العربية or اردو** — and sign in with a seeded account and its PIN.

**4 · First run.** The first admin picks the shop's **language, country and currency** — eighteen currencies including **USD, GBP, EUR, AED and PKR**, each with its real notes and coins. Change every seeded PIN, add real staff under **Settings → Staff**, deactivate the demo accounts, and switch on **Scheduled reports** if wanted.

**5 · Printer and drawer.** On each till: **Settings → Printer & cash drawer** — a receipt printer, an office printer, or a **Bluetooth** receipt printer (Chrome or Edge; not iPhone/iPad), which is also what opens the cash drawer. Print a test receipt and test the drawer.

**6 · Install as an app.** Android/Chrome: **⋮ → Install app**. iPhone/iPad: **Share → Add to Home Screen** in Safari. Windows/Mac: the install icon in the address bar. It **keeps selling with no internet**.

**7 · Customer display (optional).** **Settings → Customer display → Mirror this terminal**, **Open display window**, drag it to the customer-facing screen, press **F11**.

**Updating.** Push to the repo and Cloudflare redeploys; terminals update on next load. **If the back end changed, deploy it first** — paste `Code.gs`, then **Manage deployments → Edit → New version**.

**If something goes wrong.** *"Backend unreachable"* — recheck URL and token; the URL ends in `/exec`. *Old version loading* — hard reload once (**Ctrl+Shift+R**). *Locked out* — wait 15 minutes, or an admin runs `clearLoginLockout` in Apps Script. *Sales not syncing* — they stay safe on the device; see **Settings → Sync**.
