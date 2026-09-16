'use strict';

import { $t, $tn, N_, arrow, dateLocale } from '../lang.js';

/* Sales report: every sale and refund for a period, filtered and grouped the
   way the question is asked - by day, hour, person, category, product, payment,
   channel or customer - with the sales themselves underneath, line by line.
   Built on the server (/api/reports/sales) with the money rules Reports and the
   books use. Managers and admins see the whole shop with cost and profit; a
   cashier sees their own sales, without cost. */

import { api } from '../api.js';
import { idb } from '../db.js';
import { screenHead } from '../components.js';
import { fmt, esc, toast, beep, csvCell, downloadCsv } from '../ui.js';
import { PRESETS, rangeFor } from './reports.js';

export const GROUPS = [
  { id: 'day', label: N_('Day') },
  { id: 'hour', label: N_('Hour') },
  { id: 'staff', label: N_('Staff'), store: true },
  { id: 'category', label: N_('Category') },
  { id: 'product', label: N_('Product') },
  { id: 'tender', label: N_('Payment') },
  { id: 'channel', label: N_('Channel') },
  { id: 'customer', label: N_('Customer') },
];

export const TENDER_LABELS = {
  cash: N_('Cash'), card: N_('Card'), transfer: N_('Transfer'), store_credit: N_('Store credit'),
  net30: N_('On account'), account: N_('On account'), deposit: N_('Deposit applied'), marketplace: N_('Marketplace'),
};
export const CHANNEL_LABELS = {
  in_store: N_('In store'), online: N_('Own website'), phone: N_('Phone order'), marketplace: N_('Marketplace'), other: N_('Other'),
};

export const EMPTY_FILTERS = { userId: '', category: '', productId: '', tender: '', channel: '', customerId: '', kind: '' };

/* A group row that stands for one value of a filter, so tapping it drills in. */
const DRILL = { staff: 'userId', category: 'category', product: 'productId', tender: 'tender', channel: 'channel', customer: 'customerId' };

export function drillFilter(groupBy, key) {
  const field = DRILL[groupBy];
  if (!field) return null;
  let value = String(key == null ? '' : key);
  if (groupBy === 'tender') value = value.replace(/^t:/, '');
  if (groupBy === 'product' && value.startsWith('name:')) return null;
  if (groupBy === 'customer' && value === 'walk-in') return null;
  return { [field]: value };
}

export function activeFilters(filters) {
  return Object.keys(EMPTY_FILTERS).filter((k) => filters && filters[k]).length;
}

export function queryString({ from, to }, filters, groupBy, offset = 0, limit = 100) {
  const q = new URLSearchParams({ from, to, groupBy, offset: String(offset), limit: String(limit) });
  for (const k of Object.keys(EMPTY_FILTERS)) if (filters && filters[k]) q.set(k, filters[k]);
  return q.toString();
}

const money2 = (v) => (v == null ? '' : Number(v).toFixed(2));
/* Text goes through csvCell (quoted, formula-safe); numbers are written bare,
   so a refund's -54.00 stays a number in the spreadsheet rather than text. */
