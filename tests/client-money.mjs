'use strict';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setOnline, mockFetch, clearFetchMock, jsonResponse, readEnvelope } from './helpers/setup-globals.mjs';

/* ── Pure money functions ────────────────────────────────────── */

describe('round2()', async () => {
  const { round2 } = await import('../public/js/money.js');

  it('rounds to 2 decimals', () => assert.equal(round2(1.234), 1.23));
  it('rounds 1.005 to 1 (float drift, not 1.01)', () => {
    // 1.005*100 = 100.49999999999999 → Math.round → 100 → 1.
    assert.equal(round2(1.005), 1);
  });
  it('rounds down', () => assert.equal(round2(1.004), 1.0));
  it('rounds integers', () => assert.equal(round2(5), 5));
  it('returns 0 for falsy', () => assert.equal(round2(null), 0));
  it('returns 0 for undefined', () => assert.equal(round2(undefined), 0));
  it('handles negative', () => assert.equal(round2(-1.5), -1.5));
  it('handles negative float drift (client round2 is plain Math.round)', () => {
    // -1.005*100 = -100.49999999999999 → rounds toward -100 → -1 (not -1.01).
    // The backend round2_ is sign-safe; the client is intentionally documented
    // as-is until the money layer is aligned.
    assert.equal(round2(-1.005), -1);
  });
  it('handles zero', () => assert.equal(round2(0), 0));
  it('handles string number', () => assert.equal(round2('3.14159'), 3.14));
  it('handles very small float', () => {
    const result = round2(0.1 + 0.2);
    assert.equal(result, 0.3);
  });
});

describe('cents()', async () => {
  const { cents } = await import('../public/js/money.js');

  it('converts to integer cents', () => assert.equal(cents(1.23), 123));
  it('converts zero', () => assert.equal(cents(0), 0));
  it('converts falsy', () => assert.equal(cents(null), 0));
  it('handles float drift prevention', () => {
    // 1.005 * 100 without epsilon = 100.49999... would floor to 100
    // With epsilon, it rounds to 101
    assert.equal(cents(1.005), 101);
  });
  it('handles string', () => assert.equal(cents('2.50'), 250));
  it('handles negative', () => assert.equal(cents(-1.5), -150));
});

describe('clampPct()', async () => {
  const { clampPct } = await import('../public/js/money.js');

  it('returns value in range', () => assert.equal(clampPct(50), 50));
  it('clamps above 100', () => assert.equal(clampPct(150), 100));
  it('clamps below 0', () => assert.equal(clampPct(-10), 0));
  it('returns 0 for null', () => assert.equal(clampPct(null), 0));
  it('returns 0 for undefined', () => assert.equal(clampPct(undefined), 0));
  it('handles boundary 0', () => assert.equal(clampPct(0), 0));
  it('handles boundary 100', () => assert.equal(clampPct(100), 100));
  it('handles string number', () => assert.equal(clampPct('25'), 25));
});

describe('saleTotals()', async () => {
  const { saleTotals } = await import('../public/js/money.js');

  it('simple single item, no discount, no tax', () => {
    const r = saleTotals([{ unitPrice: 10, quantity: 1, discountPct: 0, taxable: false }], 0, 0);
    assert.equal(r.subtotal, 10);
    assert.equal(r.discount, 0);
    assert.equal(r.tax, 0);
    assert.equal(r.total, 10);
  });

  it('multiple items', () => {
    const r = saleTotals([
      { unitPrice: 10, quantity: 2, discountPct: 0, taxable: false },
      { unitPrice: 5, quantity: 1, discountPct: 0, taxable: false },
    ], 0, 0);
    assert.equal(r.subtotal, 25);
    assert.equal(r.total, 25);
  });

  it('line discount', () => {
    const r = saleTotals([{ unitPrice: 100, quantity: 1, discountPct: 10, taxable: false }], 0, 0);
    assert.equal(r.subtotal, 90);
    assert.equal(r.discount, 10);
    assert.equal(r.total, 90);
  });

  it('order discount', () => {
    const r = saleTotals([
      { unitPrice: 100, quantity: 1, discountPct: 0, taxable: false },
    ], 20, 0);
    assert.equal(r.subtotal, 100);
    assert.equal(r.discount, 20);
    assert.equal(r.total, 80);
  });

  it('tax on taxable items only', () => {
    const r = saleTotals([
      { unitPrice: 100, quantity: 1, discountPct: 0, taxable: true },
      { unitPrice: 50, quantity: 1, discountPct: 0, taxable: false },
    ], 0, 10);
    assert.equal(r.subtotal, 150);
    assert.equal(r.tax, 10); // 10% of 100 taxable
    assert.equal(r.total, 160);
  });

  it('order discount reduces taxable base', () => {
    const r = saleTotals([
      { unitPrice: 100, quantity: 1, discountPct: 0, taxable: true },
    ], 50, 10);
    // subtotal=100, order discount=50, taxable base=50, tax=5
    assert.equal(r.subtotal, 100);
    assert.equal(r.discount, 50);
    assert.equal(r.tax, 5);
    assert.equal(r.total, 55);
  });

  it('both line and order discounts', () => {
    const r = saleTotals([
      { unitPrice: 100, quantity: 1, discountPct: 10, taxable: true },
    ], 10, 0);
    // line: 100 - 10 = 90 net; order: 10% of 90 = 9; total = 81
    assert.equal(r.subtotal, 90);
    assert.equal(r.discount, 19); // 10 line + 9 order
    assert.equal(r.total, 81);
  });

  it('minimum quantity is 1', () => {
    const r = saleTotals([{ unitPrice: 10, quantity: 0, discountPct: 0, taxable: false }], 0, 0);
    assert.equal(r.subtotal, 10);
  });

  it('handles empty lines', () => {
    const r = saleTotals([], 0, 0);
    assert.equal(r.subtotal, 0);
    assert.equal(r.total, 0);
  });

  it('handles fractional cents correctly', () => {
    // $33.33 * 3 = $99.99
    const r = saleTotals([{ unitPrice: 33.33, quantity: 3, discountPct: 0, taxable: false }], 0, 0);
    assert.equal(r.subtotal, 99.99);
  });

  it('clamps order discount to 0-100', () => {
    const r = saleTotals([{ unitPrice: 100, quantity: 1, discountPct: 0, taxable: false }], 200, 0);
    assert.equal(r.discount, 100);
    assert.equal(r.total, 0);
  });
});

