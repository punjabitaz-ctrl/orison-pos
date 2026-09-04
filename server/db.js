'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'orison.db');
const SECRET_PATH = path.join(DATA_DIR, '.secret');

let db;

function getSecret() {
  if (fs.existsSync(SECRET_PATH)) {
    return fs.readFileSync(SECRET_PATH, 'utf8').trim();
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
  return secret;
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPin(pin, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stores (
  id         TEXT PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  address    TEXT DEFAULT '',
  phone      TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  store_id   TEXT NOT NULL REFERENCES stores(id),
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  pin_hash   TEXT NOT NULL,
  role       TEXT DEFAULT 'cashier',
  active     INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  sku          TEXT UNIQUE,
  upc          TEXT UNIQUE,
  name         TEXT NOT NULL,
  category     TEXT DEFAULT 'General',
  cost_price   REAL NOT NULL DEFAULT 0,
  retail_price REAL NOT NULL DEFAULT 0,
  is_serialized INTEGER DEFAULT 0,
  active       INTEGER DEFAULT 1,
  updated_at   TEXT DEFAULT (datetime('now')),
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory (
  id             TEXT PRIMARY KEY,
  store_id       TEXT NOT NULL REFERENCES stores(id),
  product_id     TEXT NOT NULL REFERENCES products(id),
  quantity_on_hand INTEGER DEFAULT 0,
  updated_at     TEXT DEFAULT (datetime('now')),
  UNIQUE (store_id, product_id)
);

CREATE TABLE IF NOT EXISTS product_serials (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id),
  serial_number TEXT UNIQUE NOT NULL,
  status      TEXT DEFAULT 'IN_STOCK',
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,
  store_id      TEXT NOT NULL REFERENCES stores(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  device_id     TEXT,
  client_tx_id  TEXT UNIQUE,
  grand_total   REAL NOT NULL,
  status        TEXT DEFAULT 'COMPLETED',
  tenders_json  TEXT DEFAULT '[]',
  note          TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transaction_items (
  id             TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  product_id     TEXT NOT NULL REFERENCES products(id),
  serial_id      TEXT,
  serial_number  TEXT,
  quantity       INTEGER DEFAULT 1,
  unit_price     REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_store_created ON transactions(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_serial_product ON product_serials(product_id, status);
CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at);
CREATE INDEX IF NOT EXISTS idx_inventory_updated ON inventory(updated_at);
`;

function initDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

module.exports = {
  initDb,
  getSecret,
  hashPin,
  verifyPin,
  DB_PATH,
};