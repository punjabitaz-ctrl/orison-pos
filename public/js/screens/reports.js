'use strict';

import { $t, $tn, N_, arrow, dateLocale } from '../lang.js';

/* Reports: store-wide analytics for a date window, manager/admin only.
   Everything is computed server-side from the ledger — this screen never
   trusts cached client state for numbers that go into a decision. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { screenHead, rankList } from '../components.js';
import { fmt, esc, toast, beep, csvCell, downloadCsv } from '../ui.js';

const DAYS = [N_('Sun'), N_('Mon'), N_('Tue'), N_('Wed'), N_('Thu'), N_('Fri'), N_('Sat')];

export const PRESETS = [
  { id: 'today', label: N_('Today') },
  { id: 'week', label: N_('This week') },
  { id: 'month', label: N_('This month') },
  { id: '30d', label: N_('Last 30 days') },
  { id: 'custom', label: N_('Custom') },
];

function keyOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function rangeFor(preset, from, to) {
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
      root.innerHTML = `<div class="empty"><p>${$t('Managers and admins only.')}</p></div>`;
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
        toast((err && !err.offline) ? $t('Reports failed') : $t('Offline — reports need the server'), 'warn');
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
        ${screenHead({
          title: $t('Reports'),
          sub: sum ? `${range.from} ${arrow()} ${range.to} · ${$tn('{n} day', '{n} days', data.period.days)}` : $t('Manager analytics'),
          actions: data ? `<div class="sr-actions"><button class="btn btn-ghost btn-sm" id="repSales">${esc($t('Sales report'))}</button><button class="icon-btn" id="repExport" aria-label="${$t('Export CSV')}">⤓</button></div>` : '',
        })}

        <div class="rep-chips">
          ${PRESETS.map((p) => `<button class="rep-chip ${p.id === preset ? 'on' : ''}" data-p="${p.id}">${esc($t(p.label))}</button>`).join('')}
          ${preset === 'custom' ? `
            <div class="rep-dates">
              <input class="field" id="repFrom" type="date" value="${esc(from)}" aria-label="${$t('From')}">
              <span class="muted">${arrow()}</span>
              <input class="field" id="repTo" type="date" value="${esc(to)}" aria-label="${$t('To')}">
              <button class="btn btn-sm" id="repGo">${$t('Go')}</button>
            </div>` : ''}
        </div>

        ${loading ? `<div class="empty"><p>${$t('Loading…')}</p></div>` : !data ? `<div class="empty"><p>${$t('No report yet — pick a period above.')}</p></div>` : `
        <div class="dash-kpis">
          <div class="dash-kpi"><span>${$t('Revenue')}</span><strong>${money(sum.netRevenue)}</strong></div>
          <div class="dash-kpi"><span>${$t('Sales')}</span><strong>${sum.salesCount}</strong></div>
          <div class="dash-kpi"><span>${$t('Avg ticket')}</span><strong>${money(sum.avgTicket)}</strong></div>
          <div class="dash-kpi"><span>${(ctx.state && ctx.state.store && ctx.state.store.taxJurisdiction === 'AE') ? $t('VAT collected') : $t('Tax collected')}</span><strong>${money(sum.tax)}</strong></div>
          <div class="dash-kpi dash-gp"><span>${$t('Gross profit')}</span><strong>${money(sum.grossProfit)}</strong></div>
          <div class="dash-kpi"><span>${$t('Discounts given')}</span><strong>${money(sum.discounts || 0)}</strong>${sum.approvedDiscounts ? `<em class="muted">${esc($tn('{n} approved', '{n} approved', sum.approvedDiscounts))}</em>` : ''}</div>
        </div>

        <section class="dash-section">
          <div class="rep-head"><h3>${$t('Sales by day')} <span class="muted">· ${esc($t('{gross} gross · {units} units', { gross: money(sum.grossSales), units: sum.units }))}</span></h3>${detail('day')}</div>
          <div class="dash-chart">${barChart(data.byDay)}</div>
          <p class="muted rep-sub">
            ${esc($t('Refunds −{refunds} · paid out −{payouts} · collections +{collections}', { refunds: money(sum.refunds), payouts: money(sum.payouts), collections: money(sum.collections) }))}
          </p>
          ${sum.tradeInCount ? `<p class="muted rep-sub">${esc($t('Trade-ins bought: {amount} · {n} devices', { amount: money(sum.tradeIns), n: sum.tradeInCount }))}</p>` : ''}
        </section>

        ${(data.byHour || []).length ? `
        <section class="dash-section">
          <div class="rep-head"><h3>${$t('Sales by hour of the day')}</h3>${detail('hour')}</div>
          <div class="dash-chart">${hourChart(data.byHour)}</div>
        </section>` : ''}

        <div class="rep-grid">
          <section class="dash-section">
            <div class="rep-head"><h3>${$t('By category')}</h3>${detail('category')}</div>
            ${panel(data.byCategory, (c) => c.category, (c) => [money(c.sales), $tn('{n} unit', '{n} units', c.units), $t('gp {amount}', { amount: money(c.gp) })])}
          </section>
          <section class="dash-section">
            <div class="rep-head"><h3>${$t('By staff member')}</h3>${detail('staff')}</div>
            ${staffPanel(data.byCashier, money)}
          </section>
          <section class="dash-section">
            <div class="rep-head"><h3>${$t('By payment method')}</h3>${detail('tender')}</div>
            ${panel(data.byTender, (c) => $t(c.label), (c) => [money(c.amount), $tn('{n} tender', '{n} tenders', c.count)])}
          </section>
          <section class="dash-section">
            <div class="rep-head"><h3>${$t('Top customers')}</h3>${detail('customer')}</div>
            ${panel(data.topCustomers, (c) => c.name, (c) => [money(c.spent), $t('{n} tx', { n: c.count }), c.balance == null ? '' : $t('balance {amount}', { amount: money(c.balance) })])}
          </section>
        </div>

        <section class="dash-section">
          <div class="rep-head"><h3>${$t('Top products')}</h3>${detail('product')}</div>
          ${data.topProducts.length ? rankList(data.topProducts.map((p, i) => ({
            idx: i + 1,
            name: p.name,
            meta: `${p.sku || '—'} · ${$tn('{n} unit', '{n} units', p.units)}`,
            rightHtml: `<b>${money(p.sales)}<span class="gp muted">&nbsp;·&nbsp;${esc($t('gp {amount}', { amount: money(p.gp) }))}</span></b>`,
          })))
            : `<p class="empty">${$t('No sales in this window.')}</p>`}
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
        if (!from || !to) { toast($t('Pick both dates'), 'warn'); return; }
        load();
      });
      const openSales = (groupBy) => {
        ctx.state.salesReportPreset = { preset, from: range.from, to: range.to, groupBy };
        ctx.router.show('salesreport');
      };
      root.querySelector('#repSales')?.addEventListener('click', () => openSales('day'));
      root.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', () => openSales(b.dataset.detail)));
      const exp = root.querySelector('#repExport');
      if (exp) exp.addEventListener('click', () => exportCsv(data, range));
    }

    await load();
  },
};

/* ---- render helpers ---- */

