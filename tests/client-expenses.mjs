import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expenseProblem, expensesCsv, EXPENSE_METHODS } from '../public/js/screens/expenses.js';
import { depositProblem } from '../public/js/banking-dialog.js';

test('expenseProblem() - what stops a running cost being recorded', async (t) => {
  const ok = { category: 'rent', amount: 3500, payee: 'Landlord', method: 'bank', reference: 'TRF-1' };
  await t.test('a complete one is fine', () => assert.equal(expenseProblem(ok), ''));
  await t.test('it has to be for something', () => assert.match(expenseProblem({ ...ok, category: '' }), /spent on/));
  await t.test('an amount is required', () => {
    assert.match(expenseProblem({ ...ok, amount: 0 }), /amount/);
    assert.match(expenseProblem({ ...ok, amount: -5 }), /amount/);
  });
  await t.test('somebody has to have been paid', () => assert.match(expenseProblem({ ...ok, payee: '  ' }), /who was paid/));
  await t.test('cash needs no reference, a transfer does', () => {
    assert.equal(expenseProblem({ ...ok, method: 'cash', reference: '' }), '');
    assert.match(expenseProblem({ ...ok, method: 'cheque', reference: '' }), /reference/);
  });
  await t.test('the method must be one the books know', () => {
    assert.match(expenseProblem({ ...ok, method: 'barter' }), /cash, bank transfer or cheque/);
  });
});

test('depositProblem() - the shop cannot bank what it is not carrying', async (t) => {
  await t.test('banking what is in the bag is fine', () => {
    assert.equal(depositProblem({ amount: 100, reference: 'PIS-1', inTransit: 100 }), '');
  });
  await t.test('more than is carried is refused, and says how much there is', () => {
    assert.match(depositProblem({ amount: 101, reference: 'PIS-1', inTransit: 100 }), /100/);
  });
  await t.test('a slip reference is always required', () => {
    assert.match(depositProblem({ amount: 50, reference: '', inTransit: 100 }), /slip|reference/);
  });
  await t.test('an amount is required', () => {
    assert.match(depositProblem({ amount: 0, reference: 'X', inTransit: 100 }), /banked/);
  });
  await t.test('a rounding cent does not block an exact deposit', () => {
    assert.equal(depositProblem({ amount: 33.33, reference: 'X', inTransit: 33.33 }), '');
  });
});

test('expensesCsv() - a spreadsheet the accountant can open', async (t) => {
  const data = {
    total: 3535,
    categories: [{ id: 'rent', label: 'Rent', code: '6300', total: 3500 }, { id: 'transport', label: 'Transport and delivery', code: '6340', total: 35 }],
    expenses: [{ at: '2026-09-24T10:00:00.000Z', categoryLabel: 'Rent', account: '6300', payee: 'Main Street Holdings', method: 'bank', reference: 'TRF-77120', amount: 3500, status: 'COMPLETED', by: 'Sarah', note: 'September' }],
  };
  const csv = expensesCsv(data, { from: '2026-09-01', to: '2026-09-30' });
  await t.test('carries the period, the categories and every row', () => {
    assert.match(csv, /2026-09-01/);
    assert.match(csv, /"Rent","6300","3500"/);
    assert.match(csv, /Main Street Holdings/);
    assert.match(csv, /"6300"/);
  });
  await t.test('a payee that looks like a formula cannot run in a spreadsheet', () => {
    const risky = expensesCsv({ ...data, expenses: [{ ...data.expenses[0], payee: '=cmd|calc' }] }, { from: 'a', to: 'b' });
    assert.ok(!/"=cmd/.test(risky), risky);
    assert.match(risky, /"'=cmd/);
  });
  await t.test('the methods match the server', () => {
    assert.deepEqual(EXPENSE_METHODS.map((m) => m.id).sort(), ['bank', 'cash', 'cheque']);
  });
});
