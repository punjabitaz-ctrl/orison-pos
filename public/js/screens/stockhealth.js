'use strict';

import { $t, $tn, N_ } from '../lang.js';

/* Stock health & sell-through (v1.51.0, v1.52.0): what the shelf is worth at
   retail and at cost, and how fast each product sells — or, on the Velocity
   tab, the units and AED sold and refunded per product and per category, the
   retail turnover ratio, and the products already selling through faster than
   they are replaced (a buying signal, nothing auto-ordered). Everything is
   computed server-side from the ledger and the catalog — this screen never
   trusts cached client stock for a number that goes into a buying or pricing
   decision. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { screenHead, sectionHead, dataTable } from '../components.js';
import { fmt, esc, toast, beep, csvCell, downloadCsv } from '../ui.js';

export const WINDOWS = [
  { days: 30, label: N_('30 days') },
  { days: 90, label: N_('90 days') },
  { days: 180, label: N_('180 days') },
  { days: 365, label: N_('365 days') },
];

/* sell-through windows, D2: the 90-day lane is for buying, 30 for sell-through */
export const VELOCITY_WINDOWS = [
  { days: 30, label: N_('30 days') },
  { days: 90, label: N_('90 days') },
];

export function movementLabel(m) {
  return m === 'slow' ? N_('Slow') : m === 'dead' ? N_('Dead') : N_('Fast');
}

function movementChip(m) {
  const cls = m === 'slow' ? 'warn-text' : m === 'dead' ? 'neg' : 'gp';
  return `<span class="chip-static ${cls}">${esc($t(movementLabel(m)))}</span>`;
}

