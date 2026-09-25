'use strict';

import { $t, $tn, N_, dateLocale } from '../lang.js';

/* Running costs: rent, power, the phone bill, the accountant. Not the till's
   petty cash — that stays on Paid out and Staff expense. Each cost carries the
   category that picks its account in the books, so the profit and loss reads
   like a real one instead of revenue, stock and pocket money. */

import { api } from '../api.js';
import { idb } from '../db.js';
import { screenHead, sectionHead, dataTable } from '../components.js';
import { fmt, esc, toast, beep, openModal, closeModal, csvCell, downloadCsv } from '../ui.js';
import { PRESETS, rangeFor } from './reports.js';

export const EXPENSE_METHODS = [
  { id: 'cash', label: N_('Cash from the till') },
  { id: 'bank', label: N_('Bank transfer') },
  { id: 'cheque', label: N_('Cheque') },
];

/* What stops a running cost being recorded. Empty string means nothing does.
   The same rules the server enforces, said before the round trip. */
export function expenseProblem({ category, amount, payee, method, reference }) {
  if (!category) return $t('Pick what the money was spent on');
  if (!(Number(amount) > 0)) return $t('Enter the amount');
  if (!String(payee || '').trim()) return $t('Say who was paid');
  if (!EXPENSE_METHODS.some((m) => m.id === method)) return $t('Pay by cash, bank transfer or cheque');
  if (method !== 'cash' && !String(reference || '').trim()) return $t('A bank transfer or cheque needs its reference');
  return '';
}

export function expensesCsv(data, range) {
  const n = (v) => (v == null ? '' : String(v));
  const lines = [`Running costs,${csvCell(range.from)},${csvCell(range.to)}`, ''];
  lines.push('By category');
  lines.push(['category', 'account', 'total'].join(','));
  for (const c of data.categories || []) lines.push([c.label, c.code, n(c.total)].map(csvCell).join(','));
  lines.push(['', 'Total', n(data.total)].map(csvCell).join(','));
  lines.push('');
  lines.push('Every cost');
  lines.push(['date', 'category', 'account', 'payee', 'method', 'reference', 'amount', 'status', 'recorded_by', 'note'].join(','));
  for (const e of data.expenses || []) {
    lines.push([e.at, e.categoryLabel, e.account, e.payee, e.method, e.reference, n(e.amount), e.status, e.by, e.note]
      .map(csvCell).join(','));
  }
  return lines.join('\n');
}

