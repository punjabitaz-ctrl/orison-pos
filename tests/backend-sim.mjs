'use strict';

/* In-memory simulation of the Google Apps Script environment so the GAS
 * backend (backend/Code.gs) can be exercised locally: seeding, login,
 * sync push first-committed-wins, admin gating, transactions, drive export.
 * Run:  node tests/backend-sim.mjs
 */

import { readFileSync } from 'node:fs';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const src = readFileSync(require.resolve('../backend/Code.gs'), 'utf8');

/* ---------- in-memory sheet store ---------- */

function makeStore() {
  const spreadsheets = new Map();
  return {
    create(name) {
      const ss = makeSpreadsheet(name);
      spreadsheets.set(ss.getId(), ss);
      return ss;
    },
    openById(id) {
      if (!spreadsheets.has(id)) throw new Error('no such spreadsheet ' + id);
      return spreadsheets.get(id);
    },
    has(id) {
      return spreadsheets.has(id);
    },
    get ss() {
      return [...spreadsheets.values()][0];
    },
  };
}

function makeRange(sheet, row, col, numRows, numCols) {
  row -= 1; col -= 1;
  return {
    getValues() {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const line = [];
        const sr = row + r;
        for (let c = 0; c < numCols; c++) {
          const sc = col + c;
          line.push(sheet.grid[sr] && sheet.grid[sr][sc] !== undefined ? sheet.grid[sr][sc] : '');
        }
        out.push(line);
      }
      return out;
    },
    setValues(rows) {
      for (let r = 0; r < rows.length; r++) {
        const target = row + r;
        while (sheet.grid.length <= target) sheet.grid.push([]);
        for (let c = 0; c < numCols; c++) {
          sheet.grid[target][col + c] = rows[r] != null && rows[r][c] !== undefined ? rows[r][c] : '';
        }
      }
      return this;
    },
    setValue(v) {
      while (sheet.grid.length <= row) sheet.grid.push([]);
      sheet.grid[row][col] = v;
      return this;
    },
  };
}

function makeSheet(name) {
  const sheet = { name, grid: [] };
  return {
    getName: () => name,
    getLastRow: () => sheet.grid.length,
    getRange: (r, c, nr, nc) => makeRange(sheet, r, c, nr || 1, nc || 1),
    getDataRange() {
      const cols = sheet.grid.reduce((m, r) => Math.max(m, r.length), 0);
      return makeRange(sheet, 1, 1, Math.max(sheet.grid.length, 1), cols || 1);
    },
    setFrozenRows() { return this; },
    _grid: sheet.grid,
  };
}

function makeSpreadsheet(name) {
  const id = randomUUID();
  const sheets = new Map();
  return {
    getId: () => id,
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet(n) {
      const sh = makeSheet(n);
      sheets.set(n, sh);
      return sh;
    },
    _sheets: sheets,
    name,
  };
}

/* ---------- GAS API stubs ---------- */

function b64uToString(b64u) {
  let b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Buffer.from(b64, 'base64').toString('utf8');
}
function bytesToB64u(bytes) {
  const b = Buffer.from(bytes);
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const store = makeStore();
const props = {};
const driveFiles = [];
const driveFolders = [{ id: 'folder-1', name: 'Orison POS Export' }];
const sleeps = [];
const lockAcquisitions = [];
const cacheStore = new Map();
const mails = [];

const sandbox = {
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  parseInt,
  isNaN,
  Error,
  Logger: { log: () => {} },
  ScriptApp: undefined,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: (k) => { delete props[k]; },
      // Returns a copy, as the real service does — callers mutate the result
      // while deleting, and must not be editing the live store underneath.
      getProperties: () => ({ ...props }),
    }),
  },
  Utilities: {
    // Record rather than actually sleep: the delay is what we assert on, and
    // real sleeps would add ~7s to the suite.
    sleep: (ms) => { sleeps.push(ms); },
    getUuid: () => randomUUID(),
    Charset: { UTF_8: 'utf-8' },
    DigestAlgorithm: { SHA_256: 'SHA-256' },
    base64EncodeWebSafe: (s) => Buffer.from(String(s)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    base64DecodeWebSafe: (b64u) => { const b = b64u.replace(/-/g, '+').replace(/_/g, '/'); return [...Buffer.from(b, 'base64').length ? Buffer.from(b.padEnd(b.length + (4 - (b.length % 4)) % 4, '='), 'base64') : Buffer.alloc(0)].map((x) => (x > 127 ? x - 256 : x)); },
    newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString('utf8') }),
    computeDigest: (algo, str) => [...createHash('sha256').update(String(str), 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    computeHmacSha256Signature: (message, key) => [...createHmac('sha256', String(key)).update(String(message), 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
  },
  SpreadsheetApp: {
    openById: (id) => store.openById(id),
    create: (name) => store.create(name),
  },
  LockService: {
    getScriptLock: () => ({
      tryLock: () => { lockAcquisitions.push(Date.now()); return true; },
      releaseLock: () => {},
    }),
  },
  MailApp: {
    sendEmail: (opts) => { mails.push(opts); },
  },
  CacheService: {
    getScriptCache: () => ({
      put: (k, v) => { cacheStore.set(k, String(v)); },
      get: (k) => (cacheStore.has(k) ? cacheStore.get(k) : null),
      remove: (k) => { cacheStore.delete(k); },
    }),
  },
  DriveApp: {
    getFolderById: (id) => (driveFolders.find((f) => f.id === id) ? { getId: () => id, createFile: realCreateFile } : (() => { throw new Error('missing folder ' + id); })()),
    getFoldersByName: (name) => {
      const matches = driveFolders.filter((f) => f.name === name);
      let idx = 0;
      return { hasNext: () => idx < matches.length, next: () => matches[idx++], _matches: matches };
    },
    createFolder: (name) => {
      const f = { id: 'folder-' + randomUUID(), name };
      driveFolders.push(f);
      return { getId: () => f.id, createFile: () => { throw new Error('unexpected'); } };
    },
  },
  MimeType: { CSV: 'text/csv', JSON: 'application/json' },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (str) => {
      const obj = { _json: JSON.parse(str), getContent: () => str };
      obj.setMimeType = () => obj;
      return obj;
    },
  },
};

/* DriveApp folder mock needs createFile on matched folder objects too */
driveFolders.forEach(() => {});
const origGetFoldersByName = sandbox.DriveApp.getFoldersByName;
const realCreateFile = (name, content, mime) => {
  const file = { id: 'file-' + randomUUID(), name, content, mime, url: 'https://drive.google.com/file?id=dummy' };
  driveFiles.push(file);
  return { getId: () => file.id, getName: () => file.name, getUrl: () => file.url };
};
sandbox.DriveApp.getFoldersByName = (name) => {
  const it = origGetFoldersByName(name);
  const origNext = it.next.bind(it);
  if (!it._matches.length) {
    const f = { id: 'folder-auto', name };
    driveFolders.push(f);
    return { hasNext: () => true, next: () => ({ getId: () => f.id, createFile: realCreateFile }) };
  }
  return { hasNext: () => true, next: () => ({ getId: () => it._matches[0].id, createFile: realCreateFile }) };
};
sandbox.DriveApp.createFolder = (name) => {
  const f = { id: 'folder-new', name };
  driveFolders.push(f);
  return { getId: () => f.id, createFile: realCreateFile };
};

/* URL uniqueness: mock createFile takes (name, content, mime) */
void realCreateFile;

/* ---------- load Code.gs ---------- */

vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'Code.gs' });

const api = {
  ssId: () => props.SPREADSHEET_ID,
};

function call(body) {
  const out = sandbox.doPost({ postData: { contents: JSON.stringify(body) } });
  return out && out._json;
}

function req(action, payload = {}, opts = {}) {
  return call({
    action,
    method: opts.method || 'POST',
    params: opts.params || {},
    payload,
    appToken: props.APP_TOKEN,
    session: opts.session || null,
  });
}

/* ---------- tests ---------- */

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
function section(name) { console.log('\n== ' + name); }

props.APP_TOKEN = 'test-app-token-abc';

section('seed / workbook auto-create');
// Seed PINs are generated randomly and never committed, so the suite reads the
// credentials the seed reported for this run instead of hardcoding them.
sandbox.ensureSeed_();
const CREDS = {};
for (const c of sandbox.SEED_CREDENTIALS) CREDS[c.email] = c.pin;
check('seed reported one credential per starter account', sandbox.SEED_CREDENTIALS.length === 4);
check('seeded PINs are 6 digits and not all identical',
  sandbox.SEED_CREDENTIALS.every((c) => /^\d{6}$/.test(c.pin)) &&
  new Set(sandbox.SEED_CREDENTIALS.map((c) => c.pin)).size > 1);

const seeded = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] });
check('blank workbook had no spreadsheet yet', true, '');
check('login returns token + user + store', seeded.ok === true && seeded.data.token && seeded.data.user.role === 'admin');
const adminToken = seeded.data.token;

const ss = store.ss;
check('workbook created with all tabs', ['Meta', 'Users', 'Products', 'Serials', 'Transactions', 'Conflicts'].every((t) => ss._sheets.has(t)));
check('products sheet carries new columns', ((hdr) => ['item_type', 'locked', 'reorder_point', 'last_sold_at'].every((c) => hdr.includes(c)))(ss._sheets.get('Products')._grid[0]));
const products = req('/api/products', {}, { session: adminToken });
check('catalog has 44 products (incl. 2 services)', products.ok && products.data.length === 44, JSON.stringify({ n: products.ok ? products.data.length : 0 }));
check('service item has no stock & is not serialized', (() => { const s = products.data.find((p) => p.sku === 'SRV-REPAIR'); return s && s.itemType === 'service' && s.isSerialized === false && s.onHand === 0; })());
check('serialized phone exposes serials + onHand count', (() => {
  const s24 = products.data.find((p) => p.sku === 'PH-S24U-256');
  return s24 && s24.isSerialized === true && s24.onHand === 4 && s24.serials.length === 4;
})());

section('auth');
const badPw = req('/api/login', { email: 'tariq@example.com', pin: '999999' });
check('bad PIN → 401', badPw.ok === false && badPw.status === 401);
const noToken = req('/api/products');
check('missing session → 401', noToken.ok === false && noToken.status === 401);
check('bad app token → 401', (() => {
  const out = call({ action: '/api/products', appToken: 'wrong', session: adminToken, payload: {}, method: 'GET' });
  return out.ok === false && out.status === 401;
})());

