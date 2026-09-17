'use strict';

import { $t, $tn, N_, dateLocale } from '../lang.js';

/* Purchases: suppliers, purchase orders and paying suppliers, manager/admin only.
   Create an order against a supplier, then receive stock against it — the
   receipt posts inventory in (weighted-average cost, serials registered) and
   leaves a purchase trail in the ledger. Everything here talks to the server:
   purchases are an office function, not an offline terminal flow. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { screenHead } from '../components.js';
import { fmt, esc, toast, beep, openModal, closeModal } from '../ui.js';

const STATUS_META = {
  DRAFT: { label: N_('Draft'), cls: 'draft' },
  ORDERED: { label: N_('Ordered'), cls: 'ordered' },
  PARTIAL: { label: N_('Partial'), cls: 'partial' },
  RECEIVED: { label: N_('Received'), cls: 'received' },
  CANCELLED: { label: N_('Cancelled'), cls: 'cancelled' },
};

export const PAY_METHODS = [
  { id: 'bank', label: N_('Bank transfer') },
  { id: 'cheque', label: N_('Cheque') },
  { id: 'cash', label: N_('Cash from the till') },
];

const PAYMENT_META = {
  paid: { label: N_('Paid'), cls: 'received' },
  part_paid: { label: N_('Part paid'), cls: 'partial' },
  unpaid: { label: N_('Unpaid'), cls: 'ordered' },
  prepaid: { label: N_('Paid ahead'), cls: 'received' },
  nothing_received: { label: N_('Nothing received'), cls: 'draft' },
};

export function paymentLabel(state) {
  const m = PAYMENT_META[state] || PAYMENT_META.unpaid;
  return { label: $t(m.label), cls: m.cls };
}

/* What a supplier payment needs before it goes to the server. Pure, so tested. */
export function paymentProblem({ amount, method, reference, owed } = {}) {
  const a = Math.round((Number(amount) || 0) * 100);
  if (!(a > 0)) return N_('Enter the amount paid');
  if (!PAY_METHODS.some((m) => m.id === method)) return N_('Pay by cash, bank transfer or cheque');
  if (method !== 'cash' && !String(reference || '').trim()) return N_('A bank transfer or cheque needs its reference');
  if (owed != null && a > Math.round(Number(owed) * 100)) return N_('That is more than is owed');
  return '';
}

function statusLabel(s) {
  const m = STATUS_META[s] || {};
  return { label: m.label ? $t(m.label) : s, cls: m.cls || 'draft' };
}

