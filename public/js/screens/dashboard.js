'use strict';

/* Dashboard: role-aware home screen. Cashiers see their own daily numbers;
   managers and admins see store-wide KPIs, a 14-day revenue chart, top
   sellers, low-stock alerts and one-click CSV export to Google Drive. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { fmt, esc, toast, beep } from '../ui.js';
import { SYNC_EVENT } from '../sync.js';
import { inventoryAlerts } from '../alerts.js';

const MANAGER_ROLES = ['admin', 'manager'];

function todayKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function dayKeyOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

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

    function scope() {
      return isManager ? txs : txs.filter((t) => String(t.user_id) === String(user.id));
    }

    async function load() {
      const [prods, res, outbox, con] = await Promise.all([
        idb.getAll('products').catch(() => []),
        navigator.onLine
          ? api.get('/api/transactions?limit=300').catch((err) => { server = !(err && err.offline); return { ok:false }; })
          : Promise.resolve({ ok: false }),
        idb.getAll('outbox').catch(() => []),
        navigator.onLine && isManager
          ? api.get('/api/conflicts').catch(() => ({ conflicts: [] }))
          : Promise.resolve({ conflicts: [] }),
      ]);
      products = prods;
      txs = (res && res.transactions) || [];
      pending = outbox.filter((o) => o.status === 'PENDING').length;
      conflicts = (con && con.conflicts) || [];
      draw();
    }

    function draw() {
      const relevant = scope();
      const now = new Date();
      const todayTx = relevant.filter((t) => dayKeyOf(t.createdAt) === today);
      const todayRevenue = todayTx.reduce((s, t) => s + (t.grandTotal || 0), 0);
      const todayUnits = todayTx.reduce((s, t) => s + (t.items || []).reduce((a, i) => a + (i.quantity || 1), 0), 0);

      const recent = [...relevant].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 4);
      const alerts = inventoryAlerts(products);
      const aOut = alerts.filter((a) => a.severity === 'out').length;
      const aLow = alerts.filter((a) => a.severity === 'low').length;
      const aLocked = alerts.filter((a) => a.severity === 'locked').length;
      const aAging = alerts.filter((a) => a.aging).length;

      root.innerHTML = `
        <header class="scr-head">
          <div class="scr-title">
            <h2>Dashboard</h2>
            <p>${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · ${esc(role)}</p>
          </div>
          <button class="icon-btn" id="dashRefresh" aria-label="Refresh">⟳</button>
        </header>

        <div class="dash-kpis">
          <div class="dash-kpi"><span>Revenue today</span><strong>${money(todayRevenue)}</strong></div>
          <div class="dash-kpi"><span>Sales today</span><strong>${todayTx.length}</strong></div>
          <div class="dash-kpi"><span>Units today</span><strong>${todayUnits}</strong></div>
        </div>

        ${isManager ? `
        <section class="dash-section">
          <h3>Revenue — last 14 days</h3>
          <div class="dash-chart">${barChart(last14(txs))}</div>
        </section>

        ${openConflicts(conflicts).length ? `
        <section class="dash-section">
          <div class="dash-conf-banner">
            <div>
              <strong>${openConflicts(conflicts).length} sync conflict${openConflicts(conflicts).length === 1 ? '' : 's'} awaiting review</strong>
              <p class="muted">Two terminals disagreed on ${openStr(openConflicts(conflicts))}.</p>
            </div>
            <button class="btn btn-sm" id="dashReviewConf">Review</button>
          </div>
        </section>` : ''}
        ${conflicts.length && conflicts.some((c) => c.status !== 'OPEN') ? `
        <section class="dash-section">
          <details class="dash-details">
            <summary>Reviewed conflicts (${conflicts.filter((c) => c.status !== 'OPEN').length})</summary>
            ${conflicts.filter((c) => c.status !== 'OPEN').slice(0, 10).map((c) => `
              <div class="rank-row">
                <div class="rank-main"><div class="rank-name">${esc(c.type)}</div><div class="muted">${esc(c.summary)}</div></div>
                <span class="tag-warn">${esc(c.status)}</span>
              </div>`).join('')}
          </details>
        </section>` : ''}

        <section class="dash-section">
          <h3>Top sellers <span class="muted">· last ${last30(txs).length} sales</span></h3>
          ${topSellers(last30(txs)).length
            ? `<div class="rank-list">${topSellers(last30(txs)).map((t, i) => `
                <div class="rank-row">
                  <span class="rank-idx">${i + 1}</span>
                  <div class="rank-main"><div class="rank-name">${esc(t.name)}</div><div class="muted">${t.units} unit${t.units === 1 ? '' : 's'}</div></div>
                  <b>${money(t.rev)}</b>
                </div>`).join('')}</div>`
            : `<p class="empty">No sales synced yet.</p>`}
        </section>

        <section class="dash-section">
          <h3>Inventory alerts</h3>
          ${(aOut + aLow + aLocked + aAging)
            ? `<div class="rank-list">
                <div class="rank-row"><span class="rank-idx warn">${aOut}</span><div class="rank-main"><div class="rank-name">Out of stock</div><div class="muted">need re-supply</div></div></div>
                <div class="rank-row"><span class="rank-idx warn">${aLow}</span><div class="rank-main"><div class="rank-name">Low stock</div><div class="muted">at or below reorder point</div></div></div>
                <div class="rank-row"><span class="rank-idx">${aLocked}</span><div class="rank-main"><div class="rank-name">Locked</div><div class="muted">held from sale by admin</div></div></div>
                <div class="rank-row"><span class="rank-idx warn">${aAging}</span><div class="rank-main"><div class="rank-name">Paying dust</div><div class="muted">not sold in 30+ days</div></div></div>
              </div>
              <div class="row dash-actions">
                <button class="btn" id="dashAlerts">Open alerts</button>
              </div>`
            : `<p class="muted">All stocked & selling.</p>
               <button class="btn btn-ghost btn-sm" id="dashAlerts">Open alerts</button>`}
        </section>

        <div class="row dash-actions">
          <button class="btn" id="dashExport">Export today → Drive</button>
          <button class="btn" id="dashInventory">Inventory</button>
        </div>
        ` : `
        <section class="dash-section">
          <h3>New sale</h3>
          <button class="btn btn-block" id="dashSell">Open Register</button>
        </section>

        <div class="row dash-actions">
          <button class="btn" id="dashExport">My report today → Drive</button>
        </div>

        <section class="dash-section">
          <h3>My recent</h3>
          ${pending > 0 ? `<p class="muted">${pending} awaiting sync</p>` : ''}
          ${recent.length ? `<div class="hx-list" style="padding:0">${recent.map((t) => `
            <button class="hx-card" data-go-history>
              <div class="hx-left">
                <span class="hx-date">${humanDate(t.createdAt)}</span>
                <span class="hx-status st-synced">SERVER</span>
              </div>
              <div class="hx-right"><strong>${money(t.grandTotal)}</strong></div>
            </button>`).join('')}</div>`
            : `<p class="empty">No sales yet — start with the register.</p>`}
        </section>

        <button class="btn btn-block" id="dashHistory">View full history</button>
        `}

        ${!server ? `<p class="muted" style="padding:0 16px 4px">Offline — showing last synced data.</p>` : ''}`;

      root.querySelector('#dashRefresh').addEventListener('click', load);
      const sellBtn = root.querySelector('#dashSell');
      if (sellBtn) sellBtn.addEventListener('click', () => router.show('register'));
      const histBtn = root.querySelector('#dashHistory');
      if (histBtn) histBtn.addEventListener('click', () => router.show('history'));
      const invBtn = root.querySelector('#dashInventory');
      if (invBtn) invBtn.addEventListener('click', () => router.show('inventory'));
      const alertBtn = root.querySelector('#dashAlerts');
      if (alertBtn) alertBtn.addEventListener('click', () => router.show('alerts'));
      const expBtn = root.querySelector('#dashExport');
      if (expBtn) expBtn.addEventListener('click', () => exportDay(expBtn));
      root.querySelectorAll('[data-go-history]').forEach((b) => b.addEventListener('click', () => router.show('history')));
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
                  <div class="rank-name">${esc(c.type)}</div>
                  <div class="muted">${esc(c.summary)}</div>
                  <div class="muted" style="font-size:11px">device ${esc((c.deviceId || '').slice(0, 8))} · ${humanDate(c.createdAt)} · tx ${esc(c.loserClientTx || '')}</div>
                </div>
                <div class="conf-acts">
                  <button class="btn btn-sm" data-conf-act="resolve" data-cid="${esc(c.id)}">Keep winner</button>
                  <button class="btn btn-sm btn-ghost" data-conf-act="dismiss" data-cid="${esc(c.id)}">Dismiss</button>
                </div>
              </div>`).join('')}
          </div>`;
      });
    }

    async function exportDay(btn) {
      btn.disabled = true;
      btn.textContent = 'Exporting…';
      try {
        const res = await api.post('/api/drive/export', { date: today }, { timeout: 25000 });
        toast(`Exported ${res.rows} sales → Drive`, 'ok');
        beep('ok');
        if (res.url) window.open(res.url, '_blank');
      } catch (err) {
        toast((err && err.data && err.data.error) || 'Export failed', 'warn');
      }
      btn.disabled = false;
      btn.textContent = 'Export today → Drive';
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
        toast('Conflict reviewed', 'ok'); beep('ok');
        await load();
      } catch (err) {
        toast((err && err.data && err.data.error) || 'Review failed', 'warn');
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

/* ---- aggregation helpers ---- */

