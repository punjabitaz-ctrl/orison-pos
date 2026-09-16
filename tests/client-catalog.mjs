import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorySummaries, productsInView, matchesTerm } from '../public/js/catalog.js';

const products = [
  { id: 'p1', name: 'Pixel 8a', sku: 'PH-G8A', upc: '0011', category: 'Phones', isSerialized: true, serials: ['3599990001'] },
  { id: 'p2', name: 'Galaxy A15', sku: 'PH-A15', category: 'Phones', isSerialized: true, serials: [] },
  { id: 'p3', name: 'USB-C Cable', sku: 'CB-USBC', category: 'Cables', onHand: 12 },
  { id: 'p4', name: 'Screen Protector Install', sku: 'SV-GLASS', category: 'Services', itemType: 'service' },
  { id: 'p5', name: 'Mystery box', sku: 'MB-1', category: '', onHand: 1 },
];
const available = (p) => (p.isSerialized ? (p.serials || []).length : Number(p.onHand) || 0);

test('categorySummaries() - the Sell screen’s first view', async (t) => {
  const cats = categorySummaries(products, available);
  await t.test('one entry per category, alphabetical', () => {
    assert.deepEqual(cats.map((c) => c.name), ['Cables', 'Phones', 'Services', 'Uncategorized']);
  });
  await t.test('counts every product, and how many can be sold now', () => {
    const phones = cats.find((c) => c.name === 'Phones');
    assert.equal(phones.count, 2);
    assert.equal(phones.sellable, 1, 'a sold-out phone is listed but not sellable');
  });
  await t.test('a service is always sellable', () => {
    assert.equal(cats.find((c) => c.name === 'Services').sellable, 1);
  });
  await t.test('a product with no category still has a home', () => {
    assert.equal(cats.find((c) => c.name === 'Uncategorized').count, 1);
  });
  await t.test('an empty catalogue has no categories', () => {
    assert.deepEqual(categorySummaries([], available), []);
  });
});

test('productsInView() - products under their category', async (t) => {
  await t.test('no category and no search shows no products (the categories show instead)', () => {
    assert.deepEqual(productsInView(products, {}), []);
  });
  await t.test('a category shows only its own products', () => {
    assert.deepEqual(productsInView(products, { category: 'Phones' }).map((p) => p.id), ['p1', 'p2']);
    assert.deepEqual(productsInView(products, { category: 'Uncategorized' }).map((p) => p.id), ['p5']);
  });
  await t.test('a search looks across every category, even from inside one', () => {
    assert.deepEqual(productsInView(products, { category: 'Phones', term: 'cable' }).map((p) => p.id), ['p3']);
  });
  await t.test('search matches name, SKU, barcode and IMEI', () => {
    assert.ok(matchesTerm(products[0], 'pixel'));
    assert.ok(matchesTerm(products[0], 'ph-g8a'));
    assert.ok(matchesTerm(products[0], '0011'));
    assert.ok(matchesTerm(products[0], '3599990001'));
    assert.ok(!matchesTerm(products[0], 'iphone'));
  });
});