/* "Details" opens the Sales report for the same period, grouped the same way. */
function detail(groupBy) {
  return `<button class="rep-detail" type="button" data-detail="${esc(groupBy)}">${esc($t('Details'))} <span aria-hidden="true">${arrow()}</span></button>`;
}

/* Each person's till: what they sold and took back, how big a sale is, and
   what it earned (v1.47.0). */
function staffPanel(rows, money) {
  return panel(rows, (c) => c.userName, (c) => [
    money(c.sales),
    $t('{count} sales · average {avg} · {items} items each', { count: c.count, avg: money(c.avgSale || 0), items: c.itemsPerSale || 0 }),
    c.refundCount ? $t('{n} refunds · {amount}', { n: c.refundCount, amount: money(c.refunds) }) : '',
    c.margin == null ? $t('gp {amount}', { amount: money(c.gp) }) : $t('gp {amount} · {pct}% margin', { amount: money(c.gp), pct: c.margin }),
  ].concat(c.discounts ? [$t('discounts {amount} on {n} · {approved} approved', { amount: money(c.discounts), n: c.discountedSales || 0, approved: c.approvedDiscounts || 0 })] : []));
}

function hourChart(hours) {
  const W = 340, H = 116, PAD = 8, H2 = 86, base = H - H2;
  const first = Math.min(...hours.map((h) => h.hour));
  const last = Math.max(...hours.map((h) => h.hour));
  const span = [];
  for (let h = first; h <= last; h++) span.push(hours.find((x) => x.hour === h) || { hour: h, sales: 0, count: 0 });
  const max = Math.max(1, ...span.map((d) => d.sales));
  const bw = (W - PAD * 2) / Math.max(1, span.length);
  const loc = dateLocale();
  const label = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(loc, { hour: 'numeric' });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" aria-label="${esc($t('Sales by hour of the day'))}">
    ${span.map((d, i) => {
      const h = d.sales ? Math.max(2, Math.round((d.sales / max) * H2)) : 0;
      const x = Math.round(PAD + i * bw + bw * 0.15);
      const w = Math.max(2, Math.round(bw * 0.7));
      return `<g><title>${esc(label(d.hour))} — ${fmt(d.sales)} (${d.count})</title>
        <rect x="${x}" y="${base + H2 - h}" width="${w}" height="${h}" rx="3" fill="#1c5d99"></rect>
        ${span.length <= 12 || i % 2 === 0 ? `<text x="${x + w / 2}" y="${H - 3}" text-anchor="middle" font-size="8" fill="#7b8ca0">${esc(label(d.hour))}</text>` : ''}</g>`;
    }).join('')}
    <line x1="${PAD}" y1="${base}" x2="${W - PAD}" y2="${base}" stroke="#eef2f7" stroke-width="1"></line>
  </svg>`;
}

function panel(rows, name, cells) {
  if (!rows || !rows.length) return `<p class="empty">${$t('Nothing in this window.')}</p>`;
  const max = Math.max(1, ...rows.map((r) => r.sales != null ? r.sales : r.amount != null ? r.amount : r.spent != null ? r.spent : 0));
  return `<div class="rep-list">${rows.slice(0, 6).map((r) => {
    const [a, ...rest] = cells(r);
    const v = r.sales != null ? r.sales : r.amount != null ? r.amount : r.spent != null ? r.spent : 0;
    const w = Math.round((v / max) * 100);
    return `
      <div class="rep-item">
        <div class="rep-top"><span class="rep-name">${esc(name(r))}</span><b>${a}</b></div>
        <div class="rep-bar"><div class="rep-fill" style="width:${w}%"></div></div>
        <div class="rep-sub muted">${esc(rest.filter(Boolean).join(' · '))}</div>
      </div>`;
  }).join('')}</div>`;
}

function barChart(days) {
  const W = 340, H = 116, PAD = 8, H2 = 86, base = H - H2;
  const max = Math.max(1, ...days.map((d) => d.sales));
  const bw = (W - PAD * 2) / Math.max(1, days.length);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" aria-label="${esc($t('Sales by day'))}">
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
          <text x="${x + w / 2}" y="${H - 3}" text-anchor="middle" font-size="8" fill="#7b8ca0">${esc($t(DAYS[dt.getDay()]))}</text>
        </g>`;
    }).join('') : `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="9" fill="#7b8ca0">${$t('No sales')}</text>`}
    <line x1="${PAD}" y1="${base}" x2="${W - PAD}" y2="${base}" stroke="#eef2f7" stroke-width="1"></line>
  </svg>`;
}

function exportCsv(data, range) {
  const esc = csvCell;
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
  lines.push(['trade_ins_bought', money(s.tradeIns || 0)].join(','));
  lines.push(['net_revenue', money(s.netRevenue)].join(','));
  lines.push(['sales_count', String(s.salesCount)].join(','));
  lines.push(['units', String(s.units)].join(','));
  lines.push(['tax_collected', money(s.tax)].join(','));
  lines.push(['gross_profit', money(s.grossProfit)].join(','));
  lines.push(['avg_ticket', money(s.avgTicket)].join(','));
  lines.push(['discounts_given', money(s.discounts || 0)].join(','));
  lines.push(['discounts_approved', String(s.approvedDiscounts || 0)].join(','));
  lines.push('');
  pushList('BY_DAY', ['date', 'gross', 'count', 'gross_profit'], data.byDay,
    (r) => [r.date, money(r.sales), String(r.count), money(r.gp)]);
  pushList('BY_CATEGORY', ['category', 'sales', 'units', 'gross_profit'], data.byCategory,
    (r) => [r.category, money(r.sales), String(r.units), money(r.gp)]);
  pushList('BY_CASHIER', ['cashier', 'sales', 'count', 'units', 'gross_profit', 'discounts', 'discounted_sales', 'approved', 'refunds', 'refund_count', 'avg_sale', 'items_per_sale', 'margin_pct'], data.byCashier,
    (r) => [r.userName, money(r.sales), String(r.count), String(r.units), money(r.gp), money(r.discounts || 0), String(r.discountedSales || 0), String(r.approvedDiscounts || 0),
      money(r.refunds || 0), String(r.refundCount || 0), money(r.avgSale || 0), String(r.itemsPerSale || 0), r.margin == null ? '' : String(r.margin)]);
  pushList('BY_HOUR', ['hour', 'sales', 'count'], data.byHour || [], (r) => [String(r.hour).padStart(2, '0') + ':00', money(r.sales), String(r.count)]);
  pushList('BY_PAYMENT', ['method', 'net_amount', 'tenders'], data.byTender,
    (r) => [r.label, money(r.amount), String(r.count)]);
  pushList('TOP_PRODUCTS', ['name', 'sku', 'units', 'sales', 'gross_profit'], data.topProducts,
    (r) => [r.name, r.sku, String(r.units), money(r.sales), money(r.gp)]);
  pushList('TOP_CUSTOMERS', ['name', 'spent', 'tx_count', 'balance'], data.topCustomers,
    (r) => [r.name, money(r.spent), String(r.count), r.balance == null ? '' : money(r.balance)]);

  downloadCsv(`orison-report-${range.from}.csv`, lines.join('\n'));
  toast($tn('Report CSV · {n} day', 'Report CSV · {n} days', data.byDay.length), 'ok');
  beep('ok');
}