section('offline credential');
const off1 = req('/api/login', { email: 'amara@example.com', pin: CREDS['amara@example.com'], deviceId: 'dev-off-1' });
check('login returns an opaque 256-bit offline key', off1.ok && typeof off1.data.offlineKey === 'string' && off1.data.offlineKey.length === 64, JSON.stringify(off1.data));
check('offline key is distinct from the session token', off1.ok && off1.data.offlineKey !== off1.data.token);
check('offline key is fresh per sign-in', (() => {
  const off2 = req('/api/login', { email: 'amara@example.com', pin: CREDS['amara@example.com'], deviceId: 'dev-off-2' });
  return off2.ok && off2.data.offlineKey !== off1.data.offlineKey;
})());

section('sync push — first-committed-wins');
const s24 = products.data.find((p) => p.sku === 'PH-S24U-256');
const usb = products.data.find((p) => p.sku === 'CB-USBC-1M');
const serial = s24.serials[0];
const pin = req('/api/login', { email: 'amara@example.com', pin: CREDS['amara@example.com'] });
const cashierToken = pin.data.token;
check('cashier login ok', pin.ok);

const push1 = req('/api/sync/push', {
  deviceId: 'dev-A',
  batch: [{
    clientTxId: 'tx-abc-1',
    userId: pin.data.user.id,
    grandTotal: 1311,
    tenders: [{ type: 'card', amount: 1311 }],
    note: '',
    createdAt: new Date().toISOString(),
    items: [
      { productId: s24.id, serialNumber: serial, quantity: 1, unitPrice: 1299 },
      { productId: usb.id, quantity: 1, unitPrice: 12 },
    ],
  }],
}, { session: cashierToken });
const r1 = push1.data.results[0];
check('first claim accepted', r1.accepted === true && push1.ok === true, JSON.stringify(push1));

const after = req('/api/products', {}, { session: adminToken });
const s24after = after.data.find((p) => p.sku === 'PH-S24U-256');
check('serial removed from stock after sale', s24after.onHand === 3 && !s24after.serials.includes(serial));
const usbAfter = after.data.find((p) => p.sku === 'CB-USBC-1M');
check('non-serialized stock decremented', usbAfter.onHand === 39);

const push2 = req('/api/sync/push', {
  deviceId: 'dev-B',
  batch: [{
    clientTxId: 'tx-abc-2',
    userId: pin.data.user.id,
    grandTotal: 1299,
    tenders: [],
    note: '',
    createdAt: new Date().toISOString(),
    items: [{ productId: s24.id, serialNumber: serial, quantity: 1, unitPrice: 1299 }],
  }],
}, { session: cashierToken });
const r2 = push2.data.results[0];
check('second claim of same IMEI rejected as VOIDED', r2.accepted === false && r2.status === 'VOIDED', JSON.stringify(r2));

section('transactions');
const txList = req('/api/transactions', {}, { params: { limit: '100' }, session: adminToken });
const txs = txList.data.transactions;
check('completed transactions listed w/ cashier + items', txs.length === 1 && txs[0].cashier === 'Amara Njoku' && txs[0].items.length === 2, JSON.stringify(txs));

section('admin + role gating');
const cashierCreate = req('/api/admin/products', { name: 'X', sku: 'X-1' }, { session: cashierToken });
check('cashier admin create → 403', cashierCreate.ok === false && cashierCreate.status === 403);

const mgr = req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] });
check('manager login ok', mgr.ok && mgr.data.user.role === 'manager');
const mgrToken = mgr.data.token;
const newProd = req('/api/admin/products', {
  name: 'Test Speaker', sku: 'TS-SPK-01', upc: '0099999999999',
  category: 'Audio', costPrice: 10, retailPrice: 25, isSerialized: false, onHand: 5,
}, { session: mgrToken });
check('manager can create product', newProd.ok && !!newProd.data.id, JSON.stringify(newProd));

const dup = req('/api/admin/products', { name: 'Test Speaker', sku: 'TS-SPK-01', upc: 'x' }, { session: mgrToken });
check('duplicate SKU → 409', dup.ok === false && dup.status === 409);

const serialsResp = req('/api/admin/serials', {
  productId: s24.id,
  serialNumbers: ['NEW-SN-0001', 'NEW-SN-0001'],
}, { session: mgrToken });
const serialsData = serialsResp.data || {};
check('serials add w/ dup detection', serialsData.added && serialsData.added.length === 1 && serialsData.duplicates.length === 1, JSON.stringify(serialsResp));

const nonSerializedSerials = req('/api/admin/serials', { productId: usb.id, serialNumbers: ['SN1'] }, { session: mgrToken });
check('serials on non-serialized → 400', nonSerializedSerials.ok === false && nonSerializedSerials.status === 400);

const inv = req('/api/admin/inventory', { productId: usb.id, onHand: 100 }, { session: mgrToken });
check('inventory adjust ok', inv.ok && inv.data.onHand === 100);

section('drive export');
const drv = req('/api/drive/export', { date: new Date().toISOString().slice(0, 10) }, { session: mgrToken });
check('export produced a CSV file', drv.ok && drv.data.rows === 1 && drv.data.url, JSON.stringify(drv));
const exported = driveFiles.find((f) => f.id === drv.data.fileId);
check('CSV content sane', exported && exported.content.includes('Amara Njoku') && exported.content.includes('1311'));

section('products snapshot after admin ops');
const final = req('/api/products', {}, { session: adminToken });
const finusb = final.data.find((p) => p.sku === 'CB-USBC-1M');
const fins24 = final.data.find((p) => p.sku === 'PH-S24U-256');
check('usb onHand = 100 after inventory adjust', finusb.onHand === 100);
check('s24 still 3 in stock (new serial added)', fins24.onHand === 4);

section('conflicts — multi-device flagging & review');
const fig = req('/api/conflicts', {}, { session: cashierToken });
check('cashier cannot list conflicts → 403', fig.ok === false && fig.status === 403);

const conflicts = req('/api/conflicts', {}, { session: mgrToken });
const openSeral = (conflicts.data.conflicts || []).find((c) => c.type === 'SERIAL_CLAIM' && c.status === 'OPEN');
check('serial claim flagged OPEN for manager review', !!openSeral && openSeral.serialNumber === serial, JSON.stringify(openSeral));
check('conflict lists the losing transaction id', !!openSeral && openSeral.loserClientTx === 'tx-abc-2');

const openCountInPull = req('/api/sync/pull', {}, { session: mgrToken });
check('sync pull exposes open conflict count', openCountInPull.ok && openCountInPull.data.openConflicts >= 1, 'open=' + (openCountInPull.data || {}).openConflicts);

const review = req('/api/conflicts/review', { id: openSeral.id, decision: 'resolve' }, { session: mgrToken });
check('manager can resolve a conflict', review.ok && review.data.status === 'RESOLVED', JSON.stringify(review));
const conflictsAfter = req('/api/conflicts', {}, { session: mgrToken });
check('resolved conflict no longer OPEN', conflictsAfter.ok && !(conflictsAfter.data.conflicts || []).find((c) => c.id === openSeral.id && c.status === 'OPEN'));

section('idempotent re-push & duplicate-client detection');
const rePush = req('/api/sync/push', {
  deviceId: 'dev-A',
  batch: [{
    clientTxId: 'tx-abc-1',
    userId: pin.data.user.id,
    grandTotal: 1311,
    tenders: [{ type: 'card', amount: 1311 }],
    note: '',
    createdAt: new Date().toISOString(),
    items: [
      { productId: s24.id, serialNumber: serial, quantity: 1, unitPrice: 1299 },
      { productId: usb.id, quantity: 1, unitPrice: 12 },
    ],
  }],
}, { session: cashierToken });
check('identical re-push is idempotent (ALREADY_SYNCED)', rePush.ok && rePush.data.results[0].accepted === true && rePush.data.results[0].status === 'ALREADY_SYNCED', JSON.stringify(rePush));
const txList2 = req('/api/transactions', {}, { params: { limit: '100' }, session: adminToken });
check('re-push did not duplicate the transaction', txList2.data.transactions.filter((t) => t.clientTxId === 'tx-abc-1').length === 1);

const changePush = req('/api/sync/push', {
  deviceId: 'dev-A',
  batch: [{
    clientTxId: 'tx-abc-1',
    userId: pin.data.user.id,
    grandTotal: 1399,
    tenders: [{ type: 'card', amount: 1399 }],
    note: '',
    createdAt: new Date().toISOString(),
    items: [{ productId: usb.id, quantity: 2, unitPrice: 12 }],
  }],
}, { session: cashierToken });
check('changed content for same id → flag (DUPLICATE_CLIENT)', changePush.ok && changePush.data.results[0].conflicts.some((c) => c.reason === 'duplicate_client_tx'), JSON.stringify(changePush));
const dupInList = req('/api/conflicts', {}, { session: mgrToken });
check('duplicate push flagged in conflict list', (dupInList.data.conflicts || []).some((c) => c.type === 'DUPLICATE_CLIENT' && c.status === 'OPEN'));

section('clock-skew flagging');
const OTHER = products.data.find((p) => p.sku !== 'CB-USBC-1M' && !p.isSerialized);
const skewPush = req('/api/sync/push', {
  deviceId: 'dev-C',
  batch: [{
    clientTxId: 'tx-skew-1',
    userId: pin.data.user.id,
    grandTotal: 100,
    tenders: [],
    note: '',
    createdAt: '2015-01-01T00:00:00.000Z',
    items: [{ productId: OTHER.id, quantity: 1, unitPrice: 100 }],
  }],
}, { session: cashierToken });
const skewRes = skewPush.data.results[0];
check('past-clock sale accepted but flagged CLOCK_SKEW', skewPush.ok && skewRes.accepted === true && skewRes.status === 'COMPLETED' && skewRes.conflicts.some((c) => c.reason === 'clock_skew'), JSON.stringify(skewPush));

section('drive export — cashier daily report');
const cashierExport = req('/api/drive/export', { date: new Date().toISOString().slice(0, 10) }, { session: cashierToken });
check('cashier can pull a daily report', cashierExport.ok && cashierExport.data.scope === 'cashier' && cashierExport.data.rows === 1, JSON.stringify(cashierExport));
const cashierFile = driveFiles.find((f) => f.id === cashierExport.data.fileId);
check('cashier report is scoped to her own sales', !!cashierFile && cashierFile.content.includes('Amara Njoku') && !cashierFile.content.includes('Tariq'));
check('cashier report filename is unique per cashier', !!cashierFile && cashierFile.name !== 'orison-pos-sales-' + new Date().toISOString().slice(0, 10) + '.csv' && cashierFile.name.includes('.csv'));

