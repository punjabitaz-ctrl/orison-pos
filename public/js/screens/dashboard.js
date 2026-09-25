'use strict';

import { $t, $tn, N_, dateLocale } from '../lang.js';

/* Dashboard: role-aware home screen. Cashiers see their own day with the same
   trend context managers get; managers and admins add store-wide KPIs, an
   hour-by-hour read on today, a 14-day revenue chart, a top-seller table, the
   shift picture, low-stock alerts, and one-click CSV export to Drive. All
   aggregation lives in stats.js so every surface agrees on the numbers. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { fmt, esc, toast, beep, openModal, closeModal, skeleton, emptyState, currencySymbol, denomLabel } from '../ui.js';
import { SYNC_EVENT, getDeviceId } from '../sync.js';
import { inventoryAlerts } from '../alerts.js';
import { openPayoutDialog } from '../money-dialogs.js';
import { openWarrantyLookup } from '../warranty.js';
import { screenHead, sectionHead, statRow, dataTable, rankList, rankRow, roleLabel } from '../components.js';
import {
  dayKey, shiftDayKey, dayTotals, trend, baselineAverage, hourlyBuckets,
  tradingWindow, busiestHour, topSellers, withinDays, signedNet, kindOf,
} from '../stats.js';

const MANAGER_ROLES = ['admin', 'manager'];

const todayKey = (offsetDays = 0) => shiftDayKey(offsetDays);
const dayKeyOf = (iso) => dayKey(iso);

function money(v) {
  return fmt(v || 0);
}

export const screen = {
  id: 'dashboard',
  tab: 'dashboard',
  title: 'Dashboard',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const { state, router } = ctx;
    const user = state.user || (await idb.get('meta', 'config'))?.user || {};
    const role = user.role || 'cashier';
    const isManager = MANAGER_ROLES.includes(role);

    const today = todayKey();
    let txs = [];
    let products = [];
    let pending = 0;
    let server = true;
    let conflicts = [];
    let shifts = [];
    let report = null;
    let reminders = null;

    function scope() {
      return isManager ? txs : txs.filter((t) => String(t.user_id) === String(user.id));
    }

    /* v1.25.0 caps every page at 100 rows. The dashboard only ever needs
       today for its KPIs and hourly chart, so it pages through today rather
       than asking for a slab of the ledger - bounded, because one day cannot
       run away. The 14-day chart and 30-day top sellers come from the server's
       own aggregate instead (see loadAggregate). */
    async function fetchToday() {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const out = [];
      let cursor = '';
      for (let page = 0; page < 10; page++) {
        const qs = ['limit=100', 'from=' + encodeURIComponent(from.toISOString())];
        if (cursor) qs.push('cursor=' + encodeURIComponent(cursor));
        const res = await api.get('/api/transactions?' + qs.join('&'));
        out.push(...(res.transactions || []));
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
      return { transactions: out };
    }

    async function load(opts) {
      const forceFresh = !!(opts && opts.fresh);
      const [prods, res, outbox, con, shiftRes, rep, rem] = await Promise.all([
        idb.getAll('products').catch(() => []),
        navigator.onLine
          ? fetchToday().catch((err) => { server = !(err && err.offline); return { ok: false }; })
          : Promise.resolve({ ok: false }),
        idb.getAll('outbox').catch(() => []),
        navigator.onLine && isManager
          ? api.get('/api/conflicts').catch(() => ({ conflicts: [] }))
          : Promise.resolve({ conflicts: [] }),
        navigator.onLine
          ? api.get('/api/shifts').catch(() => ({ shifts: [] }))
          : Promise.resolve({ shifts: [] }),
        /* the 14-day chart and the 30-day top sellers come from the server's
           own aggregate: it is not capped, and it applies line and order
           discounts the client can only approximate. */
        navigator.onLine && isManager
          ? api.get(`/api/reports?from=${todayKey(29)}&to=${todayKey(0)}`).catch(() => null)
          : Promise.resolve(null),
        /* the manager's morning list: what is expiring, sitting ready, waiting
           on an upgrade, or sitting as store credit. */
        navigator.onLine && isManager
          ? api.get('/api/reminders' + (forceFresh ? '?fresh=1' : '')).catch(() => null)
          : Promise.resolve(null),
      ]);
      products = prods;
      txs = (res && res.transactions) || [];
      pending = outbox.filter((o) => o.status === 'PENDING').length;
      conflicts = (con && con.conflicts) || [];
      shifts = (shiftRes && shiftRes.shifts) || [];
      report = rep;
      reminders = rem || null;
      draw();
    }

    function draw() {
      const relevant = scope();
      const now = new Date();
      const d0 = dayTotals(relevant, today);
      const d1 = dayTotals(relevant, todayKey(1));
      const netTrend = trend(d0.net, d1.net);
      const ticketTrend = trend(d0.tickets, d1.tickets);
      const gpTrend = trend(d0.gp, baselineAverage(relevant, today, 7, 'gp'));
      const avgTrend = trend(d0.avgTicket, d1.avgTicket);
      const hours = hourlyBuckets(relevant, today);
      const peak = busiestHour(hours);
      const sellers = report
        ? (report.topProducts || []).slice(0, 5).map((p) => ({
            name: p.name, units: p.units, rev: p.sales, gp: p.gp,
            margin: p.sales ? (p.gp / p.sales) * 100 : 0,
          }))
        : topSellers(withinDays(relevant, 30), 5);
      const sellerWindow = report ? (report.summary || {}).salesCount || 0
        : withinDays(relevant, 30).filter((t) => kindOf(t) === 'sale').length;

      const recent = [...relevant].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 4);
      const alerts = inventoryAlerts(products);
      const aOut = alerts.filter((a) => a.severity === 'out').length;
      const aLow = alerts.filter((a) => a.severity === 'low').length;
      const aLocked = alerts.filter((a) => a.severity === 'locked').length;
      const aAging = alerts.filter((a) => a.aging).length;

      root.innerHTML = `
        ${screenHead({
          title: $t('Dashboard'),
          sub: `${now.toLocaleDateString(dateLocale(), { weekday: 'long', month: 'long', day: 'numeric' })} · ${$t(roleLabel(role))}`,
          actions: `<button class="icon-btn" id="dashRefresh" aria-label="${$t('Refresh')}">⟳</button>`,
        })}

        <div class="dash-kpis">
          <div class="dash-kpi">
            <span>${$t('Net revenue today')}</span><strong>${money(d0.net)}</strong>
            ${trendBadge(netTrend, 'money', $t('vs yesterday'))}
          </div>
          <div class="dash-kpi">
            <span>${$t('Sales today')}</span><strong>${d0.tickets}</strong>
            ${trendBadge(ticketTrend, 'count', $t('vs yesterday'))}
          </div>
          <div class="dash-kpi">
            <span>${$t('Avg ticket')}</span><strong>${money(d0.avgTicket)}</strong>
            ${trendBadge(avgTrend, 'money', $t('vs yesterday'))}
          </div>
          <div class="dash-kpi"><span>${$t('Units today')}</span><strong>${d0.units}</strong></div>
          ${isManager ? `
          <div class="dash-kpi warn"><span>${$t('Refunds')}</span><strong>−${money(d0.refunds)}</strong></div>
          <div class="dash-kpi warn">
            <span>${$t('Cash out')}</span><strong>−${money(d0.cashOut)}</strong>
            <em class="kpi-split">${esc($t('{paid} paid · {picked} picked up · {staff} staff', { paid: money(d0.payouts), picked: money(d0.pickups), staff: money(d0.expenses) }))}</em>
          </div>
          <div class="dash-kpi"><span>${$t('Collected')}</span><strong>${money(d0.collections)}</strong></div>
          <div class="dash-kpi dash-gp">
            <span>${$t('Gross profit today')}</span><strong>${money(d0.gp)}</strong>
            ${trendBadge(gpTrend, 'money', $t('vs 7-day avg'))}
          </div>` : ''}
        </div>

        ${isManager ? remindersHtml(reminders, money) : ''}

        <section class="dash-section">
          <h3>${$t('Shift')}</h3>
          ${myOpenShift().length ? `
            <div class="shift-card">
              <div>
                <strong>${$t('Shift open')}</strong>
                <p class="muted">${esc($t('since {when} · float {amount}', { when: humanDate(myOpenShift()[0].openedAt), amount: money(myOpenShift()[0].openingFloat) }))}</p>
              </div>
              <button class="btn" id="shiftClose">${$t('Close &amp; count')}</button>
            </div>` : `
            <div class="shift-card">
              <div><strong>${$t('No open shift')}</strong><p class="muted">${$t('Open one to reconcile the till when you close. Sales run fine either way.')}</p></div>
              <button class="btn" id="shiftOpen">${$t('Open shift')}</button>
            </div>`}
          ${isManager ? shiftSummary(shifts, today) : ''}
        </section>

        ${isManager ? `
        <section class="dash-section">
          ${sectionHead({ title: $t('Today by hour'), aside: peak ? $t('busiest {hour} · {amount}', { hour: hourLabel(peak.hour), amount: money(peak.sales) }) : $t('no sales yet today') })}
          <div class="dash-chart">${hourChart(hours)}</div>
        </section>

        <section class="dash-section">
          <h3>${$t('Revenue — last 14 days')}</h3>
          <div class="dash-chart">${barChart(report ? reportDays(report) : last14(txs))}</div>
        </section>

        ${openConflicts(conflicts).length ? `
        <section class="dash-section">
          <div class="dash-conf-banner">
            <div>
              <strong>${esc($tn('{n} sync conflict awaiting review', '{n} sync conflicts awaiting review', openConflicts(conflicts).length))}</strong>
              <p class="muted">${esc($t('Two terminals disagreed on {what}.', { what: openStr(openConflicts(conflicts)) }))}</p>
            </div>
            <button class="btn btn-sm" id="dashReviewConf">${$t('Review')}</button>
          </div>
        </section>` : ''}
        ${conflicts.length && conflicts.some((c) => c.status !== 'OPEN') ? `
        <section class="dash-section">
          <details class="dash-details">
            <summary>${esc($t('Reviewed conflicts ({n})', { n: conflicts.filter((c) => c.status !== 'OPEN').length }))}</summary>
            ${conflicts.filter((c) => c.status !== 'OPEN').slice(0, 10).map((c) => rankRow({
              name: conflictType(c.type),
              meta: c.summary,
              rightHtml: `<span class="tag-warn">${esc(conflictState(c.status))}</span>`,
            })).join('')}
          </details>
        </section>` : ''}

        <section class="dash-section">
          ${sectionHead({ title: $t('Top sellers'), aside: $tn('last 30 days · {n} sale', 'last 30 days · {n} sales', sellerWindow) })}
          ${sellers.length
            ? dataTable({
                head: [{ label: '#' }, { label: $t('Item') }, { label: $t('Units'), num: true }, { label: $t('Revenue'), num: true }, { label: $t('Margin'), num: true }],
                bodyHtml: `
                    ${sellers.map((t, i) => `
                      <tr>
                        <td class="rank-cell">${i + 1}</td>
                        <td>${esc(t.name)}</td>
                        <td class="num">${t.units}</td>
                        <td class="num">${money(t.rev)}</td>
                        <td class="num ${t.gp < 0 ? 'neg' : 'gp'}">${money(t.gp)}${t.rev ? ' <em class="muted">' + t.margin.toFixed(0) + '%</em>' : ''}</td>
                      </tr>`).join('')}`,
              })
            : emptyState({ icon: '🏷', title: $t('No sales synced yet'), body: $t('Top sellers appear once sales reach the server.') })}
        </section>

        <section class="dash-section">
          <h3>${$t('Inventory alerts')}</h3>
          ${(aOut + aLow + aLocked + aAging)
            ? `<div class="rank-list">
                ${[
                  { idx: aOut, idxCls: 'warn', name: $t('Out of stock'), meta: $t('need re-supply') },
                  { idx: aLow, idxCls: 'warn', name: $t('Low stock'), meta: $t('at or below reorder point') },
                  { idx: aLocked, name: $t('Locked'), meta: $t('held from sale by admin') },
                  { idx: aAging, idxCls: 'warn', name: $t('Paying dust'), meta: $t('not sold in 30+ days') },
                ].map((r) => rankRow(r)).join('')}
              </div>
              <div class="row dash-actions">
                <button class="btn" id="dashAlerts">${$t('Open alerts')}</button>
              </div>`
            : `<p class="muted">${$t('All stocked & selling.')}</p>
               <button class="btn btn-ghost btn-sm" id="dashAlerts">${$t('Open alerts')}</button>`}
        </section>

        <div class="row dash-actions">
          <button class="btn" id="dashExport">${$t('Export today → Drive')}</button>
          <button class="btn" id="dashInventory">${$t('Inventory')}</button>
          <button class="btn btn-ghost" id="dashPayout">${$t('Record paid out')}</button>
        </div>
        ` : `
        <section class="dash-section">
          <h3>${$t('New sale')}</h3>
          <button class="btn btn-block" id="dashSell">${$t('Open Register')}</button>
        </section>

        <div class="row dash-actions">
          <button class="btn" id="dashExport">${$t('My report today → Drive')}</button>
          <button class="btn btn-ghost" id="dashStaff">${$t('Time clock')}</button>
        </div>

        <section class="dash-section">
          ${sectionHead({ title: $t('My day by hour'), aside: peak ? $t('busiest {hour}', { hour: hourLabel(peak.hour) }) : $t('no sales yet today') })}
          <div class="dash-chart">${hourChart(hours)}</div>
        </section>

        <section class="dash-section">
          <h3>${$t('My recent')}</h3>
          ${pending > 0 ? `<p class="muted">${esc($tn('{n} awaiting sync', '{n} awaiting sync', pending))}</p>` : ''}
          ${recent.length ? `<div class="hx-list" style="padding:0">${recent.map((t) => `
            <button class="hx-card" data-go-history>
              <div class="hx-left">
                <span class="hx-date">${humanDate(t.createdAt)}</span>
                <span class="hx-status st-synced">${$t('On server')}</span>
              </div>
              <div class="hx-right"><strong>${money(t.grandTotal)}</strong></div>
            </button>`).join('')}</div>`
            : emptyState({ icon: '🛒', title: $t('No sales yet'), body: $t('Ring your first sale from the register.') })}
        </section>

        <button class="btn btn-block" id="dashHistory">${$t('View full history')}</button>
        `}

        ${!server ? `<p class="muted" style="padding:0 16px 4px">${$t('Offline — showing last synced data.')}</p>` : ''}`;

      root.querySelector('#dashRefresh').addEventListener('click', () => load({ fresh: true }));
      const sellBtn = root.querySelector('#dashSell');
      if (sellBtn) sellBtn.addEventListener('click', () => router.show('register'));
      const histBtn = root.querySelector('#dashHistory');
      if (histBtn) histBtn.addEventListener('click', () => router.show('history'));
      const invBtn = root.querySelector('#dashInventory');
      if (invBtn) invBtn.addEventListener('click', () => router.show('inventory'));
      const alertBtn = root.querySelector('#dashAlerts');
      if (alertBtn) alertBtn.addEventListener('click', () => router.show('alerts'));
      const staffBtn = root.querySelector('#dashStaff');
      if (staffBtn) staffBtn.addEventListener('click', () => router.show('staff'));
      const payoutBtn = root.querySelector('#dashPayout');
      if (payoutBtn) payoutBtn.addEventListener('click', () => openPayoutDialog(ctx, load));
      const shiftOpenBtn = root.querySelector('#shiftOpen');
      if (shiftOpenBtn) shiftOpenBtn.addEventListener('click', openShiftModal);
      const shiftCloseBtn = root.querySelector('#shiftClose');
      if (shiftCloseBtn) shiftCloseBtn.addEventListener('click', () => closeShiftModal(myOpenShift()[0]));
      const expBtn = root.querySelector('#dashExport');
      if (expBtn) expBtn.addEventListener('click', () => exportDay(expBtn));
      root.querySelectorAll('[data-go-history]').forEach((b) => b.addEventListener('click', () => router.show('history')));
      root.querySelectorAll('[data-rem-go]').forEach((el) => el.addEventListener('click', () => {
        const go = el.dataset.remGo;
        const serial = el.dataset.serial || '';
        if (go === 'repairs') router.show('repairs');
        else if (go === 'customers') router.show('customers');
        else if (go === 'salesreport') router.show('salesreport');
        else if (go === 'warranty') openWarrantyLookup(serial);
      }));
      const revBtn = root.querySelector('#dashReviewConf');
      if (revBtn) revBtn.addEventListener('click', () => {
        const open = openConflicts(conflicts);
        const sect = revBtn.closest('section');
        if (!sect) return;
        sect.innerHTML = `
          <div class="dash-conf-banner col">
            ${open.map((c) => `
              <div class="conf-item">
                <div class="rank-main">
                  <div class="rank-name">${esc(conflictType(c.type))}</div>
                  <div class="muted">${esc(c.summary)}</div>
                  <div class="muted" style="font-size:11px">${esc($t('device {device} · {when} · tx {tx}', { device: (c.deviceId || '').slice(0, 8), when: humanDate(c.createdAt), tx: c.loserClientTx || '' }))}</div>
                </div>
                <div class="conf-acts">
                  <button class="btn btn-sm" data-conf-act="resolve" data-cid="${esc(c.id)}">${$t('Keep winner')}</button>
                  <button class="btn btn-sm btn-ghost" data-conf-act="dismiss" data-cid="${esc(c.id)}">${$t('Dismiss')}</button>
                </div>
              </div>`).join('')}
          </div>`;
      });
    }

    async function exportDay(btn) {
      btn.disabled = true;
      btn.textContent = $t('Exporting…');
      try {
        const res = await api.post('/api/drive/export', { date: today }, { timeout: 25000 });
        toast($tn('Exported {n} transaction → Drive', 'Exported {n} transactions → Drive', res.rows), 'ok');
        beep('ok');
        if (res.url) window.open(res.url, '_blank');
      } catch (err) {
        toast((err && err.message) || $t('Export failed'), 'warn');
      }
      btn.disabled = false;
      btn.textContent = $t('Export today → Drive');
    }

    function myOpenShift() {
      return shifts.filter((s) => s.status === 'OPEN' && String(s.userId) === String(user.id));
    }

    /* The ladder is whatever the store was set up with — counting a drawer
       against notes it does not hold is how a declared total goes wrong. */
    function storeDenoms() {
      const d = (state.store && state.store.denoms) || [];
      return d.length ? d : [100, 50, 20, 10, 5, 1];
    }

    function currencyGrid(sumEl) {
      const denoms = storeDenoms();
      const recalc = () => {
        let cents = 0;
        for (const d of denoms) {
          const v = Number(sumEl.querySelector(`[data-d="${d}"]`).value) || 0;
          cents += Math.round(d * 100) * Math.round(v);
        }
        const total = cents / 100;
        sumEl.querySelector('[data-sum]').textContent = money(total);
        sumEl._declared = total;
      };
      const grid = denoms.map((d) => `
        <div class="den-row">
          <span class="den-label">${esc(denomLabel(d))}</span>
          <input class="field den-qty" data-d="${d}" type="number" min="0" step="1" value="0" inputmode="numeric">
        </div>`).join('');
      sumEl.innerHTML = `
        <div class="den-grid">${grid}</div>
        <div class="den-total">${$t('Declared cash')} <strong data-sum>${money(0)}</strong></div>`;
      sumEl.querySelectorAll('.den-qty').forEach((inp) => {
        inp.addEventListener('input', recalc);
        inp.addEventListener('focus', () => inp.select());
      });
      recalc();
      return sumEl;
    }

    function openShiftModal() {
      const modalEl = openModal(`
        <div class="tx-detail">
          <button class="icon-btn abs-close" data-x>✕</button>
          <h3>${$t('Open shift')}</h3>
          <p class="muted">${$t('Start with the float you put in the drawer. The till isn\'t locked either way.')}</p>
          <label class="field-label">${esc($t('Opening float ({symbol})', { symbol: currencySymbol() }))}
            <input class="field" id="sh-float" type="number" min="0" step="0.01" placeholder="0.00" value="0">
          </label>
          <label class="field-label">${$t('Note (optional)')}
            <input class="field" id="sh-note" placeholder="${$t('e.g. morning shift')}">
          </label>
          <button class="btn btn-block" id="sh-open-confirm" style="--bg:#2e7d32">${$t('Open shift')}</button>
        </div>`);
      modalEl.querySelector('[data-x]').addEventListener('click', closeModal);
      const confirm = modalEl.querySelector('#sh-open-confirm');
      confirm.addEventListener('click', async () => {
        const float = Number(modalEl.querySelector('#sh-float').value);
        if (!(float >= 0)) { toast($t('Enter a float'), 'warn'); return; }
        confirm.disabled = true;
        try {
          await api.post('/api/shifts/open', {
            openingFloat: float,
            note: modalEl.querySelector('#sh-note').value.trim(),
            deviceId: await getDeviceId(),
          });
          closeModal();
          toast($t('Shift opened'), 'ok'); beep('ok');
          await load();
        } catch (err) {
          confirm.disabled = false;
          toast((err && err.message) || $t('Couldn’t open shift'), 'warn');
        }
      });
    }

    function closeShiftModal(shift) {
      const sumEl = document.createElement('div');
      currencyGrid(sumEl);
      const modalEl = openModal(`
        <div class="tx-detail">
          <button class="icon-btn abs-close" data-x>✕</button>
          <h3>${$t('Close shift')}</h3>
          <p class="muted">${esc($t('Opened {when} · float {amount}. Count the drawer and enter quantities.', { when: humanDate(shift.openedAt), amount: money(shift.openingFloat) }))}</p>
          <div id="denBox"></div>
          <label class="field-label">${$t('Note (optional)')}
            <input class="field" id="shc-note" placeholder="${$t('e.g. busy morning, tax collected')}">
          </label>
          <button class="btn btn-block" id="shc-confirm" style="--bg:#0b3d66">${$t('Close &amp; reconcile')}</button>
        </div>`);
      modalEl.querySelector('#denBox').appendChild(sumEl);
      modalEl.querySelector('[data-x]').addEventListener('click', closeModal);
      const confirm = modalEl.querySelector('#shc-confirm');
      confirm.addEventListener('click', async () => {
        const denoms = {};
        for (const d of storeDenoms()) denoms[d] = Number(sumEl.querySelector(`[data-d="${d}"]`).value) || 0;
        confirm.disabled = true;
        try {
          const res = await api.post('/api/shifts/close', {
            shiftId: shift.id,
            denoms,
            note: modalEl.querySelector('#shc-note').value.trim(),
          });
          closeModal();
          const s = res.shift;
          const diff = Number(s.overShort) || 0;
          showCloseResult(s, diff);
          await load();
        } catch (err) {
          confirm.disabled = false;
          toast((err && err.message) || $t('Couldn’t close shift'), 'warn');
        }
      });
    }

    function showCloseResult(s, diff) {
      const modalEl = openModal(`
        <div class="tx-detail">
          <button class="icon-btn abs-close" data-x>✕</button>
          <h3>${$t('Shift closed')}</h3>
          <div class="ledger-bal">
            <div><span>${$t('Declared')}</span><b>${money(s.declaredCash)}</b></div>
            <div><span>${$t('Expected')}</span><b>${money(s.expectedCash)}</b></div>
            <div class="lg-total"><span>${$t('Over / short')}</span><strong class="${diff === 0 ? 'gp' : diff > 0 ? 'gp' : 'neg'}">${diff > 0 ? '+' : ''}${money(diff)}</strong></div>
          </div>
          <p class="muted">${diff === 0 ? $t('The drawer balances exactly.') : diff > 0 ? $t('There is more cash than the register expects — check the count and prior payouts.') : $t('Cash is less than expected — check the drawer before signing off.')}</p>
          <button class="btn btn-block" id="res-ok" style="--bg:#2e7d32">${$t('Done')}</button>
        </div>`);
      modalEl.querySelector('[data-x]').addEventListener('click', closeModal);
      modalEl.querySelector('#res-ok').addEventListener('click', closeModal);
    }

    root.innerHTML = `
      ${screenHead({ title: $t('Dashboard'), sub: $t('Loading today’s numbers…') })}
      ${skeleton('kpis', isManager ? 8 : 4)}
      ${skeleton('chart', 1)}
      ${skeleton('rows', 3)}`;

    /* A workbook nobody has configured trades in a default currency with a
       default cash ladder. That is a decision, not a setting, so the first
       admin to reach the dashboard is asked to make it — once. Anyone else
       sees the store as it stands until an admin sets it up. */
    if (role === 'admin' && state.store && state.store.configured === false && navigator.onLine) {
      import('./store-setup.js').then(({ openStoreSetup }) => {
        openStoreSetup({
          store: state.store,
          firstRun: true,
          onSaved: async (saved) => { state.store = saved; await load(); },
        });
      }).catch(() => {});
    }

    const onSync = () => { load(); };
    window.addEventListener(SYNC_EVENT, onSync);

    const onAct = async (e) => {
      const btn = e.target.closest('[data-conf-act]');
      if (!btn) return;
      btn.disabled = true;
      const cid = btn.dataset.cid;
      const act = btn.dataset.confAct;
      try {
        await api.post('/api/conflicts/review', { id: cid, decision: act });
        toast($t('Conflict reviewed'), 'ok'); beep('ok');
        await load();
      } catch (err) {
        toast((err && err.message) || $t('Review failed'), 'warn');
        btn.disabled = false;
      }
    };
    root.addEventListener('click', onAct);

    await load();

    return () => {
      window.removeEventListener(SYNC_EVENT, onSync);
      root.removeEventListener('click', onAct);
    };
  },
};

