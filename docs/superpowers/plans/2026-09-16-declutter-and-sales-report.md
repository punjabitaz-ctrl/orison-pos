# Plan — a calmer main interface, and a dedicated sales report

**Date:** 2026-09-16 · **Source:** team feedback on the v1.45 demo.

> "The main interface is too cluttered. The products should show under the
> category. User reports should also be more detailed and have a dedicated
> sales report function."

Two sprints, one release each.

## Sprint A — v1.46.0 · A calmer Sell screen

- **Browse by category.** The Sell screen opens on category tiles, each showing
  its name and how many products it holds. Tapping one shows that category's
  products, with a back link to all categories. Search and barcode scans still
  reach every product from any view.
- **Quieter product tiles.** The category label is dropped (you are already in
  the category), leaving name, price and stock.
- **Quieter cart lines.** The six discount buttons on every line are behind a
  per-line *Discount* control; a line with a discount shows it as a chip.
- **Grouped navigation.** The sidebar and the Menu screen group their
  destinations under headings:
  - *Counter:* refund, trade-in, repairs, open drawer
  - *Cash:* paid out, cash pick-up, staff expense
  - *Stock & customers:* customers, products, purchases, sold elsewhere, alerts
  - *Insights:* dashboard, reports, accounts, audit log
  - *Team:* time clock
  - *Settings*

  This replaces one flat list of twenty.

## Sprint B — v1.47.0 · Sales report

- **Menu → Sales report** (managers and admins; a cashier sees their own sales
  only).
  - **Filters:** period, staff member, category, product, payment method,
    channel and customer.
  - **Summary:**
    - sales, refunds and net sales
    - tax, discounts, cost and gross profit with margin
    - transaction count, units and average sale
  - **Group by:** day, staff member, category, product, payment method,
    channel, customer or hour of the day.
  - **The sales themselves:** every sale and refund with receipt number, time,
    staff member, customer, items, discount, tax, total, payment and gross
    profit. Opening one shows its lines.
  - **Export:** CSV of the grouped view or of the sale lines, and a print
    layout.
- `/api/reports/sales` on the backend, with the same money rules as Reports
  and the books. The simulator reconciles its totals with `/api/reports` and
  `/api/accounting`.
- **More detail in Reports:**
  - each staff member's refunds, average sale, items per sale and margin
  - sales by hour of the day
  - a link from every breakdown to the Sales report with that filter applied
