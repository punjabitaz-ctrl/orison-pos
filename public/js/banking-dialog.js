'use strict';

import { $t, N_, dateLocale } from './lang.js';

/* Banking the cash. A pick-up takes notes out of the till and puts them in a
   bag; this says the bag reached the bank. Until it does, the books carry the
   money as Cash in transit — which is true only for as long as somebody is
   actually carrying it. */

import { api } from './api.js';
import { fmt, esc, toast, beep, openModal, closeModal } from './ui.js';

/* What stops a deposit being recorded. Empty string means nothing does. */
export function depositProblem({ amount, reference, inTransit }) {
  if (!(Number(amount) > 0)) return $t('Enter what was banked');
  if (!String(reference || '').trim()) return $t('A deposit needs its paying-in slip or reference');
  if (Number(amount) > Number(inTransit) + 0.0001) {
    return $t('Only {amount} has been picked up and not yet banked', { amount: fmt(inTransit) });
  }
  return '';
}

export async function openBankingDialog(ctx, onDone) {
  let book = null;
  try {
    book = await api.get('/api/banking');
  } catch (err) {
    toast((err && err.offline) ? $t('Offline — banking needs the server') : ((err && err.message) || $t('Could not open banking')), 'warn');
    return;
  }

  const shortDate = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) : '—';
  };
  const isAdmin = ((ctx && ctx.state && ctx.state.user) || {}).role === 'admin';

  const m = openModal(`
    <h3>${$t('Bank the cash')}</h3>
    <div class="po-lines-subtotal">
      <span class="muted">${$t('Picked up and not yet banked')}</span>
      <strong>${esc(fmt(book.inTransit))}</strong>
    </div>
    <p class="muted">${$t('A pick-up moves cash out of the till into the bag. This says the bag reached the bank.')}</p>
    ${book.inTransit > 0 ? `
      <div class="form-grid">
        <div>
          <label class="field-label">${$t('Amount banked')}</label>
          <input class="field" id="bkAmount" inputmode="decimal" value="${esc(String(book.inTransit))}">
        </div>
        <div>
          <label class="field-label">${$t('Paying-in slip')}</label>
          <input class="field" id="bkRef" placeholder="${$t('Slip or reference number')}">
        </div>
      </div>
      <label class="field-label">${$t('Bank')}</label>
      <input class="field" id="bkBank" placeholder="${$t('Which bank or branch')}">
      <label class="field-label">${$t('Note')}</label>
      <input class="field" id="bkNote" placeholder="${$t('Who took it, anything unusual')}">
      <p id="bkErr" class="login-err"></p>
    ` : `<p class="muted">${$t('Nothing is waiting to be banked. Cash reaches the bag through a cash pick-up.')}</p>`}

    ${(book.deposits || []).length ? `
      <label class="field-label">${$t('Banked before')}</label>
      <div class="po-plain">
        ${book.deposits.slice(0, 6).map((d) => `
          <div class="po-bench-row">
            <div class="po-bench-main">
              <strong>${esc(fmt(d.amount))}</strong>
              <span class="muted">${esc(shortDate(d.at))}${d.bank ? ` · ${esc(d.bank)}` : ''} · ${esc(d.reference)}${d.by ? ` · ${esc(d.by)}` : ''}</span>
            </div>
            ${isAdmin ? `<button class="btn btn-sm btn-ghost" data-void-dep="${esc(d.id)}">${$t('Void')}</button>` : ''}
          </div>`).join('')}
      </div>` : ''}

    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>${$t('Close')}</button>
      ${book.inTransit > 0 ? `<button class="btn btn-primary" id="bkGo">${$t('Record the deposit')}</button>` : ''}
    </div>
  `);

  m.querySelector('#bkGo')?.addEventListener('click', async () => {
    const amount = Number(m.querySelector('#bkAmount').value) || 0;
    const reference = m.querySelector('#bkRef').value.trim();
    const problem = depositProblem({ amount, reference, inTransit: book.inTransit });
    if (problem) { m.querySelector('#bkErr').textContent = problem; return; }
    const go = m.querySelector('#bkGo');
    go.disabled = true;
    try {
      await api.post('/api/banking', {
        amount, reference,
        bank: m.querySelector('#bkBank').value.trim(),
        note: m.querySelector('#bkNote').value.trim(),
      });
      closeModal();
      toast($t('Banked — {amount}', { amount: fmt(amount) }), 'ok');
      beep('ok');
      if (onDone) await onDone();
    } catch (err) {
      m.querySelector('#bkErr').textContent = (err && err.message) || $t('Could not record that deposit');
      go.disabled = false;
    }
  });

  m.querySelectorAll('[data-void-dep]').forEach((b) => b.addEventListener('click', async () => {
    const reason = String(window.prompt($t('Why is this deposit being voided?')) || '').trim();
    if (!reason) return;
    try {
      await api.post('/api/banking/void', { id: b.dataset.voidDep, reason });
      closeModal();
      toast($t('Deposit voided'), 'ok');
      if (onDone) await onDone();
    } catch (err) {
      toast((err && err.message) || $t('Could not void that deposit'), 'err');
    }
  }));
}
