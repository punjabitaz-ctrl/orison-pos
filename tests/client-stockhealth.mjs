import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WINDOWS, movementLabel, stockHealthCsv } from '../public/js/screens/stockhealth.js';

test('WINDOWS - the velocity window selector', () => {
  assert.equal(WINDOWS.length, 4);
  assert.equal(WINDOWS.find((w) => w.days === 90).label, '90 days');
  assert.deepEqual(WINDOWS.map((w) => w.days), [30, 90, 180, 365]);
});

test('movementLabel() - a category, not a rate', () => {
  assert.equal(movementLabel('fast'), 'Fast');
  assert.equal(movementLabel('slow'), 'Slow');
  assert.equal(movementLabel('dead'), 'Dead');
  assert.equal(movementLabel('anything'), 'Fast');
});

const sample = {
  asOf: '2026-09-24T10:00:00.000Z',
  window: { days: 90 },
  rules: { slowCoverDays: 180, slowSoldMax: 1, deadDays: 180 },
  summary: { products: 2, units: 30, retailValue: 1800, costValue: 900, slowCount: 1, deadCount: 1 },
  categories: [{ category: 'Cables', units: 30, retailValue: 1800, costValue: 900 }],
  items: [
    { id: 'p1', name: 'USB-C Cable', sku: 'CB-1', category: 'Cables', isSerialized: false, onHand: 30,
      retailPrice: 60, costPrice: 30, retailValue: 1800, costValue: 900, soldUnits: 60, perDay: 0.67,
      daysOfCover: 45, movement: 'fast' },
    { id: 'p2', name: '=SUM(A1)', sku: '', category: 'Cables', isSerialized: false, onHand: 0,
      retailPrice: 10, costPrice: 5, retailValue: 0, costValue: 0, soldUnits: 0, perDay: 0,
      daysOfCover: null, movement: 'dead' },
  ],
};

test('stockHealthCsv() - a stable, spreadsheet-safe export', async (t) => {
  const csv = stockHealthCsv(sample).split('\n');
  await t.test('carries the window in the title row', () => {
    assert.equal(csv[0], 'Orison POS stock health,days,90');
  });
  await t.test('has the headline figures and the breakdown', () => {
    assert.ok(csv.includes('products,2'));
    assert.ok(csv.includes('units,30'));
    assert.ok(csv.includes('retail_value,1800.00'));
    assert.ok(csv.includes('cost_value,900.00'));
    assert.ok(csv.includes('slow_products,1'));
    assert.ok(csv.includes('dead_products,1'));
    assert.ok(csv.includes('BY_CATEGORY'));
    assert.ok(csv.includes('"Cables","30","1800.00","900.00"'), csv.join(' | '));
  });
  await t.test('one row per item, with stable English columns', () => {
    const hdr = csv[csv.indexOf('ITEMS') + 1];
    assert.equal(hdr, 'category,sku,name,on_hand,sold_units,days_of_cover,retail_price,cost_price,retail_value,cost_value,movement');
    assert.equal(csv[csv.indexOf('ITEMS') + 2], '"Cables","CB-1","USB-C Cable","30","60","45","60.00","30.00","1800.00","900.00","fast"');
  });
  await t.test('an empty cover exports as an empty cell, not text', () => {
    assert.equal(csv[csv.indexOf('ITEMS') + 3].split(',')[5], '""');
  });
  await t.test('a cell that looks like a formula cannot run in a spreadsheet', () => {
    const row = csv[csv.indexOf('ITEMS') + 3];
    assert.match(row, /^"Cables","","'=SUM\(A1\)"/, row);
    assert.ok(!/,\s*=\s*SUM/.test(csv.join('\n')));
  });
});