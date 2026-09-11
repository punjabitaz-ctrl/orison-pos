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
  await t.test('an admin sees everything a manager sees, plus the admin-only ones', () => {
    const admin = menuTiles('admin').map((x) => x.id);
    const manager = menuTiles('manager').map((x) => x.id);
    for (const id of manager) assert.ok(admin.includes(id), `admin is missing ${id}`);
    assert.ok(admin.includes('audit'), 'the audit log is an admin destination');
    assert.ok(!manager.includes('audit'), 'a manager must not see the audit log');
  });
  await t.test('a cashier sees only what their role may open', () => {
    // Repairs is counter work: a cashier books a device in with the customer
    // standing there. Money out and management stay off this list.
    assert.deepEqual(menuTiles('cashier').map((x) => x.id), ['staff', 'repairs', 'dashboard', 'settings']);
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

import { ICONS, icon, tile, tileGrid, navButton, appHeaderHtml } from '../public/js/components.js';

test('icon()', async (t) => {
  await t.test('every destination and bar slot has an icon', () => {
    for (const id of ['menu', 'register', 'history', ...menuTiles('admin').map((x) => x.id)]) {
      assert.match(icon(id), /^<svg /, `${id} has no icon`);
    }
  });
  await t.test('an unknown id still renders something rather than breaking the grid', () => {
    assert.match(icon('nope'), /^<svg /);
  });
  await t.test('the icon table has no empty entries', () => {
    for (const [id, svg] of Object.entries(ICONS)) {
      assert.ok(svg && svg.length > 40, `${id} icon looks empty`);
    }
  });
});

test('tile()', async (t) => {
  await t.test('carries the id as a data attribute the screen can route on', () => {
    assert.ok(tile({ id: 'reports', label: 'Reports' }).includes('data-go="reports"'));
  });
  await t.test('escapes the label', () => {
    const html = tile({ id: 'x', label: '<script>bad</script>' });
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!html.includes('<script>bad'));
  });
  await t.test('escapes the id, which lands inside an attribute', () => {
    assert.ok(!tile({ id: 'a"onclick="x', label: 'A' }).includes('onclick="x'));
  });
});

test('tileGrid()', async (t) => {
  await t.test('renders one tile per destination', () => {
    const tiles = menuTiles('admin');
    assert.equal((tileGrid(tiles).match(/class="mtile"/g) || []).length, tiles.length);
  });
  await t.test('an empty set renders an empty grid, not undefined', () => {
    assert.equal(typeof tileGrid([]), 'string');
    assert.ok(!tileGrid([]).includes('undefined'));
    assert.ok(!tileGrid(null).includes('undefined'));
  });
});

test('navButton()', async (t) => {
  await t.test('marks the primary slot so it can be styled heavier', () => {
    assert.ok(navButton({ id: 'menu', label: 'Menu', primary: true }).includes('tab-primary'));
    assert.ok(!navButton({ id: 'register', label: 'Sell', primary: false }).includes('tab-primary'));
  });
  await t.test('every button carries data-tab and an accessible name', () => {
    const html = navButton({ id: 'register', label: 'Sell', primary: false });
    assert.ok(html.includes('data-tab="register"'));
    assert.ok(html.includes('aria-label="Sell"'));
  });
});

test('appHeaderHtml()', async (t) => {
  await t.test('shows the store, a clock slot, a status slot and the user', () => {
    const html = appHeaderHtml({ storeName: 'Orison Electronics', userName: 'Amara Njoku', role: 'cashier' });
    assert.ok(html.includes('Orison Electronics'));
    assert.ok(html.includes('id="appClock"'));
    assert.ok(html.includes('id="appStatus"'));
    assert.ok(html.includes('>A<'), 'user initial');
  });
  await t.test('escapes every field it is given', () => {
    const html = appHeaderHtml({ storeName: '<b>x</b>', userName: '"><b>y', role: 'admin' });
    assert.ok(!html.includes('<b>x</b>'));
    assert.ok(html.includes('&lt;b&gt;'));
  });
  await t.test('survives a missing user, which is the signed-out state', () => {
    const html = appHeaderHtml({ storeName: 'Shop' });
    assert.equal(typeof html, 'string');
    assert.ok(!html.includes('undefined'));
    assert.equal(typeof appHeaderHtml(), 'string');
  });
});

import { catColor, categoryChip, productTile, cartBar } from '../public/js/components.js';

const money = (v) => '$' + Number(v || 0).toFixed(2);

test('catColor()', async (t) => {
  await t.test('the same category always gets the same colour', () => {
    assert.equal(catColor('Phones'), catColor('Phones'));
  });
  await t.test('different categories generally differ', () => {
    const seen = new Set(['Phones', 'Cables', 'Audio', 'Laptops', 'Tablets'].map(catColor));
    assert.ok(seen.size >= 4, 'too many collisions across five common categories');
  });
  await t.test('always returns a hex colour, even for empty or odd input', () => {
    for (const c of ['', undefined, null, 'A', 'a very long category name indeed']) {
      assert.match(catColor(c), /^#[0-9a-f]{6}$/i, `bad colour for ${JSON.stringify(c)}`);
    }
  });
});

test('categoryChip()', async (t) => {
  await t.test('carries the category and marks the active one', () => {
    assert.ok(categoryChip({ label: 'Audio', active: true }).includes('data-cat="Audio"'));
    assert.ok(categoryChip({ label: 'Audio', active: true }).includes(' on'));
    assert.ok(!categoryChip({ label: 'Audio', active: false }).includes(' on'));
  });
  await t.test('escapes the label', () => {
    assert.ok(!categoryChip({ label: '<b>x' }).includes('<b>x'));
  });
});

test('productTile()', async (t) => {
  const base = { id: 'p1', name: 'USB-C Cable', category: 'Cables', retailPrice: 9.99, onHand: 4, itemType: 'product' };

  await t.test('shows name, price and stock, and routes by id', () => {
    const html = productTile(base, { fmt: money });
    assert.ok(html.includes('data-add="p1"'));
    assert.ok(html.includes('USB-C Cable'));
    assert.ok(html.includes('$9.99'));
    assert.ok(html.includes('4'));
  });
  await t.test('marks an out-of-stock product without removing the control', () => {
    const html = productTile({ ...base, onHand: 0 }, { fmt: money });
    assert.ok(html.includes('out'), 'needs the dimmed class');
    assert.ok(!html.includes('disabled'), 'stays tappable so the toast can explain why');
  });
  await t.test('a serialized product counts its serials and carries the IMEI badge', () => {
    const html = productTile({ ...base, isSerialized: true, serials: ['a', 'b'], onHand: 99 }, { fmt: money });
    assert.ok(html.includes('IMEI'));
    assert.ok(html.includes('2'), 'serial count, not the stale onHand');
  });
  await t.test('a service carries no stock figure', () => {
    const html = productTile({ ...base, itemType: 'service', onHand: 0 }, { fmt: money });
    assert.ok(html.includes('Service'));
    assert.ok(!html.includes('in stock'));
  });
  await t.test('a locked product says so', () => {
    assert.ok(productTile({ ...base, locked: 1 }, { fmt: money }).includes('Locked'));
  });
  await t.test('escapes the name and the category', () => {
    const html = productTile({ ...base, name: '<script>x</script>', category: '"><b>' }, { fmt: money });
    assert.ok(!html.includes('<script>x'));
    assert.ok(html.includes('&lt;script&gt;'));
  });
});

test('cartBar()', async (t) => {
  await t.test('shows the count and the total', () => {
    const html = cartBar({ count: 3, total: 124, fmt: money });
    assert.ok(html.includes('3'));
    assert.ok(html.includes('$124.00'));
    assert.ok(html.includes('data-open-cart'));
    assert.ok(html.includes('data-charge'));
  });
  await t.test('pluralises honestly', () => {
    assert.ok(cartBar({ count: 1, total: 5, fmt: money }).includes('1 item'));
    assert.ok(!cartBar({ count: 1, total: 5, fmt: money }).includes('1 items'));
  });
  await t.test('an empty cart renders nothing at all', () => {
    assert.equal(cartBar({ count: 0, total: 0, fmt: money }), '');
  });
});

test('the three money-out reasons are separate destinations (v1.19.0)', async (t) => {
  await t.test('a manager sees all three, each opening its own dialog', () => {
    const tiles = menuTiles('manager');
    for (const id of ['payout', 'pickup', 'expense']) {
      const hit = tiles.find((x) => x.id === id);
      assert.ok(hit, `manager is missing ${id}`);
      assert.equal(hit.dialog, id, `${id} must open its own dialog, not another reason's`);
    }
  });
  await t.test('a cashier sees none of them', () => {
    const ids = menuTiles('cashier').map((x) => x.id);
    for (const id of ['payout', 'pickup', 'expense']) {
      assert.ok(!ids.includes(id), `cashier must not see ${id}`);
    }
  });
  await t.test('each has its own icon, so the tiles are not three identical squares', () => {
    assert.notEqual(icon('payout'), icon('pickup'));
    assert.notEqual(icon('pickup'), icon('expense'));
  });
  await t.test('their labels are plain words that fit a tile', () => {
    for (const id of ['payout', 'pickup', 'expense']) {
      const hit = menuTiles('admin').find((x) => x.id === id);
      assert.ok(hit.label.length <= 16, `${id} label too long`);
    }
  });
});

import { screenHead, sectionHead, statRow, rankRow, rankList, dataTable } from '../public/js/components.js';

test('screenHead()', async (t) => {
  await t.test('renders the title and an escaped subtitle', () => {
    const html = screenHead({ title: 'Reports', sub: 'Manager analytics' });
    assert.ok(html.includes('<h2>Reports</h2>'));
    assert.ok(html.includes('<p>Manager analytics</p>'));
  });
  await t.test('escapes both the title and the plain subtitle', () => {
    const html = screenHead({ title: '<b>T', sub: '<i>S' });
    assert.ok(!html.includes('<b>T'));
    assert.ok(!html.includes('<i>S'));
    assert.ok(html.includes('&lt;b&gt;T'));
  });
  await t.test('subHtml is the explicit opt-in for composed markup', () => {
    assert.ok(screenHead({ title: 'X', subHtml: '<strong class="gp">$5</strong>' }).includes('<strong class="gp">'));
  });
  await t.test('omits the subtitle line entirely when there is none', () => {
    assert.ok(!screenHead({ title: 'Settings' }).includes('<p>'));
  });
  await t.test('passes screen actions through as markup', () => {
    assert.ok(screenHead({ title: 'X', actions: '<button id="go">Go</button>' }).includes('id="go"'));
  });
});

test('sectionHead()', async (t) => {
  await t.test('escapes the title and the plain aside', () => {
    const html = sectionHead({ title: '<b>T', aside: '<i>A' });
    assert.ok(!html.includes('<b>T'));
    assert.ok(!html.includes('<i>A'));
  });
  await t.test('asideHtml carries composed markup such as a segment control', () => {
    assert.ok(sectionHead({ title: 'X', asideHtml: '<div class="seg"></div>' }).includes('class="seg"'));
  });
  await t.test('renders without an aside', () => {
    assert.ok(sectionHead({ title: 'Shift' }).includes('<h3>Shift</h3>'));
  });
});

test('statRow()', async (t) => {
  await t.test('renders one stat per entry with escaped labels', () => {
    const html = statRow([{ label: 'Open now', value: 2 }, { label: '<b>x', value: 'y' }]);
    assert.equal((html.match(/class="stat"/g) || []).length, 2);
    assert.ok(!html.includes('<b>x'));
  });
  await t.test('carries a class onto the figure for gp/neg colouring', () => {
    assert.ok(statRow([{ label: 'Over', value: '+5', cls: 'gp' }]).includes('class="gp"'));
  });
  await t.test('survives an empty set', () => {
    assert.ok(!statRow([]).includes('undefined'));
    assert.ok(!statRow(null).includes('undefined'));
  });
});

test('rankRow() and rankList()', async (t) => {
  await t.test('renders name and meta, both escaped', () => {
    const html = rankRow({ name: '<b>N', meta: '<i>M' });
    assert.ok(!html.includes('<b>N'));
    assert.ok(!html.includes('<i>M'));
    assert.ok(html.includes('rank-name'));
  });
  await t.test('the index is optional, and takes a class when present', () => {
    assert.ok(!rankRow({ name: 'x' }).includes('rank-idx'));
    const html = rankRow({ idx: 3, idxCls: 'warn', name: 'x' });
    assert.ok(html.includes('rank-idx warn'));
    assert.ok(html.includes('>3<'));
  });
  await t.test('an index of zero still renders, because zero is a real count', () => {
    assert.ok(rankRow({ idx: 0, name: 'Out of stock' }).includes('rank-idx'));
  });
  await t.test('rightHtml carries the screen-built trailing figure', () => {
    assert.ok(rankRow({ name: 'x', rightHtml: '<b class="neg">-5</b>' }).includes('class="neg"'));
  });
  await t.test('rankList renders one row per entry and survives empty', () => {
    assert.equal((rankList([{ name: 'a' }, { name: 'b' }]).match(/class="rank-row"/g) || []).length, 2);
    assert.ok(!rankList([]).includes('undefined'));
  });
});

test('dataTable()', async (t) => {
  await t.test('wraps the table and right-aligns numeric columns', () => {
    const html = dataTable({ head: [{ label: 'Item' }, { label: 'Units', num: true }], bodyHtml: '<tr><td>a</td></tr>' });
    assert.ok(html.includes('class="table-wrap"'));
    assert.ok(html.includes('<th>Item</th>'));
    assert.ok(html.includes('<th class="num">Units</th>'));
  });
  await t.test('escapes column labels', () => {
    assert.ok(!dataTable({ head: [{ label: '<b>x' }] }).includes('<b>x'));
  });
  await t.test('the footer is optional', () => {
    assert.ok(!dataTable({ head: [], bodyHtml: '' }).includes('<tfoot>'));
    assert.ok(dataTable({ bodyHtml: '', footHtml: '<tr><td>t</td></tr>' }).includes('<tfoot>'));
  });
  await t.test('renders without a head, for a table that is all body', () => {
    assert.ok(!dataTable({ bodyHtml: '<tr></tr>' }).includes('<thead>'));
  });
});
