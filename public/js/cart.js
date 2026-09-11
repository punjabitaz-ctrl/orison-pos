'use strict';

/* The cart: what is in it, what that leaves on the shelf, and keeping it alive
   across an interruption.

   Two rules drive this module.

   One: a part-rung sale must survive the terminal dying. Phones kill
   backgrounded PWAs routinely, so the cart is written to IndexedDB on every
   change and offered back on the next boot.

   Two: the catalog mirror is never mutated. The old register decremented
   `product.onHand` as lines went in, which meant a crash lost the units for
   good (nothing ran to put them back) and a mid-cart `pull()` replaced the
   product objects underneath the open cart. Availability is now derived -
   server stock minus what this cart holds - so both problems stop existing. */

import { idb } from './db.js';

export const CART_KEY = 'cart';

export function lineKey(productId, serial) {
  return serial ? String(productId) + '|' + String(serial) : String(productId);
}

export function cartCount(cart) {
  let n = 0;
  for (const line of values(cart)) n += Number(line.qty) || 1;
  return n;
}

function values(cart) {
  if (!cart) return [];
  return typeof cart.values === 'function' ? [...cart.values()] : [];
}

/* Units of a product this cart already holds. */
export function qtyInCart(cart, productId) {
  let n = 0;
  for (const line of values(cart)) {
    if (String(productLineId(line)) !== String(productId)) continue;
    n += Number(line.qty) || 1;
  }
  return n;
}

function productLineId(line) {
  return line && line.product ? line.product.id : (line || {}).productId;
}

/* Serials of a product this cart already holds. */
export function serialsInCart(cart, productId) {
  const out = [];
  for (const line of values(cart)) {
    if (String(productLineId(line)) !== String(productId)) continue;
    for (const s of line.serials || []) out.push(String(s));
  }
  return out;
}

/* What is left to sell: the server's figure minus what this cart is holding.
   Services are unlimited; a serialized product counts its unclaimed serials. */
export function availableFor(product, cart) {
  if (!product) return 0;
  if (product.itemType === 'service') return Infinity;
  if (product.isSerialized) return freeSerials(product, cart).length;
  return Math.max(0, (Number(product.onHand) || 0) - qtyInCart(cart, product.id));
}

export function freeSerials(product, cart) {
  if (!product || !product.isSerialized) return [];
  const taken = serialsInCart(cart, product.id);
  return (product.serials || []).map(String).filter((s) => !taken.includes(s));
}

export function isSerialFree(product, cart, serial) {
  return freeSerials(product, cart).includes(String(serial));
}

/* ---- persistence ---- */

/* Stored by id, not by object reference: the catalog is re-pulled constantly,
   so a saved cart has to be re-joined to whatever the catalog says now. */
export function toRecords(cart) {
  return values(cart).map((line) => ({
    productId: productLineId(line),
    qty: Number(line.qty) || 1,
    serials: (line.serials || []).map(String),
    price: Number(line.price) || 0,
    discountPct: Number(line.discountPct) || 0,
    taxable: line.taxable !== false,
    name: (line.product && line.product.name) || '',
  }));
}

/* Re-join saved records to the live catalog. A product deleted since the cart
   was saved is dropped rather than resurrected as a ghost line. */
export function fromRecords(records, products) {
  const byId = new Map((products || []).map((p) => [String(p.id), p]));
  const cart = new Map();
  for (const r of records || []) {
    const product = byId.get(String(r.productId));
    if (!product) continue;
    const serials = (r.serials || []).map(String);
    cart.set(lineKey(product.id, serials[0]), {
      product,
      qty: Math.max(1, Number(r.qty) || 1),
      serials,
      price: Number(r.price) || 0,
      discountPct: Number(r.discountPct) || 0,
      taxable: r.taxable !== false,
    });
  }
  return cart;
}

let saveTimer = null;

async function writeCart(records) {
  const m = (await idb.get('meta', 'config').catch(() => ({}))) || {};
  if (records && records.length) m[CART_KEY] = { lines: records, at: new Date().toISOString() };
  else delete m[CART_KEY];
  await idb.put('meta', m, 'config').catch(() => {});
}

/* Debounced so a held-down quantity button doesn't write once per repeat. */
export function persist(cart) {
  const records = toRecords(cart);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; writeCart(records); }, 200);
}

export async function persistNow(cart) {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  await writeCart(toRecords(cart));
}

export async function clearSaved() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  await writeCart([]);
}

export async function loadSaved() {
  const m = (await idb.get('meta', 'config').catch(() => ({}))) || {};
  const saved = m[CART_KEY];
  if (!saved || !Array.isArray(saved.lines) || !saved.lines.length) return null;
  return saved;
}

export function savedSummary(saved, fmt) {
  const lines = (saved && saved.lines) || [];
  const count = lines.reduce((n, l) => n + (Number(l.qty) || 1), 0);
  const total = lines.reduce((n, l) => {
    const gross = (Number(l.price) || 0) * (Number(l.qty) || 1);
    return n + gross * (1 - (Number(l.discountPct) || 0) / 100);
  }, 0);
  return {
    count,
    total,
    text: `${count} item${count === 1 ? '' : 's'} · ${fmt ? fmt(total) : total.toFixed(2)}`,
  };
}
