import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentProblem, paymentLabel, PAY_METHODS } from '../public/js/screens/purchases.js';

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
