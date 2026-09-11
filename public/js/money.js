'use strict';

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

export function kindInfo(kind) {
  const map = {
    sale: { label: 'Sale', cls: 'k-sale', sign: 1 },
    refund: { label: 'Refund', cls: 'k-refund', sign: -1 },
    payout: { label: 'Paid out', cls: 'k-payout', sign: -1 },
    pickup: { label: 'Cash pick-up', cls: 'k-payout', sign: -1 },
    expense: { label: 'Staff expense', cls: 'k-payout', sign: -1 },
    payment: { label: 'Payment', cls: 'k-sale', sign: 1 },
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

export async function createRefund({ original, items, method, note, user }) {
  const grandTotal = round2(items.reduce((s, it) => s + (it.unitPrice || 0) * (it.quantity || 1), 0));
  await applyLocalRefund(items);
  const clientTxId = await enqueueTransaction({
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