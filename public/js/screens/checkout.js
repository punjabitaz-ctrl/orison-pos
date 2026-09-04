'use strict';

/* Checkout: split-tender (Cash / Store Credit / Net-30), change calc,
   completes the sale offline-first, then offers receipt print/share. */

import { fmt, esc, toast, beep } from '../ui.js';
import { enqueueTransaction, syncNow, getSyncState } from '../sync.js';

const TENDERS = [
  { id: 'cash', label: 'Cash' },
  { id: 'store_credit', label: 'Store Credit' },
  { id: 'net30', label: 'Net-30 Terms' },
];

export const screen = {
  id: 'checkout',
  tab: 'register',
  title: 'Checkout',

  async render(ctx, root) {
    const { state, router } = ctx;
    document.getElementById('tabbar').classList.add('hidden');

    // Freeze the cart into a sale snapshot.
    const sale = {
      items: [...state.cart.values()].map((line) => ({
        productId: line.product.id,
        name: line.product.name,
        isSerialized: line.product.isSerialized,
        serials: line.serials || [],
        serialNumber: line.serials && line.serials.length ? line.serials.join(', ') : null,
        quantity: line.qty || 1,
        unitPrice: line.price,
      })),
    };
    sale.total = sale.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

    if (!sale.items.length) { router.show('register'); return; }

    const tenders = [];
    let type = 'cash';
    let amount = 0;

    function remaining() {
      const tendered = tenders.reduce((s, t) => s + t.amount, 0);
      return Math.max(0, Math.round((sale.total - tendered) * 100) / 100);
    }

    function quickAmounts() {
      const base = Math.ceil(sale.total);
      const out = [];
      for (const round of [base, roundUp(base, 5), roundUp(base, 10), roundUp(base, 20), roundUp(base, 50), roundUp(base, 100)]) {
        if (round > 0 && !out.includes(round)) out.push(round);
      }
      return out;
    }
    function roundUp(v, step) { return Math.ceil(v / step) * step; }

    function render() {
      const rem = remaining();
      const change = amount >= rem && rem > 0 ? Math.round((amount - rem) * 100) / 100 : 0;

      root.innerHTML = `
        <header class="scr-head">
          <div class="scr-title">
            <h2>Charge Sale</h2>
            <p>${esc(state.user && state.user.firstName)} · ${fmt(sale.total)}</p>
          </div>
          <button class="icon-btn" id="backBtn">✕</button>
        </header>

        <div class="checkout">
          <section class="co-items">
            ${sale.items.map((i) => `
              <div class="co-item">
                <div class="co-name">${esc(i.name)} <span class="co-qty">×${i.quantity}</span></div>
                ${i.serialNumber ? `<div class="cl-serial">${esc(i.serialNumber)}</div>` : ''}
                <div class="co-price">${fmt(i.unitPrice * i.quantity)}</div>
              </div>`).join('')}
            <div class="co-total"><span>Total due</span><strong>${fmt(sale.total)}</strong></div>
          </section>

          <section class="co-tenders">
            <h3>Tenders</h3>
            <div class="co-tender-list">
              ${tenders.length ? tenders.map((t) => `
                <div class="co-tender">
                  <span>${esc(t.label)}</span>
                  <span class="co-tender-amount">${fmt(t.amount)}</span>
                  <button class="cl-remove" data-del="${t.idx}">✕</button>
                </div>`).join('') : '<p class="muted">No tenders yet — add cash, store credit, or terms below.</p>'}
            </div>
            <div class="co-remain">${rem <= 0
              ? `<span class="ok">Fully covered</span><strong>Change due: ${fmt(-1 * Math.round((tenders.reduce((s,t)=>s+t.amount,0)-sale.total)*100)/100)}</strong>`
              : `<span>Remaining</span><strong>${fmt(rem)}</strong>`}</div>
          </section>

          <section class="co-input">
            <div class="seg">
              ${TENDERS.map((t) => `<button class="seg-btn ${t.id === type ? 'on' : ''}" data-type="${t.id}">${t.label}</button>`).join('')}
            </div>

            <div class="tender-amount-display">
              <span>${scrub()} Tender amount</span>
              <strong class="${change > 0 ? 'has-change' : ''}">${fmt(amount)}</strong>
              ${type === 'cash' && rem > 0 && change > 0 ? `<em>Change: ${fmt(change)}</em>` : ''}
            </div>

            <div class="quicks">
              ${quickAmounts().map((v) => `<button class="quick" data-q="${v}">${fmt(v)}</button>`).join('')}
            </div>

            <div class="keypad">
              ${[1,2,3,4,5,6,7,8,9,'⌫',0,'C'].map((k) => `<button class="kp" data-k="${k}">${k}</button>`).join('')}
            </div>

            <button id="addTender" class="btn btn-block" ${amount > 0 || type !== 'cash' ? '' : 'disabled'}>
              + Add ${esc(typeLabel())}
            </button>
            <button id="completeBtn" class="btn btn-block btn-primary btn-xl" ${rem <= 0 && tenders.length ? '' : 'disabled'}>
              Complete Sale · ${fmt(sale.total)}
            </button>
          </section>
        </div>`;

      function scrub() {
        return TENDERS.find((t) => t.id === type).label;
      }
      function typeLabel() {
        const t = TENDERS.find((t) => t.id === type);
        return t ? t.label : '';
      }

      root.querySelector('[data-close], #backBtn').addEventListener('click', () => {
        if (tenders.length) {
          if (!window.confirm('Abandon this charge and return to register?')) return;
        }
        router.show('register');
      });

      root.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
        type = b.dataset.type;
        render();
      }));

      root.querySelectorAll('.quick').forEach((b) => b.addEventListener('click', () => {
        amount = Math.round(parseFloat(b.dataset.q) * 100) / 100;
        render();
      }));

      root.querySelector('.keypad').addEventListener('click', (e) => {
        const k = e.target.getAttribute && e.target.getAttribute('data-k');
        if (!k) return;
        if (k === 'C') amount = 0;
        else if (k === '⌫') amount = Math.floor(amount / 10 * 100) / 100;
        else amount = Math.round(amount * 100 * 10 + parseFloat(k) * 100) / 100;
        render();
      });

      root.querySelector('#addTender').addEventListener('click', () => {
        const t = TENDERS.find((x) => x.id === type);
        const add = type === 'net30' ? remaining() : amount;
        if (add <= 0 && type !== 'net30') { toast('Enter an amount first', 'warn'); return; }
        if (type === 'net30' && add <= 0) { toast('Nothing left to put on terms', 'warn'); return; }
        tenders.push({ type: t.id, label: t.label, amount: Math.round(add * 100) / 100, idx: tenders.length });
        amount = 0;
        render();
      });

      root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
        const idx = parseInt(b.dataset.del, 10);
        tenders.splice(idx, 1);
        render();
      }));

      root.querySelector('#completeBtn').addEventListener('click', completeSale);
    }

    async function completeSale() {
      if (remaining() > 0) { toast('Not fully covered', 'warn'); return; }
      const tendered = tenders.filter((t) => t.amount > 0);
      const txItems = sale.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        serialNumber: i.isSerialized && i.serials && i.serials.length === 1 ? i.serials[0] : null,
      }));
      const cleanTenders = tendered.map((t) => ({ type: t.type, amount: t.amount, label: t.label }));

      beep('ok');
      const clientTxId = await enqueueTransaction({
        userId: state.user.id,
        cashier: `${state.user.firstName} ${state.user.lastName || ''}`,
        grandTotal: sale.total,
        tenders: cleanTenders,
        items: txItems,
      });

      // Fire-and-forget push; safe offline.
      syncNow().catch(() => {});

      // Clear cart for the next sale.
      state.cart = new Map();
      state.cartVersion++;

      showReceipt(clientTxId);
    }

    function showReceipt(clientTxId) {
      const cashier = `${state.user.firstName} ${(state.user.lastName || '').trim()}`.trim();
      root.innerHTML = `
        <div class="receipt-wrap">
          <div class="receipt-actions">
            <button class="btn btn-ghost" id="printBtn">Print / PDF</button>
            <button class="btn btn-ghost" id="shareBtn">Share</button>
            <button class="btn" id="doneBtn">New Sale</button>
          </div>
          <div id="printRoot" class="print-root"></div>
        </div>`;
      renderReceiptDoc(cashier, clientTxId);

      root.querySelector('#doneBtn').addEventListener('click', () => router.show('register'));
      root.querySelector('#printBtn').addEventListener('click', () => {
        document.body.classList.add('printing');
        requestAnimationFrame(() => { window.print(); setTimeout(() => document.body.classList.remove('printing'), 500); });
      });
      root.querySelector('#shareBtn').addEventListener('click', async () => {
        const text = receiptText(cashier, clientTxId);
        if (navigator.share) {
          try { await navigator.share({ title: 'Orison POS — Receipt', text }); } catch (_) {}
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          toast('Receipt copied to clipboard', 'ok');
        }
      });
    }

    function receiptHtml(cashier, clientTxId) {
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const lines = sale.items.map((i) => ({
        name: i.serialNumber ? `${i.name} [${i.serialNumber}]` : i.name,
        amt: i.unitPrice * i.quantity,
        qty: i.quantity > 1 ? `${i.quantity} × ${fmt(i.unitPrice)}` : '',
      }));
      return `
        <div class="receipt">
          <h1>ORISON ELECTRONICS</h1>
          <p class="r-store">${esc((state.store && state.store.name) || '')}</p>
          <p class="r-mid">${dateStr} ${timeStr}</p>
          <p class="r-mid">Cashier: ${esc(cashier)}</p>
          <div class="r-rule"></div>
          ${lines.map((l) => `<div class="r-line"><span>${esc(l.name)}${l.qty ? ` <em>${esc(l.qty)}</em>` : ''}</span><b>${fmt(l.amt)}</b></div>`).join('')}
          <div class="r-rule"></div>
          <div class="r-line total"><span>Total</span><b>${fmt(sale.total)}</b></div>
          ${tenders.filter((t) => t.amount > 0).map((t) => `
            <div class="r-line"><span>${esc(t.label)}</span><b>${fmt(t.amount)}</b></div>`).join('')}
          <div class="r-line"><span>Change</span><b>${fmt(Math.round((tenders.reduce((s,t)=>s+t.amount,0)-sale.total)*100)/100)}</b></div>
          <div class="r-rule"></div>
          <p class="r-mid">Thank you for shopping at Orison!</p>
          <p class="r-mid small"># ${clientTxId}</p>
        </div>`;
    }

    function receiptText(cashier, clientTxId) {
      const el = document.createElement('div');
      el.innerHTML = receiptHtml(cashier, clientTxId);
      return (el.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    }

    function renderReceiptDoc(cashier, clientTxId) {
      const dst = root.querySelector('#printRoot');
      dst.innerHTML = receiptHtml(cashier, clientTxId);
    }

    // Grab store info for the receipt.
    state.store = state.store || {};
    import('../db.js').then(({ idb }) => idb.get('meta', 'config')).then((m) => {
      if (m && m.store) { state.store = m.store; }
    });

    render();
  },
};