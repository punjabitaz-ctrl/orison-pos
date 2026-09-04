'use strict';

/* Register screen: product catalog + search + barcode scan + cart sheet.
   Serialized (IMEI) items go through a capture dialog, one serial per unit. */

import { idb } from '../db.js';
import {
  fmt, esc, toast, beep, debounce, scanFromCamera, hasBarcodeDetector,
  openModal, closeModal, openSheet,
} from '../ui.js';
import { SYNC_EVENT, getSyncState } from '../sync.js';

function catColor(c) {
  const colors = ['#d97706', '#0ea5e9', '#059669', '#7c3aed', '#e11d48', '#0891b2', '#65a30d', '#c2410c', '#4f46e5', '#0d9488'];
  let n = 0;
  for (let i = 0; i < c.length; i++) n = (n * 31 + c.charCodeAt(i)) >>> 0;
  return colors[n % colors.length];
}

function isLocked(p) {
  return p && (p.locked === true || p.locked === 1 || String(p.locked) === '1');
}

function card(product) {
  const isService = product.itemType === 'service';
  const avail = product.isSerialized ? (product.serials || []).length : (product.onHand || 0);
  const out = !isService && avail <= 0;
  return `
    <button class="prod-card ${out ? 'out' : ''}" data-add="${esc(product.id)}" type="button">
      <div class="prod-cat" style="background:${catColor(product.category)}">${esc(product.category)}</div>
      <h3 class="prod-name">${esc(product.name)}</h3>
      <div class="prod-meta">
        <span class="prod-price">${fmt(product.retailPrice)}</span>
        ${isService
          ? '<span class="prod-stock service-tag">Service</span>'
          : `<span class="prod-stock ${out ? 'stock-out' : ''}">${out ? 'Out' : (product.isSerialized ? avail + ' units' : avail + ' in stock')}</span>`}
      </div>
      ${product.isSerialized ? '<span class="prod-ser-badge">IMEI</span>' : ''}
      ${isLocked(product) ? '<span class="prod-ser-badge lock-badge">Locked</span>' : ''}
    </button>`;
}

