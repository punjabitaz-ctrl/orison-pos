'use strict';

/* Unit tests for public/js/labels.js — the Code 128-B encoder behind shelf
 * labels. A mistyped width in the pattern table would print a barcode that no
 * scanner reads, so the structural invariants of the symbology are asserted
 * directly rather than trusted. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodable, code128bValues, code128bBars, moduleCount, barcodeSvg,
  labelCode, labelsFor, labelSheetHtml,
} from '../public/js/labels.js';

test('the pattern table obeys the symbology', async (t) => {
  /* Every Code 128 symbol is 11 modules wide; the stop pattern is 13. Walking
   * the whole alphabet through moduleCount would hide a bad entry, so the
   * table is measured one symbol at a time via single-character messages. */
  await t.test('a one-character message is start + data + check + stop = 46 modules', () => {
    assert.equal(moduleCount('A'), 11 * 3 + 13);
  });
  await t.test('each extra character adds exactly 11 modules', () => {
    assert.equal(moduleCount('AB') - moduleCount('A'), 11);
    assert.equal(moduleCount('ABCDEF') - moduleCount('ABCDE'), 11);
  });
  await t.test('every printable character encodes to exactly 46 modules', () => {
    for (let c = 32; c <= 126; c++) {
      const ch = String.fromCharCode(c);
      assert.equal(moduleCount(ch), 46, `char ${c} (${ch}) has a bad pattern width`);
    }
  });
  await t.test('runs alternate bar, space, bar … and start with a bar', () => {
    const runs = code128bBars('SKU-1234');
    assert.equal(runs[0].bar, true);
    runs.forEach((r, i) => {
      assert.equal(r.bar, i % 2 === 0, `run ${i} broke the alternation`);
      assert.ok(r.width >= 1 && r.width <= 4, `run ${i} has an impossible width ${r.width}`);
    });
  });
  await t.test('the symbol ends on a bar, as Code 128 requires', () => {
    const runs = code128bBars('X');
    assert.equal(runs[runs.length - 1].bar, true);
  });
});

test('code128bValues()', async (t) => {
  await t.test('wraps the data in start-B, the check symbol and stop', () => {
    const v = code128bValues('A');
    assert.equal(v[0], 104, 'start B');
    assert.equal(v[1], 'A'.charCodeAt(0) - 32, 'A is value 33');
    assert.equal(v[v.length - 1], 106, 'stop');
    assert.equal(v.length, 4);
  });
  await t.test('the check symbol is the weighted modulo-103 sum', () => {
    /* 104 + 1×33 = 137; 137 mod 103 = 34 */
    assert.equal(code128bValues('A')[2], 34);
    /* 104 + 1×(P) + 2×(1) + 3×(2), P = 'P'-32 = 48, '1' = 17, '2' = 18 */
    const expected = (104 + 48 * 1 + 17 * 2 + 18 * 3) % 103;
    assert.equal(code128bValues('P12')[4], expected);
  });
  await t.test('values stay inside the pattern table for every printable char', () => {
    let all = '';
    for (let c = 32; c <= 126; c++) all += String.fromCharCode(c);
    const v = code128bValues(all);
    assert.ok(v.every((x) => x >= 0 && x <= 106));
    assert.equal(moduleCount(all), 11 * (all.length + 2) + 13);
  });
});

test('encodable()', () => {
  assert.equal(encodable('CB-USBC-1M'), true);
  assert.equal(encodable('012345678905'), true);
  assert.equal(encodable(''), false, 'an empty code is not a barcode');
  assert.equal(encodable('café'), false, 'non-ASCII cannot be Code 128-B');
  assert.equal(encodable('line\nbreak'), false);
  assert.throws(() => code128bValues('café'), /printable ASCII/);
});

test('barcodeSvg()', async (t) => {
  await t.test('renders bars only, with a quiet zone on both sides', () => {
    const svg = barcodeSvg('AB', { height: 40, module: 2, quiet: 10 });
    assert.match(svg, /^<svg /);
    const total = moduleCount('AB');
    assert.ok(svg.includes(`viewBox="0 0 ${(total + 20) * 2} 40"`), svg.slice(0, 80));
    const bars = (svg.match(/<rect/g) || []).length;
    assert.equal(bars, code128bBars('AB').filter((r) => r.bar).length);
    assert.ok(svg.includes('x="20"'), 'first bar starts after the quiet zone');
  });
  await t.test('an unencodable code yields nothing rather than a broken symbol', () => {
    assert.equal(barcodeSvg('café'), '');
    assert.equal(barcodeSvg(''), '');
  });
  await t.test('the aria label is escaped', () => {
    assert.ok(barcodeSvg('A&B').includes('Barcode A&amp;B'));
  });
});

test('labelCode() prefers the UPC a scanner elsewhere would read', () => {
  assert.equal(labelCode({ upc: '012345678905', sku: 'CB-1' }), '012345678905');
  assert.equal(labelCode({ upc: '', sku: 'CB-1' }), 'CB-1');
  assert.equal(labelCode({ upc: '  ', sku: ' CB-2 ' }), 'CB-2');
  assert.equal(labelCode({ upc: '', sku: '' }), '', 'nothing to encode');
  assert.equal(labelCode({ sku: 'CAFÉ' }), '', 'an unencodable sku is refused, not mangled');
});

test('labelsFor()', async (t) => {
  const products = [
    { id: 'p1', name: 'Cable', sku: 'CB-1', upc: '', retailPrice: 9.99 },
    { id: 'p2', name: 'Phone', sku: 'PH-1', upc: '012345678905', retailPrice: 900 },
    { id: 'p3', name: 'Unlabelable', sku: '', upc: '', retailPrice: 5 },
  ];
  await t.test('repeats each product by its requested quantity', () => {
    const out = labelsFor(products, { p1: 3, p2: 1 });
    assert.equal(out.length, 4);
    assert.equal(out.filter((l) => l.id === 'p1').length, 3);
    assert.equal(out.find((l) => l.id === 'p2').code, '012345678905');
  });
  await t.test('skips zero, missing, negative and unencodable rows', () => {
    assert.deepEqual(labelsFor(products, { p1: 0, p2: -4, p3: 10 }), []);
    assert.deepEqual(labelsFor(products, {}), []);
  });
  await t.test('caps a runaway quantity so one tap cannot print 10,000 labels', () => {
    assert.equal(labelsFor(products, { p1: 5000 }).length, 200);
  });
  await t.test('fractional quantities floor rather than throw', () => {
    assert.equal(labelsFor(products, { p1: 2.9 }).length, 2);
  });
});

test('labelSheetHtml()', async (t) => {
  const labels = labelsFor(
    [{ id: 'p1', name: 'USB-C <Cable>', sku: 'CB-1', upc: '', retailPrice: 9.99 }],
    { p1: 2 },
  );
  const html = labelSheetHtml(labels, { fmt: (v) => `$${v.toFixed(2)}`, store: 'Orison' });

  await t.test('renders one label per copy with code and price', () => {
    assert.equal((html.match(/class="lbl"/g) || []).length, 2);
    assert.ok(html.includes('$9.99'));
    assert.ok(html.includes('CB-1'));
  });
  await t.test('escapes product names into the markup', () => {
    assert.ok(html.includes('USB-C &lt;Cable&gt;'));
    assert.ok(!html.includes('<Cable>'));
  });
  await t.test('an empty selection says so instead of printing a blank page', () => {
    assert.match(labelSheetHtml([], {}), /Nothing to print/);
  });
});
