'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { available, reorderThreshold, inventoryAlerts, agingBucket, bucketLabel } from '../public/js/alerts.js';

/* ── available() ─────────────────────────────────────────────── */

describe('available()', () => {
  it('returns onHand for normal product', () => {
    assert.equal(available({ onHand: 42 }), 42);
  });

  it('returns serial count for serialized product', () => {
    assert.equal(available({ isSerialized: true, serials: ['a', 'b', 'c'] }), 3);
  });

  it('returns 0 for serialized product with empty serials', () => {
    assert.equal(available({ isSerialized: true, serials: [] }), 0);
  });

  it('returns 0 for missing product', () => {
    assert.equal(available(null), 0);
    assert.equal(available(undefined), 0);
  });

  it('returns 0 when onHand is missing', () => {
    assert.equal(available({}), 0);
  });

  it('coerces string onHand', () => {
    assert.equal(available({ onHand: '7' }), 7);
  });
});

/* ── reorderThreshold() ──────────────────────────────────────── */

describe('reorderThreshold()', () => {
  it('returns 0 for null product', () => {
    assert.equal(reorderThreshold(null), 0);
  });

  it('returns 0 for serialized product', () => {
    assert.equal(reorderThreshold({ isSerialized: true, reorderPoint: 10 }), 0);
  });

  it('returns 0 for service item', () => {
    assert.equal(reorderThreshold({ itemType: 'service', reorderPoint: 10 }), 0);
  });

  it('returns reorderPoint when set and positive', () => {
    assert.equal(reorderThreshold({ reorderPoint: 15 }), 15);
  });

  it('returns 5 default when reorderPoint is 0', () => {
    assert.equal(reorderThreshold({ reorderPoint: 0 }), 5);
  });

  it('returns 5 default when reorderPoint is null', () => {
    assert.equal(reorderThreshold({ reorderPoint: null }), 5);
  });

  it('returns 5 default when reorderPoint is empty string', () => {
    assert.equal(reorderThreshold({ reorderPoint: '' }), 5);
  });

  it('returns 5 default when reorderPoint is not set', () => {
    assert.equal(reorderThreshold({}), 5);
  });

  it('coerces string reorderPoint', () => {
    assert.equal(reorderThreshold({ reorderPoint: '8' }), 8);
  });
});

/* ── agingBucket() ───────────────────────────────────────────── */

describe('agingBucket()', () => {
  it('returns null for null', () => {
    assert.equal(agingBucket(null), null);
  });

  it('returns null for NaN', () => {
    assert.equal(agingBucket(NaN), null);
  });

  it('returns null for negative', () => {
    assert.equal(agingBucket(-1), null);
  });

  it('returns null for 0 days', () => {
    assert.equal(agingBucket(0), null);
  });

  it('returns null for 6 days (fresh)', () => {
    assert.equal(agingBucket(6), null);
  });

  it('returns 7-day bucket for exactly 7', () => {
    const b = agingBucket(7);
    assert.deepEqual(b, { days: 7, label: '7 days', ageDays: 7 });
  });

  it('returns 15-day bucket for 15', () => {
    const b = agingBucket(15);
    assert.deepEqual(b, { days: 15, label: '15 days', ageDays: 15 });
  });

  it('returns 30-day bucket for 30', () => {
    const b = agingBucket(30);
    assert.deepEqual(b, { days: 30, label: '30 days', ageDays: 30 });
  });

  it('returns 30-day bucket for 60 (highest qualifying)', () => {
    const b = agingBucket(60);
    assert.deepEqual(b, { days: 30, label: '30 days', ageDays: 60 });
  });

  it('returns 7-day bucket for 10 (between 7 and 15)', () => {
    const b = agingBucket(10);
    assert.deepEqual(b, { days: 7, label: '7 days', ageDays: 10 });
  });
});

/* ── bucketLabel() ───────────────────────────────────────────── */