export const screen = {
  id: 'stockhealth',
  tab: 'stockhealth',
  title: 'Stock Health',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const { state } = ctx;
    const user = state.user || (await idb.get('meta', 'config'))?.user || {};
    if ((user.role || 'cashier') !== 'admin' && (user.role || 'cashier') !== 'manager') {
      root.innerHTML = `<div class="empty"><p>${$t('Managers and admins only.')}</p></div>`;
      return;
    }

    let view = 'health';
    let days = 90;
    let category = 'all';
    let movement = 'all';
    let q = '';
    let data = null;
    let loading = false;

    function money(v) { return fmt(v == null ? 0 : v); }

    function windows() { return view === 'velocity' ? VELOCITY_WINDOWS : WINDOWS; }

    function defaultDays() { return view === 'velocity' ? 30 : 90; }

    async function load() {
      loading = true;
      draw();
      try {
        const qs = view === 'velocity'
          ? `view=velocity&days=${encodeURIComponent(days)}`
          : `days=${encodeURIComponent(days)}`;
        data = await api.get(`/api/inventory/health?${qs}`);
      } catch (err) {
        loading = false;
        data = null;
        draw();
        toast((err && !err.offline) ? $t('Stock health failed') : $t('Offline — stock health needs the server'), 'warn');
        return;
      }
      loading = false;
      draw();
    }

    function visible() {
      if (!data) return [];
      const c = category === 'all' ? '' : category;
      const mv = movement === 'all' ? '' : movement;
      const needle = q.trim().toLowerCase();
      return data.items.filter((it) =>
        (!c || it.category === c)
        && (view !== 'health' || !mv || it.movement === mv)
        && (!needle || it.name.toLowerCase().includes(needle) || (it.sku || '').toLowerCase().includes(needle)));
    }

    function dashKpis(sum) {
      if (view === 'velocity') {
        return `
        <div class="dash-kpis">
          <div class="dash-kpi"><span>${$t('Net revenue')}</span><strong>${money(sum.netRevenue)}</strong></div>
          <div class="dash-kpi"><span>${$t('Gross profit')}</span><strong>${money(sum.grossProfit)}</strong></div>
          <div class="dash-kpi"><span>${$t('Avg shelf value')}</span><strong>${money(sum.avgShelfValue)}</strong></div>
          <div class="dash-kpi"><span>${$t('Turnover')}</span><strong>${sum.turnover == null ? $t('—') : sum.turnover}</strong></div>
          <div class="dash-kpi warn"><span>${$t('Buy again')}</span><strong>${sum.buyAgainCount}</strong></div>
        </div>`;
      }
      return `
        <div class="dash-kpis">
          <div class="dash-kpi"><span>${$t('Stock at cost')}</span><strong>${money(sum.costValue)}</strong></div>
          <div class="dash-kpi"><span>${$t('Stock at retail')}</span><strong>${money(sum.retailValue)}</strong></div>
          <div class="dash-kpi"><span>${$t('Units on hand')}</span><strong>${sum.units}</strong></div>
          <div class="dash-kpi warn"><span>${$t('Slow')}</span><strong>${sum.slowCount}</strong></div>
          <div class="dash-kpi warn"><span>${$t('Dead')}</span><strong>${sum.deadCount}</strong></div>
        </div>`;
    }

    function categorySection(categories) {
      if (view === 'velocity') {
        return `
        <section class="dash-section">
          ${sectionHead({
            title: $t('Categories'),
            asideHtml: `<span class="muted">${$t('turnover is net revenue ÷ shelf value')}</span>`,
          })}
          ${categories.length ? dataTable({
            head: [
              { label: $t('Category') },
              { label: $t('Products'), num: true },
              { label: $t('Units'), num: true },
              { label: $t('Net revenue'), num: true },
              { label: $t('Avg shelf value'), num: true },
              { label: $t('Turnover'), num: true },
            ],
            bodyHtml: categories.map((c) => `
              <tr>
                <td><b>${esc(c.category || $t('Uncategorised'))}</b></td>
                <td class="num">${c.products}</td>
                <td class="num">${c.units}</td>
                <td class="num">${money(c.netRevenue)}</td>
                <td class="num">${money(c.avgShelfValue)}</td>
                <td class="num">${c.turnover == null ? $t('—') : c.turnover}</td>
              </tr>`).join(''),
          }) : `<p class="empty">${$t('Nothing in stock.')}</p>`}
        </section>`;
      }
      return `
        <section class="dash-section">
          ${sectionHead({
            title: $t('Categories'),
            asideHtml: `<span class="muted">${$t('valued at cost')}</span>`,
          })}
          ${categories.length ? dataTable({
            head: [{ label: $t('Category') }, { label: $t('Units'), num: true }, { label: $t('Retail'), num: true }, { label: $t('Cost'), num: true }],
            bodyHtml: categories.map((c) => `
              <tr>
                <td><b>${esc(c.category || $t('Uncategorised'))}</b></td>
                <td class="num">${c.units}</td>
                <td class="num">${money(c.retailValue)}</td>
                <td class="num">${money(c.costValue)}</td>
              </tr>`).join(''),
          }) : `<p class="empty">${$t('Nothing in stock.')}</p>`}
        </section>`;
    }

    function buyAgainSection(buyAgain) {
      if (!buyAgain || !buyAgain.length) return `
        <section class="dash-section">
          ${sectionHead({ title: $t('Buy again'), asideHtml: `<span class="muted">${$t('nothing is selling through faster than it is replaced')}</span>` })}
          <p class="empty">${$t('No product is outpacing its replenishment.')}</p>
        </section>`;
      return `
        <section class="dash-section">
          ${sectionHead({
            title: $t('Buy again'),
            asideHtml: `<span class="muted">${esc($tn('{n} product', '{n} products', buyAgain.length))} — ${$t('selling through faster than it is replaced')}</span>`,
          })}
          ${dataTable({
            head: [
              { label: $t('Item') },
              { label: $t('On hand'), num: true },
              { label: $t('Sold'), num: true },
              { label: $t('Cover'), num: true },
              { label: $t('Avg shelf value'), num: true },
              { label: $t('Turnover'), num: true },
            ],
            bodyHtml: buyAgain.map((it) => `
              <tr>
                <td><b>${esc(it.name)}</b>${it.sku ? `<div class="muted">${esc(it.sku)}</div>` : ''}</td>
                <td class="num">${it.onHand}</td>
                <td class="num">${it.netUnits}</td>
                <td class="num">${it.daysOfCover == null ? $t('—') : it.daysOfCover}</td>
                <td class="num">${money(it.avgShelfValue)}</td>
                <td class="num">${it.turnover == null ? $t('—') : it.turnover}</td>
              </tr>`).join(''),
          })}
        </section>`;
    }

    function productsSection(rows) {
      if (view === 'velocity') {
        return rows.length ? dataTable({
          head: [
            { label: $t('Item') },
            { label: $t('Units sold'), num: true },
            { label: $t('Revenue'), num: true },
            { label: $t('Avg shelf value'), num: true },
            { label: $t('Turnover'), num: true },
            { label: $t('Cover'), num: true },
            { label: $t('Gross profit'), num: true },
            { label: $t('Margin'), num: true },
            { label: $t('Buy again') },
          ],
          bodyHtml: rows.map((it) => `
            <tr>
              <td><b>${esc(it.name)}</b>${it.sku ? `<div class="muted">${esc(it.sku)}</div>` : ''}</td>
              <td class="num">${it.netUnits}</td>
              <td class="num">${money(it.netRevenue)}</td>
              <td class="num">${money(it.avgShelfValue)}</td>
              <td class="num">${it.turnover == null ? $t('—') : it.turnover}</td>
              <td class="num">${it.daysOfCover == null ? $t('—') : it.daysOfCover}</td>
              <td class="num">${money(it.grossProfit)}</td>
              <td class="num">${it.margin == null ? $t('—') : it.margin + '%'}</td>
              <td>${it.buyAgain ? `<span class="chip-static gp">${esc($t('Buy again'))}</span>` : `<span class="muted">${$t('—')}</span>`}</td>
            </tr>`).join(''),
        }) : `<p class="empty">${$t('Nothing matches that filter.')}</p>`;
      }
      return rows.length ? dataTable({
        head: [
          { label: $t('Item') },
          { label: $t('On hand'), num: true },
          { label: $t('Sold'), num: true },
          { label: $t('Cover'), num: true },
          { label: $t('Retail value'), num: true },
          { label: $t('Cost value'), num: true },
          { label: $t('Movement') },
        ],
        bodyHtml: rows.map((it) => `
          <tr>
            <td><b>${esc(it.name)}</b>${it.sku ? `<div class="muted">${esc(it.sku)}</div>` : ''}</td>
            <td class="num">${it.onHand}</td>
            <td class="num">${it.soldUnits}</td>
            <td class="num">${it.daysOfCover == null ? $t('—') : it.daysOfCover}</td>
            <td class="num">${money(it.retailValue)}</td>
            <td class="num">${money(it.costValue)}</td>
            <td>${movementChip(it.movement)}</td>
          </tr>`).join(''),
      }) : `<p class="empty">${$t('Nothing matches that filter.')}</p>`;
    }

    function draw() {
      const sum = data ? data.summary : null;
      const rows = visible();
      const win = windows();
      const sub = data
        ? (view === 'velocity'
          ? `${esc($t('Last {days} days', { days }))} · ${esc($t('Turnover'))} ${sum.turnover == null ? $t('—') : sum.turnover}`
          : `${esc($t('Last {days} days', { days }))} · ${esc($t('{retail} retail · {cost} cost', { retail: money(sum.retailValue), cost: money(sum.costValue) }))}`)
        : (view === 'velocity' ? $t('Sell-through and velocity') : $t('Inventory health and valuation'));

      root.innerHTML = `
        ${screenHead({
          title: $t('Stock Health'),
          sub,
          actions: data ? `<button class="btn btn-ghost btn-sm" id="shExport">${esc($t('Export CSV'))}</button>` : '',
        })}

        ${data ? `
        <div class="rep-chips">
          <button class="rep-chip ${view === 'health' ? 'on' : ''}" data-view="health">${$t('Health')}</button>
          <button class="rep-chip ${view === 'velocity' ? 'on' : ''}" data-view="velocity">${$t('Velocity')}</button>
        </div>
        <div class="rep-chips">
          <select class="field sh-window" id="shWindow" aria-label="${$t('Window')}">
            ${win.map((w) => `<option value="${w.days}" ${w.days === days ? 'selected' : ''}>${esc($t(w.label))}</option>`).join('')}
          </select>
          <select class="field" id="shCategory" aria-label="${$t('Category')}">
            <option value="all">${$t('All categories')}</option>
            ${data.categories.map((c) => `<option value="${esc(c.category)}" ${c.category === category ? 'selected' : ''}>${esc(c.category || $t('Uncategorised'))}</option>`).join('')}
          </select>
          <input class="field" id="shSearch" type="search" placeholder="${$t('Search products…')}" autocomplete="off">
        </div>
        ${view === 'health' ? `
        <div class="rep-chips">
          ${['all', 'slow', 'dead'].map((m) => `<button class="rep-chip ${movement === m ? 'on' : ''}" data-mv="${m}">${esc($t(m === 'all' ? 'All' : movementLabel(m)))}</button>`).join('')}
          <span class="muted sh-count">${esc($tn('{n} product', '{n} products', rows.length))}</span>
        </div>` : ''}` : ''}

        ${loading ? `<div class="empty"><p>${$t('Loading…')}</p></div>` : !data ? `<div class="empty"><p>${$t('No health report yet — try again when the store is online.')}</p></div>` : `
        ${dashKpis(sum)}

        ${view === 'velocity' ? buyAgainSection(data.buyAgain) : ''}
        ${categorySection(data.categories)}

        <section class="dash-section">
          ${sectionHead({
            title: view === 'velocity' ? $t('Products') : $t('Products'),
            asideHtml: `<span class="muted">${esc($t('{n} shown', { n: rows.length }))}</span>`,
          })}
          ${productsSection(rows)}
        </section>
        `}`;

      root.querySelector('#shExport')?.addEventListener('click', () => exportCsv(data));
      root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
        view = b.dataset.view;
        days = defaultDays();
        movement = 'all';
        load();
      }));
      const windowEl = root.querySelector('#shWindow');
      if (windowEl) windowEl.addEventListener('change', () => {
        days = Number(windowEl.value);
        load();
      });
      const catEl = root.querySelector('#shCategory');
      if (catEl) catEl.addEventListener('change', () => { category = catEl.value; draw(); });
      root.querySelectorAll('[data-mv]').forEach((b) => b.addEventListener('click', () => {
        movement = b.dataset.mv;
        draw();
      }));
      const searchEl = root.querySelector('#shSearch');
      if (searchEl) {
        let t;
        searchEl.addEventListener('input', () => {
          clearTimeout(t);
          t = setTimeout(() => { q = searchEl.value; draw(); }, 200);
        });
      }
    }

    await load();
  },
};

