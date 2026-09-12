import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../public/js/printer.js');
const { receiptDoc } = await import('../public/js/receipt-doc.js');

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
const dollars = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2);
const pounds = (n) => (n < 0 ? '-' : '') + '£' + Math.abs(n).toFixed(2);

const doc = receiptDoc({
  items: [{ name: 'Cable', quantity: 1, unitPrice: 10 }],
  subtotal: 10, total: 10, tenders: [{ type: 'cash', amount: 10 }], receiptNo: 'Orison-S000001',
}, { storeName: 'Main' });

/* A fake BLE printer: one service with only a notify characteristic, then the
   real one with a writable characteristic, recording every write. */
function fakeBluetooth({ failBigWrites = false, withoutResponse = true } = {}) {
  const writes = [];
  const readOnly = { uuid: 'r', properties: { notify: true }, writeValue: async () => { throw new Error('not writable'); } };
  const writable = {
    uuid: 'w',
    properties: withoutResponse ? { writeWithoutResponse: true } : { write: true },
    async writeValueWithoutResponse(buf) {
      if (failBigWrites && buf.byteLength > 20) throw new Error('GATT operation failed');
      writes.push(new Uint8Array(buf));
    },
    async writeValue(buf) {
      if (failBigWrites && buf.byteLength > 20) throw new Error('GATT operation failed');
      writes.push(new Uint8Array(buf));
    },
  };
  const services = [
    { uuid: 's1', getCharacteristics: async () => [readOnly] },
    { uuid: 's2', getCharacteristics: async () => [readOnly, writable] },
  ];
  const device = {
    id: 'dev-1', name: 'MTP-II',
    gatt: {
      connected: false,
      async connect() { this.connected = true; return this; },
      async getPrimaryServices() { return services; },
      disconnect() { this.connected = false; },
    },
    addEventListener() {},
  };
  let lastRequest = null;
  const nav = {
    bluetooth: {
      async requestDevice(opts) { lastRequest = opts; return device; },
      async getDevices() { return [device]; },
    },
  };
  return { nav, writes, device, get lastRequest() { return lastRequest; } };
}

const joined = (writes) => {
  const len = writes.reduce((n, w) => n + w.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const w of writes) { out.set(w, o); o += w.length; }
  return out;
};

describe('printer settings', () => {
  it('defaults to the print dialog, 80 mm, no drawer', () => {
    const s = P.sanitizeSettings({});
    assert.equal(s.mode, 'dialog');
    assert.equal(s.paper, 80);
    assert.equal(s.drawer, 'none');
    assert.equal(s.drawerPin, 2);
  });

  it('refuses values the hardware cannot have', () => {
    const s = P.sanitizeSettings({ mode: 'fax', paper: 112, drawerPin: 9, drawer: 'magic', page: 'A0' });
    assert.equal(s.mode, 'dialog');
    assert.equal(s.paper, 80);
    assert.equal(s.drawerPin, 2);
    assert.equal(s.drawer, 'none');
    assert.equal(s.page, 'auto');
  });

  it('keeps every legitimate choice', () => {
    const s = P.sanitizeSettings({ mode: 'bluetooth', paper: 58, drawerPin: 5, drawer: 'bluetooth', page: 'letter', autoPrint: true, kickOnCash: false });
    assert.deepEqual(
      [s.mode, s.paper, s.drawerPin, s.drawer, s.page, s.autoPrint, s.kickOnCash],
      ['bluetooth', 58, 5, 'bluetooth', 'letter', true, false],
    );
  });

  it('only lets the drawer be driven by a Bluetooth printer', () => {
    // A browser cannot send the open-drawer pulse through the print dialog.
    assert.equal(P.sanitizeSettings({ mode: 'dialog', drawer: 'bluetooth' }).drawer, 'none');
    assert.equal(P.sanitizeSettings({ mode: 'sheet', drawer: 'bluetooth' }).drawer, 'none');
  });

  it('maps paper to printer dots and text columns at 203 dpi', () => {
    assert.deepEqual([P.paperDots(58), P.paperCols(58)], [384, 32]);
    assert.deepEqual([P.paperDots(80), P.paperCols(80)], [576, 48]);
  });
});