section('services, locked items & last_sold_at');
const svc = req('/api/products', {}, { session: adminToken }).data.find((p) => p.sku === 'SRV-REPAIR');
const usb2 = req('/api/products', {}, { session: adminToken }).data.find((p) => p.sku === 'CB-USBC-1M');
const svcPush = req('/api/sync/push', {
  deviceId: 'dev-D',
  batch: [{
    clientTxId: 'tx-svc-1',
    userId: pin.data.user.id,
    grandTotal: 49,
    tenders: [],
    note: '',
    createdAt: new Date().toISOString(),
    items: [{ productId: svc.id, quantity: 1, unitPrice: 49 }],
  }],
}, { session: cashierToken });
check('service sale accepted without stock', svcPush.ok && svcPush.data.results[0].accepted === true && svcPush.data.results[0].status === 'COMPLETED', JSON.stringify(svcPush));
const svcProd = req('/api/products', {}, { session: adminToken }).data.find((p) => p.sku === 'SRV-REPAIR');
check('service still has zero stock after sale', svcProd.onHand === 0);

const patch = req('/api/admin/products/patch', { productId: usb2.id, reorderPoint: 12, locked: true }, { session: mgrToken });
check('manager patches reorder point + lock', patch.ok === true, JSON.stringify(patch));
const lockSold = req('/api/sync/push', {
  deviceId: 'dev-E',
  batch: [{
    clientTxId: 'tx-lock-1',
    userId: pin.data.user.id,
    grandTotal: 12,
    tenders: [],
    note: '',
    createdAt: new Date().toISOString(),
    items: [{ productId: usb2.id, quantity: 1, unitPrice: 12 }],
  }],
}, { session: cashierToken });
check('locked product sale rejected as VOIDED', lockSold.ok && lockSold.data.results[0].accepted === false && lockSold.data.results[0].status === 'VOIDED', JSON.stringify(lockSold));
const unpatch = req('/api/admin/products/patch', { productId: usb2.id, reorderPoint: 12, locked: false }, { session: mgrToken });
check('manager unlocks + keeps reorder point', unpatch.ok === true);

const lastSold = req('/api/products', {}, { session: adminToken }).data.find((p) => p.sku === 'CB-USBC-1M');
check('product lastSoldAt stamped after sale', !!lastSold.lastSoldAt);

section('refunds — full/partial, serialized, guards');
const spkR = req('/api/products', {}, { session: adminToken }).data.find((p) => p.sku === 'TS-SPK-01');
const saleRef = req('/api/sync/push', {
  deviceId: 'dev-R',
  batch: [{
    clientTxId: 'tx-spk-1', userId: pin.data.user.id, grandTotal: 50,
    tenders: [{ type: 'cash', amount: 50 }], note: '',
    createdAt: new Date().toISOString(),
    items: [{ productId: spkR.id, quantity: 2, unitPrice: 25 }],
  }],
}, { session: cashierToken });
check('sale accepted before refund', saleRef.ok && saleRef.data.results[0].accepted === true, JSON.stringify(saleRef));

const rf1 = req('/api/sync/push', {
  deviceId: 'dev-R',
  batch: [{
    clientTxId: 'tx-spk-1-rf1', kind: 'refund', originalClientTx: 'tx-spk-1', counterparty: '',
    userId: pin.data.user.id, grandTotal: 25, tenders: [{ type: 'cash', amount: 25 }],
    note: 'partial refund', createdAt: new Date().toISOString(),
    items: [{ productId: spkR.id, quantity: 1, unitPrice: 25 }],
  }],
}, { session: cashierToken });
check('partial refund accepted + COMPLETED', rf1.ok && rf1.data.results[0].accepted === true && rf1.data.results[0].status === 'COMPLETED', JSON.stringify(rf1));
let spkR1 = req('/api/products', {}, { session: adminToken }).data.find((p) => p.sku === 'TS-SPK-01');
check('stock restored after partial refund (3 → 4)', spkR1.onHand === 4);

const rf2 = req('/api/sync/push', {
  deviceId: 'dev-R',
  batch: [{
    clientTxId: 'tx-spk-1-rf2', kind: 'refund', originalClientTx: 'tx-spk-1',
    userId: pin.data.user.id, grandTotal: 20, tenders: [], note: '',
    createdAt: new Date().toISOString(),
    items: [{ productId: spkR.id, quantity: 2, unitPrice: 10 }],
  }],
}, { session: cashierToken });
check('refund exceeding outstanding per-line → VOIDED', rf2.ok && rf2.data.results[0].accepted === false && rf2.data.results[0].conflicts[0].reason === 'refund_exceeds_sale_lines', JSON.stringify(rf2));

const rf3 = req('/api/sync/push', {
  deviceId: 'dev-R',
  batch: [{
    clientTxId: 'tx-spk-1-rf3', kind: 'refund', originalClientTx: 'tx-spk-1',
    userId: pin.data.user.id, grandTotal: 25, tenders: [], note: '',
    createdAt: new Date().toISOString(),
    items: [{ productId: spkR.id, quantity: 1, unitPrice: 25 }],
  }],
}, { session: cashierToken });
check('remaining outstanding refunded back to original stock', rf3.ok && rf3.data.results[0].accepted === true, JSON.stringify(rf3));
spkR1 = req('/api/products', {}, { session: adminToken }).data.find((p) => p.sku === 'TS-SPK-01');
check('stock fully restored (5)', spkR1.onHand === 5);

const rf4 = req('/api/sync/push', {
  deviceId: 'dev-R',
  batch: [{
    clientTxId: 'tx-spk-1-rf4', kind: 'refund', originalClientTx: 'tx-spk-1',
    userId: pin.data.user.id, grandTotal: 25, tenders: [], note: '',
    createdAt: new Date().toISOString(),
    items: [{ productId: spkR.id, quantity: 1, unitPrice: 25 }],
  }],
}, { session: cashierToken });
check('refund beyond sale total → VOIDED refund_exceeds_sale', rf4.ok && rf4.data.results[0].accepted === false && rf4.data.results[0].conflicts[0].reason === 'refund_exceeds_sale', JSON.stringify(rf4));

const rfSerial = req('/api/sync/push', {
  deviceId: 'dev-R',
  batch: [{
    clientTxId: 'tx-abc-1-rf1', kind: 'refund', originalClientTx: 'tx-abc-1',
    userId: pin.data.user.id, grandTotal: 1299, tenders: [{ type: 'store_credit', amount: 1299 }],
    note: 'serialized refund', createdAt: new Date().toISOString(),
    items: [{ productId: s24.id, serialNumber: serial, quantity: 1, unitPrice: 1299 }],
  }],
}, { session: cashierToken });
check('serialized refund accepted', rfSerial.ok && rfSerial.data.results[0].accepted === true, JSON.stringify(rfSerial));
const s24r = req('/api/products', {}, { session: adminToken }).data.find((p) => p.sku === 'PH-S24U-256');
check('serial returned to IN_STOCK and stock restored', s24r.onHand === 5 && s24r.serials.includes(serial));

const rfOfRefund = req('/api/sync/push', {
  deviceId: 'dev-R',
  batch: [{
    clientTxId: 'tx-rf-rof', kind: 'refund', originalClientTx: 'tx-spk-1-rf1',
    userId: pin.data.user.id, grandTotal: 10, tenders: [], note: '',
    createdAt: new Date().toISOString(),
    items: [{ productId: spkR.id, quantity: 1, unitPrice: 10 }],
  }],
}, { session: cashierToken });
check('cannot refund a refund → original_not_found', rfOfRefund.ok && rfOfRefund.data.results[0].accepted === false && rfOfRefund.data.results[0].conflicts[0].reason === 'original_not_found', JSON.stringify(rfOfRefund));

const rfGhost = req('/api/sync/push', {
  deviceId: 'dev-R',
  batch: [{
    clientTxId: 'tx-rf-ghost', kind: 'refund', originalClientTx: 'tx-does-not-exist',
    userId: pin.data.user.id, grandTotal: 10, tenders: [], note: '',
    createdAt: new Date().toISOString(),
    items: [{ productId: spkR.id, quantity: 1, unitPrice: 10 }],
  }],
}, { session: cashierToken });
check('refund with no original → original_not_found', rfGhost.ok && rfGhost.data.results[0].conflicts[0].reason === 'original_not_found', JSON.stringify(rfGhost));

const rfUnsold = req('/api/sync/push', {
  deviceId: 'dev-R',
  batch: [{
    clientTxId: 'tx-rf-unsold', kind: 'refund', originalClientTx: 'tx-abc-1',
    userId: pin.data.user.id, grandTotal: 10, tenders: [], note: '',
    createdAt: new Date().toISOString(),
    items: [{ productId: s24.id, serialNumber: 'NEW-SN-0001', quantity: 1, unitPrice: 10 }],
  }],
}, { session: cashierToken });
check('refund of unsold serial → VOIDED serial_not_sold', rfUnsold.ok && rfUnsold.data.results[0].accepted === false && rfUnsold.data.results[0].conflicts[0].reason === 'serial_not_sold', JSON.stringify(rfUnsold));

section('cash payouts');
const payoutCashier = req('/api/sync/push', {
  deviceId: 'dev-P',
  batch: [{
    clientTxId: 'tx-po-1', kind: 'payout', counterparty: 'Nike Official',
    userId: pin.data.user.id, grandTotal: 500, tenders: [], note: '',
    createdAt: new Date().toISOString(),
  }],
}, { session: cashierToken });
check('cashier payout → VOIDED unauthorized_role', payoutCashier.ok && payoutCashier.data.results[0].accepted === false && payoutCashier.data.results[0].conflicts[0].reason === 'unauthorized_role', JSON.stringify(payoutCashier));

const payoutMgr = req('/api/sync/push', {
  deviceId: 'dev-P',
  batch: [{
    clientTxId: 'tx-po-2', kind: 'payout', counterparty: 'Nike Official',
    userId: pin.data.user.id, grandTotal: 2000, tenders: [{ type: 'cash', amount: 2000 }],
    note: 'vendor restock', createdAt: new Date().toISOString(),
  }],
}, { session: mgrToken });
check('manager payout accepted + COMPLETED', payoutMgr.ok && payoutMgr.data.results[0].accepted === true && payoutMgr.data.results[0].status === 'COMPLETED', JSON.stringify(payoutMgr));

const txAll = req('/api/transactions', {}, { session: adminToken }).data.transactions;
check('transactions expose refund kind + originalClientTx', txAll.some((t) => t.kind === 'refund' && t.originalClientTx === 'tx-abc-1') && txAll.some((t) => t.kind === 'refund' && t.originalClientTx === 'tx-spk-1'), JSON.stringify(txAll.slice(0, 3)));
check('transactions expose payout kind + counterparty', txAll.some((t) => t.kind === 'payout' && t.counterparty === 'Nike Official'), JSON.stringify(txAll.slice(0, 3)));
check('legacy rows still read as kind sale', txAll.some((t) => (t.kind || 'sale') === 'sale' && t.clientTxId === 'tx-abc-1'));

