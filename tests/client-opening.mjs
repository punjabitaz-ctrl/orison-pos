import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openingNotice } from '../public/js/screens/accounts.js';

/* The one thing this has to get right: a shop that has not said what it
   started with must be told, on the screen where the wrong numbers show. */
test('openingNotice() - what the books say about where they started', async (t) => {
  await t.test('nothing loaded yet says nothing - no flicker of a false warning', () => {
    assert.equal(openingNotice(null), null);
    assert.equal(openingNotice(undefined), null);
  });
  await t.test('not set: the shop is warned, with a way to fix it', () => {
    const n = openingNotice({ set: false, entry: null });
    assert.equal(n.id, 'missing');
    assert.equal(n.tone, 'warn');
    assert.ok(n.title && n.body && n.action);
  });
  await t.test('set: it says so quietly, and still offers a way back in', () => {
    const n = openingNotice({ set: true, entry: { asOf: '2026-09-01', cash: 500, bank: 12000, stockValue: 8000, total: 20500 } });
    assert.equal(n.id, 'set');
    assert.equal(n.tone, 'ok');
    assert.ok(n.action);
  });
  await t.test('a voided entry reads as not set, because that is what it is', () => {
    assert.equal(openingNotice({ set: false, entry: null, history: [{ status: 'VOIDED' }] }).id, 'missing');
  });
});