describe('bucketLabel()', () => {
  it('returns label for "7"', () => assert.equal(bucketLabel('7'), '7 days'));
  it('returns label for "15"', () => assert.equal(bucketLabel('15'), '15 days'));
  it('returns label for "30"', () => assert.equal(bucketLabel('30'), '30 days'));
  it('returns label for numeric key', () => assert.equal(bucketLabel(7), '7 days'));
  it('returns empty for unknown key', () => assert.equal(bucketLabel('99'), ''));
  it('returns empty for null', () => assert.equal(bucketLabel(null), ''));
});

/* ── inventoryAlerts() ───────────────────────────────────────── */

describe('inventoryAlerts()', () => {
  const now = Date.now();
  const daysAgo = (d) => new Date(now - d * 86400000).toISOString();

  it('returns empty for empty/null input', () => {
    assert.deepEqual(inventoryAlerts([]), []);
    assert.deepEqual(inventoryAlerts(null), []);
  });

  it('skips service items', () => {
    const result = inventoryAlerts([{ itemType: 'service', onHand: 0, name: 'Svc' }]);
    assert.equal(result.length, 0);
  });

  it('flags out-of-stock product', () => {
    const p = { id: '1', name: 'Widget', onHand: 0 };
    const result = inventoryAlerts([p]);
    assert.equal(result.length, 1);
    assert.equal(result[0].severity, 'out');
    assert.equal(result[0].avail, 0);
  });

  it('flags low-stock product', () => {
    const p = { id: '1', name: 'Widget', onHand: 3, reorderPoint: 5 };
    const result = inventoryAlerts([p]);
    assert.equal(result.length, 1);
    assert.equal(result[0].severity, 'low');
  });

  it('flags locked product', () => {
    const p = { id: '1', name: 'Widget', onHand: 50, locked: true };
    const result = inventoryAlerts([p]);
    assert.equal(result.length, 1);
    assert.equal(result[0].severity, 'locked');
  });

  it('flags locked product with locked = "1"', () => {
    const p = { id: '1', name: 'Widget', onHand: 50, locked: '1' };
    const result = inventoryAlerts([p]);
    assert.equal(result[0].severity, 'locked');
  });

  it('includes aging for low product not sold in 7+ days', () => {
    const p = { id: '1', name: 'Widget', onHand: 2, reorderPoint: 5, lastSoldAt: daysAgo(10) };
    const result = inventoryAlerts([p]);
    assert.equal(result.length, 1);
    assert.equal(result[0].severity, 'low');
    assert.equal(result[0].aging.days, 7);
  });

  it('does not flag aging for locked low product', () => {
    const p = { id: '1', name: 'Widget', onHand: 2, reorderPoint: 5, locked: true, lastSoldAt: daysAgo(30) };
    const result = inventoryAlerts([p]);
    // implementation priorities: out > low > locked — locked+low surfaces as low
    assert.equal(result[0].severity, 'low');
    assert.equal(result[0].aging, null);
  });

  it('does not flag healthy in-stock product', () => {
    const p = { id: '1', name: 'Widget', onHand: 50, reorderPoint: 5 };
    const result = inventoryAlerts([p]);
    assert.equal(result.length, 0);
  });

  it('sorts out before low before locked', () => {
    const products = [
      { id: '1', name: 'Locked', onHand: 100, locked: true },
      { id: '2', name: 'Out', onHand: 0 },
      { id: '3', name: 'Low', onHand: 2, reorderPoint: 5 },
    ];
    const result = inventoryAlerts(products);
    assert.equal(result[0].severity, 'out');
    assert.equal(result[1].severity, 'low');
    assert.equal(result[2].severity, 'locked');
  });

  it('uses default reorder of 5 when reorderPoint not set', () => {
    const p = { id: '1', name: 'Widget', onHand: 4 };
    const result = inventoryAlerts([p]);
    assert.equal(result.length, 1);
    assert.equal(result[0].severity, 'low');
  });

  it('does not flag onHand=6 with default reorder=5', () => {
    const p = { id: '1', name: 'Widget', onHand: 6 };
    const result = inventoryAlerts([p]);
    assert.equal(result.length, 0);
  });
});
