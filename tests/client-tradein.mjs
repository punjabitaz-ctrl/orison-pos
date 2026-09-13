import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tradeInProblem, CONDITIONS, ID_TYPES } from '../public/js/screens/tradein.js';

const ok = { customer: { id: 'c1', name: 'Seller' }, product: { id: 'p1', name: 'Used phone' }, serialNumber: '356789012345678', condition: 'good', amount: '180', idType: 'passport', idRef: '4821' };

test('tradeInProblem() - what a trade-in needs before it goes to the server', async (t) => {
  await t.test('a complete form has no problem', () => assert.equal(tradeInProblem(ok), ''));
  await t.test('the seller is required', () => assert.match(tradeInProblem({ ...ok, customer: null }), /seller/));
  await t.test('the product is required', () => assert.match(tradeInProblem({ ...ok, product: null }), /product/));
  await t.test('the IMEI is required', () => assert.match(tradeInProblem({ ...ok, serialNumber: '  ' }), /IMEI/));
  await t.test('a condition is required', () => assert.match(tradeInProblem({ ...ok, condition: '' }), /condition/));
  await t.test('the shop must pay something', () => {
    assert.match(tradeInProblem({ ...ok, amount: '0' }), /paying/);
    assert.match(tradeInProblem({ ...ok, amount: 'abc' }), /paying/);
  });
  await t.test('the ID type is required', () => assert.match(tradeInProblem({ ...ok, idType: '' }), /ID/));
  await t.test('only the last few characters of an ID are taken, never the whole number', () => {
    assert.match(tradeInProblem({ ...ok, idRef: '1' }), /last 2 to 6/);
    assert.match(tradeInProblem({ ...ok, idRef: 'D12345678' }), /last 2 to 6/);
    assert.equal(tradeInProblem({ ...ok, idRef: 'AB 12' }), '');
  });
});

test('the choices match what the server accepts', () => {
  assert.deepEqual(CONDITIONS.map((c) => c.id), ['like_new', 'good', 'fair', 'faulty']);
  assert.deepEqual(ID_TYPES.map((c) => c.id), ['driving_licence', 'passport', 'national_id', 'other']);
});
