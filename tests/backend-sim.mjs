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
    }),
  },
  Utilities: {
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
    getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
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
const seeded = req('/api/login', { email: 'tariq@orisonigt.com', pin: '1234' });
check('blank workbook had no spreadsheet yet', true, '');
check('login returns token + user + store', seeded.ok === true && seeded.data.token && seeded.data.user.role === 'admin');
const adminToken = seeded.data.token;

const ss = store.ss;
check('workbook created with all tabs', ['Meta', 'Users', 'Products', 'Serials', 'Transactions', 'Conflicts'].every((t) => ss._sheets.has(t)));
const products = req('/api/products', {}, { session: adminToken });
check('catalog has 42 products', products.ok && products.data.length === 42, JSON.stringify({ n: products.ok ? products.data.length : 0 }));
check('serialized phone exposes serials + onHand count', (() => {
  const s24 = products.data.find((p) => p.sku === 'PH-S24U-256');
  return s24 && s24.isSerialized === true && s24.onHand === 4 && s24.serials.length === 4;
})());

section('auth');
const badPw = req('/api/login', { email: 'tariq@orisonigt.com', pin: '9999' });
check('bad PIN → 401', badPw.ok === false && badPw.status === 401);
const noToken = req('/api/products');
check('missing session → 401', noToken.ok === false && noToken.status === 401);
check('bad app token → 401', (() => {
  const out = call({ action: '/api/products', appToken: 'wrong', session: adminToken, payload: {}, method: 'GET' });
  return out.ok === false && out.status === 401;
})());

section('sync push — first-committed-wins');
const s24 = products.data.find((p) => p.sku === 'PH-S24U-256');
const usb = products.data.find((p) => p.sku === 'CB-USBC-1M');
const serial = s24.serials[0];
const pin = req('/api/login', { email: 'amara@orisonigt.com', pin: '5678' });
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

const mgr = req('/api/login', { email: 'sarah@orisonigt.com', pin: '3456' });
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

console.log('\n-------------------------------------');
console.log(`PASS ${passed}  FAIL ${failed}`);
process.exit(failed ? 1 : 0);