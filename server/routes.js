'use strict';

const crypto = require('crypto');
const { getSecret, verifyPin } = require('./db');

const secret = getSecret();

function sign(payloadObj) {
  const body = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

const uuid = () => crypto.randomUUID();
const stamp = () => new Date().toISOString();

function authPlugin(fastify, opts, done) {
  fastify.register(require('@fastify/cors'), { origin: true });

  // Global auth gate for /api/*, skipping public login.
  fastify.addHook('preHandler', async (req, reply) => {
    if (!req.raw.url.startsWith('/api/')) return;
    if (req.raw.url === '/api/login' || req.raw.url.startsWith('/api/login?') || req.raw.method === 'OPTIONS') return;
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const payload = verifyToken(token);
    if (!payload) return reply.code(401).send({ error: 'Unauthorized' });
    req.user = payload;
  });

  // ---- Auth ----
  fastify.post('/api/login', async (req, reply) => {
    const { email, pin } = req.body || {};
    if (!email || pin === undefined || pin === null || pin === '') {
      return reply.code(400).send({ error: 'email and pin are required' });
    }
    const user = fastify.db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email).trim().toLowerCase());
    if (!user || !verifyPin(String(pin), user.pin_hash)) {
      return reply.code(401).send({ error: 'Invalid email or PIN' });
    }
    const store = fastify.db.prepare('SELECT * FROM stores WHERE id = ?').get(user.store_id);
    const token = sign({ uid: user.id, role: user.role, exp: Date.now() + 1000 * 60 * 60 * 12 });
    return {
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role,
      },
      store,
    };
  });

  fastify.addHook('preHandler', async (req, reply) => {
    if (req.raw.url.startsWith('/api/')) {
      if (req.raw.url.startsWith('/api/login')) return;
      const auth = req.headers.authorization || '';
      const token = auth.replace(/^Bearer\s+/i, '');
      const payload = verifyToken(token);
      if (!payload) return reply.code(401).send({ error: 'Unauthorized' });
      req.user = payload;
    }
  });

  // ---- Config / bootstrap (small, full snapshot) ----
  fastify.get('/api/config', async (req) => {
    const db = fastify.db;
    const store = db.prepare('SELECT * FROM stores LIMIT 1').get();
    const users = db.prepare('SELECT id, store_id, first_name, last_name, email, role FROM users WHERE active = 1').all();
    return { store, users };
  });

  // ---- Products + inventory + serials (full snapshot, small catalog) ----
  fastify.get('/api/products', async (req) => {
    const db = fastify.db;
    const products = db.prepare('SELECT * FROM products WHERE active = 1').all();
    const inventory = db.prepare('SELECT * FROM inventory').all();
    const serials = db.prepare("SELECT id, product_id, serial_number, status FROM product_serials WHERE status = 'IN_STOCK'").all();
    const byProduct = {};
    for (const inv of inventory) byProduct[inv.product_id] = inv.quantity_on_hand;
    return products.map((p) => ({
      id: p.id,
      sku: p.sku,
      upc: p.upc,
      name: p.name,
      category: p.category,
      costPrice: p.cost_price,
      retailPrice: p.retail_price,
      isSerialized: !!p.is_serialized,
      onHand: byProduct[p.id] ?? 0,
      serials: p.is_serialized ? serials.filter((s) => s.product_id === p.id).map((s) => s.serial_number) : [],
    }));
  });

  // ---- Transactions (recent, for cross-device history) ----
  fastify.get('/api/transactions', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const db = fastify.db;
    const rows = db.prepare(
      `SELECT t.*, u.first_name || ' ' || u.last_name AS cashier
       FROM transactions t JOIN users u ON u.id = t.user_id
       WHERE t.status = 'COMPLETED'
       ORDER BY t.created_at DESC LIMIT ?`
    ).all(limit);
    const out = [];
    const itemStmt = db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?');
    for (const t of rows) {
      const items = itemStmt.all(t.id).map((i) => ({
        productId: i.product_id,
        quantity: i.quantity,
        unitPrice: i.unit_price,
        serialNumber: i.serial_number,
      }));
      out.push({
        id: t.id,
        clientTxId: t.client_tx_id,
        cashier: t.cashier,
        grandTotal: t.grand_total,
        tenders: JSON.parse(t.tenders_json || '[]'),
        createdAt: t.created_at,
        items,
      });
    }
    return { transactions: out };
  });

  // ---- Sync: push local outbox ----
  fastify.post('/api/sync/push', async (req, reply) => {
    const db = fastify.db;
    const { deviceId, batch } = req.body || {};
    if (!deviceId || !Array.isArray(batch)) {
      return reply.code(400).send({ error: 'deviceId and batch are required' });
    }

    const results = [];
    for (const tx of batch) {
      if (!tx.clientTxId || !Array.isArray(tx.items) || !tx.items.length) {
        results.push({ clientTxId: tx.clientTxId, accepted: false, reason: 'malformed' });
        continue;
      }
      results.push(commitTransaction(db, tx));
    }
    return { results };
  });

  // ---- Sync: pull catalog delta ----
  fastify.get('/api/sync/pull', async (req) => {
    const db = fastify.db;
    const store = db.prepare('SELECT * FROM stores LIMIT 1').get();
    const users = db.prepare('SELECT id, first_name, last_name, email, role FROM users WHERE active = 1').all();
    const products = db.prepare('SELECT * FROM products WHERE active = 1').all();
    const inventory = db.prepare('SELECT * FROM inventory').all();
    const serials = db.prepare("SELECT id, product_id, serial_number, status FROM product_serials WHERE status = 'IN_STOCK'").all();
    const byProduct = {};
    for (const inv of inventory) byProduct[inv.product_id] = inv.quantity_on_hand;
    return {
      store,
      users,
      watermark: stamp(),
      products: products.map((p) => ({
        id: p.id,
        sku: p.sku,
        upc: p.upc,
        name: p.name,
        category: p.category,
        costPrice: p.cost_price,
        retailPrice: p.retail_price,
        isSerialized: !!p.is_serialized,
        onHand: byProduct[p.id] ?? 0,
        serials: p.is_serialized ? serials.filter((s) => s.product_id === p.id).map((s) => s.serial_number) : [],
      })),
    };
  });

  // ---- Admin: create product ----
  fastify.post('/api/admin/products', async (req, reply) => {
    if (req.user.role !== 'admin') return reply.code(403).send({ error: 'Admin only' });
    const db = fastify.db;
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) return reply.code(400).send({ error: 'name is required' });
    const id = uuid();
    const ins = db.prepare(
      `INSERT INTO products (id, sku, upc, name, category, cost_price, retail_price, is_serialized, active, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    );
    try {
      ins.run(id, body.sku ? String(body.sku).trim() : null, body.upc ? String(body.upc).trim() : null, name,
        String(body.category || 'General'), Number(body.costPrice) || 0, Number(body.retailPrice) || 0,
        body.isSerialized ? 1 : 0, stamp(), stamp());
      db.prepare('INSERT INTO inventory (id, store_id, product_id, quantity_on_hand, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(uuid(), db.prepare('SELECT id FROM stores LIMIT 1').get().id, id, Number(body.onHand) || 0, stamp());
      return { id };
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return reply.code(409).send({ error: 'SKU or UPC already exists' });
      throw e;
    }
  });

  // ---- Admin: add serials to inventory ----
  fastify.post('/api/admin/serials', async (req, reply) => {
    if (req.user.role !== 'admin') return reply.code(403).send({ error: 'Admin only' });
    const db = fastify.db;
    const { productId, serialNumbers } = req.body || {};
    if (!productId || !Array.isArray(serialNumbers) || !serialNumbers.length) {
      return reply.code(400).send({ error: 'productId and serialNumbers are required' });
    }
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) return reply.code(404).send({ error: 'product not found' });
    if (!product.is_serialized) return reply.code(400).send({ error: 'product is not serialized' });
    const ins = db.prepare('INSERT INTO product_serials (id, product_id, serial_number, status, updated_at) VALUES (?, ?, ?, ?, ?)');
    const added = [];
    const dupes = [];
    for (const sn of serialNumbers) {
      const clean = String(sn).trim();
      if (!clean) continue;
      try {
        ins.run(uuid(), productId, clean, 'IN_STOCK', stamp());
        added.push(clean);
      } catch (e) {
        dupes.push(clean);
      }
    }
    return { added, duplicates: dupes };
  });

  // ---- Admin: adjust non-serialized stock ----
  fastify.post('/api/admin/inventory', async (req, reply) => {
    if (req.user.role !== 'admin') return reply.code(403).send({ error: 'Admin only' });
    const db = fastify.db;
    const { productId, onHand } = req.body || {};
    if (!productId || typeof onHand !== 'number') {
      return reply.code(400).send({ error: 'productId and onHand (number) are required' });
    }
    const store = db.prepare('SELECT id FROM stores LIMIT 1').get();
    const inv = db.prepare('UPDATE inventory SET quantity_on_hand = ?, updated_at = ? WHERE store_id = ? AND product_id = ?')
      .run(Math.max(0, Math.round(onHand)), stamp(), store.id, productId);
    if (!inv.changes) {
      db.prepare('INSERT INTO inventory (id, store_id, product_id, quantity_on_hand, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(uuid(), store.id, productId, Math.max(0, Math.round(onHand)), stamp());
    }
    return { ok: true };
  });

  done();
}

function commitTransaction(db, tx) {
  const store = db.prepare('SELECT id FROM stores LIMIT 1').get();
  const errors = [];

  // Resolve/fetch every line, checking serialized stock (First-Committed-Wins).
  const resolved = tx.items.map((item) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.productId);
    if (!product) {
      errors.push({ productId: item.productId, reason: 'unknown_product' });
      return null;
    }
    const unitPrice = typeof item.unitPrice === 'number' ? item.unitPrice : product.retail_price;
    if (product.is_serialized) {
      const serial = item.serialNumber
        ? db.prepare("SELECT * FROM product_serials WHERE product_id = ? AND serial_number = ?").get(product.id, String(item.serialNumber).trim())
        : null;
      if (!serial) {
        errors.push({ productId: product.id, serialNumber: item.serialNumber, reason: 'serial_not_found' });
        return null;
      }
      if (serial.status !== 'IN_STOCK') {
        errors.push({ productId: product.id, serialNumber: serial.serial_number, reason: 'serial_not_in_stock' });
        return null;
      }
      return { product, serial, quantity: 1, unitPrice };
    }
    const inv = db.prepare('SELECT * FROM inventory WHERE store_id = ? AND product_id = ?').get(store.id, product.id);
    return { product, serial: null, quantity: Math.max(1, item.quantity || 1), unitPrice, onHand: inv ? inv.quantity_on_hand : 0 };
  });

  const hasErrors = errors.length > 0;
  const txId = uuid();
  const grandTotal = tx.grandTotal ?? resolved.reduce((sum, r) => sum + (r ? r.unitPrice * r.quantity : 0), 0);

  const insertTx = db.prepare(
    `INSERT INTO transactions (id, store_id, user_id, device_id, client_tx_id, grand_total, status, tenders_json, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const resolveUserId = db.prepare('SELECT id FROM users WHERE id = ?').get(tx.userId);
  const fallbackUser = db.prepare("SELECT id FROM users WHERE active = 1 ORDER BY role = 'admin' DESC LIMIT 1").get();
  insertTx.run(txId, store.id, resolveUserId ? tx.userId : (fallbackUser ? fallbackUser.id : ''), tx.deviceId || '',
    tx.clientTxId, grandTotal, hasErrors ? 'VOIDED' : 'COMPLETED',
    JSON.stringify(Array.isArray(tx.tenders) ? tx.tenders : []),
    hasErrors ? 'Conflict rejected: ' + errors.map((e) => e.reason).join(', ') : (tx.note || ''),
    tx.createdAt || stamp());

  const insertItem = db.prepare(
    `INSERT INTO transaction_items (id, transaction_id, product_id, serial_id, serial_number, quantity, unit_price)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const [i, r] of resolved.entries()) {
    if (!r) continue;
    insertItem.run(uuid(), txId, r.product.id, r.serial ? r.serial.id : null,
      r.serial ? r.serial.serial_number : null, r.quantity, r.unitPrice);
    if (!hasErrors) {
      if (r.serial) {
        db.prepare("UPDATE product_serials SET status = 'SOLD', updated_at = ? WHERE id = ?").run(stamp(), r.serial.id);
      } else {
        const next = Math.max(0, r.onHand - r.quantity);
        db.prepare('UPDATE inventory SET quantity_on_hand = ?, updated_at = ? WHERE store_id = ? AND product_id = ?')
          .run(next, stamp(), store.id, r.product.id);
      }
    }
  }

  return {
    clientTxId: tx.clientTxId,
    transactionId: txId,
    accepted: !hasErrors,
    status: hasErrors ? 'VOIDED' : 'COMPLETED',
    conflicts: errors,
  };
}

module.exports = { authPlugin, sign, verifyToken };