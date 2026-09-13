'use strict';

/* Manager approval, asked for on the cashier's own screen.

   A manager or admin types their own email and PIN; the server checks them and
   hands back an approval for exactly one thing - this refund, this discount,
   this drawer open. The cashier stays signed in the whole time. It sits above
   any open dialog (a refund is asked for from inside the refund dialog), so it
   has its own layer rather than replacing the modal underneath. */

import { api } from './api.js';
import { esc, beep } from './ui.js';
import { getDeviceId } from './sync.js';
import { $t, N_ } from './lang.js';

const TITLES = {
  refund: N_('A manager needs to approve this refund'),
  discount: N_('A manager needs to approve this discount'),
  drawer: N_('A manager needs to approve opening the drawer'),
  deposit_refund: N_('A manager needs to approve giving the deposit back'),
  credit: N_('A manager needs to approve going over the credit limit'),
  tradein: N_('A manager needs to approve buying this device'),
};

function layer() {
  let el = document.getElementById('approval');
  if (!el) {
    el = document.createElement('div');
    el.id = 'approval';
    document.body.appendChild(el);
  }
  return el;
}

/* Resolves { approval, approver } or null if the cashier gave up. */
export function requestApproval({ action, ref, pct, amount, detail, note }) {
  return new Promise((resolve) => {
    if (!navigator.onLine) {
      showOffline(resolve);
      return;
    }
    const root = layer();
    root.innerHTML = `
      <div class="modal-backdrop approval-backdrop" data-close>
        <div class="modal approval" role="dialog" aria-modal="true" aria-labelledby="apvTitle">
          <h3 id="apvTitle">🔑 ${esc($t(TITLES[action] || TITLES.refund))}</h3>
          ${detail ? `<p class="apv-detail">${esc(detail)}</p>` : ''}
          <p class="muted">${esc($t('Hand the terminal to a manager. They enter their own email and PIN - you stay signed in.'))}</p>
          <label class="field-label">${esc($t('Manager email'))}
            <input class="field" id="apvEmail" type="email" autocapitalize="none" autocomplete="off" spellcheck="false">
          </label>
          <label class="field-label">${esc($t('Manager PIN'))}
            <input class="field" id="apvPin" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
          </label>
          <p id="apvErr" class="login-err" role="alert"></p>
          <div class="row">
            <button class="btn btn-ghost" id="apvCancel" type="button">${esc($t('Cancel'))}</button>
            <button class="btn" id="apvGo" type="button">${esc($t('Approve'))}</button>
          </div>
        </div>
      </div>`;

    const email = root.querySelector('#apvEmail');
    const pin = root.querySelector('#apvPin');
    const err = root.querySelector('#apvErr');
    const go = root.querySelector('#apvGo');
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      root.innerHTML = '';
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
      else if (e.key === 'Enter' && document.activeElement === pin) { e.preventDefault(); go.click(); }
    };
    document.addEventListener('keydown', onKey, true);
    root.querySelector('[data-close]').addEventListener('click', (e) => { if (e.target === e.currentTarget) finish(null); });
    root.querySelector('#apvCancel').addEventListener('click', () => finish(null));

    go.addEventListener('click', async () => {
      const e = email.value.trim().toLowerCase();
      const p = pin.value.trim();
      if (!e.includes('@') || !/^\d{4,8}$/.test(p)) { err.textContent = $t('Enter the manager\'s email and PIN.'); beep('err'); return; }
      go.disabled = true;
      err.textContent = '';
      try {
        const res = await api.post('/api/approve', {
          email: e, pin: p, action, ref, pct, amount, note, deviceId: await getDeviceId(),
        });
        pin.value = '';
        beep('ok');
        finish({ approval: res.approval, approver: res.approver });
      } catch (x) {
        pin.value = '';
        go.disabled = false;
        err.textContent = (x && x.message) || $t('Could not approve');
        beep('err');
        pin.focus();
      }
    });
    email.focus();
  });
}

function showOffline(resolve) {
  const root = layer();
  root.innerHTML = `
    <div class="modal-backdrop approval-backdrop" data-close>
      <div class="modal approval" role="dialog" aria-modal="true">
        <h3>🔑 ${esc($t('Approval needs a connection'))}</h3>
        <p class="muted">${esc($t('A manager\'s PIN can only be checked online. Reconnect, or have a manager sign in on this terminal.'))}</p>
        <div class="row"><button class="btn" id="apvOk" type="button">${esc($t('OK'))}</button></div>
      </div>
    </div>`;
  root.querySelector('#apvOk').addEventListener('click', () => { root.innerHTML = ''; resolve(null); });
}
