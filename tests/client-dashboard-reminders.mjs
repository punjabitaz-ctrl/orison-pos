import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remindersHtml } from '../public/js/screens/dashboard.js';

/* The Dashboard reads what api.get() returns, and api.get() already unwraps
   the envelope. Reading `.data` off the payload made this panel render
   nothing at all from v1.55.0 until v1.55.2 — the whole feature was invisible
   while every server test passed. These hold the panel itself. */
const money = (n) => `$${Number(n).toFixed(2)}`;

const payload = {
  warrantyExpiring: [{ device: 'Pixel 8a', serialNumber: 'IMEI-1', customer: 'Maya Patel', expiresAt: '2026-10-10', daysLeft: 9 }],
  repairsReady: [{ ticketNo: 'Orison-R000002', customer: 'James Okafor', device: 'Galaxy S21', deposit: 0, daysWaiting: 3 }],
  upgradeCandidates: [{ customer: 'Omar Haddad', device: 'iPhone 12', soldAt: '2025-01-05', serialNumber: 'IMEI-2' }],
  storeCreditLeft: [{ customerId: 'c1', customer: 'Fatima Credit', storeCredit: 20 }],
};

test('remindersHtml() - the manager\'s morning list', async (t) => {
  await t.test('nothing from the server means no panel, not a broken one', () => {
    assert.equal(remindersHtml(null, money), '');
    assert.equal(remindersHtml(undefined, money), '');
  });
  await t.test('a payload renders the panel', () => {
    const html = remindersHtml(payload, money);
    assert.ok(html.length > 0, 'expected markup');
    assert.match(html, /James Okafor/);
    assert.match(html, /Maya Patel/);
    assert.match(html, /Fatima Credit/);
  });
  await t.test('an empty list still renders, so the shop knows it is clear', () => {
    const html = remindersHtml({ warrantyExpiring: [], repairsReady: [], upgradeCandidates: [], storeCreditLeft: [] }, money);
    assert.ok(html.length > 0);
  });
  await t.test('a partial payload does not throw on the missing lists', () => {
    assert.doesNotThrow(() => remindersHtml({ repairsReady: payload.repairsReady }, money));
  });
  await t.test('a clickable row carries one class attribute, not two', () => {
    const html = remindersHtml(payload, money);
    for (const row of html.match(/<div class="rank-row[^>]*>/g) || []) {
      assert.equal((row.match(/class=/g) || []).length, 1, row);
      assert.match(row, /rem-click/, row);
    }
  });
});