/* Conflict codes and review states, as people read them. */
const CONFLICT_TYPES = { SERIAL_CLAIM: N_('Serial sold twice'), DUPLICATE_CLIENT: N_('Duplicate sale'), CLOCK_SKEW: N_('Terminal clock out of range') };
const CONFLICT_STATES = { OPEN: N_('Open'), RESOLVED: N_('Resolved'), DISMISSED: N_('Dismissed') };
const conflictType = (c) => (CONFLICT_TYPES[c] ? $t(CONFLICT_TYPES[c]) : String(c || ''));
const conflictState = (s) => (CONFLICT_STATES[s] ? $t(CONFLICT_STATES[s]) : String(s || ''));

/* ---- aggregation helpers ---- */

function openConflicts(all) {
  return (all || []).filter((c) => c.status === 'OPEN');
}

function openStr(open) {
  const reasons = {};
  for (const c of open) reasons[c.type] = (reasons[c.type] || 0) + 1;
  return Object.keys(reasons).map((k) => `${reasons[k]}× ${conflictType(k)}`).join(', ') || $t('a sale');
}

function last14(txs) {
  const buckets = [];
  for (let i = 13; i >= 0; i--) {
    const key = todayKey(i);
    const d = new Date();
    d.setDate(d.getDate() - i);
    buckets.push({ key, date: d, total: 0, count: 0 });
  }
  for (const t of txs) {
    const k = dayKeyOf(t.createdAt);
    for (const b of buckets) {
      if (b.key === k) {
        b.total += signedNet(t);
        b.count += 1;
        break;
      }
    }
  }
  return buckets;
}