describe('Bluetooth support detection', () => {
  it('says no in a browser without Web Bluetooth, such as Safari on an iPad', () => {
    assert.equal(P.bluetoothSupported({}), false);
    assert.equal(P.bluetoothSupported(undefined), false);
  });

  it('says yes where requestDevice exists', () => {
    assert.equal(P.bluetoothSupported(fakeBluetooth().nav), true);
  });
});

describe('Bluetooth transport', () => {
  it('asks for the known printer services, since a browser hides any it was not told about', async () => {
    const f = fakeBluetooth();
    await P.createBluetoothTransport(f.nav).connect();
    assert.ok(f.lastRequest.optionalServices.includes('000018f0-0000-1000-8000-00805f9b34fb'));
    assert.ok(f.lastRequest.optionalServices.length >= 5);
  });

  it('finds the writable characteristic even when it is not in the first service', async () => {
    const f = fakeBluetooth();
    const t = P.createBluetoothTransport(f.nav);
    await t.connect();
    assert.equal(t.connected, true);
    assert.equal(t.name, 'MTP-II');
    await t.write(Uint8Array.of(1, 2, 3));
    assert.deepEqual([...joined(f.writes)], [1, 2, 3]);
  });

  it('writes in chunks, in order, losing nothing', async () => {
    const f = fakeBluetooth();
    const t = P.createBluetoothTransport(f.nav);
    await t.connect();
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
    await t.write(bytes);
    assert.ok(f.writes.every((w) => w.length <= 180));
    assert.deepEqual([...joined(f.writes)], [...bytes]);
  });

  it('drops to small writes when the printer rejects large ones', async () => {
    const f = fakeBluetooth({ failBigWrites: true });
    const t = P.createBluetoothTransport(f.nav);
    await t.connect();
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
    await t.write(bytes);
    assert.ok(f.writes.every((w) => w.length <= 20));
    assert.deepEqual([...joined(f.writes)], [...bytes]);
  });

  it('uses write-with-response when that is all the printer offers', async () => {
    const f = fakeBluetooth({ withoutResponse: false });
    const t = P.createBluetoothTransport(f.nav);
    await t.connect();
    await t.write(Uint8Array.of(9, 9));
    assert.deepEqual([...joined(f.writes)], [9, 9]);
  });

  it('reconnects to the printer it paired with, without asking again', async () => {
    const f = fakeBluetooth();
    const t = P.createBluetoothTransport(f.nav);
    assert.equal(await t.reconnect('dev-1'), true);
    assert.equal(t.connected, true);
  });

  it('reports failure to reconnect rather than throwing', async () => {
    const f = fakeBluetooth();
    const t = P.createBluetoothTransport(f.nav);
    assert.equal(await t.reconnect('some-other-printer'), false);
    assert.equal(await P.createBluetoothTransport({ bluetooth: { requestDevice() {} } }).reconnect('dev-1'), false);
  });
});

