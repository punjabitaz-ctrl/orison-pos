'use strict';

import { $t, $tn, arrow, dateLocale } from '../lang.js';

/* Products screen: full catalog with stock levels. Admin sees add-product,
   stock-adjust, and add-serials tools (server-authoritative + local mirror). */

import { idb } from '../db.js';
import { api } from '../api.js';
import { fmt, esc, toast, beep, debounce, openModal, closeModal, openSheet, closeSheet, currencySymbol } from '../ui.js';
import { bulkPriceModal, stockTakeModal, labelsModal, reorderModal } from './inventory-tools.js';
import { pull, mergeProductLocal, SYNC_EVENT, getSyncState } from '../sync.js';
import { reorderThreshold } from '../alerts.js';
import { catColor, screenHead } from '../components.js';


function isLocked(p) {
  return p && (p.locked === true || p.locked === 1 || String(p.locked) === '1');
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
    /* Stock take and bulk pricing rewrite the catalog on the owner's authority,
       so they are admin-only from v1.23.0 - the server enforces it too. */
    const isOwner = state.user && state.user.role === 'admin';

    await this.refreshProducts();
    const stats = await getSyncState();

    root.innerHTML = `
      ${screenHead({
        title: $t('Products'),
        sub: `${$tn('{n} item', '{n} items', this._products.length)}${isAdmin ? ' · ' + $t('admin') : ''}`,
        actions: isAdmin ? `<div class="btn-row"><button class="btn btn-ghost btn-sm" id="toolsBtn">${$t('Tools')}</button><button class="btn btn-ghost btn-sm" id="newProdBtn">${$t('+ New')}</button></div>` : '',
      })}
      <div class="search-row">
        <div class="search-box">
          <input id="invSearch" type="search" placeholder="${$t('Search products…')}" autocomplete="off">
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
        const isService = p.itemType === 'service';
        const locked = isLocked(p);
        const avail = isService ? 0 : (p.isSerialized ? (p.serials || []).length : (p.onHand || 0));
        const belowReorder = !isService && !p.isSerialized && avail <= reorderThreshold(p);
        const stockCls = isService ? '' : (avail <= 0 ? 'zero' : (belowReorder ? 'low' : ''));
        return `
        <div class="inv-row">
          <div class="inv-idx" style="background:${catColor(p.category)}">${esc(p.category[0] || '?')}</div>
          <div class="inv-main">
            <div class="inv-name">${esc(p.name)}${locked ? ` <span class="lock-dot" title="${$t('Locked')}">🔒</span>` : ''}</div>
            <div class="inv-sku">${esc(p.sku || '')}${isService ? ' · ' + esc($t('service')) : (p.isSerialized ? ' · ' + esc($t('IMEI-managed')) : '')}</div>
          </div>
          <div class="inv-qty ${stockCls}">${isService ? $t('Service') : (p.isSerialized ? esc($tn('{n} unit', '{n} units', avail)) : esc($t('{n} left', { n: avail })))}</div>
          <div class="inv-price">${fmt(p.retailPrice)}</div>
          ${isAdmin ? `
          <div class="inv-actions">
            ${isService
              ? `<button class="icon-btn" data-history="${esc(p.id)}" title="${$t('Price history')}">📈</button>
                 <button class="icon-btn" data-settings="${esc(p.id)}" title="${$t('Settings')}">⚙</button>`
              : p.isSerialized
                ? `<button class="icon-btn" data-serials="${esc(p.id)}" title="${$t('Add serials')}">＋</button>
                   <button class="icon-btn" data-history="${esc(p.id)}" title="${$t('Price history')}">📈</button>
                   <button class="icon-btn" data-settings="${esc(p.id)}" title="${$t('Settings')}">⚙</button>`
                : `<button class="icon-btn" data-stock="${esc(p.id)}" title="${$t('Adjust stock')}">✎</button>
                   <button class="icon-btn" data-history="${esc(p.id)}" title="${$t('Price history')}">📈</button>
                   <button class="icon-btn" data-settings="${esc(p.id)}" title="${$t('Settings')}">⚙</button>`}
          </div>` : ''}
        </div>`;
      }).join('') || `<div class="empty"><p>${$t('No products.')}</p></div>`;

      if (isAdmin) {
        listEl.querySelectorAll('[data-stock]').forEach((b) => b.addEventListener('click', () => stockModal(listEl, b.dataset.stock)));
        listEl.querySelectorAll('[data-serials]').forEach((b) => b.addEventListener('click', () => serialsModal(b.dataset.serials)));
        listEl.querySelectorAll('[data-history]').forEach((b) => b.addEventListener('click', () => priceHistoryModal(b.dataset.history)));
        listEl.querySelectorAll('[data-settings]').forEach((b) => b.addEventListener('click', () => settingsModal(b.dataset.settings)));
      }
    }

    searchEl.addEventListener('input', debounced);

    if (isAdmin) {
      root.querySelector('#newProdBtn').addEventListener('click', newProductModal);
      root.querySelector('#toolsBtn').addEventListener('click', toolsSheet);
    }

    /* One menu for the stock-keeping tools rather than five buttons fighting
       for the header on a phone. */
    function toolsSheet() {
      const sheet = openSheet(`
        <div class="cart-head"><h3>${$t('Inventory tools')}</h3><button class="icon-btn" data-x aria-label="${$t('Close')}">✕</button></div>
        <div class="tool-menu">
          <button class="tool-item" data-tool="reorder"><b>${$t('Reorder worksheet')}</b><span>${$t('What to buy next, from sales velocity and reorder points')}</span></button>
          ${isOwner ? `
          <button class="tool-item" data-tool="stocktake"><b>${$t('Stock take')}</b><span>${$t('Count the shelf and post the variance')}</span></button>
          <button class="tool-item" data-tool="bulk"><b>${$t('Bulk price update')}</b><span>${$t('Reprice a category or the whole catalog by rule')}</span></button>` : ''}
          <button class="tool-item" data-tool="labels"><b>${$t('Print shelf labels')}</b><span>${$t('Code 128 barcodes with name and price')}</span></button>
          <button class="tool-item" data-tool="aging"><b>${$t('Inventory aging')}</b><span>${$t('How long stock has been sitting, valued at cost')}</span></button>
        </div>`);
      sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
      sheet.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', async () => {
        const tool = b.dataset.tool;
        closeSheet();
        const refresh = async () => {
          await pull().catch(() => {});
          await screen.refreshProducts();
          renderList();
        };
        if (tool === 'aging') agingModal();
        else if (tool === 'reorder') reorderModal();
        else if (tool === 'bulk') bulkPriceModal({ products: screen._products, onDone: refresh });
        else if (tool === 'stocktake') stockTakeModal({ products: screen._products, onDone: refresh });
        else if (tool === 'labels') labelsModal({ products: screen._products, storeName: (state.store && state.store.name) || '' });
      }));
    }

    function newProductModal() {
      const modal = openModal(`
        <div class="form-modal">
          <h3>${$t('New item')}</h3>
          <div class="field"><span>${$t('Name *')}</span><input id="fName" placeholder="${$t('e.g. USB-C Cable 1m')}"></div>
          <div class="two fields-row">
            <div class="field"><span>${$t('SKU')}</span><input id="fSku" placeholder="CB-USBC-1M"></div>
            <div class="field"><span>${$t('UPC')}</span><input id="fUpc" inputmode="numeric" placeholder="00123456…"></div>
          </div>
          <div class="two fields-row">
            <div class="field"><span>${$t('Category')}</span><input id="fCat" placeholder="${$t('Cables')}" value="General"></div>
            <div class="field"><span>${esc($t('Retail ({symbol})', { symbol: currencySymbol() }))}</span><input id="fPrice" type="number" inputmode="decimal" min="0" step="0.01" value="0"></div>
          </div>
          <div class="two fields-row">
            <div class="field"><span>${esc($t('Cost ({symbol})', { symbol: currencySymbol() }))}</span><input id="fCost" type="number" inputmode="decimal" min="0" step="0.01" value="0"></div>
            <div class="field"><span>${$t('Type')}</span>
              <select id="fType">
                <option value="product">${$t('Product')}</option>
                <option value="service">${$t('Service / labor')}</option>
              </select>
            </div>
          </div>
          <div id="stockFields">
            <label class="check"><input id="fSerial" type="checkbox"> ${$t('Serialized (IMEI-tracked)')}</label>
            <div class="field"><span>${$t('Starting qty')}</span><input id="fQty" type="number" inputmode="numeric" min="0" step="1" value="0"></div>
            <div class="field"><span>${$t('Reorder at (low-stock alert threshold)')}</span><input id="fReorder" type="number" inputmode="numeric" min="0" step="1" value="5"></div>
          </div>
          <label class="check"><input id="fLocked" type="checkbox"> ${$t('Locked (cannot be sold until unlocked)')}</label>
          <label class="check"><input id="fTaxable" type="checkbox" checked> ${$t('Taxable (subject to store sales tax)')}</label>
          <p id="pErr" class="login-err"></p>
          <div class="row"><button class="btn btn-ghost" data-cancel>${$t('Cancel')}</button><button class="btn" id="pSave">${$t('Save')}</button></div>
        </div>`);
      const fType = modal.querySelector('#fType');
      const stockEl = modal.querySelector('#stockFields');
      const toggleFields = () => { stockEl.style.display = fType.value === 'service' ? 'none' : ''; };
      fType.addEventListener('change', toggleFields);
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('#pSave').addEventListener('click', async () => {
        const isService = fType.value === 'service';
        const body = {
          name: modal.querySelector('#fName').value.trim(),
          sku: modal.querySelector('#fSku').value.trim(),
          upc: modal.querySelector('#fUpc').value.trim(),
          category: modal.querySelector('#fCat').value.trim() || 'General',
          retailPrice: parseFloat(modal.querySelector('#fPrice').value) || 0,
          costPrice: parseFloat(modal.querySelector('#fCost').value) || 0,
          itemType: fType.value,
          isSerialized: !isService && modal.querySelector('#fSerial').checked,
          onHand: isService ? 0 : (parseInt(modal.querySelector('#fQty').value, 10) || 0),
          reorderPoint: isService ? null : (parseInt(modal.querySelector('#fReorder').value, 10) || 5),
          locked: modal.querySelector('#fLocked').checked,
          taxable: modal.querySelector('#fTaxable').checked,
        };
        if (!body.name) { modal.querySelector('#pErr').textContent = $t('Name is required.'); return; }
        try {
          await api.post('/api/admin/products', body);
          await pull();
          await screen.refreshProducts();
          renderList();
          closeModal();
          toast($t('Item created'), 'ok'); beep('ok');
        } catch (err) {
          modal.querySelector('#pErr').textContent = (err && err.message) || $t('Could not save');
        }
      });
    }

    function stockModal(listEl, productId) {
      const p = screen._products.find((x) => x.id === productId);
      if (!p) return;
      const modal = openModal(`
        <div class="form-modal">
          <h3>${$t('Stock level')}</h3>
          <p class="muted">${esc(p.name)}</p>
          <div class="field"><span>${$t('On hand')}</span><input id="sQty" type="number" inputmode="numeric" min="0" step="1" value="${p.onHand || 0}"></div>
          <div class="field"><span>${$t('Reason')}</span><input id="sReason" type="text" maxlength="200" autocomplete="off" placeholder="${esc($t('e.g. damaged, found in back room'))}"></div>
          <p class="muted">${$t('Every change is recorded in the audit log with who made it.')}</p>
          <p id="sErr" class="login-err"></p>
          <div class="row"><button class="btn btn-ghost" data-cancel>${$t('Cancel')}</button><button class="btn" id="sSave">${$t('Save count')}</button></div>
        </div>`);
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('#sSave').addEventListener('click', async () => {
        const v = parseInt(modal.querySelector('#sQty').value, 10);
        if (isNaN(v) || v < 0) { modal.querySelector('#sErr').textContent = $t('Enter a whole number ≥ 0.'); return; }
        const reason = modal.querySelector('#sReason').value.trim();
        if (v !== Number(p.onHand || 0) && !reason) { modal.querySelector('#sErr').textContent = $t('Say why the count changed.'); return; }
        try {
          await api.post('/api/admin/inventory', { productId, onHand: v, reason });
          await pull();
          await screen.refreshProducts();
          renderList();
          closeModal();
          toast($t('Stock updated'), 'ok'); beep('ok');
        } catch (err) { modal.querySelector('#sErr').textContent = (err && err.message) || $t('Could not save'); }
      });
    }

    function serialsModal(productId) {
      const p = screen._products.find((x) => x.id === productId);
      if (!p) return;
      const used = (p.serials || []).length;
      const modal = openModal(`
        <div class="form-modal">
          <h3>${$t('Add serials / IMEIs')}</h3>
          <p class="muted">${esc(p.name)} · ${esc($t('{n} in stock', { n: used }))}</p>
          <div class="field"><span>${$t('Serials (one per line)')}</span>
            <textarea id="sList" rows="6" placeholder="${$t('IMEI/SN per line…')}"></textarea>
          </div>
          <p id="sErr" class="login-err"></p>
          <div class="row"><button class="btn btn-ghost" data-cancel>${$t('Cancel')}</button><button class="btn" id="sSave">${$t('Add')}</button></div>
        </div>`);
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('#sSave').addEventListener('click', async () => {
        const serialNumbers = modal.querySelector('#sList').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (!serialNumbers.length) { modal.querySelector('#sErr').textContent = $t('Paste at least one serial.'); return; }
        try {
          const res = await api.post('/api/admin/serials', { productId, serialNumbers });
          await pull();
          await screen.refreshProducts();
          renderList();
          closeModal();
          toast(`${$tn('Added {n} serial', 'Added {n} serials', res.added.length)}${res.duplicates.length ? ', ' + $tn('{n} duplicate skipped', '{n} duplicates skipped', res.duplicates.length) : ''}`, 'ok');
        } catch (err) { modal.querySelector('#sErr').textContent = (err && err.message) || $t('Could not save'); }
      });
    }

    function priceHistoryModal(productId) {
      const p = screen._products.find((x) => x.id === productId);
      if (!p) return;
      let history = [];
      const modal = openModal(`
        <div class="form-modal inv-history">
          <h3>${$t('Price history')}</h3>
          <p class="muted">${esc(p.name)}</p>
          <div id="phBody" class="ph-body"><p class="empty">${$t('Loading…')}</p></div>
          <div class="row"><button class="btn btn-ghost" data-close>${$t('Close')}</button></div>
        </div>`);
      modal.querySelector('[data-close]').addEventListener('click', closeModal);
      (async () => {
        const body = modal.querySelector('#phBody');
        try {
          const res = await api.get('/api/price-history?productId=' + encodeURIComponent(productId));
          history = res.history || [];
          body.innerHTML = history.length
            ? history.map((h) => `
                <div class="ph-row">
                  <div class="ph-top">
                    <span class="k-chip ${h.source === 'po' ? 'k-payout' : h.source === 'create' ? 'k-sale' : h.source === 'bulk' ? 'k-disc' : 'k-refund'}">${esc(sourceLabel(h.source))}</span>
                    <span class="muted">${esc(dt(h.createdAt))}</span>
                    <span class="muted">${esc(h.changedBy || '—')}${h.poNumber ? ` · ${esc(h.poNumber)}` : ''}</span>
                  </div>
                  <div class="ph-chg">
                    <span>${esc(fieldLabel(h.field))}</span>
                    <span class="ph-old">${fmt(h.oldValue)}</span> ${arrow()}
                    <strong>${fmt(h.newValue)}</strong>
                  </div>
                </div>`).join('')
            : `<p class="empty">${$t('No price changes recorded.')}</p>`;
        } catch (_) {
          body.innerHTML = `<p class="empty">${$t('Failed to load — check connection.')}</p>`;
        }
      })();

      function sourceLabel(s) {
        if (s === 'po') return $t('Purchase order');
        if (s === 'create') return $t('Created');
        if (s === 'bulk') return $t('Bulk update');
        return $t('Manual edit');
      }
      function fieldLabel(f) {
        return f === 'retail_price' ? $t('Retail price') : $t('Cost price');
      }
      function dt(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return isNaN(d) ? iso : d.toLocaleString(dateLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      }
    }

    function agingModal() {
      const modal = openModal(`
        <div class="form-modal inv-history">
          <h3>${$t('Inventory aging')}</h3>
          <p class="muted">${$t('How long on-hand stock has been sitting, valued at cost')}</p>
          <div id="agBody" class="ph-body"><p class="empty">${$t('Loading…')}</p></div>
          <div class="row"><button class="btn btn-ghost" data-close>${$t('Close')}</button></div>
        </div>`);
      modal.querySelector('[data-close]').addEventListener('click', closeModal);
      (async () => {
        const body = modal.querySelector('#agBody');
        try {
          const res = await api.get('/api/inventory/aging');
          const s = res.summary || {};
          const chips = [
            ['current', $t('0–30d'), s.current],
            ['d30', $t('31–60d'), s.d30],
            ['d60', $t('61–90d'), s.d60],
            ['d90', $t('90d+'), s.d90],
          ];
          const tot = (s.current && s.current.value || 0) + (s.d30 && s.d30.value || 0) + (s.d60 && s.d60.value || 0) + (s.d90 && s.d90.value || 0);
          const chipCls = { current: 'age0', d30: 'age30', d60: 'age60', d90: 'age90' };
          body.innerHTML = `
            <div class="ag-summary">
              ${chips.map(([k, label, b]) => `<span class="age ${chipCls[k]}">${esc($t('{band}: {units} @ {value}', { band: label, units: b ? b.units : 0, value: fmt(b ? b.value : 0) }))}</span>`).join('')}
              <div class="ag-total">${esc($t('Total on hand {amount} at cost', { amount: fmt(tot) }))}</div>
            </div>
            ${(res.items || []).length ? res.items.map((it) => `
              <div class="ph-row">
                <div class="ph-top">
                  <span class="inv-name">${esc(it.name)}</span>
                  <span class="muted">${esc(it.sku || '')} · ${esc(it.category)}</span>
                </div>
                <div class="ph-chg">
                  <span>${esc($t('{n} left · {days} days', { n: it.onHand, days: it.ageDays }))}${it.ageDays >= 90 ? ' 🔴' : it.ageDays >= 60 ? ' 🟠' : it.ageDays >= 30 ? ' 🟡' : ' 🟢'}</span>
                  <strong>${esc($t('{amount} @ cost', { amount: fmt(it.value) }))}</strong>
                </div>
              </div>`).join('')
            : `<p class="empty">${$t('Everything in stock is fresh.')}</p>`}`;
        } catch (_) {
          body.innerHTML = `<p class="empty">${$t('Failed to load — check connection.')}</p>`;
        }
      })();
    }

    function settingsModal(productId) {
      const p = screen._products.find((x) => x.id === productId);
      if (!p) return;
      const isService = p.itemType === 'service';
      const serialized = p.isSerialized;
      const locked = isLocked(p);
      const modal = openModal(`
        <div class="form-modal">
          <h3>${$t('Item settings')}</h3>
          <p class="muted">${esc(p.name)}${isService ? ' · ' + esc($t('service')) : ''}</p>
          <div class="two fields-row">
            <div class="field"><span>${esc($t('Retail ({symbol})', { symbol: currencySymbol() }))}</span><input id="oPrice" type="number" inputmode="decimal" min="0" step="0.01" value="${p.retailPrice || 0}"></div>
            <div class="field"><span>${esc($t('Cost ({symbol})', { symbol: currencySymbol() }))}</span><input id="oCost" type="number" inputmode="decimal" min="0" step="0.01" value="${p.costPrice || 0}"></div>
          </div>
          ${!isService && !serialized
            ? `<div class="field"><span>${$t('Reorder at (low-stock alert threshold)')}</span><input id="oReorder" type="number" inputmode="numeric" min="0" step="1" value="${(p.reorderPoint != null && p.reorderPoint !== '') ? p.reorderPoint : 5}"></div>`
            : ''}
          ${!isService ? `<label class="check"><input id="oLocked" type="checkbox" ${locked ? 'checked' : ''}> ${$t('Locked (cannot be sold)')}</label>` : ''}
          ${!isService ? `<label class="check"><input id="oTaxable" type="checkbox" ${p.taxable !== false ? 'checked' : ''}> ${$t('Taxable')}</label>` : ''}
          <p id="oErr" class="login-err"></p>
          <div class="row"><button class="btn btn-ghost" data-cancel>${$t('Cancel')}</button><button class="btn" id="oSave">${$t('Save')}</button></div>
        </div>`);
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('#oSave').addEventListener('click', async () => {
        const body = { productId };
        body.retailPrice = parseFloat(modal.querySelector('#oPrice').value) || 0;
        body.costPrice = parseFloat(modal.querySelector('#oCost').value) || 0;
        if (!isService) body.locked = modal.querySelector('#oLocked').checked;
        const taxableEl = modal.querySelector('#oTaxable');
        if (taxableEl) body.taxable = taxableEl.checked;
        const reorderEl = modal.querySelector('#oReorder');
        if (reorderEl) body.reorderPoint = parseInt(reorderEl.value, 10) || 0;
        try {
          await api.post('/api/admin/products/patch', body);
          await pull();
          await screen.refreshProducts();
          renderList();
          closeModal();
          toast($t('Settings saved'), 'ok'); beep('ok');
        } catch (err) { modal.querySelector('#oErr').textContent = (err && err.message) || $t('Could not save'); }
      });
    }

    renderList();

    const handleSync = () => { screen.refreshProducts().then(renderList); };
    window.addEventListener(SYNC_EVENT, handleSync);

    return () => window.removeEventListener(SYNC_EVENT, handleSync);
  },
};