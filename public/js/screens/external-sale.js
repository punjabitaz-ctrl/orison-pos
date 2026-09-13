'use strict';

import { $t, N_ } from '../lang.js';

/* Record a sale that happened somewhere else.

   The shop lists on marketplaces. When something sells there, the stock leaves
   the shelf but nothing here knows, so the counts drift apart and the POS stops
   being the truth about what is in the building. This records that sale in the
   same ledger, against the same stock, tagged with where it happened and the
   order reference it came from.

   It is not a marketplace integration. Somebody still has to type it in. What
   it buys is that when they do, the numbers stay honest. */

import { idb } from '../db.js';
import { fmt, esc, toast, beep, openModal, closeModal } from '../ui.js';
import { enqueueTransaction, pushImmediate } from '../sync.js';
import { saleTotals } from '../money.js';
import { availableFor, freeSerials, isSerialFree } from '../cart.js';

const CHANNELS = [
  { id: 'marketplace', label: N_('Marketplace'), hint: N_('eBay, Amazon, Facebook') },
  { id: 'online', label: N_('Own website'), hint: N_('the shop’s own store') },
  { id: 'phone', label: N_('Phone order'), hint: N_('ordered by phone') },
  { id: 'other', label: N_('Other'), hint: N_('anywhere else') },
];