section('drive export — cash summary');
const expAll = req('/api/drive/export', { date: new Date().toISOString().slice(0, 10) }, { session: mgrToken });
check('export rows count includes refunds + payouts', expAll.ok && expAll.data.rows === 7, JSON.stringify(expAll));
const expAllFile = driveFiles.find((f) => f.id === expAll.data.fileId);
check('CSV has kind column + refund/payout values', !!expAllFile && expAllFile.content.includes('kind') && expAllFile.content.includes('refund') && expAllFile.content.includes('Nike Official'));
check('CSV cash summary correct', !!expAllFile && expAllFile.content.includes('NET CASH') && expAllFile.content.includes('-1939') && expAllFile.content.includes('PAID OUT') && expAllFile.content.includes('SALES'));

section('schema migration — append new TX columns');
const txGridFull = ss._sheets.get('Transactions')._grid;
txGridFull[0] = txGridFull[0].slice(0, 11);
sandbox.sheet_('Transactions', sandbox.TX_HEADERS);
const txHdr = txGridFull[0];
check('migration appends kind/original_client_tx/counterparty', txHdr.includes('kind') && txHdr.includes('original_client_tx') && txHdr.includes('counterparty'), JSON.stringify(txHdr));
check('migration preserves existing columns', txHdr[0] === 'id' && txHdr[8] === 'grand_total' && txHdr[9] === 'status');

section('security fixes — role-scoped data (cost price / transactions)');

/* one COMPLETED sale attributed to the manager so scoping has a distinguisher */
const sarahSale = req('/api/sync/push', {
  deviceId: 'dev-S',
  batch: [{
    clientTxId: 'tx-sec-1', userId: mgr.data.user.id, grandTotal: 25,
    tenders: [{ type: 'card', amount: 25 }], note: 'scoped-tx',
    createdAt: new Date().toISOString(),
    items: [{ productId: spkR.id, quantity: 1, unitPrice: 25 }],
  }],
}, { session: mgrToken });
check('scoped sale (attributed to manager) accepted', sarahSale.ok && sarahSale.data.results[0].accepted === true, JSON.stringify(sarahSale));

const prodCash = req('/api/products', {}, { session: cashierToken });
const prodAdmin = req('/api/products', {}, { session: adminToken });
const costCash = prodCash.data.find((p) => p.sku === 'TS-SPK-01');
const costAdmin = prodAdmin.data.find((p) => p.sku === 'TS-SPK-01');
check('cashier catalog hides costPrice', prodCash.ok && costCash && costCash.costPrice === null, JSON.stringify(costCash));
check('admin/manager catalog keeps costPrice', prodAdmin.ok && typeof costAdmin.costPrice === 'number', JSON.stringify(costAdmin));

const pullCash = req('/api/sync/pull', {}, { session: cashierToken });
check('sync pull to cashier hides costPrice too', pullCash.ok && pullCash.data.products.find((p) => p.sku === 'TS-SPK-01').costPrice === null);

const txCash = req('/api/transactions', {}, { params: { limit: '500' }, session: cashierToken }).data.transactions;
const txAdm = req('/api/transactions', {}, { params: { limit: '500' }, session: adminToken }).data.transactions;
const txMgr2 = req('/api/transactions', {}, { params: { limit: '500' }, session: mgrToken }).data.transactions;
check('cashier ledger excludes manager-attributed tx', txCash.length > 0 && !txCash.some((t) => t.clientTxId === 'tx-sec-1'), JSON.stringify({ n: txCash.length }));
check('cashier ledger strictly smaller than store ledger', txCash.length === txAdm.length - 1, JSON.stringify({ c: txCash.length, a: txAdm.length }));
check('manager ledger matches admin ledger', txMgr2.length === txAdm.length && txMgr2.some((t) => t.clientTxId === 'tx-sec-1'));
check('cashier sees only self-attributed rows', txCash.every((t) => String(t.user_id) === String(pin.data.user.id)));

section('security fixes — CSV formula guard');
check('leading = neutralized', sandbox.csvCell_('=HYPERLINK(1)') === "'=HYPERLINK(1)");
check('+ leading neutralized', sandbox.csvCell_('+SUM(A1)') === "'+SUM(A1)");
check('- leading neutralized', sandbox.csvCell_('-1+2') === "'-1+2");
check('@ leading neutralized', sandbox.csvCell_('@cmd') === "'@cmd");
check('= with quotes+commas fully escaped', sandbox.csvCell_('=a,"b"') === '"\'=a,""b"""');
check('plain text unchanged', sandbox.csvCell_('Nike Official') === 'Nike Official');
check('quotes + commas still escaped', sandbox.csvCell_('a,"b"') === '"a,""b"""');
check('numeric / empty cells unchanged', sandbox.csvCell_('1337') === '1337' && sandbox.csvCell_('') === '' && sandbox.csvCell_(0) === '0');

section('login throttling');
{
  const victim = 'diego@example.com';
  const goodPin = CREDS[victim];

  // The failure path must neither sleep nor take the script lock. Utilities.sleep
  // bills the daily runtime quota; the script lock is held for seconds at a time
  // by syncPush_, and waiting on it pushes the 401 past the client's 8s timeout,
  // where api.js reports it as "offline" and login.js falls back to offline PIN.
  sleeps.length = 0;
  lockAcquisitions.length = 0;
  const early = [];
  for (let i = 0; i < 4; i++) early.push(req('/api/login', { email: victim, pin: '000000' }));
  check('wrong PIN is rejected', early.every((r) => r.ok === false && r.status === 401));
  check('failed logins do not sleep', sleeps.length === 0, JSON.stringify(sleeps));
  check('failed logins do not take the script lock', lockAcquisitions.length === 0,
    lockAcquisitions.length + ' acquisitions');

  const fifth = req('/api/login', { email: victim, pin: '000000' });
  check('fifth wrong PIN still 401', fifth.ok === false && fifth.status === 401);

  const locked = req('/api/login', { email: victim, pin: '000000' });
  check('further attempts are locked out with 429', locked.ok === false && locked.status === 429);

  // The lockout must hold even for the CORRECT PIN, or it buys nothing.
  check('correct PIN is refused while locked out',
    req('/api/login', { email: victim, pin: goodPin }).status === 429);

  check('lockout does not spill onto another account',
    req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] }).ok === true);

  // The window runs from the LAST failure, so a lockout is a full 15 minutes
  // rather than 15 minutes minus however long the attack already ran.
  {
    const prefix = 'lf_';
    const mine = Object.keys(props).filter((k) => k.startsWith(prefix));
    check('failures are stored as one marker each', mine.length >= 5, mine.length + ' markers');

    // Age this account's markers to just inside the window: still locked.
    const age = (ms) => {
      for (const k of Object.keys(props).filter((x) => x.startsWith(prefix))) {
        const parts = k.split('_');
        const moved = parts[0] + '_' + parts[1] + '_' + (Date.now() - ms) + '_' + parts[3];
        props[moved] = props[k];
        delete props[k];
      }
    };
    age(15 * 60 * 1000 - 5000);
    check('still locked 5s before the window closes',
      req('/api/login', { email: victim, pin: goodPin }).status === 429);

    age(15 * 60 * 1000 + 1000);
    check('released once the window has fully elapsed',
      req('/api/login', { email: victim, pin: goodPin }).ok === true);
  }

  // The store-filling attack: one failure each against many addresses that are
  // never seen again. Deleting expired records only when the SAME address is
  // looked up again leaves every one of them behind forever.
  {
    const before = Object.keys(props).filter((k) => k.startsWith('lf_')).length;
    for (let i = 0; i < 60; i++) req('/api/login', { email: 'probe' + i + '@example.com', pin: '000000' });
    const during = Object.keys(props).filter((k) => k.startsWith('lf_')).length;
    check('each distinct address leaves a marker while it is live', during >= before + 60,
      before + ' -> ' + during);

    // Age every marker past the window, then make one unrelated request.
    for (const k of Object.keys(props).filter((x) => x.startsWith('lf_'))) {
      const parts = k.split('_');
      props[parts[0] + '_' + parts[1] + '_' + (Date.now() - 16 * 60 * 1000) + '_' + parts[3]] = props[k];
      delete props[k];
    }
    // Deletions are capped per request so a backlog never stalls one login;
    // the sweep drains across requests instead.
    const beforeSweep = Object.keys(props).filter((k) => k.startsWith('lf_')).length;
    req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] });
    const afterOne = Object.keys(props).filter((k) => k.startsWith('lf_')).length;
    check('one request never deletes more than its budget',
      beforeSweep - afterOne <= 50, 'deleted ' + (beforeSweep - afterOne));

    for (let i = 0; i < 5; i++) {
      req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] });
    }
    const after = Object.keys(props).filter((k) => k.startsWith('lf_')).length;
    check('expired markers for addresses never seen again are swept', after === 0,
      after + ' left behind');
  }

  // Eviction under the ceiling must not hand a locked account a clean slate.
  {
    for (let i = 0; i < 5; i++) req('/api/login', { email: victim, pin: '000000' });
    check('victim is locked before the flood',
      req('/api/login', { email: victim, pin: goodPin }).status === 429);

    // Far more one-off failures than the ceiling, from throwaway addresses.
    for (let i = 0; i < 1200; i++) {
      req('/api/login', { email: 'flood' + i + '@example.com', pin: '000000' });
    }
    check('victim is still locked after the flood',
      req('/api/login', { email: victim, pin: goodPin }).status === 429,
      'evicting the globally oldest markers would have released it');
    check('storage stayed bounded during the flood',
      Object.keys(props).filter((k) => k.startsWith('lf_')).length <= 1000 + 50,
      Object.keys(props).filter((k) => k.startsWith('lf_')).length + ' markers');

    req('/api/admin/unlock', { email: victim }, { session: adminToken });
  }

  // An admin can release a lockout from the till, not only the script editor.
  for (let i = 0; i < 5; i++) req('/api/login', { email: victim, pin: '000000' });
  check('locked again after five failures',
    req('/api/login', { email: victim, pin: goodPin }).status === 429);

  const cashierUnlock = req('/api/admin/unlock', { email: victim }, { session: cashierToken });
  check('cashier may not clear a lockout', cashierUnlock.ok === false && cashierUnlock.status === 403);

  check('admin can clear a lockout',
    req('/api/admin/unlock', { email: victim }, { session: adminToken }).ok === true);
  check('account works again after admin unlock',
    req('/api/login', { email: victim, pin: goodPin }).ok === true);

  check('unknown address is rejected the same way',
    req('/api/login', { email: 'nobody@example.com', pin: '000000' }).status === 401);
}

