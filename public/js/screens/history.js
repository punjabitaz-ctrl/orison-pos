'use strict';

/* History: offline ledger of this device's sales plus server-transactions
   pulled on demand. Each record shows sync state (SYNCED / PENDING / VOIDED),
   its kind (sale / refund / payout), and refundable sales open a refund modal. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { fmt, esc, openModal, closeModal, toast } from '../ui.js';
import { kindInfo, createRefund } from '../money.js';

export const screen = {
  id: 'history',
  tab: 'history',
  title: 'History',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const user = (ctx.state && ctx.state.user) || {};

    let serverTxs = [];
    let loaded = false;

    async function loadServer() {
      try {
        const res = await api.get('/api/transactions?limit=100');
        serverTxs = (res.transactions || []).map((t) => ({
          id: 'srv:' + t.id,
          server: true,
          status: 'SERVER',
          kind: t.kind || 'sale',
          originalClientTx: t.originalClientTx,
          counterparty: t.counterparty,
          total: t.grandTotal,
          tenders: t.tenders,
          cashier: t.cashier,
          createdAt: t.createdAt,
          items: t.items.map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, serialNumber: i.serialNumber })),
          clientTxId: t.clientTxId,
        }));
        loaded = true;
      } catch (_) {
        loaded = false;
      }
      render();
    }

    async function render() {
      const local = await idb.getAll('transactions');
      const all = mergeById([...local, ...serverTxs]);
      all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

      const stat = {
        synced: local.filter((t) => t.status === 'SYNCED').length,
        pending: local.filter((t) => t.status === 'PENDING').length,
        voided: local.filter((t) => t.status === 'VOIDED').length,
      };

      root.innerHTML = `
        <header class="scr-head">
          <div class="scr-title">
            <h2>History</h2>
            <p>${local.length} local · ${stat.synced} synced · <span class="warn-text">${stat.pending} pending · ${stat.voided} voided</span></p>
          </div>
          <button class="icon-btn" id="refreshH">⟳</button>
        </header>
        <div class="hx-list">
          ${all.length ? all.map((t) => {
            const k = kindInfo(t.kind);
            return `
            <button class="hx-card ${t.status === 'VOIDED' ? 'v' : ''}" data-tx="${esc(t.id)}">
              <div class="hx-left">
                <span class="hx-date">${humanDate(t.createdAt)}</span>
                <span class="hx-cashier">${esc(t.cashier || '—')}</span>
                <span class="hx-status st-${(t.status || 'PENDING').toLowerCase()}">${t.status}</span>
                ${t.kind && t.kind !== 'sale' ? `<span class="k-chip ${k.cls}">${k.label}</span>` : ''}
              </div>
              <div class="hx-right">
                <strong>${k.sign < 0 ? '−' : ''}${fmt(t.total)}</strong>
                <span class="hx-count">${t.items ? t.items.length : 0} items</span>
              </div>
            </button>`;
          }).join('')
            : `<div class="empty"><p>No sales yet.</p></div>`}
        </div>`;

      root.querySelector('#refreshH').addEventListener('click', loadServer);

      root.querySelectorAll('[data-tx]').forEach((b) => b.addEventListener('click', () => {
        const t = all.find((x) => x.id === b.dataset.tx);
        if (t) openDetail(t);
      }));
    }

    function openDetail(t) {
      const k = kindInfo(t.kind);
      const refundable = (t.kind || 'sale') === 'sale' && (t.status === 'SYNCED' || t.status === 'SERVER') && (t.items || []).length > 0;
      const modalEl = openModal(`
        <div class="tx-detail">
          <button class="icon-btn abs-close" data-x>✕</button>
          <h3>${k.sign < 0 ? '−' : ''}${fmt(t.total)} <span class="k-chip ${k.cls}">${k.label}</span></h3>
          <p class="muted">${esc(humanDate(t.createdAt))} · ${esc(t.cashier || '—')} · ${t.status}</p>
          ${t.originalClientTx ? `<p class="muted">refund of ${esc(t.originalClientTx)}</p>` : ''}
          ${t.counterparty ? `<p class="muted">${esc(t.counterparty)}</p>` : ''}
          ${t.clientTxId ? `<p class="muted">${esc(t.clientTxId)}</p>` : ''}
          <div class="tx-items">
            ${(t.items || []).map((i) => `
              <div class="tx-item-row">
                <div>
                  <div>${esc(i.name || 'Item')} <em>×${i.quantity || 1}</em></div>
                  ${i.serialNumber ? `<div class="cl-serial">${esc(i.serialNumber)}</div>` : ''}
                </div>
                <b>${fmt((i.unitPrice || 0) * (i.quantity || 1))}</b>
              </div>`).join('')}
          </div>
          <div class="tx-tenders">
            ${(t.tenders || []).map((td) => `<div class="hx-tender"><span>${esc(td.label || td.type)}</span><b>${fmt(td.amount)}</b></div>`).join('')}
          </div>
          ${refundable ? `<button class="btn" id="refundBtn" style="--bg:#c62828">Refund items</button>` : ''}
          <div id="txSend" class="receipt-send-host"></div>
        </div>`);
      modalEl.querySelector('[data-x]').addEventListener('click', closeModal);
      modalEl.addEventListener('click', (e) => { if (e.target.classList.contains('modal-backdrop') || e.target.closest('[data-close]')) closeModal(); });
      modalEl.parentElement.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

      const refundBtn = modalEl.querySelector('#refundBtn');
      if (refundBtn) refundBtn.addEventListener('click', () => openRefundModal(t));

      if ((t.kind || 'sale') === 'sale') {
        import('../receipt-send.js').then(({ mountSendButtons }) => {
          const host = modalEl.querySelector('#txSend');
          if (!host) return;
          mountSendButtons(host, {
            lines: txReceiptLines(t),
            title: 'Orison POS — Receipt',
            filename: 'orison-receipt-' + (t.clientTxId || t.id),
          });
        });
      }
    }

    function openRefundModal(t) {
      const groups = [];
      const byProduct = new Map();
      for (const i of t.items || []) {
        const key = String(i.productId || i.name || 'line');
        const g = byProduct.get(key) || { productId: i.productId || '', name: i.name || 'Item', unitPrice: i.unitPrice || 0, serialized: !!i.productId && null, qty: 0, serials: [] };
        g.serialized = g.serialized === null ? false : g.serialized;
        if (!g.serialized && !i.serialNumber) g.serialized = false;
        if (i.serialNumber) { g.serialized = true; g.serials.push(i.serialNumber); }
        else { g.qty += i.quantity || 1; }
        if (!byProduct.has(key)) byProduct.set(key, g);
      }
      groups.push(...byProduct.values());
      groups.forEach((g) => { g.serials = [...new Set(g.serials)]; g.qtySel = g.serialized ? 0 : g.qty; });
      const pickedSerial = new Set();
      let method = 'cash';

      const sel = {};

      const modalEl = openModal(`
        <div class="tx-detail refund-modal">
          <button class="icon-btn abs-close" data-x>✕</button>
          <h3>Refund</h3>
          <p class="muted">${esc(humanDate(t.createdAt))} · ${esc(t.clientTxId || t.id)}</p>
          <div class="refund-lines">
            ${groups.map((g, gi) => `
              ${g.serialized ? `
                <div class="rf-group">
                  <div class="rf-gname">${esc(g.name)}</div>
                  ${g.serials.map((sn, si) => `
                    <label class="rf-serial">
                      <input type="checkbox" class="rf-ser" data-g="${gi}" data-sn="${esc(sn)}">
                      <span>${esc(sn)}</span>
                      <b>${fmt(g.unitPrice)}</b>
                    </label>`).join('')}
                </div>` : `
                <div class="rf-group">
                  <div>${esc(g.name)} <em>×${fmt(g.unitPrice)}</em></div>
                  <div class="rf-stepper" data-g="${gi}">
                    <button type="button" class="icon-btn" data-dir="-1">−</button>
                    <span class="rf-qty" data-q="${gi}">${g.qty}</span>
                    <button type="button" class="icon-btn" data-dir="1">+</button>
                  </div>
                </div>`}`).join('')}
          </div>
          <div class="rf-method">
            <label class="rf-radio"><input type="radio" name="rf-method" value="cash" ${method === 'cash' ? 'checked' : ''}><span>Cash</span></label>
            <label class="rf-radio"><input type="radio" name="rf-method" value="store_credit" ${method === 'store_credit' ? 'checked' : ''}><span>Store credit</span></label>
          </div>
          <input class="field" id="rf-note" placeholder="Reason (optional)">
          <div class="rf-total"><span>Refund total</span><b id="rf-total">${fmt(0)}</b></div>
          <button class="btn" id="rf-confirm" disabled style="--bg:#c62828">Confirm refund</button>
        </div>`);
      modalEl.querySelector('[data-x]').addEventListener('click', closeModal);
      modalEl.querySelectorAll('[data-dir]').forEach((btn) => btn.addEventListener('click', () => {
        const dir = Number(btn.dataset.dir);
        const g = groups[Number(btn.closest('[data-g]').dataset.g)];
        if (dir === 1 && g.qtySel < g.qty) g.qtySel += 1;
        if (dir === -1 && g.qtySel > 0) g.qtySel -= 1;
        modalEl.querySelector(`[data-q="${groups.indexOf(g)}"]`).textContent = g.qtySel;
        updateTotal();
      }));
      modalEl.querySelectorAll('.rf-ser').forEach((cb) => cb.addEventListener('change', () => {
        if (cb.checked) pickedSerial.add(cb.dataset.sn);
        else pickedSerial.delete(cb.dataset.sn);
        updateTotal();
      }));
      modalEl.querySelectorAll('input[name="rf-method"]').forEach((r) => r.addEventListener('change', () => { method = r.value; }));
      const confirm = modalEl.querySelector('#rf-confirm');
      confirm.addEventListener('click', async () => {
        const items = [];
        groups.forEach((g, gi) => {
          if (g.serialized) {
            for (const sn of g.serials) if (pickedSerial.has(sn)) items.push({ productId: g.productId, name: g.name, quantity: 1, unitPrice: g.unitPrice, serialNumber: sn });
          } else if (g.qtySel > 0) {
            items.push({ productId: g.productId, name: g.name, quantity: g.qtySel, unitPrice: g.unitPrice });
          }
        });
        if (!items.length) return;
        confirm.disabled = true;
        try {
          await createRefund({ original: t, items, method, note: modalEl.querySelector('#rf-note').value.trim(), user });
          closeModal();
          toast('Refund queued', 'ok', 1800);
          if (navigator.onLine) loadServer(); else render();
        } catch (_) {
          confirm.disabled = false;
          toast('Refund failed — try again', 'warn', 2400);
        }
      });

      function updateTotal() {
        let total = 0;
        groups.forEach((g) => {
          if (g.serialized) for (const sn of g.serials) if (pickedSerial.has(sn)) total += g.unitPrice;
          else total += g.unitPrice * g.qtySel;
        });
        modalEl.querySelector('#rf-total').textContent = fmt(Math.round(total * 100) / 100);
        confirm.disabled = Math.round(total * 100) <= 0;
      }
    }

    function txReceiptLines(t) {
      const kind = kindInfo(t.kind);
      const d = t.createdAt ? new Date(t.createdAt) : new Date();
      const dateStr = isNaN(d) ? '' : d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
      const timeStr = isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const lines = [
        'ORISON ELECTRONICS',
        t.storeName || '',
        `${dateStr} ${timeStr}`.trim(),
        `${kind.label} — Cashier: ${t.cashier || '—'}`, '—',
      ];
      if (kind.label === 'Sale') {
        for (const i of (t.items || [])) {
          const name = i.serialNumber ? `${i.name} [${i.serialNumber}]` : i.name;
          const qty = i.quantity > 1 ? ` x${i.quantity}` : '';
          lines.push(`${name}${qty} — ${fmt((i.unitPrice || 0) * (i.quantity || 1))}`);
        }
        lines.push('—', `Total — ${fmt(t.total)}`);
        for (const td of (t.tenders || [])) lines.push(`${td.label || td.type} — ${fmt(td.amount)}`);
        lines.push('Thank you for shopping at Orison!');
      } else {
        lines.push(`Total — ${fmt(t.total)}`);
        if (t.counterparty) lines.push(`To: ${t.counterparty}`);
      }
      lines.push(`# ${t.clientTxId || t.id}`);
      return lines;
    }

    function mergeById(list) {
      const byId = new Map();
      for (const t of list) {
        if (byId.has(t.id)) continue;
        byId.set(t.id, t);
      }
      return [...byId.values()];
    }

    function humanDate(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d)) return iso;
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    await render();
    if (navigator.onLine) loadServer();
  },
};