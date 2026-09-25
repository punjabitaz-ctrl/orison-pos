'use strict';

import { $t, $tn, N_, arrow, dateLocale } from '../lang.js';

/* Staff screen: the people side of the till. Everyone gets their own time
   clock and shift history; managers and admins also get who is on the floor
   right now, per-cashier performance for a chosen window, and the till
   reconciliation trail. Reads are best-effort so the screen still renders
   something useful on a terminal that just lost its connection. */

import { api } from '../api.js';
import { roleLabel, screenHead, sectionHead, statRow, dataTable, rankList } from '../components.js';
import { fmt, esc, toast, beep, skeleton, emptyState, openModal, closeModal, denomLabel } from '../ui.js';
import { getDeviceId, SYNC_EVENT, queuePunch } from '../sync.js';
import { hoursFromEntries, fmtDuration, shiftDayKey, dayKey } from '../stats.js';

const MANAGER_ROLES = ['admin', 'manager'];
const PERIODS = [
  { id: 'today', label: N_('Today'), days: 0 },
  { id: 'week', label: N_('7 days'), days: 6 },
  { id: 'month', label: N_('30 days'), days: 29 },
];

function when(iso, withDate = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleString(dateLocale(), withDate
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { hour: 'numeric', minute: '2-digit' });
}

