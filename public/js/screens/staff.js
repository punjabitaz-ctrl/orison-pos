'use strict';

/* Staff screen: the people side of the till. Everyone gets their own time
   clock and shift history; managers and admins also get who is on the floor
   right now, per-cashier performance for a chosen window, and the till
   reconciliation trail. Reads are best-effort so the screen still renders
   something useful on a terminal that just lost its connection. */

import { api } from '../api.js';
import { fmt, esc, toast, beep, skeleton, emptyState } from '../ui.js';
import { getDeviceId, SYNC_EVENT } from '../sync.js';
import { hoursFromEntries, fmtDuration, shiftDayKey, dayKey } from '../stats.js';

const MANAGER_ROLES = ['admin', 'manager'];
const PERIODS = [
  { id: 'today', label: 'Today', days: 0 },
  { id: 'week', label: '7 days', days: 6 },
  { id: 'month', label: '30 days', days: 29 },
];

function when(iso, withDate = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleString('en-US', withDate
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { hour: 'numeric', minute: '2-digit' });
}

export const screen = {
  id: 'staff',
  tab: 'staff',
  title: 'Staff',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const { state } = ctx;
    const user = state.user || {};
    const isManager = MANAGER_ROLES.includes(user.role || 'cashier');

    let period = 'today';
    let clock = { entries: [], onFloor: 0, me: { open: false } };
    let shifts = [];
    let report = null;
    let offline = false;

    function periodRange() {
      const def = PERIODS.find((p) => p.id === period) || PERIODS[0];
      return { from: shiftDayKey(def.days), to: shiftDayKey(0), label: def.label };
    }

    root.innerHTML = `
      <header class="scr-head">
        <div class="scr-title">
          <h2>Staff</h2>
          <p>${esc([user.firstName, user.lastName].filter(Boolean).join(' ') || 'Signed in')} · ${esc(user.role || 'cashier')}</p>
        </div>
        <button class="icon-btn" id="staffRefresh" aria-label="Refresh">⟳</button>
      </header>
      <div id="staffBody">${skeleton('rows', 4)}</div>`;

    const body = root.querySelector('#staffBody');

    async function load() {
      offline = !navigator.onLine;
      const range = periodRange();
      const [tc, sh, rep] = await Promise.all([
        navigator.onLine ? api.get('/api/timeclock?limit=200').catch(() => null) : Promise.resolve(null),
        navigator.onLine ? api.get('/api/shifts').catch(() => null) : Promise.resolve(null),
        navigator.onLine && isManager
          ? api.get('/api/reports?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to)).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (tc) clock = tc; else offline = true;
      shifts = (sh && sh.shifts) || [];
      report = rep;
      draw();
    }

    function entriesFor(userId, fromKey) {
      return (clock.entries || []).filter((e) => {
        if (userId && String(e.userId) !== String(userId)) return false;
        if (!fromKey) return true;
        return dayKey(e.clockIn) >= fromKey;
      });
    }

    function myClockCard() {
      const open = clock.me && clock.me.open;
      const todayHours = hoursFromEntries(entriesFor(user.id, shiftDayKey(0)));
      const weekHours = hoursFromEntries(entriesFor(user.id, shiftDayKey(6)));
      return `
        <section class="dash-section">
          <h3>My time clock</h3>
          <div class="clock-card ${open ? 'on' : ''}">
            <div class="clock-state">
              <span class="clock-dot" aria-hidden="true"></span>
              <div>
                <strong>${open ? 'Clocked in' : 'Clocked out'}</strong>
                <p class="muted">${open ? 'since ' + esc(when(clock.me.since, false)) : 'Punch in when you start on the floor.'}</p>
              </div>
            </div>
            <button class="btn ${open ? 'btn-danger' : ''}" id="punchBtn" ${offline ? 'disabled' : ''}>${open ? 'Punch out' : 'Punch in'}</button>
          </div>
          <div class="stat-row">
            <div class="stat"><span>Today</span><strong>${esc(fmtDuration(todayHours))}</strong></div>
            <div class="stat"><span>Last 7 days</span><strong>${esc(fmtDuration(weekHours))}</strong></div>
            <div class="stat"><span>Punches</span><strong>${entriesFor(user.id, shiftDayKey(6)).length}</strong></div>
          </div>
        </section>`;
    }

    function myPunches() {
      const mine = entriesFor(user.id, null).slice(0, 8);
      return `
        <section class="dash-section">
          <h3>Recent punches</h3>
          ${mine.length ? `<div class="rank-list">${mine.map((e) => `
            <div class="rank-row">
              <div class="rank-main">
                <div class="rank-name">${esc(when(e.clockIn))}${e.clockOut ? ' → ' + esc(when(e.clockOut, false)) : ''}</div>
                <div class="muted">${e.status === 'OPEN' ? 'On the floor now' : esc(fmtDuration((Number(e.minutes) || 0) / 60))}${e.note ? ' · ' + esc(e.note) : ''}</div>
              </div>
              <span class="tag ${e.status === 'OPEN' ? 'tag-live' : ''}">${esc(e.status)}</span>
            </div>`).join('')}</div>`
            : emptyState({ icon: '⏱', title: 'No punches yet', body: 'Your clock-in and clock-out times will show up here.' })}
        </section>`;
    }

    function onFloorCard() {
      const open = (clock.entries || []).filter((e) => e.status === 'OPEN');
      return `
        <section class="dash-section">
          <h3>On the floor <span class="muted">· ${open.length} clocked in</span></h3>
          ${open.length ? `<div class="rank-list">${open.map((e) => `
            <div class="rank-row">
              <div class="rank-main">
                <div class="rank-name">${esc(e.userName)}</div>
                <div class="muted">since ${esc(when(e.clockIn, false))}${e.deviceId ? ' · terminal ' + esc(e.deviceId.slice(0, 8).toUpperCase()) : ''}</div>
              </div>
              <b>${esc(fmtDuration(hoursFromEntries([e])))}</b>
            </div>`).join('')}</div>`
            : emptyState({ icon: '🏪', title: 'Nobody is clocked in', body: 'Staff punches show up here the moment someone starts a shift.' })}
        </section>`;
    }

    function performanceCard() {
      const range = periodRange();
      const rows = (report && report.byCashier) || [];
      const hoursByName = {};
      for (const e of entriesFor(null, range.from)) {
        hoursByName[e.userName] = (hoursByName[e.userName] || 0) + hoursFromEntries([e]);
      }
      return `
        <section class="dash-section">
          <div class="sect-head">
            <h3>Team performance</h3>
            <div class="seg seg-sm">
              ${PERIODS.map((p) => `<button class="seg-btn ${p.id === period ? 'on' : ''}" data-period="${p.id}">${esc(p.label)}</button>`).join('')}
            </div>
          </div>
          ${!report ? skeleton('table', 3) : (rows.length ? `
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Cashier</th><th class="num">Sales</th><th class="num">Tickets</th><th class="num">Avg ticket</th><th class="num">Margin</th><th class="num">Hours</th><th class="num">Per hour</th></tr></thead>
                <tbody>
                  ${rows.map((r) => {
                    const hrs = hoursByName[r.userName] || 0;
                    return `<tr>
                      <td>${esc(r.userName)}</td>
                      <td class="num">${fmt(r.sales)}</td>
                      <td class="num">${r.count}</td>
                      <td class="num">${fmt(r.count ? r.sales / r.count : 0)}</td>
                      <td class="num ${r.gp < 0 ? 'neg' : 'gp'}">${fmt(r.gp)}</td>
                      <td class="num">${hrs ? esc(fmtDuration(hrs)) : '—'}</td>
                      <td class="num">${hrs ? fmt(r.sales / hrs) : '—'}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>`
            : emptyState({ icon: '📊', title: 'No sales in this window', body: 'Performance fills in as the team rings sales.' }))}
        </section>`;
    }

    function shiftCard() {
      const mine = isManager ? shifts : shifts.filter((s) => String(s.userId) === String(user.id));
      const closed = mine.filter((s) => s.status === 'CLOSED').slice(0, 10);
      const net = closed.reduce((s, x) => s + (Number(x.overShort) || 0), 0);
      return `
        <section class="dash-section">
          <h3>${isManager ? 'Till reconciliation' : 'My shifts'}</h3>
          ${closed.length ? `
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Cashier</th><th>Closed</th><th class="num">Declared</th><th class="num">Expected</th><th class="num">Over / short</th></tr></thead>
                <tbody>
                  ${closed.map((s) => `<tr>
                    <td>${esc(s.userName)}</td>
                    <td>${esc(when(s.closedAt))}</td>
                    <td class="num">${fmt(s.declaredCash)}</td>
                    <td class="num">${fmt(s.expectedCash)}</td>
                    <td class="num ${Number(s.overShort) === 0 ? '' : (Number(s.overShort) > 0 ? 'gp' : 'neg')}">${Number(s.overShort) > 0 ? '+' : ''}${fmt(s.overShort)}</td>
                  </tr>`).join('')}
                </tbody>
                <tfoot><tr><td colspan="4">Net over / short</td><td class="num ${net === 0 ? '' : (net > 0 ? 'gp' : 'neg')}">${net > 0 ? '+' : ''}${fmt(net)}</td></tr></tfoot>
              </table>
            </div>`
            : emptyState({ icon: '🧾', title: 'No closed shifts yet', body: 'Close a shift from the dashboard to reconcile the drawer.' })}
        </section>`;
    }

    function draw() {
      body.innerHTML = `
        ${offline ? '<p class="muted scr-note">Offline — the time clock and team figures need a connection.</p>' : ''}
        ${myClockCard()}
        ${isManager ? onFloorCard() : ''}
        ${isManager ? performanceCard() : ''}
        ${shiftCard()}
        ${myPunches()}`;

      const punch = body.querySelector('#punchBtn');
      if (punch) punch.addEventListener('click', () => doPunch(punch));
      body.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => {
        period = b.dataset.period;
        report = null;
        draw();
        load();
      }));
    }

    async function doPunch(btn) {
      btn.disabled = true;
      const wasOpen = clock.me && clock.me.open;
      try {
        const res = await api.post('/api/timeclock/punch', { deviceId: await getDeviceId() });
        toast(res.punched === 'in' ? 'Clocked in' : 'Clocked out · ' + fmtDuration((Number(res.entry.minutes) || 0) / 60), 'ok');
        beep('ok');
        await load();
      } catch (err) {
        btn.disabled = false;
        const code = err && err.data && err.data.error;
        toast(code === 'already_clocked_in'
          ? 'Already clocked in on another terminal'
          : (code || (wasOpen ? 'Could not clock out' : 'Could not clock in')), 'warn');
      }
    }

    const onSync = () => load();
    window.addEventListener(SYNC_EVENT, onSync);
    root.querySelector('#staffRefresh').addEventListener('click', load);

    await load();

    return () => window.removeEventListener(SYNC_EVENT, onSync);
  },
};
