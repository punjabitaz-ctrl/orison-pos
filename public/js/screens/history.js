'use strict';

/* History: offline ledger of this device's sales plus server-transactions
   pulled on demand. Each record shows sync state (SYNCED / PENDING / VOIDED). */

import { idb } from '../db.js';
import { api } from '../api.js';
import { fmt, esc, openModal, closeModal } from '../ui.js';

export const screen = {
  id: 'history',
  tab: 'history',
  title: 'History',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');

    let serverTxs = [];
    let loaded = false;

    async function loadServer() {
      try {
        const res = await api.get('/api/transactions?limit=100');
        serverTxs = (res.transactions || []).map((t) => ({
          id: 'srv:' + t.id,
          server: true,
          status: 'SERVER',
          total: t.grandTotal,
          tenders: t.tenders,
          cashier: t.cashier,
          createdAt: t.createdAt,
          items: t.items.map((i) => ({ name: '—', quantity: i.quantity, unitPrice: i.unitPrice, serialNumber: i.serialNumber })),
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
          ${all.length ? all.map((t) => `
            <button class="hx-card ${t.status === 'VOIDED' ? 'v' : ''}" data-tx="${esc(t.id)}">
              <div class="hx-left">
                <span class="hx-date">${humanDate(t.createdAt)}</span>
                <span class="hx-cashier">${esc(t.cashier || '—')}</span>
                <span class="hx-status st-${(t.status || 'PENDING').toLowerCase()}">${t.status}</span>
              </div>
              <div class="hx-right">
                <strong>${fmt(t.total)}</strong>
                <span class="hx-count">${t.items ? t.items.length : 0} items</span>
              </div>
            </button>`).join('')
            : `<div class="empty"><p>No sales yet.</p></div>`}
        </div>`;

      root.querySelector('#refreshH').addEventListener('click', loadServer);

      root.querySelectorAll('[data-tx]').forEach((b) => b.addEventListener('click', () => {
        const t = all.find((x) => x.id === b.dataset.tx);
        if (t) openDetail(t);
      }));
    }

    function openDetail(t) {
      const modalEl = openModal(`
        <div class="tx-detail">
          <button class="icon-btn abs-close" data-x>✕</button>
          <h3>${fmt(t.total)}</h3>
          <p class="muted">${esc(humanDate(t.createdAt))} · ${esc(t.cashier || '—')} · ${t.status}</p>
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
        </div>`);
      modalEl.querySelector('[data-x]').addEventListener('click', closeModal);
      modalEl.addEventListener('click', (e) => { if (e.target.classList.contains('modal-backdrop') || e.target.closest('[data-close]')) closeModal(); });
      modalEl.parentElement.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });
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