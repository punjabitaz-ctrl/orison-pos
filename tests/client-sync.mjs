'use strict';

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { setOnline, mockFetch, clearFetchMock, jsonResponse, readEnvelope } from './helpers/setup-globals.mjs';
import { idb } from '../public/js/db.js';

/* ── Setup: mock fetch for api.js and clear outbox ────────────── */

before(async () => {
  await idb.clear('outbox');
  await idb.clear('transactions');
  await idb.clear('meta');
  await idb.clear('products');
  setOnline(true);
});

/* ── getDeviceId() ───────────────────────────────────────────── */

describe('getDeviceId()', async () => {
  const { getDeviceId } = await import('../public/js/sync.js');

  it('generates and persists a device ID', async () => {
    const id1 = await getDeviceId();
    assert.ok(id1);
    assert.equal(typeof id1, 'string');
    assert.ok(id1.length > 0);
  });

  it('returns the same ID on subsequent calls', async () => {
    const id1 = await getDeviceId();
    const id2 = await getDeviceId();
    assert.equal(id1, id2);
  });
});

/* ── getSyncState() ──────────────────────────────────────────── */

describe('getSyncState()', async () => {
  const { getSyncState } = await import('../public/js/sync.js');

  it('returns state with deviceId and pending count', async () => {
    const state = await getSyncState();
    assert.ok(state.deviceId);
    assert.equal(typeof state.pending, 'number');
    assert.equal(typeof state.online, 'boolean');
  });

  it('reports online status', async () => {
    setOnline(true);
    const state = await getSyncState();
    assert.equal(state.online, true);

    setOnline(false);
    const state2 = await getSyncState();
    assert.equal(state2.online, false);

    setOnline(true);
  });

  it('counts pending outbox items', async () => {
    await idb.clear('outbox');
    const state = await getSyncState();
    assert.equal(state.pending, 0);

    // Add a PENDING entry
    await idb.put('outbox', {
      clientTxId: 'tx-count-1',
      payload: { clientTxId: 'tx-count-1', kind: 'sale' },
      status: 'PENDING',
      attempts: 0,
    }, 'tx-count-1');

    const state2 = await getSyncState();
    assert.equal(state2.pending, 1);

    // Add a SYNCED entry — should not count
    await idb.put('outbox', {
      clientTxId: 'tx-count-2',
      payload: { clientTxId: 'tx-count-2', kind: 'sale' },
      status: 'SYNCED',
      attempts: 1,
    }, 'tx-count-2');

    const state3 = await getSyncState();
    assert.equal(state3.pending, 1);

    await idb.clear('outbox');
  });
});

/* ── enqueueTransaction() ────────────────────────────────────── */

describe('enqueueTransaction()', async () => {
  const { enqueueTransaction, getSyncState } = await import('../public/js/sync.js');

  before(async () => {
    await idb.clear('outbox');
    await idb.clear('transactions');
  });

  it('creates an outbox entry and transaction record', async () => {
    const txId = await enqueueTransaction({
      kind: 'sale',
      grandTotal: 25.50,
      tenders: [{ type: 'cash', amount: 25.50 }],
      items: [{ productId: 'p1', quantity: 1, unitPrice: 25.50 }],
      userId: 'u1',
      cashier: 'Tester',
    });

    assert.ok(txId);
    assert.equal(typeof txId, 'string');

    // Outbox entry
    const ob = await idb.get('outbox', txId);
    assert.ok(ob);
    assert.equal(ob.status, 'PENDING');
    assert.equal(ob.attempts, 0);
    assert.equal(ob.payload.kind, 'sale');
    assert.equal(ob.payload.grandTotal, 25.50);

    // Transaction record
    const tx = await idb.get('transactions', txId);
    assert.ok(tx);
    assert.equal(tx.status, 'PENDING');
    assert.equal(tx.kind, 'sale');
    assert.equal(tx.total, 25.50);

    await idb.clear('outbox');
    await idb.clear('transactions');
  });

  it('generates unique clientTxIds', async () => {
    const id1 = await enqueueTransaction({
      kind: 'sale', grandTotal: 1, tenders: [], items: [], userId: 'u1',
    });
    const id2 = await enqueueTransaction({
      kind: 'sale', grandTotal: 2, tenders: [], items: [], userId: 'u1',
    });
    assert.notEqual(id1, id2);

    await idb.clear('outbox');
    await idb.clear('transactions');
  });

  it('includes all payload fields', async () => {
    const txId = await enqueueTransaction({
      kind: 'refund',
      originalClientTx: 'orig-1',
      grandTotal: 10,
      tenders: [{ type: 'cash', amount: 10 }],
      note: 'test note',
      items: [{ productId: 'p1', quantity: 1, unitPrice: 10 }],
      userId: 'u1',
      cashier: 'Tester',
      customerId: 'cust-1',
    });

    const ob = await idb.get('outbox', txId);
    assert.equal(ob.payload.kind, 'refund');
    assert.equal(ob.payload.originalClientTx, 'orig-1');
    assert.equal(ob.payload.note, 'test note');
    assert.equal(ob.payload.customerId, 'cust-1');

    await idb.clear('outbox');
    await idb.clear('transactions');
  });
});

