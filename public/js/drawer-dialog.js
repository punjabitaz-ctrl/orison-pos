'use strict';

/* Open the cash drawer without a sale.

   A no-sale open is the classic way cash walks out of a till, so it takes a
   reason and is written to the audit log with who did it and on which
   terminal. The record is made first and is best-effort: a shop that has lost
   its connection still has to be able to make change. */

import { api } from './api.js';
import { esc, toast, beep, openModal, closeModal } from './ui.js';
import { getDeviceId, newClientTxId } from './sync.js';
import { $t, N_ } from './lang.js';

const REASONS = [N_('Change for a customer'), N_('Correcting a mistake'), N_('Counting the float')];

export function openDrawerDialog(ctx) {
  const modal = openModal(`
    <div class="form-modal">
      <h3>${esc($t('Open the cash drawer'))}</h3>
      <p class="muted">${esc($t('No sale is being made, so this is recorded with your name and the reason.'))}</p>
      <div class="seg seg-sm" id="drReasons">
        ${REASONS.map((r) => `<button class="seg-btn" data-reason="${esc($t(r))}" type="button">${esc($t(r))}</button>`).join('')}
      </div>
      <div class="field"><span>${esc($t('Reason'))}</span><input id="drWhy" autocomplete="off" placeholder="${esc($t('Why is the drawer being opened?'))}"></div>
      <p id="drErr" class="login-err"></p>
      <div class="row">
        <button class="btn btn-ghost" data-cancel type="button">${esc($t('Cancel'))}</button>
        <button class="btn" id="drGo" type="button">${esc($t('Open drawer'))}</button>
      </div>
    </div>`);

  const why = modal.querySelector('#drWhy');
  const err = modal.querySelector('#drErr');
  modal.querySelectorAll('[data-reason]').forEach((b) => b.addEventListener('click', () => {
    why.value = b.dataset.reason;
    modal.querySelectorAll('[data-reason]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  modal.querySelector('[data-cancel]').addEventListener('click', closeModal);

  const go = modal.querySelector('#drGo');
  go.addEventListener('click', async () => {
    const reason = why.value.trim();
    if (!reason) { err.textContent = $t('Give a reason - it goes in the audit log.'); beep('err'); return; }
    go.disabled = true;

    const role = (ctx && ctx.state && ctx.state.user && ctx.state.user.role) || 'cashier';
    const manager = role === 'admin' || role === 'manager';

    /* A manager's open is best-effort recorded: a shop that has lost its
       connection still has to make change. A cashier's needs a manager's
       approval first, and nothing opens without it (v1.37.0). */
    let recorded = true;
    let approvedBy = '';
    if (manager) {
      try {
        await api.post('/api/drawer/open', { reason, deviceId: await getDeviceId() });
      } catch (_) {
        recorded = false;
      }
    } else {
      const ref = 'drawer-' + newClientTxId();
      const { requestApproval } = await import('./approval-dialog.js');
      const granted = await requestApproval({ action: 'drawer', ref, detail: reason });
      if (!granted) { go.disabled = false; return; }
      try {
        const res = await api.post('/api/drawer/open', { reason, ref, approval: granted.approval, deviceId: await getDeviceId() });
        approvedBy = res.approvedBy || granted.approver.name;
      } catch (e) {
        err.textContent = (e && e.message) || $t('Could not record the approval - the drawer stays shut.');
        go.disabled = false;
        beep('err');
        return;
      }
    }

    const pr = await import('./printing.js');
    const r = await pr.kickDrawer();
    closeModal();
    if (r.ok) {
      beep('ok');
      toast(approvedBy ? $t('Drawer opened - approved by {name}', { name: approvedBy })
        : recorded ? $t('Drawer opened') : $t('Drawer opened - offline, so not recorded'), recorded ? 'ok' : 'warn', 3200);
    } else {
      toast(r.message + (recorded ? ' ' + $t('(The open was recorded.)') : ''), 'warn', 4200);
    }
  });
  why.focus();
  return modal;
}
