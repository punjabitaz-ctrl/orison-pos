'use strict';

import { $t, $tn, N_, dateLocale } from '../lang.js';

/* History: offline ledger of this device's sales plus server-transactions
   pulled on demand. Each record shows sync state (SYNCED / PENDING / VOIDED),
   its kind (sale / refund / payout), and refundable sales open a refund modal. */

import { idb } from '../db.js';
import { screenHead } from '../components.js';
import { api } from '../api.js';
import { fmt, fmtFor, esc, openModal, closeModal, toast, debounce } from '../ui.js';
import { kindInfo, createRefund, refundGroups, refundTotal } from '../money.js';
import { newClientTxId } from '../sync.js';
import { receiptDoc } from '../receipt-doc.js';
import { receiptContext } from '../receipt-labels.js';
import { docToLines } from '../receipt-render.js';

/* Sync states are stored as codes; these are the words people read. */
const STATUS_LABELS = { SYNCED: N_('Synced'), PENDING: N_('Pending'), VOIDED: N_('Voided'), SERVER: N_('On server') };
const statusLabel = (s) => $t(STATUS_LABELS[s] || N_('Pending'));

/* Tenders from the server may carry only a type. */
const TENDER_NAMES = { cash: N_('Cash'), card: N_('Card'), transfer: N_('Transfer'), store_credit: N_('Store credit'), net30: N_('On account'), account: N_('On account'), deposit: N_('Deposit applied'), marketplace: N_('Marketplace') };

