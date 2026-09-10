'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, fmtQty, esc, debounce } from '../public/js/ui.js';

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
