'use strict';

/* Open the cash drawer without a sale.

   A no-sale open is the classic way cash walks out of a till, so it takes a
   reason and is written to the audit log with who did it and on which
   terminal. The record is made first and is best-effort: a shop that has lost
   its connection still has to be able to make change. */

import { api } from './api.js';
import { esc, toast, beep, openModal, closeModal } from './ui.js';
import { getDeviceId } from './sync.js';

const REASONS = ['Change for a customer', 'Correcting a mistake', 'Counting the float'];

export function openDrawerDialog(ctx) {
  const modal = openModal(`
    <div class="form-modal">
      <h3>Open the cash drawer</h3>
      <p class="muted">No sale is being made, so this is recorded with your name and the reason.</p>
      <div class="seg seg-sm" id="drReasons">
        ${REASONS.map((r) => `<button class="seg-btn" data-reason="${esc(r)}" type="button">${esc(r)}</button>`).join('')}
      </div>
      <div class="field"><span>Reason</span><input id="drWhy" autocomplete="off" placeholder="Why is the drawer being opened?"></div>
      <p id="drErr" class="login-err"></p>
      <div class="row">
        <button class="btn btn-ghost" data-cancel type="button">Cancel</button>
        <button class="btn" id="drGo" type="button">Open drawer</button>
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
    if (!reason) { err.textContent = 'Give a reason - it goes in the audit log.'; beep('err'); return; }
    go.disabled = true;

    let recorded = true;
    try {
      await api.post('/api/drawer/open', { reason, deviceId: await getDeviceId() });
    } catch (_) {
      recorded = false;
    }

    const pr = await import('./printing.js');
    const r = await pr.kickDrawer();
    closeModal();
    if (r.ok) {
      beep('ok');
      toast(recorded ? 'Drawer opened' : 'Drawer opened - offline, so not recorded', recorded ? 'ok' : 'warn', 3200);
    } else {
      toast(r.message + (recorded ? ' (The open was recorded.)' : ''), 'warn', 4200);
    }
  });
  why.focus();
  return modal;
}
