'use strict';

/* Register screen: product catalog + search + barcode scan + cart sheet.
   Serialized (IMEI) items go through a capture dialog, one serial per unit. */

import { idb } from '../db.js';
import {
  fmt, esc, toast, beep, debounce, scanFromCamera, hasBarcodeDetector,
  openModal, closeModal, openSheet,
} from '../ui.js';
import { SYNC_EVENT, getSyncState } from '../sync.js';
import { saleTotals } from '../money.js';
import { productTile, categoryChip, cartBar, screenHead } from '../components.js';
import {
  lineKey, availableFor, freeSerials, isSerialFree, persist, persistNow,
  loadSaved, clearSaved, fromRecords, savedSummary,
} from '../cart.js';
import { publishCart } from '../customer-display.js';


function isLocked(p) {
  return p && (p.locked === true || p.locked === 1 || String(p.locked) === '1');
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
      <div class="reg-wrap">
        <div class="reg-catalog">
      ${screenHead({
        title: 'Register',
        sub: `${syncState.deviceId ? 'Terminal ' + syncState.deviceId.slice(0, 8).toUpperCase() : ''} · ${(state.user && state.user.firstName) || ''}`,
      })}
      <div class="search-row">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input id="searchInput" type="search" placeholder="Search name, SKU, or scan barcode…"
                 autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
        </div>
        ${hasBarcodeDetector() ? '<button id="camBtn" class="icon-btn" title="Scan with camera">◉</button>' : ''}
      </div>
      <div class="chips" id="chips"></div>
      <main class="grid" id="grid" tabindex="-1"></main>
        </div>
        <aside class="reg-cart" id="regCartPanel" aria-label="Cart"></aside>
      </div>`;

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
      chips.innerHTML = cats.map((c) => categoryChip({ label: c, active: c === category })).join('');
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
      grid.innerHTML = list.map((p) => productTile(p, { fmt, available: availableFor(p, state.cart) })).join('')
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
          <div class="serial-avail">${freeSerials(product, state.cart).length} available</div>
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
        if (!(product.serials || []).map((x) => String(x).trim()).includes(serial)) {
          errEl.textContent = 'Serial not in stock for this product.'; beep('err'); return;
        }
        if (!isSerialFree(product, state.cart, serial)) {
          errEl.textContent = 'That serial is already in the cart.'; beep('err'); return;
        }
        closeModal();
        beep('ok');
        addCartLine(product, serial);
        refreshView();
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


    // ---- Cart ----
    /* The shelf figure is derived from the cart, so both have to repaint
       together or the tiles keep showing stock the cart already claimed. */
    function refreshView() {
      renderGrid();
      renderCart();
    }

    function addToCart(product) {
      if (!product) { toast('Product not found', 'warn'); beep('err'); return; }
      if (isLocked(product)) { toast(`${product.name} is locked — release it in Inventory`, 'warn'); beep('err'); return; }
      if (product.itemType === 'service') { addCartLine(product, null); refreshView(); return; }
      if (product.isSerialized) { openSerialDialog(product, ''); return; }
      if (availableFor(product, state.cart) <= 0) { toast(`${product.name} is out of stock`, 'warn'); beep('err'); return; }
      addCartLine(product, null);
      refreshView();
    }

    /* The catalog mirror is never touched. Availability is derived from the
       server figure minus this cart, so a crash loses nothing and a mid-cart
       pull() cannot drift the numbers. */
    function addCartLine(product, serial) {
      if (product.isSerialized) {
        state.cart.set(lineKey(product.id, serial), {
          product, qty: 1, serials: [serial], price: product.retailPrice,
          discountPct: 0, taxable: product.taxable !== false,
        });
      } else {
        const existing = state.cart.get(lineKey(product.id));
        if (existing) { existing.qty++; existing.price = product.retailPrice; }
        else state.cart.set(lineKey(product.id), {
          product, qty: 1, serials: [], price: product.retailPrice,
          discountPct: 0, taxable: product.taxable !== false,
        });
      }
      state.cartVersion++;
      persist(state.cart);
    }

    function cartTotals() {
      const lines = [...state.cart.values()].map((line) => ({
        unitPrice: line.price,
        quantity: line.qty || 1,
        discountPct: line.discountPct || 0,
        taxable: line.taxable !== false,
      }));
      const totals = saleTotals(lines, 0, 0);
      let count = 0;
      for (const line of state.cart.values()) count += line.qty || 1;
      return { total: totals.total, count };
    }


    function lineKeyOf(line) {
      for (const [k, v] of state.cart.entries()) if (v === line) return k;
      return null;
    }

    // ---- Cart sheet ----
    function lineDiscPrice(line) {
      return saleTotals([{ unitPrice: line.price, quantity: line.qty || 1, discountPct: line.discountPct || 0, taxable: true }], 0, 0).total;
    }

    function renderCart() {
      const totals = cartTotals();
      publishCart({
        lines: [...state.cart.values()].map((line) => ({
          name: line.product.name,
          qty: line.qty || 1,
          amount: lineDiscPrice(line),
          discountPct: line.discountPct || 0,
          serial: (line.serials || []).join(', '),
        })),
        total: totals.total,
        count: totals.count,
        store: (state.store && state.store.name) || '',
      });
      const onDesktop = document.getElementById('regCartPanel')
        && document.documentElement.dataset.viewport === 'desktop';
      const markup = `
        <div class="cart-head">
          <h3>Cart <span class="pill">${totals.count}</span></h3>
          ${onDesktop ? '' : '<button class="icon-btn" data-close aria-label="Close">✕</button>'}
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
                <div class="cl-disc">
                  ${[0, 10, 15, 20, 25, 50].map((p) =>
                    `<button class="disc-btn ${line.discountPct === p ? 'on' : ''}" data-disc data-key="${key}" data-p="${p}">${p ? p + '%' : 'Off'}</button>`).join('')}
                </div>
              </div>
              <div class="cl-right">
                <div class="cl-price">${fmt(lineDiscPrice(line))}</div>
                <button class="cl-remove" data-remove="${key}" aria-label="Remove">✕</button>
                ${line.discountPct ? `<div class="cl-price-was"><s>${fmt(line.price * line.qty)}</s></div>` : ''}
              </div>
            </div>`;
          }).join('') || '<p class="empty">Cart is empty — scan or tap products above.</p>'}
        </div>
        <div class="cart-foot">
          <div class="cart-total"><span>Total</span><strong>${fmt(totals.total)}</strong></div>
          <button id="chargeBtn" class="btn btn-block" ${totals.count ? '' : 'disabled'}>Charge · ${fmt(totals.total)}</button>
        </div>`;

      const bar = document.getElementById('cartbar');
      if (onDesktop) {
        document.getElementById('regCartPanel').innerHTML = markup;
        bindCart(document.getElementById('regCartPanel'));
        if (bar) { bar.innerHTML = ''; bar.classList.add('hidden'); }
        return;
      }

      /* Phones and tablets: adding an item updates the pinned bar rather than
         throwing a full sheet over the catalog. The sheet is only re-rendered
         when it is already open. */
      if (bar) {
        bar.innerHTML = cartBar({ count: totals.count, total: totals.total, fmt });
        bar.classList.toggle('hidden', totals.count === 0);
        const open = bar.querySelector('[data-open-cart]');
        if (open) open.addEventListener('click', () => bindCart(openSheet(markup)));
        const charge = bar.querySelector('[data-charge]');
        if (charge) charge.addEventListener('click', goToCheckout);
      }
      const sheetHost = document.getElementById('sheet');
      if (sheetHost && sheetHost.querySelector('.sheet')) {
        if (totals.count === 0) sheetHost.innerHTML = '';
        else bindCart(openSheet(markup));
      }
    }

    function goToCheckout() {
      document.getElementById('sheet').innerHTML = '';
      const panel = document.getElementById('regCartPanel');
      if (panel) panel.innerHTML = '';
      const bar = document.getElementById('cartbar');
      if (bar) { bar.innerHTML = ''; bar.classList.add('hidden'); }
      router.show('checkout');
    }

    function bindCart(rootEl) {
      rootEl.querySelectorAll('[data-min], [data-plus], [data-remove], [data-disc]').forEach((b) => {
        b.addEventListener('click', () => {
          /* the remove button carries its key in data-remove, the rest in
             data-key - reading only data-key left the X dead. */
          const key = b.dataset.key || b.dataset.remove;
          const line = [...state.cart.values()].find((l) => lineKeyOf(l) === key);
          if (!line) return;
          if (b.hasAttribute('data-min') && line.qty > 1) line.qty--;
          if (b.hasAttribute('data-plus') && availableFor(line.product, state.cart) > 0) line.qty++;
          if (b.hasAttribute('data-remove')) state.cart.delete(key);
          if (b.hasAttribute('data-disc')) line.discountPct = Number(b.dataset.p) || 0;
          state.cartVersion++;
          persist(state.cart);
          refreshView();
        });
      });
      rootEl.querySelector('#chargeBtn').addEventListener('click', goToCheckout);
      rootEl.querySelector('[data-close]')?.addEventListener('click', () => {
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
    renderCart();
    offerRecovery();

    /* A part-rung sale that survived the terminal dying. Offer it back rather
       than silently restoring - the cashier may have re-rung it already. */
    async function offerRecovery() {
      if (state.cart.size) return;
      const saved = await loadSaved().catch(() => null);
      if (!saved) return;
      const sum = savedSummary(saved, fmt);
      const modal = openModal(`
        <div class="form-modal">
          <h3>Recovered a sale in progress</h3>
          <p class="muted">This terminal was interrupted with ${esc(sum.text)} in the cart.</p>
          <div class="row">
            <button class="btn btn-ghost" id="recDiscard">Discard</button>
            <button class="btn" id="recResume">Resume sale</button>
          </div>
        </div>`);
      modal.querySelector('#recResume').addEventListener('click', async () => {
        state.cart = fromRecords(saved.lines, screen._products);
        state.cartVersion++;
        await persistNow(state.cart);
        closeModal();
        refreshView();
        toast('Sale restored', 'ok');
      });
      modal.querySelector('#recDiscard').addEventListener('click', async () => {
        await clearSaved();
        closeModal();
        toast('Cart discarded', 'info');
      });
    }
    if (!('ontouchstart' in window)) searchInput.focus();

    const handleSync = () => { if (document.getElementById('searchInput')) { this.refreshProducts().then(renderGrid); } };
    window.addEventListener(SYNC_EVENT, handleSync);
    const handleViewport = () => renderCart();
    window.addEventListener('orison:viewport', handleViewport);

    return () => {
      window.removeEventListener(SYNC_EVENT, handleSync);
      window.removeEventListener('orison:viewport', handleViewport);
      const bar = document.getElementById('cartbar');
      if (bar) { bar.innerHTML = ''; bar.classList.add('hidden'); }
    };
  },
};