function barChart(buckets) {
  const W = 340, H = 116, PAD = 8, H2 = 86, base = H - H2;
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const bw = (W - PAD * 2) / buckets.length;
  const bars = buckets.map((b, i) => {
    const h = Math.max(2, Math.round((b.total / max) * H2));
    const x = Math.round(PAD + i * bw + bw * 0.15);
    const w = Math.round(bw * 0.7);
    const y = base + H2 - h;
    const label = b.date.getDate();
    return `
      <g>
        <title>${b.date.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' })} — ${money(b.total)} (${b.count})</title>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${b.total ? '#1c5d99' : '#dfe6ee'}"></rect>
        <text x="${x + w / 2}" y="${H - 3}" text-anchor="middle" font-size="8" fill="#7b8ca0">${label}</text>
      </g>`;
  }).join('');
  const grid = [0, 0.5, 1].map((f) => {
    const y = Math.round(base + H2 - f * H2);
    return `<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#eef2f7" stroke-width="1"></line>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" aria-label="${esc($t('Revenue last 14 days'))}">${grid}${bars}</svg>`;
}




function humanDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(dateLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
/* Direction chip under a KPI: an arrow, the size of the move, and what it is
   measured against. A zero baseline has no honest percentage, so it shows the
   absolute move instead of a fabricated one. */
function trendBadge(t, unit = 'money', label = '') {
  if (!t) return '';
  const arrow = t.dir === 'up' ? '\u2191' : (t.dir === 'down' ? '\u2193' : '\u2192');
  const mag = t.pct == null
    ? (unit === 'money' ? money(Math.abs(t.delta)) : String(Math.abs(t.delta)))
    : Math.abs(t.pct).toFixed(t.pct !== 0 && Math.abs(t.pct) < 10 ? 1 : 0) + '%';
  const cls = t.dir === 'flat' ? 'flat' : (t.dir === 'up' ? 'up' : 'down');
  return `<em class="kpi-trend ${cls}">${arrow} ${esc(mag)}${label ? ' <span>' + esc(label) + '</span>' : ''}</em>`;
}

function hourLabel(h) {
  const hh = ((Number(h) || 0) % 24 + 24) % 24;
  const ampm = hh < 12 ? 'am' : 'pm';
  const base = hh % 12 === 0 ? 12 : hh % 12;
  return `${base}${ampm}`;
}

/* Today, hour by hour, across the trading window only — an all-night axis
   would squash the day into a sliver. Bars carry a title so a long-press or
   hover names the hour and its takings. */
function hourChart(buckets) {
  const win = tradingWindow(buckets);
  const slice = buckets.slice(win.from, win.to + 1);
  const W = 340, H = 116, PAD = 8, H2 = 82, base = H - H2 - 12;
  const max = Math.max(1, ...slice.map((b) => b.sales));
  const bw = (W - PAD * 2) / Math.max(1, slice.length);
  const bars = slice.map((b, i) => {
    const h = b.sales > 0 ? Math.max(3, Math.round((b.sales / max) * H2)) : 2;
    const x = Math.round(PAD + i * bw + bw * 0.18);
    const w = Math.max(2, Math.round(bw * 0.64));
    const y = base + H2 - h;
    const showLabel = slice.length <= 14 || i % 2 === 0;
    return `
      <g>
        <title>${hourLabel(b.hour)} — ${money(b.sales)} (${b.count})</title>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${b.sales ? '#c9982a' : '#e6ebf2'}"></rect>
        ${showLabel ? `<text x="${x + w / 2}" y="${H - 3}" text-anchor="middle" font-size="8" fill="#7b8ca0">${hourLabel(b.hour)}</text>` : ''}
      </g>`;
  }).join('');
  const grid = [0, 0.5, 1].map((f) => {
    const y = Math.round(base + H2 - f * H2);
    return `<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#eef2f7" stroke-width="1"></line>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc($t('Sales by hour today'))}">${grid}${bars}</svg>`;
}

/* The store's shift picture at a glance: who is still open, what closed today,
   and whether the drawers balanced. The detail lives on the Staff screen. */
function shiftSummary(shifts, today) {
  const rows = shifts || [];
  const open = rows.filter((s) => s.status === 'OPEN');
  const closedToday = rows.filter((s) => s.status === 'CLOSED' && dayKey(s.closedAt) === today);
  const net = closedToday.reduce((sum, s) => sum + (Number(s.overShort) || 0), 0);
  const recent = rows.filter((s) => s.status === 'CLOSED').slice(0, 3);
  return `
    ${statRow([
      { label: $t('Open now'), value: open.length },
      { label: $t('Closed today'), value: closedToday.length },
      { label: $t('Over / short today'), valueHtml: `${net > 0 ? '+' : ''}${money(net)}`, cls: net === 0 ? '' : (net > 0 ? 'gp' : 'neg') },
    ], 'shift-stats')}
    ${recent.length ? rankList(recent.map((s) => ({
      name: s.userName,
      meta: $t('{when} · expected {amount}', { when: humanDate(s.closedAt), amount: money(s.expectedCash) }),
      rightHtml: `<b class="${Number(s.overShort) === 0 ? 'gp' : 'neg'}">${Number(s.overShort) > 0 ? '+' : ''}${money(s.overShort)}</b>`,
    }))) : `<p class="muted">${$t('No closed shifts yet.')}</p>`}
    <div class="row dash-actions"><button class="btn btn-ghost btn-sm" id="dashStaff">${$t('Staff &amp; time clock')}</button></div>`;
}

/* The server's by-day figures, padded to the last 14 calendar days so the
   chart keeps a fixed shape whether or not the shop traded every day. */
function reportDays(report) {
  const byKey = new Map((report.byDay || []).map((d) => [d.date, d]));
  const buckets = [];
  for (let i = 13; i >= 0; i--) {
    const key = todayKey(i);
    const d = new Date();
    d.setDate(d.getDate() - i);
    const hit = byKey.get(key);
    buckets.push({ key, date: d, total: hit ? hit.sales : 0, count: hit ? hit.count : 0 });
  }
  return buckets;
}

/* Reminders (v1.55.0): one read-only morning list for the manager, drawn from
   what the sheet already knows. Each row jumps to the screen that owns the
   decision — a warranty lookup for an expiring cover, the bench for a ready
   repair, the customer file for an upgrade nudge or leftover credit. */
function remLink(go, serial = '') {
  return `data-rem-go="${esc(go)}"${serial ? ` data-serial="${esc(serial)}"` : ''}`;
}

function remDate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' }) : '—';
}

export function remindersHtml(rem, money) {
  if (!rem) return '';
  const we = rem.warrantyExpiring || [];
  const rr = rem.repairsReady || [];
  const uc = rem.upgradeCandidates || [];
  const sc = rem.storeCreditLeft || [];
  const total = we.length + rr.length + uc.length + sc.length;

  const bn = (rows) => rows.map((w) => `
      <div class="rank-row rem-click" ${remLink('warranty', w.serialNumber)}>
        <div class="rank-main">
          <div class="rank-name">${esc(w.device)}${w.serialNumber ? ` <span class="muted">· ${esc(w.serialNumber)}</span>` : ''}</div>
          <div class="muted">${esc([w.customer, $t('expires {date}', { date: remDate(w.expiresAt) })].filter(Boolean).join(' · '))}</div>
        </div>
        <span class="tag tag-warn">${esc($tn('{n} day left', '{n} days left', w.daysLeft))}</span>
      </div>`).join('');

  const br = (rows) => rows.map((r) => `
      <div class="rank-row rem-click" ${remLink('repairs')}>
        <div class="rank-main">
          <div class="rank-name">${esc(r.customer || r.ticketNo)}</div>
          <div class="muted">${esc([r.device + (r.serialNumber ? ' · ' + r.serialNumber : ''), $tn('{n} day waiting', '{n} days waiting', r.daysWaiting)].filter(Boolean).join(' · '))}</div>
        </div>
        <span class="muted">${esc($t('{amount} deposit', { amount: money(r.deposit) }))}</span>
      </div>`).join('');

  const bu = (rows) => rows.map((u) => `
      <div class="rank-row rem-click" ${remLink('customers')}>
        <div class="rank-main">
          <div class="rank-name">${esc(u.customer)}</div>
          <div class="muted">${esc((u.devices || []).map((d) => d.device).join(', '))}</div>
        </div>
        <span class="muted">${esc($tn('{n} device', '{n} devices', (u.devices || []).length))}</span>
      </div>`).join('');

  const bs = (rows) => rows.map((s) => `
      <div class="rank-row rem-click" ${remLink('customers')}>
        <div class="rank-main">
          <div class="rank-name">${esc(s.customer)}</div>
        </div>
        <strong>${money(s.storeCredit)}</strong>
      </div>`).join('');

  const block = (label, body) => (body
    ? `<h4 class="rem-head">${esc(label)}</h4><div class="rank-list">${body}</div>`
    : '');

  return `
    <section class="dash-section">
      ${sectionHead({ title: $t('Reminders'), aside: total ? $tn('{n} reminder', '{n} reminders', total) : $t('Nothing to act on.') })}
      ${total === 0 ? '' : `
      ${block($t('Warranty expiring'), bn(we))}
      ${block($t('Repairs ready'), br(rr))}
      ${block($t('Upgrade candidates'), bu(uc))}
      ${block($t('Store credit left'), bs(sc))}
      <div class="row dash-actions">
        <button class="btn btn-ghost btn-sm" data-rem-go="salesreport">${$t('Sales report')}</button>
        <button class="btn btn-ghost btn-sm" data-rem-go="repairs">${$t('Repairs')}</button>
        <button class="btn btn-ghost btn-sm" data-rem-go="warranty">${$t('Check warranty')}</button>
        <button class="btn btn-ghost btn-sm" data-rem-go="customers">${$t('Customers')}</button>
      </div>`}
    </section>`;
}
