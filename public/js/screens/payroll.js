'use strict';

import { $t, $tn, N_, dateLocale } from '../lang.js';

/* Payroll: what the team is owed for a period, and paying it. Admin only —
   the server refuses everyone else, and this screen never holds a rate the
   server did not already hand it. A run is a draft until it is paid: adjust a
   line with a reason, then pay it in cash from the till, by bank transfer or
   by cheque. Paying writes one wages row the drawer, Reports, the day export
   and the books all account for. */

import { api } from '../api.js';
import { idb } from '../db.js';
import { screenHead, sectionHead } from '../components.js';
import { fmt, esc, toast, beep, openModal, closeModal } from '../ui.js';
import { exportCsv } from '../csv.js';
import { exportPdf } from '../pdf-export.js';

export const PAY_METHODS = [
  { id: 'cash', label: N_('Cash from the till') },
  { id: 'bank', label: N_('Bank transfer') },
  { id: 'cheque', label: N_('Cheque') },
];

const STATES = {
  DRAFT: { label: N_('Draft'), cls: 'ordered' },
  PAID: { label: N_('Paid'), cls: 'received' },
  VOIDED: { label: N_('Voided'), cls: 'overdue' },
};

export function runState(status) {
  return STATES[String(status || '').toUpperCase()] || STATES.DRAFT;
}

/* The periods a shop actually pays for: the month just gone, the one running,
   and the week just gone. Dates are plain YYYY-MM-DD, like every other period
   the server takes. */
export function payPeriods(today = new Date()) {
  const iso = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const firstThis = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const lastPrevEnd = new Date(firstThis.getTime() - 86400000);
  const firstPrev = new Date(Date.UTC(lastPrevEnd.getUTCFullYear(), lastPrevEnd.getUTCMonth(), 1));
  const weekEnd = new Date(base.getTime() - 86400000);
  const weekStart = new Date(weekEnd.getTime() - 6 * 86400000);
  return [
    { id: 'lastMonth', label: N_('Last month'), from: iso(firstPrev), to: iso(lastPrevEnd) },
    { id: 'thisMonth', label: N_('This month so far'), from: iso(firstThis), to: iso(base) },
    { id: 'lastWeek', label: N_('The last seven days'), from: iso(weekStart), to: iso(weekEnd) },
  ];
}

/* What stops a payment being recorded. Empty string means nothing does. */
export function payProblem({ method, reference, grossTotal }) {
  if (!PAY_METHODS.some((m) => m.id === method)) return $t('Pay by cash, bank transfer or cheque');
  if (method !== 'cash' && !String(reference || '').trim()) return $t('A bank transfer or cheque needs its reference');
  if (!(Number(grossTotal) > 0)) return $t('There is nothing to pay on this run');
  return '';
}

/* A pay run as a spreadsheet: one row per person, which is what a payslip
   run or an accountant's journal actually needs. */
export function payRunCsv(run) {
  const n = (v) => (v == null ? '' : String(v));
  return {
    title: `Pay run ${run.periodFrom} to ${run.periodTo} (${run.status})`,
    columns: ['name', 'paid', 'rate', 'hours', 'base_pay', 'adjustment', 'adjustment_reason', 'gross'],
    rows: (run.lines || []).map((l) => [l.name, l.payType, n(l.rate), n(l.hours), n(l.basePay), n(l.adjustment), l.adjustmentNote, n(l.gross)]),
    extra: [{ title: 'Summary', columns: ['people', 'gross_total', 'method', 'reference', 'paid_at'],
      rows: [[n((run.lines || []).length), n(run.grossTotal), run.method, run.reference, run.paidAt]] }],
  };
}

export function runTotal(lines) {
  return (lines || []).reduce((sum, l) => sum + (Number(l.gross) || 0), 0);
}