section('admin PIN reset');
{
  const target = 'amara@example.com';
  check('cashier may not reset a PIN',
    req('/api/admin/pin', { email: target, pin: '111111' }, { session: cashierToken }).status === 403);
  check('manager may not reset a PIN',
    req('/api/admin/pin', { email: target, pin: '111111' }, { session: mgr.data.token }).status === 403);
  check('a 4-digit PIN is refused',
    req('/api/admin/pin', { email: target, pin: '1111' }, { session: adminToken }).status === 400);
  check('an unknown address is refused',
    req('/api/admin/pin', { email: 'nobody@example.com', pin: '111111' }, { session: adminToken }).status === 404);

  const reset = req('/api/admin/pin', { email: target, pin: '246813' }, { session: adminToken });
  check('admin can reset a PIN', reset.ok === true);
  check('the new PIN works', req('/api/login', { email: target, pin: '246813' }).ok === true);
  check('the old PIN no longer works',
    req('/api/login', { email: target, pin: CREDS[target] }).status === 401);

  // Recovery path: a locked-out account is usable again straight after a reset.
  for (let i = 0; i < 5; i++) req('/api/login', { email: target, pin: '000000' });
  check('locked after five failures', req('/api/login', { email: target, pin: '246813' }).status === 429);
  req('/api/admin/pin', { email: target, pin: '135791' }, { session: adminToken });
  check('a PIN reset also clears the lockout',
    req('/api/login', { email: target, pin: '135791' }).ok === true);
}

section('self-service PIN change');
{
  const who = 'sarah@example.com';
  const login = req('/api/login', { email: who, pin: CREDS[who] });
  const token = login.data.token;

  check('needs a session', req('/api/pin', { currentPin: CREDS[who], newPin: '222222' }).status === 401);
  check('rejects a wrong current PIN',
    req('/api/pin', { currentPin: '000000', newPin: '222222' }, { session: token }).status === 403);
  check('rejects a short new PIN',
    req('/api/pin', { currentPin: CREDS[who], newPin: '2222' }, { session: token }).status === 400);

  check('changes the PIN',
    req('/api/pin', { currentPin: CREDS[who], newPin: '222222' }, { session: token }).ok === true);
  check('the new PIN works', req('/api/login', { email: who, pin: '222222' }).ok === true);
  check('the seeded PIN no longer works',
    req('/api/login', { email: who, pin: CREDS[who] }).status === 401);
  CREDS[who] = '222222';
}

section('PIN generation');
{
  // A PIN built from the raw digits of a v4 UUID inherits the fixed version
  // nibble and ends in '4' about 17% of the time instead of 10%.
  const counts = {};
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const pin = sandbox.randomPin_();
    if (!/^[0-9]{6}$/.test(pin)) { counts.BAD = (counts.BAD || 0) + 1; continue; }
    for (const ch of pin) counts[ch] = (counts[ch] || 0) + 1;
  }
  check('every PIN is exactly 6 digits', !counts.BAD);
  const freqs = '0123456789'.split('').map((d) => (counts[d] || 0) / (N * 6));
  const worst = Math.max(...freqs.map((f) => Math.abs(f - 0.1)));
  check('digits are uniform to within 1 point', worst < 0.01,
    'worst deviation ' + (worst * 100).toFixed(2) + 'pp');
}

section('token revocation');
{
  // amara's PIN was rotated to 135791 by the admin PIN reset block above.
  const who = 'amara@example.com';
  const currentPin = '135791';
  const login = req('/api/login', { email: who, pin: currentPin });
  check('a fresh login returns a token', login.ok === true && !!login.data.token);
  const token = login.data.token;
  check('token works before revocation',
    req('/api/transactions', {}, { params: { limit: '10' }, session: token }).ok === true);

  // Fresh manager login: the original mgr.data.token was invalidated when Sarah
  // changed her own PIN earlier, which revokes every session she held.
  const mgrNow = req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] }).data.token;
  check('revoke requires admin',
    req('/api/admin/revoke', { email: who }, { session: mgrNow }).status === 403);
  check('revoke rejects unknown address',
    req('/api/admin/revoke', { email: 'nobody@example.com' }, { session: adminToken }).status === 404);

  check('admin can revoke all sessions',
    req('/api/admin/revoke', { email: who }, { session: adminToken }).ok === true);
  check('revoked token is rejected',
    req('/api/transactions', {}, { params: { limit: '10' }, session: token }).status === 401);

  const again = req('/api/login', { email: who, pin: currentPin });
  check('a new login after revocation still works', again.ok === true && !!again.data.token);
}

section('session revoke on sign-out / PIN change');
{
  const who = 'diego@example.com';
  const login = req('/api/login', { email: who, pin: CREDS[who] });
  const token = login.data.token;
  check('logout revokes the device token',
    req('/api/logout', {}, { session: token }).ok === true);
  check('token dead after logout',
    req('/api/products', {}, { session: token }).status === 401);

  const t2 = req('/api/login', { email: who, pin: CREDS[who] }).data.token;
  check('changing own PIN revokes other sessions',
    req('/api/pin', { currentPin: CREDS[who], newPin: '333333' }, { session: t2 }).ok === true);
  check('old token rejected after PIN change',
    req('/api/products', {}, { session: t2 }).status === 401);
  CREDS[who] = '333333';

  const t3 = req('/api/login', { email: who, pin: CREDS[who] }).data.token;
  const target2 = 'sarah@example.com';
  check('admin PIN reset revokes target sessions', (() => {
    const tt = req('/api/login', { email: target2, pin: CREDS[target2] }).data.token;
    req('/api/admin/pin', { email: target2, pin: '444444' }, { session: adminToken });
    return req('/api/products', {}, { session: tt }).status === 401;
  })());
  CREDS[target2] = '444444';

  // Logout without a body still identifies the caller from the session token.
  const t4 = req('/api/login', { email: who, pin: CREDS[who] }).data.token;
  check('logout works with no payload body', req('/api/logout', {}, { session: t4 }).ok === true);
}

section('per-device revocation');
{
  // amara's PIN is 135791 from the admin PIN reset block; her per-user marker
  // was refreshed by earlier revoke tests, so fresh logins still work.
  const who = 'amara@example.com';
  const amaraPin = '135791';
  const devA = 'dev-aleph-0001';
  const devB = 'dev-bet-0002';

  const a1 = req('/api/login', { email: who, pin: amaraPin, deviceId: devA });
  check('login with deviceId returns a token', a1.ok === true && !!a1.data.token);
  const ta = a1.data.token;
  check('issued token carries the device claim', sandbox.verifyToken_(ta).dev === devA);
  const tb = req('/api/login', { email: who, pin: amaraPin, deviceId: devB }).data.token;

  check('login without deviceId still works',
    req('/api/login', { email: who, pin: amaraPin }).ok === true);

  const cashCheck = req('/api/login', { email: who, pin: amaraPin });
  check('list devices requires admin',
    req('/api/admin/devices', { email: who }, { session: cashCheck.data.token }).status === 403);

  const devList = req('/api/admin/devices', { email: who }, { session: adminToken });
  const ours = (devList.data.devices || []).filter((d) => d.deviceId === devA || d.deviceId === devB);
  check('admin can list registered terminals',
    devList.ok && ours.length === 2, JSON.stringify(devList));
  check('registered devices are active by default',
    ours.every((d) => d.revoked === false));

  check('both device tokens work before any revoke',
    req('/api/products', {}, { session: ta }).ok === true &&
    req('/api/products', {}, { session: tb }).ok === true);

  check('revoking an unregistered device is refused',
    req('/api/admin/revoke-device', { email: who, deviceId: 'dev-nope' }, { session: adminToken }).status === 404);

  check('admin revokes one terminal',
    req('/api/admin/revoke-device', { email: who, deviceId: devA }, { session: adminToken }).ok === true);
  check('revoked device token is rejected', req('/api/products', {}, { session: ta }).status === 401);
  check('other device token still valid', req('/api/products', {}, { session: tb }).ok === true);

  const devList2 = req('/api/admin/devices', { email: who }, { session: adminToken });
  check('revoked terminal is flagged in the list',
    devList2.data.devices.some((d) => d.deviceId === devA && d.revoked) &&
    devList2.data.devices.some((d) => d.deviceId === devB && !d.revoked));

  // The row flag is what blocks re-login long after the cache marker lapses.
  check('revoked device cannot sign back in with the right PIN',
    req('/api/login', { email: who, pin: amaraPin, deviceId: devA }).status === 403);
  check('other device can still sign in',
    req('/api/login', { email: who, pin: amaraPin, deviceId: devB }).ok === true);

  const tB2 = req('/api/login', { email: who, pin: amaraPin, deviceId: devB }).data.token;
  check('revoke-all works over per-user marker',
    req('/api/admin/revoke', { email: who }, { session: adminToken }).ok === true);
  check('surviving device token now dead',
    req('/api/products', {}, { session: tB2 }).status === 401);
  check('revoked-by-all device cannot sign in again',
    req('/api/login', { email: who, pin: amaraPin, deviceId: devB }).status === 403);
}