function splitSerials(text) {
  return String(text || '')
    .split(/[\n\r,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const screen = {
  id: 'purchases',
  tab: 'purchases',
  title: 'Purchases',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const user = ctx.state.user || (await idb.get('meta', 'config'))?.user || {};
    if ((user.role || 'cashier') !== 'admin' && (user.role || 'cashier') !== 'manager') {
      root.innerHTML = `<div class="empty"><p>${$t('Managers and admins only.')}</p></div>`;
      return;
    }

    let suppliers = [];
    let orders = [];
    let products = [];
    let payables = { suppliers: [], totalOwed: 0, totalOverdue: 0 };
    let loadErr = '';
    const isAdmin = user.role === 'admin';
    const accountOf = (id) => payables.suppliers.find((s) => s.id === id) || null;
    const orderPay = (poId) => {
      for (const s of payables.suppliers) {
        const o = (s.orders || []).find((x) => x.poId === poId);
        if (o) return { ...o, supplierId: s.id, supplierName: s.name };
      }
      return null;
    };

    async function load() {
      loadErr = '';
      root.innerHTML = `<div class="empty"><p>${$t('Loading…')}</p></div>`;
      try {
        const [sup, ord, prods, pay] = await Promise.all([
          api.get('/api/suppliers'),
          api.get('/api/purchase-orders'),
          api.get('/api/products'),
          api.get('/api/suppliers/payables'),
        ]);
        suppliers = sup.suppliers || [];
        orders = ord.orders || [];
        payables = pay || payables;
        products = (prods || []).filter((p) => p.itemType === 'product');
      } catch (err) {
        loadErr = (err && err.offline) ? $t('Offline — purchases need the server') : $t('Failed to load purchases');
      }
      draw();
    }

    function draw() {
      root.innerHTML = `
        ${screenHead({
          title: $t('Purchases'),
          sub: $t('Suppliers and stock-in orders'),
          actions: `<div class="scr-actions">
            ${isAdmin ? `<button class="btn btn-sm" id="poAddSupplier">${$t('+ Supplier')}</button>` : ''}
            <button class="btn btn-sm btn-primary" id="poNew">${$t('New PO')}</button>
          </div>`,
        })}

        ${loadErr ? `<div class="empty"><p>${esc(loadErr)}</p></div>` : `
        <div class="dash-kpis po-owed">
          <div class="dash-kpi"><span>${$t('Owed to suppliers')}</span><strong>${fmt(payables.totalOwed)}</strong></div>
          <div class="dash-kpi${payables.totalOverdue > 0 ? ' po-overdue-kpi' : ''}"><span>${$t('Overdue')}</span><strong>${fmt(payables.totalOverdue)}</strong></div>
        </div>
        <section class="po-block">
          <h3>${$t('Suppliers')}</h3>
          ${suppliers.length ? `
          <div class="po-plain po-suppliers">
            ${suppliers.map((s) => {
              const acc = accountOf(s.id);
              return `
              <button class="po-supplier" type="button" data-sup="${esc(s.id)}">
                <span class="po-sup-top"><strong>${esc(s.name)}</strong>
                  ${acc && acc.balance > 0 ? `<strong class="po-sup-owed">${esc($t('Owed {amount}', { amount: fmt(acc.balance) }))}</strong>` : `<span class="muted">${esc($t('Nothing owed'))}</span>`}</span>
                <span class="muted">${esc(s.phone || '')}${s.email ? ` · ${esc(s.email)}` : ''}</span>
                <span class="muted">${s.paymentTerms ? esc(s.paymentTerms) : $t('Open terms')}${acc && acc.overdue > 0 ? ` · <span class="po-chip overdue">${esc($t('{amount} overdue', { amount: fmt(acc.overdue) }))}</span>` : ''}</span>
              </button>`;
            }).join('')}
          </div>` : `<p class="muted">${$t('No suppliers yet — add one to place a purchase order.')}</p>`}
        </section>

        <section class="po-block">
          <h3>${$t('Purchase orders')}</h3>
          ${orders.length ? `
          <div class="po-plain">
            ${orders.map((o) => {
              const st = statusLabel(o.status);
              const op = orderPay(o.id);
              return `
              <div class="po-row" data-po="${esc(o.id)}">
                <div class="po-row-main">
                  <strong>${esc(o.poNumber)}</strong>
                  <span class="muted">${esc(o.supplierName || '—')} · ${esc($tn('{n} line', '{n} lines', o.itemCount))} · ${esc($t('{got}/{ordered} received', { got: o.receivedQty, ordered: o.orderedQty }))}</span>
                  <span class="muted">${o.expectedDate ? esc($t('Expected {date}', { date: o.expectedDate })) : $t('No due date')}</span>
                </div>
                <div class="po-row-side">
                  <span class="po-chip ${st.cls}">${esc(st.label)}</span>
                  ${op && op.received > 0 ? `<span class="po-chip ${paymentLabel(op.payment).cls}">${esc(paymentLabel(op.payment).label)}</span>` : ''}
                  <strong>${fmt(o.total)}</strong>
                </div>
              </div>`;
            }).join('')}
          </div>` : `<p class="muted">${$t('No orders yet.')}</p>`}
        </section>`}
      `;

      const newBtn = root.querySelector('#poNew');
      if (newBtn) newBtn.addEventListener('click', () => newPoModal(false));
      const addBtn = root.querySelector('#poAddSupplier');
      if (addBtn) addBtn.addEventListener('click', addSupplierModal);
      root.querySelectorAll('[data-po]').forEach((el) => {
        el.addEventListener('click', () => viewPoModal(el.dataset.po));
      });
      root.querySelectorAll('[data-sup]').forEach((el) => {
        el.addEventListener('click', () => supplierModal(el.dataset.sup));
      });
    }

    /* A supplier's account: what arrived, what was paid, what is owed and overdue. */
    async function supplierModal(id) {
      let st = null;
      try { st = await api.get(`/api/suppliers/statement?supplierId=${encodeURIComponent(id)}`); } catch (err) {
        toast((err && err.message) || $t('Could not load the supplier'), 'err');
        return;
      }
      const loc = dateLocale();
      const m = openModal(`
        <div class="po-account">
          <h3>${esc(st.name)}</h3>
          <p class="muted">${st.paymentTerms ? esc($t('Terms: {terms}', { terms: st.paymentTerms })) : esc($t('Due on delivery'))}</p>
          <div class="dash-kpis po-account-kpis">
            <div class="dash-kpi"><span>${$t('Received')}</span><strong>${fmt(st.received)}</strong></div>
            <div class="dash-kpi"><span>${$t('Paid')}</span><strong>${fmt(st.paid)}</strong></div>
            <div class="dash-kpi"><span>${$t('Owed')}</span><strong>${fmt(st.balance)}</strong></div>
            <div class="dash-kpi${st.overdue > 0 ? ' po-overdue-kpi' : ''}"><span>${$t('Overdue')}</span><strong>${fmt(st.overdue)}</strong></div>
          </div>
          ${st.orders.length ? `
          <h4>${$t('Orders')}</h4>
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th>${$t('Order')}</th><th class="num">${$t('Received')}</th><th class="num">${$t('Paid')}</th><th class="num">${$t('Owed')}</th><th></th></tr></thead>
            <tbody>${st.orders.map((o) => `<tr><td>${esc(o.poNumber)}</td><td class="num">${fmt(o.received)}</td><td class="num">${fmt(o.paid)}</td><td class="num"><b>${fmt(o.owed)}</b></td>
              <td><span class="po-chip ${paymentLabel(o.payment).cls}">${esc(paymentLabel(o.payment).label)}</span></td></tr>`).join('')}</tbody>
          </table></div>` : ''}
          <h4>${$t('Statement')}</h4>
          ${st.lines.length ? `<div class="table-wrap"><table class="data-table po-statement">
            <thead><tr><th>${$t('Date')}</th><th>${$t('Details')}</th><th class="num">${$t('Received')}</th><th class="num">${$t('Paid')}</th><th class="num">${$t('Balance')}</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
            <tbody>${st.lines.map((l) => `<tr>
              <td>${esc(new Date(l.at).toLocaleDateString(loc))}</td>
              <td>${l.kind === 'purchase'
                ? `${esc($t('Delivery {order}', { order: l.poNumber || '' }))}${l.dueAt ? `<br><span class="muted">${esc($t('due {date}', { date: new Date(l.dueAt).toLocaleDateString(loc) }))}</span>` : ''}`
                : `${esc($t(PAY_METHODS.find((x) => x.id === l.method)?.label || l.method))}${l.reference ? ` · ${esc(l.reference)}` : ''}<br><span class="muted">${esc([l.poNumber, l.by].filter(Boolean).join(' · '))}</span>`}</td>
              <td class="num">${l.received ? fmt(l.received) : ''}</td>
              <td class="num">${l.paid ? fmt(l.paid) : ''}</td>
              <td class="num"><b>${fmt(l.balance)}</b></td>
              ${isAdmin ? `<td>${l.kind === 'supplier_payment' ? `<button class="btn btn-sm btn-danger-ghost" data-void="${esc(l.id)}" type="button">${$t('Void')}</button>` : ''}</td>` : ''}
            </tr>`).join('')}</tbody></table></div>` : `<p class="muted">${$t('Nothing received from this supplier yet.')}</p>`}
          <div class="modal-actions">
            <button class="btn btn-ghost" data-close>${$t('Close')}</button>
            ${st.balance > 0 ? `<button class="btn btn-primary" id="supPay">${$t('Record payment')}</button>` : ''}
          </div>
        </div>`);
      m.querySelector('#supPay')?.addEventListener('click', () => paymentModal(st));
      m.querySelectorAll('[data-void]').forEach((b) => b.addEventListener('click', async () => {
        const reason = window.prompt($t('Why is this payment being voided?'));
        if (!reason || !reason.trim()) return;
        try {
          await api.post('/api/suppliers/payment/void', { id: b.dataset.void, reason: reason.trim() });
          toast($t('Payment voided'), 'ok');
          closeModal();
          await load();
          supplierModal(id);
        } catch (err) { toast((err && err.message) || $t('Could not void the payment'), 'err'); }
      }));
    }

    function paymentModal(account, poId) {
      const owedOrders = (account.orders || []).filter((o) => o.owed > 0);
      let method = 'bank';
      const owedFor = (id) => (id ? (owedOrders.find((o) => o.poId === id) || {}).owed || 0 : account.balance);
      const m = openModal(`
        <h3>${esc($t('Pay {supplier}', { supplier: account.name }))}</h3>
        <p class="muted">${esc($t('Owed {amount}', { amount: fmt(account.balance) }))}${account.overdue > 0 ? ` · ${esc($t('{amount} overdue', { amount: fmt(account.overdue) }))}` : ''}</p>
        ${owedOrders.length ? `<label class="field-label">${$t('For order')}</label>
        <select class="field" id="payPo"><option value="">${esc($t('Not for one order'))}</option>${owedOrders.map((o) => `<option value="${esc(o.poId)}"${o.poId === poId ? ' selected' : ''}>${esc(o.poNumber)} · ${esc($t('owed {amount}', { amount: fmt(o.owed) }))}</option>`).join('')}</select>` : ''}
        <label class="field-label">${$t('Amount')}</label>
        <input class="field" id="payAmount" type="number" min="0" step="0.01" inputmode="decimal" value="${owedFor(poId).toFixed(2)}">
        <label class="field-label">${$t('Paid by')}</label>
        <div class="seg seg-sm" id="payMethod">${PAY_METHODS.map((p) => `<button type="button" class="seg-btn ${p.id === method ? 'on' : ''}" data-method="${p.id}">${esc($t(p.label))}</button>`).join('')}</div>
        <label class="field-label" id="payRefLabel">${$t('Reference')}</label>
        <input class="field" id="payRef" maxlength="60" placeholder="${esc($t('Transfer or cheque number'))}">
        <label class="field-label">${$t('Note')}</label>
        <input class="field" id="payNote" maxlength="200">
        <p id="payErr" class="login-err" role="alert"></p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>${$t('Cancel')}</button>
          <button class="btn btn-primary" id="payGo">${$t('Record payment')}</button>
        </div>`);
      const po = m.querySelector('#payPo');
      po?.addEventListener('change', () => { m.querySelector('#payAmount').value = owedFor(po.value).toFixed(2); });
      m.querySelectorAll('[data-method]').forEach((b) => b.addEventListener('click', () => {
        method = b.dataset.method;
        m.querySelectorAll('[data-method]').forEach((x) => x.classList.toggle('on', x.dataset.method === method));
      }));
      m.querySelector('#payGo').addEventListener('click', async () => {
        const body = {
          supplierId: account.id, poId: po ? po.value : '', method,
          amount: Math.round(Number(m.querySelector('#payAmount').value) * 100) / 100,
          reference: m.querySelector('#payRef').value.trim(), note: m.querySelector('#payNote').value.trim(),
        };
        const problem = paymentProblem({ ...body, owed: owedFor(body.poId) });
        if (problem) { m.querySelector('#payErr').textContent = $t(problem); beep('err'); return; }
        const go = m.querySelector('#payGo');
        go.disabled = true;
        try {
          const res = await api.post('/api/suppliers/payment', body);
          closeModal();
          toast($t('Paid {supplier} {amount}', { supplier: account.name, amount: fmt(res.amount) }), 'ok');
          beep('ok');
          await load();
        } catch (err) {
          m.querySelector('#payErr').textContent = (err && err.message) || $t('Could not record the payment');
          go.disabled = false;
        }
      });
    }

    function supplierOptions(selected) {
      return suppliers.map((s) => `<option value="${esc(s.id)}"${s.id === selected ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    }

    function productOptions() {
      return products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} ${esc(p.sku)}</option>`).join('');
    }

    function addSupplierModal() {
      const m = openModal(`
        <h3>${$t('Add supplier')}</h3>
        <label class="field-label">${$t('Name *')}</label>
        <input class="field" id="supName" placeholder="${esc($t('e.g. Vendor name'))}">
        <label class="field-label">${$t('Phone')}</label>
        <input class="field" id="supPhone" inputmode="tel" placeholder="(555) 000-0000">
        <label class="field-label">${$t('Email')}</label>
        <input class="field" id="supEmail" type="email" placeholder="sales@example.com">
        <label class="field-label">${$t('Payment terms')}</label>
        <input class="field" id="supTerms" placeholder="${$t('Net 30')}">
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>${$t('Cancel')}</button>
          <button class="btn btn-primary" id="supSave">${$t('Save')}</button>
        </div>
      `);
      m.querySelector('#supSave').addEventListener('click', async () => {
        const name = m.querySelector('#supName').value.trim();
        if (!name) { toast($t('Name is required'), 'warn'); return; }
        const saveBtn = m.querySelector('#supSave');
        saveBtn.disabled = true;
        try {
          await api.post('/api/suppliers', {
            name,
            phone: m.querySelector('#supPhone').value.trim(),
            email: m.querySelector('#supEmail').value.trim(),
            paymentTerms: m.querySelector('#supTerms').value.trim(),
          });
          toast($t('Supplier added'), 'ok');
          beep('ok');
          closeModal();
          await load();
        } catch (err) {
          toast((err && err.message) || $t('Could not add supplier'), 'err');
          saveBtn.disabled = false;
        }
      });
    }

    function poLineEditorRows() {
      return `
        <div id="poLines" class="po-lines"></div>
        <button class="btn btn-sm btn-ghost" id="poAddLine">${$t('+ Add line')}</button>`;
    }

    function addLineRow(linesEl, pre) {
      const prev = pre || { productId: (products[0] || {}).id, quantity: 1, unitCost: '', onHand: '' };
      const row = document.createElement('div');
      row.className = 'po-line';
      row.innerHTML = `
        <select class="field po-line-product">${productOptions()}</select>
        <input class="field po-line-qty" inputmode="decimal" value="${esc(String(prev.quantity ?? 1))}" aria-label="${$t('Quantity')}">
        <input class="field po-line-cost" inputmode="decimal" placeholder="${$t('Unit cost')}" value="${esc(prev.unitCost == null || prev.unitCost === '' ? '' : String(prev.unitCost))}" aria-label="${$t('Unit cost')}">
        <span class="muted po-line-onhand"></span>
        <button class="icon-btn po-line-del" aria-label="${$t('Remove line')}">✕</button>`;
      const sel = row.querySelector('.po-line-product');
      if (prev.productId) sel.value = prev.productId;
      const onHandEl = row.querySelector('.po-line-onhand');
      const costEl = row.querySelector('.po-line-cost');
      function glance() {
        const p = products.find((x) => x.id === sel.value);
        if (!p) return;
        onHandEl.textContent = $t('{n} on hand', { n: p.onHand });
        if (!costEl.value && p.costPrice != null) costEl.value = p.costPrice;
        costEl.dataset.serialized = p.isSerialized ? '1' : '0';
      }
      sel.addEventListener('change', glance);
      glance();
      row.querySelector('.po-line-del').addEventListener('click', () => row.remove());
      linesEl.appendChild(row);
    }

    function newPoModal(saveAsOrdered) {
      const m = openModal(`
        <h3>${$t('New purchase order')}</h3>
        <div class="form-grid">
          <div>
            <label class="field-label">${$t('Supplier *')}</label>
            <select class="field" id="poSupplier">${supplierOptions()}</select>
          </div>
          <div>
            <label class="field-label">${$t('Expected date')}</label>
            <input class="field" id="poExpected" type="date">
          </div>
        </div>
        <label class="field-label">${$t('Order lines')}</label>
        ${poLineEditorRows()}
        <div class="po-lines-subtotal">
          <span class="muted">${$t('Subtotal')}</span><strong id="poSubtotal">${fmt(0)}</strong>
        </div>
        <div class="form-grid">
          <div>
            <label class="field-label">${$t('Discount %')}</label>
            <input class="field" id="poDiscount" inputmode="decimal" value="0">
          </div>
          <div>
            <label class="field-label">${$t('Tax amount')}</label>
            <input class="field" id="poTax" inputmode="decimal" value="0">
          </div>
        </div>
        <label class="field-label">${$t('Note')}</label>
        <input class="field" id="poNote" placeholder="${$t('Order reference')}">
        <div class="po-lines-subtotal">
          <span class="muted">${$t('Total')}</span><strong id="poTotal">${fmt(0)}</strong>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>${$t('Cancel')}</button>
          <button class="btn" id="poSaveDraft">${$t('Save draft')}</button>
          <button class="btn btn-primary" id="poSaveOrder">${$t('Save & order')}</button>
        </div>
      `);
      const linesEl = m.querySelector('#poLines');
      addLineRow(linesEl);
      m.querySelector('#poAddLine').addEventListener('click', () => addLineRow(linesEl));

      function recalc() {
        let subtotal = 0;
        linesEl.querySelectorAll('.po-line').forEach((row) => {
          const sel = row.querySelector('.po-line-product');
          const p = products.find((x) => x.id === sel.value);
          const qty = Number(row.querySelector('.po-line-qty').value) || 0;
          const cost = Number(row.querySelector('.po-line-cost').value) || 0;
          if (p && p.isSerialized) row.querySelector('.po-line-cost').value = p.costPrice ?? cost;
          subtotal += qty * cost;
        });
        const discount = Math.min(100, Math.max(0, Number(m.querySelector('#poDiscount').value) || 0));
        const tax = Number(m.querySelector('#poTax').value) || 0;
        m.querySelector('#poSubtotal').textContent = fmt(subtotal);
        m.querySelector('#poTotal').textContent = fmt(subtotal * (1 - discount / 100) + tax);
      }
      ['#poDiscount', '#poTax'].forEach((id) => m.querySelector(id).addEventListener('input', recalc));
      linesEl.addEventListener('input', recalc);

      async function submit(status) {
        const supplierId = m.querySelector('#poSupplier').value;
        if (!supplierId) { toast($t('Pick a supplier'), 'warn'); return; }
        const lines = [];
        let bad = false;
        linesEl.querySelectorAll('.po-line').forEach((row) => {
          const p = products.find((x) => x.id === row.querySelector('.po-line-product').value);
          if (!p) return;
          const qty = Number(row.querySelector('.po-line-qty').value);
          const unitCost = Number(row.querySelector('.po-line-cost').value);
          if (!(qty > 0) || !(unitCost >= 0)) { bad = true; return; }
          lines.push({ productId: p.id, quantity: qty, unitCost });
        });
        if (bad) { toast($t('Check each line: quantity and unit cost'), 'warn'); return; }
        if (!lines.length) { toast($t('Add at least one line'), 'warn'); return; }
        const btn = m.querySelector(status === 'ORDERED' ? '#poSaveOrder' : '#poSaveDraft');
        btn.disabled = true;
        try {
          const res = await api.post('/api/purchase-orders', {
            supplierId,
            lines,
            expectedDate: m.querySelector('#poExpected').value,
            discountPct: Number(m.querySelector('#poDiscount').value) || 0,
            taxAmount: Number(m.querySelector('#poTax').value) || 0,
            note: m.querySelector('#poNote').value.trim(),
            status,
          });
          toast($t('{number} saved', { number: res.poNumber }), 'ok');
          beep('ok');
          closeModal();
          await load();
        } catch (err) {
          toast((err && err.message) || $t('Could not save the order'), 'err');
          btn.disabled = false;
        }
      }
      m.querySelector('#poSaveDraft').addEventListener('click', () => submit('DRAFT'));
      m.querySelector('#poSaveOrder').addEventListener('click', () => submit('ORDERED'));
      m.querySelector('#poExpected').value = new Date().toISOString().slice(0, 10);
    }

    async function viewPoModal(id) {
      let ord = null;
      let msg = '';
      try {
        ord = (await api.get(`/api/purchase-orders/detail?id=${encodeURIComponent(id)}`)).order;
      } catch (err) {
        msg = (err && err.message) || $t('Could not load the order');
      }

      const m = openModal(`
        <h3>${ord ? esc(ord.poNumber) : $t('Purchase order')}</h3>
        ${msg ? `<div class="po-msg">${esc(msg)}</div>` : ord ? `
        <p class="muted">${esc(ord.supplierName)} · ${esc($t('ordered {date}', { date: ord.orderDate.slice(0, 10) }))}${ord.expectedDate ? ` · ${esc($t('expected {date}', { date: ord.expectedDate }))}` : ''}</p>
        <div class="po-chip ${statusLabel(ord.status).cls}">${esc(statusLabel(ord.status).label)}</div>

        <div class="po-detail-lines">
          ${ord.lines.map((l) => `
            <div class="po-detail-line">
              <div class="po-detail-main">
                <strong>${esc(l.name)}</strong>
                <span class="muted">${esc(l.sku)} · ${l.quantity} × ${fmt(l.unitCost)}</span>
              </div>
              <div class="po-detail-right">
                <span class="muted">${esc($t('received {got}/{ordered}', { got: l.receivedQty, ordered: l.quantity }))}</span>
                ${l.onHand != null ? `<strong>${esc($t('{n} on hand', { n: l.onHand }))}</strong>` : ''}
              </div>
            </div>`).join('')}
        </div>
        <div class="po-lines-subtotal">
          <span class="muted">${esc(ord.discountPct ? $t('Subtotal {subtotal} − {pct}% · tax {tax}', { subtotal: fmt(ord.subtotal), pct: ord.discountPct, tax: fmt(ord.taxAmount) }) : $t('Subtotal {subtotal} · tax {tax}', { subtotal: fmt(ord.subtotal), tax: fmt(ord.taxAmount) }))}</span>
          <strong>${fmt(ord.total)}</strong>
        </div>
        ${ord.note ? `<p class="muted">${esc(ord.note)}</p>` : ''}
        ${(() => {
          const op = orderPay(ord.id);
          if (!op || !(op.received > 0 || op.paid > 0)) return '';
          return `<div class="po-lines-subtotal po-paystate">
            <span class="muted">${esc($t('Received {received} · paid {paid}', { received: fmt(op.received), paid: fmt(op.paid) }))} <span class="po-chip ${paymentLabel(op.payment).cls}">${esc(paymentLabel(op.payment).label)}</span></span>
            <strong>${esc($t('Owed {amount}', { amount: fmt(op.owed) }))}</strong></div>`;
        })()}
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>${$t('Close')}</button>
          ${(() => { const op = orderPay(ord.id); return op && op.owed > 0 ? `<button class="btn" id="poPay">${$t('Pay')}</button>` : ''; })()}
          ${(ord.status === 'ORDERED' || ord.status === 'PARTIAL') ? `
            <button class="btn btn-danger-ghost" id="poCancel">${$t('Cancel order')}</button>
            <button class="btn btn-primary" id="poReceive">${$t('Receive stock')}</button>` : ''}
        </div>` : ''}
      `);

      if (!ord) return;
      const cancelBtn = m.querySelector('#poCancel');
      if (cancelBtn) cancelBtn.addEventListener('click', async () => {
        if (!confirm($t('Cancel this purchase order?'))) return;
        cancelBtn.disabled = true;
        try {
          await api.post('/api/purchase-orders/cancel', { id });
          toast($t('Order cancelled'), 'ok');
          closeModal();
          await load();
        } catch (err) {
          toast((err && err.message) || $t('Could not cancel'), 'err');
          cancelBtn.disabled = false;
        }
      });
      m.querySelector('#poPay')?.addEventListener('click', () => {
        const op = orderPay(ord.id);
        const acc = op && accountOf(op.supplierId);
        if (acc) paymentModal(acc, ord.id);
      });
      const recvBtn = m.querySelector('#poReceive');
      if (recvBtn) recvBtn.addEventListener('click', () => receiveModal(ord));
    }

    function receiveModal(ord) {
      const openLines = ord.lines.filter((l) => l.remaining > 0);
      const m = openModal(`
        <h3>${esc($t('Receive — {number}', { number: ord.poNumber }))}</h3>
        <p class="muted">${$t('Enter what actually arrived. Sealed items need a serial number per unit.')}</p>
        <div id="poRecvLines" class="po-recv-lines">
          ${openLines.map((l) => `
            <div class="po-recv-line" data-line="${esc(l.productId)}">
              <div class="po-recv-head">
                <strong>${esc(l.name)}</strong>
                <span class="muted">${esc(l.sku)} · ${esc($t('open {n}', { n: l.remaining }))}</span>
                ${l.serialized ? `<span class="po-chip ordered">${$t('serialized')}</span>` : ''}
              </div>
              <div class="po-recv-fields">
                <input class="field po-recv-qty" inputmode="decimal" value="${l.remaining}" max="${l.remaining}" data-max="${l.remaining}" aria-label="${$t('Received quantity')}">
                ${l.serialized
                  ? `<textarea class="field po-recv-serials" rows="3" placeholder="${$t('One serial per line')}">${(l.serializedSerials || []).join('\n')}</textarea>`
                  : ''}
              </div>
            </div>`).join('')}
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>${$t('Close')}</button>
          <button class="btn btn-primary" id="poRecvGo">${$t('Post receipt')}</button>
        </div>
      `);

      m.querySelector('#poRecvGo').addEventListener('click', async () => {
        const lines = [];
        let invalid = '';
        m.querySelectorAll('.po-recv-line').forEach((el) => {
          const productId = el.dataset.line;
          const line = openLines.find((l) => l.productId === productId);
          const qty = Number(el.querySelector('.po-recv-qty').value) || 0;
          if (!(qty > 0) || qty > line.remaining) { invalid = line.name; return; }
          let serials = [];
          if (line.serialized) {
            serials = splitSerials(el.querySelector('.po-recv-serials').value);
            if (serials.length !== qty) { invalid = line.name; return; }
          }
          lines.push({ productId, quantity: qty, serialNumbers: serials });
        });
        if (invalid) { toast($t('Fix {name}: quantity and serials must match', { name: invalid }), 'warn'); return; }
        const go = m.querySelector('#poRecvGo');
        go.disabled = true;
        try {
          const res = await api.post('/api/purchase-orders/receive', { id: ord.id, lines });
          closeModal();
          toast($t('Receipt posted — {amount}', { amount: fmt(res.receivedValue) }), 'ok');
          beep('ok');
          await load();
        } catch (err) {
          toast((err && err.message) || $t('Receipt failed'), 'err');
          go.disabled = false;
        }
      });
      m.querySelectorAll('.po-recv-qty').forEach((q) => {
        q.addEventListener('input', () => {
          const max = Number(q.dataset.max) || 0;
          if (Number(q.value) > max) q.value = max;
        });
      });
    }

    await load();
    return () => {};
  },
};