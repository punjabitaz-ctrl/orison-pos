'use strict';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { idb, open, STORES } from '../public/js/db.js';

/* ── Schema ──────────────────────────────────────────────────── */

describe('db.js STORES', () => {
  it('exports correct store names', () => {
    assert.deepEqual(STORES, ['meta', 'users', 'products', 'config', 'transactions', 'outbox']);
  });
});

/* ── CRUD operations ─────────────────────────────────────────── */

describe('idb CRUD', () => {
  before(async () => {
    await idb.clear('products');
    await idb.clear('meta');
    await idb.clear('outbox');
    await idb.clear('transactions');
  });

  it('put and get a record', async () => {
    const item = { id: 'test-1', name: 'Widget', price: 9.99 };
    await idb.put('products', item, 'test-1');
    const got = await idb.get('products', 'test-1');
    assert.deepEqual(got, item);
  });

  it('get returns undefined for missing key', async () => {
    const got = await idb.get('products', 'nonexistent');
    assert.equal(got, undefined);
  });

  it('put updates existing record', async () => {
    await idb.put('products', { id: 'test-1', name: 'Widget', price: 12.99 }, 'test-1');
    const got = await idb.get('products', 'test-1');
    assert.equal(got.price, 12.99);
  });

  it('delete removes a record', async () => {
    await idb.put('products', { id: 'test-del', name: 'Temp' }, 'test-del');
    await idb.delete('products', 'test-del');
    const got = await idb.get('products', 'test-del');
    assert.equal(got, undefined);
  });

  it('getAll returns all records in a store', async () => {
    await idb.clear('products');
    await idb.put('products', { id: 'a', name: 'A' }, 'a');
    await idb.put('products', { id: 'b', name: 'B' }, 'b');
    const all = await idb.getAll('products');
    assert.equal(all.length, 2);
    assert.ok(all.find((r) => r.id === 'a'));
    assert.ok(all.find((r) => r.id === 'b'));
  });

  it('getAll returns empty array for empty store', async () => {
    await idb.clear('products');
    const all = await idb.getAll('products');
    assert.deepEqual(all, []);
  });

  it('clear removes all records', async () => {
    await idb.put('products', { id: 'x1', name: 'X' }, 'x1');
    await idb.put('products', { id: 'x2', name: 'Y' }, 'x2');
    await idb.clear('products');
    const all = await idb.getAll('products');
    assert.equal(all.length, 0);
  });

  it('bulkPut writes multiple records', async () => {
    await idb.clear('products');
    const items = [
      { id: 'bp1', name: 'Bulk1' },
      { id: 'bp2', name: 'Bulk2' },
      { id: 'bp3', name: 'Bulk3' },
    ];
    const count = await idb.bulkPut('products', items, (v) => v.id);
    assert.equal(count, 3);
    const all = await idb.getAll('products');
    assert.equal(all.length, 3);
  });

  it('bulkPut with keyFn uses the key function', async () => {
    await idb.clear('products');
    const items = [
      { id: 'bk1', name: 'K1', upc: '111' },
      { id: 'bk2', name: 'K2', upc: '222' },
    ];
    await idb.bulkPut('products', items, (v) => v.upc);
    const got = await idb.get('products', '111');
    assert.equal(got.name, 'K1');
  });
});

/* ── IndexedDB indexes ───────────────────────────────────────── */

describe('idb allByIndex', () => {
  before(async () => {
    await idb.clear('products');
    await idb.bulkPut('products', [
      { id: 'i1', name: 'A', upc: 'UPC-001', sku: 'SKU-A', category: 'Phones' },
      { id: 'i2', name: 'B', upc: 'UPC-002', sku: 'SKU-B', category: 'Phones' },
      { id: 'i3', name: 'C', upc: 'UPC-003', sku: 'SKU-C', category: 'Laptops' },
    ], (v) => v.id);
  });

  it('finds products by UPC', async () => {
    const results = await idb.allByIndex('products', 'by_upc', 'UPC-002');
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'B');
  });

  it('finds products by category', async () => {
    const results = await idb.allByIndex('products', 'by_category', 'Phones');
    assert.equal(results.length, 2);
  });

  it('returns empty for non-matching index value', async () => {
    const results = await idb.allByIndex('products', 'by_upc', 'NOPE');
    assert.equal(results.length, 0);
  });

  it('finds products by SKU', async () => {
    const results = await idb.allByIndex('products', 'by_sku', 'SKU-C');
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'C');
  });
});

/* ── Meta store operations ───────────────────────────────────── */

describe('idb meta store', () => {
  it('put and get meta config', async () => {
    const config = { deviceId: 'dev-123', serverUrl: 'https://example.com' };
    await idb.put('meta', config, 'config');
    const got = await idb.get('meta', 'config');
    assert.equal(got.deviceId, 'dev-123');
    assert.equal(got.serverUrl, 'https://example.com');
  });

  it('meta config is updatable', async () => {
    const config = { deviceId: 'dev-123', serverUrl: 'https://example.com' };
    await idb.put('meta', config, 'config');
    config.lastSyncAt = '2026-01-01T00:00:00Z';
    await idb.put('meta', config, 'config');
    const got = await idb.get('meta', 'config');
    assert.equal(got.lastSyncAt, '2026-01-01T00:00:00Z');
  });
});

/* ── Database open ───────────────────────────────────────────── */

describe('open()', () => {
  it('returns a database promise', async () => {
    const db = await open();
    assert.ok(db);
    assert.ok(db.objectStoreNames);
    assert.ok(db.objectStoreNames.contains('products'));
  });

  it('returns same instance on subsequent calls', async () => {
    const db1 = await open();
    const db2 = await open();
    assert.equal(db1, db2);
  });
});