section('discounts & tax');
{
  const adminTok = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const diegoLogin = req('/api/login', { email: 'diego@example.com', pin: CREDS['diego@example.com'], deviceId: 'dev-tax-cashier' });
  const cashierTok = diegoLogin.data.token;
  const diegoId = diegoLogin.data.user.id;
  const mgrTok = req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'], deviceId: 'dev-tax-mgr' }).data.token;
  const cat = req('/api/products', {}, { session: adminTok }).data;
  const cable = cat.find((p) => p.sku === 'CB-USBC-1M');
  const phone = cat.find((p) => p.sku === 'PH-S24U-256');
  const phoneSn = phone.serials[0];

  check('products sheet carries taxable column', ss._sheets.get('Products')._grid[0].includes('taxable'));
  check('transactions sheet carries money columns',
    ['subtotal', 'tax_amount', 'discount_pct'].every((c) => ss._sheets.get('Transactions')._grid[0].includes(c)));
  check('catalog defaults taxable on', cat.every((p) => p.taxable === true));

  check('cashier cannot set tax rate', req('/api/admin/store', { taxRate: 5 }, { session: cashierTok }).status === 403);
  check('manager cannot set tax rate', req('/api/admin/store', { taxRate: 5 }, { session: mgrTok }).status === 403);
  check('admin rejects a tax rate over 100', req('/api/admin/store', { taxRate: 101 }, { session: adminTok }).status === 400);
  const st = req('/api/admin/store', { taxRate: 7.25 }, { session: adminTok });
  check('admin sets the store tax rate', st.ok && st.data.taxRate === 7.25);
  const cfg = req('/api/config', {}, { session: mgrTok });
  check('config surfaces the new tax rate', cfg.ok && cfg.data.store.taxRate === 7.25);

  // reference mirror of backend saleTotals_ in integers-cents
  const cents = (n) => Math.round((Number(n) || 0) * 100 + 0.000000001);
  function totals(lines, orderPct, taxRate) {
    const pct = Math.min(100, Math.max(0, Number(orderPct) || 0));
    let sub = 0, taxable = 0, disc = 0;
    for (const l of lines) {
      const lineC = cents(l.unitPrice) * Math.max(1, l.quantity);
      const ld = Math.round(lineC * Math.min(100, Math.max(0, l.discountPct || 0)) / 100);
      const net = lineC - ld; disc += ld; sub += net;
      if (l.taxable !== false) taxable += net;
    }
    const oC = Math.round(sub * pct / 100);
    const tb = Math.round(taxable * (100 - pct) / 100);
    const t = Math.round(tb * (Number(taxRate) || 0) / 100);
    return { subtotal: sub / 100, discount: (disc + oC) / 100, tax: t / 100, total: (sub - oC + t) / 100 };
  }

  // hard-coded anchor: $100, 10% order discount, 7.25% tax, no line discounts
  const anchorProd = req('/api/admin/products', {
    name: 'Anchor', sku: 'TX-ANCHOR', itemType: 'product', retailPrice: 100, costPrice: 50, taxable: true,
  }, { session: adminTok });
  const anchorPush = req('/api/sync/push', {
    deviceId: 'dev-tax-0',
    batch: [{
      clientTxId: 'tx-tax-0',
      discountPct: 10,
      grandTotal: 0,
      tenders: [{ type: 'cash', amount: 96.53 }],
      createdAt: new Date().toISOString(),
      items: [{ productId: anchorProd.data.id, quantity: 1, unitPrice: 100 }],
    }],
  }, { session: adminTok });
  const anchorLedger = req('/api/transactions', {}, { session: adminTok, params: { limit: 500 } }).data.transactions.find((t) => t.clientTxId === 'tx-tax-0');
  check('$100 at 10% order discount + 7.25% tax → $96.53',
    anchorPush.data.results[0].accepted && anchorLedger
      && Math.abs(anchorLedger.grandTotal - 96.53) < 0.001
      && Math.abs(anchorLedger.taxAmount - 6.53) < 0.001
      && Math.abs(anchorLedger.discountPct - 10) < 0.001);

  const exempt = req('/api/admin/products', {
    name: 'Exempt Widget', sku: 'TX-EXEMPT', itemType: 'product', retailPrice: 20, taxable: false,
  }, { session: adminTok });
  const lines = [
    { unitPrice: cable.retailPrice, quantity: 2, discountPct: 10, taxable: true },
    { unitPrice: 20, quantity: 1, discountPct: 0, taxable: false },
    { unitPrice: phone.retailPrice, quantity: 1, discountPct: 0, taxable: true },
  ];
  const exp = totals(lines, 5, 7.25);
  const pushItems = [
    { productId: cable.id, quantity: 2, unitPrice: cable.retailPrice, discountPct: 10 },
    { productId: exempt.data.id, quantity: 1, unitPrice: 20 },
    { productId: phone.id, quantity: 1, unitPrice: phone.retailPrice, serialNumber: phoneSn },
  ];
  const salePush = req('/api/sync/push', {
    deviceId: 'dev-tax-1',
    batch: [{
      clientTxId: 'tx-tax-1',
      userId: diegoId,
      discountPct: 5,
      grandTotal: exp.total,
      tenders: [{ type: 'cash', amount: exp.total }],
      createdAt: new Date().toISOString(),
      items: pushItems,
    }],
  }, { session: adminTok });
  check('mixed basket accepted', salePush.data.results[0].accepted === true, JSON.stringify(salePush));
  const saleLedger = req('/api/transactions', {}, { session: adminTok, params: { limit: 500 } }).data.transactions.find((t) => t.clientTxId === 'tx-tax-1');
  check('server grand total equals client-computed reference',
    saleLedger && Math.abs(saleLedger.grandTotal - exp.total) < 0.001, JSON.stringify({ got: saleLedger && saleLedger.grandTotal, exp: exp.total }));
  check('ledger stores subtotal + tax + order discount',
    saleLedger && Math.abs(saleLedger.subtotal - exp.subtotal) < 0.001
      && Math.abs(saleLedger.taxAmount - exp.tax) < 0.001
      && Math.abs(saleLedger.discountPct - 5) < 0.001);
  check('exempt line skipped the tax basis',
    saleLedger && Math.abs(saleLedger.taxAmount - exp.tax) < 0.001
      && exp.tax < totals(lines.map((l) => (l.unitPrice === 20 ? { ...l, taxable: true } : l)), 5, 7.25).tax);
  check('ledger items carry line discount',
    saleLedger && saleLedger.items.some((i) => i.productId === cable.id && i.discountPct === 10));

  check('discounted sale re-push is idempotent', (() => {
    const re = req('/api/sync/push', {
      deviceId: 'dev-tax-1',
      batch: [{
        clientTxId: 'tx-tax-1',
        userId: diegoId,
        discountPct: 5,
        grandTotal: exp.total,
        tenders: [{ type: 'cash', amount: exp.total }],
        createdAt: new Date().toISOString(),
        items: pushItems,
      }],
    }, { session: adminTok });
    return re.data.results[0].status === 'ALREADY_SYNCED';
  })());

  // a pre-1.2.6 queued sale (no discountPct on the envelope) must keep its
  // own total and stay untaxed, whatever the current store rate.
  const legacyPush = req('/api/sync/push', {
    deviceId: 'dev-tax-2',
    batch: [{
      clientTxId: 'tx-tax-legacy',
      userId: diegoId,
      grandTotal: 55,
      tenders: [{ type: 'cash', amount: 55 }],
      createdAt: new Date().toISOString(),
      items: [{ productId: cable.id, quantity: 5, unitPrice: 11 }],
    }],
  }, { session: adminTok });
  const legacyLedger = req('/api/transactions', {}, { session: adminTok, params: { limit: 500 } }).data.transactions.find((t) => t.clientTxId === 'tx-tax-legacy');
  check('legacy-format push keeps client total and no tax',
    legacyPush.data.results[0].accepted && legacyLedger
      && Math.abs(legacyLedger.grandTotal - 55) < 0.001 && Math.abs(legacyLedger.taxAmount) < 0.001);

  const patch = req('/api/admin/products/patch', { productId: cable.id, taxable: false }, { session: adminTok });
  const cat2 = req('/api/products', {}, { session: adminTok }).data;
  const cable2 = cat2.find((p) => p.sku === 'CB-USBC-1M');
  check('taxable flag toggles off via patch', patch.ok && cable2.taxable === false);

  const today = new Date().toISOString().slice(0, 10);
  const beforeFiles = JSON.stringify(driveFiles);
  req('/api/drive/export', { date: today }, { session: adminTok });
  check('drive CSV reports TAX COLLECTED',
    driveFiles.some((f) => f.name.includes(today) && f.content.includes('TAX COLLECTED')));
  void beforeFiles;
}

{
  section('conflict email alerts');

  /* Earlier conflict-producing sections already exercised the coalesced digest;
     reset so this section is deterministic about what a push emits. */
  mails.length = 0;
  const eAdmin = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'], deviceId: 'dev-email-admin' }).data.token;
  const eCat = req('/api/products', {}, { session: eAdmin }).data;
  const eProd = eCat.find((p) => p.itemType === 'product' && !p.isSerialized && (p.onHand || 0) > 10 && p.name !== 'Anchor' && p.sku !== 'TX-EXEMPT');
  check('alert pickup product exists', !!eProd);

  const first = req('/api/sync/push', {
    deviceId: 'dev-email-1',
    batch: [{
      clientTxId: 'tx-email-a',
      grandTotal: 9,
      tenders: [{ type: 'cash', amount: 9 }],
      createdAt: new Date().toISOString(),
      items: [{ productId: eProd.id, quantity: 1, unitPrice: eProd.retailPrice }],
    }],
  }, { session: eAdmin });
  check('clean push sends no alert', first.data.results[0].accepted && mails.length === 0, JSON.stringify({ mails: mails.length }));

  /* same device+client id, different content → DUPLICATE_CLIENT conflict */
  const dup = req('/api/sync/push', {
    deviceId: 'dev-email-1',
    batch: [{
      clientTxId: 'tx-email-a',
      grandTotal: 9,
      tenders: [{ type: 'cash', amount: 9 }],
      createdAt: new Date().toISOString(),
      items: [{ productId: eProd.id, quantity: 2, unitPrice: eProd.retailPrice }],
    }],
  }, { session: eAdmin });
  check('duplicate-content push flags a conflict', dup.data.results[0].accepted === true && dup.data.results[0].conflicts.length === 1);

  check('conflict push sent exactly one coalesced digest', mails.length === 1, JSON.stringify(mails.map((m) => m.subject)));
  const alert = mails[0];
  check('alert goes to every active admin + manager',
    alert.to.includes('tariq@example.com') && alert.to.includes('sarah@example.com')
      && !alert.to.includes('amara@example.com') && !alert.to.includes('diego@example.com'), alert.to);
  check('alert subject names the store and the count',
    alert.subject === '[Orison Electronics - Main Street] 1 new sync conflict — review required', alert.subject);
  check('alert body lists type, device, loser tx and summary',
    alert.body.includes('DUPLICATE_CLIENT') && alert.body.includes('dev-email-1')
      && alert.body.includes('tx-email-a') && alert.body.includes('Same device + transaction id pushed twice'), alert.body);
}

