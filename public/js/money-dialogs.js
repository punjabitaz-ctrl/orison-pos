'use strict';

/* Money-out dialogs, lifted out of the dashboard so the launcher can open them
   directly. A tile labelled "Paid Out" has to open Paid Out - dropping someone
   on a screen and expecting them to find a button is the failure this redesign
   exists to remove.

   The three reasons share one dialog because they share one shape: an amount,
   who or what it went to, and a note. Only the wording changes, and the reason
   is carried as the transaction kind so reports can split it later. */

import { esc, toast, openModal, closeModal, currencySymbol } from './ui.js';
import { createCashOut } from './money.js';

const CASH_OUT = {
  payout: {
    title: 'Record paid out',
    blurb: 'Cash leaving the business for a supplier or a bill.',
    party: 'Paid to',
    partyHint: 'e.g. Vendor name',
    noteHint: 'e.g. restock — keyboards',
    confirm: 'Confirm paid out',
    done: 'Paid out queued',
  },
  pickup: {
    title: 'Record cash pick-up',
    blurb: 'Cash taken out of the drawer — to the bank, the safe, or the owner.',
    party: 'Picked up by',
    partyHint: 'e.g. Owner, bank run',
    noteHint: 'e.g. afternoon banking',
    confirm: 'Confirm pick-up',
    done: 'Cash pick-up queued',
  },
  expense: {
    title: 'Record staff expense',
    blurb: 'Cash reimbursed to a member of staff.',
    party: 'Reimbursed to',
    partyHint: 'e.g. staff name',
    noteHint: 'e.g. delivery fare',
    confirm: 'Confirm expense',
    done: 'Staff expense queued',
  },
};

export function openCashOutDialog(ctx, kind, onDone) {
  const copy = CASH_OUT[kind] || CASH_OUT.payout;
  const k = CASH_OUT[kind] ? kind : 'payout';
  const user = (ctx && ctx.state && ctx.state.user) || {};
  const modalEl = openModal(`
    <div class="tx-detail payout-modal">
      <button class="icon-btn abs-close" data-x>✕</button>
      <h3>${esc(copy.title)}</h3>
      <p class="muted">${esc(copy.blurb)} Managers and admins only.</p>
      <label class="field-label">${esc(copy.party)}
        <input class="field" id="po-to" placeholder="${esc(copy.partyHint)}">
      </label>
      <label class="field-label">Amount (${esc(currencySymbol())})
        <input class="field" id="po-amt" type="number" min="0" step="0.01" placeholder="0.00" inputmode="decimal">
      </label>
      <label class="field-label">Note (optional)
        <input class="field" id="po-note" placeholder="${esc(copy.noteHint)}">
      </label>
      <button class="btn" id="po-confirm" style="--bg:#c62828">${esc(copy.confirm)}</button>
    </div>`);
  modalEl.querySelector('[data-x]').addEventListener('click', closeModal);
  const confirm = modalEl.querySelector('#po-confirm');
  confirm.addEventListener('click', async () => {
    const amount = Number(modalEl.querySelector('#po-amt').value);
    if (!(amount > 0)) { toast('Enter an amount', 'warn'); return; }
    confirm.disabled = true;
    try {
      await createCashOut({
        kind: k,
        counterparty: modalEl.querySelector('#po-to').value.trim(),
        grandTotal: amount,
        note: modalEl.querySelector('#po-note').value.trim(),
        user,
      });
      closeModal();
      toast(copy.done, 'ok', 1800);
      if (onDone) await onDone();
    } catch (_) {
      confirm.disabled = false;
      toast('Failed — try again', 'warn', 2400);
    }
  });
  return modalEl;
}

export function openPayoutDialog(ctx, onDone) {
  return openCashOutDialog(ctx, 'payout', onDone);
}