export const screen = {
  id: 'expenses',
  tab: 'expenses',
  title: 'Running costs',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const user = ctx.state.user || (await idb.get('meta', 'config'))?.user || {};
    const role = user.role || 'cashier';
    if (role !== 'admin' && role !== 'manager') {
      root.innerHTML = `<div class="empty"><p>${$t('Managers and admins only.')}</p></div>`;
      return;
    }
    const isAdmin = role === 'admin';

    let preset = 'month';
    let from = '';
    let to = '';
    let data = null;
    let loadErr = '';

    const shortDate = (iso) => {
      const d = iso ? new Date(iso) : null;
      return d && !isNaN(d) ? d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) : '—';
    };
    const methodLabel = (id) => {
      const m = EXPENSE_METHODS.find((x) => x.id === id);
      return m ? $t(m.label) : id;
    };

    async function load() {
      const range = rangeFor(preset, from, to);
      loadErr = '';
      root.innerHTML = `<div class="empty"><p>${$t('Loading…')}</p></div>`;
      try {
        data = await api.get(`/api/expenses?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
        from = range.from;
        to = range.to;
      } catch (err) {
        data = null;
        loadErr = (err && err.offline) ? $t('Offline — running costs need the server') : ((err && err.message) || $t('Failed to load running costs'));
      }
      draw();
    }

    function draw() {
      const range = rangeFor(preset, from, to);
      const spent = data ? data.categories.filter((c) => c.total > 0) : [];
      root.innerHTML = `
        ${screenHead({
          title: $t('Running costs'),
          sub: $t('Rent, power, the phone bill — what it costs to keep the doors open'),
          actions: `<div class="scr-actions">
            ${data ? `<button class="btn btn-sm btn-ghost" id="exCsv">${$t('Export CSV')}</button>` : ''}
            <button class="btn btn-sm btn-primary" id="exNew">${$t('Record a cost')}</button>
          </div>`,
        })}

        <div class="rep-chips">
          ${PRESETS.map((p) => `<button class="rep-chip ${p.id === preset ? 'on' : ''}" data-p="${p.id}">${esc($t(p.label))}</button>`).join('')}
          ${preset === 'custom' ? `
            <div class="rep-dates">
              <input class="field" id="exFrom" type="date" value="${esc(from)}" aria-label="${$t('From')}">
              <input class="field" id="exTo" type="date" value="${esc(to)}" aria-label="${$t('To')}">
              <button class="btn btn-sm" id="exGo">${$t('Go')}</button>
            </div>` : ''}
        </div>

        ${loadErr ? `<div class="empty"><p>${esc(loadErr)}</p></div>` : !data ? '' : `
        <div class="dash-kpis">
          <div class="dash-kpi"><span>${$t('Spent in this period')}</span><strong>${fmt(data.total)}</strong></div>
          <div class="dash-kpi"><span>${$t('Costs recorded')}</span><strong>${data.count}</strong></div>
        </div>

        <section class="dash-section">
          ${sectionHead({ title: $t('Where it went') })}
          ${spent.length ? dataTable({
            head: [{ label: $t('Category') }, { label: $t('Total'), num: true }],
            bodyHtml: spent.map((c) => `
              <tr>
                <td>${esc($t(c.label))}<br><span class="muted">${esc(c.code)}</span></td>
                <td class="num">${esc(fmt(c.total))}</td>
              </tr>`).join(''),
          }) : `<p class="muted">${$t('Nothing recorded in this period.')}</p>`}
        </section>

        <section class="dash-section">
          ${sectionHead({ title: $t('Every cost') })}
          ${data.expenses.length ? dataTable({
            head: [{ label: $t('What') }, { label: $t('Paid to') }, { label: $t('Amount'), num: true }, { label: '' }],
            bodyHtml: data.expenses.map((e) => `
              <tr class="${e.status === 'VOIDED' ? 'ex-voided' : ''}">
                <td>${esc($t(e.categoryLabel))}<br><span class="muted">${esc(shortDate(e.at))} · ${esc(methodLabel(e.method))}${e.reference ? ` · ${esc(e.reference)}` : ''}</span></td>
                <td>${esc(e.payee)}${e.note ? `<br><span class="muted">${esc(e.note)}</span>` : ''}</td>
                <td class="num">${esc(fmt(e.amount))}${e.status === 'VOIDED' ? `<br><span class="po-chip overdue">${$t('Voided')}</span>` : ''}</td>
                <td>${isAdmin && e.status !== 'VOIDED' ? `<button class="btn btn-sm btn-ghost" data-void="${esc(e.id)}">${$t('Void')}</button>` : ''}</td>
              </tr>`).join(''),
          }) : `<p class="muted">${$t('Nothing recorded in this period.')}</p>`}
        </section>`}
      `;

      root.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
        preset = b.dataset.p;
        if (preset !== 'custom') load(); else draw();
      }));
      root.querySelector('#exGo')?.addEventListener('click', () => {
        from = root.querySelector('#exFrom').value;
        to = root.querySelector('#exTo').value;
        load();
      });
      root.querySelector('#exNew')?.addEventListener('click', recordModal);
      root.querySelector('#exCsv')?.addEventListener('click', () => {
        downloadCsv(`orison-running-costs-${range.from}-to-${range.to}.csv`, expensesCsv(data, range));
      });
      root.querySelectorAll('[data-void]').forEach((b) => b.addEventListener('click', () => voidModal(b.dataset.void)));
    }

    function recordModal() {
      const m = openModal(`
        <h3>${$t('Record a cost')}</h3>
        <p class="muted">${$t('A bill the business paid, whichever pocket it came from. Petty cash out of the till is Paid Out or Staff Expense.')}</p>
        <label class="field-label">${$t('What was it for')}</label>
        <select class="field" id="exCat">
          ${(data ? data.categories : []).map((c) => `<option value="${esc(c.id)}">${esc($t(c.label))}</option>`).join('')}
        </select>
        <div class="form-grid">
          <div>
            <label class="field-label">${$t('Amount')}</label>
            <input class="field" id="exAmount" inputmode="decimal" placeholder="0.00">
          </div>
          <div>
            <label class="field-label">${$t('How it was paid')}</label>
            <select class="field" id="exMethod">
              ${EXPENSE_METHODS.map((x) => `<option value="${esc(x.id)}">${esc($t(x.label))}</option>`).join('')}
            </select>
          </div>
        </div>
        <label class="field-label">${$t('Paid to')}</label>
        <input class="field" id="exPayee" placeholder="${$t('Landlord, City Power, the accountant…')}">
        <label class="field-label">${$t('Reference')}</label>
        <input class="field" id="exRef" placeholder="${$t('Transfer or cheque number')}">
        <label class="field-label">${$t('Note')}</label>
        <input class="field" id="exNote" placeholder="${$t('Which month, which invoice')}">
        <p class="muted">${$t('Cash comes out of the till and off the drawer count. A transfer or cheque does not touch the drawer.')}</p>
        <p id="exErr" class="login-err"></p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>${$t('Cancel')}</button>
          <button class="btn btn-primary" id="exGoSave">${$t('Record it')}</button>
        </div>
      `);
      m.querySelector('#exGoSave').addEventListener('click', async () => {
        const body = {
          category: m.querySelector('#exCat').value,
          amount: Number(m.querySelector('#exAmount').value) || 0,
          payee: m.querySelector('#exPayee').value.trim(),
          method: m.querySelector('#exMethod').value,
          reference: m.querySelector('#exRef').value.trim(),
          note: m.querySelector('#exNote').value.trim(),
        };
        const problem = expenseProblem(body);
        if (problem) { m.querySelector('#exErr').textContent = problem; return; }
        const go = m.querySelector('#exGoSave');
        go.disabled = true;
        try {
          await api.post('/api/expenses', body);
          closeModal();
          toast($t('Recorded — {amount}', { amount: fmt(body.amount) }), 'ok');
          beep('ok');
          await load();
        } catch (err) {
          m.querySelector('#exErr').textContent = (err && err.message) || $t('Could not record that');
          go.disabled = false;
        }
      });
    }

    function voidModal(id) {
      const m = openModal(`
        <h3>${$t('Void this cost')}</h3>
        <p class="muted">${$t('It stays on record with the reason, and its money leaves the totals and the books.')}</p>
        <label class="field-label">${$t('Reason')}</label>
        <input class="field" id="exVoidWhy" placeholder="${$t('Entered twice')}">
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>${$t('Cancel')}</button>
          <button class="btn btn-danger" id="exVoidGo">${$t('Void it')}</button>
        </div>
      `);
      m.querySelector('#exVoidGo').addEventListener('click', async () => {
        const reason = m.querySelector('#exVoidWhy').value.trim();
        if (!reason) { toast($t('A void needs a reason'), 'warn'); return; }
        const go = m.querySelector('#exVoidGo');
        go.disabled = true;
        try {
          await api.post('/api/expenses/void', { id, reason });
          closeModal();
          toast($t('Voided'), 'ok');
          await load();
        } catch (err) {
          toast((err && err.message) || $t('Could not void that'), 'err');
          go.disabled = false;
        }
      });
    }

    await load();
  },
};
