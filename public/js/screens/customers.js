'use strict';

import { $t, $tn, dateLocale } from '../lang.js';

/* Customers: the store's ledger book, admin/manager only. Lists every
   customer with a non-zero balance, totals the outstanding receivables, and
   opens a per-customer ledger (transactions + credit/account/balance) on tap. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { screenHead } from '../components.js';
import { fmt, esc, openModal, closeModal, toast, beep, csvRows, downloadCsv, currencySymbol } from '../ui.js';
import { createCollection, kindInfo } from '../money.js';

export const screen = {
  id: 'customers',
  tab: 'customers',
  title: $t('Customers'),

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const { state } = ctx;
    const user = state.user || (await idb.get('meta', 'config'))?.user || {};
    const role = user.role || 'cashier';
    if (role !== 'admin' && role !== 'manager') {
      root.innerHTML = `<div class="empty"><p>${$t('Managers and admins only.')}</p></div>`;
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
        ${screenHead({
          title: $t('Customers'),
          subHtml: `${esc($tn('{n} with activity', '{n} with activity', list.length))} · ${$t('total outstanding')} <strong class="gp">${fmt(totalOut)}</strong>`,
          actions: `<button class="icon-btn" id="custRefresh" aria-label="${$t('Refresh')}">⟳</button>`,
        })}
        <div class="cust-toolbar">
          <input id="custQ" class="field" placeholder="${$t('Search name, phone, email…')}" autocomplete="off">
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
                <span class="hx-count">${esc(c.account > 0 ? $t('{amount} on account', { amount: fmt(c.account) }) : $t('{amount} credit', { amount: fmt(c.credit) }))}</span>
                ${agingChips(c.aging)}
              </div>
            </button>`).join('')
            : `<div class="empty"><p>${loaded ? $t('No balances yet — charge a sale to a customer to build the book.') : $t('Offline — pull failed.')}</p></div>`}
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
        toast($t('Failed to load ledger'), 'warn');
        return;
      }
      const l = res;
      const modalEl = openModal(`
        <div class="tx-detail cust-ledger">
          <button class="icon-btn abs-close" data-x>✕</button>
          <h3>${esc(l.customer.name)}</h3>
          ${l.customer.phone ? `<p class="muted">${esc(l.customer.phone)}</p>` : ''}
          <div class="ledger-bal">
            <div><span>${$t('Owes on account')}</span><b>${fmt(l.account)}</b></div>
            <div><span>${$t('Holds credit')}</span><b class="gp">${fmt(l.credit)}</b></div>
            <div class="lg-total"><span>${$t('Balance')}</span><strong class="${l.balance > 0 ? 'neg' : 'gp'}">${l.balance > 0 ? '' : '+ '}${fmt(l.balance)}</strong></div>
            <div class="lg-aging">${agingChips(l.aging)}</div>
          </div>
          <div class="ledger-actions">
            ${l.balance > 0 ? `<button class="btn btn-sm" id="collectBtn" style="--bg:#2e7d32">${$t('Collect payment')}</button>` : ''}
            <button class="btn btn-sm btn-ghost" id="stmtBtn">${$t('Statement')}</button>
          </div>
          <div class="lg-txs">
            ${(l.transactions || []).length ? l.transactions.map((t) => `
              <div class="lg-tx">
                <div>
                  <span class="k-chip ${t.kind === 'refund' ? 'k-refund' : t.kind === 'payment' ? 'k-payout' : 'k-sale'}">${esc($t(kindInfo(t.kind).label))}</span>
                  <span class="muted">${esc(shortDate(t.createdAt))}</span>
                  <span class="muted"># ${esc(t.clientTxId || t.id)}</span>
                </div>
                <b>${t.kind === 'refund' ? '−' : ''}${fmt(t.grandTotal)}</b>
              </div>`).join('')
              : `<p class="empty">${$t('No transactions yet.')}</p>`}
          </div>
        </div>`);
      modalEl.querySelector('[data-x]').addEventListener('click', closeModal);

      const collectBtn = modalEl.querySelector('#collectBtn');
      if (collectBtn) collectBtn.addEventListener('click', () => openCollectModal(l));
      modalEl.querySelector('#stmtBtn').addEventListener('click', () => openStatement(l));
    }

    async function openStatement(l) {
      let s;
      try {
        s = await api.get('/api/customers/statement?customerId=' + encodeURIComponent(l.customer.id));
      } catch (_) {
        toast($t('Failed to load statement'), 'warn');
        return;
      }
      const modalEl = openModal(`
        <div class="tx-detail cust-ledger">
          <button class="icon-btn abs-close" data-x>✕</button>
          <div class="stmt-head">
            <div>
              <h3>${$t('Statement of account')}</h3>
              <p class="muted">${esc(s.customer.name)}${s.customer.phone ? ' · ' + esc(s.customer.phone) : ''}</p>
            </div>
            <div class="stmt-bal">
              <span>${$t('Balance')}</span>
              <strong class="${s.closing > 0 ? 'neg' : 'gp'}">${s.closing > 0 ? '' : '+ '}${fmt(s.closing)}</strong>
            </div>
          </div>
          <div class="stmt-actions">
            <button class="btn btn-sm" id="stmtPrint" style="--bg:#1c5d99">${$t('Print')}</button>
            <button class="btn btn-sm btn-ghost" id="stmtCsv">${$t('CSV')}</button>
          </div>
          <div class="stmt-table">
            <div class="stmt-row stmt-th">
              <span>${$t('Date')}</span><span>${$t('Details')}</span><span class="r">${$t('Debit')}</span><span class="r">${$t('Credit')}</span><span class="r">${$t('Balance')}</span>
            </div>
            ${s.items.length ? s.items.map((it) => `
              <div class="stmt-row">
                <span>${esc(shortDate(it.date))}</span>
                <span class="stmt-desc">${esc(statementText(it))}<i># ${esc(it.reference)}</i></span>
                <span class="r">${it.debit ? fmt(it.debit) : '—'}</span>
                <span class="r">${it.credit ? fmt(it.credit) : '—'}</span>
                <span class="r b">${fmt(it.balance)}</span>
              </div>`).join('')
              : `<p class="empty">${$t('No activity.')}</p>`}
          </div>
        </div>`);
      modalEl.querySelector('[data-x]').addEventListener('click', closeModal);

      modalEl.querySelector('#stmtPrint').addEventListener('click', () => printStatement(s));
      modalEl.querySelector('#stmtCsv').addEventListener('click', () => statementCsv(s));
    }

    function printStatement(s) {
      const oldNode = document.querySelector('.print-root');
      if (oldNode) oldNode.remove();
      const pr = document.createElement('div');
      pr.className = 'print-root stmt';
      pr.innerHTML = `
        <div class="receipt">
          <h1>${$t('Statement of account')}</h1>
          <p>${esc(s.customer.name)}</p>
          ${s.customer.phone ? `<p>${esc(s.customer.phone)}</p>` : ''}
          <p class="muted">${esc($t('as of {date}', { date: shortDate(s.asOf) }))}</p>
          ${s.items.map((it) => `
            <div class="stmt-line">
              <span>${esc(shortDate(it.date))} · ${esc(statementText(it))}</span>
              <span>${esc(it.debit ? $t('DR {amount}', { amount: fmt(it.debit) }) : it.credit ? $t('CR {amount}', { amount: fmt(it.credit) }) : '')}</span>
              <span>${esc($t('bal {amount}', { amount: fmt(it.balance) }))}</span>
            </div>`).join('')}
          <p class="receipt-total">${esc($t('Balance {amount}', { amount: fmt(s.closing) }))}</p>
        </div>`;
      document.body.appendChild(pr);
      document.body.classList.add('printing');
      requestAnimationFrame(() => {
        window.print();
        setTimeout(() => { document.body.classList.remove('printing'); pr.remove(); }, 600);
      });
    }

    function statementCsv(s) {
      const rows = [['date', 'reference', 'description', 'debit', 'credit', 'balance', 'cashier', 'note']];
      for (const it of s.items) {
        rows.push([it.date, it.reference, it.description, it.debit || '', it.credit || '', it.balance, it.cashier, it.note]);
      }
      downloadCsv(`orison-statement-${s.customer.id}.csv`, csvRows(rows));
      toast($t('Statement CSV downloaded'), 'ok');
    }

    function openCollectModal(l) {
      let method = 'cash';
      const modalEl = openModal(`
        <div class="tx-detail">
          <button class="icon-btn abs-close" data-x>✕</button>
          <h3>${$t('Collect payment')}</h3>
          <p class="muted">${esc(l.customer.name)} · ${esc($t('{amount} on balance', { amount: fmt(l.balance) }))}</p>
          <label class="field-label">${esc($t('Amount ({symbol})', { symbol: currencySymbol() }))}
            <input class="field" id="col-amt" type="number" min="0.01" step="0.01" placeholder="0.00">
          </label>
          <div class="seg">
            <button class="seg-btn on" data-m="cash">${$t('Cash')}</button>
            <button class="seg-btn" data-m="transfer">${$t('Transfer')}</button>
          </div>
          <label class="field-label">${$t('Note (optional)')}
            <input class="field" id="col-note" placeholder="${$t('e.g. paid via transfer')}">
          </label>
          <button class="btn btn-block" id="col-confirm" style="--bg:#2e7d32">${$t('Record payment')}</button>
        </div>`);
      modalEl.querySelector('[data-x]').addEventListener('click', closeModal);
      modalEl.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
        method = b.dataset.m;
        modalEl.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('on', x === b));
      }));
      const confirm = modalEl.querySelector('#col-confirm');
      confirm.addEventListener('click', async () => {
        const amount = Number(modalEl.querySelector('#col-amt').value);
        if (!(amount > 0)) { toast($t('Enter an amount'), 'warn'); return; }
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
          toast($t('Payment queued'), 'ok', 1800);
          beep('ok');
          await loadReceivables();
          openLedger(l.customer.id);
        } catch (_) {
          confirm.disabled = false;
          toast($t('Failed — try again'), 'warn', 2400);
        }
      });
    }

    /* The server writes "Sale — Cable, Case"; the kind is translated here and
       the item names are left as they were typed. */
    function statementText(it) {
      const cut = String(it.description || '').indexOf(' — ');
      const detail = cut >= 0 ? String(it.description).slice(cut + 3) : '';
      const label = $t(kindInfo(it.kind).label);
      return detail ? `${label} — ${detail}` : label;
    }

    function shortDate(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d)) return iso;
      return d.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' });
    }

    function agingChips(a) {
      if (!a) return '';
      const parts = [];
      if (a.d90 > 0) parts.push(`<span class="age age90">${esc($t('{amount} ≥90d', { amount: fmt(a.d90) }))}</span>`);
      if (a.d60 > 0) parts.push(`<span class="age age60">${esc($t('{amount} 60d+', { amount: fmt(a.d60) }))}</span>`);
      if (a.d30 > 0) parts.push(`<span class="age age30">${esc($t('{amount} 30d+', { amount: fmt(a.d30) }))}</span>`);
      if (a.current > 0) parts.push(`<span class="age age0">${esc($t('{amount} current', { amount: fmt(a.current) }))}</span>`);
      return parts.join('');
    }

    await loadReceivables();
  },
};