function openConflicts(all) {
  return (all || []).filter((c) => c.status === 'OPEN');
}

function openStr(open) {
  const reasons = {};
  for (const c of open) reasons[c.type] = (reasons[c.type] || 0) + 1;
  return Object.keys(reasons).map((k) => `${reasons[k]}× ${k}`).join(', ') || 'a sale';
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
      if (b.key === k) { b.total += t.grandTotal || 0; b.count += 1; break; }
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
        <title>${b.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${money(b.total)} (${b.count})</title>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${b.total ? '#1c5d99' : '#dfe6ee'}"></rect>
        <text x="${x + w / 2}" y="${H - 3}" text-anchor="middle" font-size="8" fill="#7b8ca0">${label}</text>
      </g>`;
  }).join('');
  const grid = [0, 0.5, 1].map((f) => {
    const y = Math.round(base + H2 - f * H2);
    return `<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#eef2f7" stroke-width="1"></line>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" aria-label="Revenue last 14 days">${grid}${bars}</svg>`;
}

function last30(txs) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  return txs.filter((t) => new Date(t.createdAt) >= cutoff);
}

function topSellers(txs) {
  const tally = new Map();
  for (const t of txs) {
    for (const it of t.items || []) {
      const name = String(it.name || 'Item');
      const e = tally.get(name) || { name, units: 0, rev: 0 };
      e.units += it.quantity || 1;
      e.rev += (it.unitPrice || 0) * (it.quantity || 1);
      tally.set(name, e);
    }
  }
  return [...tally.values()].sort((a, b) => b.units - a.units).slice(0, 5);
}

function lowStock(products) {
  return products
    .map((p) => ({ ...p, onHand: Number(p.onHand) || 0 }))
    .filter((p) => p.onHand <= 5)
    .sort((a, b) => a.onHand - b.onHand);
}

function humanDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}