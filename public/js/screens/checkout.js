'use strict';

/* Checkout: split-tender (Cash / Store Credit / Net-30), change calc,
   completes the sale offline-first, then offers receipt print/share. */

import { fmt, esc, toast, beep } from '../ui.js';
import { enqueueTransaction, pushImmediate } from '../sync.js';
import { saleTotals, round2 } from '../money.js';
import { api } from '../api.js';
import { publishCheckout, publishThanks, publishIdle } from '../customer-display.js';
import { screenHead } from '../components.js';
import { clearSaved } from '../cart.js';

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
    root.classList.add('screen-checkout');

    // Best-effort store config (tax rate) — refresh asynchronously once we know
    // the checkout's tax may need a saved rate the state snapshot lacks.
    let store = state.store || {};
    (async () => {
      const { idb } = await import('../db.js');
      const m = await idb.get('meta', 'config');
      if (m && m.store && m.store.taxRate != null && m.store.taxRate !== (store.taxRate || 0)) {
        store = m.store;
        sale.totals = computeTotals();
        sale.total = sale.totals.total;
        render();
      }
    })();

    // Freeze the cart into a sale snapshot. Lines carry per-line discount%s
    // picked in the register; the order-level discount% is entered here.
    const sale = {
      items: [...state.cart.values()].map((line) => ({
        productId: line.product.id,
        name: line.product.name,
        isSerialized: line.product.isSerialized,
        serials: line.serials || [],
        serialNumber: line.serials && line.serials.length ? line.serials.join(', ') : null,
        quantity: line.qty || 1,
        unitPrice: line.price,
        discountPct: line.discountPct || 0,
        taxable: line.taxable !== false,
      })),
    };
    sale.orderPct = 0;
    function computeTotals() {
      return saleTotals(
        sale.items.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity, discountPct: i.discountPct, taxable: i.taxable })),
        sale.orderPct,
        store.taxRate || 0,
      );
    }
    sale.totals = computeTotals();
    sale.total = sale.totals.total;

    if (!sale.items.length) { router.show('register'); return; }

    const tenders = [];
    let type = 'cash';
    let amount = 0;
    let customer = null;
    const role = (state.user || {}).role || 'cashier';
    const canManage = role === 'admin' || role === 'manager';

    function remaining() {
      const tendered = tenders.reduce((s, t) => s + t.amount, 0);
      return Math.max(0, round2(sale.total - tendered));
    }

    function guardOrderPct(v) {
      const n = Number(v);
      if (!isFinite(n)) return 0;
      return Math.min(100, Math.max(0, n));
    }
    function setOrderPct(v) {
      sale.orderPct = guardOrderPct(v);
      sale.totals = computeTotals();
      sale.total = sale.totals.total;
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
      const change = amount >= rem && rem > 0 ? round2(amount - rem) : 0;
      const t = sale.totals;
      const lineTotal = (i) => saleTotals([{ unitPrice: i.unitPrice, quantity: i.quantity, discountPct: i.discountPct, taxable: i.taxable }], 0, 0).total;

      /* mirror the shopper-facing figures only: no cost, no margin, no
         customer record, nothing about the till. */
      publishCheckout({
        lines: sale.items.map((i) => ({
          name: i.name,
          qty: i.quantity,
          amount: lineTotal(i),
          discountPct: i.discountPct || 0,
          serial: i.serialNumber || '',
        })),
        subtotal: t.subtotal,
        discount: t.discount,
        tax: t.tax,
        total: sale.total,
        due: rem,
        tendered: tenders.reduce((s, x) => s + x.amount, 0),
        store: (state.store && state.store.name) || '',
      });

      root.innerHTML = `
        ${screenHead({
          title: 'Charge Sale',
          sub: `${(state.user && state.user.firstName) || ''} · ${fmt(sale.total)}`,
          actions: '<button class="icon-btn" id="backBtn" aria-label="Cancel">✕</button>',
        })}

        <div class="checkout">
          <section class="co-cust">
            <h3>Customer <em class="muted">optional</em></h3>
            <div class="co-cust-search">
              <input id="custSearch" class="field" placeholder="Search name, phone, email…" autocomplete="off" aria-label="Search customers">
              <div id="custResults" class="cust-results"></div>
            </div>
            ${customer ? `
            <div class="co-cust-chip">
              <span>${esc(customer.name)}</span>
              <button class="cl-remove" id="custClear" aria-label="Clear customer">✕</button>
            </div>` : ''}
          </section>

          <section class="co-items">
            <details class="co-lines">
              <summary>
                <span>${sale.items.length} item${sale.items.length === 1 ? '' : 's'}</span>
                <b>${fmt(t.subtotal)}</b>
              </summary>
            ${sale.items.map((i) => `
              <div class="co-item">
                <div class="co-name">${esc(i.name)} <span class="co-qty">×${i.quantity}</span>
                  ${i.discountPct ? `<span class="k-chip k-disc">${i.discountPct}% off</span>` : ''}</div>
                ${i.serialNumber ? `<div class="cl-serial">${esc(i.serialNumber)}</div>` : ''}
                <div class="co-price">${fmt(lineTotal(i))}${i.discountPct ? ` <s>${fmt(i.unitPrice * i.quantity)}</s>` : ''}</div>
              </div>`).join('')}
            </details>
            <div class="co-notes">
              <div class="field co-field">
                <span>Order discount %</span>
                <input id="orderDisc" type="number" inputmode="decimal" min="0" max="100" step="0.5" value="${sale.orderPct}" placeholder="0">
              </div>
            </div>
            <div class="co-breakdown">
              <div class="co-bd-row"><span>Subtotal</span><b>${fmt(t.subtotal)}</b></div>
              <div class="co-bd-row">${t.discount > 0 ? `<span>Discount</span><b class="neg">−${fmt(t.discount)}</b>` : '<span>Discount</span><b>0.00</b>'}</div>
              <div class="co-bd-row"><span>Tax${store.taxRate != null ? ` (${store.taxRate}%)` : ''}</span><b>${fmt(t.tax)}</b></div>
              <div class="co-bd-row co-bd-total"><span>Total due</span><strong>${fmt(sale.total)}</strong></div>
            </div>
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
            <div class="co-remain ${rem <= 0 ? 'co-clear' : ''}">${rem <= 0
              ? `<span>Change due</span><strong>${fmt(round2(tenders.reduce((s,t)=>s+t.amount,0)-sale.total))}</strong>`
              : `<span>Amount due</span><strong>${fmt(rem)}</strong>`}</div>
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

            <button id="addTender" class="btn btn-block btn-ghost" ${amount > 0 || type !== 'cash' ? '' : 'disabled'}>
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

      const orderDisc = root.querySelector('#orderDisc');
      if (orderDisc) orderDisc.addEventListener('change', (e) => { setOrderPct(Number(e.target.value)); render(); });

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
        if (type === 'net30' && !customer) { toast('Pick a customer for Net-30 terms', 'warn'); return; }
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

      const custInput = root.querySelector('#custSearch');
      const custResults = root.querySelector('#custResults');
      if (custInput && custResults) {
        let d = null;
        custInput.addEventListener('input', () => {
          clearTimeout(d);
          const q = custInput.value.trim();
          if (!q) { custResults.innerHTML = ''; return; }
          d = setTimeout(async () => {
            let matches = [];
            try { matches = (await api.get('/api/customers?q=' + encodeURIComponent(q))).customers || []; } catch (_) {}
            const rows = matches.map((c) => `
              <button class="cust-row" data-id="${esc(c.id)}" data-name="${esc(c.name)}">
                ${esc(c.name)}<em class="muted">${esc(c.phone || c.email || '')}</em>
              </button>`).join('');
            const create = canManage ? `<button class="cust-row cust-new" data-create="1" data-name="${esc(q)}">＋ New customer: ${esc(q)}</button>` : '';
            custResults.innerHTML = rows + create;
          }, 300);
        });
        custResults.addEventListener('click', async (e) => {
          const btn = e.target.closest('.cust-row');
          if (!btn) return;
          if (btn.dataset.create) {
            try {
              const res = await api.post('/api/admin/customers', { name: btn.dataset.name });
              customer = { id: res.customer.id, name: res.customer.name };
              toast('Customer added', 'ok', 1800);
              render();
            } catch (_) { toast('Could not add customer', 'warn'); }
            return;
          }
          customer = { id: btn.dataset.id, name: btn.dataset.name };
          render();
        });
      }
      const custClear = root.querySelector('#custClear');
      if (custClear) custClear.addEventListener('click', () => { customer = null; render(); });
    }

    async function completeSale() {
      if (remaining() > 0) { toast('Not fully covered', 'warn'); return; }
      if (tenders.some((t) => t.type === 'net30') && !customer) { toast('Pick a customer for Net-30 terms', 'warn'); return; }
      const tendered = tenders.filter((t) => t.amount > 0);
      const txItems = sale.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        serialNumber: i.isSerialized && i.serials && i.serials.length === 1 ? i.serials[0] : null,
        discountPct: i.discountPct || 0,
      }));
      const cleanTenders = tendered.map((t) => ({ type: t.type, amount: t.amount, label: t.label }));

      beep('ok');
      const clientTxId = await enqueueTransaction({
        userId: state.user.id,
        cashier: `${state.user.firstName} ${state.user.lastName || ''}`,
        grandTotal: sale.total,
        discountPct: sale.orderPct,
        subtotal: sale.totals.subtotal,
        taxAmount: sale.totals.tax,
        tenders: cleanTenders,
        items: txItems,
        customerId: customer ? customer.id : undefined,
      });

      // Ship the sale immediately when connected; offline terminals queue it
      // and catch up on the online event / periodic window. When the push lands
      // while the receipt is still on screen, repaint it with the real number.
      pushImmediate()
        .then((res) => {
          const hit = ((res && res.results) || []).find((r) => r.clientTxId === clientTxId);
          if (hit && hit.receiptNo) showReceipt(clientTxId, hit.receiptNo);
        })
        .catch(() => {});

      publishThanks({
        total: sale.total,
        change: round2(tenders.reduce((s, x) => s + x.amount, 0) - sale.total),
        store: (state.store && state.store.name) || '',
      });

      // Clear cart for the next sale. The persisted copy goes with it - the
      // sale is committed, so there is nothing left to recover.
      state.cart = new Map();
      state.cartVersion++;
      await clearSaved().catch(() => {});

      showReceipt(clientTxId, '');
    }

    /* The number is allocated server-side at sync, so an offline sale prints
       its client id and says so. Once the push lands, the receipt is repainted
       with the real number. */
    function showReceipt(clientTxId, receiptNo) {
      const cashier = `${state.user.firstName} ${(state.user.lastName || '').trim()}`.trim();
      root.innerHTML = `
        <div class="receipt-wrap">
          <div class="receipt-actions">
            <button class="btn btn-ghost" id="printBtn">Print</button>
            <button class="btn btn-ghost" id="shareBtn">Share</button>
            <button class="btn" id="doneBtn">New Sale</button>
          </div>
          <div id="printRoot" class="print-root"></div>
          <div id="receiptSend" class="receipt-send-host"></div>
        </div>`;
      renderReceiptDoc(cashier, clientTxId, receiptNo);

      import('../receipt-send.js').then(({ mountSendButtons }) => {
        const sendHost = root.querySelector('#receiptSend');
        if (!sendHost) return;
        mountSendButtons(sendHost, {
          lines: receiptText(cashier, clientTxId).split('\n'),
          title: 'Orison POS — Receipt',
          filename: 'orison-receipt-' + clientTxId,
        });
      });

      root.querySelector('#doneBtn').addEventListener('click', () => router.show('register'));
      root.querySelector('#printBtn').addEventListener('click', () => {
        document.body.classList.add('printing');
        requestAnimationFrame(() => { window.print(); setTimeout(() => document.body.classList.remove('printing'), 500); });
      });
      root.querySelector('#shareBtn').addEventListener('click', async () => {
        const text = receiptText(cashier, clientTxId, receiptNo);
        if (navigator.share) {
          try { await navigator.share({ title: 'Orison POS — Receipt', text }); } catch (_) {}
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          toast('Receipt copied to clipboard', 'ok');
        }
      });
    }

    function receiptHtml(cashier, clientTxId, receiptNo) {
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const lines = sale.items.map((i) => ({
        name: i.serialNumber ? `${i.name} [${i.serialNumber}]` : i.name,
        amt: saleTotals([{ unitPrice: i.unitPrice, quantity: i.quantity, discountPct: i.discountPct, taxable: i.taxable }], 0, 0).total,
        qty: i.quantity > 1 ? `${i.quantity} × ${fmt(i.unitPrice)}` : '',
        disc: i.discountPct ? `${i.discountPct}%` : '',
      }));
      return `
        <div class="receipt">
          <h1>ORISON ELECTRONICS</h1>
          <p class="r-store">${esc((state.store && state.store.name) || '')}</p>
          <p class="r-mid">${dateStr} ${timeStr}</p>
          <p class="r-mid">Cashier: ${esc(cashier)}</p>
          ${customer ? `<p class="r-mid">Customer: ${esc(customer.name)}</p>` : ''}
          <div class="r-rule"></div>
          ${lines.map((l) => `<div class="r-line"><span>${esc(l.name)}${l.qty ? ` <em>${esc(l.qty)}</em>` : ''}${l.disc ? ` <em>${esc(l.disc)} off</em>` : ''}</span><b>${fmt(l.amt)}</b></div>`).join('')}
          <div class="r-rule"></div>
          <div class="r-line"><span>Subtotal</span><b>${fmt(sale.totals.subtotal)}</b></div>
          ${sale.totals.discount > 0 ? `<div class="r-line"><span>Discount</span><b>−${fmt(sale.totals.discount)}</b></div>` : ''}
          ${store.taxRate != null && store.taxRate > 0 ? `<div class="r-line"><span>Tax (${store.taxRate}%)</span><b>${fmt(sale.totals.tax)}</b></div>` : ''}
          <div class="r-line total"><span>Total</span><b>${fmt(sale.total)}</b></div>
          ${tenders.filter((t) => t.amount > 0).map((t) => `
            <div class="r-line"><span>${esc(t.label)}</span><b>${fmt(t.amount)}</b></div>`).join('')}
          <div class="r-line"><span>Change</span><b>${fmt(round2(tenders.reduce((s,t)=>s+t.amount,0)-sale.total))}</b></div>
          <div class="r-rule"></div>
          <p class="r-mid">Thank you for shopping at Orison!</p>
          <p class="r-mid small">${receiptNo ? esc(receiptNo) : '# ' + esc(clientTxId)}</p>
          ${receiptNo ? '' : '<p class="r-mid small">Receipt number pending sync</p>'}
        </div>`;
    }

    function receiptText(cashier, clientTxId, receiptNo) {
      const el = document.createElement('div');
      el.innerHTML = receiptHtml(cashier, clientTxId, receiptNo);
      return (el.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    }

    function renderReceiptDoc(cashier, clientTxId, receiptNo) {
      const dst = root.querySelector('#printRoot');
      dst.innerHTML = receiptHtml(cashier, clientTxId, receiptNo);
    }

    // Grab store info for the receipt.
    state.store = state.store || {};
    import('../db.js').then(({ idb }) => idb.get('meta', 'config')).then((m) => {
      if (m && m.store) { state.store = m.store; }
    });

    render();

    return () => {
      root.classList.remove('screen-checkout');
      if (!state.cart.size) publishIdle((state.store && state.store.name) || '');
    };
  },
};