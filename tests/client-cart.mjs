'use strict';

/* Units for public/js/cart.js - the availability maths and the persistence that
 * keeps a part-rung sale alive across an interruption. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { idb } from '../public/js/db.js';
import {
  lineKey, cartCount, qtyInCart, serialsInCart, availableFor, freeSerials,
  isSerialFree, toRecords, fromRecords, persistNow, loadSaved, clearSaved,
  savedSummary, CART_KEY,
} from '../public/js/cart.js';

const cable = { id: 'p1', name: 'USB-C Cable', onHand: 5, itemType: 'product' };
const phone = { id: 'p2', name: 'Galaxy S24', isSerialized: true, serials: ['sn-a', 'sn-b', 'sn-c'] };
const labour = { id: 'p3', name: 'Screen repair', itemType: 'service', onHand: 0 };

function cartOf(...lines) {
  const m = new Map();
  for (const l of lines) m.set(lineKey(l.product.id, (l.serials || [])[0]), l);
  return m;
}

test('lineKey()', () => {
  assert.equal(lineKey('p1'), 'p1');
  assert.equal(lineKey('p2', 'sn-a'), 'p2|sn-a', 'serialized lines are keyed per unit');
  assert.equal(lineKey('p1', null), 'p1');
});

test('cartCount() sums quantities, not lines', () => {
  assert.equal(cartCount(cartOf({ product: cable, qty: 3 }, { product: labour, qty: 2 })), 5);
  assert.equal(cartCount(new Map()), 0);
  assert.equal(cartCount(null), 0);
});

test('availableFor()', async (t) => {
  await t.test('server stock minus what this cart holds', () => {
    assert.equal(availableFor(cable, new Map()), 5);
    assert.equal(availableFor(cable, cartOf({ product: cable, qty: 2 })), 3);
  });
  await t.test('never goes negative, even if the cart somehow exceeds stock', () => {
    assert.equal(availableFor(cable, cartOf({ product: cable, qty: 99 })), 0);
  });
  await t.test('a serialized product counts unclaimed serials', () => {
    assert.equal(availableFor(phone, new Map()), 3);
    assert.equal(availableFor(phone, cartOf({ product: phone, qty: 1, serials: ['sn-b'] })), 2);
  });
  await t.test('a service is never out of stock', () => {
    assert.equal(availableFor(labour, cartOf({ product: labour, qty: 10 })), Infinity);
  });
  await t.test('an unknown product is zero rather than a crash', () => {
    assert.equal(availableFor(null, new Map()), 0);
  });
  await t.test('the product object is never mutated by asking', () => {
    const p = { ...cable };
    availableFor(p, cartOf({ product: p, qty: 4 }));
    assert.equal(p.onHand, 5, 'the catalog mirror must stay the server figure');
  });
});

test('freeSerials() and isSerialFree()', () => {
  const cart = cartOf({ product: phone, qty: 1, serials: ['sn-b'] });
  assert.deepEqual(freeSerials(phone, cart), ['sn-a', 'sn-c']);
  assert.equal(isSerialFree(phone, cart, 'sn-a'), true);
  assert.equal(isSerialFree(phone, cart, 'sn-b'), false, 'already in the cart');
  assert.equal(isSerialFree(phone, cart, 'sn-zz'), false, 'not in stock at all');
  assert.deepEqual(freeSerials(cable, new Map()), [], 'a non-serialized product has none');
});

test('qtyInCart() and serialsInCart() only count their own product', () => {
  const cart = cartOf(
    { product: cable, qty: 2 },
    { product: phone, qty: 1, serials: ['sn-a'] },
  );
  assert.equal(qtyInCart(cart, 'p1'), 2);
  assert.equal(qtyInCart(cart, 'p2'), 1);
  assert.equal(qtyInCart(cart, 'nope'), 0);
  assert.deepEqual(serialsInCart(cart, 'p2'), ['sn-a']);
  assert.deepEqual(serialsInCart(cart, 'p1'), []);
});

test('toRecords() / fromRecords()', async (t) => {
  const cart = cartOf(
    { product: cable, qty: 2, serials: [], price: 9.5, discountPct: 10, taxable: true },
    { product: phone, qty: 1, serials: ['sn-a'], price: 949, discountPct: 0, taxable: true },
  );

  await t.test('records store ids, not product objects', () => {
    const recs = toRecords(cart);
    assert.equal(recs.length, 2);
    assert.equal(recs[0].productId, 'p1');
    assert.equal(recs[0].qty, 2);
    assert.equal(recs[0].discountPct, 10);
    assert.equal(recs[1].serials[0], 'sn-a');
    assert.ok(!('product' in recs[0]), 'a live object must not be persisted');
  });

  await t.test('a round trip rebuilds the same cart against the live catalog', () => {
    const back = fromRecords(toRecords(cart), [cable, phone, labour]);
    assert.equal(back.size, 2);
    assert.equal(back.get('p1').qty, 2);
    assert.equal(back.get('p1').price, 9.5);
    assert.equal(back.get('p2|sn-a').serials[0], 'sn-a');
    assert.equal(back.get('p2|sn-a').product.name, 'Galaxy S24', 're-joined to the catalog');
  });

  await t.test('a product deleted since saving is dropped, not resurrected', () => {
    const back = fromRecords(toRecords(cart), [cable]);
    assert.equal(back.size, 1);
    assert.ok(!back.has('p2|sn-a'));
  });

  await t.test('a corrupt record cannot produce a zero-quantity line', () => {
    const back = fromRecords([{ productId: 'p1', qty: 0 }], [cable]);
    assert.equal(back.get('p1').qty, 1);
  });
});

test('persistence survives a restart', async (t) => {
  await idb.put('meta', {}, 'config');

  await t.test('nothing saved reads as null', async () => {
    assert.equal(await loadSaved(), null);
  });

  const cart = cartOf({ product: phone, qty: 1, serials: ['sn-c'], price: 949, discountPct: 0, taxable: true });
  await persistNow(cart);

  await t.test('a saved cart comes back with its lines and a timestamp', async () => {
    const saved = await loadSaved();
    assert.equal(saved.lines.length, 1);
    assert.equal(saved.lines[0].serials[0], 'sn-c');
    assert.ok(saved.at, 'needs a timestamp so a stale cart can be judged');
  });

  await t.test('it rebuilds into a working cart', async () => {
    const saved = await loadSaved();
    const back = fromRecords(saved.lines, [phone]);
    assert.equal(back.size, 1);
    assert.equal(availableFor(phone, back), 2, 'the saved unit is still claimed');
  });

  await t.test('saving does not disturb the rest of the config', async () => {
    const m = await idb.get('meta', 'config');
    m.serverUrl = 'https://example.com/exec';
    await idb.put('meta', m, 'config');
    await persistNow(cart);
    assert.equal((await idb.get('meta', 'config')).serverUrl, 'https://example.com/exec');
  });

  await t.test('clearing removes the cart and leaves the config', async () => {
    await clearSaved();
    assert.equal(await loadSaved(), null);
    assert.equal((await idb.get('meta', 'config')).serverUrl, 'https://example.com/exec');
    assert.ok(!(CART_KEY in (await idb.get('meta', 'config'))));
  });

  await t.test('an empty cart saves nothing rather than an empty husk', async () => {
    await persistNow(new Map());
    assert.equal(await loadSaved(), null);
  });
});

test('savedSummary() describes what would be recovered', () => {
  const saved = { lines: [
    { productId: 'p1', qty: 2, price: 10, discountPct: 0 },
    { productId: 'p2', qty: 1, price: 100, discountPct: 50 },
  ] };
  const s = savedSummary(saved, (v) => '$' + v.toFixed(2));
  assert.equal(s.count, 3);
  assert.equal(s.total, 70, 'line discounts are applied');
  assert.equal(s.text, '3 items · $70.00');
  assert.equal(savedSummary({ lines: [{ productId: 'p1', qty: 1, price: 5 }] }, (v) => '$' + v.toFixed(2)).text, '1 item · $5.00');
  assert.equal(savedSummary(null).count, 0);
});