const txt = (v) => csvCell(v == null ? '' : String(v));
const num = (v) => (v == null || v === '' ? '' : String(v));
const pad2 = (n) => String(n).padStart(2, '0');
/* the till's own date and time, as the shop reads its receipts - not UTC */
export function localStamp(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return ['', ''];
  return [`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, `${pad2(d.getHours())}:${pad2(d.getMinutes())}`];
}

/* One row per sold or returned line, with the sale it belongs to - the file an
   accountant or a spreadsheet wants. Column names stay English and stable. */
export function salesCsv(data) {
  const cost = !!data.canSeeCost;
  const head = ['date', 'time', 'type', 'receipt', 'refund_of', 'staff', 'customer', 'channel', 'payment',
    'item', 'sku', 'category', 'serial', 'qty', 'unit_price', 'discount', 'tax', 'line_total']
    .concat(cost ? ['cost', 'gross_profit'] : []);
  const lines = [head.join(',')];
  for (const r of data.rows || []) {
    const [date, time] = localStamp(r.createdAt);
    const pay = (r.tenders || []).map((t) => `${t.type} ${money2(t.amount)}`).join(' + ');
    for (const l of r.lines || []) {
      lines.push([
        num(date), num(time), txt(r.kind), txt(r.receiptNo), txt(r.originalReceiptNo || ''),
        txt(r.staff), txt(r.customer), txt(r.channel), txt(pay), txt(l.name), txt(l.sku), txt(l.category), txt(l.serialNumber), num(l.qty), money2(l.unitPrice),
        money2(l.discount), money2(l.tax), money2(l.total),
      ].concat(cost ? [money2(l.cost), money2(l.grossProfit)] : []).join(','));
    }
  }
  return lines.join('\n');
}

export function summaryCsv(data, groupLabel) {
  const s = data.summary || {};
  const cost = !!data.canSeeCost;
  const out = [`Sales report,${txt(data.period.from)},${txt(data.period.to)}`, ''];
  const pairs = [
    ['sales', s.salesCount], ['refunds_count', s.refundCount], ['gross_sales', money2(s.grossSales)], ['refunds', money2(s.refunds)],
    ['net_sales', money2(s.netSales)], ['tax', money2(s.tax)], ['discounts', money2(s.discounts)], ['net_before_tax', money2(s.netExTax)],
    ['units_sold', s.unitsSold], ['units_returned', s.unitsReturned], ['average_sale', money2(s.avgSale)], ['items_per_sale', s.itemsPerSale],
  ].concat(cost ? [['cost', money2(s.cost)], ['gross_profit', money2(s.grossProfit)], ['margin_pct', s.margin == null ? '' : s.margin]] : []);
  out.push('metric,value');
  for (const [k, v] of pairs) out.push(`${k},${num(v)}`);
  out.push('', `BY_${String(data.groupBy).toUpperCase()}`);
  out.push(['group', 'sales', 'refunds', 'units', 'gross', 'refunds_amount', 'net', 'share_pct'].concat(cost ? ['gross_profit', 'margin_pct'] : []).join(','));
  for (const g of data.groups || []) {
    out.push([txt(groupLabel ? groupLabel(g) : g.label), num(g.sales), num(g.refunds), num(g.units), money2(g.gross), money2(g.refundsAmount), money2(g.net), num(g.share)]
      .concat(cost ? [g.grossProfit == null ? '' : money2(g.grossProfit), num(g.margin)] : []).join(','));
  }
  return out.join('\n');
}

export const screen = {
  id: 'salesreport',
  tab: 'salesreport',
  title: 'Sales report',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const user = ctx.state.user || (await idb.get('meta', 'config'))?.user || {};
    const isStore = user.role === 'admin' || user.role === 'manager';
    const handoff = ctx.state.salesReportPreset || null;
    ctx.state.salesReportPreset = null;

    let preset = (handoff && handoff.preset) || 'today';
    let from = (handoff && handoff.from) || '';
    let to = (handoff && handoff.to) || '';
    let groupBy = (handoff && handoff.groupBy) || 'day';
    let filters = { ...EMPTY_FILTERS, ...((handoff && handoff.filters) || {}) };
    let data = null;
    let rows = [];
    let loading = false;
    const open = new Set();

    const loc = dateLocale();
    const tenderLabel = (t) => $t(TENDER_LABELS[t] || t);
    const channelLabel = (c) => $t(CHANNEL_LABELS[c] || c);
    const hourLabel = (h) => new Date(2000, 0, 1, Number(h) || 0).toLocaleTimeString(loc, { hour: 'numeric' });
    const groupLabel = (g) => {
      if (data.groupBy === 'tender') return tenderLabel(g.label);
      if (data.groupBy === 'channel') return channelLabel(g.label);
      if (data.groupBy === 'hour') return hourLabel(g.key);
      if (data.groupBy === 'day') return new Date(`${g.key}T12:00:00`).toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' });
      if (data.groupBy === 'customer') return g.label || $t('Walk-in');
      return g.label === 'Uncategorized' ? $t('Uncategorized') : g.label;
    };

    async function load({ more = false } = {}) {
      const range = rangeFor(preset, from, to);
      if (!more) { loading = true; draw(); }
      try {
        const res = await api.get(`/api/reports/sales?${queryString(range, filters, groupBy, more ? rows.length : 0, 100)}`);
        from = range.from; to = range.to;
        data = res;
        rows = more ? rows.concat(res.rows) : res.rows;
      } catch (err) {
        if (!more) data = null;
        toast((err && !err.offline) ? (err.message || $t('Sales report failed')) : $t('Offline — reports need the server'), 'warn');
      }
      loading = false;
      draw();
    }

    function select(id, label, value, options) {
      return `<label class="sr-filter"><span>${esc(label)}</span>
        <select id="${id}"><option value="">${esc($t('All'))}</option>${options.map((o) => `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
    }

    function kpis(s) {
      const tile = (label, value, note, cls) => `<div class="dash-kpi${cls ? ' ' + cls : ''}"><span>${esc(label)}</span><strong>${value}</strong>${note ? `<em class="muted">${esc(note)}</em>` : ''}</div>`;
      return `<div class="dash-kpis sr-kpis">
        ${tile($t('Net sales'), fmt(s.netSales), s.refunds ? $t('{gross} sold · {refunds} refunded', { gross: fmt(s.grossSales), refunds: fmt(s.refunds) }) : '')}
        ${tile($t('Sales'), String(s.salesCount), s.refundCount ? $tn('{n} refund', '{n} refunds', s.refundCount) : '')}
        ${tile($t('Average sale'), fmt(s.avgSale), $t('{n} items per sale', { n: s.itemsPerSale }))}
        ${tile($t('Units'), String(s.unitsSold - s.unitsReturned), s.unitsReturned ? $t('{n} returned', { n: s.unitsReturned }) : '')}
        ${tile($t('Tax'), fmt(s.tax), s.taxRefunded ? $t('{amount} refunded', { amount: fmt(s.taxRefunded) }) : '')}
        ${tile($t('Discounts given'), fmt(s.discounts))}
        ${data.canSeeCost ? tile($t('Gross profit'), fmt(s.grossProfit), s.margin == null ? '' : $t('{pct}% margin', { pct: s.margin }), 'dash-gp') : ''}
      </div>`;
    }

    function groupTable() {
      const cost = data.canSeeCost;
      const noUnits = data.groupBy === 'tender';
      const drillable = !!DRILL[data.groupBy];
      if (!data.groups.length) return `<p class="empty">${esc($t('Nothing in this window.'))}</p>`;
      const max = Math.max(1, ...data.groups.map((g) => Math.abs(g.net)));
      return `<div class="table-wrap"><table class="data-table sr-groups">
        <thead><tr><th>${esc($t(GROUPS.find((g) => g.id === data.groupBy).label))}</th><th class="num">${esc($t('Sales'))}</th>${noUnits ? '' : `<th class="num">${esc($t('Units'))}</th>`}
          <th class="num">${esc($t('Sold'))}</th><th class="num">${esc($t('Refunded'))}</th><th class="num">${esc($t('Net'))}</th>
          ${cost && !noUnits ? `<th class="num">${esc($t('Gross profit'))}</th><th class="num">${esc($t('Margin'))}</th>` : ''}<th class="sr-share-h">${esc($t('Share'))}</th></tr></thead>
        <tbody>${data.groups.map((g) => {
          const drill = drillFilter(data.groupBy, g.key);
          return `<tr${drillable && drill ? ` class="sr-drill" data-drill="${esc(JSON.stringify(drill))}" tabindex="0" title="${esc($t('Show only this'))}"` : ''}>
            <td>${esc(groupLabel(g))}</td><td class="num">${g.sales}${g.refunds ? ` <span class="muted">−${g.refunds}</span>` : ''}</td>${noUnits ? '' : `<td class="num">${g.units}</td>`}
            <td class="num">${fmt(g.gross)}</td><td class="num${g.refundsAmount ? ' neg' : ''}">${g.refundsAmount ? '−' + fmt(g.refundsAmount) : ''}</td><td class="num"><b>${fmt(g.net)}</b></td>
            ${cost && !noUnits ? `<td class="num${g.grossProfit < 0 ? ' neg' : ''}">${fmt(g.grossProfit)}</td><td class="num">${g.margin == null ? '' : g.margin + '%'}</td>` : ''}
            <td class="sr-share"><span class="sr-bar"><span style="width:${Math.round(Math.abs(g.net) / max * 100)}%"></span></span><span class="muted">${g.share}%</span></td>
          </tr>`;
        }).join('')}</tbody></table></div>`;
    }

    function salesTable() {
      if (!rows.length) return `<p class="empty">${esc($t('No sales match.'))}</p>`;
      const cost = data.canSeeCost;
      return `<div class="table-wrap"><table class="data-table sr-sales">
        <thead><tr><th>${esc($t('Time'))}</th><th>${esc($t('Receipt'))}</th>${isStore ? `<th>${esc($t('Staff'))}</th>` : ''}<th>${esc($t('Customer'))}</th><th>${esc($t('Items'))}</th><th>${esc($t('Payment'))}</th><th class="num">${esc($t('Total'))}</th>${cost ? `<th class="num">${esc($t('Gross profit'))}</th>` : ''}</tr></thead>
        ${rows.map((r) => {
          const d = new Date(r.createdAt);
          const isOpen = open.has(r.id);
          const items = r.lines.map((l) => `${l.qty > 1 ? l.qty + '× ' : ''}${l.name}`).join(', ');
          return `<tbody class="sr-tx${r.kind === 'refund' ? ' sr-refund' : ''}${isOpen ? ' open' : ''}">
            <tr class="sr-row" data-row="${esc(r.id)}" tabindex="0" aria-expanded="${isOpen}">
              <td>${esc(d.toLocaleDateString(loc, { day: 'numeric', month: 'short' }))} <span class="muted">${esc(d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' }))}</span></td>
              <td>${r.kind === 'refund' ? `<span class="tag tag-bad">${esc($t('Refund'))}</span> ` : ''}${esc(r.receiptNo || r.externalRef || '—')}${r.partial ? ` <span class="muted" title="${esc($t('Only the lines that match the filters'))}">·${esc($t('part'))}</span>` : ''}</td>
              ${isStore ? `<td>${esc(r.staff)}</td>` : ''}
              <td>${esc(r.customer || '')}</td>
              <td class="sr-items">${esc(items)}</td>
              <td>${esc(r.tenders.map((t) => tenderLabel(t.type)).join(' + '))}</td>
              <td class="num${r.total < 0 ? ' neg' : ''}"><b>${fmt(r.total)}</b></td>
              ${cost ? `<td class="num${r.grossProfit < 0 ? ' neg' : ''}">${fmt(r.grossProfit)}</td>` : ''}
            </tr>
            ${isOpen ? `<tr class="sr-lines"><td colspan="${6 + (isStore ? 1 : 0) + (cost ? 1 : 0)}">
              <table class="sr-line-table"><thead><tr><th>${esc($t('Item'))}</th><th class="num">${esc($t('Qty'))}</th><th class="num">${esc($t('Price each'))}</th><th class="num">${esc($t('Discount'))}</th><th class="num">${esc($t('Tax'))}</th><th class="num">${esc($t('Total'))}</th>${cost ? `<th class="num">${esc($t('Cost'))}</th><th class="num">${esc($t('Gross profit'))}</th>` : ''}</tr></thead>
              <tbody>${r.lines.map((l) => `<tr><td>${esc(l.name)}${l.serialNumber ? `<br><span class="muted mono-no">${esc(l.serialNumber)}</span>` : ''}<br><span class="muted">${esc(l.category === 'Uncategorized' ? $t('Uncategorized') : l.category)}</span></td>
                <td class="num">${l.qty}</td><td class="num">${fmt(l.unitPrice)}</td><td class="num">${l.discount ? fmt(l.discount) + (l.discountPct ? ` <span class="muted">${l.discountPct}%</span>` : '') : ''}</td>
                <td class="num">${fmt(l.tax)}</td><td class="num"><b>${fmt(l.total)}</b></td>${cost ? `<td class="num">${fmt(l.cost)}</td><td class="num">${fmt(l.grossProfit)}</td>` : ''}</tr>`).join('')}</tbody></table>
              <p class="muted sr-pay">${esc($t('Paid'))}: ${esc(r.tenders.map((t) => `${tenderLabel(t.type)} ${fmt(t.amount)}`).join(' · '))}${r.originalReceiptNo ? ' · ' + esc($t('refund of {receipt}', { receipt: r.originalReceiptNo })) : ''} · ${esc(channelLabel(r.channel))}</p>
            </td></tr>` : ''}
          </tbody>`;
        }).join('')}
      </table></div>
      ${rows.length < data.rowsTotal ? `<div class="sr-more sr-noprint"><button class="btn btn-ghost" id="srMore">${esc($t('Show more · {shown} of {n}', { shown: rows.length, n: data.rowsTotal }))}</button></div>` : ''}`;
    }

    function draw() {
      const range = rangeFor(preset, from, to);
      const o = (data && data.options) || { staff: [], categories: [], tenders: [], channels: [], customers: [], products: [] };
      const nActive = activeFilters(filters);
      root.innerHTML = `
        ${screenHead({
          title: $t('Sales report'),
          sub: `${range.from} ${arrow()} ${range.to}${isStore ? '' : ' · ' + $t('Your sales')}`,
          actions: data ? `<div class="sr-actions sr-noprint">
            <button class="btn btn-ghost btn-sm" id="srCsvSummary">${esc($t('Summary CSV'))}</button>
            <button class="btn btn-ghost btn-sm" id="srCsvSales">${esc($t('Sales CSV'))}</button>
            <button class="btn btn-ghost btn-sm" id="srPrint">${esc($t('Print'))}</button></div>` : '',
        })}

        <div class="rep-chips sr-noprint">
          ${PRESETS.map((p) => `<button class="rep-chip ${p.id === preset ? 'on' : ''}" data-p="${p.id}">${esc($t(p.label))}</button>`).join('')}
          ${preset === 'custom' ? `
            <div class="rep-dates">
              <input class="field" id="srFrom" type="date" value="${esc(from)}" aria-label="${$t('From')}">
              <span class="muted">${arrow()}</span>
              <input class="field" id="srTo" type="date" value="${esc(to)}" aria-label="${$t('To')}">
              <button class="btn btn-sm" id="srGo">${$t('Go')}</button>
            </div>` : ''}
        </div>

        <div class="sr-filters sr-noprint">
          ${isStore ? select('srStaff', $t('Staff'), filters.userId, o.staff.map((x) => ({ value: x.id, label: x.name }))) : ''}
          ${select('srCategory', $t('Category'), filters.category, o.categories.map((c) => ({ value: c, label: c === 'Uncategorized' ? $t('Uncategorized') : c })))}
          ${select('srProduct', $t('Product'), filters.productId, o.products.map((x) => ({ value: x.id, label: x.name })))}
          ${select('srTender', $t('Payment'), filters.tender, o.tenders.map((t) => ({ value: t, label: tenderLabel(t) })))}
          ${select('srChannel', $t('Channel'), filters.channel, o.channels.map((c) => ({ value: c, label: channelLabel(c) })))}
          ${select('srCustomer', $t('Customer'), filters.customerId, o.customers.map((x) => ({ value: x.id, label: x.name })))}
          <label class="sr-filter"><span>${esc($t('Show'))}</span>
            <select id="srKind">
              <option value=""${!filters.kind ? ' selected' : ''}>${esc($t('Sales and refunds'))}</option>
              <option value="sale"${filters.kind === 'sale' ? ' selected' : ''}>${esc($t('Sales only'))}</option>
              <option value="refund"${filters.kind === 'refund' ? ' selected' : ''}>${esc($t('Refunds only'))}</option>
            </select></label>
          ${nActive ? `<button class="cat-back" id="srClear" type="button">${esc($tn('Clear {n} filter', 'Clear {n} filters', nActive))}</button>` : ''}
        </div>

        ${loading ? `<div class="empty"><p>${$t('Loading…')}</p></div>` : !data ? `<div class="empty"><p>${$t('No report yet — pick a period above.')}</p></div>` : `
        ${kpis(data.summary)}

        <section class="dash-section">
          <div class="sr-group-head">
            <h3>${esc($t('Breakdown'))}</h3>
            <div class="seg seg-sm sr-noprint" role="group" aria-label="${esc($t('Group by'))}">
              ${GROUPS.filter((g) => !g.store || isStore).map((g) => `<button class="seg-btn ${g.id === data.groupBy ? 'on' : ''}" data-group="${g.id}" type="button">${esc($t(g.label))}</button>`).join('')}
            </div>
          </div>
          ${groupTable()}
        </section>

        <section class="dash-section">
          <h3>${esc($t('Sales'))} <span class="muted">· ${esc($tn('{n} transaction', '{n} transactions', data.rowsTotal))}</span></h3>
          ${salesTable()}
        </section>`}`;

      root.querySelectorAll('.rep-chip').forEach((b) => b.addEventListener('click', () => {
        preset = b.dataset.p;
        if (preset === 'custom') { draw(); return; }
        load();
      }));
      root.querySelector('#srGo')?.addEventListener('click', () => {
        from = root.querySelector('#srFrom').value;
        to = root.querySelector('#srTo').value;
        if (!from || !to) { toast($t('Pick both dates'), 'warn'); return; }
        load();
      });
      const bindSelect = (id, field) => root.querySelector('#' + id)?.addEventListener('change', (e) => { filters = { ...filters, [field]: e.target.value }; load(); });
      bindSelect('srStaff', 'userId'); bindSelect('srCategory', 'category'); bindSelect('srProduct', 'productId');
      bindSelect('srTender', 'tender'); bindSelect('srChannel', 'channel'); bindSelect('srCustomer', 'customerId'); bindSelect('srKind', 'kind');
      root.querySelector('#srClear')?.addEventListener('click', () => { filters = { ...EMPTY_FILTERS }; load(); });
      root.querySelectorAll('[data-group]').forEach((b) => b.addEventListener('click', () => { groupBy = b.dataset.group; load(); }));
      const drill = (el) => { filters = { ...filters, ...JSON.parse(el.dataset.drill) }; load(); };
      root.querySelectorAll('[data-drill]').forEach((el) => {
        el.addEventListener('click', () => drill(el));
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') drill(el); });
      });
      const toggle = (el) => { const id = el.dataset.row; if (open.has(id)) open.delete(id); else open.add(id); draw(); };
      root.querySelectorAll('[data-row]').forEach((el) => {
        el.addEventListener('click', () => toggle(el));
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(el); } });
      });
      root.querySelector('#srMore')?.addEventListener('click', () => load({ more: true }));
      root.querySelector('#srCsvSummary')?.addEventListener('click', () => {
        downloadCsv(`orison-sales-summary-${range.from}-${range.to}.csv`, summaryCsv(data, groupLabel));
        toast($t('Summary CSV saved'), 'ok'); beep('ok');
      });
      root.querySelector('#srCsvSales')?.addEventListener('click', async () => {
        try {
          const all = await api.get(`/api/reports/sales?${queryString(range, filters, groupBy, 0, 5000)}`);
          downloadCsv(`orison-sales-${range.from}-${range.to}.csv`, salesCsv(all));
          toast($tn('Sales CSV · {n} transaction', 'Sales CSV · {n} transactions', all.rows.length), 'ok'); beep('ok');
        } catch (err) { toast((err && err.message) || $t('Sales report failed'), 'warn'); }
      });
      root.querySelector('#srPrint')?.addEventListener('click', () => {
        document.body.classList.add('report-printing');
        const done = () => { document.body.classList.remove('report-printing'); window.removeEventListener('afterprint', done); };
        window.addEventListener('afterprint', done);
        window.print();
        setTimeout(done, 1500);
      });
    }

    await load();
  },
};