export function stockHealthCsv(data) {
  const esc = csvCell;
  const money = (v) => Number(v || 0).toFixed(2);
  const out = [];
  const s = data.summary;
  out.push(`Orison POS stock health,days,${data.window.days}`);
  out.push('');
  out.push('SUMMARY');
  out.push('metric,value');
  out.push(['products', String(s.products)].join(','));
  out.push(['units', String(s.units)].join(','));
  out.push(['retail_value', money(s.retailValue)].join(','));
  out.push(['cost_value', money(s.costValue)].join(','));
  out.push(['slow_products', String(s.slowCount)].join(','));
  out.push(['dead_products', String(s.deadCount)].join(','));
  out.push('');
  out.push('BY_CATEGORY');
  out.push('category,units,retail_value,cost_value');
  for (const c of data.categories) {
    out.push([c.category, String(c.units), money(c.retailValue), money(c.costValue)].map(esc).join(','));
  }
  out.push('');
  out.push('ITEMS');
  out.push('category,sku,name,on_hand,sold_units,days_of_cover,retail_price,cost_price,retail_value,cost_value,movement');
  for (const it of data.items) {
    out.push([
      it.category, it.sku, it.name, String(it.onHand), String(it.soldUnits),
      it.daysOfCover == null ? '' : String(it.daysOfCover),
      money(it.retailPrice), money(it.costPrice), money(it.retailValue), money(it.costValue),
      it.movement,
    ].map(esc).join(','));
  }
  return out.join('\n');
}

