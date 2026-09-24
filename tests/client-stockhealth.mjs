import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WINDOWS, VELOCITY_WINDOWS, movementLabel, stockHealthCsv, stockHealthVelocityCsv } from '../public/js/screens/stockhealth.js';

test('WINDOWS - the velocity window selector', () => {
  assert.equal(WINDOWS.length, 4);
  assert.equal(WINDOWS.find((w) => w.days === 90).label, '90 days');
  assert.deepEqual(WINDOWS.map((w) => w.days), [30, 90, 180, 365]);
});

test('VELOCITY_WINDOWS - sell-through is 30- and 90-day only', () => {
  assert.deepEqual(VELOCITY_WINDOWS.map((w) => w.days), [30, 90]);
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

const velocitySample = {
  asOf: '2026-09-24T10:00:00.000Z',
  view: 'velocity',
  window: { days: 30, since: '2026-08-25T10:00:00.000Z' },
  summary: { products: 2, units: 6, netRevenue: 480, grossProfit: 240, avgShelfValue: 560, buyAgainCount: 1, turnover: 0.86 },
  categories: [{ category: 'Cables', products: 2, units: 6, netRevenue: 480, grossProfit: 240, avgShelfValue: 560, turnover: 0.86 }],
  items: [
    { id: 'p1', name: 'USB-C Cable', sku: 'CB-1', category: 'Cables', isSerialized: false, onHand: 4,
      unitsSold: 8, unitsRefunded: 2, netUnits: 6, receivedUnits: 0,
      revenueSold: 640, revenueRefunded: 160, netRevenue: 480,
      avgShelfValue: 560, turnover: 0.86, daysOfCover: 20, grossProfit: 240, margin: 50, buyAgain: true },
    { id: 'p2', name: 'Idle Part', sku: '', category: 'Cables', isSerialized: false, onHand: 40,
      unitsSold: 0, unitsRefunded: 0, netUnits: 0, receivedUnits: 0,
      revenueSold: 0, revenueRefunded: 0, netRevenue: 0,
      avgShelfValue: 600, turnover: null, daysOfCover: null, grossProfit: 0, margin: null, buyAgain: false },
  ],
  buyAgain: [
    { id: 'p1', name: 'USB-C Cable', sku: 'CB-1', onHand: 4, netUnits: 6, avgShelfValue: 560, turnover: 0.86, daysOfCover: 20 },
  ],
};

test('stockHealthVelocityCsv() - a stable, spreadsheet-safe sell-through export', async (t) => {
  const csv = stockHealthVelocityCsv(velocitySample).split('\n');
  await t.test('carries the window and the view title', () => {
    assert.equal(csv[0], 'Orison POS stock velocity,days,30');
  });
  await t.test('has the headline figures and the breakdown', () => {
    assert.ok(csv.includes('products,2'));
    assert.ok(csv.includes('units,6'));
    assert.ok(csv.includes('net_revenue,480.00'));
    assert.ok(csv.includes('gross_profit,240.00'));
    assert.ok(csv.includes('avg_shelf_value,560.00'));
    assert.ok(csv.includes('buy_again_products,1'));
    assert.ok(csv.includes('turnover,0.86'));
    assert.ok(csv.includes('"Cables","2","6","480.00","240.00","560.00","0.86"'), csv.join(' | '));
  });
  await t.test('one row per item with stable English columns', () => {
    const hdr = csv[csv.indexOf('ITEMS') + 1];
    assert.equal(hdr, 'category,sku,name,on_hand,units_sold,units_refunded,net_units,received_units,revenue,revenue_refunded,net_revenue,avg_shelf_value,turnover,days_of_cover,gross_profit,margin,buy_again');
    assert.equal(csv[csv.indexOf('ITEMS') + 2], '"Cables","CB-1","USB-C Cable","4","8","2","6","0","640.00","160.00","480.00","560.00","0.86","20","240.00","50","yes"');
  });
  await t.test('an idle product exports nulls as empty cells and no-buy', () => {
    const row = csv[csv.indexOf('ITEMS') + 3].split(',');
    assert.equal(row[5], '"0"');  // units_refunded is a real zero, still quoted
    assert.equal(row[12], '""');  // turnover null -> empty
    assert.equal(row[13], '""');  // cover null -> empty
    assert.equal(row[15], '""');  // margin null -> empty
    assert.equal(row[16], '"no"');
  });
  await t.test('the buy-again list is its own block', () => {
    const idx = csv.indexOf('BUY_AGAIN');
    assert.equal(csv[idx + 1], 'sku,name,on_hand,net_units,avg_shelf_value,turnover,days_of_cover');
    assert.equal(csv[idx + 2], '"CB-1","USB-C Cable","4","6","560.00","0.86","20"');
  });
});