describe('kindInfo()', async () => {
  const { kindInfo } = await import('../public/js/money.js');

  it('returns sale info', () => {
    const info = kindInfo('sale');
    assert.equal(info.label, 'Sale');
    assert.equal(info.sign, 1);
  });

  it('returns refund info', () => {
    const info = kindInfo('refund');
    assert.equal(info.label, 'Refund');
    assert.equal(info.sign, -1);
  });

  it('returns payout info', () => {
    const info = kindInfo('payout');
    assert.equal(info.label, 'Paid out');
    assert.equal(info.sign, -1);
  });

  it('returns payment info', () => {
    const info = kindInfo('payment');
    assert.equal(info.label, 'Payment');
    assert.equal(info.sign, 1);
  });

  it('defaults to sale for unknown kind', () => {
    const info = kindInfo('unknown');
    assert.equal(info.label, 'Sale');
  });

  it('defaults to sale for null', () => {
    const info = kindInfo(null);
    assert.equal(info.label, 'Sale');
  });
});

/* ── Async money builders (require mocked sync) ──────────────── */

describe('createRefund()', () => {
  let createRefund;
  let idb;
  let getSyncState;
  let txId;

  before(async () => {
    ({ createRefund } = await import('../public/js/money.js'));
    ({ idb } = await import('../public/js/db.js'));
    ({ getSyncState } = await import('../public/js/sync.js'));

    setOnline(true);
    clearFetchMock();
    await idb.clear('products');
    await idb.clear('outbox');
    await idb.clear('transactions');
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

    // Seed a product to refund against
    await idb.put('products', { id: 'p1', name: 'Widget', onHand: 10, isSerialized: false }, 'p1');

    txId = await createRefund({
      original: { clientTxId: 'orig-1' },
      items: [{ productId: 'p1', quantity: 2, unitPrice: 25 }],
      method: 'cash',
      note: 'test refund',
      user: { id: 'u1', name: 'Tester' },
    });
  });

  after(() => clearFetchMock());

  it('returns a clientTxId', () => {
    assert.ok(txId);
    assert.equal(typeof txId, 'string');
  });

  it('restores stock locally', async () => {
    const prod = await idb.get('products', 'p1');
    assert.equal(prod.onHand, 12); // 10 + 2
  });

  it('records transaction in IDB', async () => {
    const tx = await idb.get('transactions', txId);
    assert.ok(tx);
    assert.equal(tx.kind, 'refund');
    assert.equal(tx.total, 50);
  });

  it('records outbox entry', async () => {
    const ob = await idb.get('outbox', txId);
    assert.ok(ob);
    assert.equal(ob.status, 'PENDING');
  });

  it('sync state shows pending', async () => {
    const state = await getSyncState();
    assert.ok(state.pending >= 1);
  });

  clearFetchMock();
});

describe('createPayout()', () => {
  let createPayout;
  let idb;
  let txId;

  before(async () => {
    ({ createPayout } = await import('../public/js/money.js'));
    ({ idb } = await import('../public/js/db.js'));

    setOnline(true);
    clearFetchMock();
    await idb.clear('outbox');
    await idb.clear('transactions');
    mockFetch(async () => jsonResponse({ ok: true, status: 200, data: { results: [] } }));

    txId = await createPayout({
      counterparty: 'Vendor A',
      grandTotal: 150.75,
      note: 'supplies',
      user: { id: 'u1', name: 'Tester' },
    });
  });

  after(() => clearFetchMock());

  it('returns a clientTxId', () => assert.ok(txId));

  it('records payout transaction', async () => {
    const tx = await idb.get('transactions', txId);
    assert.equal(tx.kind, 'payout');
    assert.equal(tx.total, 150.75);
  });

  it('records outbox entry', async () => {
    const ob = await idb.get('outbox', txId);
    assert.equal(ob.status, 'PENDING');
    assert.equal(ob.payload.kind, 'payout');
  });

  clearFetchMock();
});
