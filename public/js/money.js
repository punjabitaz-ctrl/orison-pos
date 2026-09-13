'use strict';

import { $t, N_ } from './lang.js';

/* Money flows: refunds and cash payouts. Refunds reverse part or all of a
   completed sale and restore stock locally the moment they are saved (the
   server validates + re-stores the authoritative copy on push). Payouts are
   manager/admin cash-outs with an audit trail. */

import { idb } from './db.js';
import { enqueueTransaction, pushImmediate } from './sync.js';

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function cents(n) {
  return Math.round((Number(n) || 0) * 100 + 0.000000001);
}

export function clampPct(x) {
  var n = Number(x) || 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

export function saleTotals(lines, orderPct, taxRate) {
  var pct = clampPct(orderPct);
  var subC = 0, taxableSubC = 0, discC = 0;
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    var lineC = cents(l.unitPrice) * Math.max(1, l.quantity);
    var ld = Math.round(lineC * clampPct(l.discountPct) / 100);
    var net = lineC - ld;
    discC += ld;
    subC += net;
    if (l.taxable) taxableSubC += net;
  }
  var oC = Math.round(subC * pct / 100);
  var tb = Math.round(taxableSubC * (100 - pct) / 100);
  var t = Math.round(tb * (Number(taxRate) || 0) / 100);
  var grandC = subC - oC + t;
  return {
    subtotal: subC / 100,
    discount: (discC + oC) / 100,
    tax: t / 100,
    total: grandC / 100,
  };
}

/* Labels are marked N_() and translated where they are shown: $t(kindInfo(k).label). */
export function kindInfo(kind) {
  const map = {
    sale: { label: N_('Sale'), cls: 'k-sale', sign: 1 },
    refund: { label: N_('Refund'), cls: 'k-refund', sign: -1 },
    payout: { label: N_('Paid out'), cls: 'k-payout', sign: -1 },
    pickup: { label: N_('Cash pick-up'), cls: 'k-payout', sign: -1 },
    expense: { label: N_('Staff expense'), cls: 'k-payout', sign: -1 },
    payment: { label: N_('Payment'), cls: 'k-sale', sign: 1 },
    deposit: { label: N_('Repair deposit'), cls: 'k-deposit', sign: 1 },
    deposit_refund: { label: N_('Deposit refund'), cls: 'k-payout', sign: -1 },
  };
  return map[kind || 'sale'] || map.sale;
}

/* Undo the server-side refund's stock restoration: a queued + rejected refund
   must re-remove the units we optimistically returned. */
export async function rollbackLocalRefund(items) {
  for (const item of items || []) {
    const prod = await idb.get('products', item.productId);
    if (!prod) continue;
    if (prod.isSerialized) {
      const i = prod.serials.indexOf(item.serialNumber);
      if (i >= 0) prod.serials.splice(i, 1);
    } else if (prod.onHand || prod.onHand === 0) {
      prod.onHand = Math.max(0, prod.onHand - (item.quantity || 1));
    }
    await idb.put('products', prod, prod.id);
  }
}

/* Apply refund to local stock immediately so the mirror reflects returned
   units without waiting for the push round-trip. */
export async function applyLocalRefund(items) {
  for (const item of items || []) {
    const prod = await idb.get('products', item.productId);
    if (!prod) continue;
    if (prod.isSerialized) {
      if (item.serialNumber && !prod.serials.includes(item.serialNumber)) {
        prod.serials.push(item.serialNumber);
      }
    } else {
      prod.onHand = (prod.onHand || 0) + (item.quantity || 1);
    }
    await idb.put('products', prod, prod.id);
  }
}

/* Discount limits (v1.37.0). The deepest discount on any line - its own
   discount and the order discount combined, as the customer sees it - is what
   a limit is measured against. This mirrors effectiveDiscountPct_ in Code.gs. */
export function effectiveDiscountPct(linePct, orderPct) {
  const l = clampPct(linePct) / 100;
  const o = clampPct(orderPct) / 100;
  return Math.round((1 - (1 - l) * (1 - o)) * 10000) / 100;
}

export function deepestDiscountPct(items, orderPct) {
  return (items || []).reduce((m, it) => Math.max(m, effectiveDiscountPct(it.discountPct, orderPct)), 0);
}

export function discountLimit(role, store) {
  if (role === 'admin') return 100;
  const s = store || {};
  const pick = (v, d) => (v == null || v === '' || isNaN(Number(v)) ? d : clampPct(v));
  return role === 'manager' ? pick(s.discountLimitManager, 50) : pick(s.discountLimitCashier, 10);
}

export function needsDiscountApproval(items, orderPct, role, store) {
  return deepestDiscountPct(items, orderPct) > discountLimit(role, store) + 0.001;
}

export async function createRefund({ original, items, method, note, user, clientTxId: presetId, approval, cap }) {
  let grandTotal = round2(items.reduce((s, it) => s + (it.unitPrice || 0) * (it.quantity || 1), 0));
  if (cap != null && Number(cap) >= 0) grandTotal = Math.min(grandTotal, round2(cap));
  await applyLocalRefund(items);
  const clientTxId = await enqueueTransaction({
    clientTxId: presetId,
    approval,
    kind: 'refund',
    originalClientTx: original.clientTxId || original.id,
    grandTotal,
    tenders: [{ type: method, amount: grandTotal }],
    note: note || '',
    items,
    userId: user.id,
    cashier: user.name,
  });
  pushImmediate().catch(() => {});
  return clientTxId;
}