export const screen = {
  id: 'register',
  tab: 'register',
  title: 'Register',

  _products: [],

  async refreshProducts() {
    this._products = await idb.getAll('products');
    this._products.sort((a, b) => a.name.localeCompare(b.name));
  },

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const { state, router } = ctx;

    await this.refreshProducts();
    const syncState = await getSyncState();

    root.innerHTML = `
      <header class="scr-head">
        <div class="scr-title">
          <h2>Register</h2>
          <p>${esc(syncState.deviceId ? 'Terminal ' + syncState.deviceId.slice(0, 8).toUpperCase() : '')} · ${esc((state.user && state.user.firstName) || '')}</p>
        </div>
        <div class="scr-status ${navigator.onLine ? 'online' : 'offline'}">
          <span class="dot"></span><span>${navigator.onLine ? 'Online' : 'Offline'}</span>
        </div>
      </header>
      <div class="search-row">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input id="searchInput" type="search" placeholder="Search name, SKU, or scan barcode…"
                 autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
        </div>
        ${hasBarcodeDetector() ? '<button id="camBtn" class="icon-btn" title="Scan with camera">◉</button>' : ''}
      </div>
      <div class="chips" id="chips"></div>
      <main class="grid" id="grid" tabindex="-1"></main>`;

    const searchInput = root.querySelector('#searchInput');
    const grid = root.querySelector('#grid');
    const chips = root.querySelector('#chips');
    const camBtn = root.querySelector('#camBtn');

    let term = '';
    let category = 'All';
    const debouncedSearch = debounce(() => renderGrid(), 120);

    // ---- Category chips ----
    function renderChips() {
      const cats = ['All', ...new Set(screen._products.map((p) => p.category))];
      cats.sort((a, b) => a === 'All' ? -1 : (b === 'All' ? 1 : a.localeCompare(b)));
      chips.innerHTML = cats.map((c) => `<button class="chip ${c === category ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
      chips.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
        category = b.getAttribute('data-cat');
        renderChips();
        renderGrid();
        if (!('ontouchstart' in window)) searchInput.focus();
      }));
    }

    // ---- Grid ----
    function renderGrid() {
      const q = term.trim().toLowerCase();
      const list = screen._products.filter((p) => {
        if (category !== 'All' && p.category !== category) return false;
        if (!q) return true;
        return p.name.toLowerCase().includes(q)
          || (p.sku || '').toLowerCase().includes(q)
          || (p.upc || '').toLowerCase().includes(q)
          || (p.serials || []).join(',').includes(q);
      });
      grid.innerHTML = list.map((p) => card(p)).join('')
        + (list.length ? '' : `<div class="empty"><p>No products match “${esc(term)}”.</p><button class="btn btn-ghost" id="resetSearch">Clear search</button></div>`);
      const reset = grid.querySelector('#resetSearch');
      if (reset) reset.addEventListener('click', () => { term = ''; searchInput.value = ''; renderGrid(); });
      grid.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
        addToCart(screen._products.find((p) => p.id === b.getAttribute('data-add')));
      }));
    }

    searchInput.addEventListener('input', () => { term = searchInput.value; debouncedSearch(); });
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(term); } });
    searchInput.addEventListener('focus', () => searchInput.select());

    if (camBtn) {
      camBtn.addEventListener('click', async () => {
        try {
          const code = await scanFromCamera();
          if (code) { searchInput.value = code; term = code; handleScan(code); }
        } catch (err) { toast(err.message || 'Scan failed', 'warn'); }
      });
    }

    // ---- Serial capture ----
    function openSerialDialog(product, prefill) {
      const modal = openModal(`
        <div class="serial-dialog">
          <h3>Scan IMEI / Serial</h3>
          <p class="muted">${esc(product.name)}</p>
          <div class="serial-avail">${(product.serials || []).length} available</div>
          <div class="field">
            <input id="serialInput" type="text" inputmode="numeric" placeholder="Scan or type serial…"
                   autocomplete="off" autocapitalize="off" autocorrect="off" autocapitalize="none"
                   value="${esc(prefill || '')}">
          </div>
          <div class="row">
            ${hasBarcodeDetector() ? '<button id="serialCam" class="btn btn-ghost">Camera</button>' : ''}
            <button id="serialAdd" class="btn" ${prefill ? '' : 'disabled'}>Add to cart</button>
          </div>
          <p id="serialErr" class="login-err"></p>
        </div>`);
      const input = modal.querySelector('#serialInput');
      const add = modal.querySelector('#serialAdd');
      const errEl = modal.querySelector('#serialErr');
      const update = () => { add.disabled = !input.value.trim(); errEl.textContent = ''; };
      input.addEventListener('input', update);
      input.focus();
      if (prefill) input.select();

      const submit = () => {
        const serial = input.value.trim();
        if (!serial) return;
        const available = (product.serials || []).map((s) => s.trim());
        if (!available.includes(serial)) { errEl.textContent = 'Serial not in stock for this product.'; beep('err'); return; }
        if (inCartSerial(product.id, serial)) { errEl.textContent = 'That serial is already in the cart.'; beep('err'); return; }
        closeModal();
        beep('ok');
        addCartLine(product, serial);
        renderCart();
      };
      add.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      const cam = modal.querySelector('#serialCam');
      if (cam) cam.addEventListener('click', async () => {
        try {
          const code = await scanFromCamera();
          if (code) { input.value = code; update(); submit(); }
        } catch (err) { toast(err.message || 'Scan failed', 'warn'); }
      });
    }

    function inCartSerial(productId, serial) {
      for (const line of state.cart.values()) {
        if (line.product.id === productId && (line.serials || []).includes(serial)) return true;
      }
      return false;
    }

    // ---- Cart ----
    function addToCart(product) {
      if (!product) { toast('Product not found', 'warn'); beep('err'); return; }
      if (isLocked(product)) { toast(`${product.name} is locked — release it in Inventory`, 'warn'); beep('err'); return; }
      if (product.itemType === 'service') { addCartLine(product, null); renderCart(); return; }
      if (product.isSerialized) { openSerialDialog(product, ''); return; }
      if ((product.onHand || 0) <= 0) { toast(`${product.name} is out of stock`, 'warn'); beep('err'); return; }
      addCartLine(product, null);
      renderCart();
    }

    function addCartLine(product, serial) {
      if (product.isSerialized) {
        const key = product.id + '|' + serial;
        state.cart.set(key, { product, qty: 1, serials: [serial], price: product.retailPrice });
        product.serials = (product.serials || []).filter((s) => s !== serial);
      } else {
        const existing = state.cart.get(product.id);
        if (existing) { existing.qty++; existing.price = product.retailPrice; }
        else state.cart.set(product.id, { product, qty: 1, serials: [], price: product.retailPrice });
        if (product.itemType !== 'service') product.onHand = Math.max(0, (product.onHand || 0) - 1);
      }
      state.cartVersion++;
    }

    function cartTotals() {
      let total = 0, count = 0;
      for (const line of state.cart.values()) {
        total += line.price * (line.qty || 1);
        count += line.qty || 1;
      }
      return { total, count };
    }

    function lineRemove(line) {
      if (line.product.isSerialized) {
        for (const s of line.serials) if (!line.product.serials.includes(s)) line.product.serials.push(s);
      } else {
        if (line.product.itemType !== 'service') line.product.onHand = (line.product.onHand || 0) + (line.qty || 1);
      }
    }

    function lineKeyOf(line) {
      for (const [k, v] of state.cart.entries()) if (v === line) return k;
      return null;
    }

    // ---- Cart sheet ----
    function renderCart() {
      const totals = cartTotals();
      const sheet = openSheet(`
        <div class="cart-head">
          <h3>Cart <span class="pill">${totals.count}</span></h3>
          <button class="icon-btn" data-close aria-label="Close">✕</button>
        </div>
        <div class="cart-lines">
          ${[...state.cart.values()].map((line) => {
            const key = esc(lineKeyOf(line) || '');
            return `
            <div class="cart-line">
              <div class="cl-main">
                <div class="cl-name">${esc(line.product.name)}</div>
                ${line.product.isSerialized
                  ? `<div class="cl-serial">${esc((line.serials || []).join(', '))}</div>`
                  : `<div class="cl-qty">
                       <button class="qty-btn" data-min data-key="${key}">−</button>
                       <span class="qty">${line.qty}</span>
                       <button class="qty-btn" data-plus data-key="${key}">+</button>
                     </div>`}
              </div>
              <div class="cl-right">
                <div class="cl-price">${fmt(line.price * line.qty)}</div>
                <button class="cl-remove" data-remove="${key}" aria-label="Remove">✕</button>
              </div>
            </div>`;
          }).join('') || '<p class="empty">Cart is empty — scan or tap products above.</p>'}
        </div>
        <div class="cart-foot">
          <div class="cart-total"><span>Total</span><strong>${fmt(totals.total)}</strong></div>
          <button id="chargeBtn" class="btn btn-block" ${totals.count ? '' : 'disabled'}>Charge · ${fmt(totals.total)}</button>
        </div>`);

      sheet.querySelectorAll('[data-min], [data-plus], [data-remove]').forEach((b) => {
        b.addEventListener('click', () => {
          const line = [...state.cart.values()].find((l) => lineKeyOf(l) === b.dataset.key);
          if (!line) return;
          const isService = line.product.itemType === 'service';
          if (b.hasAttribute('data-min') && line.qty > 1) { line.qty--; if (!isService) line.product.onHand++; }
          if (b.hasAttribute('data-plus') && (isService || (line.product.onHand || 0) > 0)) { line.qty++; if (!isService) line.product.onHand--; }
          if (b.hasAttribute('data-remove')) lineRemove(line);
          state.cartVersion++;
          renderCart();
        });
      });
      sheet.querySelector('#chargeBtn').addEventListener('click', () => {
        document.getElementById('sheet').innerHTML = '';
        router.show('checkout');
      });
      sheet.querySelector('[data-close]').addEventListener('click', () => {
        document.getElementById('sheet').innerHTML = '';
      });
    }

    // ---- Quick add from scan / search ----
    function handleScan(raw) {
      const input = String(raw || '').trim();
      if (!input) { searchInput.focus(); return; }
      const found = screen._products.find((p) =>
        (p.upc && p.upc.trim() === input) || (p.sku && p.sku.trim().toLowerCase() === input.toLowerCase()));
      if (found) {
        beep('ok');
        searchInput.value = ''; term = ''; renderGrid();
        addToCart(found);
        searchInput.focus();
        return;
      }
      const bySerial = screen._products.find((p) => (p.serials || []).includes(input));
      if (bySerial) {
        beep('ok');
        searchInput.value = ''; term = ''; renderGrid();
        openSerialDialog(bySerial, input);
        searchInput.focus();
        return;
      }
      beep('err');
      toast(`No product or serial matches “${input}”`, 'warn');
      searchInput.focus();
    }

    renderChips();
    renderGrid();
    if (!('ontouchstart' in window)) searchInput.focus();

    const handleSync = () => { if (document.getElementById('searchInput')) { this.refreshProducts().then(renderGrid); } };
    window.addEventListener(SYNC_EVENT, handleSync);

    return () => window.removeEventListener(SYNC_EVENT, handleSync);
  },
};