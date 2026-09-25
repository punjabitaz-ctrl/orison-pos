# Orison POS — demo for the team

**Open:** https://punjabitaz-ctrl.github.io/orison-pos/

This is the real Orison POS, with a sample shop called **Orison Electronics – Main Street**. Everything runs in your browser:
- the app
- the same backend code the store deploys to Google Apps Script
- a stand-in for the Google Sheet it keeps its records in

Nothing is sent anywhere, and nothing you do touches the real store.

- **Each browser has its own copy of the shop.** Your sales, customers and changes stay there until you press **Reset demo data**.
- **Two people testing on two devices won't see each other's changes.**
- **It works on a phone, tablet or computer.** On a phone, *Add to Home Screen* installs it like an app.
- **The yellow DEMO tab** at the top of the screen opens the guide at any time. The guide lists the sign-ins, what to try, and the reset button.

## Sign in as

| Role | Name | Email | PIN |
|---|---|---|---|
| Admin | Tariq Al-Sayed | `tariq@example.com` | `246810` |
| Manager | Sarah Lindqvist | `sarah@example.com` | `135791` |
| Cashier | Amara Njoku | `amara@example.com` | `112233` |
| Cashier | Diego Ramirez | `diego@example.com` | `445566` |

The guide's **Sign in** buttons switch account in one tap. When a cashier needs a manager's approval, hand over the screen and type Sarah's email and PIN into the approval box.

## What is already in the shop

- **Stock:** about 50 products across phones, tablets, laptops, audio, gaming, cables and services, plus used phones for trade-ins.
- **Two weeks of sales:** cash and card, a refund, paid out, a cash pick-up and a staff expense.
- **Customers:** six, including **Liberty Phone Repair LLC**, who buy on account and have paid part of their balance.
- **Purchase orders:** one received five weeks ago and part paid (Swift Supplies are still owed $110, now overdue), and one **still on its way** to receive — that one is on 5% trade terms with $35 of tax on the invoice.
- **Today at the counter:**
  - Amara's till shift is open with a $200 float.
  - Three repairs are on the bench: one waiting for an iPhone screen with a $50 deposit (the screen is on the order that is due), a battery job **ready to collect**, and a Pixel waiting for a charge port **nobody has ordered yet**.
  - A trade-in was taken for store credit.
- **Marketplace:** three orders are waiting in the marketplace sheet to import.

## Things to try

**As a cashier (Amara or Diego)**
1. Sell a phone with a case and a screen protector. Start from the categories (Phones, then Accessories), or search. Take card or cash, then print or send the receipt.
2. Give a 20% discount. Cashiers are limited to 10%, so a manager approves it on your screen.
3. Collect James Okafor's battery repair (Repairs), and book a new repair in with a deposit.
4. Open Maya Patel's ticket and look at **Waiting on parts**: the screen says which order it is on and when it is due. Add another part the job needs with *Wait for a part*.
5. Take a trade-in (Menu → Trade-In): pick the seller, the ID checked, the IMEI and the condition. A manager approves the amount.
6. Refund a sale (History). It needs a manager's approval, and services cannot be refunded.

**As the manager (Sarah)**
1. Record paid out, a cash pick-up or a staff expense.
2. Close a till shift and count the drawer. Amara's shift is open.
3. Open Purchases and look at **The bench is waiting for**: the Pixel charge port nobody has ordered. *Order what is short* raises the order and marks that job as on order.
4. Receive the purchase order that is on its way. It is on 5% trade terms with tax on the invoice, so the dialog shows the stock and the tax separately and what the delivery will be owed — and the receipt names the bench job it frees. Open that ticket and **Fit it**.
5. Pay **Swift Supplies**, who are owed $110, all of it overdue: tap the supplier, see their statement, and **Record payment** by bank transfer or cheque.
6. Take a payment from Liberty Phone Repair (Customers).
7. Open **Stock Health** (Menu → Stock & customers): what the shelf is worth at cost and at retail, which lines are slow or dead, and — on the velocity tab — what is selling through fastest. Export either as CSV.
8. Open **Serial Trace** and search an IMEI from a sale (try `353` or a serial on a sold phone): its whole life, from intake to sale to repair.
9. The Dashboard's **Reminders** panel: warranties about to expire, repairs sitting ready for collection, upgrade candidates and unspent store credit.
10. Open the **Sales Report** for the last 30 days: group by staff member, tap one person, open a sale to see its lines, and export the Sales CSV. Then look at Reports, where every breakdown has a *Details* link, and the trade-in register.

**As the admin (Tariq)**
1. Settings → Marketplace orders → **Import now**. Then open the guide → *view the demo sheet* to see each row's Status filled in.
2. Menu → **Accounts**: profit and loss, trial balance and journal, with CSV exports.
3. Open a customer from **Customers** for their profile: what they have spent, every device they own with its warranty, repairs on the bench and collected, and what they owe.
4. Menu → **Payroll**: draft a run for last month, adjust someone's line with a reason, and pay it in cash — then look at Reports and Accounts to see the wage bill land. Everyone already has a rate; *Pay rate* on the Time Clock screen sets it. A manager cannot see any of this.
5. The Audit Log, staff (add a person, reset a PIN), store settings, tax and discount limits.

**Anyone:** switch the language to العربية or اردو on the sign-in screen.

## Different from the real install

- **Drive export** opens the CSV in a new tab instead of saving to Google Drive.
- **Scheduled report emails** are not sent, and **backups** are simulated.
- **The marketplace Google Sheet is built into the demo.** View it from the guide; its *Open sheet* link in Settings does not go anywhere.
- **Receipt printers and cash drawers** need the real hardware. The standard print dialog works.
- **The PINs are fixed and public.** A real install issues random PINs at setup.

## Reporting what you find

Write down:
- the account you were signed in as
- what you did, step by step
- what you expected to happen
- what happened instead

A screenshot helps. Send it to the Orison POS project lead.

## For developers

- **Code:** `demo/` holds the emulator (`gas-emulator.js`), the sample shop (`seed-demo.js`) and the in-page wiring and guide (`boot.js`, `demo.css`).
- **Build:** `npm run build:demo` builds the site into `dist/demo-site`, from `public/` plus `demo/` plus `backend/Code.gs`.
- **Test:** `npm run test:demo` checks the emulator, all four sign-ins, the sample data (the books balance and agree with Reports), and the build.
- **Publish:** `.github/workflows/demo-pages.yml` publishes to GitHub Pages on every push to `main`, so the demo always runs the current code.