export const screen = {
  id: 'history',
  tab: 'history',
  title: $t('History'),

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const user = (ctx.state && ctx.state.user) || {};

    let serverTxs = [];
    let loaded = false;
    let query = '';
    let matched = 0;
    let nextCursor = null;
    /* A cashier's history is their own sales. "Whole shop" looks up any sale or
       refund by receipt number, IMEI, customer or amount, to check a return or
       a warranty claim (v1.38.0). Managers already see everything. */
    const isManager = user.role === 'admin' || user.role === 'manager';
    let wholeShop = false;
    let lookupNote = '';

    /* The server searches and pages; a terminal never holds the whole ledger.
       `more` appends the next 100 rather than replacing what is on screen. */
    async function loadServer(more) {
      try {
        const qs = ['limit=100'];
        if (query) qs.push('q=' + encodeURIComponent(query));
        lookupNote = '';
        if (wholeShop && !isManager) {
          if (query.length < 4) {
            serverTxs = [];
            matched = 0;
            nextCursor = null;
            loaded = true;
            lookupNote = $t('Type at least four characters to look up a sale');
            render();
            return;
          }
          qs.push('lookup=1');
        }
        if (more && nextCursor) qs.push('cursor=' + encodeURIComponent(nextCursor));
        const res = await api.get('/api/transactions?' + qs.join('&'));
        matched = res.matched == null ? (res.transactions || []).length : res.matched;
        nextCursor = res.nextCursor || null;
        const page = (res.transactions || []).map((t) => ({
          id: 'srv:' + t.id,
          server: true,
          status: 'SERVER',
          kind: t.kind || 'sale',
          originalClientTx: t.originalClientTx,
          counterparty: t.counterparty,
          total: t.grandTotal,
          subtotal: t.subtotal,
          taxAmount: t.taxAmount,
          discountPct: t.discountPct,
          tenders: t.tenders,
          cashier: t.cashier,
          createdAt: t.createdAt,
          grossProfit: t.grossProfit,
          customer: t.customer,
          customerTrn: t.customerTrn || '',
          taxInclusive: t.taxInclusive,
          taxRate: t.taxRate,
          items: t.items.map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, discountPct: i.discountPct, serialNumber: i.serialNumber, unitCost: i.unitCost, warrantyDays: i.warrantyDays })),
          clientTxId: t.clientTxId,
          receiptNo: t.receiptNo || '',
          approvedBy: t.approvedBy || '',
          notMine: t.own === false,
        }));
        serverTxs = more ? serverTxs.concat(page) : page;
        loaded = true;
      } catch (_) {
        loaded = false;
      }
      render();
    }

    async function render() {
      const local = await idb.getAll('transactions');
      const all = wholeShop && !isManager ? serverTxs.slice() : mergeById([...local, ...serverTxs]);
      all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

      const stat = {
        synced: local.filter((t) => t.status === 'SYNCED').length,
        pending: local.filter((t) => t.status === 'PENDING').length,
        voided: local.filter((t) => t.status === 'VOIDED').length,
      };

      root.innerHTML = `
        ${screenHead({
          title: $t('History'),
          subHtml: `${esc($t('{local} local · {synced} synced', { local: local.length, synced: stat.synced }))} · <span class="warn-text">${esc($t('{pending} pending · {voided} voided', { pending: stat.pending, voided: stat.voided }))}</span>`,
          actions: `<button class="icon-btn" id="refreshH" aria-label="${$t('Refresh')}">⟳</button>`,
        })}
        <div class="search-row">
          <div class="search-box">
            <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <input id="hxSearch" type="search" placeholder="${$t('Receipt no., customer, item, IMEI or amount…')}"
                   value="${esc(query)}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
          </div>
          ${isManager ? '' : `<label class="check hx-scope"><input id="hxWhole" type="checkbox" ${wholeShop ? 'checked' : ''}> ${$t('Whole shop')}</label>`}
        </div>
        ${lookupNote ? `<p class="muted scr-note">${esc(lookupNote)}</p>` : ''}
        ${query ? `<p class="muted scr-note">${esc($tn('{n} match for “{query}”', '{n} matches for “{query}”', matched, { query }))} · <button class="linklike" id="hxClear">${$t('clear')}</button></p>` : ''}
        <div class="hx-list">
          ${all.length ? all.map((t) => {
            const k = kindInfo(t.kind);
            return `
            <button class="hx-card ${t.status === 'VOIDED' ? 'v' : ''}" data-tx="${esc(t.id)}">
              <div class="hx-left">
                <span class="hx-date">${humanDate(t.createdAt)}</span>
                <span class="hx-cashier">${esc(t.cashier || '—')}</span>
                ${t.notMine ? `<span class="k-chip k-payout">${esc($t('Another till'))}</span>` : ''}
                <span class="hx-status st-${(t.status || 'PENDING').toLowerCase()}">${esc(statusLabel(t.status))}</span>
                ${t.kind && t.kind !== 'sale' ? `<span class="k-chip ${k.cls}">${esc($t(k.label))}</span>` : ''}
              </div>
              <div class="hx-right">
                <strong>${k.sign < 0 ? '−' : ''}${fmt(t.total)}</strong>
                <span class="hx-count">${esc($tn('{n} item', '{n} items', t.items ? t.items.length : 0))}</span>
              </div>
            </button>`;
          }).join('')
            : `<div class="empty"><p>${query ? $t('Nothing matches that search.') : $t('No sales yet.')}</p></div>`}
        </div>
        ${nextCursor ? `<div class="row dash-actions"><button class="btn btn-ghost" id="hxMore">${$t('Load 100 more')}</button></div>` : ''}`;

      root.querySelector('#refreshH').addEventListener('click', () => loadServer(false));

      const search = root.querySelector('#hxSearch');
      if (search) {
        const run = debounce(() => {
          const next = search.value.trim();
          if (next === query) return;
          query = next;
          nextCursor = null;
          loadServer(false);
        }, 350);
        search.addEventListener('input', run);
        search.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          query = search.value.trim();
          nextCursor = null;
          loadServer(false);
        });
        /* typing then re-rendering must not steal the caret away */
        if (query) { search.focus(); search.setSelectionRange(query.length, query.length); }
      }
      const whole = root.querySelector('#hxWhole');
      if (whole) whole.addEventListener('change', () => {
        wholeShop = whole.checked;
        nextCursor = null;
        loadServer(false);
      });
      const clear = root.querySelector('#hxClear');
      if (clear) clear.addEventListener('click', () => { query = ''; nextCursor = null; loadServer(false); });
      const more = root.querySelector('#hxMore');
      if (more) more.addEventListener('click', () => loadServer(true));

      root.querySelectorAll('[data-tx]').forEach((b) => b.addEventListener('click', () => {
        const t = all.find((x) => x.id === b.dataset.tx);
        if (t) openDetail(t);
      }));
    }

    function openDetail(t) {
      const k = kindInfo(t.kind);
      /* Anyone can start a refund; a cashier's needs a manager's approval,
         asked for when they confirm it (v1.37.0). */
      const refundable = (t.kind || 'sale') === 'sale'
        && (t.status === 'SYNCED' || t.status === 'SERVER')
        && (t.items || []).length > 0;
      const lineTotal = (i) => {
        const q = i.quantity || 1;
        const disc = i.discountPct || 0;
        return Math.round(i.unitPrice * q * (1 - disc / 100) * 100) / 100;
      };
      const hasMoney = t.subtotal != null || t.taxAmount != null || Number(t.discountPct || 0) > 0;
      const modalEl = openModal(`
        <div class="tx-detail">
          <button class="icon-btn abs-close" data-x>✕</button>
          <h3>${k.sign < 0 ? '−' : ''}${fmt(t.total)} <span class="k-chip ${k.cls}">${esc($t(k.label))}</span></h3>
          <p class="muted">${esc(humanDate(t.createdAt))} · ${esc(t.cashier || '—')} · ${esc(statusLabel(t.status))}</p>
          ${t.approvedBy ? `<p class="muted">🔑 ${esc($t('Approved by {name}', { name: t.approvedBy }))}</p>` : ''}
          ${t.originalClientTx ? `<p class="muted">${esc($t('refund of {ref}', { ref: t.originalClientTx }))}</p>` : ''}
          ${t.counterparty ? `<p class="muted">${esc(t.counterparty)}</p>` : ''}
          ${t.customer ? `<p class="muted">${esc($t('Customer: {name}', { name: t.customer }))}</p>` : ''}
          ${t.receiptNo ? `<p class="muted mono-no">${esc(t.receiptNo)}</p>` : (t.clientTxId ? `<p class="muted">${esc(t.clientTxId)}</p>` : '')}
          <div class="tx-items">
            ${(t.items || []).map((i) => `
              <div class="tx-item-row">
                <div>
                  <div>${esc(i.name || $t('Item'))} <em>×${i.quantity || 1}</em>
                    ${i.discountPct ? `<span class="k-chip k-disc">${esc($t('{pct}% off', { pct: i.discountPct }))}</span>` : ''}</div>
                  ${i.serialNumber ? `<div class="cl-serial">${esc(i.serialNumber)}</div>` : ''}
                </div>
                <b>${fmt(lineTotal(i))}${i.discountPct ? ` <s class="muted">${fmt((i.unitPrice || 0) * (i.quantity || 1))}</s>` : ''}</b>
              </div>`).join('')}
          </div>
          ${hasMoney ? `
          <div class="co-bd-row"><span>${$t('Subtotal')}</span><b>${fmt(t.subtotal != null ? t.subtotal : t.total)}</b></div>
          <div class="co-bd-row">${(t.discountPct || 0) > 0 ? `<span>${$t('Discount')}</span><b class="neg">−${esc(t.discountPct)}%</b>` : ''}</div>
          <div class="co-bd-row"><span>${$t('Tax')}</span><b>${fmt(t.taxAmount || 0)}</b></div>
          ${t.grossProfit != null ? `<div class="co-bd-row"><span>${$t('Gross profit')}</span><b class="gp">${fmt(t.grossProfit)}</b></div>` : ''}`
            : ''}
          <div class="tx-tenders">
            ${(t.tenders || []).map((td) => `<div class="hx-tender"><span>${esc($t(TENDER_NAMES[td.type] || td.label || td.type))}</span><b>${fmt(td.amount)}</b></div>`).join('')}
          </div>
          ${(t.kind || 'sale') === 'sale' ? `<button class="btn btn-ghost" id="printTxBtn">${$t('Print receipt')}</button>` : ''}
          ${refundable ? `<button class="btn" id="refundBtn" style="--bg:#c62828">${$t('Refund items')}</button>` : ''}
          <div id="txSend" class="receipt-send-host"></div>
        </div>`);
      modalEl.querySelector('[data-x]').addEventListener('click', closeModal);

      const printTxBtn = modalEl.querySelector('#printTxBtn');
      if (printTxBtn) printTxBtn.addEventListener('click', () => reprint(t));
      const refundBtn = modalEl.querySelector('#refundBtn');
      if (refundBtn) refundBtn.addEventListener('click', () => openRefundModal(t));

      if ((t.kind || 'sale') === 'sale') {
        import('../receipt-send.js').then(({ mountSendButtons }) => {
          const host = modalEl.querySelector('#txSend');
          if (!host) return;
          mountSendButtons(host, {
            lines: docToLines(txDoc(t), fmtFor(txDoc(t).dir)),
            title: $t('Orison POS — Receipt'),
            filename: 'orison-receipt-' + (t.receiptNo || t.clientTxId || t.id),
          });
        });
      }
    }

    async function openRefundModal(t) {
      /* Services provided are not refunded. The picker still lists them so the
         customer can see the whole sale, but they cannot be selected. */
      const productsById = {};
      for (const p of (await idb.getAll('products')) || []) productsById[String(p.id)] = p;
      const saleTotal = Number(t.total != null ? t.total : t.grandTotal) || 0;
      const groups = refundGroups(t.items || [], productsById, { discountPct: t.discountPct, total: saleTotal });
      const anyRefundable = groups.some((g) => g.refundable);
      const pickedSerial = new Set();
      let method = 'cash';

      const sel = {};

      const modalEl = openModal(`
        <div class="tx-detail refund-modal">
          <button class="icon-btn abs-close" data-x>✕</button>
          <h3>${$t('Refund')}</h3>
          <p class="muted">${esc(humanDate(t.createdAt))} · ${esc(t.receiptNo || t.clientTxId || t.id)}</p>
          <div class="refund-lines">
            ${anyRefundable ? '' : `<p class="muted">${$t('Everything on this sale is a service, and services are not refunded.')}</p>`}
            ${groups.map((g, gi) => `
              ${!g.refundable ? `
                <div class="rf-group rf-locked">
                  <div>${esc(g.name)} <em>×${fmt(g.unitPrice)}</em></div>
                  <span class="muted">${$t('Service — not refundable')}</span>
                </div>` : g.serialized ? `
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
            <label class="rf-radio"><input type="radio" name="rf-method" value="cash" ${method === 'cash' ? 'checked' : ''}><span>${$t('Cash')}</span></label>
            <label class="rf-radio"><input type="radio" name="rf-method" value="store_credit" ${method === 'store_credit' ? 'checked' : ''}><span>${$t('Store credit')}</span></label>
          </div>
          <input class="field" id="rf-note" placeholder="${$t('Reason (optional)')}">
          <div class="rf-total"><span>${$t('Refund total')}</span><b id="rf-total">${fmt(0)}</b></div>
          <button class="btn" id="rf-confirm" disabled style="--bg:#c62828">${$t('Confirm refund')}</button>
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
          if (!g.refundable) return;
          if (g.serialized) {
            for (const sn of g.serials) if (pickedSerial.has(sn)) items.push({ productId: g.productId, name: g.name, quantity: 1, unitPrice: g.unitPrice, serialNumber: sn });
          } else if (g.qtySel > 0) {
            items.push({ productId: g.productId, name: g.name, quantity: g.qtySel, unitPrice: g.unitPrice });
          }
        });
        if (!items.length) return;
        confirm.disabled = true;
        const clientTxId = newClientTxId();
        let approval;
        if (user.role !== 'admin' && user.role !== 'manager') {
          const { requestApproval } = await import('../approval-dialog.js');
          const amount = Math.min(saleTotal, Math.round(items.reduce((s, it) => s + (it.unitPrice || 0) * (it.quantity || 1), 0) * 100) / 100);
          const granted = await requestApproval({
            action: 'refund', ref: clientTxId, amount,
            detail: $t('Refund {amount} on {ref}', { amount: fmt(amount), ref: t.receiptNo || t.clientTxId || t.id }),
            note: modalEl.querySelector('#rf-note').value.trim(),
          });
          if (!granted) { confirm.disabled = false; return; }
          approval = granted.approval;
        }
        try {
          await createRefund({ original: t, items, method, note: modalEl.querySelector('#rf-note').value.trim(), user, clientTxId, approval, cap: saleTotal });
          closeModal();
          toast($t('Refund queued'), 'ok', 1800);
          if (navigator.onLine) loadServer(false); else render();
        } catch (_) {
          confirm.disabled = false;
          toast($t('Refund failed — try again'), 'warn', 2400);
        }
      });

      /* The total used to be computed with a dangling else that bound to the
         serial check, so plain items never counted and Confirm stayed disabled.
         refundTotal() is unit-tested for exactly that case. */
      function updateTotal() {
        const total = refundTotal(groups, pickedSerial, saleTotal);
        modalEl.querySelector('#rf-total').textContent = fmt(total);
        confirm.disabled = Math.round(total * 100) <= 0;
      }
      updateTotal();
    }

    /* A reprint is built from the same model as the original, so it carries
       the receipt number - not the internal transaction id - and names a
       repair deposit as a deposit applied. */
    function txDoc(t) {
      const subtotal = Number(t.subtotal) || Number(t.total) || 0;
      const pct = Number(t.discountPct) || 0;
      return receiptDoc({
        createdAt: t.createdAt,
        cashier: t.cashier,
        customerName: t.customer || '',
        items: t.items || [],
        subtotal,
        discount: Math.round(subtotal * pct) / 100,
        taxAmount: Number(t.taxAmount) || 0,
        taxRate: t.taxRate,
        taxInclusive: t.taxInclusive,
        customerTrn: t.customerTrn || '',
        total: t.total,
        tenders: t.tenders || [],
        receiptNo: t.receiptNo,
        clientTxId: t.clientTxId || t.id,
      }, receiptContext(ctx.state && ctx.state.store));
    }

    async function reprint(t) {
      const pr = await import('../printing.js');
      const r = await pr.printDoc(txDoc(t));
      if (!r.ok) toast(r.message, 'warn', 3600);
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
      return d.toLocaleString(dateLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    await render();
    if (navigator.onLine) loadServer(false);
  },
};