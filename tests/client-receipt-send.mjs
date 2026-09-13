'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { pdfCanCarry, pdfFromLines } = await import('../public/js/receipt-send.js');

describe('receipt PDF (v1.35.0)', () => {
  it('carries an English receipt, money isolates and typographic marks included', () => {
    assert.equal(pdfCanCarry(['Orison Electronics', 'USB-C cable — \u2066$5.00\u2069', '2 × $2.50']), true);
  });

  it('refuses Arabic and Urdu, which Courier would print as question marks', () => {
    assert.equal(pdfCanCarry(['الإجمالي — $5.00']), false);
    assert.equal(pdfCanCarry(['کل — $5.00']), false);
  });

  it('never writes an isolate into the PDF as a question mark', () => {
    const pdf = new TextDecoder().decode(pdfFromLines(['Total \u2066$5.00\u2069']));
    assert.ok(pdf.includes('(Total $5.00)'), 'the isolates are dropped, not replaced');
  });
});