describe('printReceipt()', () => {
  it('sends a plain-ASCII receipt as text', async () => {
    const f = fakeBluetooth();
    const transport = P.createBluetoothTransport(f.nav);
    await transport.connect();
    const r = await P.printReceipt(doc, {
      settings: P.sanitizeSettings({ mode: 'bluetooth', paper: 58 }), fmt: dollars, transport,
      renderCanvas: () => { throw new Error('should not raster'); },
    });
    assert.deepEqual([r.ok, r.method], [true, 'text']);
    const b = joined(f.writes);
    assert.equal(hex(b.slice(0, 2)), '1b 40');
    assert.ok(String.fromCharCode(...b).includes('ORISON ELECTRONICS'));
  });

  it('sends anything a code page would mangle as an image', async () => {
    const f = fakeBluetooth();
    const transport = P.createBluetoothTransport(f.nav);
    await transport.connect();
    let asked = null;
    const r = await P.printReceipt(doc, {
      settings: P.sanitizeSettings({ mode: 'bluetooth', paper: 58 }), fmt: pounds, transport,
      renderCanvas: (d, width) => {
        asked = width;
        return { width, height: 2, data: new Uint8ClampedArray(width * 2 * 4).fill(255) };
      },
    });
    assert.deepEqual([r.ok, r.method], [true, 'raster']);
    assert.equal(asked, 384, 'rendered at the paper width in dots');
    assert.ok(hex(joined(f.writes)).includes('1d 76 30 00'));
  });

  it('says so when the Bluetooth printer is not connected', async () => {
    const f = fakeBluetooth();
    f.nav.bluetooth.getDevices = async () => [];
    const r = await P.printReceipt(doc, {
      settings: P.sanitizeSettings({ mode: 'bluetooth' }), fmt: dollars, transport: P.createBluetoothTransport(f.nav),
    });
    assert.deepEqual([r.ok, r.reason], [false, 'not_connected']);
  });

  it('prints through the dialog at roll width', async () => {
    let got = null;
    const r = await P.printReceipt(doc, {
      settings: P.sanitizeSettings({ mode: 'dialog', paper: 58 }), fmt: dollars,
      renderRoll: (d, paper) => { got = paper; },
    });
    assert.equal(r.ok, true);
    assert.equal(got, 58);
  });

  it('reports a blocked pop-up for a full-page print, instead of silently printing nothing', async () => {
    const r = await P.printReceipt(doc, {
      settings: P.sanitizeSettings({ mode: 'sheet' }), fmt: dollars, renderSheet: () => false,
    });
    assert.deepEqual([r.ok, r.reason], [false, 'popup_blocked']);
  });

  it('opens the drawer in the same job when asked', async () => {
    const f = fakeBluetooth();
    const transport = P.createBluetoothTransport(f.nav);
    await transport.connect();
    await P.printReceipt(doc, {
      settings: P.sanitizeSettings({ mode: 'bluetooth', drawer: 'bluetooth', drawerPin: 5 }), fmt: dollars, transport, kick: true,
    });
    assert.ok(hex(joined(f.writes)).includes('1b 70 01 19 fa'));
  });
});

describe('the cash drawer', () => {
  it('has nothing to open when no drawer is set up', async () => {
    const r = await P.openDrawer({ settings: P.sanitizeSettings({}) });
    assert.deepEqual([r.ok, r.reason], [false, 'no_drawer']);
  });

  it('pulses the configured pin through the Bluetooth printer', async () => {
    const f = fakeBluetooth();
    const transport = P.createBluetoothTransport(f.nav);
    await transport.connect();
    const r = await P.openDrawer({ settings: P.sanitizeSettings({ mode: 'bluetooth', drawer: 'bluetooth' }), transport });
    assert.equal(r.ok, true);
    assert.equal(hex(joined(f.writes)), '1b 70 00 19 fa');
  });

  it('opens after a sale only when cash changed hands and the setting is on', () => {
    const on = P.sanitizeSettings({ mode: 'bluetooth', drawer: 'bluetooth', kickOnCash: true });
    assert.equal(P.shouldKickForSale([{ type: 'cash', amount: 10 }], on), true);
    assert.equal(P.shouldKickForSale([{ type: 'card', amount: 10 }], on), false);
    assert.equal(P.shouldKickForSale([{ type: 'cash', amount: 0 }], on), false);
    assert.equal(P.shouldKickForSale([{ type: 'cash', amount: 10 }], { ...on, kickOnCash: false }), false);
    assert.equal(P.shouldKickForSale([{ type: 'cash', amount: 10 }], P.sanitizeSettings({})), false);
  });
});
