'use strict';

import { $t, $tn, N_ } from '../lang.js';

/* Stock health (v1.51.0): what the shelf is worth at retail and at cost, and
   how fast each product sells. Everything is computed server-side from the
   ledger and the catalog — this screen never trusts cached client stock for
   a number that goes into a buying or pricing decision. */

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

    let days = 90;
    let category = 'all';
    let movement = 'all';
    let q = '';
    let data = null;
    let loading = false;

    function money(v) { return fmt(v == null ? 0 : v); }

    async function load() {
      loading = true;
      draw();
      try {
        data = await api.get(`/api/inventory/health?days=${encodeURIComponent(days)}`);
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
        && (!mv || it.movement === mv)
        && (!needle || it.name.toLowerCase().includes(needle) || (it.sku || '').toLowerCase().includes(needle)));
    }

    function draw() {
      const sum = data ? data.summary : null;
      const rows = visible();

      root.innerHTML = `
        ${screenHead({
          title: $t('Stock Health'),
          sub: sum ? `${esc($t('Last {days} days', { days }))} · ${esc($t('{retail} retail · {cost} cost', { retail: money(sum.retailValue), cost: money(sum.costValue) }))}` : $t('Inventory health and valuation'),
          actions: data ? `<button class="btn btn-ghost btn-sm" id="shExport">${esc($t('Export CSV'))}</button>` : '',
        })}

        ${data ? `
        <div class="rep-chips">
          <select class="field sh-window" id="shWindow" aria-label="${$t('Window')}">
            ${WINDOWS.map((w) => `<option value="${w.days}" ${w.days === days ? 'selected' : ''}>${esc($t(w.label))}</option>`).join('')}
          </select>
          <select class="field" id="shCategory" aria-label="${$t('Category')}">
            <option value="all">${$t('All categories')}</option>
            ${data.categories.map((c) => `<option value="${esc(c.category)}" ${c.category === category ? 'selected' : ''}>${esc(c.category || $t('Uncategorised'))}</option>`).join('')}
          </select>
          <input class="field" id="shSearch" type="search" placeholder="${$t('Search products…')}" autocomplete="off">
        </div>
        <div class="rep-chips">
          ${['all', 'slow', 'dead'].map((m) => `<button class="rep-chip ${movement === m ? 'on' : ''}" data-mv="${m}">${esc($t(m === 'all' ? 'All' : movementLabel(m)))}</button>`).join('')}
          <span class="muted sh-count">${esc($tn('{n} product', '{n} products', rows.length))}</span>
        </div>` : ''}

        ${loading ? `<div class="empty"><p>${$t('Loading…')}</p></div>` : !data ? `<div class="empty"><p>${$t('No health report yet — try again when the store is online.')}</p></div>` : `
        <div class="dash-kpis">
          <div class="dash-kpi"><span>${$t('Stock at cost')}</span><strong>${money(sum.costValue)}</strong></div>
          <div class="dash-kpi"><span>${$t('Stock at retail')}</span><strong>${money(sum.retailValue)}</strong></div>
          <div class="dash-kpi"><span>${$t('Units on hand')}</span><strong>${sum.units}</strong></div>
          <div class="dash-kpi warn"><span>${$t('Slow')}</span><strong>${sum.slowCount}</strong></div>
          <div class="dash-kpi warn"><span>${$t('Dead')}</span><strong>${sum.deadCount}</strong></div>
        </div>

        <section class="dash-section">
          ${sectionHead({
            title: $t('Categories'),
            asideHtml: `<span class="muted">${$t('valued at cost')}</span>`,
          })}
          ${data.categories.length ? dataTable({
            head: [{ label: $t('Category') }, { label: $t('Units'), num: true }, { label: $t('Retail'), num: true }, { label: $t('Cost'), num: true }],
            bodyHtml: data.categories.map((c) => `
              <tr>
                <td><b>${esc(c.category || $t('Uncategorised'))}</b></td>
                <td class="num">${c.units}</td>
                <td class="num">${money(c.retailValue)}</td>
                <td class="num">${money(c.costValue)}</td>
              </tr>`).join(''),
          }) : `<p class="empty">${$t('Nothing in stock.')}</p>`}
        </section>

        <section class="dash-section">
          ${sectionHead({
            title: $t('Products'),
            asideHtml: `<span class="muted">${esc($t('{n} shown', { n: rows.length }))}</span>`,
          })}
          ${rows.length ? dataTable({
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
          }) : `<p class="empty">${$t('Nothing matches that filter.')}</p>`}
        </section>
        `}`;

      root.querySelector('#shExport')?.addEventListener('click', () => exportCsv(data));
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

function exportCsv(data) {
  downloadCsv('orison-stock-health.csv', stockHealthCsv(data));
  toast($t('Stock health CSV'), 'ok');
  beep('ok');
}