/* ── push() ──────────────────────────────────────────────────── */

describe('push()', async () => {
  const { push, enqueueTransaction, outboxStats } = await import('../public/js/sync.js');

  before(async () => {
    await idb.clear('outbox');
    await idb.clear('transactions');
  });

  it('pushes pending transactions and marks SYNCED', async () => {
    mockFetch(async (url, opts) => {
      const env = readEnvelope(opts);
      if (env.action === '/api/sync/push') {
        const results = (env.payload.batch || []).map((b) => ({
          clientTxId: b.clientTxId,
          transactionId: 'srv-' + b.clientTxId,
          accepted: true,
          conflicts: [],
        }));
        return jsonResponse({ ok: true, status: 200, data: { results } });
      }
      return jsonResponse({ ok: true, status: 200, data: {} });
    });

    const txId = await enqueueTransaction({
      kind: 'sale', grandTotal: 5, tenders: [{ type: 'cash', amount: 5 }],
      items: [{ productId: 'p1', quantity: 1, unitPrice: 5 }],
      userId: 'u1', cashier: 'Tester',
    });

    const result = await push();
    assert.ok(result.pushed >= 1);
    assert.equal(result.voided, 0);

    // Outbox entry should be SYNCED
    const ob = await idb.get('outbox', txId);
    assert.equal(ob.status, 'SYNCED');
    assert.ok(ob.serverId);

    // Transaction should be SYNCED
    const tx = await idb.get('transactions', txId);
    assert.equal(tx.status, 'SYNCED');

    clearFetchMock();
    await idb.clear('outbox');
    await idb.clear('transactions');
  });

  it('returns pushed=0 when nothing pending', async () => {
    await idb.clear('outbox');
    const result = await push();
    assert.equal(result.pushed, 0);
    assert.equal(result.voided, 0);
  });

  it('handles offline gracefully', async () => {
    mockFetch(async () => {
      const err = new Error('offline');
      err.offline = true;
      throw err;
    });

    await idb.put('outbox', {
      clientTxId: 'off-1',
      payload: { clientTxId: 'off-1', kind: 'sale', items: [] },
      status: 'PENDING',
      attempts: 0,
    }, 'off-1');

    const result = await push();
    assert.equal(result.offline, true);
    assert.equal(result.pushed, 0);

    // Entry should still be PENDING
    const ob = await idb.get('outbox', 'off-1');
    assert.equal(ob.status, 'PENDING');

    clearFetchMock();
    await idb.clear('outbox');
  });

  it('marks rejected transactions as VOIDED', async () => {
    mockFetch(async (url, opts) => {
      const env = readEnvelope(opts);
      if (env.action === '/api/sync/push') {
        const results = (env.payload.batch || []).map((b) => ({
          clientTxId: b.clientTxId,
          transactionId: null,
          accepted: false,
          conflicts: [{ reason: 'double sell', serialNumber: 'IMEI-1' }],
        }));
        return jsonResponse({ ok: true, status: 200, data: { results } });
      }
      return jsonResponse({ ok: true, status: 200, data: {} });
    });

    // Seed a product for stock restoration
    await idb.put('products', { id: 'p1', name: 'Widget', onHand: 5, isSerialized: false }, 'p1');

    const txId = await enqueueTransaction({
      kind: 'sale', grandTotal: 100,
      tenders: [{ type: 'cash', amount: 100 }],
      items: [{ productId: 'p1', quantity: 2, unitPrice: 50 }],
      userId: 'u1', cashier: 'Tester',
    });

    const result = await push();
    assert.equal(result.voided, 1);

    const ob = await idb.get('outbox', txId);
    assert.equal(ob.status, 'VOIDED');

    // Stock should be restored (sale rollback adds back)
    const prod = await idb.get('products', 'p1');
    assert.equal(prod.onHand, 7); // 5 + 2

    clearFetchMock();
    await idb.clear('outbox');
    await idb.clear('transactions');
    await idb.clear('products');
  });
});

