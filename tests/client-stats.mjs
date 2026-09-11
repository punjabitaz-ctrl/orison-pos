'use strict';

/* Unit tests for public/js/stats.js — the shared aggregation the Dashboard and
 * the Staff screen both read from. Pure functions, so no IDB or fetch mocks;
 * only the browser-globals shim (node --import ./tests/helpers/setup-globals.mjs). */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  kindOf, dayKey, shiftDayKey, signedNet, unitsOf, dayTotals, trend,
  baselineAverage, hourlyBuckets, tradingWindow, busiestHour, topSellers,
  withinDays, hoursFromEntries, fmtDuration,
} from '../public/js/stats.js';

/* Local-time ISO for a given day/hour so the tests read the same calendar day
 * the client does, whatever the machine's zone is. */
function localIso(dayOffset, hour = 12, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function sale(amount, opts = {}) {
  return {
    kind: 'sale',
    grandTotal: amount,
    createdAt: opts.at || localIso(0),
    grossProfit: opts.gp || 0,
    items: opts.items || [{ name: 'Cable', quantity: 1, unitPrice: amount, unitCost: 0 }],
  };
}

test('kindOf()', () => {
  assert.equal(kindOf({ kind: 'refund' }), 'refund');
  assert.equal(kindOf({}), 'sale', 'legacy rows with no kind are sales');
  assert.equal(kindOf(null), 'sale');
});

test('dayKey()', async (t) => {
  await t.test('formats a local calendar day', () => {
    const d = new Date(2026, 0, 5, 23, 30);
    assert.equal(dayKey(d.toISOString()), '2026-01-05');
  });
  await t.test('empty and unparseable input yield an empty key', () => {
    assert.equal(dayKey(''), '');
    assert.equal(dayKey('not-a-date'), '');
    assert.equal(dayKey(null), '');
  });
  await t.test('shiftDayKey walks backwards from a fixed anchor', () => {
    const anchor = new Date(2026, 2, 3, 10, 0);
    assert.equal(shiftDayKey(0, anchor), '2026-03-03');
    assert.equal(shiftDayKey(3, anchor), '2026-02-28');
  });
});

test('signedNet() — money in minus money out', () => {
  assert.equal(signedNet({ kind: 'sale', grandTotal: 100 }), 100);
  assert.equal(signedNet({ kind: 'payment', grandTotal: 40 }), 40, 'a collection is cash in');
  assert.equal(signedNet({ kind: 'refund', grandTotal: 25 }), -25);
  assert.equal(signedNet({ kind: 'payout', grandTotal: 60 }), -60);
  assert.equal(signedNet({ grandTotal: 10 }), 10, 'legacy blank kind counts as a sale');
});

test('unitsOf() defaults a missing quantity to one', () => {
  assert.equal(unitsOf({ items: [{ quantity: 3 }, { quantity: 2 }] }), 5);
  assert.equal(unitsOf({ items: [{}, {}] }), 2);
  assert.equal(unitsOf({}), 0);
});

test('dayTotals()', async (t) => {
  const today = shiftDayKey(0);
  const txs = [
    sale(100, { gp: 40, items: [{ quantity: 2, unitPrice: 50 }] }),
    sale(60, { gp: 20 }),
    { kind: 'refund', grandTotal: 30, createdAt: localIso(0), grossProfit: -10, items: [] },
    { kind: 'payout', grandTotal: 20, createdAt: localIso(0), items: [] },
    { kind: 'payment', grandTotal: 15, createdAt: localIso(0), items: [] },
    sale(999, { at: localIso(1) }),
  ];

  await t.test('splits the day by kind and ignores other days', () => {
    const d = dayTotals(txs, today);
    assert.equal(d.sales, 160);
    assert.equal(d.refunds, 30);
    assert.equal(d.payouts, 20);
    assert.equal(d.collections, 15);
    assert.equal(d.count, 5);
    assert.equal(d.tickets, 2, 'only sales are tickets');
    assert.equal(d.units, 3);
  });

  await t.test('net follows the export lines: sales + collections − refunds − payouts', () => {
    assert.equal(dayTotals(txs, today).net, 160 + 15 - 30 - 20);
  });

  await t.test('gross profit sums the server figure, refunds included', () => {
    assert.equal(dayTotals(txs, today).gp, 50);
  });

  await t.test('avgTicket divides by tickets, not by every row', () => {
    assert.equal(dayTotals(txs, today).avgTicket, 80);
  });

  await t.test('a day with no rows is all zeros, not NaN', () => {
    const empty = dayTotals(txs, '1999-01-01');
    assert.equal(empty.net, 0);
    assert.equal(empty.avgTicket, 0);
  });
});

test('trend()', async (t) => {
  await t.test('reports direction and percentage against a baseline', () => {
    const up = trend(150, 100);
    assert.equal(up.dir, 'up');
    assert.equal(up.delta, 50);
    assert.equal(up.pct, 50);
    assert.equal(trend(80, 100).dir, 'down');
    assert.equal(trend(100, 100).dir, 'flat');
  });
  await t.test('a zero baseline has no honest percentage', () => {
    const t0 = trend(75, 0);
    assert.equal(t0.pct, null);
    assert.equal(t0.delta, 75);
    assert.equal(t0.dir, 'up');
  });
  await t.test('a negative baseline still measures magnitude', () => {
    assert.equal(trend(0, -50).pct, 100);
  });
});

test('baselineAverage() excludes the day it is a baseline for', () => {
  const key = shiftDayKey(0);
  const txs = [
    sale(1000), // today — must not count
    sale(100, { at: localIso(1) }),
    sale(300, { at: localIso(2) }),
  ];
  assert.equal(baselineAverage(txs, key, 2, 'net'), 200);
  assert.equal(baselineAverage(txs, key, 0, 'net'), 0);
});

test('hourlyBuckets()', async (t) => {
  const today = shiftDayKey(0);
  const txs = [
    sale(50, { at: localIso(0, 9) }),
    sale(70, { at: localIso(0, 9, 45) }),
    sale(20, { at: localIso(0, 17) }),
    { kind: 'refund', grandTotal: 40, createdAt: localIso(0, 9), items: [] },
    sale(500, { at: localIso(1, 9) }),
  ];
  const buckets = hourlyBuckets(txs, today);

  await t.test('always 24 buckets, one per hour', () => {
    assert.equal(buckets.length, 24);
    assert.deepEqual(buckets.map((b) => b.hour).slice(0, 3), [0, 1, 2]);
  });
  await t.test('sums sales into the hour they happened', () => {
    assert.equal(buckets[9].sales, 120);
    assert.equal(buckets[9].count, 2);
    assert.equal(buckets[17].sales, 20);
  });
  await t.test('refunds and other days stay out of the bars', () => {
    assert.equal(buckets[9].sales, 120, 'the 40 refund is not netted here');
    assert.equal(buckets.reduce((s, b) => s + b.count, 0), 3);
  });

  await t.test('tradingWindow pads the active run by an hour each side', () => {
    assert.deepEqual(tradingWindow(buckets), { from: 8, to: 18 });
  });
  await t.test('tradingWindow falls back to shop hours when nothing sold', () => {
    assert.deepEqual(tradingWindow(hourlyBuckets([], today)), { from: 8, to: 20 });
  });
  await t.test('busiestHour picks the top hour by takings, or null', () => {
    assert.equal(busiestHour(buckets).hour, 9);
    assert.equal(busiestHour(hourlyBuckets([], today)), null);
  });
});

test('topSellers()', async (t) => {
  const txs = [
    sale(0, { items: [{ name: 'Phone', quantity: 1, unitPrice: 900, unitCost: 700 }] }),
    sale(0, { items: [{ name: 'Cable', quantity: 5, unitPrice: 10, unitCost: 4 }] }),
    sale(0, { items: [{ name: 'Cable', quantity: 3, unitPrice: 10, unitCost: 4 }] }),
    { kind: 'refund', grandTotal: 900, createdAt: localIso(0), items: [{ name: 'Phone', quantity: 1, unitPrice: 900 }] },
  ];
  const top = topSellers(txs, 5);

  await t.test('ranks by revenue and tallies units across sales', () => {
    assert.equal(top[0].name, 'Phone');
    assert.equal(top[1].name, 'Cable');
    assert.equal(top[1].units, 8);
    assert.equal(top[1].rev, 80);
  });
  await t.test('refund lines are not units sold', () => {
    assert.equal(top[0].units, 1);
  });
  await t.test('margin is gross profit over revenue', () => {
    assert.equal(top[0].gp, 200);
    assert.equal(Math.round(top[1].margin), 60);
  });
  await t.test('honours the limit and survives empty input', () => {
    assert.equal(topSellers(txs, 1).length, 1);
    assert.deepEqual(topSellers([], 5), []);
  });
});

test('withinDays() keeps only the recent window', () => {
  const anchor = new Date(2026, 5, 30, 12, 0);
  const txs = [
    { createdAt: new Date(2026, 5, 29, 10).toISOString() },
    { createdAt: new Date(2026, 5, 1, 10).toISOString() },
    { createdAt: 'garbage' },
  ];
  const kept = withinDays(txs, 7, anchor);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].createdAt, new Date(2026, 5, 29, 10).toISOString());
});

