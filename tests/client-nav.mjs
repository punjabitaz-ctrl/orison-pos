'use strict';

/* Units for the navigation model and the components that render it. The whole
 * point of nav.js is that the shape of the app's navigation - how many things
 * are on the bar, what a role may reach - is data, so it can be asserted here
 * rather than discovered by tapping around a phone. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DESTINATIONS, primaryTabs, menuTiles, isRestricted } from '../public/js/nav.js';

test('primaryTabs()', async (t) => {
  await t.test('is always exactly three items, whatever the role', () => {
    for (const role of ['admin', 'manager', 'cashier', 'nonsense', undefined]) {
      assert.equal(primaryTabs(role).length, 3, `role ${role} did not get three tabs`);
    }
  });
  await t.test('is the same three for everyone, so nothing has to be learned', () => {
    assert.deepEqual(primaryTabs('cashier').map((x) => x.id), ['menu', 'register', 'history']);
    assert.deepEqual(primaryTabs('admin').map((x) => x.id), ['menu', 'register', 'history']);
  });
  await t.test('menu is first and marked primary', () => {
    const tabs = primaryTabs('cashier');
    assert.equal(tabs[0].id, 'menu');
    assert.equal(tabs[0].primary, true);
    assert.equal(tabs[1].primary, false);
  });
  await t.test('hands back copies, so a caller cannot mutate the model', () => {
    primaryTabs('admin')[0].label = 'Hacked';
    assert.equal(primaryTabs('admin')[0].label, 'Menu');
  });
});

test('menuTiles()', async (t) => {
  await t.test('a manager sees every destination', () => {
    const ids = menuTiles('manager').map((x) => x.id);
    for (const id of ['refund', 'payout', 'staff', 'customers', 'inventory', 'alerts', 'purchases', 'reports', 'dashboard', 'settings']) {
      assert.ok(ids.includes(id), `manager is missing ${id}`);
    }
  });
  await t.test('an admin sees the same set as a manager', () => {
    assert.deepEqual(menuTiles('admin').map((x) => x.id), menuTiles('manager').map((x) => x.id));
  });
  await t.test('a cashier sees only what their role may open', () => {
    assert.deepEqual(menuTiles('cashier').map((x) => x.id), ['staff', 'dashboard', 'settings']);
  });
  await t.test('an unknown role is treated as a cashier, not as an admin', () => {
    assert.deepEqual(menuTiles('nonsense').map((x) => x.id), menuTiles('cashier').map((x) => x.id));
    assert.deepEqual(menuTiles(undefined).map((x) => x.id), menuTiles('cashier').map((x) => x.id));
  });
  await t.test('no tile duplicates a bar slot', () => {
    const bar = primaryTabs('admin').map((x) => x.id);
    assert.ok(menuTiles('admin').every((x) => !bar.includes(x.id)));
  });
  await t.test('every tile names a real destination with a label that fits', () => {
    for (const tile of menuTiles('admin')) {
      assert.ok(tile.screen, `${tile.id} has no screen`);
      assert.ok(tile.label && tile.label.length <= 16, `${tile.id} label is missing or too long to fit a tile`);
    }
  });
});

test('isRestricted()', () => {
  assert.equal(isRestricted('reports', 'cashier'), true);
  assert.equal(isRestricted('reports', 'manager'), false);
  assert.equal(isRestricted('reports', 'admin'), false);
  assert.equal(isRestricted('settings', 'cashier'), false);
  assert.equal(isRestricted('nosuchthing', 'cashier'), false, 'an unknown id is not secret, it is absent');
});

test('DESTINATIONS is internally consistent', () => {
  const ids = DESTINATIONS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate destination id');
  for (const d of DESTINATIONS) {
    assert.ok(d.id && d.label && d.screen, `incomplete destination ${JSON.stringify(d)}`);
    assert.ok(d.roles === null || Array.isArray(d.roles), `${d.id} has a bad roles field`);
  }
});
