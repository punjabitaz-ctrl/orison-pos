'use strict';

/* Printers and the cash drawer.

   Three ways out, chosen per terminal because a printer is a physical thing
   next to one till:

   - 'dialog'    the system print dialog at roll width. Any receipt printer the
                 computer has a driver for - USB or network - prints this way.
   - 'sheet'     a full page for an ordinary office printer, through the
                 print-sheet window.
   - 'bluetooth' ESC/POS straight to a Bluetooth Low Energy receipt printer,
                 with no dialog. The only path that can open a cash drawer:
                 a browser cannot send the drawer pulse through a print dialog.

   Web Bluetooth exists in Chrome and Edge on Windows, macOS, ChromeOS and
   Android. It does not exist in Safari (so not on an iPhone or iPad) or
   Firefox, and it cannot reach printers that only speak Bluetooth Classic.

   No DOM in here. Renderers and the Bluetooth stack are passed in, so every
   decision in this file is unit-tested against a fake printer. */

import { chunk, drawerKick, escposFromDoc, escposRaster, isPlainAscii, packBits } from './escpos.js';

export const PRINTER_KEY = 'printer';
const MODES = ['dialog', 'sheet', 'bluetooth'];
const PAGES = ['auto', 'a4', 'letter'];

export function sanitizeSettings(raw) {
  const s = raw || {};
  const mode = MODES.includes(s.mode) ? s.mode : 'dialog';
  return {
    mode,
    paper: Number(s.paper) === 58 ? 58 : 80,
    page: PAGES.includes(s.page) ? s.page : 'auto',
    autoPrint: s.autoPrint === true,
    /* The drawer hangs off the receipt printer's drawer port, so it can only
       be driven when that printer is the Bluetooth one. */
    drawer: mode === 'bluetooth' && s.drawer === 'bluetooth' ? 'bluetooth' : 'none',
    drawerPin: Number(s.drawerPin) === 5 ? 5 : 2,
    kickOnCash: s.kickOnCash !== false,
    deviceId: typeof s.deviceId === 'string' ? s.deviceId : '',
    deviceName: typeof s.deviceName === 'string' ? s.deviceName : '',
  };
}

export async function loadPrinterSettings(idb) {
  try { return sanitizeSettings(await idb.get('meta', PRINTER_KEY)); } catch (_) { return sanitizeSettings({}); }
}

export async function savePrinterSettings(idb, settings) {
  const clean = sanitizeSettings(settings);
  await idb.put('meta', clean, PRINTER_KEY);
  return clean;
}

/* 203 dpi: 58 mm rolls print 384 dots / 32 characters, 80 mm 576 / 48. */
export const paperDots = (paper) => (Number(paper) === 58 ? 384 : 576);
export const paperCols = (paper) => (Number(paper) === 58 ? 32 : 48);

export function bluetoothSupported(nav) {
  return !!(nav && nav.bluetooth && typeof nav.bluetooth.requestDevice === 'function');
}

/* A browser only exposes GATT services it was told about in advance, so this
   is the list of services receipt printers actually use. A printer on a
   service not listed here connects but reports no writable channel. */
export const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
];

