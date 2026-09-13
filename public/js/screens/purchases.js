'use strict';

import { $t, $tn, N_ } from '../lang.js';

/* Purchases: suppliers + purchase orders, manager/admin only.
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
    let loadErr = '';

    async function load() {
      loadErr = '';
      root.innerHTML = `<div class="empty"><p>${$t('Loading…')}</p></div>`;
      try {
        const [sup, ord, prods] = await Promise.all([
          api.get('/api/suppliers'),
          api.get('/api/purchase-orders'),
          api.get('/api/products'),
        ]);
        suppliers = sup.suppliers || [];
        orders = ord.orders || [];
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
            <button class="btn btn-sm" id="poAddSupplier">${$t('+ Supplier')}</button>
            <button class="btn btn-sm btn-primary" id="poNew">${$t('New PO')}</button>
          </div>`,
        })}

        ${loadErr ? `<div class="empty"><p>${esc(loadErr)}</p></div>` : `
        <section class="po-block">
          <h3>${$t('Suppliers')}</h3>
          ${suppliers.length ? `
          <div class="po-plain po-suppliers">
            ${suppliers.map((s) => `
              <div class="po-supplier" data-sup="${esc(s.id)}">
                <strong>${esc(s.name)}</strong>
                <span class="muted">${esc(s.phone || '')}${s.email ? ` · ${esc(s.email)}` : ''}</span>
                <span class="muted">${s.paymentTerms ? esc(s.paymentTerms) : $t('Open terms')}</span>
              </div>`).join('')}
          </div>` : `<p class="muted">${$t('No suppliers yet — add one to place a purchase order.')}</p>`}
        </section>

        <section class="po-block">
          <h3>${$t('Purchase orders')}</h3>
          ${orders.length ? `
          <div class="po-plain">
            ${orders.map((o) => {
              const st = statusLabel(o.status);
              return `
              <div class="po-row" data-po="${esc(o.id)}">
                <div class="po-row-main">
                  <strong>${esc(o.poNumber)}</strong>
                  <span class="muted">${esc(o.supplierName || '—')} · ${esc($tn('{n} line', '{n} lines', o.itemCount))} · ${esc($t('{got}/{ordered} received', { got: o.receivedQty, ordered: o.orderedQty }))}</span>
                  <span class="muted">${o.expectedDate ? esc($t('Expected {date}', { date: o.expectedDate })) : $t('No due date')}</span>
                </div>
                <div class="po-row-side">
                  <span class="po-chip ${st.cls}">${esc(st.label)}</span>
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
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>${$t('Close')}</button>
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