export const screen = {
  id: 'staff',
  tab: 'staff',
  title: $t('Staff'),

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
    let team = [];

    function periodRange() {
      const def = PERIODS.find((p) => p.id === period) || PERIODS[0];
      return { from: shiftDayKey(def.days), to: shiftDayKey(0), label: def.label };
    }

    root.innerHTML = `
      ${screenHead({
        title: $t('Staff'),
        sub: `${[user.firstName, user.lastName].filter(Boolean).join(' ') || $t('Signed in')} · ${$t(roleLabel(user.role || 'cashier'))}`,
        actions: `<button class="icon-btn" id="staffRefresh" aria-label="${$t('Refresh')}">⟳</button>`,
      })}
      <div id="staffBody">${skeleton('rows', 4)}</div>`;

    const body = root.querySelector('#staffBody');

    async function load() {
      offline = !navigator.onLine;
      const range = periodRange();
      const [tc, sh, rep, tm] = await Promise.all([
        navigator.onLine ? api.get('/api/timeclock?limit=200').catch(() => null) : Promise.resolve(null),
        navigator.onLine ? api.get('/api/shifts').catch(() => null) : Promise.resolve(null),
        navigator.onLine && isManager
          ? api.get('/api/reports?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to)).catch(() => null)
          : Promise.resolve(null),
        navigator.onLine && isManager ? api.post('/api/admin/users/list', {}).catch(() => null) : Promise.resolve(null),
      ]);
      team = (tm && tm.users) || [];
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
          <h3>${$t('My time clock')}</h3>
          <div class="clock-card ${open ? 'on' : ''}">
            <div class="clock-state">
              <span class="clock-dot" aria-hidden="true"></span>
              <div>
                <strong>${open ? $t('Clocked in') : $t('Clocked out')}</strong>
                <p class="muted">${open ? esc($t('since {when}', { when: when(clock.me.since, false) })) : $t('Punch in when you start on the floor.')}</p>
              </div>
            </div>
            <button class="btn ${open ? 'btn-danger' : ''}" id="punchBtn">${open ? $t('Punch out') : $t('Punch in')}</button>
          </div>
          ${statRow([
            { label: $t('Today'), value: fmtDuration(todayHours) },
            { label: $t('Last 7 days'), value: fmtDuration(weekHours) },
            { label: $t('Punches'), value: entriesFor(user.id, shiftDayKey(6)).length },
          ])}
        </section>`;
    }

    function myPunches() {
      const mine = entriesFor(user.id, null).slice(0, 8);
      return `
        <section class="dash-section">
          <h3>${$t('Recent punches')}</h3>
          ${mine.length ? rankList(mine.map((e) => ({
            name: `${when(e.clockIn)}${e.clockOut ? ' ' + arrow() + ' ' + when(e.clockOut, false) : ''}`,
            meta: `${e.status === 'OPEN' ? $t('On the floor now') : fmtDuration((Number(e.minutes) || 0) / 60)}${e.note ? ' · ' + e.note : ''}`,
            rightHtml: `<span class="tag ${e.status === 'OPEN' ? 'tag-live' : ''}">${esc(e.status === 'OPEN' ? $t('Open') : $t('Closed'))}</span>`,
          })))
            : emptyState({ icon: '⏱', title: $t('No punches yet'), body: $t('Your clock-in and clock-out times will show up here.') })}
        </section>`;
    }

    function onFloorCard() {
      const open = (clock.entries || []).filter((e) => e.status === 'OPEN');
      return `
        <section class="dash-section">
          <h3>${$t('On the floor')} <span class="muted">· ${esc($tn('{n} clocked in', '{n} clocked in', open.length))}</span></h3>
          ${open.length ? rankList(open.map((e) => ({
            name: e.userName,
            meta: `${$t('since {when}', { when: when(e.clockIn, false) })}${e.deviceId ? ' · ' + $t('terminal {id}', { id: e.deviceId.slice(0, 8).toUpperCase() }) : ''}`,
            rightHtml: `<b>${esc(fmtDuration(hoursFromEntries([e])))}</b>`,
          })))
            : emptyState({ icon: '🏪', title: $t('Nobody is clocked in'), body: $t('Staff punches show up here the moment someone starts a shift.') })}
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
          ${sectionHead({
            title: $t('Team performance'),
            asideHtml: `<div class="seg seg-sm">${PERIODS.map((p) => `<button class="seg-btn ${p.id === period ? 'on' : ''}" data-period="${p.id}">${esc($t(p.label))}</button>`).join('')}</div>`,
          })}
          ${!report ? skeleton('table', 3) : (rows.length ? dataTable({
              head: [
                { label: $t('Cashier') }, { label: $t('Sales'), num: true }, { label: $t('Tickets'), num: true },
                { label: $t('Avg ticket'), num: true }, { label: $t('Margin'), num: true },
                { label: $t('Hours'), num: true }, { label: $t('Per hour'), num: true },
              ],
              bodyHtml: `
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
                  }).join('')}`,
            })
            : emptyState({ icon: '📊', title: $t('No sales in this window'), body: $t('Performance fills in as the team rings sales.') }))}
        </section>`;
    }

    /* The team, for a manager (v1.39.0): let a locked-out colleague back in,
       and reset a cashier's forgotten PIN. Managers' and admins' PINs stay
       with an admin. */
    function teamCard() {
      if (!team.length) return '';
      const isAdmin = user.role === 'admin';
      return `
        <section class="dash-section">
          <h3>${$t('Team')}</h3>
          ${dataTable({
            head: [{ label: $t('Name') }, { label: $t('Role') }, ...(isAdmin ? [{ label: $t('Pay') }] : []), { label: '' }],
            bodyHtml: team.filter((u) => u.active).map((u) => {
              const self = String(u.id) === String(user.id);
              const canPin = !self && (isAdmin || u.role === 'cashier');
              return `<tr>
                <td>${esc(u.firstName + ' ' + u.lastName)}<br><span class="muted">${esc(u.email)}</span></td>
                <td>${esc($t(roleLabel(u.role)))}</td>
                ${isAdmin ? `<td>${u.payRate > 0
                  ? esc(u.payType === 'hourly' ? $t('{rate} an hour', { rate: fmt(u.payRate) }) : $t('{rate} a month', { rate: fmt(u.payRate) }))
                  : `<span class="muted">${$t('no rate set')}</span>`}</td>` : ''}
                <td class="num"><span class="set-inline">
                  ${isAdmin ? `<button class="btn btn-sm btn-ghost" data-pay="${esc(u.id)}">${$t('Pay rate')}</button>` : ''}
                  ${self ? '' : `<button class="btn btn-sm btn-ghost" data-unlock="${esc(u.email)}">${$t('Unlock')}</button>`}
                  ${canPin ? `<button class="btn btn-sm" data-pin="${esc(u.email)}" data-name="${esc(u.firstName + ' ' + u.lastName)}">${$t('Reset PIN')}</button>` : ''}
                </span></td>
              </tr>`;
            }).join(''),
          })}
        </section>`;
    }

    /* What a person is paid, which only an admin can see or set. Clearing the
       rate takes them out of the next pay run rather than paying them nothing. */
    function payDialog(person) {
      const m = openModal(`
        <div class="form-modal">
          <h3>${esc($t('Pay rate for {name}', { name: person.firstName + ' ' + person.lastName }))}</h3>
          <div class="field"><span>${$t('Paid')}</span>
            <select id="stPayType">
              <option value="">${$t('No rate set')}</option>
              <option value="hourly"${person.payType === 'hourly' ? ' selected' : ''}>${$t('By the hour')}</option>
              <option value="monthly"${person.payType === 'monthly' ? ' selected' : ''}>${$t('A monthly salary')}</option>
            </select></div>
          <div class="field"><span>${$t('Rate')}</span>
            <input id="stPayRate" inputmode="decimal" value="${esc(person.payRate > 0 ? String(person.payRate) : '')}"></div>
          <p class="muted">${$t('Only an admin sees this. It is what the next pay run starts from — overtime and anything else goes on the run as an adjustment.')}</p>
          <p id="stPayErr" class="login-err"></p>
          <div class="row">
            <button class="btn btn-ghost" data-cancel type="button">${$t('Cancel')}</button>
            <button class="btn btn-primary" id="stPayGo" type="button">${$t('Save')}</button>
          </div>
        </div>`);
      m.querySelector('[data-cancel]').addEventListener('click', closeModal);
      m.querySelector('#stPayGo').addEventListener('click', async () => {
        const payType = m.querySelector('#stPayType').value;
        const raw = m.querySelector('#stPayRate').value.trim();
        const payRate = raw === '' ? '' : Number(raw);
        if (payRate !== '' && !(payRate >= 0)) { m.querySelector('#stPayErr').textContent = $t('A pay rate cannot be negative'); return; }
        const go = m.querySelector('#stPayGo');
        go.disabled = true;
        try {
          await api.post('/api/admin/users/patch', { id: person.id, payType: payType || '', payRate: payType ? payRate : '' });
          closeModal();
          toast($t('Saved'), 'ok');
          await load();
        } catch (err) {
          m.querySelector('#stPayErr').textContent = (err && err.message) || $t('Could not save that');
          go.disabled = false;
        }
      });
    }

    /* Shifts left open by someone who went home: a manager closes them, with a
       count if the drawer was counted, and a reason either way. */
    function openShiftsCard() {
      const open = shifts.filter((s) => s.status === 'OPEN' && String(s.userId) !== String(user.id));
      if (!open.length) return '';
      return `
        <section class="dash-section">
          <h3>${$t('Shifts still open')}</h3>
          ${rankList(open.map((s) => ({
            name: s.userName,
            meta: `${$t('since {when}', { when: when(s.openedAt) })} · ${$t('float {amount}', { amount: fmt(s.openingFloat) })}`,
            rightHtml: `<button class="btn btn-sm" data-close-shift="${esc(s.id)}">${$t('Close shift')}</button>`,
          })))}
        </section>`;
    }

    function teamPunchesCard() {
      const rows = (clock.entries || []).slice(0, 15);
      if (!rows.length) return '';
      const isAdmin = user.role === 'admin';
      return `
        <section class="dash-section">
          <h3>${$t('Team punches')}</h3>
          ${rankList(rows.map((e) => ({
            name: `${e.userName} · ${when(e.clockIn)}${e.clockOut ? ' ' + arrow() + ' ' + when(e.clockOut, false) : ''}`,
            meta: `${e.status === 'OPEN' ? $t('On the floor now') : fmtDuration((Number(e.minutes) || 0) / 60)}${e.corrected ? ' · ' + $t('corrected') : ''}`,
            rightHtml: (isAdmin || String(e.userId) !== String(user.id))
              ? `<button class="btn btn-sm btn-ghost" data-fix-punch="${esc(e.id)}">${$t('Correct')}</button>` : '',
          })))}
        </section>`;
    }

    function shiftCard() {
      const mine = isManager ? shifts : shifts.filter((s) => String(s.userId) === String(user.id));
      const closed = mine.filter((s) => s.status === 'CLOSED').slice(0, 10);
      const net = closed.reduce((s, x) => s + (Number(x.overShort) || 0), 0);
      return `
        <section class="dash-section">
          <h3>${isManager ? $t('Till reconciliation') : $t('My shifts')}</h3>
          ${closed.length ? dataTable({
              head: [
                { label: $t('Cashier') }, { label: $t('Closed') }, { label: $t('Declared'), num: true },
                { label: $t('Expected'), num: true }, { label: $t('Over / short'), num: true },
              ],
              bodyHtml: `
                  ${closed.map((s) => `<tr>
                    <td>${esc(s.userName)}</td>
                    <td>${esc(when(s.closedAt))}</td>
                    <td class="num">${s.declaredCash == null ? esc($t('not counted')) : fmt(s.declaredCash)}</td>
                    <td class="num">${fmt(s.expectedCash)}</td>
                    <td class="num ${Number(s.overShort) === 0 || s.overShort == null ? '' : (Number(s.overShort) > 0 ? 'gp' : 'neg')}">${s.overShort == null ? '—' : fmt(s.overShort, Number(s.overShort) > 0 ? '+' : '')}</td>
                  </tr>`).join('')}`,
              footHtml: `<tr><td colspan="4">${$t('Net over / short')}</td><td class="num ${net === 0 ? '' : (net > 0 ? 'gp' : 'neg')}">${fmt(net, net > 0 ? '+' : '')}</td></tr>`,
            })
            : emptyState({ icon: '🧾', title: $t('No closed shifts yet'), body: $t('Close a shift from the dashboard to reconcile the drawer.') })}
        </section>`;
    }

    function draw() {
      body.innerHTML = `
        ${offline ? `<p class="muted scr-note">${$t('Offline — punches are queued and sent when the line returns. Team figures need a connection.')}</p>` : ''}
        ${myClockCard()}
        ${isManager ? onFloorCard() : ''}
        ${isManager ? openShiftsCard() : ''}
        ${isManager ? performanceCard() : ''}
        ${shiftCard()}
        ${isManager ? teamPunchesCard() : myPunches()}
        ${isManager ? teamCard() : ''}`;

      body.querySelectorAll('[data-unlock]').forEach((b) => b.addEventListener('click', async () => {
        try {
          await api.post('/api/admin/unlock', { email: b.dataset.unlock });
          toast($t('{email} can sign in again', { email: b.dataset.unlock }), 'ok'); beep('ok');
        } catch (err) { toast((err && err.message) || $t('Could not unlock'), 'warn'); }
      }));
      body.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', () => pinDialog(b.dataset.pin, b.dataset.name)));
      body.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => {
        const person = team.find((u) => String(u.id) === b.dataset.pay);
        if (person) payDialog(person);
      }));
      body.querySelectorAll('[data-close-shift]').forEach((b) => b.addEventListener('click', () => closeShiftDialog(b.dataset.closeShift)));
      body.querySelectorAll('[data-fix-punch]').forEach((b) => b.addEventListener('click', () => punchDialog(b.dataset.fixPunch)));

      const punch = body.querySelector('#punchBtn');
      if (punch) punch.addEventListener('click', () => doPunch(punch));
      body.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => {
        period = b.dataset.period;
        report = null;
        draw();
        load();
      }));
    }

    function pinDialog(email, name) {
      const m = openModal(`
        <div class="form-modal">
          <h3>${esc($t('Reset PIN for {name}', { name }))}</h3>
          <p class="muted">${esc($t('Set a new 6-digit PIN for {email}. They are signed out everywhere and must use this PIN on next sign-in.', { email }))}</p>
          <div class="field"><span>${$t('New PIN')}</span><input id="tpPin" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></div>
          <p id="tpErr" class="login-err"></p>
          <div class="row"><button class="btn btn-ghost" data-cancel type="button">${$t('Cancel')}</button><button class="btn" id="tpGo" type="button">${$t('Set PIN')}</button></div>
        </div>`);
      m.querySelector('[data-cancel]').addEventListener('click', closeModal);
      m.querySelector('#tpGo').addEventListener('click', async () => {
        const pin = m.querySelector('#tpPin').value.trim();
        if (!/^\d{6}$/.test(pin)) { m.querySelector('#tpErr').textContent = $t('PIN must be exactly 6 digits'); return; }
        try {
          await api.post('/api/admin/pin', { email, pin });
          closeModal();
          toast($t('PIN set — hand it to the staff member'), 'ok', 3200); beep('ok');
        } catch (err) { m.querySelector('#tpErr').textContent = (err && err.message) || $t('Reset failed'); }
      });
    }

    /* datetime-local wants local wall time, not UTC */
    function localInput(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d)) return '';
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function punchDialog(id) {
      const e = (clock.entries || []).find((x) => String(x.id) === String(id));
      if (!e) return;
      const m = openModal(`
        <div class="form-modal">
          <h3>${esc($t('Correct {name}\'s punch', { name: e.userName }))}</h3>
          <div class="field"><span>${$t('Clock in')}</span><input id="cpIn" type="datetime-local" value="${localInput(e.clockIn)}"></div>
          <div class="field"><span>${$t('Clock out')}</span><input id="cpOut" type="datetime-local" value="${localInput(e.clockOut)}"></div>
          <div class="field"><span>${$t('Reason')}</span><input id="cpWhy" maxlength="200" autocomplete="off" placeholder="${esc($t('e.g. forgot to clock out'))}"></div>
          <p class="muted">${$t('The original times stay in the audit log.')}</p>
          <p id="cpErr" class="login-err"></p>
          <div class="row"><button class="btn btn-ghost" data-cancel type="button">${$t('Cancel')}</button><button class="btn" id="cpGo" type="button">${$t('Save')}</button></div>
        </div>`);
      m.querySelector('[data-cancel]').addEventListener('click', closeModal);
      m.querySelector('#cpGo').addEventListener('click', async () => {
        const inV = m.querySelector('#cpIn').value;
        const outV = m.querySelector('#cpOut').value;
        const reason = m.querySelector('#cpWhy').value.trim();
        if (!reason) { m.querySelector('#cpErr').textContent = $t('Correcting a punch needs a reason'); return; }
        const payload = { id: e.id, reason, deviceId: await getDeviceId() };
        if (inV) payload.clockIn = new Date(inV).toISOString();
        if (outV) payload.clockOut = new Date(outV).toISOString();
        try {
          await api.post('/api/timeclock/correct', payload);
          closeModal();
          toast($t('Punch corrected'), 'ok'); beep('ok');
          await load();
        } catch (err) { m.querySelector('#cpErr').textContent = (err && err.message) || $t('Could not save'); }
      });
    }

    function closeShiftDialog(id) {
      const s = shifts.find((x) => String(x.id) === String(id));
      if (!s) return;
      const denoms = ((state.store && state.store.denoms) || []);
      const m = openModal(`
        <div class="form-modal">
          <h3>${esc($t('Close {name}\'s shift', { name: s.userName }))}</h3>
          <p class="muted">${esc($t('Opened {when} with a float of {amount}. Count the drawer if you can; otherwise it closes as not counted.', { when: when(s.openedAt), amount: fmt(s.openingFloat) }))}</p>
          <label class="check"><input id="csCount" type="checkbox"> ${$t('I counted the drawer')}</label>
          <div id="csDenoms" class="den-grid" hidden>
            ${denoms.map((d) => `<label class="den-row"><span>${esc(denomLabel(d))}</span><input class="den-qty" data-den="${esc(String(d))}" type="number" inputmode="numeric" min="0" step="1" placeholder="0"></label>`).join('')}
          </div>
          <div class="field"><span>${$t('Reason')}</span><input id="csWhy" maxlength="200" autocomplete="off" placeholder="${esc($t('e.g. left without closing'))}"></div>
          <p id="csErr" class="login-err"></p>
          <div class="row"><button class="btn btn-ghost" data-cancel type="button">${$t('Cancel')}</button><button class="btn btn-danger" id="csGo" type="button">${$t('Close shift')}</button></div>
        </div>`);
      m.querySelector('[data-cancel]').addEventListener('click', closeModal);
      m.querySelector('#csCount').addEventListener('change', (ev) => { m.querySelector('#csDenoms').hidden = !ev.target.checked; });
      m.querySelector('#csGo').addEventListener('click', async () => {
        const reason = m.querySelector('#csWhy').value.trim();
        if (!reason) { m.querySelector('#csErr').textContent = $t('Closing someone else\'s shift needs a reason'); return; }
        const payload = { shiftId: s.id, reason, deviceId: await getDeviceId() };
        if (m.querySelector('#csCount').checked) {
          const counts = {};
          m.querySelectorAll('[data-den]').forEach((i) => { const n = parseInt(i.value, 10); if (n > 0) counts[i.dataset.den] = n; });
          payload.denoms = counts;
        }
        try {
          const res = await api.post('/api/shifts/force-close', payload);
          closeModal();
          const sh = res.shift || {};
          toast(sh.overShort == null ? $t('Shift closed — not counted') : $t('Shift closed · over / short {amount}', { amount: fmt(sh.overShort) }), 'ok', 3200);
          beep('ok');
          await load();
        } catch (err) { m.querySelector('#csErr').textContent = (err && err.message) || $t('Could not close the shift'); }
      });
    }

    async function doPunch(btn) {
      btn.disabled = true;
      const wasOpen = clock.me && clock.me.open;
      if (!navigator.onLine) {
        /* A shop that can sell offline must be able to clock in offline. The
           punch is queued with the time it actually happened and sent when the
           line returns. */
        await queuePunch({ at: new Date().toISOString(), deviceId: await getDeviceId() });
        toast(wasOpen ? $t('Clock-out queued — will send when back online') : $t('Clock-in queued — will send when back online'), 'ok', 3200);
        beep('ok');
        btn.disabled = false;
        return;
      }
      try {
        const res = await api.post('/api/timeclock/punch', { at: new Date().toISOString(), deviceId: await getDeviceId() });
        toast(res.punched === 'in' ? $t('Clocked in') : $t('Clocked out · {duration}', { duration: fmtDuration((Number(res.entry.minutes) || 0) / 60) }), 'ok');
        beep('ok');
        await load();
      } catch (err) {
        btn.disabled = false;
        const code = err && err.data && err.data.error;
        toast(code === 'already_clocked_in'
          ? $t('Already clocked in on another terminal')
          : ((err && err.message) || (wasOpen ? $t('Could not clock out') : $t('Could not clock in'))), 'warn');
      }
    }

    const onSync = () => load();
    window.addEventListener(SYNC_EVENT, onSync);
    root.querySelector('#staffRefresh').addEventListener('click', load);

    await load();

    return () => window.removeEventListener(SYNC_EVENT, onSync);
  },
};
