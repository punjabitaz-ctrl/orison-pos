import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepLabel } from '../public/js/screens/serialtrace.js';

/* The timeline calls this two ways: with a step row from the server, and with
   a bare kind for the chip. Reading `.kind` off a string silently fell through
   to "Step", so every chip on the trace said Step (fixed in v1.55.2). */
test('stepLabel() - names a leg of a serial\'s life', async (t) => {
  const kinds = ['intake', 'sale', 'restock', 'repair', 'tradein'];

  await t.test('a step row is named', () => {
    assert.equal(stepLabel({ kind: 'sale' }), 'Sale');
    assert.equal(stepLabel({ kind: 'restock' }), 'Refunded & restocked');
  });
  await t.test('a bare kind is named the same way - the chip passes one', () => {
    for (const k of kinds) assert.equal(stepLabel(k), stepLabel({ kind: k }), k);
  });
  await t.test('and none of them fall through to the generic word', () => {
    for (const k of kinds) assert.notEqual(stepLabel(k), 'Step', k);
  });
  await t.test('something unrecognised still reads as words', () => {
    assert.equal(stepLabel('nonsense'), 'Step');
    assert.equal(stepLabel(null), 'Step');
    assert.equal(stepLabel(undefined), 'Step');
    assert.equal(stepLabel({}), 'Step');
  });
});
