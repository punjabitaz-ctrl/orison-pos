import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentProblem, paymentLabel, PAY_METHODS, receiptOwed, benchOrderLines } from '../public/js/screens/purchases.js';

test('paymentProblem() - what a supplier payment needs', async (t) => {
  await t.test('a complete bank transfer is fine', () => {
    assert.equal(paymentProblem({ amount: 50, method: 'bank', reference: 'TRF-1', owed: 50 }), '');
  });
  await t.test('cash from the till needs no reference', () => {
    assert.equal(paymentProblem({ amount: 20, method: 'cash', reference: '', owed: 100 }), '');
  });
  await t.test('an amount is required', () => {
    assert.match(paymentProblem({ amount: 0, method: 'cash' }), /amount/);
    assert.match(paymentProblem({ amount: 'x', method: 'cash' }), /amount/);
  });
  await t.test('the method must be one the books know', () => {
    assert.match(paymentProblem({ amount: 5, method: 'card' }), /cash, bank transfer or cheque/);
  });
  await t.test('a transfer or cheque needs its reference', () => {
    assert.match(paymentProblem({ amount: 5, method: 'cheque', reference: '  ' }), /reference/);
  });
  await t.test('no paying more than is owed, to the cent', () => {
    assert.match(paymentProblem({ amount: 50.01, method: 'cash', owed: 50 }), /more than is owed/);
    assert.equal(paymentProblem({ amount: 50, method: 'cash', owed: 50 }), '');
  });
});

test('payment states and methods match the server', () => {
  assert.deepEqual(PAY_METHODS.map((m) => m.id).sort(), ['bank', 'cash', 'cheque']);
  for (const s of ['paid', 'part_paid', 'unpaid', 'prepaid', 'nothing_received']) assert.ok(paymentLabel(s).label, s);
  assert.equal(paymentLabel('nonsense').cls, paymentLabel('unpaid').cls);
});

const discounted = (received = {}) => ({
  subtotal: 500, discountPct: 10, taxAmount: 25,
  lines: [
    { productId: 'case', quantity: 10, unitCost: 10, receivedQty: received.case || 0 },
    { productId: 'phone', quantity: 2, unitCost: 200, receivedQty: received.phone || 0 },
  ],
});

test('receiptOwed() - what this delivery will be owed', async (t) => {
  await t.test('nothing chosen is nothing owed', () => {
    assert.equal(receiptOwed(discounted(), {}).owed, 0);
  });
  await t.test('a delivery carries its share of the order discount and tax', () => {
    const due = receiptOwed(discounted(), { case: 10 });
    assert.deepEqual([due.goods, due.tax, due.owed, due.closes], [90, 5, 95, false]);
  });
  await t.test('the delivery that finishes the order carries the rest', () => {
    const due = receiptOwed(discounted({ case: 10 }), { phone: 2 });
    assert.deepEqual([due.goods, due.tax, due.owed, due.closes], [360, 20, 380, true]);
  });
  await t.test('an order with no discount and no tax is owed its line costs', () => {
    const due = receiptOwed({ subtotal: 100, discountPct: 0, taxAmount: 0,
      lines: [{ productId: 'x', quantity: 10, unitCost: 10, receivedQty: 0 }] }, { x: 4 });
    assert.deepEqual([due.owed, due.tax], [40, 0]);
  });
  await t.test('the last delivery squares the rounding, never a cent over', () => {
    const order = (got) => ({ subtotal: 2.97, discountPct: 50, taxAmount: 0,
      lines: [{ productId: 'h', quantity: 3, unitCost: 0.99, receivedQty: got }] });
    const owed = [0, 1, 2].map((got) => receiptOwed(order(got), { h: 1 }).owed);
    assert.deepEqual(owed, [0.5, 0.49, 0.5]);
    assert.equal(owed.reduce((a, b) => a + b, 0).toFixed(2), '1.49');
  });
  await t.test('more than is outstanding is never counted', () => {
    assert.equal(receiptOwed(discounted({ case: 8 }), { case: 99 }).goods, 18);
  });
});

test('benchOrderLines() - ordering what the bench is short of', async (t) => {
  const board = { parts: [
    { productId: 'scr', shortfall: 2, cost: 40, needed: 2, onHand: 0, onOrder: 0 },
    { productId: 'bat', shortfall: 0, cost: 12, needed: 1, onHand: 1, onOrder: 0 },
    { productId: 'cbl', shortfall: 3, cost: 0, needed: 3, onHand: 0, onOrder: 0 },
  ] };
  await t.test('only the parts nobody can cover are ordered', () => {
    assert.deepEqual(benchOrderLines(board).map((l) => l.productId), ['scr', 'cbl']);
  });
  await t.test('each line asks for the shortfall, at the part cost', () => {
    assert.deepEqual(benchOrderLines(board)[0], { productId: 'scr', quantity: 2, unitCost: 40 });
  });
  await t.test('a part with no cost on file still orders, at zero', () => {
    assert.equal(benchOrderLines(board)[1].unitCost, 0);
  });
  await t.test('an empty or missing board orders nothing', () => {
    assert.deepEqual(benchOrderLines({ parts: [] }), []);
    assert.deepEqual(benchOrderLines(null), []);
  });
});