test('hoursFromEntries()', async (t) => {
  const now = Date.parse('2026-06-30T18:00:00.000Z');
  await t.test('sums the recorded minutes of closed entries', () => {
    const hrs = hoursFromEntries([
      { status: 'CLOSED', minutes: 90, clockIn: '2026-06-30T08:00:00.000Z', clockOut: '2026-06-30T09:30:00.000Z' },
      { status: 'CLOSED', minutes: 30, clockIn: '2026-06-30T10:00:00.000Z', clockOut: '2026-06-30T10:30:00.000Z' },
    ], now);
    assert.equal(hrs, 2);
  });
  await t.test('an open entry counts up to now, so live hours are visible', () => {
    assert.equal(hoursFromEntries([{ status: 'OPEN', clockIn: '2026-06-30T15:00:00.000Z', clockOut: '' }], now), 3);
  });
  await t.test('unparseable or reversed stamps contribute nothing', () => {
    assert.equal(hoursFromEntries([
      { status: 'OPEN', clockIn: 'nonsense' },
      { status: 'CLOSED', clockIn: '2026-06-30T12:00:00.000Z', clockOut: '2026-06-30T11:00:00.000Z' },
    ], now), 0);
    assert.equal(hoursFromEntries([], now), 0);
    assert.equal(hoursFromEntries(null, now), 0);
  });
});

