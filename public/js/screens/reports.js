'use strict';

/* Reports: store-wide analytics for a date window, manager/admin only.
   Everything is computed server-side from the ledger — this screen never
   trusts cached client state for numbers that go into a decision. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { fmt, esc, toast, beep } from '../ui.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'custom', label: 'Custom' },
];

function keyOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function rangeFor(preset, from, to) {
  const today = new Date();
  if (preset === 'today') return { from: keyOf(today), to: keyOf(today) };
  if (preset === 'week') {
    const d = new Date(today);
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return { from: keyOf(d), to: keyOf(today) };
  }
  if (preset === 'month') {
    const y = today.getFullYear();
    const m = today.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    return { from: keyOf(first), to: keyOf(last) };
  }
  if (preset === '30d') {
    const d = new Date(today);
    d.setDate(d.getDate() - 29);
    return { from: keyOf(d), to: keyOf(today) };
  }
  return { from, to };
}

export const screen = {
  id: 'reports',
  tab: 'reports',
  title: 'Reports',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const { state } = ctx;
    const user = state.user || (await idb.get('meta', 'config'))?.user || {};
    if ((user.role || 'cashier') !== 'admin' && (user.role || 'cashier') !== 'manager') {
      root.innerHTML = `<div class="empty"><p>Managers and admins only.</p></div>`;
      return;
    }

    let preset = '30d';
    let from = '';
    let to = '';
    let data = null;
    let loading = false;

    function money(v) { return fmt(v == null ? 0 : v); }

    async function load() {
      const range = rangeFor(preset, from, to);
      loading = true;
      draw();
      let res;
      try {
        res = await api.get(`/api/reports?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
      } catch (err) {
        loading = false;
        data = null;
        draw();
        toast((err && !err.offline) ? 'Reports failed' : 'Offline — reports need the server', 'warn');
        return;
      }
      from = range.from;
      to = range.to;
      data = res;
      loading = false;
      draw();
    }

    function draw() {
      const sum = data ? data.summary : null;
      const range = rangeFor(preset, from, to);
      root.innerHTML = `
        <header class="scr-head">
          <div class="scr-title">
            <h2>Reports</h2>
            <p>${sum ? `${range.from} → ${range.to} · ${data.period.days} day${data.period.days === 1 ? '' : 's'}` : 'Manager analytics'}</p>
          </div>
          ${data ? `<button class="icon-btn" id="repExport" aria-label="Export CSV">⤓</button>` : ''}
        </header>

        <div class="rep-chips">
          ${PRESETS.map((p) => `<button class="rep-chip ${p.id === preset ? 'on' : ''}" data-p="${p.id}">${p.label}</button>`).join('')}
          ${preset === 'custom' ? `
            <div class="rep-dates">
              <input class="field" id="repFrom" type="date" value="${esc(from)}" aria-label="From">
              <span class="muted">→</span>
              <input class="field" id="repTo" type="date" value="${esc(to)}" aria-label="To">
              <button class="btn btn-sm" id="repGo">Go</button>
            </div>` : ''}
        </div>

        ${loading ? `<div class="empty"><p>Loading…</p></div>` : !data ? `<div class="empty"><p>No report yet — pick a period above.</p></div>` : `
        <div class="dash-kpis">
          <div class="dash-kpi"><span>Revenue</span><strong>${money(sum.netRevenue)}</strong></div>
          <div class="dash-kpi"><span>Sales</span><strong>${sum.salesCount}</strong></div>
          <div class="dash-kpi"><span>Avg ticket</span><strong>${money(sum.avgTicket)}</strong></div>
          <div class="dash-kpi"><span>Tax collected</span><strong>${money(sum.tax)}</strong></div>
          <div class="dash-kpi dash-gp"><span>Gross profit</span><strong>${money(sum.grossProfit)}</strong></div>
        </div>

        <section class="dash-section">
          <h3>Sales by day <span class="muted">· ${sum.grossSales.toFixed(2)} gross · ${sum.units} units</span></h3>
          <div class="dash-chart">${barChart(data.byDay)}</div>
          <p class="muted rep-sub">
            Refunds −${money(sum.refunds)} · paid out −${money(sum.payouts)} · collections +${money(sum.collections)}
          </p>
        </section>

        <div class="rep-grid">
          <section class="dash-section">
            <h3>By category</h3>
            ${panel(data.byCategory, (c) => c.category, (c) => [money(c.sales), `${c.units} units`, `gp ${money(c.gp)}`])}
          </section>
          <section class="dash-section">
            <h3>By cashier</h3>
            ${panel(data.byCashier, (c) => c.userName, (c) => [money(c.sales), `${c.count} tx · ${c.units} units`, `gp ${money(c.gp)}`])}
          </section>
          <section class="dash-section">
            <h3>By payment method</h3>
            ${panel(data.byTender, (c) => c.label, (c) => [money(c.amount), `${c.count} tender${c.count === 1 ? '' : 's'}`])}
          </section>
          <section class="dash-section">
            <h3>Top customers</h3>
            ${panel(data.topCustomers, (c) => c.name, (c) => [money(c.spent), `${c.count} tx`, c.balance == null ? '' : `balance ${money(c.balance)}`])}
          </section>
        </div>

        <section class="dash-section">
          <h3>Top products</h3>
          ${data.topProducts.length ? `<div class="rank-list">${data.topProducts.map((p, i) => `
            <div class="rank-row">
              <span class="rank-idx">${i + 1}</span>
              <div class="rank-main"><div class="rank-name">${esc(p.name)}</div><div class="muted">${esc(p.sku || '—')} · ${p.units} unit${p.units === 1 ? '' : 's'}</div></div>
              <b>${money(p.sales)}<span class="gp muted">&nbsp;·&nbsp;gp ${money(p.gp)}</span></b>
            </div>`).join('')}</div>`
            : `<p class="empty">No sales in this window.</p>`}
        </section>
        `}`;

      root.querySelectorAll('.rep-chip').forEach((b) => b.addEventListener('click', () => {
        preset = b.dataset.p;
        const r = rangeFor(preset, from, to);
        if (preset === 'custom') { from = r.from || from; to = r.to || to; }
        load();
      }));
      const go = root.querySelector('#repGo');
      if (go) go.addEventListener('click', () => {
        from = root.querySelector('#repFrom').value;
        to = root.querySelector('#repTo').value;
        if (!from || !to) { toast('Pick both dates', 'warn'); return; }
        load();
      });
      const exp = root.querySelector('#repExport');
      if (exp) exp.addEventListener('click', () => exportCsv(data, range));
    }

    await load();
  },
};

/* ---- render helpers ---- */

