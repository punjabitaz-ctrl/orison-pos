'use strict';

import { $t, N_ } from './lang.js';

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
    title: N_('Record paid out'),
    blurb: N_('Cash leaving the business for a supplier or a bill.'),
    party: N_('Paid to'),
    partyHint: N_('e.g. Vendor name'),
    noteHint: N_('e.g. restock — keyboards'),
    confirm: N_('Confirm paid out'),
    done: N_('Paid out queued'),
  },
  pickup: {
    title: N_('Record cash pick-up'),
    blurb: N_('Cash taken out of the drawer — to the bank, the safe, or the owner.'),
    party: N_('Picked up by'),
    partyHint: N_('e.g. Owner, bank run'),
    noteHint: N_('e.g. afternoon banking'),
    confirm: N_('Confirm pick-up'),
    done: N_('Cash pick-up queued'),
  },
  expense: {
    title: N_('Record staff expense'),
    blurb: N_('Cash reimbursed to a member of staff.'),
    party: N_('Reimbursed to'),
    partyHint: N_('e.g. staff name'),
    noteHint: N_('e.g. delivery fare'),
    confirm: N_('Confirm expense'),
    done: N_('Staff expense queued'),
  },
};

export function openCashOutDialog(ctx, kind, onDone) {
  const copy = CASH_OUT[kind] || CASH_OUT.payout;
  const k = CASH_OUT[kind] ? kind : 'payout';
  const user = (ctx && ctx.state && ctx.state.user) || {};
  const modalEl = openModal(`
    <div class="tx-detail payout-modal">
      <button class="icon-btn abs-close" data-x>✕</button>
      <h3>${esc($t(copy.title))}</h3>
      <p class="muted">${esc($t(copy.blurb))} ${$t('Managers and admins only.')}</p>
      <label class="field-label">${esc($t(copy.party))}
        <input class="field" id="po-to" placeholder="${esc($t(copy.partyHint))}">
      </label>
      <label class="field-label">${esc($t('Amount ({symbol})', { symbol: currencySymbol() }))}
        <input class="field" id="po-amt" type="number" min="0" step="0.01" placeholder="0.00" inputmode="decimal">
      </label>
      <label class="field-label">${$t('Note (optional)')}
        <input class="field" id="po-note" placeholder="${esc($t(copy.noteHint))}">
      </label>
      <button class="btn" id="po-confirm" style="--bg:#c62828">${esc($t(copy.confirm))}</button>
    </div>`);
  modalEl.querySelector('[data-x]').addEventListener('click', closeModal);
  const confirm = modalEl.querySelector('#po-confirm');
  confirm.addEventListener('click', async () => {
    const amount = Number(modalEl.querySelector('#po-amt').value);
    if (!(amount > 0)) { toast($t('Enter an amount'), 'warn'); return; }
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
      toast($t(copy.done), 'ok', 1800);
      if (onDone) await onDone();
    } catch (_) {
      confirm.disabled = false;
      toast($t('Failed — try again'), 'warn', 2400);
    }
  });
  return modalEl;
}

export function openPayoutDialog(ctx, onDone) {
  return openCashOutDialog(ctx, 'payout', onDone);
}
