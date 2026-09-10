'use strict';

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fmt, fmtQty, esc, debounce, csvCell, csvRows, emptyState, skeleton,
  setMoneyFormat, getMoneyFormat, currencySymbol, denomLabel,
} from '../public/js/ui.js';

/* ── fmt() ───────────────────────────────────────────────────── */

describe('fmt()', () => {
  it('formats zero', () => assert.equal(fmt(0), '$0.00'));
  it('formats integer', () => assert.equal(fmt(5), '$5.00'));
  it('formats decimal', () => assert.equal(fmt(12.5), '$12.50'));
  it('formats large number', () => assert.equal(fmt(1299), '$1,299.00'));
  it('formats falsy as $0.00', () => assert.equal(fmt(null), '$0.00'));
  it('formats undefined as $0.00', () => assert.equal(fmt(undefined), '$0.00'));
  it('formats string number', () => assert.equal(fmt('42.5'), '$42.50'));
  it('formats negative', () => assert.equal(fmt(-10), '-$10.00'));
  it('rounds to 2 decimals', () => assert.equal(fmt(1.005), '$1.01'));
});

/* ── fmtQty() ────────────────────────────────────────────────── */

describe('fmtQty()', () => {
  it('formats zero', () => assert.equal(fmtQty(0), '0'));
  it('formats integer', () => assert.equal(fmtQty(5), '5'));
  it('formats null as 0', () => assert.equal(fmtQty(null), '0'));
  it('formats string', () => assert.equal(fmtQty('7'), '7'));
});

/* ── esc() ───────────────────────────────────────────────────── */