test('fmtDuration()', () => {
  assert.equal(fmtDuration(0), '0m');
  assert.equal(fmtDuration(0.5), '30m');
  assert.equal(fmtDuration(1), '1h');
  assert.equal(fmtDuration(2.25), '2h 15m');
  assert.equal(fmtDuration(-3), '0m', 'a negative span reads as nothing worked');
});

test('dayTotals() splits cash out by reason (v1.19.0)', async (t) => {
  const today = shiftDayKey(0);
  const txs = [
    sale(200),
    { kind: 'payout', grandTotal: 30, createdAt: localIso(0), items: [] },
    { kind: 'pickup', grandTotal: 50, createdAt: localIso(0), items: [] },
    { kind: 'expense', grandTotal: 20, createdAt: localIso(0), items: [] },
  ];
  const d = dayTotals(txs, today);

  await t.test('each reason lands on its own figure', () => {
    assert.equal(d.payouts, 30);
    assert.equal(d.pickups, 50);
    assert.equal(d.expenses, 20);
  });
  await t.test('cashOut totals the three', () => {
    assert.equal(d.cashOut, 100);
  });
  await t.test('net loses every reason, not just paid-out', () => {
    assert.equal(d.net, 100);
  });
  await t.test('a pick-up and an expense are money out, like a payout', () => {
    assert.equal(signedNet({ kind: 'pickup', grandTotal: 50 }), -50);
    assert.equal(signedNet({ kind: 'expense', grandTotal: 20 }), -20);
  });
});