export function stockHealthVelocityCsv(data) {
  const esc = csvCell;
  const money = (v) => Number(v || 0).toFixed(2);
  const dash = (v) => v == null ? '' : String(v);
  const out = [];
  const s = data.summary;
  out.push(`Orison POS stock velocity,days,${data.window.days}`);
  out.push('');
  out.push('SUMMARY');
  out.push('metric,value');
  out.push(['products', String(s.products)].join(','));
  out.push(['units', String(s.units)].join(','));
  out.push(['net_revenue', money(s.netRevenue)].join(','));
  out.push(['gross_profit', money(s.grossProfit)].join(','));
  out.push(['avg_shelf_value', money(s.avgShelfValue)].join(','));
  out.push(['turnover', dash(s.turnover)].join(','));
  out.push(['buy_again_products', String(s.buyAgainCount)].join(','));
  out.push('');
  out.push('BY_CATEGORY');
  out.push('category,products,units,net_revenue,gross_profit,avg_shelf_value,turnover');
  for (const c of data.categories) {
    out.push([c.category, String(c.products), String(c.units), money(c.netRevenue), money(c.grossProfit), money(c.avgShelfValue), dash(c.turnover)].map(esc).join(','));
  }
  out.push('');
  out.push('ITEMS');
  out.push('category,sku,name,on_hand,units_sold,units_refunded,net_units,received_units,revenue,revenue_refunded,net_revenue,avg_shelf_value,turnover,days_of_cover,gross_profit,margin,buy_again');
  for (const it of data.items) {
    out.push([
      it.category, it.sku, it.name, String(it.onHand), String(it.unitsSold), String(it.unitsRefunded),
      String(it.netUnits), String(it.receivedUnits),
      money(it.revenueSold), money(it.revenueRefunded), money(it.netRevenue),
      money(it.avgShelfValue), dash(it.turnover), dash(it.daysOfCover),
      money(it.grossProfit), dash(it.margin), it.buyAgain ? 'yes' : 'no',
    ].map(esc).join(','));
  }
  out.push('');
  out.push('BUY_AGAIN');
  out.push('sku,name,on_hand,net_units,avg_shelf_value,turnover,days_of_cover');
  for (const it of data.buyAgain || []) {
    out.push([
      it.sku, it.name, String(it.onHand), String(it.netUnits), money(it.avgShelfValue),
      dash(it.turnover), dash(it.daysOfCover),
    ].map(esc).join(','));
  }
  return out.join('\n');
}

function exportCsv(data) {
  const name = data.view === 'velocity' ? 'orison-stock-velocity.csv' : 'orison-stock-health.csv';
  const csv = data.view === 'velocity' ? stockHealthVelocityCsv(data) : stockHealthCsv(data);
  downloadCsv(name, csv);
  const label = data.view === 'velocity' ? $t('Stock velocity CSV') : $t('Stock health CSV');
  toast(label, 'ok');
  beep('ok');
}