export const screen = {
  id: 'payroll',
  tab: 'payroll',
  title: 'Payroll',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const user = ctx.state.user || (await idb.get('meta', 'config'))?.user || {};
    if ((user.role || 'cashier') !== 'admin') {
      root.innerHTML = `<div class="empty"><p>${$t('Admins only.')}</p></div>`;
      return;
    }

    let runs = [];
    let staffWithoutRate = 0;
    let loadErr = '';

    const shortDate = (iso) => {
      const d = iso ? new Date(iso) : null;
      return d && !isNaN(d) ? d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) : '—';
    };

    async function load() {
      loadErr = '';
      root.innerHTML = `<div class="empty"><p>${$t('Loading…')}</p></div>`;
      try {
        const res = await api.get('/api/payroll');
        runs = res.runs || [];
        staffWithoutRate = res.staffWithoutRate || 0;
      } catch (err) {
        loadErr = (err && err.offline) ? $t('Offline — payroll needs the server') : ((err && err.message) || $t('Failed to load payroll'));
      }
      draw();
    }

    function draw() {
      const unpaidDrafts = runs.filter((r) => r.status === 'DRAFT');
      root.innerHTML = `
        ${screenHead({
          title: $t('Payroll'),
          sub: $t('Hours on the clock, into what the team is owed'),
          actions: `<button class="btn btn-sm btn-primary" id="pyNew">${$t('New pay run')}</button>`,
        })}

        ${loadErr ? `<div class="empty"><p>${esc(loadErr)}</p></div>` : `
        ${staffWithoutRate ? `<p class="muted scr-note">${esc($tn(
          '{n} person has no pay rate yet, so they are not on any run. Set it on the Time Clock screen.',
          '{n} people have no pay rate yet, so they are not on any run. Set it on the Time Clock screen.',
          staffWithoutRate))}</p>` : ''}

        ${unpaidDrafts.length ? `<p class="muted scr-note">${esc($tn('{n} run is drafted and not yet paid.', '{n} runs are drafted and not yet paid.', unpaidDrafts.length))}</p>` : ''}

        <section class="po-block">
          ${sectionHead({ title: $t('Pay runs') })}
          ${runs.length ? `
          <div class="po-plain">
            ${runs.map((r) => `
              <button class="po-supplier" type="button" data-run="${esc(r.id)}">
                <span class="po-sup-top">
                  <strong>${esc($t('{from} to {to}', { from: shortDate(r.periodFrom), to: shortDate(r.periodTo) }))}</strong>
                  <strong>${esc(fmt(r.grossTotal))}</strong>
                </span>
                <span class="muted">${esc($tn('{n} person', '{n} people', r.people))}${r.paidAt ? ` · ${esc($t('paid {date}', { date: shortDate(r.paidAt) }))}` : ''}</span>
                <span class="muted"><span class="po-chip ${runState(r.status).cls}">${esc($t(runState(r.status).label))}</span>${r.voidedReason ? ` · ${esc(r.voidedReason)}` : ''}</span>
              </button>`).join('')}
          </div>` : `<p class="muted">${$t('No pay runs yet. Draft one for the period you are paying.')}</p>`}
        </section>`}
      `;

      const newBtn = root.querySelector('#pyNew');
      if (newBtn) newBtn.addEventListener('click', newRunModal);
      root.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => openRun(b.dataset.run)));
    }

    function newRunModal() {
      const periods = payPeriods(new Date());
      const m = openModal(`
        <h3>${$t('New pay run')}</h3>
        <p class="muted">${$t('Every active person with a pay rate is included: hourly staff at the hours their clock closed in the period, salaried staff at their monthly figure.')}</p>
        <label class="field-label">${$t('Period')}</label>
        <div class="seg seg-sm" id="pyPeriods">
          ${periods.map((p, i) => `<button class="${i === 0 ? 'on' : ''}" data-period="${esc(p.id)}" type="button">${esc($t(p.label))}</button>`).join('')}
        </div>
        <div class="form-grid">
          <div>
            <label class="field-label">${$t('From')}</label>
            <input class="field" id="pyFrom" type="date" value="${esc(periods[0].from)}">
          </div>
          <div>
            <label class="field-label">${$t('To')}</label>
            <input class="field" id="pyTo" type="date" value="${esc(periods[0].to)}">
          </div>
        </div>
        <label class="field-label">${$t('Note')}</label>
        <input class="field" id="pyNote" placeholder="${$t('Anything the accountant should see')}">
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>${$t('Cancel')}</button>
          <button class="btn btn-primary" id="pyGo">${$t('Draft the run')}</button>
        </div>
      `);
      m.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => {
        const p = periods.find((x) => x.id === b.dataset.period);
        if (!p) return;
        m.querySelectorAll('[data-period]').forEach((x) => x.classList.toggle('on', x === b));
        m.querySelector('#pyFrom').value = p.from;
        m.querySelector('#pyTo').value = p.to;
      }));
      m.querySelector('#pyGo').addEventListener('click', async () => {
        const go = m.querySelector('#pyGo');
        go.disabled = true;
        try {
          const res = await api.post('/api/payroll', {
            periodFrom: m.querySelector('#pyFrom').value,
            periodTo: m.querySelector('#pyTo').value,
            note: m.querySelector('#pyNote').value.trim(),
          });
          closeModal();
          toast($tn('Drafted for {n} person', 'Drafted for {n} people', res.people), 'ok');
          beep('ok');
          await load();
          await openRun(res.id);
        } catch (err) {
          toast((err && err.message) || $t('Could not draft that run'), 'err');
          go.disabled = false;
        }
      });
    }

    async function openRun(id) {
      let run = null;
      let msg = '';
      try {
        run = await api.get('/api/payroll/detail?id=' + encodeURIComponent(id));
      } catch (err) {
        msg = (err && err.message) || $t('Could not open that run');
      }

      const m = openModal(`
        <h3>${run ? esc($t('{from} to {to}', { from: shortDate(run.periodFrom), to: shortDate(run.periodTo) })) : $t('Pay run')}</h3>
        ${msg ? `<div class="po-msg">${esc(msg)}</div>` : `
        <p class="muted">
          <span class="po-chip ${runState(run.status).cls}">${esc($t(runState(run.status).label))}</span>
          ${run.paidAt ? ` · ${esc($t('paid {date}', { date: shortDate(run.paidAt) }))}${run.method ? ` · ${esc(run.method)}` : ''}${run.reference ? ` · ${esc(run.reference)}` : ''}` : ''}
          ${run.voidedReason ? ` · ${esc(run.voidedReason)}` : ''}
        </p>
        <div class="po-detail-lines">
          ${run.lines.map((l) => `
            <div class="po-detail-line">
              <div class="po-detail-main">
                <strong>${esc(l.name)}</strong>
                <span class="muted">${l.payType === 'hourly'
                  ? esc($t('{hours} h × {rate}', { hours: l.hours, rate: fmt(l.rate) }))
                  : esc($t('monthly {rate}', { rate: fmt(l.rate) }))}${l.openEntries ? ` · ${esc($tn('{n} shift still open', '{n} shifts still open', l.openEntries))}` : ''}</span>
                ${l.adjustment ? `<span class="muted">${esc((l.adjustment > 0 ? '+' : '') + fmt(l.adjustment))}${l.adjustmentNote ? ` · ${esc(l.adjustmentNote)}` : ''}</span>` : ''}
              </div>
              <div class="po-detail-right">
                <strong>${esc(fmt(l.gross))}</strong>
                ${run.status === 'DRAFT' ? `<button class="btn btn-sm btn-ghost" data-adjust="${esc(l.userId)}">${$t('Adjust')}</button>` : ''}
              </div>
            </div>`).join('')}
        </div>
        <div class="po-lines-subtotal">
          <span class="muted">${esc($tn('{n} person', '{n} people', run.lines.length))}</span>
          <strong>${esc(fmt(run.grossTotal))}</strong>
        </div>
        ${run.note ? `<p class="muted">${esc(run.note)}</p>` : ''}
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>${$t('Close')}</button>
          <button class="btn btn-ghost" id="pyCsv">${$t('Export CSV')}</button>
          <button class="btn btn-ghost" id="pyPdf">${$t('PDF')}</button>
          ${run.status === 'DRAFT' ? `<button class="btn btn-primary" id="pyPay">${$t('Pay this run')}</button>` : ''}
          ${run.status !== 'VOIDED' ? `<button class="btn btn-danger-ghost" id="pyVoid">${$t('Void')}</button>` : ''}
        </div>`}
      `);
      if (!run) return;

      m.querySelectorAll('[data-adjust]').forEach((b) => b.addEventListener('click', () => {
        const line = run.lines.find((l) => l.userId === b.dataset.adjust);
        if (line) adjustModal(run, line);
      }));
      m.querySelector('#pyCsv')?.addEventListener('click', () => {
        exportCsv('pay-run', { ...payRunCsv(run), range: { from: run.periodFrom, to: run.periodTo } });
      });
      m.querySelector('#pyPdf')?.addEventListener('click', () => {
        exportPdf('pay-run', {
          title: $t('Payroll'),
          range: { from: run.periodFrom, to: run.periodTo },
          columns: [$t('Name'), $t('Rate'), $t('Hours'), $t('Base pay'), $t('Adjustment'), $t('Reason'), $t('Total')],
          numericFrom: 1,
          rows: run.lines.map((l) => [l.name,
            l.payType === 'hourly' ? fmt(l.rate) : $t('monthly {rate}', { rate: fmt(l.rate) }),
            l.payType === 'hourly' ? String(l.hours) : '—',
            fmt(l.basePay), l.adjustment ? fmt(l.adjustment) : '', l.adjustmentNote, fmt(l.gross)]),
          meta: $t('{n} people · {amount}', { n: run.lines.length, amount: fmt(run.grossTotal) }),
        });
      });
      const payBtn = m.querySelector('#pyPay');
      if (payBtn) payBtn.addEventListener('click', () => payModal(run));
      const voidBtn = m.querySelector('#pyVoid');
      if (voidBtn) voidBtn.addEventListener('click', () => voidModal(run));
    }

    function adjustModal(run, line) {
      const m = openModal(`
        <h3>${esc($t('Adjust {name}', { name: line.name }))}</h3>
        <p class="muted">${$t('A bonus, a deduction, or an advance already handed over. Overtime and end-of-service are entered here too, with the reason — the shop knows its own rules better than this screen does.')}</p>
        <label class="field-label">${$t('Amount (minus for a deduction)')}</label>
        <input class="field" id="pyAdjAmount" inputmode="decimal" value="${esc(String(line.adjustment || 0))}">
        <label class="field-label">${$t('Reason')}</label>
        <input class="field" id="pyAdjNote" value="${esc(line.adjustmentNote || '')}" placeholder="${$t('Saturday cover, advance paid on the 3rd…')}">
        <p class="muted">${esc($t('Base pay {base}', { base: fmt(line.basePay) }))}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>${$t('Cancel')}</button>
          <button class="btn btn-primary" id="pyAdjGo">${$t('Save')}</button>
        </div>
      `);
      m.querySelector('#pyAdjGo').addEventListener('click', async () => {
        const amount = Number(m.querySelector('#pyAdjAmount').value) || 0;
        const note = m.querySelector('#pyAdjNote').value.trim();
        if (amount !== 0 && !note) { toast($t('An adjustment needs a reason'), 'warn'); return; }
        const go = m.querySelector('#pyAdjGo');
        go.disabled = true;
        try {
          await api.post('/api/payroll/line', { id: run.id, userId: line.userId, adjustment: amount, note });
          closeModal();
          await openRun(run.id);
        } catch (err) {
          toast((err && err.message) || $t('Could not save that adjustment'), 'err');
          go.disabled = false;
        }
      });
    }

    function payModal(run) {
      const m = openModal(`
        <h3>${$t('Pay this run')}</h3>
        <div class="po-lines-subtotal">
          <span class="muted">${esc($tn('{n} person', '{n} people', run.lines.length))}</span>
          <strong>${esc(fmt(run.grossTotal))}</strong>
        </div>
        <label class="field-label">${$t('How it was paid')}</label>
        <select class="field" id="pyMethod">
          ${PAY_METHODS.map((x) => `<option value="${esc(x.id)}">${esc($t(x.label))}</option>`).join('')}
        </select>
        <label class="field-label">${$t('Reference')}</label>
        <input class="field" id="pyRef" placeholder="${$t('Transfer or cheque number')}">
        <label class="field-label">${$t('Note')}</label>
        <input class="field" id="pyPayNote" placeholder="${$t('Anything the accountant should see')}">
        <p class="muted">${$t('Cash comes out of the till and off the drawer count. A transfer or cheque does not touch the drawer.')}</p>
        <p id="pyPayErr" class="login-err"></p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>${$t('Cancel')}</button>
          <button class="btn btn-primary" id="pyPayGo">${$t('Record payment')}</button>
        </div>
      `);
      m.querySelector('#pyPayGo').addEventListener('click', async () => {
        const method = m.querySelector('#pyMethod').value;
        const reference = m.querySelector('#pyRef').value.trim();
        const problem = payProblem({ method, reference, grossTotal: run.grossTotal });
        if (problem) { m.querySelector('#pyPayErr').textContent = problem; return; }
        const go = m.querySelector('#pyPayGo');
        go.disabled = true;
        try {
          const res = await api.post('/api/payroll/pay', {
            id: run.id, method, reference, note: m.querySelector('#pyPayNote').value.trim(),
          });
          closeModal();
          toast($t('Paid — {amount}', { amount: fmt(res.grossTotal) }), 'ok');
          beep('ok');
          await load();
        } catch (err) {
          m.querySelector('#pyPayErr').textContent = (err && err.message) || $t('Could not record that payment');
          go.disabled = false;
        }
      });
    }

    function voidModal(run) {
      const m = openModal(`
        <h3>${$t('Void this pay run')}</h3>
        <p class="muted">${$t('It stays on record with the reason, and its money leaves the drawer, Reports and the books. Use it for a run entered twice or paid by mistake.')}</p>
        <label class="field-label">${$t('Reason')}</label>
        <input class="field" id="pyVoidWhy" placeholder="${$t('Entered twice')}">
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>${$t('Cancel')}</button>
          <button class="btn btn-danger" id="pyVoidGo">${$t('Void it')}</button>
        </div>
      `);
      m.querySelector('#pyVoidGo').addEventListener('click', async () => {
        const reason = m.querySelector('#pyVoidWhy').value.trim();
        if (!reason) { toast($t('A void needs a reason'), 'warn'); return; }
        const go = m.querySelector('#pyVoidGo');
        go.disabled = true;
        try {
          await api.post('/api/payroll/void', { id: run.id, reason });
          closeModal();
          toast($t('Pay run voided'), 'ok');
          await load();
        } catch (err) {
          toast((err && err.message) || $t('Could not void that run'), 'err');
          go.disabled = false;
        }
      });
    }

    await load();
    return () => {};
  },
};
