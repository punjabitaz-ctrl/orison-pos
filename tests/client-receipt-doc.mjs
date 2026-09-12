import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { receiptDoc } = await import('../public/js/receipt-doc.js');

const at = '2026-09-12T14:15:00.000Z';
const sale = {
  kind: 'sale',
  createdAt: at,
  cashier: 'Amara Njoku',
  customerName: 'Priya Sharma',
  items: [
    { name: 'USB-C cable', quantity: 2, unitPrice: 12.5 },
    { name: 'Pixel 7', quantity: 1, unitPrice: 400, serialNumber: 'IMEI-1', discountPct: 10 },
  ],
  subtotal: 385,
  discount: 40,
  taxAmount: 0,
  taxRate: 0,
  total: 385,
  tenders: [{ type: 'cash', amount: 400 }],
  receiptNo: 'Orison-S000123',
  clientTxId: 'tx-abc',
};
const ctx = { storeName: 'Main Street' };

describe('receiptDoc()', () => {
  it('carries the brand and the store', () => {
    const d = receiptDoc(sale, ctx);
    assert.equal(d.brand, 'ORISON ELECTRONICS');
    assert.equal(d.store, 'Main Street');
  });

  it('names the cashier and the customer', () => {
    const d = receiptDoc(sale, ctx);
    assert.ok(d.meta.includes('Cashier: Amara Njoku'));
    assert.ok(d.meta.includes('Customer: Priya Sharma'));
  });

  it('puts the serial on the line so the unit sold is on paper', () => {
    const d = receiptDoc(sale, ctx);
    assert.equal(d.lines[1].name, 'Pixel 7 [IMEI-1]');
  });

  it('prices each line after its own discount, in whole cents', () => {
    const d = receiptDoc(sale, ctx);
    assert.equal(d.lines[0].amount, 25);
    assert.equal(d.lines[1].amount, 360);
  });

  it('shows quantity and discount detail only when there is some', () => {
    const d = receiptDoc(sale, ctx);
    assert.equal(d.lines[0].qty, 2);
    assert.equal(d.lines[0].discountPct, 0);
    assert.equal(d.lines[1].qty, 1);
    assert.equal(d.lines[1].discountPct, 10);
  });

  it('shows a discount line only when there was a discount', () => {
    assert.ok(receiptDoc(sale, ctx).totals.some((t) => t.key === 'discount'));
    assert.ok(!receiptDoc({ ...sale, discount: 0 }, ctx).totals.some((t) => t.key === 'discount'));
  });

  it('shows tax only when the store charges it', () => {
    assert.ok(!receiptDoc(sale, ctx).totals.some((t) => t.key === 'tax'));
    const taxed = receiptDoc({ ...sale, taxAmount: 27.91, taxRate: 7.25, total: 412.91 }, ctx);
    const tax = taxed.totals.find((t) => t.key === 'tax');
    assert.equal(tax.amount, 27.91);
    assert.equal(tax.rate, 7.25);
  });

  it('marks the total as the strong line', () => {
    const total = receiptDoc(sale, ctx).totals.find((t) => t.key === 'total');
    assert.equal(total.amount, 385);
    assert.equal(total.strong, true);
  });

  it('gives change back when the customer handed over more', () => {
    assert.equal(receiptDoc(sale, ctx).change, 15);
    assert.equal(receiptDoc({ ...sale, tenders: [{ type: 'card', amount: 385 }] }, ctx).change, 0);
  });

  it('labels a repair deposit as applied, not as a bare key', () => {
    const d = receiptDoc({ ...sale, tenders: [{ type: 'deposit', amount: 50 }, { type: 'cash', amount: 335 }] }, ctx);
    assert.deepEqual(d.tenders.map((t) => t.label), ['Deposit applied', 'Cash']);
  });

  it('labels every tender the till can take', () => {
    const d = receiptDoc({
      ...sale,
      tenders: ['cash', 'card', 'transfer', 'store_credit', 'net30', 'account'].map((type) => ({ type, amount: 1 })),
    }, ctx);
    for (const t of d.tenders) assert.ok(!t.label.includes('_'), `${t.label} is a key`);
  });

  it('prints the receipt number when it has one', () => {
    const d = receiptDoc(sale, ctx);
    assert.equal(d.reference, 'Orison-S000123');
    assert.equal(d.pending, false);
  });

  it('says the number is pending when an offline sale has not synced', () => {
    const d = receiptDoc({ ...sale, receiptNo: '' }, ctx);
    assert.equal(d.reference, '# tx-abc');
    assert.equal(d.pending, true);
  });

  it('accepts translated labels without changing the numbers', () => {
    const labels = { cashier: 'الكاشير', total: 'المجموع', thanks: 'شكراً' };
    const d = receiptDoc(sale, { ...ctx, labels });
    assert.ok(d.meta.includes('الكاشير: Amara Njoku'));
    assert.equal(d.totals.find((t) => t.key === 'total').label, 'المجموع');
    assert.equal(d.totals.find((t) => t.key === 'total').amount, 385);
    assert.deepEqual(d.footer, ['شكراً']);
  });
});
