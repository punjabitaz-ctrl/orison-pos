'use strict';

/* Money-out dialogs, lifted out of the dashboard so the launcher can open them
   directly. A tile labelled "Paid Out" has to open Paid Out - dropping someone
   on a screen and expecting them to find a button is the failure this redesign
   exists to remove. */

import { esc, toast, openModal, closeModal, currencySymbol } from './ui.js';
import { createPayout } from './money.js';

export function openPayoutDialog(ctx, onDone) {
  const user = (ctx && ctx.state && ctx.state.user) || {};
  const modalEl = openModal(`
    <div class="tx-detail payout-modal">
      <button class="icon-btn abs-close" data-x>✕</button>
      <h3>Record paid out</h3>
      <p class="muted">Cash leaving the business — vendor payment, cash pick-up, expense. Managers and admins only.</p>
      <label class="field-label">To / reason
        <input class="field" id="po-to" placeholder="e.g. Vendor, cash pick-up">
      </label>
      <label class="field-label">Amount (${esc(currencySymbol())})
        <input class="field" id="po-amt" type="number" min="0" step="0.01" placeholder="0.00">
      </label>
      <label class="field-label">Note (optional)
        <input class="field" id="po-note" placeholder="e.g. restock — keyboards">
      </label>
      <button class="btn" id="po-confirm" style="--bg:#c62828">Confirm paid out</button>
    </div>`);
  modalEl.querySelector('[data-x]').addEventListener('click', closeModal);
  const confirm = modalEl.querySelector('#po-confirm');
  confirm.addEventListener('click', async () => {
    const amount = Number(modalEl.querySelector('#po-amt').value);
    if (!(amount > 0)) { toast('Enter an amount', 'warn'); return; }
    confirm.disabled = true;
    try {
      await createPayout({
        counterparty: modalEl.querySelector('#po-to').value.trim(),
        grandTotal: amount,
        note: modalEl.querySelector('#po-note').value.trim(),
        user,
      });
      closeModal();
      toast('Paid out queued', 'ok', 1800);
      if (onDone) await onDone();
    } catch (_) {
      confirm.disabled = false;
      toast('Failed — try again', 'warn', 2400);
    }
  });
  return modalEl;
}
