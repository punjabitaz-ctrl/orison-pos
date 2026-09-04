'use strict';

/* Products screen: full catalog with stock levels. Admin sees add-product,
   stock-adjust, and add-serials tools (server-authoritative + local mirror). */

import { idb } from '../db.js';
import { api } from '../api.js';
import { fmt, esc, toast, beep, debounce, openModal, closeModal } from '../ui.js';
import { pull, mergeProductLocal, SYNC_EVENT, getSyncState } from '../sync.js';

function catColor(c) {
  const colors = ['#d97706', '#0ea5e9', '#059669', '#7c3aed', '#e11d48', '#0891b2', '#65a30d', '#c2410c', '#4f46e5', '#0d9488'];
  let n = 0;
  for (let i = 0; i < c.length; i++) n = (n * 31 + c.charCodeAt(i)) >>> 0;
  return colors[n % colors.length];
}

export const screen = {
  id: 'inventory',
  tab: 'inventory',
  title: 'Products',

  _products: [],

  async refreshProducts() {
    this._products = await idb.getAll('products');
    this._products.sort((a, b) => a.name.localeCompare(b.name));
  },

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const { state } = ctx;
    const isAdmin = state.user && (state.user.role === 'admin' || state.user.role === 'manager');

    await this.refreshProducts();
    const stats = await getSyncState();

    root.innerHTML = `
      <header class="scr-head">
        <div class="scr-title">
          <h2>Products</h2>
          <p>${this._products.length} items${isAdmin ? ' · admin' : ''}</p>
        </div>
        ${isAdmin ? '<button class="btn btn-ghost btn-sm" id="newProdBtn">+ New</button>' : ''}
      </header>
      <div class="search-row">
        <div class="search-box">
          <input id="invSearch" type="search" placeholder="Search products…" autocomplete="off">
        </div>
      </div>
      <main class="inv-list" id="invList"></main>`;

    const listEl = root.querySelector('#invList');
    const searchEl = root.querySelector('#invSearch');
    const debounced = debounce(renderList, 120);

    function renderList() {
      const q = searchEl.value.trim().toLowerCase();
      const list = screen._products.filter((p) => !q
        || p.name.toLowerCase().includes(q)
        || (p.sku || '').toLowerCase().includes(q)
        || (p.upc || '').toLowerCase().includes(q));
      listEl.innerHTML = list.map((p) => {
        const avail = p.isSerialized ? (p.serials || []).length : (p.onHand || 0);
        return `
        <div class="inv-row">
          <div class="inv-idx" style="background:${catColor(p.category)}">${esc(p.category[0] || '?')}</div>
          <div class="inv-main">
            <div class="inv-name">${esc(p.name)}</div>
            <div class="inv-sku">${esc(p.sku || '')}${p.isSerialized ? ' · IMEI-managed' : ''}</div>
          </div>
          <div class="inv-qty ${avail <= 3 ? 'low' : ''} ${avail <= 0 ? 'zero' : ''}">
            ${avail} ${p.isSerialized ? 'units' : 'left'}
          </div>
          <div class="inv-price">${fmt(p.retailPrice)}</div>
          ${isAdmin ? `
          <div class="inv-actions">
            ${p.isSerialized
              ? `<button class="icon-btn" data-serials="${esc(p.id)}" title="Add serials">＋</button>`
              : `<button class="icon-btn" data-stock="${esc(p.id)}" title="Adjust stock">✎</button>`}
          </div>` : ''}
        </div>`;
      }).join('') || '<div class="empty"><p>No products.</p></div>';

      if (isAdmin) {
        listEl.querySelectorAll('[data-stock]').forEach((b) => b.addEventListener('click', () => stockModal(listEl, b.dataset.stock)));
        listEl.querySelectorAll('[data-serials]').forEach((b) => b.addEventListener('click', () => serialsModal(b.dataset.serials)));
      }
    }

    searchEl.addEventListener('input', debounced);

    if (isAdmin) root.querySelector('#newProdBtn').addEventListener('click', newProductModal);

    function newProductModal() {
      const modal = openModal(`
        <div class="form-modal">
          <h3>New product</h3>
          <div class="field"><span>Name *</span><input id="fName" placeholder="e.g. USB-C Cable 1m"></div>
          <div class="two fields-row">
            <div class="field"><span>SKU</span><input id="fSku" placeholder="CB-USBC-1M"></div>
            <div class="field"><span>UPC</span><input id="fUpc" inputmode="numeric" placeholder="00123456…"></div>
          </div>
          <div class="two fields-row">
            <div class="field"><span>Category</span><input id="fCat" placeholder="Cables" value="General"></div>
            <div class="field"><span>Retail $</span><input id="fPrice" type="number" inputmode="decimal" min="0" step="0.01" value="0"></div>
          </div>
          <div class="two fields-row">
            <div class="field"><span>Cost $</span><input id="fCost" type="number" inputmode="decimal" min="0" step="0.01" value="0"></div>
          </div>
          <label class="check"><input id="fSerial" type="checkbox"> Serialized (IMEI-tracked)</label>
          <div class="field"><span>Starting qty (if not serialized)</span><input id="fQty" type="number" inputmode="numeric" min="0" step="1" value="0"></div>
          <p id="pErr" class="login-err"></p>
          <div class="row"><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn" id="pSave">Save</button></div>
        </div>`);
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('#pSave').addEventListener('click', async () => {
        const body = {
          name: modal.querySelector('#fName').value.trim(),
          sku: modal.querySelector('#fSku').value.trim(),
          upc: modal.querySelector('#fUpc').value.trim(),
          category: modal.querySelector('#fCat').value.trim() || 'General',
          retailPrice: parseFloat(modal.querySelector('#fPrice').value) || 0,
          costPrice: parseFloat(modal.querySelector('#fCost').value) || 0,
          isSerialized: modal.querySelector('#fSerial').checked,
          onHand: parseInt(modal.querySelector('#fQty').value, 10) || 0,
        };
        if (!body.name) { modal.querySelector('#pErr').textContent = 'Name is required.'; return; }
        try {
          await api.post('/api/admin/products', body);
          await pull();
          await screen.refreshProducts();
          renderList();
          closeModal();
          toast('Product created', 'ok'); beep('ok');
        } catch (err) {
          modal.querySelector('#pErr').textContent = (err && err.data && err.data.error) || err.message;
        }
      });
    }

    function stockModal(listEl, productId) {
      const p = screen._products.find((x) => x.id === productId);
      if (!p) return;
      const modal = openModal(`
        <div class="form-modal">
          <h3>Stock level</h3>
          <p class="muted">${esc(p.name)}</p>
          <div class="field"><span>On hand</span><input id="sQty" type="number" inputmode="numeric" min="0" step="1" value="${p.onHand || 0}"></div>
          <p id="sErr" class="login-err"></p>
          <div class="row"><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn" id="sSave">Save count</button></div>
        </div>`);
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('#sSave').addEventListener('click', async () => {
        const v = parseInt(modal.querySelector('#sQty').value, 10);
        if (isNaN(v) || v < 0) { modal.querySelector('#sErr').textContent = 'Enter a whole number ≥ 0.'; return; }
        try {
          await api.post('/api/admin/inventory', { productId, onHand: v });
          await pull();
          await screen.refreshProducts();
          renderList();
          closeModal();
          toast('Stock updated', 'ok'); beep('ok');
        } catch (err) { modal.querySelector('#sErr').textContent = (err && err.data && err.data.error) || err.message; }
      });
    }

    function serialsModal(productId) {
      const p = screen._products.find((x) => x.id === productId);
      if (!p) return;
      const used = (p.serials || []).length;
      const modal = openModal(`
        <div class="form-modal">
          <h3>Add serials / IMEIs</h3>
          <p class="muted">${esc(p.name)} · ${used} currently in stock</p>
          <div class="field"><span>Serials (one per line)</span>
            <textarea id="sList" rows="6" placeholder="IMEI/SN per line…"></textarea>
          </div>
          <p id="sErr" class="login-err"></p>
          <div class="row"><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn" id="sSave">Add</button></div>
        </div>`);
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('#sSave').addEventListener('click', async () => {
        const serialNumbers = modal.querySelector('#sList').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (!serialNumbers.length) { modal.querySelector('#sErr').textContent = 'Paste at least one serial.'; return; }
        try {
          const res = await api.post('/api/admin/serials', { productId, serialNumbers });
          await pull();
          await screen.refreshProducts();
          renderList();
          closeModal();
          toast(`Added ${res.added.length} serials${res.duplicates.length ? `, ${res.duplicates.length} duplicates skipped` : ''}`, 'ok');
        } catch (err) { modal.querySelector('#sErr').textContent = (err && err.data && err.data.error) || err.message; }
      });
    }

    renderList();

    const handleSync = () => { screen.refreshProducts().then(renderList); };
    window.addEventListener(SYNC_EVENT, handleSync);

    return () => window.removeEventListener(SYNC_EVENT, handleSync);
  },
};