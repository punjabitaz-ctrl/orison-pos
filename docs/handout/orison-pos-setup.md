# Orison POS — Deployment Guide

**An AYiN Advisors Project** · Live on your domain, installed as an app · ~30 minutes

**1 · Back end — Google Apps Script.** At **script.google.com** create a project, paste all of `backend/Code.gs`, save. In **Project Settings → Script Properties** add `APP_TOKEN` — a long random secret (`openssl rand -hex 32`). Optionally add `SPREADSHEET_ID` and `FOLDER_ID`; omit them and they are created for you. Select the `setup` function and **Run**, approving the Google prompts — this builds the workbook and seeds the catalog. Open **View → Executions**, find the `setup` run, and copy the **one-time 6-digit PIN printed for each starter account**; they are never shown again. Then **Deploy → New deployment → Web app**, Execute as **Me**, access **Anyone**, and copy the **`/exec` URL**. *"Anyone" only means anyone with the URL can reach it — the `APP_TOKEN` is the real gate. Never publish it.*

**2 · Front end — put `public/` on a domain.** These are plain files: no build step, no Node, no server. In Cloudflare Pages choose **Create → Pages → Connect to Git**, pick the repo, set framework preset **None**, leave the build command **empty**, set output directory **`public`**, and deploy. You are live on `*.pages.dev` with HTTPS in about a minute. For your own address, use **Custom domains → Set up a domain**, enter `pos.yourshop.com`, and add the CNAME it gives you at your DNS provider; the certificate is automatic.

**3 · Connect the two.** Open the site, tap **Backend** on the login screen, paste the **`/exec` URL** and the **`APP_TOKEN`**, and save. Sign in with a seeded account and its one-time PIN. Each terminal is configured once.

**4 · First run.** The first admin picks the shop's **language region, country and currency** — eighteen are supported including **USD, GBP, EUR, AED and PKR**, each with the correct notes and coins for counting a drawer. Every figure formats from that choice, and it is changeable later in Settings. Now change every seeded PIN, add real staff under **Menu → Settings**, and deactivate the demo accounts.

**5 · Install as an app.** Android/Chrome: menu **⋮ → Install app**. iPhone/iPad: **Share → Add to Home Screen**, in Safari only. Windows/Mac: the **install icon** in the address bar. It then opens full screen with its own icon and **keeps selling with no internet** — sales queue on the device and sync when the connection returns.

**6 · Customer display (optional).** **Menu → Settings → Customer display → Mirror this terminal**, then **Open display window**, drag it to the customer-facing screen, and press **F11**.

**Updating.** Push to the repo and Cloudflare redeploys; terminals update on next load. **If the back end changed, deploy it first** — paste `Code.gs` into Apps Script and **Deploy → New deployment** — so no terminal sends something the server does not yet understand.

**If something goes wrong.** *"Backend unreachable"* — recheck the URL and token in Settings; the URL must end in `/exec`, not `/dev`. *Old version loading* — the app caches itself, so hard reload once (**Ctrl+Shift+R**). *Locked out* — five wrong PINs lock an account for 15 minutes; an admin clears it in Settings. *Sales not syncing* — check the queued count in **Settings → Sync**; they are safe on the device until the connection returns.

*An AYiN Advisors Project*