export const CASH_OUT_KINDS = ['payout', 'pickup', 'expense'];

/* The three ways cash leaves the drawer. Identical maths and the same
   admin/manager guard - only the reason differs, which is what makes cash-out
   answerable by reason instead of by reading notes. */
export async function createCashOut({ kind, counterparty, grandTotal, note, user }) {
  const k = CASH_OUT_KINDS.includes(kind) ? kind : 'payout';
  const amount = round2(grandTotal);
  const clientTxId = await enqueueTransaction({
    kind: k,
    counterparty: counterparty || '',
    grandTotal: amount,
    tenders: [{ type: 'cash', amount }],
    note: note || '',
    items: [],
    userId: user.id,
    cashier: user.name,
  });
  pushImmediate().catch(() => {});
  return clientTxId;
}

export async function createPayout({ counterparty, grandTotal, note, user }) {
  const amount = round2(grandTotal);
  const clientTxId = await enqueueTransaction({
    kind: 'payout',
    counterparty: counterparty || '',
    grandTotal: amount,
    tenders: [{ type: 'cash', amount }],
    note: note || '',
    items: [],
    userId: user.id,
    cashier: user.name,
  });
  pushImmediate().catch(() => {});
  return clientTxId;
}

export async function createCollection({ customerId, grandTotal, method, note, user }) {
  const amount = round2(grandTotal);
  const clientTxId = await enqueueTransaction({
    kind: 'payment',
    customerId,
    grandTotal: amount,
    tenders: [{ type: method === 'transfer' ? 'transfer' : 'cash', amount }],
    note: note || '',
    items: [],
    userId: user.id,
    cashier: user.name,
  });
  pushImmediate().catch(() => {});
  return clientTxId;
}
/* ---------- refund lines ---------- */

/* Services provided are not refunded: the work was done. That covers service
   products sold at the register and repair labour, which has no product row. */
export function isServiceLine(item, product) {
  if (item && String(item.productId || '') === 'repair-labour') return true;
  return !!(product && product.itemType === 'service');
}

/* Group a sale's lines for the refund picker. Serialized lines are grouped by
   product with their serials; plain lines sum their quantities. Service lines
   are kept, so the customer can see them, but marked not refundable and never
   pre-selected. */
/* What the customer actually paid for one unit of a line: its price less the
   line and order discounts, with the sale's tax spread in proportion. Refunding
   the shelf price of a discounted sale used to ask for more than the sale took,
   which the server refused. `sale` is optional; without it the line price is
   used as before. */
export function paidUnitPrice(item, sale, allItems) {
  const unit = Number(item.unitPrice) || 0;
  if (!sale) return unit;
  const order = clampPct(sale.discountPct);
  const net = (it) => (Number(it.unitPrice) || 0) * (1 - clampPct(it.discountPct) / 100) * (1 - order / 100);
  const netAll = (allItems || []).reduce((s, it) => s + net(it) * (Number(it.quantity) || 1), 0);
  const total = Number(sale.total);
  const factor = netAll > 0 && total > 0 ? total / netAll : 1;
  return round2(net(item) * factor);
}

export function refundGroups(items, productsById, sale) {
  const byKey = new Map();
  for (const i of items || []) {
    const key = String(i.productId || i.name || 'line') + '|' + clampPct(i.discountPct);
    const product = productsById ? productsById[String(i.productId || '')] : undefined;
    let g = byKey.get(key);
    if (!g) {
      g = {
        productId: i.productId || '',
        name: i.name || $t('Item'),
        unitPrice: paidUnitPrice(i, sale, items),
        serialized: false,
        qty: 0,
        serials: [],
        refundable: !isServiceLine(i, product),
      };
      byKey.set(key, g);
    }
    if (i.serialNumber) { g.serialized = true; g.serials.push(i.serialNumber); }
    else g.qty += Number(i.quantity) || 1;
  }
  const groups = [...byKey.values()];
  for (const g of groups) {
    g.serials = [...new Set(g.serials)];
    g.qtySel = g.serialized || !g.refundable ? 0 : g.qty;
  }
  return groups;
}

export function refundTotal(groups, pickedSerials, cap) {
  let cents = 0;
  for (const g of groups || []) {
    if (!g.refundable) continue;
    if (g.serialized) {
      for (const sn of g.serials) {
        if (pickedSerials && pickedSerials.has(sn)) cents += Math.round(g.unitPrice * 100);
      }
    } else {
      cents += Math.round(g.unitPrice * 100) * (Number(g.qtySel) || 0);
    }
  }
  /* per-unit rounding can add a cent over what the sale took; never ask for more */
  if (cap != null && Number(cap) >= 0) cents = Math.min(cents, Math.round(Number(cap) * 100));
  return cents / 100;
}
