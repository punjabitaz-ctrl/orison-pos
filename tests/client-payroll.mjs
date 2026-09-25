import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payPeriods, payProblem, runState, runTotal, PAY_METHODS } from '../public/js/screens/payroll.js';

test('payPeriods() - the periods a shop actually pays for', async (t) => {
  const mid = new Date(Date.UTC(2026, 8, 17));

  await t.test('last month is the whole month before, end to end', () => {
    const p = payPeriods(mid).find((x) => x.id === 'lastMonth');
    assert.deepEqual([p.from, p.to], ['2026-08-01', '2026-08-31']);
  });
  await t.test('this month runs from the 1st to today', () => {
    const p = payPeriods(mid).find((x) => x.id === 'thisMonth');
    assert.deepEqual([p.from, p.to], ['2026-09-01', '2026-09-17']);
  });
  await t.test('the last seven days end yesterday, not today', () => {
    const p = payPeriods(mid).find((x) => x.id === 'lastWeek');
    assert.deepEqual([p.from, p.to], ['2026-09-10', '2026-09-16']);
  });
  await t.test('January reaches back into last year', () => {
    const p = payPeriods(new Date(Date.UTC(2027, 0, 9))).find((x) => x.id === 'lastMonth');
    assert.deepEqual([p.from, p.to], ['2026-12-01', '2026-12-31']);
  });
  await t.test('March reads February right, leap year or not', () => {
    assert.equal(payPeriods(new Date(Date.UTC(2028, 2, 5))).find((x) => x.id === 'lastMonth').to, '2028-02-29');
    assert.equal(payPeriods(new Date(Date.UTC(2027, 2, 5))).find((x) => x.id === 'lastMonth').to, '2027-02-28');
  });
  await t.test('every period starts on or before it ends', () => {
    for (const p of payPeriods(mid)) assert.ok(p.from <= p.to, JSON.stringify(p));
  });
});

test('payProblem() - what stops a pay run being paid', async (t) => {
  await t.test('cash needs no reference', () => {
    assert.equal(payProblem({ method: 'cash', reference: '', grossTotal: 100 }), '');
  });
  await t.test('a transfer or cheque does', () => {
    assert.match(payProblem({ method: 'bank', reference: '  ', grossTotal: 100 }), /reference/);
    assert.match(payProblem({ method: 'cheque', reference: '', grossTotal: 100 }), /reference/);
    assert.equal(payProblem({ method: 'cheque', reference: 'CHQ-1', grossTotal: 100 }), '');
  });
  await t.test('the method must be one the books know', () => {
    assert.match(payProblem({ method: 'card', grossTotal: 100 }), /cash, bank transfer or cheque/);
  });
  await t.test('an empty run is not paid', () => {
    assert.match(payProblem({ method: 'cash', grossTotal: 0 }), /nothing to pay/);
    assert.match(payProblem({ method: 'cash', grossTotal: -5 }), /nothing to pay/);
  });
});

test('the methods and states match the server', () => {
  assert.deepEqual(PAY_METHODS.map((m) => m.id).sort(), ['bank', 'cash', 'cheque']);
  for (const s of ['DRAFT', 'PAID', 'VOIDED']) assert.ok(runState(s).label && runState(s).cls, s);
  assert.equal(runState('nonsense').label, runState('DRAFT').label);
});

test('runTotal() - a run is the sum of its lines', () => {
  assert.equal(runTotal([{ gross: 280 }, { gross: 3000 }]), 3280);
  assert.equal(runTotal([{ gross: 100 }, { gross: -20 }]), 80);
  assert.equal(runTotal([]), 0);
  assert.equal(runTotal(null), 0);
});