{
  section('staff management');

  /* cashierToken/mgr were issued at seed and killed by the PIN-rotation blocks
     above, so use fresh sessions for role-gating checks. */
  const staffCashierTok = req('/api/login', { email: 'diego@example.com', pin: CREDS['diego@example.com'] }).data.token;
  const staffMgrTok = req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] }).data.token;

  check('cashier may not list staff',
    req('/api/admin/users/list', {}, { session: staffCashierTok }).status === 403);
  check('manager may not create staff',
    req('/api/admin/users', { firstName: 'Nina', lastName: 'Peters', email: 'nina@example.com', role: 'cashier' }, { session: staffMgrTok }).status === 403);
  check('create requires name and a valid email',
    req('/api/admin/users', { firstName: 'Nina', lastName: '', email: 'nina@example.com', role: 'cashier' }, { session: adminToken }).status === 400
      && req('/api/admin/users', { firstName: 'Nina', lastName: 'Peters', email: 'not-an-email', role: 'cashier' }, { session: adminToken }).status === 400);
  check('create rejects an unknown role',
    req('/api/admin/users', { firstName: 'Nina', lastName: 'Peters', email: 'nina@example.com', role: 'owner' }, { session: adminToken }).status === 400);

  const made = req('/api/admin/users', { firstName: 'Luca', lastName: 'Moretti', email: 'luca@example.com', role: 'cashier' }, { session: adminToken });
  check('admin creates a staff account with a one-time PIN',
    made.ok === true && /^[0-9]{6}$/.test(made.data.oneTimePin));
  check('a duplicate email is refused',
    req('/api/admin/users', { firstName: 'Luca', lastName: 'Moretti', email: 'luca@example.com', role: 'cashier' }, { session: adminToken }).status === 409);
  const lucaPin = made.data.oneTimePin;

  const l1 = req('/api/login', { email: 'luca@example.com', pin: lucaPin });
  check('the one-time PIN signs the new account in', l1.ok === true && l1.data.user.email === 'luca@example.com' && l1.data.user.role === 'cashier');

  const roster = req('/api/admin/users/list', {}, { session: adminToken });
  const lucaRow = roster.data.users.find((u) => u.email === 'luca@example.com');
  check('roster lists the new staff with their state',
    lucaRow && lucaRow.active === true && lucaRow.role === 'cashier' && roster.data.users.length === 5);
  check('roster never contains credential material',
    roster.data.users.every((u) => !('pin' in u) && !('salt' in u) && !('pin_hash' in u)));

  req('/api/admin/users/patch', { id: lucaRow.id, role: 'manager' }, { session: adminToken });
  const l2 = req('/api/login', { email: 'luca@example.com', pin: lucaPin });
  check('role change takes effect on the next sign-in',
    l2.ok === true && l2.data.user.role === 'manager');

  req('/api/admin/users/patch', { id: lucaRow.id, active: false }, { session: adminToken });
  check('deactivated account cannot sign in',
    req('/api/login', { email: 'luca@example.com', pin: lucaPin }).status === 401);
  check('deactivated account is refused even with a fresh session',
    req('/api/transactions', {}, { params: { limit: '10' }, session: l1.data.token }).status === 401);

  req('/api/admin/users/patch', { id: lucaRow.id, active: true }, { session: adminToken });
  const l3 = req('/api/login', { email: 'luca@example.com', pin: lucaPin });
  check('reactivation restores access', l3.ok === true);

  const cf = req('/api/config', {}, { session: adminToken }).data;
  const tariqId = cf.users.find((u) => u.email === 'tariq@example.com').id;
  check('admin cannot deactivate themselves',
    req('/api/admin/users/patch', { id: tariqId, active: false }, { session: adminToken }).status === 400);
  check('admin cannot demote themselves',
    req('/api/admin/users/patch', { id: tariqId, role: 'cashier' }, { session: adminToken }).status === 400);

  req('/api/login', { email: 'luca@example.com', pin: lucaPin, deviceId: 'dev-luca-1' });
  const l4 = req('/api/login', { email: 'luca@example.com', pin: lucaPin });
  req('/api/admin/users/patch', { id: lucaRow.id, active: false }, { session: adminToken });
  check('deactivating revokes every registered terminal',
    req('/api/login', { email: 'luca@example.com', pin: lucaPin, deviceId: 'dev-luca-1' }).status === 401
      && req('/api/login', { email: 'luca@example.com', pin: lucaPin }).status === 401);
  void l4;
}

{
  section('profit & margin');

  const mgrTok = req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] }).data.token;
  const cashLogin = req('/api/login', { email: 'diego@example.com', pin: CREDS['diego@example.com'] });
  const cashTok = cashLogin.data.token;
  const cashUserId = cashLogin.data.user.id;
  const cat = req('/api/products', {}, { session: mgrTok }).data;
  const anchor = cat.find((p) => p.name === 'Anchor');
  const usbC = cat.find((p) => p.sku === 'CB-USBC-1M');

  const mr = req('/api/sync/push', {
    deviceId: 'dev-margin-1',
    batch: [{
      clientTxId: 'tx-margin-1',
      userId: cashUserId,
      grandTotal: 24,
      tenders: [{ type: 'cash', amount: 24 }],
      createdAt: new Date().toISOString(),
      items: [{ productId: usbC.id, quantity: 2, unitPrice: 12 }],
    }],
  }, { session: mgrTok });
  check('add-cost sale accepted', mr.data.results[0].accepted === true);

  const storeLedger = req('/api/transactions', {}, { session: mgrTok, params: { limit: 500 } }).data.transactions;
  const marginTx = storeLedger.find((t) => t.clientTxId === 'tx-margin-1');
  check('item carries unitCost for managers',
    marginTx.items[0].unitCost === 6, JSON.stringify(marginTx.items));
  check('tx carries gross profit for managers',
    marginTx.grossProfit === 12, String(marginTx.grossProfit));

  const cashLedger = req('/api/transactions', {}, { session: cashTok, params: { limit: 500 } }).data.transactions;
  const cashTx = cashLedger.find((t) => t.clientTxId === 'tx-margin-1');
  check('cashier copy has no unitCost', cashTx && cashTx.items[0].unitCost === undefined, JSON.stringify(cashTx && cashTx.items[0]));
  check('cashier copy has no grossProfit', cashTx && cashTx.grossProfit === undefined);

  const anchorTx = storeLedger.find((t) => t.clientTxId === 'tx-tax-0');
  check('discounted sale profit is net of discount',
    anchorTx && anchorTx.subtotal === 100 && anchorTx.grossProfit === 40 && Math.abs(anchorTx.taxAmount - 6.53) < 0.001,
    JSON.stringify(anchorTx && { sub: anchorTx.subtotal, gp: anchorTx.grossProfit }));

  const day = new Date().toISOString().slice(0, 10);
  req('/api/drive/export', { date: day }, { session: mgrTok });
  const storeCsv = driveFiles[driveFiles.length - 1].content;
  check('store CSV has cost + gross profit columns',
    storeCsv.includes('cost,gross_profit') && storeCsv.includes('GROSS PROFIT'));
  req('/api/drive/export', { date: day }, { session: cashTok });
  const cashCsv = driveFiles[driveFiles.length - 1].content;
  check('cashier CSV never includes cost or margin',
    !cashCsv.includes('gross_profit') && !cashCsv.includes('GROSS PROFIT') && !cashCsv.includes('TOTAL COST') && !cashCsv.includes(',cost,'));
  void anchor; void mr;
}

{
  section('customer ledger');

  const custAdmTok = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const custCashLogin = req('/api/login', { email: 'diego@example.com', pin: CREDS['diego@example.com'] });
  const custCashTok = custCashLogin.data.token;
  const custCashUserId = custCashLogin.data.user.id;

  const joe = req('/api/admin/customers', {
    name: 'Joe Bright', phone: '080-555-1212', email: 'joe@example.com',
  }, { session: custAdmTok });
  check('manager creates a customer', joe.ok && joe.data.customer && joe.data.customer.id, JSON.stringify(joe));
  const joeId = joe.data.customer.id;
  check('customer id is a uuid', /^[0-9a-f-]{36}$/.test(joeId));
  check('create needs a name', req('/api/admin/customers', { phone: 'x' }, { session: custAdmTok }).status === 400);
  check('cashier cannot create a customer', req('/api/admin/customers', { name: 'Nope' }, { session: custCashTok }).status === 403);

  const foundByName = req('/api/customers', {}, { session: custCashTok, params: { q: 'joe' } }).data.customers;
  const foundByPhone = req('/api/customers', {}, { session: custCashTok, params: { q: '1212' } }).data.customers;
  check('checkout search finds by name and phone',
    foundByName.length === 1 && foundByName[0].id === joeId
      && foundByPhone.length === 1 && foundByPhone[0].id === joeId);
  check('checkout search never leaks balances',
    !('balance' in foundByName[0]) && !('credit' in foundByName[0]) && !('account' in foundByName[0]));

  const cableC = req('/api/products', {}, { session: custAdmTok }).data.find((p) => p.sku === 'CB-USBC-1M');
  const rcPush = req('/api/sync/push', {
    deviceId: 'dev-cust-1',
    batch: [{
      clientTxId: 'tx-rc-1',
      customerId: joeId,
      userId: custCashUserId,
      grandTotal: 48,
      tenders: [{ type: 'net30', amount: 48 }],
      createdAt: new Date().toISOString(),
      items: [{ productId: cableC.id, quantity: 4, unitPrice: 12 }],
    }],
  }, { session: custAdmTok });
  check('on-account sale to a customer accepted', rcPush.data.results[0].accepted === true);

  const badPush = req('/api/sync/push', {
    deviceId: 'dev-cust-1',
    batch: [{
      clientTxId: 'tx-rc-bad',
      customerId: 'no-such-customer',
      grandTotal: 10,
      tenders: [{ type: 'net30', amount: 10 }],
      createdAt: new Date().toISOString(),
      items: [{ productId: cableC.id, quantity: 1, unitPrice: 10 }],
    }],
  }, { session: custAdmTok });
  check('sale to an unknown customer is voided',
    badPush.data.results[0].accepted === false
      && badPush.data.results[0].conflicts.some((c) => c.reason === 'unknown_customer'));

  const ledger = req('/api/customers/ledger', {}, { session: custAdmTok, params: { customerId: joeId } }).data;
  check('ledger shows the account charge', ledger.account === 48 && Math.abs(ledger.balance - 48) < 0.001, JSON.stringify({ a: ledger.account, b: ledger.balance }));
  check('ledger lists the customer transactions', ledger.transactions.some((t) => t.clientTxId === 'tx-rc-1'));

  const rfPush = req('/api/sync/push', {
    deviceId: 'dev-cust-1',
    batch: [{
      clientTxId: 'tx-rc-1-rf1',
      kind: 'refund',
      originalClientTx: 'tx-rc-1',
      grandTotal: 12,
      tenders: [{ type: 'store_credit', amount: 12 }],
      createdAt: new Date().toISOString(),
      items: [{ productId: cableC.id, }],
    }],
  }, { session: custAdmTok });
  check('store-credit refund on a customer sale accepted', rfPush.data.results[0].accepted === true, JSON.stringify(rfPush));
  const ledger2 = req('/api/customers/ledger', {}, { session: custAdmTok, params: { customerId: joeId } }).data;
  check('store-credit refund adds credit and nets the balance',
    ledger2.credit === 12 && Math.abs(ledger2.balance - 36) < 0.001, JSON.stringify({ c: ledger2.credit, b: ledger2.balance }));

  const recv = req('/api/customers/receivables', {}, { session: custAdmTok }).data;
  const joeCell = recv.customers.find((c) => c.id === joeId);
  check('receivables aggregates the outstanding balance',
    joeCell && Math.abs(joeCell.account - 48) < 0.001 && Math.abs(joeCell.balance - 36) < 0.001 && recv.totalOutstanding >= 36 - 0.001,
    JSON.stringify(joeCell));
  check('cashier cannot read receivables', req('/api/customers/receivables', {}, { session: custCashTok }).status === 403);

  const storeTx = req('/api/transactions', {}, { session: custAdmTok, params: { limit: 500 } }).data.transactions;
  const rcTx = storeTx.find((t) => t.clientTxId === 'tx-rc-1');
  check('ledger transaction exposes the customer name', rcTx && rcTx.customer === 'Joe Bright' && rcTx.customerId === joeId);
  const cashTx2 = req('/api/transactions', {}, { session: custCashTok, params: { limit: 500 } }).data.transactions;
  check('cashier ledger rows also name the customer',
    cashTx2.some((t) => t.clientTxId === 'tx-rc-1') && cashTx2.find((t) => t.clientTxId === 'tx-rc-1').customer === 'Joe Bright');
  void custCashTok;
}