/* ── outboxStats() ───────────────────────────────────────────── */

describe('outboxStats()', async () => {
  const { outboxStats } = await import('../public/js/sync.js');

  before(async () => {
    await idb.clear('outbox');
  });

  it('returns zero counts for empty outbox', async () => {
    const stats = await outboxStats();
    assert.equal(stats.pending, 0);
    assert.equal(stats.synced, 0);
    assert.equal(stats.voided, 0);
  });

  it('counts by status correctly', async () => {
    await idb.put('outbox', { clientTxId: 's1', payload: {}, status: 'PENDING', attempts: 0 }, 's1');
    await idb.put('outbox', { clientTxId: 's2', payload: {}, status: 'PENDING', attempts: 0 }, 's2');
    await idb.put('outbox', { clientTxId: 's3', payload: {}, status: 'SYNCED', attempts: 1 }, 's3');
    await idb.put('outbox', { clientTxId: 's4', payload: {}, status: 'VOIDED', attempts: 1 }, 's4');

    const stats = await outboxStats();
    assert.equal(stats.pending, 2);
    assert.equal(stats.synced, 1);
    assert.equal(stats.voided, 1);

    await idb.clear('outbox');
  });
});

/* ── pushImmediate() ─────────────────────────────────────────── */

describe('pushImmediate()', async () => {
  const { pushImmediate, enqueueTransaction } = await import('../public/js/sync.js');

  before(async () => {
    await idb.clear('outbox');
    await idb.clear('transactions');
  });

  it('returns offline when navigator.onLine is false', async () => {
    setOnline(false);
    const result = await pushImmediate();
    assert.equal(result.offline, true);
    assert.equal(result.pushed, 0);
    setOnline(true);
  });

  it('attempts push when online', async () => {
    setOnline(true);
    mockFetch(async (url, opts) => {
      const env = readEnvelope(opts);
      if (env.action === '/api/sync/push') {
        return jsonResponse({
          ok: true, status: 200,
          data: { results: (env.payload.batch || []).map((b) => ({
            clientTxId: b.clientTxId,
            transactionId: 'srv-' + b.clientTxId,
            accepted: true,
            conflicts: [],
          })) },
        });
      }
      return jsonResponse({ ok: true, status: 200, data: {} });
    });

    const txId = await enqueueTransaction({
      kind: 'sale', grandTotal: 1, tenders: [{ type: 'cash', amount: 1 }],
      items: [], userId: 'u1', cashier: 'Tester',
    });

    const result = await pushImmediate();
    assert.ok(result);
    assert.equal(result.offline, undefined);

    const ob = await idb.get('outbox', txId);
    assert.equal(ob.status, 'SYNCED');

    clearFetchMock();
    await idb.clear('outbox');
    await idb.clear('transactions');
  });
});

/* ── SYNC_EVENT constant ─────────────────────────────────────── */

describe('SYNC_EVENT', async () => {
  const { SYNC_EVENT } = await import('../public/js/sync.js');

  it('exports the correct event name', () => {
    assert.equal(SYNC_EVENT, 'orison:sync');
  });
});