function panel(rows, name, cells) {
  if (!rows || !rows.length) return '<p class="empty">Nothing in this window.</p>';
  const max = Math.max(1, ...rows.map((r) => r.sales != null ? r.sales : r.amount != null ? r.amount : r.spent != null ? r.spent : 0));
  return `<div class="rep-list">${rows.slice(0, 6).map((r) => {
    const [a, b, c] = cells(r);
    const v = r.sales != null ? r.sales : r.amount != null ? r.amount : r.spent != null ? r.spent : 0;
    const w = Math.round((v / max) * 100);
    return `
      <div class="rep-item">
        <div class="rep-top"><span class="rep-name">${esc(name(r))}</span><b>${a}</b></div>
        <div class="rep-bar"><div class="rep-fill" style="width:${w}%"></div></div>
        <div class="rep-sub muted">${[b, c].filter(Boolean).join(' · ')}</div>
      </div>`;
  }).join('')}</div>`;
}

function barChart(days) {
  const W = 340, H = 116, PAD = 8, H2 = 86, base = H - H2;
  const max = Math.max(1, ...days.map((d) => d.sales));
  const bw = (W - PAD * 2) / Math.max(1, days.length);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" aria-label="Sales by day">
    ${days.length ? days.map((d, i) => {
      const h = Math.max(2, Math.round((d.sales / max) * H2));
      const x = Math.round(PAD + i * bw + bw * 0.15);
      const w = Math.round(bw * 0.7);
      const y = base + H2 - h;
      const dt = new Date(d.date);
      return `
        <g>
          <title>${d.date} — ${fmt(d.sales)} (${d.count})</title>
          <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${d.sales ? '#1c5d99' : '#dfe6ee'}"></rect>
          <text x="${x + w / 2}" y="${H - 3}" text-anchor="middle" font-size="8" fill="#7b8ca0">${DAYS[dt.getDay()]}</text>
        </g>`;
    }).join('') : `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="9" fill="#7b8ca0">No sales</text>`}
    <line x1="${PAD}" y1="${base}" x2="${W - PAD}" y2="${base}" stroke="#eef2f7" stroke-width="1"></line>
  </svg>`;
}

function exportCsv(data, range) {
  const esc = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
  const money = (v) => Number(v || 0).toFixed(2);
  const s = data.summary;
  const lines = [];
  lines.push(`Orison POS report,${range.from},${range.to}`);
  lines.push('');
  const pushList = (title, headers, rows, cells) => {
    if (!rows.length) return;
    lines.push(title);
    lines.push(headers.join(','));
    for (const r of rows) lines.push(cells(r).map(esc).join(','));
    lines.push('');
  };
  lines.push('SUMMARY');
  lines.push(['metric', 'value'].join(','));
  lines.push(['gross_sales', money(s.grossSales)].join(','));
  lines.push(['refunds', money(s.refunds)].join(','));
  lines.push(['paid_out', money(s.payouts)].join(','));
  lines.push(['collections', money(s.collections)].join(','));
  lines.push(['net_revenue', money(s.netRevenue)].join(','));
  lines.push(['sales_count', String(s.salesCount)].join(','));
  lines.push(['units', String(s.units)].join(','));
  lines.push(['tax_collected', money(s.tax)].join(','));
  lines.push(['gross_profit', money(s.grossProfit)].join(','));
  lines.push(['avg_ticket', money(s.avgTicket)].join(','));
  lines.push('');
  pushList('BY_DAY', ['date', 'gross', 'count', 'gross_profit'], data.byDay,
    (r) => [r.date, money(r.sales), String(r.count), money(r.gp)]);
  pushList('BY_CATEGORY', ['category', 'sales', 'units', 'gross_profit'], data.byCategory,
    (r) => [r.category, money(r.sales), String(r.units), money(r.gp)]);
  pushList('BY_CASHIER', ['cashier', 'sales', 'count', 'units', 'gross_profit'], data.byCashier,
    (r) => [r.userName, money(r.sales), String(r.count), String(r.units), money(r.gp)]);
  pushList('BY_PAYMENT', ['method', 'net_amount', 'tenders'], data.byTender,
    (r) => [r.label, money(r.amount), String(r.count)]);
  pushList('TOP_PRODUCTS', ['name', 'sku', 'units', 'sales', 'gross_profit'], data.topProducts,
    (r) => [r.name, r.sku, String(r.units), money(r.sales), money(r.gp)]);
  pushList('TOP_CUSTOMERS', ['name', 'spent', 'tx_count', 'balance'], data.topCustomers,
    (r) => [r.name, money(r.spent), String(r.count), r.balance == null ? '' : money(r.balance)]);

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `orison-report-${range.from}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Report CSV ${data.byDay.length} days`, 'ok');
  beep('ok');
}