{
  section('collections & aging');

  const colAdmTok = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const zoe = req('/api/admin/customers', { name: 'Zoe Old', phone: '080-333-9999' }, { session: colAdmTok });
  const zoeId = zoe.data.customer.id;
  const once = req('/api/admin/customers', { name: 'Once Current' }, { session: colAdmTok });
  const onceId = once.data.customer.id;
  const cableC2 = req('/api/products', {}, { session: colAdmTok }).data.find((p) => p.sku === 'CB-USBC-1M');
  const atDaysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const pushSale = (customerId, clientTxId, amount, daysAgo, session) => req('/api/sync/push', {
    deviceId: 'dev-col-1',
    batch: [{
      clientTxId, customerId, grandTotal: amount,
      tenders: [{ type: 'net30', amount }],
      createdAt: atDaysAgo(daysAgo),
      items: [{ productId: cableC2.id, quantity: Math.ceil(amount / 10), unitPrice: 10 }],
    }],
  }, { session });

  check('oldest sale accepted', pushSale(zoeId, 'tx-zo-1', 50, 120, colAdmTok).data.results[0].accepted === true);
  check('mid sale accepted', pushSale(zoeId, 'tx-zo-2', 100, 45, colAdmTok).data.results[0].accepted === true);
  check('recent sale accepted', pushSale(onceId, 'tx-on-1', 25, 5, colAdmTok).data.results[0].accepted === true);

  const zL0 = req('/api/customers/ledger', {}, { session: colAdmTok, params: { customerId: zoeId } }).data;
  check('aging buckets split by sale age',
    zL0.aging.d30 === 100 && zL0.aging.d90 === 50 && Math.abs(zL0.balance - 150) < 0.001,
    JSON.stringify(zL0.aging));
  const oL = req('/api/customers/ledger', {}, { session: colAdmTok, params: { customerId: onceId } }).data;
  check('recent balance is current bucket only',
    oL.aging.current === 25 && oL.aging.d30 === 0 && oL.aging.d60 === 0 && oL.aging.d90 === 0, JSON.stringify(oL.aging));

  const payPush = req('/api/sync/push', {
    deviceId: 'dev-col-1',
    batch: [{
      clientTxId: 'tx-col-pay-1',
      kind: 'payment',
      customerId: zoeId,
      grandTotal: 60,
      tenders: [{ type: 'transfer', amount: 60 }],
      note: 'settled part of account',
      createdAt: new Date().toISOString(),
      items: [],
    }],
  }, { session: colAdmTok });
  check('collection accepted', payPush.data.results[0].accepted === true, JSON.stringify(payPush));

  const zL1 = req('/api/customers/ledger', {}, { session: colAdmTok, params: { customerId: zoeId } }).data;
  check('collection nets the account and ages FIFO (oldest paid first)',
    Math.abs(zL1.account - 90) < 0.001
      && zL1.aging.d90 === 0
      && zL1.aging.d30 === 90
      && Math.abs(zL1.balance - 90) < 0.001,
    JSON.stringify({ a: zL1.account, aging: zL1.aging, b: zL1.balance }));
  check('ledger lists the payment row',
    zL1.transactions.some((t) => t.clientTxId === 'tx-col-pay-1' && t.kind === 'payment' && t.grandTotal === 60));

  const cashColPush = req('/api/sync/push', {
    deviceId: 'dev-col-1',
    batch: [{
      clientTxId: 'tx-col-cash-1',
      kind: 'payment',
      customerId: zoeId,
      grandTotal: 5,
      tenders: [{ type: 'cash', amount: 5 }],
      createdAt: new Date().toISOString(),
      items: [],
    }],
  }, { session: req('/api/login', { email: 'diego@example.com', pin: CREDS['diego@example.com'] }).data.token });
  check('cashier cannot record a collection', cashColPush.data.results[0].accepted === false
    && cashColPush.data.results[0].conflicts.some((c) => c.reason === 'unauthorized_role'));

  const recv2 = req('/api/customers/receivables', {}, { session: colAdmTok }).data;
  const zoeCell = recv2.customers.find((c) => c.id === zoeId);
  check('receivables cells carry aging',
    zoeCell && zoeCell.aging.d30 === 90 && Math.abs(zoeCell.balance - 90) < 0.001, JSON.stringify(zoeCell && zoeCell.aging));
  void once;
}

{
  section('till shifts');

  const shAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const shCash = req('/api/login', { email: 'amara@example.com', pin: '135791' }).data.token;
  const shDiego = req('/api/login', { email: 'diego@example.com', pin: CREDS['diego@example.com'] }).data.token;
  const shSara = req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] }).data.token;
  const usersL = req('/api/admin/users/list', {}, { session: shAdm }).data.users;
  const amaraId = usersL.find((u) => u.email === 'amara@example.com').id;
  const cableS = req('/api/products', {}, { session: shAdm }).data.find((p) => p.sku === 'CB-USBC-1M');
  const pushS = (session, userId, clientTxId, kind, amount, extra) => req('/api/sync/push', {
    deviceId: 'dev-sh-1',
    batch: [{
      clientTxId, userId, kind, grandTotal: amount, createdAt: new Date().toISOString(),
      tenders: extra.tenders, items: extra.items || [],
    }],
  }, { session });
  const pushCosted = (txId, amount, tenders, items) => pushS(shCash, amaraId, txId, 'sale', amount, { tenders, items });

  const opm = req('/api/shifts/open', { openingFloat: 5000, note: 'morning float' }, { session: shCash });
  check('cashier opens a shift with float', opm.data.open === true && opm.data.shift.openingFloat === 5000 && opm.data.shift.status === 'OPEN');
  const cashShiftId = opm.data.shift.id;
  const admShift = req('/api/shifts/open', { openingFloat: 0 }, { session: shAdm });
  const admShiftId = admShift.data.shift.id;

  const c = (qty) => [{ productId: cableS.id, quantity: qty, unitPrice: 10 }];
  check('sale inside shift window (cash in)',
    pushCosted('tx-sh-s1', 40, [{ type: 'cash', amount: 40 }], c(1)).data.results[0].accepted === true);
  check('another cash sale',
    pushCosted('tx-sh-s2', 60, [{ type: 'cash', amount: 60 }], c(2)).data.results[0].accepted === true);
  check('cash refund inside shift (cash out)',
    req('/api/sync/push', {
      deviceId: 'dev-sh-1',
      batch: [{
        clientTxId: 'tx-sh-rf', userId: amaraId, kind: 'refund', originalClientTx: 'tx-sh-s2',
        grandTotal: 10, tenders: [{ type: 'cash', amount: 10 }], createdAt: new Date().toISOString(), items: [],
      }],
    }, { session: shCash }).data.results[0].accepted === true);
  const admId = usersL.find((u) => u.email === 'tariq@example.com').id;
  check('payout is admin/manager only (cashier denied)',
    pushS(shCash, amaraId, 'tx-sh-po', 'payout', 25, { tenders: [] }).data.results[0].accepted === false);
  check('admin payout inside own shift (cash out)',
    pushS(shAdm, admId, 'tx-sh-po', 'payout', 25, { tenders: [] }).data.results[0].accepted === true);

  const closeSh = req('/api/shifts/close', { shiftId: cashShiftId, denoms: { 1000: 5 }, note: 'end of day' }, { session: shCash });
  check('close computes expected = float + cash in - cash out',
    closeSh.data.shift.declaredCash === 5000
      && closeSh.data.shift.expectedCash === 5090
      && closeSh.data.shift.overShort === -90,
    JSON.stringify(closeSh.data.shift));
  check('over-short persists on the view', closeSh.data.shift.status === 'CLOSED');
  check('can’t open a second shift while one is open', req('/api/shifts/open', { openingFloat: 1 }, { session: shAdm }).status === 409);
  const closeAdm = req('/api/shifts/close', { shiftId: admShiftId, denoms: {} }, { session: shAdm });
  check('manager close nets the payout (short float over)' ,
    closeAdm.data.shift.expectedCash === -25 && closeAdm.data.shift.overShort === 25, JSON.stringify(closeAdm.data.shift));

  check('can’t close another user’s shift', req('/api/shifts/close', { shiftId: cashShiftId, denoms: {} }, { session: shDiego }).status === 403);
  check('closing a closed shift errors', req('/api/shifts/close', { shiftId: cashShiftId, denoms: {} }, { session: shCash }).status === 409);
  check('close with no open shift errors', req('/api/shifts/close', { denoms: {} }, { session: shDiego }).status === 404);
  check('sales work with no open shift (soft enforcement)',
    pushS(shDiego, usersL.find((u) => u.email === 'diego@example.com').id, 'tx-sh-ns', 'sale', 12, { tenders: [{ type: 'cash', amount: 12 }], items: c(1) }).data.results[0].accepted === true);

  const myRows = req('/api/shifts', {}, { session: shCash }).data;
  check('cashier sees own shifts only',
    myRows.shifts.length === 1 && myRows.shifts[0].id === cashShiftId);
  const allRows = req('/api/shifts', {}, { session: shSara }).data;
  check('manager sees every shift and open count',
    allRows.shifts.length === 2 && allRows.open === 0);
  check('shift view carries username + denoms',
    allRows.shifts.some((s) => s.id === cashShiftId && s.userName === 'Amara Njoku' && s.denoms[1000] === 5));
  void shAdm;
}

console.log('\n-------------------------------------');
console.log(`PASS ${passed}  FAIL ${failed}`);
process.exit(failed ? 1 : 0);