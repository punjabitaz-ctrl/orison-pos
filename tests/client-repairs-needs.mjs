import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needState } from '../public/js/screens/repairs.js';

test('needState() - where a part a job waits for actually is', async (t) => {
  await t.test('on the shelf beats everything: it can be fitted now', () => {
    assert.equal(needState({ canFit: true, onHand: 2, poNumber: 'PO-0007', onOrder: 5 }).id, 'here');
  });
  await t.test('on an order, with the order named', () => {
    assert.equal(needState({ canFit: false, onHand: 0, poNumber: 'PO-0007', onOrder: 2 }).id, 'ordered');
  });
  await t.test("on its way on another order still counts as on order", () => {
    assert.equal(needState({ canFit: false, onHand: 0, poNumber: '', onOrder: 2 }).id, 'coming');
  });
  await t.test('nobody has ordered it - this is what Purchases must see', () => {
    assert.equal(needState({ canFit: false, onHand: 0, poNumber: '', onOrder: 0 }).id, 'none');
  });
  await t.test('a missing need never throws', () => {
    assert.equal(needState(null).id, 'none');
  });
  await t.test('every state carries a label and a class to show it', () => {
    for (const n of [{ canFit: true }, { poNumber: 'PO-1' }, { onOrder: 1 }, {}]) {
      const st = needState(n);
      assert.ok(st.label && st.cls, JSON.stringify(st));
    }
  });
});