export function openExternalSaleDialog(ctx, onDone) {
  const { state } = ctx;
  const user = state.user || {};
  let products = [];
  const lines = [];
  let channel = 'marketplace';

  const modal = openModal(`
    <div class="form-modal inv-tool">
      <h3>${$t('Record a sale made elsewhere')}</h3>
      <p class="muted">${$t('Takes the stock off the shelf and puts the sale in the ledger, so the counts here stay true to what is actually in the building.')}</p>

      <div class="field"><span>${$t('Where did it sell?')}</span>
        <div class="seg seg-sm" id="exChannel">
          ${CHANNELS.map((c) => `<button class="seg-btn ${c.id === channel ? 'on' : ''}" data-ch="${esc(c.id)}" title="${esc($t(c.hint))}">${esc($t(c.label))}</button>`).join('')}
        </div>
      </div>

      <div class="two fields-row">
        <div class="field"><span>${$t('Order reference')}</span>
          <input id="exRef" placeholder="${$t('e.g. eBay 12-34567-89012')}" autocomplete="off">
        </div>
        <div class="field"><span>${$t('Date sold')}</span>
          <input id="exDate" type="date" value="${new Date().toISOString().slice(0, 10)}">
        </div>
      </div>

      <div class="field"><span>${$t('Find the item')}</span>
        <input id="exSearch" type="search" placeholder="${$t('Name, SKU or barcode…')}" autocomplete="off" spellcheck="false">
      </div>
      <div id="exMatches" class="cust-results"></div>
      <div id="exLines"></div>
      <p id="exErr" class="login-err"></p>
      <div class="row">
        <button class="btn btn-ghost" data-cancel>${$t('Cancel')}</button>
        <button class="btn" id="exSave" disabled>${$t('Record sale')}</button>
      </div>
    </div>`);

  const search = modal.querySelector('#exSearch');
  const matches = modal.querySelector('#exMatches');
  const linesEl = modal.querySelector('#exLines');
  const save = modal.querySelector('#exSave');
  const err = modal.querySelector('#exErr');

  idb.getAll('products').then((all) => {
    products = (all || []).filter((p) => p.itemType !== 'service');
    products.sort((a, b) => a.name.localeCompare(b.name));
  });

  modal.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => {
    channel = b.dataset.ch;
    modal.querySelectorAll('[data-ch]').forEach((x) => x.classList.toggle('on', x.dataset.ch === channel));
  }));

  /* The cart module already knows how to count what is free, so an external
     sale cannot claim a unit an open till sale is holding. */
  function cartOfLines() {
    const m = new Map();
    lines.forEach((l, i) => m.set(String(i), { product: l.product, qty: l.qty, serials: l.serials }));
    return m;
  }

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { matches.innerHTML = ''; return; }
    const hits = products.filter((p) => p.name.toLowerCase().includes(q)
      || (p.sku || '').toLowerCase().includes(q)
      || (p.upc || '').toLowerCase().includes(q)).slice(0, 8);
    matches.innerHTML = hits.map((p) => `
      <button class="cust-row" data-pick="${esc(p.id)}">
        ${esc(p.name)}<em class="muted">${esc(p.sku || '')} · ${esc($t('{n} free', { n: availableFor(p, cartOfLines()) }))}</em>
      </button>`).join('') || `<p class="muted">${$t('Nothing matches.')}</p>`;
    matches.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      const p = products.find((x) => x.id === b.dataset.pick);
      if (p) addLine(p);
      search.value = '';
      matches.innerHTML = '';
    }));
  });

  function addLine(product) {
    if (availableFor(product, cartOfLines()) <= 0) {
      err.textContent = $t('{name} has none left to sell.', { name: product.name });
      beep('err');
      return;
    }
    err.textContent = '';
    if (product.isSerialized) {
      const free = freeSerials(product, cartOfLines());
      lines.push({ product, qty: 1, serials: [free[0]], price: Number(product.retailPrice) || 0 });
    } else {
      const existing = lines.find((l) => l.product.id === product.id && !l.product.isSerialized);
      if (existing) existing.qty++;
      else lines.push({ product, qty: 1, serials: [], price: Number(product.retailPrice) || 0 });
    }
    renderLines();
  }

  function renderLines() {
    if (!lines.length) {
      linesEl.innerHTML = `<p class="muted">${$t('No items yet — find one above.')}</p>`;
      save.disabled = true;
      return;
    }
    const total = lines.reduce((n, l) => n + (Number(l.price) || 0) * l.qty, 0);
    linesEl.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>${$t('Item')}</th><th class="num">${$t('Qty')}</th><th class="num">${$t('Price each')}</th><th></th></tr></thead>
          <tbody>
            ${lines.map((l, i) => `
              <tr>
                <td>${esc(l.product.name)}${l.serials[0] ? `<br><span class="muted">${esc(l.serials[0])}</span>` : ''}</td>
                <td class="num">${l.product.isSerialized ? 1 : `<input class="field ex-qty" data-i="${i}" type="number" min="1" step="1" value="${l.qty}">`}</td>
                <td class="num"><input class="field ex-price" data-i="${i}" type="number" min="0" step="0.01" value="${l.price}"></td>
                <td><button class="cl-remove" data-drop="${i}" aria-label="${$t('Remove')}">✕</button></td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr><td colspan="2">${lines.length} line${lines.length === 1 ? '' : 's'}</td><td class="num">${fmt(total)}</td><td></td></tr></tfoot>
        </table>
      </div>`;
    save.disabled = false;

    linesEl.querySelectorAll('.ex-qty').forEach((inp) => inp.addEventListener('change', () => {
      const line = lines[Number(inp.dataset.i)];
      const want = Math.max(1, parseInt(inp.value, 10) || 1);
      const others = cartOfLines();
      others.delete(String(inp.dataset.i));
      const free = availableFor(line.product, others);
      line.qty = Math.min(want, free);
      if (line.qty < want) { err.textContent = $t('Only {n} of {name} left.', { n: free, name: line.product.name }); beep('err'); }
      renderLines();
    }));
    linesEl.querySelectorAll('.ex-price').forEach((inp) => inp.addEventListener('change', () => {
      lines[Number(inp.dataset.i)].price = Math.max(0, Number(inp.value) || 0);
      renderLines();
    }));
    linesEl.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', () => {
      lines.splice(Number(b.dataset.drop), 1);
      renderLines();
    }));
  }

  modal.querySelector('[data-cancel]').addEventListener('click', closeModal);

  save.addEventListener('click', async () => {
    if (!lines.length) return;
    const ref = modal.querySelector('#exRef').value.trim();
    const dateStr = modal.querySelector('#exDate').value;
    if (!ref) { err.textContent = $t('An order reference keeps this traceable back to where it sold.'); return; }
    save.disabled = true;

    const totals = saleTotals(
      lines.map((l) => ({ unitPrice: l.price, quantity: l.qty, discountPct: 0, taxable: false })),
      0, 0, false,
    );
    const when = dateStr ? new Date(dateStr + 'T12:00:00').toISOString() : new Date().toISOString();

    try {
      await enqueueTransaction({
        userId: user.id,
        cashier: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        grandTotal: totals.total,
        subtotal: totals.subtotal,
        taxAmount: 0,
        discountPct: 0,
        channel,
        externalRef: ref,
        createdAt: when,
        note: 'Sold via ' + channel + (ref ? ' · ' + ref : ''),
        tenders: [{ type: 'transfer', amount: totals.total, label: 'External' }],
        items: lines.map((l) => ({
          productId: l.product.id,
          quantity: l.qty,
          unitPrice: l.price,
          serialNumber: l.serials[0] || null,
          discountPct: 0,
        })),
      });
      pushImmediate().catch(() => {});
      closeModal();
      toast($t('External sale recorded'), 'ok');
      beep('ok');
      if (onDone) await onDone();
    } catch (e) {
      save.disabled = false;
      err.textContent = (e && e.message) || $t('Could not record the sale');
    }
  });

  renderLines();
  search.focus();
  return modal;
}
