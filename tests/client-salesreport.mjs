import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  drillFilter, activeFilters, queryString, salesCsv, summaryCsv, localStamp, EMPTY_FILTERS, GROUPS,
} from '../public/js/screens/salesreport.js';

test('drillFilter() - tapping a breakdown row narrows the report to it', async (t) => {
  await t.test('staff, category, product, payment, channel and customer drill in', () => {
    assert.deepEqual(drillFilter('staff', 'u-1'), { userId: 'u-1' });
    assert.deepEqual(drillFilter('category', 'Phones'), { category: 'Phones' });
    assert.deepEqual(drillFilter('product', 'p-9'), { productId: 'p-9' });
    assert.deepEqual(drillFilter('tender', 't:card'), { tender: 'card' });
    assert.deepEqual(drillFilter('channel', 'online'), { channel: 'online' });
    assert.deepEqual(drillFilter('customer', 'c-4'), { customerId: 'c-4' });
  });
  await t.test('days, hours, walk-ins and nameless items are not filters', () => {
    assert.equal(drillFilter('day', '2026-09-16'), null);
    assert.equal(drillFilter('hour', '09'), null);
    assert.equal(drillFilter('customer', 'walk-in'), null);
    assert.equal(drillFilter('product', 'name:Gift wrap'), null);
  });
});

test('activeFilters() and queryString()', async (t) => {
  await t.test('counts only the filters that are set', () => {
    assert.equal(activeFilters(EMPTY_FILTERS), 0);
    assert.equal(activeFilters({ ...EMPTY_FILTERS, category: 'Phones', kind: 'refund' }), 2);
  });
  await t.test('sends the period, grouping, paging and only the filters that are set', () => {
    const q = new URLSearchParams(queryString({ from: '2026-09-01', to: '2026-09-16' }, { ...EMPTY_FILTERS, userId: 'u 1' }, 'staff', 100, 50));
    assert.equal(q.get('from'), '2026-09-01');
    assert.equal(q.get('groupBy'), 'staff');
    assert.equal(q.get('offset'), '100');
    assert.equal(q.get('limit'), '50');
    assert.equal(q.get('userId'), 'u 1');
    assert.equal(q.has('category'), false);
  });
  await t.test('staff grouping is for managers only', () => {
    assert.equal(GROUPS.find((g) => g.id === 'staff').store, true);
  });
});

const sample = {
  period: { from: '2026-09-16T04:00:00.000Z', to: '2026-09-17T03:59:59.999Z' },
  groupBy: 'category',
  canSeeCost: true,
  summary: { salesCount: 1, refundCount: 1, grossSales: 73.44, refunds: 54, netSales: 19.44, tax: 1.44, discounts: 2, netExTax: 18,
    unitsSold: 3, unitsReturned: 1, avgSale: 73.44, itemsPerSale: 3, cost: 4, grossProfit: 14, margin: 77.8 },
  groups: [{ key: 'Cables', label: 'Cables', sales: 1, refunds: 0, units: 2, gross: 19.44, refundsAmount: 0, net: 19.44, share: 100, grossProfit: 14, margin: 77.8 }],
  rows: [
    { kind: 'sale', receiptNo: 'Orison-S000101', originalReceiptNo: '', createdAt: '2026-09-16T15:04:00.000Z', staff: 'Amara Njoku', customer: 'SR Buyer, Inc.',
      channel: 'in_store', tenders: [{ type: 'card', amount: 73.44 }],
      lines: [
        { name: 'SR Phone', sku: 'SR-PH', category: 'Phones', serialNumber: '', qty: 1, unitPrice: 50, discount: 0, tax: 4, total: 54, cost: 10, grossProfit: 40 },
        { name: '=SUM(A1)', sku: 'SR-CB', category: 'Cables', serialNumber: '', qty: 2, unitPrice: 10, discount: 2, tax: 1.44, total: 19.44, cost: 4, grossProfit: 14 },
      ] },
  ],
};

test('salesCsv() - one row per line, with its sale', async (t) => {
  const csv = salesCsv(sample).split('\n');
  await t.test('has stable English columns, with cost and profit for managers', () => {
    assert.equal(csv[0], 'date,time,type,receipt,refund_of,staff,customer,channel,payment,item,sku,category,serial,qty,unit_price,discount,tax,line_total,cost,gross_profit');
  });
  await t.test('writes each line of the sale', () => {
    assert.equal(csv.length, 3);
    const [date, time] = localStamp('2026-09-16T15:04:00.000Z');
    assert.ok(csv[1].startsWith(`${date},${time},"sale","Orison-S000101","","Amara Njoku","SR Buyer, Inc.","in_store","card 73.44","SR Phone"`), csv[1]);
    assert.ok(csv[1].endsWith(',1,50.00,0.00,4.00,54.00,10.00,40.00'), csv[1]);
  });
  await t.test('a cell that looks like a formula cannot run in a spreadsheet', () => {
    assert.ok(!/,"?=SUM/.test(csv[2]), csv[2]);
  });
  await t.test('a refund\u2019s negative money stays a number, not text', () => {
    const refund = { ...sample, rows: [{ ...sample.rows[0], kind: 'refund', lines: [{ ...sample.rows[0].lines[0], tax: -4, total: -54, cost: -10, grossProfit: -40 }] }] };
    assert.ok(salesCsv(refund).split('\n')[1].endsWith(',-4.00,-54.00,-10.00,-40.00'));
  });
  await t.test('a cashier’s export has no cost columns', () => {
    const mine = salesCsv({ ...sample, canSeeCost: false }).split('\n');
    assert.ok(!mine[0].includes('cost'));
    assert.ok(mine[1].endsWith(',54.00'), mine[1]);
  });
});

test('localStamp() - the till\u2019s local date and time', () => {
  const d = new Date(2026, 8, 16, 9, 5);
  assert.deepEqual(localStamp(d.toISOString()), ['2026-09-16', '09:05']);
  assert.deepEqual(localStamp('not a date'), ['', '']);
});

test('summaryCsv() - the headline figures and the breakdown', () => {
  const csv = summaryCsv(sample, (g) => g.label).split('\n');
  assert.ok(csv.includes('net_sales,19.44'));
  assert.ok(csv.includes('margin_pct,77.8'));
  assert.ok(csv.includes('BY_CATEGORY'));
  assert.ok(csv.includes('"Cables",1,0,2,19.44,0.00,19.44,100,14.00,77.8'), csv.join(' | '));
});