export function createBluetoothTransport(nav) {
  let device = null;
  let characteristic = null;

  async function attach(dev) {
    const server = await dev.gatt.connect();
    const services = await server.getPrimaryServices();
    for (const service of services) {
      let chars = [];
      try { chars = await service.getCharacteristics(); } catch (_) { continue; }
      const hit = chars.find((c) => c.properties && (c.properties.writeWithoutResponse || c.properties.write));
      if (hit) {
        device = dev;
        characteristic = hit;
        return;
      }
    }
    throw new Error('That printer has no channel this app can write to.');
  }

  async function writeOne(part) {
    if (characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(part);
    } else {
      await characteristic.writeValue(part);
    }
  }

  return {
    get connected() { return !!(device && device.gatt && device.gatt.connected && characteristic); },
    get name() { return device ? String(device.name || 'Bluetooth printer') : ''; },
    get id() { return device ? String(device.id || '') : ''; },

    async connect() {
      const dev = await nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
      await attach(dev);
      return { id: this.id, name: this.name };
    },

    /* After a reload the page has lost the connection. Chrome can hand back a
       printer this site was already allowed to use, so nobody has to pick it
       from the list again - where that API exists. */
    async reconnect(deviceId) {
      try {
        if (!nav || !nav.bluetooth || typeof nav.bluetooth.getDevices !== 'function') return false;
        const devices = await nav.bluetooth.getDevices();
        const dev = devices.find((d) => String(d.id) === String(deviceId));
        if (!dev) return false;
        await attach(dev);
        return true;
      } catch (_) {
        return false;
      }
    },

    async write(bytes, size = 180) {
      if (!this.connected) throw new Error('not_connected');
      const parts = chunk(bytes, size);
      for (let i = 0; i < parts.length; i++) {
        try {
          await writeOne(parts[i]);
        } catch (err) {
          /* Many printers negotiate a small packet size. Resend this part and
             the rest in 20-byte writes, which every BLE link accepts. */
          if (size <= 20) throw err;
          const rest = bytes.subarray(i * size);
          for (const small of chunk(rest, 20)) await writeOne(small);
          return;
        }
      }
    },

    disconnect() {
      try { if (device && device.gatt) device.gatt.disconnect(); } catch (_) { /* already gone */ }
      device = null;
      characteristic = null;
    },
  };
}

async function ensureConnected(transport, settings) {
  if (!transport) return false;
  if (transport.connected) return true;
  if (!settings.deviceId) {
    /* nothing remembered; still try, for a transport that knows its printer */
    return transport.reconnect ? transport.reconnect('') : false;
  }
  return transport.reconnect(settings.deviceId);
}

export async function printReceipt(doc, opts) {
  const { settings, fmt, transport, renderRoll, renderSheet, renderCanvas, kick } = opts;
  const s = sanitizeSettings(settings);

  if (s.mode === 'dialog') {
    renderRoll(doc, s.paper);
    return { ok: true, mode: 'dialog' };
  }

  if (s.mode === 'sheet') {
    const opened = renderSheet(doc, s.page);
    return opened === false ? { ok: false, mode: 'sheet', reason: 'popup_blocked' } : { ok: true, mode: 'sheet' };
  }

  if (!(await ensureConnected(transport, s))) return { ok: false, mode: 'bluetooth', reason: 'not_connected' };
  const kickPin = kick && s.drawer === 'bluetooth' ? s.drawerPin : 0;

  if (isPlainAscii(doc, fmt)) {
    await transport.write(escposFromDoc(doc, paperCols(s.paper), fmt, { kick: kickPin }));
    return { ok: true, mode: 'bluetooth', method: 'text' };
  }
  const img = renderCanvas(doc, paperDots(s.paper), fmt);
  const bits = packBits(img.data, img.width, img.height);
  await transport.write(escposRaster(bits, img.width, img.height, { kick: kickPin }));
  return { ok: true, mode: 'bluetooth', method: 'raster' };
}

export async function openDrawer(opts) {
  const s = sanitizeSettings(opts.settings);
  if (s.drawer !== 'bluetooth') return { ok: false, reason: 'no_drawer' };
  if (!(await ensureConnected(opts.transport, s))) return { ok: false, reason: 'not_connected' };
  await opts.transport.write(drawerKick(s.drawerPin));
  return { ok: true };
}

/* The drawer opens after a sale only when cash actually changed hands. */
export function shouldKickForSale(tenders, settings) {
  const s = sanitizeSettings(settings);
  if (s.drawer !== 'bluetooth' || !s.kickOnCash) return false;
  return (tenders || []).some((t) => t && t.type === 'cash' && Math.round((Number(t.amount) || 0) * 100) > 0);
}
