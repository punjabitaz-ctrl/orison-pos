'use strict';

/* Customers: the store's ledger book, admin/manager only. Lists every
   customer with a non-zero balance, totals the outstanding receivables, and
   opens a per-customer ledger (transactions + credit/account/balance) on tap. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { fmt, esc, openModal, closeModal, toast, beep } from '../ui.js';
import { createCollection } from '../money.js';

export const screen = {
  id: 'customers',
  tab: 'customers',
  title: 'Customers',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const { state } = ctx;
    const user = state.user || (await idb.get('meta', 'config'))?.user || {};
    const role = user.role || 'cashier';
    if (role !== 'admin' && role !== 'manager') {
      root.innerHTML = `<div class="empty"><p>Managers and admins only.</p></div>`;
      return;
    }

    let list = [];
    let totalOut = 0;
    let loaded = false;

    async function loadReceivables() {
      try {
        const res = await api.get('/api/customers/receivables');
        list = res.customers || [];
        totalOut = res.totalOutstanding || 0;
        loaded = true;
      } catch (_) {
        loaded = false;
      }
      draw();
    }

    function draw() {
      root.innerHTML = `
        <header class="scr-head">
          <div class="scr-title">
            <h2>Customers</h2>
            <p>${list.length} with activity · total outstanding <strong class="gp">${fmt(totalOut)}</strong></p>
          </div>
          <button class="icon-btn" id="custRefresh" aria-label="Refresh">⟳</button>
        </header>
        <div class="cust-toolbar">
          <input id="custQ" class="field" placeholder="Search name, phone, email…" autocomplete="off">
        </div>
        <div class="hx-list">
          ${list.length ? list.map((c) => `
            <button class="hx-card cust-card" data-cid="${esc(c.id)}">
              <div class="hx-left">
                <span class="hx-date">${esc(c.name)}</span>
                <span class="hx-cashier">${esc(c.phone || '—')}</span>
              </div>
              <div class="hx-right">
                <strong class="${c.balance > 0 ? 'neg' : 'gp'}">${c.balance > 0 ? '' : '+ '}${fmt(c.balance)}</strong>
                <span class="hx-count">${c.account > 0 ? `${fmt(c.account)} on account` : `${fmt(c.credit)} credit`}</span>
                ${agingChips(c.aging)}
              </div>
            </button>`).join('')
            : `<div class="empty"><p>${loaded ? 'No balances yet — charge a sale to a customer to build the book.' : 'Offline — pull failed.'}</p></div>`}
        </div>`;

      root.querySelector('#custRefresh').addEventListener('click', loadReceivables);

      const q = root.querySelector('#custQ');
      let t = null;
      q.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => search(q.value.trim()), 350);
      });

      root.querySelectorAll('[data-cid]').forEach((b) => b.addEventListener('click', () => openLedger(b.dataset.cid)));
    }

    async function search(q) {
      if (!q) { await loadReceivables(); return; }
      try {
        const [res, rec] = await Promise.all([
          api.get('/api/customers?q=' + encodeURIComponent(q)),
          api.get('/api/customers/receivables'),
        ]);
        const balMap = new Map((rec.customers || []).map((c) => [c.id, c]));
        const merged = (res.customers || []).map((c) => ({ ...c, ...(balMap.get(c.id) || { balance: 0, account: 0, credit: 0 }) }));
        list = merged;
        draw();
      } catch (_) { /* keep stale view */ }
    }

    async function openLedger(cid) {
      let res;
      try {
        res = await api.get('/api/customers/ledger?customerId=' + encodeURIComponent(cid));
      } catch (_) {
        toast('Failed to load ledger', 'warn');
        return;
      }
      const l = res;
      const modalEl = openModal(`
        <div class="tx-detail cust-ledger">
          <button class="icon-btn abs-close" data-x>✕</button>
          <h3>${esc(l.customer.name)}</h3>
          ${l.customer.phone ? `<p class="muted">${esc(l.customer.phone)}</p>` : ''}
          <div class="ledger-bal">
            <div><span>Owes on account</span><b>${fmt(l.account)}</b></div>
            <div><span>Holds credit</span><b class="gp">${fmt(l.credit)}</b></div>
            <div class="lg-total"><span>Balance</span><strong class="${l.balance > 0 ? 'neg' : 'gp'}">${l.balance > 0 ? '' : '+ '}${fmt(l.balance)}</strong></div>
            <div class="lg-aging">${agingChips(l.aging)}</div>
          </div>
          ${l.balance > 0 ? `<button class="btn btn-block" id="collectBtn" style="--bg:#2e7d32">Collect payment</button>` : ''}
          <div class="lg-txs">
            ${(l.transactions || []).length ? l.transactions.map((t) => `
              <div class="lg-tx">
                <div>
                  <span class="k-chip ${t.kind === 'refund' ? 'k-refund' : t.kind === 'payment' ? 'k-payout' : 'k-sale'}">${esc(t.kind)}</span>
                  <span class="muted">${esc(shortDate(t.createdAt))}</span>
                  <span class="muted"># ${esc(t.clientTxId || t.id)}</span>
                </div>
                <b>${t.kind === 'refund' ? '−' : ''}${fmt(t.grandTotal)}</b>
              </div>`).join('')
              : `<p class="empty">No transactions yet.</p>`}
          </div>
        </div>`);
      modalEl.querySelector('[data-x]').addEventListener('click', closeModal);
      modalEl.addEventListener('click', (e) => { if (e.target.classList.contains('modal-backdrop') || e.target.closest('[data-close]')) closeModal(); });
      modalEl.parentElement.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

      const collectBtn = modalEl.querySelector('#collectBtn');
      if (collectBtn) collectBtn.addEventListener('click', () => openCollectModal(l));
    }

    function openCollectModal(l) {
      let method = 'cash';
      const modalEl = openModal(`
        <div class="tx-detail">
          <button class="icon-btn abs-close" data-x>✕</button>
          <h3>Collect payment</h3>
          <p class="muted">${esc(l.customer.name)} · ${fmt(l.balance)} on balance</p>
          <label class="field-label">Amount (₦)
            <input class="field" id="col-amt" type="number" min="0.01" step="0.01" placeholder="0.00">
          </label>
          <div class="seg">
            <button class="seg-btn on" data-m="cash">Cash</button>
            <button class="seg-btn" data-m="transfer">Transfer</button>
          </div>
          <label class="field-label">Note (optional)
            <input class="field" id="col-note" placeholder="e.g. paid via transfer">
          </label>
          <button class="btn btn-block" id="col-confirm" style="--bg:#2e7d32">Record payment</button>
        </div>`);
      modalEl.querySelector('[data-x]').addEventListener('click', closeModal);
      modalEl.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
        method = b.dataset.m;
        modalEl.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('on', x === b));
      }));
      const confirm = modalEl.querySelector('#col-confirm');
      confirm.addEventListener('click', async () => {
        const amount = Number(modalEl.querySelector('#col-amt').value);
        if (!(amount > 0)) { toast('Enter an amount', 'warn'); return; }
        confirm.disabled = true;
        try {
          await createCollection({
            customerId: l.customer.id,
            grandTotal: amount,
            method,
            note: modalEl.querySelector('#col-note').value.trim(),
            user,
          });
          closeModal();
          toast('Payment queued', 'ok', 1800);
          beep('ok');
          await loadReceivables();
          openLedger(l.customer.id);
        } catch (_) {
          confirm.disabled = false;
          toast('Failed — try again', 'warn', 2400);
        }
      });
    }

    function shortDate(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d)) return iso;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function agingChips(a) {
      if (!a) return '';
      const parts = [];
      if (a.d90 > 0) parts.push(`<span class="age age90">${fmt(a.d90)} ≥90d</span>`);
      if (a.d60 > 0) parts.push(`<span class="age age60">${fmt(a.d60)} 60d+</span>`);
      if (a.d30 > 0) parts.push(`<span class="age age30">${fmt(a.d30)} 30d+</span>`);
      if (a.current > 0) parts.push(`<span class="age age0">${fmt(a.current)} curr</span>`);
      return parts.join('');
    }

    await loadReceivables();
  },
};