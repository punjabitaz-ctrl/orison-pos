import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const E = await import('../public/js/escpos.js');
const { receiptDoc } = await import('../public/js/receipt-doc.js');

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
const ascii = (bytes) => String.fromCharCode(...bytes);
const has = (bytes, seq) => hex(bytes).includes(hex(seq));
const dollars = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2);

describe('ESC/POS commands', () => {
  it('initialises the printer with ESC @', () => {
    assert.equal(hex(E.INIT), '1b 40');
  });

  it('kicks the drawer on pin 2 by default, with the standard pulse', () => {
    assert.equal(hex(E.drawerKick()), '1b 70 00 19 fa');
    assert.equal(hex(E.drawerKick(2)), '1b 70 00 19 fa');
  });

  it('kicks the drawer on pin 5 when the drawer is wired that way', () => {
    assert.equal(hex(E.drawerKick(5)), '1b 70 01 19 fa');
  });

  it('feeds then cuts the paper', () => {
    assert.equal(hex(E.CUT), '1d 56 42 03');
  });
});

describe('text layout', () => {
  it('puts the amount flush right on the same line when it fits', () => {
    assert.equal(E.columns('Cable', '$25.00', 32), 'Cable' + ' '.repeat(32 - 5 - 6) + '$25.00');
  });

  it('wraps a long name and keeps the amount right-aligned on its last line', () => {
    const out = E.columns('Samsung Galaxy S24 Ultra 256GB Titanium Black', '$1,199.00', 32).split('\n');
    for (const l of out) assert.ok(l.length <= 32, `"${l}" is ${l.length} wide`);
    assert.ok(out[out.length - 1].endsWith('$1,199.00'));
    assert.ok(out.length >= 2);
  });

  it('never loses characters when it wraps', () => {
    const name = 'Samsung Galaxy S24 Ultra 256GB Titanium Black';
    const out = E.columns(name, '$1.00', 32);
    assert.equal(out.replace(/\s+/g, '').replace('$1.00', ''), name.replace(/\s+/g, ''));
  });
});

describe('isPlainAscii()', () => {
  const sale = {
    items: [{ name: 'Cable', quantity: 1, unitPrice: 10 }],
    subtotal: 10, total: 10, tenders: [{ type: 'cash', amount: 10 }], receiptNo: 'Orison-S000001',
  };

  it('is true for an English receipt in dollars', () => {
    assert.equal(E.isPlainAscii(receiptDoc(sale, { storeName: 'Main' }), dollars), true);
  });

  it('is false when the currency symbol is not ASCII', () => {
    const pounds = (n) => '£' + n.toFixed(2);
    assert.equal(E.isPlainAscii(receiptDoc(sale, { storeName: 'Main' }), pounds), false);
  });

  it('is false for an Arabic receipt', () => {
    assert.equal(E.isPlainAscii(receiptDoc(sale, { storeName: 'Main', labels: { total: 'المجموع' } }), dollars), false);
  });
});

describe('escposFromDoc()', () => {
  const doc = receiptDoc({
    createdAt: '2026-09-12T14:15:00.000Z',
    cashier: 'Amara',
    items: [{ name: 'Cable', quantity: 2, unitPrice: 12.5 }],
    subtotal: 25, total: 25, tenders: [{ type: 'cash', amount: 30 }], receiptNo: 'Orison-S000123',
  }, { storeName: 'Main Street' });

  it('starts by initialising and ends by cutting', () => {
    const b = E.escposFromDoc(doc, 32, dollars);
    assert.equal(hex(b.slice(0, 2)), '1b 40');
    assert.equal(hex(b.slice(-4)), '1d 56 42 03');
  });

  it('prints the brand, the lines, the total, the change and the receipt number', () => {
    const text = ascii(E.escposFromDoc(doc, 32, dollars));
    for (const want of ['ORISON ELECTRONICS', 'Main Street', 'Cable', '$25.00', 'Total', 'Change', '$5.00', 'Orison-S000123']) {
      assert.ok(text.includes(want), `missing ${want}`);
    }
  });

  it('keeps every printed text line within the paper width', () => {
    const text = ascii(E.escposFromDoc(doc, 32, dollars)).replace(/[\x00-\x09\x0b-\x1f]/g, '');
    for (const l of text.split('\n')) assert.ok(l.length <= 32 + 4, `"${l}" too wide`);
  });

  it('can open the drawer as part of the same job', () => {
    assert.ok(has(E.escposFromDoc(doc, 32, dollars, { kick: 2 }), E.drawerKick(2)));
    assert.ok(!has(E.escposFromDoc(doc, 32, dollars), E.drawerKick(2)));
  });
});

describe('raster images', () => {
  it('packs pixels into bits, most significant bit first, dark is 1', () => {
    // 10 x 1 image: black, white, black, then 7 white
    const w = 10, h = 1;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
    for (const x of [0, 2]) { const i = x * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = 0; }
    const bits = E.packBits(rgba, w, h);
    assert.equal(bits.length, 2, 'ceil(10/8) bytes per row');
    assert.equal(bits[0], 0b10100000);
    assert.equal(bits[1], 0);
  });

  it('treats a transparent pixel as paper, not ink', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 0]);
    assert.equal(E.packBits(rgba, 1, 1)[0], 0);
  });

  it('writes GS v 0 with the width in bytes and the height in dots', () => {
    const w = 384, h = 10;
    const bits = new Uint8Array(Math.ceil(w / 8) * h);
    const b = E.rasterImage(bits, w, h);
    assert.equal(hex(b.slice(0, 8)), '1d 76 30 00 30 00 0a 00');
    assert.equal(b.length, 8 + bits.length);
  });

  it('splits a tall receipt into bands, so cheap printers do not choke', () => {
    const w = 8, h = 450;
    const b = E.rasterImage(new Uint8Array(h), w, h);
    const headers = hex(b).split('1d 76 30 00').length - 1;
    assert.equal(headers, Math.ceil(450 / E.RASTER_BAND));
  });
});

describe('chunk()', () => {
  it('splits bytes into writes no bigger than the limit, in order, losing nothing', () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
    const parts = E.chunk(bytes, 180);
    assert.ok(parts.every((p) => p.length <= 180));
    assert.deepEqual([...E.concat(...parts)], [...bytes]);
  });
});