describe('esc()', () => {
  it('escapes ampersand', () => assert.equal(esc('a&b'), 'a&amp;b'));
  it('escapes angle brackets', () => assert.equal(esc('<div>'), '&lt;div&gt;'));
  it('escapes quotes', () => assert.equal(esc('"hello"'), '&quot;hello&quot;'));
  it('escapes single quote', () => assert.equal(esc("it's"), 'it&#39;s'));
  it('escapes mixed', () => assert.equal(esc('<a href="x">&y</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;y&lt;/a&gt;'));
  it('returns empty for null', () => assert.equal(esc(null), ''));
  it('returns empty for undefined', () => assert.equal(esc(undefined), ''));
  it('returns clean string unchanged', () => assert.equal(esc('hello world'), 'hello world'));
  it('coerces number to string', () => assert.equal(esc(42), '42'));
});

/* ── debounce() ──────────────────────────────────────────────── */

describe('debounce()', () => {
  it('returns a function', () => {
    const d = debounce(() => {}, 10);
    assert.equal(typeof d, 'function');
  });

  it('calls function after delay', (_, done) => {
    let called = false;
    const d = debounce(() => { called = true; }, 20);
    d();
    assert.equal(called, false);
    setTimeout(() => {
      assert.equal(called, true);
      done();
    }, 30);
  });

  it('only calls once for multiple rapid calls', (_, done) => {
    let count = 0;
    const d = debounce(() => { count++; }, 20);
    d(); d(); d();
    setTimeout(() => {
      assert.equal(count, 1);
      done();
    }, 30);
  });

  it('passes arguments to the function', (_, done) => {
    let received;
    const d = debounce((a, b) => { received = [a, b]; }, 10);
    d('x', 'y');
    setTimeout(() => {
      assert.deepEqual(received, ['x', 'y']);
      done();
    }, 20);
  });
});


/* ── csvCell() / csvRows() ───────────────────────────────────── */

describe('csvCell()', () => {
  it('always quotes, so a comma cannot shift a column', () => {
    assert.equal(csvCell('Doe, Jane'), '"Doe, Jane"');
  });
  it('doubles embedded quotes', () => {
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  });
  it('keeps a newline inside one quoted field', () => {
    assert.equal(csvCell('a' + String.fromCharCode(10) + 'b'), '"a' + String.fromCharCode(10) + 'b"');
  });
  it('neutralises a leading formula character', () => {
    const formula = '=HYPERLINK(' + JSON.stringify('http://x') + ')';
    assert.equal(csvCell(formula), '"' + "'" + '=HYPERLINK(' + '""http://x""' + ')' + '"');
    assert.equal(csvCell('+1-555'), '"' + "'+1-555" + '"');
    assert.equal(csvCell('-5'), '"' + "'-5" + '"');
    assert.equal(csvCell('@user'), '"' + "'@user" + '"');
  });
  it('leaves ordinary values and numbers alone apart from quoting', () => {
    assert.equal(csvCell('Cable'), '"Cable"');
    assert.equal(csvCell(12.5), '"12.5"');
    assert.equal(csvCell(null), '""');
    assert.equal(csvCell(undefined), '""');
  });
  it('does not treat a formula character mid-value as a formula', () => {
    assert.equal(csvCell('A=B'), '"A=B"');
  });
});

describe('csvRows()', () => {
  it('joins cells with commas and rows with newlines', () => {
    assert.equal(csvRows([['a', 'b'], ['c', 'd']]),
      '"a","b"' + String.fromCharCode(10) + '"c","d"');
  });
  it('survives empty input', () => {
    assert.equal(csvRows([]), '');
    assert.equal(csvRows(null), '');
  });
});

/* ── emptyState() / skeleton() ───────────────────────────────── */

describe('emptyState()', () => {
  it('escapes every field it renders', () => {
    const html = emptyState({ icon: '<x>', title: 'a & b', body: '"q"', action: 'Go', actionId: 'goId' });
    assert.ok(html.includes('&lt;x&gt;'));
    assert.ok(html.includes('a &amp; b'));
    assert.ok(!html.includes('<x>'));
    assert.ok(html.includes('id="goId"'));
  });
  it('omits the action when there is nothing to do', () => {
    assert.ok(!emptyState({ title: 'Nothing' }).includes('<button'));
  });
});

describe('skeleton()', () => {
  it('repeats the placeholder the requested number of times', () => {
    assert.equal((skeleton('table', 4).match(/sk-trow/g) || []).length, 4);
  });
  it('never renders zero or negative rows', () => {
    assert.ok(skeleton('rows', 0).includes('sk-row'));
    assert.ok(skeleton('rows', -3).includes('sk-row'));
  });
  it('is hidden from assistive technology', () => {
    assert.ok(skeleton('kpis', 2).includes('aria-hidden="true"'));
  });
});


/* ── store money format (v1.16.0) ──────────────────────── */

describe('setMoneyFormat()', () => {
  const original = getMoneyFormat();
  afterEach(() => setMoneyFormat(original));

  it('defaults to en-US dollars, so an unconfigured store still prints money', () => {
    setMoneyFormat({ locale: 'en-US', currency: 'USD' });
    assert.equal(fmt(1234.5), '$1,234.50');
  });

  it('follows the store into another currency', () => {
    setMoneyFormat({ locale: 'en-NG', currency: 'NGN' });
    assert.equal(fmt(1234.5), '₦1,234.50');
    assert.equal(currencySymbol(), '₦');
  });

  it('follows the store into another locale, grouping and all', () => {
    setMoneyFormat({ locale: 'de-DE', currency: 'EUR' });
    const out = fmt(1234.5);
    assert.ok(out.includes('1.234,50'), out);
    assert.ok(out.includes('€'), out);
  });

  it('changes only what it is given', () => {
    setMoneyFormat({ locale: 'en-GB', currency: 'GBP' });
    setMoneyFormat({ currency: 'USD' });
    assert.equal(getMoneyFormat().locale, 'en-GB');
    assert.equal(getMoneyFormat().currency, 'USD');
  });

  it('uppercases a lowercase currency code', () => {
    setMoneyFormat({ currency: 'ngn' });
    assert.equal(getMoneyFormat().currency, 'NGN');
  });

  it('an unusable locale falls back instead of throwing on every price', () => {
    setMoneyFormat({ locale: 'not a locale', currency: 'USD' });
    assert.equal(fmt(10), '$10.00');
  });
});

describe('denomLabel()', () => {
  const original = getMoneyFormat();
  afterEach(() => setMoneyFormat(original));

  it('prints a note without decimals and a coin with them', () => {
    setMoneyFormat({ locale: 'en-US', currency: 'USD' });
    assert.equal(denomLabel(100), '$100');
    assert.equal(denomLabel(0.25), '$0.25');
  });

  it('uses the store currency', () => {
    setMoneyFormat({ locale: 'en-NG', currency: 'NGN' });
    assert.equal(denomLabel(1000), '₦1,000');
  });

  it('treats a missing or junk value as zero rather than NaN', () => {
    setMoneyFormat({ locale: 'en-US', currency: 'USD' });
    assert.equal(denomLabel(undefined), '$0');
    assert.equal(denomLabel('abc'), '$0');
  });
});
