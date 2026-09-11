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
    getFolderById: (id) => { const f = driveFolders.find((x) => x.id === id); if (!f) throw new Error('missing folder ' + id); return folderHandle(f); },
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
    return { hasNext: () => true, next: () => folderHandle(f) };
  }
  return { hasNext: () => true, next: () => folderHandle(it._matches[0]) };
};
sandbox.DriveApp.createFolder = (name) => {
  const f = { id: 'folder-' + randomUUID(), name };
  driveFolders.push(f);
  return folderHandle(f);
};

/* Backups copy the whole workbook into its own folder, so the Drive mock needs
   makeCopy and a folder that can list what is in it. Backup files are tracked
   separately from CSV exports so retention can be asserted. */
const driveBackups = [];
function folderHandle(f) {
  return {
    getId: () => f.id,
    createFile: realCreateFile,
    getFilesByType: () => {
      const mine = driveBackups.filter((b) => b.folderId === f.id && !b.trashed);
      let i = 0;
      return { hasNext: () => i < mine.length, next: () => fileHandle(mine[i++]) };
    },
  };
}
function fileHandle(b) {
  return {
    getId: () => b.id,
    getName: () => b.name,
    getUrl: () => 'https://drive.google.com/file/' + b.id,
    setTrashed: (v) => { b.trashed = !!v; },
    makeCopy: (name, folder) => {
      const copy = { id: 'bk-' + randomUUID(), name, folderId: folder.getId(), trashed: false };
      driveBackups.push(copy);
      return fileHandle(copy);
    },
  };
}
sandbox.DriveApp.getFileById = (id) => fileHandle({ id, name: 'Orison POS', folderId: null });
sandbox.MimeType.GOOGLE_SHEETS = 'application/vnd.google-apps.spreadsheet';
sandbox.ScriptApp = {
  getProjectTriggers: () => scriptTriggers.slice(),
  deleteTrigger: (t) => { const i = scriptTriggers.indexOf(t); if (i >= 0) scriptTriggers.splice(i, 1); },
  newTrigger: (fn) => {
    const spec = { fn, hour: null, days: null };
    const builder = {
      timeBased: () => builder,
      atHour: (h) => { spec.hour = h; return builder; },
      everyDays: (d) => { spec.days = d; return builder; },
      everyWeeks: (w) => { spec.weeks = w; return builder; },
      onWeekDay: (d) => { spec.weekDay = d; return builder; },
      create: () => {
        const t = { getHandlerFunction: () => spec.fn, _spec: spec };
        scriptTriggers.push(t);
        return t;
      },
    };
    return builder;
  },
};
const scriptTriggers = [];

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

const rfRejected = req('/api/sync/push', {
  deviceId: 'dev-R',
  batch: [{
    clientTxId: 'tx-spk-1-rf0', kind: 'refund', originalClientTx: 'tx-spk-1',
    userId: pin.data.user.id, grandTotal: 10, tenders: [], note: '',
    createdAt: new Date().toISOString(),
    items: [{ productId: spkR.id, quantity: 1, unitPrice: 10 }],
  }],
}, { session: cashierToken });
check('cashier refund → VOIDED unauthorized_role', rfRejected.ok && rfRejected.data.results[0].accepted === false && rfRejected.data.results[0].conflicts[0].reason === 'unauthorized_role', JSON.stringify(rfRejected));

const rf1 = req('/api/sync/push', {
  deviceId: 'dev-R',
  batch: [{
    clientTxId: 'tx-spk-1-rf1', kind: 'refund', originalClientTx: 'tx-spk-1', counterparty: '',
    userId: pin.data.user.id, grandTotal: 25, tenders: [{ type: 'cash', amount: 25 }],
    note: 'partial refund', createdAt: new Date().toISOString(),
    items: [{ productId: spkR.id, quantity: 1, unitPrice: 25 }],
  }],
}, { session: mgrToken });
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
}, { session: mgrToken });
check('refund exceeding outstanding per-line → VOIDED', rf2.ok && rf2.data.results[0].accepted === false && rf2.data.results[0].conflicts[0].reason === 'refund_exceeds_sale_lines', JSON.stringify(rf2));

const rf3 = req('/api/sync/push', {
  deviceId: 'dev-R',
  batch: [{
    clientTxId: 'tx-spk-1-rf3', kind: 'refund', originalClientTx: 'tx-spk-1',
    userId: pin.data.user.id, grandTotal: 25, tenders: [], note: '',
    createdAt: new Date().toISOString(),
    items: [{ productId: spkR.id, quantity: 1, unitPrice: 25 }],
  }],
}, { session: mgrToken });
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
}, { session: mgrToken });
check('refund beyond sale total → VOIDED refund_exceeds_sale', rf4.ok && rf4.data.results[0].accepted === false && rf4.data.results[0].conflicts[0].reason === 'refund_exceeds_sale', JSON.stringify(rf4));

const rfSerial = req('/api/sync/push', {
  deviceId: 'dev-R',
  batch: [{
    clientTxId: 'tx-abc-1-rf1', kind: 'refund', originalClientTx: 'tx-abc-1',
    userId: pin.data.user.id, grandTotal: 1299, tenders: [{ type: 'store_credit', amount: 1299 }],
    note: 'serialized refund', createdAt: new Date().toISOString(),
    items: [{ productId: s24.id, serialNumber: serial, quantity: 1, unitPrice: 1299 }],
  }],
}, { session: mgrToken });
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
}, { session: mgrToken });
check('cannot refund a refund → original_not_found', rfOfRefund.ok && rfOfRefund.data.results[0].accepted === false && rfOfRefund.data.results[0].conflicts[0].reason === 'original_not_found', JSON.stringify(rfOfRefund));

const rfGhost = req('/api/sync/push', {
  deviceId: 'dev-R',
  batch: [{
    clientTxId: 'tx-rf-ghost', kind: 'refund', originalClientTx: 'tx-does-not-exist',
    userId: pin.data.user.id, grandTotal: 10, tenders: [], note: '',
    createdAt: new Date().toISOString(),
    items: [{ productId: spkR.id, quantity: 1, unitPrice: 10 }],
  }],
}, { session: mgrToken });
check('refund with no original → original_not_found', rfGhost.ok && rfGhost.data.results[0].conflicts[0].reason === 'original_not_found', JSON.stringify(rfGhost));

const rfUnsold = req('/api/sync/push', {
  deviceId: 'dev-R',
  batch: [{
    clientTxId: 'tx-rf-unsold', kind: 'refund', originalClientTx: 'tx-abc-1',
    userId: pin.data.user.id, grandTotal: 10, tenders: [], note: '',
    createdAt: new Date().toISOString(),
    items: [{ productId: s24.id, serialNumber: 'NEW-SN-0001', quantity: 1, unitPrice: 10 }],
  }],
}, { session: mgrToken });
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
  section('customer statement of account');

  const stAdmLogin = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] });
  const stAdmTok = stAdmLogin.data.token;
  const stAdmUid = stAdmLogin.data.user.id;
  const stCasTok = req('/api/login', { email: 'diego@example.com', pin: CREDS['diego@example.com'] }).data.token;
  const stella = req('/api/admin/customers', { name: 'Stella One', phone: '070-444-0001' }, { session: stAdmTok });
  const stId = stella.data.customer.id;
  const stProd = req('/api/products', {}, { session: stAdmTok }).data.find((p) => p.sku === 'CB-USBC-1M');
  const stAt = (msAgo) => new Date(Date.now() - msAgo).toISOString();

  const pushSt = (batch, session = stAdmTok) => req('/api/sync/push', { deviceId: 'dev-st-1', batch }, { session });

  check('statement sale 1 accepted', pushSt([{
    clientTxId: 'tx-st-1', userId: stAdmUid, customerId: stId, grandTotal: 40,
    tenders: [{ type: 'net30', amount: 40 }],
    createdAt: stAt(2 * 86400000),
    items: [{ productId: stProd.id, quantity: 4, unitPrice: 10 }],
  }]).data.results[0].accepted === true);
  check('statement sale 2 accepted', pushSt([{
    clientTxId: 'tx-st-2', userId: stAdmUid, customerId: stId, grandTotal: 60,
    tenders: [{ type: 'net30', amount: 60 }],
    createdAt: stAt(86400000),
    items: [{ productId: stProd.id, quantity: 6, unitPrice: 10 }],
  }]).data.results[0].accepted === true);
  check('statement collection accepted', pushSt([{
    clientTxId: 'tx-st-pay', userId: stAdmUid, kind: 'payment', customerId: stId, grandTotal: 25,
    tenders: [{ type: 'transfer', amount: 25 }],
    createdAt: stAt(30 * 60000), items: [],
  }]).data.results[0].accepted === true);
  check('statement refund accepted', pushSt([{
    clientTxId: 'tx-st-rf', userId: stAdmUid, kind: 'refund', originalClientTx: 'tx-st-1', customerId: stId, grandTotal: 15,
    tenders: [{ type: 'store_credit', amount: 15 }],
    createdAt: stAt(15 * 60000),
    items: [{ productId: stProd.id }],
  }]).data.results[0].accepted === true);

  check('cashier cannot read a statement',
    req('/api/customers/statement', {}, { session: stCasTok, params: { customerId: stId } }).status === 403);
  check('statement requires a customerId',
    req('/api/customers/statement', {}, { session: stAdmTok }).status === 400);
  check('statement 404s unknown customers',
    req('/api/customers/statement', {}, { session: stAdmTok, params: { customerId: 'no-such-customer' } }).status === 404);

  const stmt = req('/api/customers/statement', {}, { session: stAdmTok, params: { customerId: stId } }).data;
  check('statement opens at zero and closes at the ledger balance',
    stmt.opening === 0 && Math.abs(stmt.closing - 60) < 0.001, JSON.stringify({ o: stmt.opening, c: stmt.closing }));
  check('statement lists activity in chronological order',
    stmt.items.length === 4
      && stmt.items[0].reference === 'tx-st-1'
      && stmt.items[3].reference === 'tx-st-rf',
    JSON.stringify(stmt.items.map((i) => i.reference)));
  check('statement running balance reconciles (50\u2192\u2026)',
    stmt.items.map((i) => i.balance).join('/') === '40/100/75/60'
      && stmt.items[0].debit === 40
      && stmt.items[2].credit === 25
      && stmt.items[2].kind === 'payment'
      && stmt.items[3].credit === 15 && stmt.items[3].kind === 'refund');
check('statement carries the changer/cashier',
    stmt.items[0].cashier === 'Tariq Al-Sayed' && stmt.items[2].description.indexOf('Payment received') === 0);
  check('statement balance matches the ledger balance',
    Math.abs(stmt.closing - req('/api/customers/ledger', {}, { session: stAdmTok, params: { customerId: stId } }).data.balance) < 0.001);
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

  /* The drawer is counted against the store's own cash ladder, so the store has
     to be set up before a count means anything. Adopting NGN brings its default
     notes (1000/500/200/100/50/20/10) with it. */
  const shStore = req('/api/admin/store', { locale: 'en-NG', country: 'NG', currency: 'NGN' }, { session: shAdm });
  check('admin sets the store locale, country and currency',
    shStore.ok === true && shStore.data.currency === 'NGN' && shStore.data.locale === 'en-NG'
    && shStore.data.country === 'NG' && shStore.data.configured === true);
  check('switching currency adopts that currency’s notes',
    shStore.data.denoms[0] === 1000 && shStore.data.denoms.indexOf(10) >= 0
    && shStore.data.denoms.indexOf(0.25) === -1, JSON.stringify(shStore.data.denoms));

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
    }, { session: shSara }).data.results[0].accepted === true);
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

{
  section('reports & analytics');

  const rAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const rMgr = req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] }).data.token;
  const rDiego = req('/api/login', { email: 'diego@example.com', pin: CREDS['diego@example.com'] }).data.token;
  const rUsers = req('/api/admin/users/list', {}, { session: rAdm }).data.users;
  const diegoId = rUsers.find((u) => u.email === 'diego@example.com').id;
  const tariqId = rUsers.find((u) => u.email === 'tariq@example.com').id;
  const wdg = req('/api/admin/products', {
    name: 'Rep Widget', sku: 'RP-WDG-01', upc: '0000000000111', category: 'Accessories',
    costPrice: 20, retailPrice: 50, isSerialized: false, onHand: 60,
  }, { session: rAdm });

  const pushRep = (session, userId, clientTxId, kind, amount, tenders, extra) => req('/api/sync/push', {
    deviceId: 'dev-rep-1',
    batch: [{
      clientTxId, userId, kind, grandTotal: amount, createdAt: new Date().toISOString(),
      tenders, items: extra.items || [],
      originalClientTx: extra.originalClientTx || '',
      customerId: extra.customerId || '',
    }],
  }, { session });
  const wdgItem = (qty) => [{ productId: wdg.data.id, quantity: qty, unitPrice: 50 }];

  const s1 = pushRep(rDiego, diegoId, 'tx-rp-a', 'sale', 50, [{ type: 'cash', amount: 53.63 }], { items: wdgItem(1) });
  const s2 = pushRep(rDiego, diegoId, 'tx-rp-b', 'sale', 50, [{ type: 'cash', amount: 53.63 }], { items: wdgItem(1) });
  const netCust = req('/api/admin/customers', { name: 'Rep Net30' }, { session: rAdm });
  const s3 = pushRep(rDiego, diegoId, 'tx-rp-c', 'sale', 50, [{ type: 'net30', amount: 53.63 }], { items: wdgItem(1), customerId: netCust.data.customer.id });
  check('three report-window sales accepted', s1.data.results[0].accepted && s2.data.results[0].accepted && s3.data.results[0].accepted);
  check('cashier can’t read reports', req('/api/reports', {}, { session: rDiego }).status === 403);

  const rf = pushRep(rAdm, diegoId, 'tx-rp-rf', 'refund', 20, [{ type: 'cash', amount: 20 }], { originalClientTx: 'tx-rp-a' });
  const po = pushRep(rAdm, tariqId, 'tx-rp-po', 'payout', 30, [], {});
  const clCust = req('/api/admin/customers', { name: 'Rep Cashier' }, { session: rAdm });
  const cl = pushRep(rAdm, tariqId, 'tx-rp-cl', 'payment', 15, [{ type: 'transfer', amount: 15 }], { customerId: clCust.data.customer.id });
  check('refund / payout / collection accepted in window', rf.data.results[0].accepted && po.data.results[0].accepted && cl.data.results[0].accepted);

  const tKey = new Date().toISOString().slice(0, 10);
  const dto = req('/api/transactions', {}, { params: { limit: '500' }, session: rMgr }).data.transactions;
  const w = dto.filter((t) => String(t.createdAt || '').slice(0, 10) === tKey);
  const pick = (id) => w.find((t) => t.clientTxId === id);
  const ga = pick('tx-rp-a').grandTotal;
  const gb = pick('tx-rp-b').grandTotal;
  const gc = pick('tx-rp-c').grandTotal;
  const expGross = ga + gb + gc;

  const rep = req('/api/reports', {}, { session: rMgr, params: { from: tKey, to: tKey } }).data;
  const sum = rep.summary;
  const near = (a, b) => Math.abs(a - b) < 0.01;

  const wdgId = String(wdg.data.id);
  const wdgCost = 20;
  const e = { gross: 0, refunds: 0, payouts: 0, cols: 0, tax: 0, count: 0, units: 0, gp: 0 };
  const eDiego = { sales: 0, count: 0 };
  const eTender = {};
  for (const t of w) {
    const k = t.kind || 'sale';
    const costTotal = (t.items || []).reduce((s, it) => s + (it.quantity || 1) * (String(it.productId) === wdgId ? wdgCost : (it.unitCost || 0)), 0);
    for (const tn of (t.tenders || [])) {
      if (k === 'payout') break;
      const ty = String(tn.type || 'cash');
      eTender[ty] = eTender[ty] || { amount: 0, count: 0 };
      if (k === 'refund') eTender[ty].amount -= tn.amount; else eTender[ty].amount += tn.amount;
      eTender[ty].count += 1;
    }
    if (k === 'sale') {
      e.gross += t.grandTotal; e.tax += t.taxAmount || 0; e.count += 1;
      e.units += (t.items || []).reduce((s, it) => s + (it.quantity || 1), 0);
      e.gp += (t.subtotal || 0) - Math.round((t.subtotal || 0) * (t.discountPct || 0) / 100) - costTotal;
      if (String(t.user_id) === diegoId) { eDiego.sales += t.grandTotal; eDiego.count += 1; }
    } else if (k === 'refund') {
      e.refunds += t.grandTotal; e.gp -= costTotal;
      if (String(t.user_id) === diegoId) eDiego.sales -= t.grandTotal;
    } else if (k === 'payout') {
      e.payouts += t.grandTotal;
      eTender.cash = eTender.cash || { amount: 0, count: 0 };
      eTender.cash.amount -= t.grandTotal;
      if (String(t.user_id) === diegoId) eDiego.sales -= t.grandTotal;
    } else if (k === 'payment') {
      e.cols += t.grandTotal;
      if (String(t.user_id) === diegoId) eDiego.sales += t.grandTotal;
    }
  }

  check('summary gross reconciles to DTO', near(sum.grossSales, e.gross), JSON.stringify(sum));
  check('summary sales count reconciles', sum.salesCount === e.count);
  check('summary units reconciles', sum.units === e.units);
  check('summary tax reconciles to DTO', near(sum.tax, e.tax));
  check('refund/payout/collection reconcile to DTO', near(sum.refunds, e.refunds) && near(sum.payouts, e.payouts) && near(sum.collections, e.cols));
  check('net revenue nets gross - refunds - payouts', near(sum.netRevenue, e.gross - e.refunds - e.payouts));
  check('gross profit reconciles to DTO + live cost', near(sum.grossProfit, e.gp));

  const byTender = rep.byTender;
  const tenderTypes = Object.keys(eTender);
  check('every tender type nets to DTO math', tenderTypes.every((ty) => {
    const row = byTender.find((t) => t.type === ty);
    const exp = eTender[ty];
    return row && near(row.amount, exp.amount) && row.count === exp.count;
  }), JSON.stringify(byTender));
  const knownLabels = { cash: 'Cash', card: 'Card', transfer: 'Transfer', store_credit: 'Store credit', net30: 'On account', account: 'On account' };
  check('tender labels known or fall back to key', byTender.every((t) => t.label === (knownLabels[t.type] || t.type)), JSON.stringify(byTender));

  check('byDay calendar-locked to window', rep.byDay.length === 1 && rep.byDay[0].date === tKey && near(rep.byDay[0].sales, e.gross));
  const wdgCat = rep.byCategory.find((c) => c.category === 'Accessories');
  check('byCategory aggregates units + sales', wdgCat && wdgCat.units >= 3 && wdgCat.sales >= expGross, JSON.stringify(rep.byCategory));
  const wdgCash = rep.byCashier.find((c) => c.userName === 'Diego Ramirez');
  check('byCashier nets sales/refunds/payouts', wdgCash && near(wdgCash.sales, eDiego.sales) && wdgCash.count === eDiego.count, JSON.stringify(rep.byCashier));
  const wdgTop = rep.topProducts.find((p) => p.name === 'Rep Widget');
  check('topProducts ranked by revenue', wdgTop && near(wdgTop.sales, expGross) && wdgTop.units === 3);
  const wdgCust = rep.topCustomers.find((c) => c.name === 'Rep Net30');
  check('topCustomers carry period spend + live balance', wdgCust && near(wdgCust.spent, gc) && wdgCust.count === 1, JSON.stringify(rep.topCustomers));
}

{
  section('purchase orders & suppliers');

  const poAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const poMgr = req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] }).data.token;
  const poCash = req('/api/login', { email: 'diego@example.com', pin: CREDS['diego@example.com'] }).data.token;

  check('cashier cannot list suppliers', req('/api/suppliers', {}, { session: poCash }).status === 403);
  check('cashier cannot create a PO', req('/api/purchase-orders', { supplierId: 'x', lines: [] }, { session: poCash }).status === 403);
  check('cashier cannot receive stock', req('/api/purchase-orders/receive', { id: 'x', lines: [] }, { session: poCash }).status === 403);

  const acme = req('/api/suppliers', { name: 'Acme Wholesale', phone: '(555) 777-8899', paymentTerms: 'Net 30' }, { session: poAdm });
  check('admin can add a supplier', !!acme.data && !!acme.data.id);
  const dupSup = req('/api/suppliers', { name: 'Acme Wholesale' }, { session: poAdm });
  check('duplicate supplier name rejected', dupSup.status === 409);
  check('empty supplier name rejected', req('/api/suppliers', { name: '  ' }, { session: poAdm }).status === 400);

  const supList = req('/api/suppliers', {}, { session: poAdm }).data.suppliers;
  const acmeRow = supList.find((s) => s.name === 'Acme Wholesale');
  check('seeded + added suppliers list for managers', supList.some((s) => s.name === 'Swift Supplies') && !!acmeRow && acmeRow.paymentTerms === 'Net 30');

  const mkProd = (name, sku, o) => req('/api/admin/products', {
    name, sku, upc: o.upc || '', category: o.category || 'Accessories',
    costPrice: o.cost || 0, retailPrice: o.retail || 0, isSerialized: !!o.serialized, onHand: 0,
  }, { session: poAdm }).data.id;
  const mouseId = mkProd('PO Mouse', 'PO-MOU-01', { cost: 12, retail: 29 });
  const lapId = mkProd('PO Laptop', 'PO-LAP-01', { cost: 400, retail: 700, serialized: true });

  check('unknown supplier rejected', req('/api/purchase-orders', { supplierId: 'nope', lines: [{ productId: mouseId, quantity: 1, unitCost: 11 }], status: 'ORDERED' }, { session: poMgr }).status === 404);
  check('empty PO lines rejected', req('/api/purchase-orders', { supplierId: acmeRow.id, lines: [], status: 'ORDERED' }, { session: poMgr }).status === 400);
  check('unknown product line rejected', req('/api/purchase-orders', { supplierId: acmeRow.id, lines: [{ productId: 'nope', quantity: 1, unitCost: 5 }], status: 'ORDERED' }, { session: poMgr }).status === 400);
  check('duplicate product line rejected', req('/api/purchase-orders', { supplierId: acmeRow.id, lines: [{ productId: mouseId, quantity: 1, unitCost: 5 }, { productId: mouseId, quantity: 2, unitCost: 5 }], status: 'ORDERED' }, { session: poMgr }).status === 400);

  const ordered = req('/api/purchase-orders', {
    supplierId: acmeRow.id,
    lines: [{ productId: mouseId, quantity: 10, unitCost: 11 }, { productId: lapId, quantity: 2, unitCost: 390 }],
    discountPct: 5, status: 'ORDERED', expectedDate: '2026-10-01', note: 'restock run',
  }, { session: poMgr });
  check('ordered PO created with computed total', ordered.data.status === 'ORDERED' && Math.abs(ordered.data.total - 845.5) < 0.01, JSON.stringify(ordered.data));
  const poId = ordered.data.id;

  const orders = req('/api/purchase-orders', {}, { session: poAdm }).data.orders;
  const poRow = orders.find((o) => o.id === poId);
  check('PO list carries supplier + quantities', !!poRow && poRow.supplierName === 'Acme Wholesale' && poRow.itemCount === 2 && poRow.orderedQty === 12 && poRow.receivedQty === 0 && poRow.expectedDate === '2026-10-01');
  check('cashier cannot read PO list', req('/api/purchase-orders', {}, { session: poCash }).status === 403);

  const detail0 = req('/api/purchase-orders/detail', {}, { params: { id: poId }, session: poMgr }).data.order;
  check('detail shows remaining > 0 with onHand snapshots', detail0.lines.every((l) => l.remaining === l.quantity) && detail0.lines[0].unitCost === 11 && detail0.supplierName === 'Acme Wholesale');
  check('detail of unknown order 404s', req('/api/purchase-orders/detail', {}, { params: { id: 'nope' }, session: poMgr }).status === 404);

  const recv1 = req('/api/purchase-orders/receive', { id: poId, lines: [{ productId: mouseId, quantity: 4 }] }, { session: poAdm });
  check('partial receipt posts stock', recv1.data.status === 'PARTIAL' && recv1.data.receivedValue === 44);
  check('over-receipt rejected', req('/api/purchase-orders/receive', { id: poId, lines: [{ productId: mouseId, quantity: 99 }] }, { session: poAdm }).status === 400);

  const lapRecv = req('/api/purchase-orders/receive', { id: poId, lines: [{ productId: lapId, quantity: 1, serialNumbers: ['PO-SN-0001'] }] }, { session: poAdm });
  check('serialized stock intake registers a serial', lapRecv.data.status === 'PARTIAL' && lapRecv.data.receivedValue === 390);
  check('duplicate serial rejected', req('/api/purchase-orders/receive', { id: poId, lines: [{ productId: lapId, quantity: 1, serialNumbers: ['PO-SN-0001'] }] }, { session: poAdm }).status === 409);
  check('serial count mismatch rejected', req('/api/purchase-orders/receive', { id: poId, lines: [{ productId: lapId, quantity: 1, serialNumbers: [] }] }, { session: poAdm }).status === 400);

  const fin = req('/api/purchase-orders/receive', { id: poId, lines: [{ productId: mouseId, quantity: 6 }, { productId: lapId, quantity: 1, serialNumbers: ['PO-SN-0002'] }] }, { session: poAdm });
  check('full receipt advances order to RECEIVED', fin.data.status === 'RECEIVED' && Math.abs(fin.data.receivedValue - 456) < 0.01);
  check('receiving a received order rejected', req('/api/purchase-orders/receive', { id: poId, lines: [{ productId: mouseId, quantity: 1 }] }, { session: poAdm }).status === 409);

  const prods = req('/api/products', {}, { session: poMgr }).data;
  const mouseAfter = prods.find((p) => p.id === mouseId);
  const lapAfter = prods.find((p) => p.id === lapId);
  check('received stock bumped on_hand + weighted cost', mouseAfter.onHand === 10 && Math.abs(mouseAfter.costPrice - 11) < 0.01, JSON.stringify(mouseAfter));
  check('serialized product on_hand = received serials', lapAfter.onHand === 2 && lapAfter.serials.length === 2 && lapAfter.serials.includes('PO-SN-0002'));

  const ledger = req('/api/transactions', {}, { params: { limit: '500' }, session: poMgr }).data.transactions;
  const purTxs = ledger.filter((t) => t.kind === 'purchase' && t.counterparty === 'Acme Wholesale');
  check('each receipt leaves a purchase trail in the ledger', purTxs.length === 3 && purTxs.every((t) => t.note.includes(poRow.poNumber)), purTxs.map((t) => t.grandTotal).join(','));
  const purTotal = purTxs.reduce((s, t) => s + t.grandTotal, 0);
  check('purchase trail sums to received value', Math.abs(purTotal - 890) < 0.01);

  const todayStart = new Date().toISOString().slice(0, 10);
  const poLedger = req('/api/transactions', {}, { params: { limit: '500' }, session: poMgr }).data.transactions;
  const dayRows2 = poLedger.filter((t) => String(t.createdAt || '').slice(0, 10) === todayStart);
  const sumKind = (k) => dayRows2.filter((t) => (t.kind || 'sale') === k).reduce((s, t) => s + t.grandTotal, 0);
  const expSales = sumKind('sale');
  const expRefunds = sumKind('refund');
  const expPayouts = sumKind('payout');
  const expPayments = sumKind('payment');
  const poExp = req('/api/drive/export', { date: todayStart }, { session: poMgr });
  const poFile = driveFiles.find((f) => f.id === poExp.data.fileId);
  const lineVal = (label) => {
    const ln = poFile.content.split('\n').find((l) => l.includes(label));
    return ln ? parseFloat(ln.split(',').filter(Boolean).pop()) : NaN;
  };
  check('receipts appear in the export but don’t inflate SALES',
    poFile && poFile.content.includes('purchase') && Math.abs(lineVal('SALES') - expSales) < 0.01, poFile && lineVal('SALES'));
  check('collections net as money in on the export',
    Math.abs(lineVal('COLLECTIONS') - expPayments) < 0.01, lineVal('COLLECTIONS'));
  check('purchase receipts never touch NET CASH',
    Math.abs(lineVal('NET CASH') - (expSales - expRefunds - expPayouts + expPayments)) < 0.01, lineVal('NET CASH'));

  const draft = req('/api/purchase-orders', { supplierId: acmeRow.id, lines: [{ productId: mouseId, quantity: 1, unitCost: 13 }], status: 'DRAFT' }, { session: poMgr });
  check('draft PO created', draft.data.status === 'DRAFT');
  check('draft can be cancelled', req('/api/purchase-orders/cancel', { id: draft.data.id }, { session: poAdm }).data.status === 'CANCELLED');
  check('cancelling twice rejected', req('/api/purchase-orders/cancel', { id: draft.data.id }, { session: poAdm }).status === 409);
  check('cancelling a received order rejected', req('/api/purchase-orders/cancel', { id: poId }, { session: poAdm }).status === 409);
  check('cancel of unknown order 404s', req('/api/purchase-orders/cancel', { id: 'nope' }, { session: poAdm }).status === 404);
}

{
  section('price history');

  const phAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const phCash = req('/api/login', { email: 'diego@example.com', pin: CREDS['diego@example.com'] }).data.token;
  const phUsers = req('/api/admin/users/list', {}, { session: phAdm }).data.users;
  const phU = phUsers.find((u) => u.email === 'tariq@example.com');
  const phAdmName = (phU.firstName || '') + ' ' + (phU.lastName || '');

  check('cashier cannot read price history', req('/api/price-history', {}, { session: phCash }).status === 403);
  check('unknown product filter returns empty history', req('/api/price-history', {}, { session: phAdm, params: { productId: 'nope' } }).data.history.length === 0);

  const mouseRow = req('/api/products', {}, { session: phAdm }).data.find((p) => p.sku === 'PO-MOU-01');
  const mouseHist = req('/api/price-history', {}, { session: phAdm, params: { productId: mouseRow.id } }).data.history;
  check('create records a cost baseline', mouseHist.some((r) => r.field === 'cost_price' && r.source === 'create' && Math.abs(r.newValue - 12) < 0.001));
  check('create records a retail baseline', mouseHist.some((r) => r.field === 'retail_price' && r.source === 'create' && Math.abs(r.newValue - 29) < 0.001));
  const poCostChg = mouseHist.find((r) => r.source === 'po' && r.field === 'cost_price');
  check('receiving records the weighted-cost change (12 → 11)',
    !!poCostChg && Math.abs(poCostChg.oldValue - 12) < 0.001 && Math.abs(poCostChg.newValue - 11) < 0.001, JSON.stringify(poCostChg));
  check('receiving history names the purchase order', !!poCostChg && !!poCostChg.poNumber);
  check('history carries the changer’s full name', mouseHist.filter((r) => r.source === 'create').every((r) => r.changedBy === phAdmName));

  const phProd = req('/api/admin/products', {
    name: 'Price Watcher', sku: 'PW-001', category: 'Accessories', costPrice: 20, retailPrice: 40,
  }, { session: phAdm }).data.id;
  const phBefore = req('/api/price-history', {}, { session: phAdm, params: { productId: phProd } }).data.history;
  check('new product has create baselines only', phBefore.length === 2 && phBefore.every((r) => r.source === 'create'));

  const patch = req('/api/admin/products/patch', { productId: phProd, costPrice: 25, retailPrice: 35 }, { session: phAdm });
  check('price patch applied', patch.ok === true, JSON.stringify(patch));

  const phAfter = req('/api/price-history', {}, { session: phAdm, params: { productId: phProd } }).data.history.filter((r) => r.source === 'patch');
  check('patch records the cost change 20 → 25',
    phAfter.some((r) => r.field === 'cost_price' && Math.abs(r.oldValue - 20) < 0.001 && Math.abs(r.newValue - 25) < 0.001), JSON.stringify(phAfter));
  check('patch records the retail change 40 → 35',
    phAfter.some((r) => r.field === 'retail_price' && Math.abs(r.oldValue - 40) < 0.001 && Math.abs(r.newValue - 35) < 0.001), JSON.stringify(phAfter));
  check('manual changes are attributed to the user', phAfter.every((r) => r.changedBy === phAdmName));

  const stayCount = req('/api/price-history', {}, { session: phAdm, params: { productId: phProd } }).data.history.length;
  req('/api/admin/products/patch', { productId: phProd, locked: true }, { session: phAdm });
  check('non-price edits record no history',
    req('/api/price-history', {}, { session: phAdm, params: { productId: phProd } }).data.history.length === stayCount);

  const allHist = req('/api/price-history', {}, { session: phAdm }).data.history;
  check('history sorts newest first',
    allHist.every((r, i) => i === 0 || allHist[i - 1].createdAt >= r.createdAt));
  const lim = req('/api/price-history', {}, { session: phAdm, params: { limit: '3' } }).data.history;
  check('limit caps the result set', lim.length <= 3);
}

{
  section('inventory aging');

  const agAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const agCas = req('/api/login', { email: 'diego@example.com', pin: CREDS['diego@example.com'] }).data.token;
  check('cashier cannot read inventory aging', req('/api/inventory/aging', {}, { session: agCas }).status === 403);

  const alphaId = req('/api/admin/products', {
    name: 'Aging Alpha', sku: 'AG-ALPHA-01', category: 'Accessories', costPrice: 20, retailPrice: 40, onHand: 5,
  }, { session: agAdm }).data.id;
  const betaId = req('/api/admin/products', {
    name: 'Aging Beta', sku: 'AG-BETA-01', category: 'Electronics', costPrice: 30, retailPrice: 70, isSerialized: true, onHand: 0,
  }, { session: agAdm }).data.id;
  const ser = req('/api/admin/serials', { productId: betaId, serialNumbers: ['AG-SN-1', 'AG-SN-2'] }, { session: agAdm });
  check('serialized aging fixture set up', ser.ok === true || ser.data.added.length === 2, JSON.stringify(ser.data));

  const ag0 = req('/api/inventory/aging', {}, { session: agAdm }).data;
  const ag0Alpha = ag0.items.find((i) => i.id === alphaId);
  const ag0Beta = ag0.items.find((i) => i.id === betaId);
  check('aging values stock at cost',
    ag0Alpha && ag0Alpha.onHand === 5 && Math.abs(ag0Alpha.value - 100) < 0.001 && Math.abs(ag0Alpha.costPrice - 20) < 0.001,
    JSON.stringify(ag0Alpha));
  check('serialized items age by available serial count',
    ag0Beta && ag0Beta.onHand === 2 && Math.abs(ag0Beta.value - 60) < 0.001, JSON.stringify(ag0Beta));
  check('fresh stock lands in the current bucket',
    ag0Alpha.ageDays <= 1 && ag0Beta.ageDays <= 1 && ag0.summary.current.units >= 7 && ag0.summary.current.value >= 160,
    JSON.stringify(ag0.summary));
  const sorted = ag0.items.every((it, i) => i === 0 || ag0.items[i - 1].ageDays >= it.ageDays);
  check('aging lists oldest stock first', sorted);
  const valSum = ag0.items.reduce((a, i) => a + i.value, 0);
  const sumBuckets = ag0.summary.current.value + ag0.summary.d30.value + ag0.summary.d60.value + ag0.summary.d90.value;
  check('aging totals reconcile with the items list', Math.abs(valSum - sumBuckets) < 0.001, valSum + ' vs ' + sumBuckets);
  check('aging needs no params / 404 for unknown actions',
    req('/api/inventory/aging', {}, { session: agAdm }).ok === true);

  const beforeLastIn = ag0Alpha.lastIn;
  const sup = req('/api/suppliers', { name: 'Aging Wholesale' }, { session: agAdm });
  const po = req('/api/purchase-orders', {
    supplierId: sup.data.id, lines: [{ productId: alphaId, quantity: 3, unitCost: 25 }], status: 'ORDERED',
  }, { session: agAdm });
  const rec = req('/api/purchase-orders/receive', { id: po.data.id, lines: [{ productId: alphaId, quantity: 3 }] }, { session: agAdm });
  check('aging fixture PO receive accepted', rec.ok === true && rec.data.lines.length === 1, JSON.stringify(rec.data));

  const ag1 = req('/api/inventory/aging', {}, { session: agAdm }).data;
  const ag1Alpha = ag1.items.find((i) => i.id === alphaId);
  check('a PO receipt re-seeds the product’s last-in date',
    ag1Alpha && ag1Alpha.lastIn !== beforeLastIn && ag1Alpha.onHand === 8 && ag1Alpha.ageDays <= 1, JSON.stringify({ b: beforeLastIn, a: ag1Alpha && ag1Alpha.lastIn }));
  const newCost = ag1Alpha.costPrice;
  check('receipt blended the weighted cost in the aging view',
    Math.abs(newCost - 21.88) < 0.001 && Math.abs(ag1Alpha.value - 8 * newCost) < 0.001, String(newCost));
}

{
  section('hardening — v1.11.0');

  const hAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'], deviceId: 'dev-hd-adm' }).data.token;
  const hCas = req('/api/login', { email: 'diego@example.com', pin: CREDS['diego@example.com'], deviceId: 'dev-hd-cas' }).data.token;
  const hNear = (a, b) => Math.abs(a - b) < 0.01;
  const hTxRows = (cid) => ss._sheets.get('Transactions')._grid.filter((r, i) => i > 0 && String(r[4]) === cid);
  const hIt = (oid, qty) => ({ productId: oid, quantity: qty, unitPrice: 10 });

  /* --- VOIDED re-push: a failed push must be re-evaluable, id-stable, and
         must never stack a second row once it succeeds --- */
  const hdProd = req('/api/admin/products', {
    name: 'Harden Lock', sku: 'HD-LOCK-01', category: 'HD Lock', costPrice: 10, retailPrice: 30, onHand: 2,
  }, { session: hAdm }).data.id;
  req('/api/admin/products/patch', { productId: hdProd, locked: true }, { session: hAdm });
  const hdBlocked = req('/api/sync/push', {
    deviceId: 'dev-hd-a',
    batch: [{
      clientTxId: 'tx-hd-a', userId: pin.data.user.id, grandTotal: 30,
      tenders: [{ type: 'cash', amount: 30 }], note: '', createdAt: new Date().toISOString(),
      items: [{ productId: hdProd, quantity: 1, unitPrice: 30 }],
    }],
  }, { session: hCas });
  const hdT1 = hdBlocked.data.results[0].transactionId;
  check('blocked sale rejected as VOIDED with a real transaction id',
    hdBlocked.data.results[0].accepted === false && hdBlocked.data.results[0].status === 'VOIDED' && !!hdT1,
    JSON.stringify(hdBlocked));
  check('VOIDED failure left exactly one row',
    hTxRows('tx-hd-a').length === 1 && hTxRows('tx-hd-a')[0][9] === 'VOIDED', JSON.stringify(hTxRows('tx-hd-a')));
  const hdOnHand0 = req('/api/products', {}, { session: hAdm }).data.find((p) => p.id === hdProd).onHand;
  check('blocked sale consumed no stock', hdOnHand0 === 2);

  req('/api/admin/products/patch', { productId: hdProd, locked: false }, { session: hAdm });
  const hdRetry = req('/api/sync/push', {
    deviceId: 'dev-hd-a',
    batch: [{
      clientTxId: 'tx-hd-a', userId: pin.data.user.id, grandTotal: 30,
      tenders: [{ type: 'cash', amount: 30 }], note: '', createdAt: new Date().toISOString(),
      items: [{ productId: hdProd, quantity: 1, unitPrice: 30 }],
    }],
  }, { session: hCas });
  check('re-push of a VOIDED row re-processes and wins now',
    hdRetry.data.results[0].accepted === true && hdRetry.data.results[0].status === 'COMPLETED'
      && hdRetry.data.results[0].transactionId === hdT1, JSON.stringify(hdRetry));
  check('successful re-push rewrote the row in place (no duplicate)',
    hTxRows('tx-hd-a').length === 1 && hTxRows('tx-hd-a')[0][9] === 'COMPLETED');
  const hdOnHand1 = req('/api/products', {}, { session: hAdm }).data.find((p) => p.id === hdProd).onHand;
  check('accepted re-push consumed stock exactly once', hdOnHand1 === 1);

  const hdRe = req('/api/sync/push', {
    deviceId: 'dev-hd-a',
    batch: [{
      clientTxId: 'tx-hd-a', userId: pin.data.user.id, grandTotal: 30,
      tenders: [{ type: 'cash', amount: 30 }], note: '', createdAt: new Date().toISOString(),
      items: [{ productId: hdProd, quantity: 1, unitPrice: 30 }],
    }],
  }, { session: hCas });
  check('post-success re-push answers ALREADY_SYNCED on the same id',
    hdRe.data.results[0].status === 'ALREADY_SYNCED' && hdRe.data.results[0].transactionId === hdT1);
  const hdChanged = req('/api/sync/push', {
    deviceId: 'dev-hd-a',
    batch: [{
      clientTxId: 'tx-hd-a', userId: pin.data.user.id, grandTotal: 31,
      tenders: [{ type: 'cash', amount: 31 }], note: '', createdAt: new Date().toISOString(),
      items: [{ productId: hdProd, quantity: 1, unitPrice: 31 }],
    }],
  }, { session: hCas });
  check('changed content for the same id still flags DUPLICATE_CLIENT',
    hdChanged.data.results[0].conflicts.some((c) => c.reason === 'duplicate_client_tx')
      && hTxRows('tx-hd-a').length === 1, JSON.stringify(hdChanged));

  /* --- same-batch duplicate clientTxId resolves like a re-push --- */
  const hdB = req('/api/sync/push', {
    deviceId: 'dev-hd-b',
    batch: [{
      clientTxId: 'tx-hd-b', userId: pin.data.user.id, grandTotal: 30,
      tenders: [], note: '', createdAt: new Date().toISOString(),
      items: [{ productId: hdProd, quantity: 1, unitPrice: 30 }],
    }, {
      clientTxId: 'tx-hd-b', userId: pin.data.user.id, grandTotal: 30,
      tenders: [], note: '', createdAt: new Date().toISOString(),
      items: [{ productId: hdProd, quantity: 1, unitPrice: 30 }],
    }],
  }, { session: hCas });
  check('second identical entry in one batch answers ALREADY_SYNCED once',
    hdB.data.results[0].status === 'COMPLETED' && hdB.data.results[1].status === 'ALREADY_SYNCED'
      && hTxRows('tx-hd-b').length === 1, JSON.stringify(hdB.data.results));

  /* --- same-batch sale + prior refunds: the refund must see the same-batch
         original sale AND count same-batch refunds toward "remaining" --- */
  const hdGrossC = req('/api/admin/customers', { name: 'Harden Batch' }, { session: hAdm }).data.customer.id;
  const hdBatchP = req('/api/admin/products', {
    name: 'Harden Batch Prod', sku: 'HD-BATCH-01', category: 'HD Batch', costPrice: 10, retailPrice: 8, onHand: 5,
  }, { session: hAdm }).data.id;
  const hdSame = req('/api/sync/push', {
    deviceId: 'dev-hd-c',
    batch: [{
      clientTxId: 'tx-hd-c', customerId: hdGrossC, grandTotal: 40,
      tenders: [{ type: 'net30', amount: 40 }], note: '', createdAt: new Date().toISOString(),
      items: [{ productId: hdBatchP, quantity: 5, unitPrice: 8 }],
    }, {
      clientTxId: 'tx-hd-rf1', kind: 'refund', originalClientTx: 'tx-hd-c', grandTotal: 15,
      tenders: [{ type: 'cash', amount: 15 }], note: '', createdAt: new Date().toISOString(),
      items: [hIt(hdBatchP, 1)],
    }, {
      clientTxId: 'tx-hd-rf2', kind: 'refund', originalClientTx: 'tx-hd-c', grandTotal: 25,
      tenders: [{ type: 'cash', amount: 25 }], note: '', createdAt: new Date().toISOString(),
      items: [hIt(hdBatchP, 1)],
    }],
  }, { session: hAdm });
  check('same-batch sale then two refunds against it all accept',
    hdSame.data.results[0].accepted && hdSame.data.results[1].accepted && hdSame.data.results[2].accepted,
    JSON.stringify(hdSame));
  const hdRf3 = req('/api/sync/push', {
    deviceId: 'dev-hd-c',
    batch: [{
      clientTxId: 'tx-hd-rf3', kind: 'refund', originalClientTx: 'tx-hd-c', grandTotal: 10,
      tenders: [{ type: 'cash', amount: 10 }], note: '', createdAt: new Date().toISOString(),
      items: [hIt(hdBatchP, 1)],
    }],
  }, { session: hAdm });
  check('third refund past the same-batch total is refused',
    hdRf3.data.results[0].accepted === false
      && hdRf3.data.results[0].conflicts.some((c) => c.reason === 'refund_exceeds_sale'), JSON.stringify(hdRf3));

  /* --- gross profit uses cost-at-sale, not the live (edited) cost --- */
  const hdCostP = req('/api/admin/products', {
    name: 'GP Cost Widget', sku: 'HD-COST-01', category: 'HD Cost', costPrice: 9, retailPrice: 30, onHand: 5,
  }, { session: hAdm }).data.id;
  req('/api/sync/push', {
    deviceId: 'dev-hd-d',
    batch: [{
      clientTxId: 'tx-hd-gp', userId: pin.data.user.id, grandTotal: 60,
      tenders: [], note: '', createdAt: new Date().toISOString(),
      items: [{ productId: hdCostP, quantity: 2, unitPrice: 30 }],
    }],
  }, { session: hCas });
  req('/api/admin/products/patch', { productId: hdCostP, costPrice: 99 }, { session: hAdm });
  const hpDay = new Date().toISOString().slice(0, 10);
  const hpRep = req('/api/reports', {}, { session: hAdm, params: { from: hpDay, to: hpDay } }).data;
  const hpCat = hpRep.byCategory.find((c) => c.category === 'HD Cost');
  check('GP stays at sale-time cost after live cost edit (9 → 99)',
    hpCat && hNear(hpCat.sales, 60) && hNear(hpCat.gp, 60 - 2 * 9), JSON.stringify(hpCat));

  /* --- byCategory/byProduct apply line + order discounts --- */
  const hdDisP = req('/api/admin/products', {
    name: 'Harden Discount', sku: 'HD-DIS-01', category: 'HD Discount', costPrice: 4, retailPrice: 20, onHand: 5,
  }, { session: hAdm }).data.id;
  req('/api/sync/push', {
    deviceId: 'dev-hd-e',
    batch: [{
      clientTxId: 'tx-hd-dis', userId: pin.data.user.id, discountPct: 5, grandTotal: 18.34,
      tenders: [{ type: 'cash', amount: 18.34 }], note: '', createdAt: new Date().toISOString(),
      items: [{ productId: hdDisP, quantity: 1, unitPrice: 20, discountPct: 10 }],
    }],
  }, { session: hCas });
  const disDeliver = req('/api/transactions', {}, { params: { limit: '500' }, session: hAdm }).data.transactions.find((t) => t.clientTxId === 'tx-hd-dis');
  const disRep = req('/api/reports', {}, { session: hAdm, params: { from: hpDay, to: hpDay } }).data;
  const disCat = disRep.byCategory.find((c) => c.category === 'HD Discount');
  check('discounted line nets 10% line + 5% order discount',
    hpDay && disCat && hNear(disCat.sales, 17.10) && hNear(disCat.gp, 17.10 - 4), JSON.stringify(disCat));
  check('discounted totals ledger matches reference',
    disDeliver && hNear(disDeliver.grandTotal, 18.34) && hNear(disDeliver.subtotal, 18.00), JSON.stringify(disDeliver));

  /* --- store-TZ day windows: a 23:30Z sale is the NEXT local day --- */
  req('/api/admin/store', { taxRate: 7.25, tzOffsetMin: 60 }, { session: hAdm });
  req('/api/sync/push', {
    deviceId: 'dev-hd-f',
    batch: [{
      clientTxId: 'tx-hd-tz1', userId: pin.data.user.id, grandTotal: 21.45,
      tenders: [{ type: 'cash', amount: 21.45 }], note: '', createdAt: '2026-09-09T23:30:00.000Z',
      items: [{ productId: hdDisP, quantity: 1, unitPrice: 20 }],
    }],
  }, { session: hCas });
  const tzNext = req('/api/reports', {}, { session: hAdm, params: { from: '2026-09-10', to: '2026-09-10' } }).data;
  const tzPrev = req('/api/reports', {}, { session: hAdm, params: { from: '2026-09-09', to: '2026-09-09' } }).data;
  const tzNextDay = tzNext.byDay.find((d) => d.date === '2026-09-10');
  check('UTC 2026-09-09T23:30 sale lands in the 2026-09-10 LOCAL day (UTC+1)',
    tzNextDay && tzNextDay.sales >= 21.44 && !tzPrev.byDay.some((d) => d.date === '2026-09-10'),
    JSON.stringify({ next: tzNext.byDay, prev: tzPrev.byDay }));
  const tzExpNext = req('/api/drive/export', { date: '2026-09-10' }, { session: hAdm });
  const tzExpPrev = req('/api/drive/export', { date: '2026-09-09' }, { session: hAdm });
  const tzNextCsv = driveFiles.find((f) => f.id === tzExpNext.data.fileId).content;
  const tzPrevCsv = driveFiles.find((f) => f.id === tzExpPrev.data.fileId).content;
  check('drive export buckets the same sale to the local day',
    tzNextCsv.includes('tx-hd-tz1') && !tzPrevCsv.includes('tx-hd-tz1'));
  req('/api/admin/store', { taxRate: 7.25, tzOffsetMin: 0 }, { session: hAdm });

  /* --- config roster is active-only (locked) --- */
  const cfgH = req('/api/config', {}, { session: hAdm }).data;
  check('config roster width is active-only (deactivated Luca excluded)',
    cfgH.users.length === 4 && !cfgH.users.some((u) => u.email === 'luca@example.com'),
    JSON.stringify(cfgH.users.map((u) => u.email)));

  /* --- receivables aging is gross of store-credit refunds --- */
  const hdAgingC = req('/api/admin/customers', { name: 'Gross Aging' }, { session: hAdm }).data.customer.id;
  const hdAgingP = req('/api/admin/products', {
    name: 'Harden Aging', sku: 'HD-AGING-01', category: 'HD Aging', costPrice: 5, retailPrice: 10, onHand: 20,
  }, { session: hAdm }).data.id;
  req('/api/sync/push', {
    deviceId: 'dev-hd-g',
    batch: [{
      clientTxId: 'tx-hd-gross', customerId: hdAgingC, grandTotal: 100,
      tenders: [{ type: 'net30', amount: 100 }], note: '', createdAt: new Date().toISOString(),
      items: [{ productId: hdAgingP, quantity: 10, unitPrice: 10 }],
    }],
  }, { session: hCas });
  req('/api/sync/push', {
    deviceId: 'dev-hd-g',
    batch: [{
      clientTxId: 'tx-hd-gross-rf', kind: 'refund', originalClientTx: 'tx-hd-gross', grandTotal: 30,
      tenders: [{ type: 'store_credit', amount: 30 }], note: '', createdAt: new Date().toISOString(),
      items: [{ productId: hdAgingP, quantity: 3, unitPrice: 10 }],
    }],
  }, { session: hAdm });
  const hdAgingLed = req('/api/customers/ledger', {}, { session: hAdm, params: { customerId: hdAgingC } }).data;
  check('aging stays gross of a store-credit refund (balance nets it)',
    hNear(hdAgingLed.aging.current, 100) && hNear(hdAgingLed.balance, 70),
    JSON.stringify({ aging: hdAgingLed.aging, balance: hdAgingLed.balance }));
}

{
  section('time clock (v1.14.0)');

  const tcAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const tcCash = req('/api/login', { email: 'amara@example.com', pin: '135791' }).data.token;
  const tcOther = req('/api/login', { email: 'diego@example.com', pin: CREDS['diego@example.com'] }).data.token;

  const punchIn = req('/api/timeclock/punch', { deviceId: 'dev-tc-1', note: 'floor open' }, { session: tcCash });
  check('cashier punches in', punchIn.ok === true && punchIn.data.punched === 'in'
    && punchIn.data.entry.status === 'OPEN' && punchIn.data.entry.clockIn && punchIn.data.entry.minutes === null);
  check('punch carries the account name, not just an id', punchIn.data.entry.userName === 'Amara Njoku');

  check('a second punch-in while open is refused',
    req('/api/timeclock/punch', { direction: 'in' }, { session: tcCash }).status === 409);
  check('punching out with no open entry is refused',
    req('/api/timeclock/punch', { direction: 'out' }, { session: tcOther }).status === 409);
  check('an unknown punch direction is rejected',
    req('/api/timeclock/punch', { direction: 'sideways' }, { session: tcCash }).status === 400);

  const mine = req('/api/timeclock', {}, { session: tcCash }).data;
  check('open entry surfaces on me.open with its start time',
    mine.me.open === true && mine.me.since === punchIn.data.entry.clockIn && mine.onFloor === 1);

  const punchOut = req('/api/timeclock/punch', { note: 'lunch' }, { session: tcCash });
  check('the same account punches out and the entry closes',
    punchOut.data.punched === 'out' && punchOut.data.entry.status === 'CLOSED'
    && punchOut.data.entry.clockOut && typeof punchOut.data.entry.minutes === 'number');
  check('closing keeps both notes on the row', punchOut.data.entry.note === 'floor open | lunch');
  check('the closed entry updates in place - one row, not two',
    req('/api/timeclock', {}, { session: tcCash }).data.entries.length === 1);

  req('/api/timeclock/punch', { deviceId: 'dev-tc-2' }, { session: tcOther });
  const cashierView = req('/api/timeclock', {}, { session: tcCash, params: { userId: 'anything' } }).data;
  check('a cashier only ever sees their own punches, even asking for another user',
    cashierView.entries.length === 1 && cashierView.entries.every((e) => e.userName === 'Amara Njoku'));
  check('a cashier onFloor count covers only themselves', cashierView.onFloor === 0);

  const storeView = req('/api/timeclock', {}, { session: tcAdm }).data;
  check('a manager sees the whole floor', storeView.entries.length === 2 && storeView.onFloor === 1);
  check('a manager can filter the roster to one account',
    req('/api/timeclock', {}, { session: tcAdm, params: { userId: storeView.entries[0].userId } }).data.entries
      .every((e) => e.userId === storeView.entries[0].userId));

  /* v1.14.0 fix: ?status=all used to hand a cashier every till reconciliation. */
  const leak = req('/api/shifts', {}, { session: tcCash, params: { status: 'all' } }).data;
  check('a cashier cannot opt into the store-wide shift roster',
    leak.shifts.length > 0 && leak.shifts.every((sh) => sh.userName === 'Amara Njoku'));
  check('a cashier open-shift count is their own, not the store',
    leak.open === leak.shifts.filter((sh) => sh.status === 'OPEN').length);
}

{
  section('inventory tools (v1.15.0)');

  const ivAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const ivCash = req('/api/login', { email: 'amara@example.com', pin: '135791' }).data.token;
  const ivUsers = req('/api/admin/users/list', {}, { session: ivAdm }).data.users;
  const ivCashId = ivUsers.find((u) => u.email === 'amara@example.com').id;

  const mkProd = (name, sku, extra) => req('/api/admin/products', Object.assign({
    name, sku, category: 'IV Tools', costPrice: 10, retailPrice: 25, onHand: 0,
  }, extra || {}), { session: ivAdm }).data.id;

  const fast = mkProd('IV Fast Mover', 'IV-FAST-01', { onHand: 2, reorderPoint: 5 });
  const slow = mkProd('IV Slow Mover', 'IV-SLOW-01', { onHand: 40, reorderPoint: 2 });
  const dead = mkProd('IV Dead Stock', 'IV-DEAD-01', { onHand: 0, reorderPoint: 0 });
  const svc = mkProd('IV Service', 'IV-SVC-01', { itemType: 'service' });

  /* --- reorder worksheet --- */
  const sellIv = (txId, productId, qty, kind, orig) => req('/api/sync/push', {
    deviceId: 'dev-iv-1',
    batch: [{
      clientTxId: txId, userId: ivCashId, kind: kind || 'sale',
      originalClientTx: orig || undefined,
      grandTotal: 25 * qty, createdAt: new Date().toISOString(),
      tenders: [{ type: 'cash', amount: 25 * qty }],
      items: [{ productId, quantity: qty, unitPrice: 25 }],
    }],
  }, { session: kind === 'refund' ? ivAdm : ivCash });

  sellIv('tx-iv-1', fast, 20);
  sellIv('tx-iv-2', slow, 1);

  check('reorder worksheet is manager/admin only',
    req('/api/inventory/reorder', {}, { session: ivCash }).status === 403);

  const ro = req('/api/inventory/reorder', {}, { session: ivAdm, params: { days: 30, cover: 14 } }).data;
  const roFast = ro.items.find((x) => x.sku === 'IV-FAST-01');
  check('a fast mover below its reorder point is flagged', !!roFast);
  check('velocity is units sold over the window', roFast && roFast.soldUnits === 20 && roFast.perDay === Math.round((20 / 30) * 100) / 100);
  check('suggested quantity tops the shelf up to the target cover',
    roFast && roFast.suggested === Math.ceil((20 / 30) * 14) - roFast.onHand,
    JSON.stringify(roFast));
  check('days of cover reflects on-hand at the current rate',
    roFast && roFast.daysOfCover === Math.round((roFast.onHand / (20 / 30)) * 10) / 10);
  check('a well-stocked slow mover is not on the list', !ro.items.some((x) => x.sku === 'IV-SLOW-01'));
  check('an empty item with no demand is not on the list', !ro.items.some((x) => x.sku === 'IV-DEAD-01'));
  check('services never appear on a reorder worksheet', !ro.items.some((x) => x.sku === 'IV-SVC-01'));
  check('the summary totals lines, units and cost at the last-known cost',
    ro.summary.lines === ro.items.length
    && ro.summary.units === ro.items.reduce((n, x) => n + x.suggested, 0));

  /* refunded units are not demand: a returned unit is back on the shelf and
     was never really sold, so it must not pull the reorder up. */
  const returned = mkProd('IV Returned', 'IV-RET-01', { onHand: 30, reorderPoint: 40 });
  sellIv('tx-iv-ret-1', returned, 20);
  const roRetBefore = req('/api/inventory/reorder', {}, { session: ivAdm, params: { days: 30, cover: 14 } })
    .data.items.find((x) => x.sku === 'IV-RET-01');
  sellIv('tx-iv-ret-rf', returned, 8, 'refund', 'tx-iv-ret-1');
  const roRetAfter = req('/api/inventory/reorder', {}, { session: ivAdm, params: { days: 30, cover: 14 } })
    .data.items.find((x) => x.sku === 'IV-RET-01');
  check('a refund gives units back to the demand figure',
    roRetBefore && roRetAfter && roRetBefore.soldUnits === 20 && roRetAfter.soldUnits === 12,
    JSON.stringify({ before: roRetBefore && roRetBefore.soldUnits, after: roRetAfter && roRetAfter.soldUnits }));
  check('a restocked return also lifts on-hand, shrinking the suggestion',
    roRetAfter.onHand > roRetBefore.onHand && roRetAfter.suggested < roRetBefore.suggested);
  check('a shelf that is stocked past the target cover but under its reorder point still lists',
    roRetAfter.reorderPoint === 40 && roRetAfter.onHand < 40);

  /* --- bulk reprice --- */
  const bulkA = mkProd('IV Bulk A', 'IV-BULK-A', { onHand: 5, retailPrice: 100, costPrice: 60 });
  const bulkB = mkProd('IV Bulk B', 'IV-BULK-B', { onHand: 5, retailPrice: 33.33, costPrice: 20 });

  check('bulk reprice is manager/admin only',
    req('/api/admin/products/bulk-price', { productIds: [bulkA], mode: 'pct', value: 10 }, { session: ivCash }).status === 403);

  const prev = req('/api/admin/products/bulk-price', {
    productIds: [bulkA, bulkB], field: 'retail_price', mode: 'pct', value: 10, preview: true,
  }, { session: ivAdm }).data;
  check('preview reports the change without writing it',
    prev.preview === true && prev.changed === 2
    && prev.changes.find((c) => c.id === bulkA).newValue === 110);
  const priceAfterPreview = req('/api/products', {}, { session: ivAdm }).data.find((p) => p.sku === 'IV-BULK-A').retailPrice;
  check('preview really left the catalog alone', priceAfterPreview === 100);

  const applied = req('/api/admin/products/bulk-price', {
    productIds: [bulkA, bulkB], field: 'retail_price', mode: 'pct', value: 10,
  }, { session: ivAdm }).data;
  const catAfter = req('/api/products', {}, { session: ivAdm }).data;
  check('a percentage run applies to every matched product',
    applied.changed === 2
    && catAfter.find((p) => p.sku === 'IV-BULK-A').retailPrice === 110
    && catAfter.find((p) => p.sku === 'IV-BULK-B').retailPrice === 36.66,
    JSON.stringify(applied.changes));

  const rounded = req('/api/admin/products/bulk-price', {
    productIds: [bulkB], field: 'retail_price', mode: 'set', value: 36.66, roundTo: 5,
  }, { session: ivAdm }).data;
  check('roundTo snaps the new price to the nearest step',
    rounded.changed === 1 && rounded.changes[0].newValue === 35);

  const delta = req('/api/admin/products/bulk-price', {
    productIds: [bulkA], field: 'cost_price', mode: 'delta', value: -10,
  }, { session: ivAdm }).data;
  check('a delta run moves cost by an absolute amount',
    delta.changes[0].oldValue === 60 && delta.changes[0].newValue === 50);

  const noop = req('/api/admin/products/bulk-price', {
    productIds: [bulkA], field: 'cost_price', mode: 'set', value: 50,
  }, { session: ivAdm }).data;
  check('a run that changes nothing writes nothing', noop.matched === 1 && noop.changed === 0);

  const byCat = req('/api/admin/products/bulk-price', {
    category: 'IV Tools', field: 'retail_price', mode: 'pct', value: 0, preview: true,
  }, { session: ivAdm }).data;
  check('a category run matches the whole category and excludes services',
    byCat.matched >= 5 && !byCat.changes.length);

  check('a price can never be driven negative',
    req('/api/admin/products/bulk-price', { productIds: [bulkA], mode: 'set', value: -5 }, { session: ivAdm }).status === 400);
  check('an absurd percentage is refused',
    req('/api/admin/products/bulk-price', { productIds: [bulkA], mode: 'pct', value: -99 }, { session: ivAdm }).status === 400);
  check('an unknown field is refused',
    req('/api/admin/products/bulk-price', { productIds: [bulkA], field: 'name', mode: 'set', value: 1 }, { session: ivAdm }).status === 400);
  check('an empty match set is refused rather than silently doing nothing',
    req('/api/admin/products/bulk-price', { category: 'No Such Category', mode: 'pct', value: 5 }, { session: ivAdm }).status === 400);

  const hist = req('/api/price-history', {}, { session: ivAdm, params: { productId: bulkA } }).data.history;
  check('every applied bulk change lands in price history tagged bulk',
    hist.some((h) => h.source === 'bulk' && h.field === 'retail_price' && h.newValue === 110)
    && hist.some((h) => h.source === 'bulk' && h.field === 'cost_price' && h.newValue === 50));
  check('a previewed change never reaches price history',
    hist.filter((h) => h.source === 'bulk' && h.field === 'retail_price').length === 1);

  /* --- stock take --- */
  const stA = mkProd('IV Count A', 'IV-CNT-A', { onHand: 10, costPrice: 12 });
  const stB = mkProd('IV Count B', 'IV-CNT-B', { onHand: 4, costPrice: 5 });
  const stSer = mkProd('IV Count Serial', 'IV-CNT-S', { isSerialized: true });

  check('stock-take is manager/admin only',
    req('/api/admin/stock-take', { counts: [{ productId: stA, counted: 9 }] }, { session: ivCash }).status === 403);

  const take = req('/api/admin/stock-take', {
    counts: [{ productId: stA, counted: 8 }, { productId: stB, counted: 4 }],
    note: 'monday count',
  }, { session: ivAdm }).data;
  check('variance is counted minus what the book expected',
    take.lines.find((l) => l.sku === 'IV-CNT-A').variance === -2
    && take.lines.find((l) => l.sku === 'IV-CNT-B').variance === 0);
  check('shrinkage is valued at cost',
    take.summary.valueDelta === -24 && take.summary.unitVariance === -2, JSON.stringify(take.summary));
  check('only the lines that actually moved are written',
    take.summary.lines === 2 && take.summary.adjusted === 1);
  const afterTake = req('/api/products', {}, { session: ivAdm }).data;
  check('the counted shelf becomes the new on-hand',
    afterTake.find((p) => p.sku === 'IV-CNT-A').onHand === 8
    && afterTake.find((p) => p.sku === 'IV-CNT-B').onHand === 4);

  check('serialized stock cannot be counted by quantity',
    req('/api/admin/stock-take', { counts: [{ productId: stSer, counted: 3 }] }, { session: ivAdm }).status === 400);
  check('a service cannot be counted',
    req('/api/admin/stock-take', { counts: [{ productId: svc, counted: 1 }] }, { session: ivAdm }).status === 400);
  check('a negative count is refused',
    req('/api/admin/stock-take', { counts: [{ productId: stA, counted: -1 }] }, { session: ivAdm }).status === 400);
  check('a fractional count is refused',
    req('/api/admin/stock-take', { counts: [{ productId: stA, counted: 2.5 }] }, { session: ivAdm }).status === 400);
  check('an unknown product id is refused',
    req('/api/admin/stock-take', { counts: [{ productId: 'nope', counted: 1 }] }, { session: ivAdm }).status === 404);
  check('an empty count is refused',
    req('/api/admin/stock-take', { counts: [] }, { session: ivAdm }).status === 400);

  /* a rejected line must not leave half a count behind */
  const before = req('/api/products', {}, { session: ivAdm }).data.find((p) => p.sku === 'IV-CNT-A').onHand;
  req('/api/admin/stock-take', {
    counts: [{ productId: stA, counted: 99 }, { productId: stSer, counted: 1 }],
  }, { session: ivAdm });
  check('one bad line rolls back the whole count',
    req('/api/products', {}, { session: ivAdm }).data.find((p) => p.sku === 'IV-CNT-A').onHand === before);

  const takeSheet = store.ss._sheets.get('StockTakes');
  check('every counted line leaves an audit row, variance or not',
    takeSheet && takeSheet._grid.length === 3, takeSheet ? String(takeSheet._grid.length) : 'no sheet');
}

{
  section('review hardening (v1.15.1)');

  const hdAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const hdCash = req('/api/login', { email: 'amara@example.com', pin: '135791' }).data.token;
  const hdUsers = req('/api/admin/users/list', {}, { session: hdAdm }).data.users;
  const hdCashId = hdUsers.find((u) => u.email === 'amara@example.com').id;

  /* --- prototype-shaped keys must not fall off the report or onto a built-in --- */
  const protoProd = req('/api/admin/products', {
    name: 'Proto Key Item', sku: 'PROTO-01', category: '__proto__',
    costPrice: 4, retailPrice: 10, onHand: 50,
  }, { session: hdAdm }).data.id;

  req('/api/sync/push', {
    deviceId: 'dev-proto-1',
    batch: [{
      clientTxId: 'tx-proto-1', userId: hdCashId, grandTotal: 30,
      createdAt: new Date().toISOString(), subtotal: 30,
      tenders: [{ type: 'constructor', amount: 30 }],
      items: [{ productId: protoProd, quantity: 3, unitPrice: 10 }],
    }],
  }, { session: hdCash });

  const protoRep = req('/api/reports', {}, { session: hdAdm }).data;
  check('a category named __proto__ still reports as a category',
    protoRep.byCategory.some((c) => c.category === '__proto__' && c.sales === 30),
    JSON.stringify(protoRep.byCategory.map((c) => c.category)));
  check('a tender type named constructor still reports as a tender',
    protoRep.byTender.some((t) => t.type === 'constructor' && t.amount === 30),
    JSON.stringify(protoRep.byTender.map((t) => t.type)));
  check('no prototype-shaped key leaked onto a shared built-in',
    Object.prototype.amount === undefined && Object.amount === undefined);
  check('the sale still counts once in the summary', protoRep.summary.grossSales >= 30);

  /* --- a serial named like a prototype key is a new serial, not a duplicate --- */
  const protoSer = req('/api/admin/products', {
    name: 'Proto Serial Phone', sku: 'PROTO-SER-01', category: 'Proto',
    costPrice: 100, retailPrice: 200, isSerialized: true,
  }, { session: hdAdm }).data.id;
  const addProto = req('/api/admin/serials', {
    productId: protoSer, serialNumbers: ['constructor', 'toString', 'REAL-SN-1'],
  }, { session: hdAdm }).data;
  check('serials named like prototype keys are accepted, not swallowed as duplicates',
    addProto.added.length === 3 && addProto.duplicates.length === 0,
    JSON.stringify(addProto));
  const addProtoAgain = req('/api/admin/serials', {
    productId: protoSer, serialNumbers: ['constructor'],
  }, { session: hdAdm }).data;
  check('a genuinely repeated serial is still caught',
    addProtoAgain.added.length === 0 && addProtoAgain.duplicates.length === 1);

  /* --- the guards that decide whether a write is legal read under the lock --- */
  check('stock adjust still refuses a serialized product',
    req('/api/admin/inventory', { productId: protoSer, onHand: 5 }, { session: hdAdm }).status === 400);
  const svcProto = req('/api/admin/products', {
    name: 'Proto Service', sku: 'PROTO-SVC-01', category: 'Proto', itemType: 'service',
    costPrice: 0, retailPrice: 40,
  }, { session: hdAdm }).data.id;
  check('stock adjust still refuses a service',
    req('/api/admin/inventory', { productId: svcProto, onHand: 3 }, { session: hdAdm }).status === 400);
  check('stock adjust still refuses an unknown product',
    req('/api/admin/inventory', { productId: 'nope', onHand: 3 }, { session: hdAdm }).status === 404);
  check('stock adjust still works on an ordinary product',
    req('/api/admin/inventory', { productId: protoProd, onHand: 12 }, { session: hdAdm }).data.onHand === 12);

  check('product patch still refuses a reorder point on a service',
    req('/api/admin/products/patch', { productId: svcProto, reorderPoint: 3 }, { session: hdAdm }).status === 400);
  check('product patch still refuses an unknown product',
    req('/api/admin/products/patch', { productId: 'nope', retailPrice: 5 }, { session: hdAdm }).status === 404);
  check('product patch still refuses an empty change',
    req('/api/admin/products/patch', { productId: protoProd }, { session: hdAdm }).status === 400);

  const patched = req('/api/admin/products/patch', { productId: protoProd, retailPrice: 14 }, { session: hdAdm });
  check('product patch still applies and stays audited', patched.ok === true
    && req('/api/price-history', {}, { session: hdAdm, params: { productId: protoProd } }).data.history
      .some((h) => h.source === 'patch' && h.field === 'retail_price' && h.oldValue === 10 && h.newValue === 14));
}

{
  section('store localisation (v1.16.0)');

  const locAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const locMgr = req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] }).data.token;
  const locCash = req('/api/login', { email: 'amara@example.com', pin: '135791' }).data.token;

  check('only an admin can change store settings',
    req('/api/admin/store', { currency: 'USD' }, { session: locMgr }).status === 403
    && req('/api/admin/store', { currency: 'USD' }, { session: locCash }).status === 403);

  /* --- validation --- */
  check('a malformed locale is refused',
    req('/api/admin/store', { locale: 'english' }, { session: locAdm }).status === 400);
  check('a malformed country is refused',
    req('/api/admin/store', { country: 'NGA' }, { session: locAdm }).status === 400);
  check('a malformed currency is refused',
    req('/api/admin/store', { currency: 'NAIRA' }, { session: locAdm }).status === 400);
  check('an empty cash ladder is refused',
    req('/api/admin/store', { denoms: [] }, { session: locAdm }).status === 400);
  check('a ladder with a zero or negative note is refused',
    req('/api/admin/store', { denoms: [100, 0] }, { session: locAdm }).status === 400
    && req('/api/admin/store', { denoms: [100, -5] }, { session: locAdm }).status === 400);
  check('a ladder with a duplicate note is refused',
    req('/api/admin/store', { denoms: [100, 50, 100] }, { session: locAdm }).status === 400);
  check('a ladder with sub-cent precision is refused',
    req('/api/admin/store', { denoms: [100, 0.005] }, { session: locAdm }).status === 400);

  /* --- the endpoint only writes what it is sent --- */
  req('/api/admin/store', { taxRate: 7.5 }, { session: locAdm });
  const afterTz = req('/api/admin/store', { tzOffsetMin: 60 }, { session: locAdm }).data;
  check('changing one setting does not reset the others',
    afterTz.taxRate === 7.5 && afterTz.tzOffsetMin === 60,
    JSON.stringify({ tax: afterTz.taxRate, tz: afterTz.tzOffsetMin }));

  /* --- currency switch adopts that currency's notes --- */
  const toUsd = req('/api/admin/store', { locale: 'en-US', country: 'US', currency: 'USD' }, { session: locAdm }).data;
  check('switching to USD adopts US notes and coins',
    toUsd.currency === 'USD' && toUsd.denoms[0] === 100 && toUsd.denoms.indexOf(0.25) >= 0);
  check('the ladder always comes back largest first',
    toUsd.denoms.every((v, i, a) => i === 0 || a[i - 1] > v), JSON.stringify(toUsd.denoms));

  const custom = req('/api/admin/store', { denoms: [5, 100, 20, 0.5] }, { session: locAdm }).data;
  check('an explicit ladder is accepted and sorted, and survives a re-read',
    JSON.stringify(custom.denoms) === JSON.stringify([100, 20, 5, 0.5])
    && JSON.stringify(req('/api/config', {}, { session: locCash }).data.store.denoms) === JSON.stringify([100, 20, 5, 0.5]));
  check('an explicit ladder wins over the currency default in the same call',
    JSON.stringify(req('/api/admin/store', { currency: 'GBP', denoms: [50, 10] }, { session: locAdm }).data.denoms)
      === JSON.stringify([50, 10]));

  /* --- a counted drawer is valued against the store ladder --- */
  req('/api/admin/store', { locale: 'en-US', country: 'US', currency: 'USD', denoms: null }, { session: locAdm });
  req('/api/admin/store', { currency: 'USD', denoms: [100, 50, 20, 10, 5, 1, 0.25, 0.1, 0.05] }, { session: locAdm });
  const locShift = req('/api/shifts/open', { openingFloat: 0 }, { session: locAdm }).data.shift.id;
  const locClose = req('/api/shifts/close', {
    shiftId: locShift,
    denoms: { 20: 3, 5: 1, 0.25: 4, 1000: 99 },
  }, { session: locAdm }).data.shift;
  check('the drawer is valued in the store currency, coins included',
    locClose.declaredCash === 66, String(locClose.declaredCash));
  check('a note the store does not hold is ignored, not trusted',
    locClose.declaredCash === 66, 'the 1000s would have added 99,000');

  /* --- a fresh workbook says it has not been set up --- */
  check('the seeded store reports a usable default and its configured flag',
    typeof req('/api/config', {}, { session: locCash }).data.store.configured === 'boolean'
    && req('/api/config', {}, { session: locCash }).data.store.currency === 'USD');
  check('every terminal can read the store settings it needs to format money',
    req('/api/config', {}, { session: locCash }).data.store.locale === 'en-US');
}

{
  section('three money-out kinds (v1.19.0)');

  const coAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const coCash = req('/api/login', { email: 'amara@example.com', pin: '135791' }).data.token;
  const coUsers = req('/api/admin/users/list', {}, { session: coAdm }).data.users;
  const coAdmId = coUsers.find((u) => u.email === 'tariq@example.com').id;

  const cashOut = (clientTxId, kind, amount, session) => req('/api/sync/push', {
    deviceId: 'dev-co-1',
    batch: [{
      clientTxId, kind, userId: coAdmId, grandTotal: amount,
      counterparty: kind === 'expense' ? 'Amara' : 'Vendor',
      tenders: [{ type: 'cash', amount }], note: kind + ' note',
      createdAt: new Date().toISOString(), items: [],
    }],
  }, { session: session || coAdm });

  /* --- all three are accepted and keep their own kind --- */
  const outP = cashOut('tx-co-payout', 'payout', 100);
  const outU = cashOut('tx-co-pickup', 'pickup', 250);
  const outE = cashOut('tx-co-expense', 'expense', 40);
  check('a paid-out is accepted', outP.data.results[0].accepted === true);
  check('a cash pick-up is accepted', outU.data.results[0].accepted === true);
  check('a staff expense is accepted', outE.data.results[0].accepted === true);

  const coLedger = req('/api/transactions', {}, { session: coAdm, params: { limit: 500 } }).data.transactions;
  const byClient = (id) => coLedger.find((t) => t.clientTxId === id);
  check('each row keeps its own kind rather than collapsing to payout',
    byClient('tx-co-payout').kind === 'payout'
    && byClient('tx-co-pickup').kind === 'pickup'
    && byClient('tx-co-expense').kind === 'expense');
  check('cash out never carries gross profit',
    [byClient('tx-co-payout'), byClient('tx-co-pickup'), byClient('tx-co-expense')]
      .every((t) => t.grossProfit === 0));

  /* --- the guard is the same for all three --- */
  check('a cashier cannot record a cash pick-up',
    cashOut('tx-co-cash-pickup', 'pickup', 10, coCash).data.results[0].accepted === false);
  check('a cashier cannot record a staff expense',
    cashOut('tx-co-cash-expense', 'expense', 10, coCash).data.results[0].accepted === false);
  check('a zero pick-up is refused like a zero payout',
    cashOut('tx-co-zero', 'pickup', 0).data.results[0].accepted === false);

  /* --- reports split them, and net revenue loses all three --- */
  const coRep = req('/api/reports', {}, { session: coAdm }).data;
  check('reports report each reason on its own line',
    coRep.summary.payouts >= 100 && coRep.summary.pickups >= 250 && coRep.summary.expenses >= 40,
    JSON.stringify({ p: coRep.summary.payouts, u: coRep.summary.pickups, e: coRep.summary.expenses }));
  check('cashOut totals the three reasons',
    Math.abs(coRep.summary.cashOut - (coRep.summary.payouts + coRep.summary.pickups + coRep.summary.expenses)) < 0.005);
  check('net revenue subtracts every reason, not just paid-out',
    Math.abs(coRep.summary.netRevenue
      - (coRep.summary.grossSales - coRep.summary.refunds - coRep.summary.cashOut)) < 0.005,
    JSON.stringify(coRep.summary));

  /* --- the drawer loses the cash for all three --- */
  const shiftOpen = req('/api/shifts/open', { openingFloat: 1000 }, { session: coAdm });
  const coShiftId = shiftOpen.data.shift.id;
  cashOut('tx-co-shift-p', 'payout', 10);
  cashOut('tx-co-shift-u', 'pickup', 20);
  cashOut('tx-co-shift-e', 'expense', 30);
  const coClose = req('/api/shifts/close', { shiftId: coShiftId, denoms: {} }, { session: coAdm }).data.shift;
  check('shift close subtracts all three reasons from the expected drawer',
    coClose.expectedCash === 1000 - 60, JSON.stringify({ expected: coClose.expectedCash }));

  /* --- the export gives each reason its own line --- */
  const coDay = new Date().toISOString().slice(0, 10);
  const coExp = req('/api/drive/export', { date: coDay }, { session: coAdm });
  const coFile = driveFiles.find((f) => f.id === (coExp.data || {}).fileId);
  const coCsv = (coFile && coFile.content) || '';
  const coLine = (label) => {
    const row = coCsv.split(String.fromCharCode(10)).find((l) => l.indexOf(',,' + label + ',,') === 0);
    return row ? Number(row.split(',')[4]) : null;
  };
  check('the export carries a line per reason',
    coCsv.indexOf('PAID OUT') >= 0 && coCsv.indexOf('CASH PICK-UP') >= 0 && coCsv.indexOf('STAFF EXPENSE') >= 0,
    coExp.ok ? 'csv missing lines' : JSON.stringify(coExp));
  check('the exported detail rows name the new kinds',
    coCsv.indexOf('pickup') >= 0 && coCsv.indexOf('expense') >= 0);
  check('NET CASH subtracts every cash-out reason',
    Math.abs(coLine('NET CASH')
      - (coLine('SALES') - coLine('REFUNDS') - coLine('PAID OUT') - coLine('CASH PICK-UP') - coLine('STAFF EXPENSE') + coLine('COLLECTIONS'))) < 0.01,
    JSON.stringify({ net: coLine('NET CASH'), pickup: coLine('CASH PICK-UP'), expense: coLine('STAFF EXPENSE') }));

  /* --- legacy rows keep working --- */
  check('a legacy payout row still reads as Paid out in the customer ledger labels',
    byClient('tx-co-payout').kind === 'payout');
}

{
  section('receipt numbers + audit log (v1.22.0)');

  const rnAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const rnCash = req('/api/login', { email: 'amara@example.com', pin: '135791' }).data.token;
  const rnMgr = req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] }).data.token;
  const rnUsers = req('/api/admin/users/list', {}, { session: rnAdm }).data.users;
  const rnCashId = rnUsers.find((u) => u.email === 'amara@example.com').id;

  const rnProd = req('/api/admin/products', {
    name: 'RN Widget', sku: 'RN-1', category: 'RN', costPrice: 4, retailPrice: 10, onHand: 500,
  }, { session: rnAdm }).data.id;

  const rnSell = (clientTxId, amount, kind, orig) => req('/api/sync/push', {
    deviceId: 'dev-rn-1',
    batch: [{
      clientTxId, userId: rnCashId, kind: kind || 'sale', originalClientTx: orig || undefined,
      grandTotal: amount, createdAt: new Date().toISOString(),
      tenders: [{ type: 'cash', amount }],
      items: [{ productId: rnProd, quantity: 1, unitPrice: amount }],
    }],
  }, { session: kind === 'refund' ? rnAdm : rnCash });

  /* --- the series --- */
  const r1 = rnSell('tx-rn-1', 10);
  const r2 = rnSell('tx-rn-2', 10);
  check('a sale comes back with its receipt number on the push result',
    /^Orison-S\d{6}$/.test(r1.data.results[0].receiptNo || ''), JSON.stringify(r1.data.results[0]));
  check('numbers are sequential across pushes',
    seqOf(r2.data.results[0].receiptNo) === seqOf(r1.data.results[0].receiptNo) + 1,
    JSON.stringify({ a: r1.data.results[0].receiptNo, b: r2.data.results[0].receiptNo }));

  const r34 = req('/api/sync/push', {
    deviceId: 'dev-rn-2',
    batch: [
      { clientTxId: 'tx-rn-3', userId: rnCashId, grandTotal: 10, createdAt: new Date().toISOString(),
        tenders: [{ type: 'cash', amount: 10 }], items: [{ productId: rnProd, quantity: 1, unitPrice: 10 }] },
      { clientTxId: 'tx-rn-4', userId: rnCashId, grandTotal: 10, createdAt: new Date().toISOString(),
        tenders: [{ type: 'cash', amount: 10 }], items: [{ productId: rnProd, quantity: 1, unitPrice: 10 }] },
    ],
  }, { session: rnCash });
  const batchNos = r34.data.results.map((x) => seqOf(x.receiptNo)).sort((a, b) => a - b);
  check('two sales in one batch take two different numbers',
    batchNos[0] + 1 === batchNos[1], JSON.stringify(batchNos));
  check('the batch continues the same series',
    batchNos[0] === seqOf(r2.data.results[0].receiptNo) + 1);

  /* --- the number is on the ledger, not just the response --- */
  const rnLedger = req('/api/transactions', {}, { session: rnAdm, params: { limit: 500 } }).data.transactions;
  const rnByClient = (id) => rnLedger.find((t) => t.clientTxId === id);
  check('the receipt number is stored on the transaction',
    rnByClient('tx-rn-1').receiptNo === r1.data.results[0].receiptNo);

  /* --- refunds are documents, internal cash movements are not --- */
  const rnRef = rnSell('tx-rn-ref', 10, 'refund', 'tx-rn-1');
  check('a refund is a customer document and gets a number',
    /^Orison-S\d{6}$/.test(rnRef.data.results[0].receiptNo || ''), JSON.stringify(rnRef.data.results[0]));

  req('/api/sync/push', {
    deviceId: 'dev-rn-1',
    batch: [{ clientTxId: 'tx-rn-payout', kind: 'payout', userId: rnCashId, grandTotal: 25,
      counterparty: 'Vendor', tenders: [{ type: 'cash', amount: 25 }],
      createdAt: new Date().toISOString(), items: [] }],
  }, { session: rnAdm });
  check('an internal cash movement takes no number, so the series has no holes',
    !rnByClientFresh('tx-rn-payout').receiptNo);

  function rnByClientFresh(id) {
    return req('/api/transactions', {}, { session: rnAdm, params: { limit: 500 } })
      .data.transactions.find((t) => t.clientTxId === id) || {};
  }
  function seqOf(no) {
    return parseInt(String(no || '').replace(/\D/g, ''), 10);
  }

  /* --- a blocked sale must not burn a number --- */
  const rnSerProd = req('/api/admin/products', {
    name: 'RN Phone', sku: 'RN-PH-1', category: 'RN', costPrice: 100, retailPrice: 200, isSerialized: true,
  }, { session: rnAdm }).data.id;
  req('/api/admin/serials', { productId: rnSerProd, serialNumbers: ['RN-SN-1'] }, { session: rnAdm });
  const beforeBlocked = seqOf(rnByClientFresh('tx-rn-4').receiptNo || 'Orison-S000000');
  req('/api/sync/push', {
    deviceId: 'dev-rn-a',
    batch: [{ clientTxId: 'tx-rn-claim-a', userId: rnCashId, grandTotal: 200, createdAt: new Date().toISOString(),
      tenders: [{ type: 'cash', amount: 200 }],
      items: [{ productId: rnSerProd, quantity: 1, unitPrice: 200, serialNumber: 'RN-SN-1' }] }],
  }, { session: rnCash });
  const blocked = req('/api/sync/push', {
    deviceId: 'dev-rn-b',
    batch: [{ clientTxId: 'tx-rn-claim-b', userId: rnCashId, grandTotal: 200, createdAt: new Date().toISOString(),
      tenders: [{ type: 'cash', amount: 200 }],
      items: [{ productId: rnSerProd, quantity: 1, unitPrice: 200, serialNumber: 'RN-SN-1' }] }],
  }, { session: rnCash });
  check('a sale blocked by first-committed-wins is refused',
    blocked.data.results[0].accepted === false);
  check('a VOIDED sale never takes a receipt number',
    !blocked.data.results[0].receiptNo, JSON.stringify(blocked.data.results[0]));

  /* --- audit log --- */
  req('/api/admin/store', { taxRate: 7 }, { session: rnAdm });
  req('/api/admin/products/bulk-price', { productIds: [rnProd], mode: 'pct', value: 5 }, { session: rnAdm });

  check('the audit log is admin only', req('/api/audit', {}, { session: rnMgr }).status === 403);
  check('a cashier cannot read it either', req('/api/audit', {}, { session: rnCash }).status === 403);

  const audit = req('/api/audit', {}, { session: rnAdm }).data;
  check('privileged actions are recorded', audit.entries.length >= 2, String(audit.entries.length));
  check('the store settings change is in the log',
    audit.entries.some((e) => e.action === 'store.settings'));
  check('the bulk reprice is in the log with what it did',
    audit.entries.some((e) => e.action === 'price.bulk' && /prices changed/.test(e.summary)));
  check('every entry carries who, when and their role',
    audit.entries.every((e) => e.at && e.userName && e.role), JSON.stringify(audit.entries[0]));
  check('the log reads newest first',
    audit.entries.length < 2 || audit.entries[0].at >= audit.entries[1].at);
  check('the log never returns more than 100 at once',
    req('/api/audit', {}, { session: rnAdm, params: { limit: 500 } }).data.entries.length <= 100);
  check('it can be filtered to one action',
    req('/api/audit', {}, { session: rnAdm, params: { action: 'store.settings' } })
      .data.entries.every((e) => e.action === 'store.settings'));
}

{
  section('management is admin only (v1.23.0)');

  const roAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const roMgr = req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] }).data.token;
  const roCash = req('/api/login', { email: 'amara@example.com', pin: '135791' }).data.token;

  const roProd = req('/api/admin/products', {
    name: 'RO Widget', sku: 'RO-1', category: 'RO', costPrice: 5, retailPrice: 12, onHand: 40,
  }, { session: roAdm }).data.id;

  /* --- moved to admin only --- */
  check('a manager can no longer reprice the catalog in bulk',
    req('/api/admin/products/bulk-price', { productIds: [roProd], mode: 'pct', value: 5 }, { session: roMgr }).status === 403);
  check('a manager can no longer commit a stock take',
    req('/api/admin/stock-take', { counts: [{ productId: roProd, counted: 39 }] }, { session: roMgr }).status === 403);
  check('a manager can no longer create a supplier',
    req('/api/suppliers', { name: 'RO Supplies' }, { session: roMgr }).status === 403);
  check('a manager can no longer cancel a purchase order',
    req('/api/purchase-orders/cancel', { id: 'whatever' }, { session: roMgr }).status === 403);

  check('an admin still can reprice',
    req('/api/admin/products/bulk-price', { productIds: [roProd], mode: 'pct', value: 0, preview: true }, { session: roAdm }).ok === true);
  check('an admin still can commit a stock take',
    req('/api/admin/stock-take', { counts: [{ productId: roProd, counted: 40 }] }, { session: roAdm }).ok === true);
  const roSup = req('/api/suppliers', { name: 'RO Supplies' }, { session: roAdm });
  check('an admin still can create a supplier', roSup.ok === true);

  /* --- managers keep the daily trade --- */
  check('a manager still runs reports', req('/api/reports', {}, { session: roMgr }).ok === true);
  check('a manager still edits a product', req('/api/admin/products/patch',
    { productId: roProd, retailPrice: 13 }, { session: roMgr }).ok === true);
  check('a manager still adjusts stock', req('/api/admin/inventory',
    { productId: roProd, onHand: 41 }, { session: roMgr }).ok === true);
  check('a manager still reads the reorder worksheet',
    req('/api/inventory/reorder', {}, { session: roMgr }).ok === true);
  check('a manager still sees customers and receivables',
    req('/api/customers/receivables', {}, { session: roMgr }).ok === true);
  check('a manager still creates a purchase order',
    req('/api/purchase-orders', { supplierId: roSup.data.id, lines: [{ productId: roProd, quantity: 1, unitCost: 5 }], status: 'DRAFT' }, { session: roMgr }).ok === true);

  /* --- cashiers gain nothing --- */
  check('a cashier still cannot reprice',
    req('/api/admin/products/bulk-price', { productIds: [roProd], mode: 'pct', value: 5 }, { session: roCash }).status === 403);
  check('a cashier still cannot read suppliers',
    req('/api/suppliers', {}, { session: roCash }).status === 403);
  check('a cashier still cannot read the audit log',
    req('/api/audit', {}, { session: roCash }).status === 403);

  /* --- the restriction is recorded, so a refusal is explainable later --- */
  const roAudit = req('/api/audit', {}, { session: roAdm }).data;
  check('admin actions keep landing in the audit log', roAudit.entries.length > 0);
}

{
  section('backups (v1.24.0)');

  const bkAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const bkMgr = req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] }).data.token;
  const bkCash = req('/api/login', { email: 'amara@example.com', pin: '135791' }).data.token;

  check('a manager cannot run a backup', req('/api/backup/run', {}, { session: bkMgr }).status === 403);
  check('a cashier cannot read backup status', req('/api/backup/status', {}, { session: bkCash }).status === 403);

  const beforeCount = driveBackups.length;
  const run = req('/api/backup/run', {}, { session: bkAdm });
  check('an admin can run a backup', run.ok === true, JSON.stringify(run));
  check('it writes one file', driveBackups.length === beforeCount + 1);
  check('the file name carries the date and the time',
    /^Orison-POS-Backup_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/.test(run.data.name), run.data.name);
  check('the file lands in a folder called POS Backup',
    driveFolders.some((f) => f.name === 'POS Backup'));

  const status = req('/api/backup/status', {}, { session: bkAdm }).data;
  check('status reports the last backup', status.lastName === run.data.name && !!status.lastAt);
  check('status names the folder and the retention', status.folder === 'POS Backup' && status.keepDaily === 30);

  const bkAudit = req('/api/audit', {}, { session: bkAdm, params: { action: 'backup.run' } }).data;
  check('the backup is recorded in the audit log',
    bkAudit.entries.length > 0 && bkAudit.entries[0].summary.indexOf('Orison-POS-Backup_') === 0,
    JSON.stringify(bkAudit.entries[0] || {}));

  /* --- the nightly trigger --- */
  scriptTriggers.length = 0;
  sandbox.installBackupTrigger();
  check('installing creates one nightly trigger', scriptTriggers.length === 1);
  check('it runs daily, in the small hours',
    scriptTriggers[0]._spec.hour === 2 && scriptTriggers[0]._spec.days === 1);
  sandbox.installBackupTrigger();
  check('installing twice does not stack duplicate triggers', scriptTriggers.length === 1);

  /* --- a failed backup must shout, not fail silently --- */
  const mailsBefore = mails.length;
  const realGetFileById = sandbox.DriveApp.getFileById;
  sandbox.DriveApp.getFileById = () => { throw new Error('Drive unavailable'); };
  sandbox.backupDaily();
  sandbox.DriveApp.getFileById = realGetFileById;
  check('a scheduled backup that fails does not throw out of the trigger', true);
  check('a failed backup emails the admins', mails.length > mailsBefore,
    JSON.stringify({ before: mailsBefore, after: mails.length }));
  check('the failure is recorded in the audit log',
    req('/api/audit', {}, { session: bkAdm, params: { action: 'backup.failed' } }).data.entries.length > 0);
  check('the failure is visible in status',
    /Drive unavailable/.test(req('/api/backup/status', {}, { session: bkAdm }).data.lastError));

  /* --- retention --- */
  const folderId = driveFolders.find((f) => f.name === 'POS Backup').id;
  for (let i = 1; i <= 40; i++) {
    driveBackups.push({ id: 'old-' + i, name: 'Orison-POS-Backup_2026-01-' + String(i % 28 + 1).padStart(2, '0') + '_0200.xlsx', folderId, trashed: false });
  }
  req('/api/backup/run', {}, { session: bkAdm });
  const live = driveBackups.filter((b) => b.folderId === folderId && !b.trashed);
  check('retention prunes old backups rather than letting Drive fill up',
    live.length < 41, String(live.length));
  check('the newest backup always survives pruning',
    live.some((b) => b.name.indexOf('Orison-POS-Backup_20') === 0));
}

{
  section('100-row cap + server-side search (v1.25.0)');

  const pgAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const pgCash = req('/api/login', { email: 'amara@example.com', pin: '135791' }).data.token;
  const pgUsers = req('/api/admin/users/list', {}, { session: pgAdm }).data.users;
  const pgCashId = pgUsers.find((u) => u.email === 'amara@example.com').id;

  const pgProd = req('/api/admin/products', {
    name: 'Paging Widget', sku: 'PG-1', category: 'PG', costPrice: 1, retailPrice: 3, onHand: 100000,
  }, { session: pgAdm }).data.id;
  const pgCust = req('/api/admin/customers', { name: 'Priya Paging', phone: '555-0101' }, { session: pgAdm }).data.customer.id;

  /* 130 sales so the cap and the cursor both have something to prove */
  const pgBatch = [];
  for (let i = 0; i < 130; i++) {
    pgBatch.push({
      clientTxId: 'tx-pg-' + i, userId: pgCashId, grandTotal: 3,
      createdAt: new Date(Date.now() - (130 - i) * 60000).toISOString(),
      tenders: [{ type: 'cash', amount: 3 }],
      items: [{ productId: pgProd, quantity: 1, unitPrice: 3 }],
    });
  }
  req('/api/sync/push', { deviceId: 'dev-pg', batch: pgBatch }, { session: pgCash });

  const p1 = req('/api/transactions', {}, { session: pgAdm, params: { limit: 500 } }).data;
  check('no caller can ask for more than 100 rows', p1.transactions.length === 100, String(p1.transactions.length));
  check('the response says how many matched in total', p1.matched >= 130, String(p1.matched));
  check('it hands back a cursor when there is more', !!p1.nextCursor);

  const p2 = req('/api/transactions', {}, { session: pgAdm, params: { cursor: p1.nextCursor } }).data;
  check('the cursor returns the next page, not the same one',
    p2.transactions.length > 0 && p2.transactions[0].clientTxId !== p1.transactions[0].clientTxId);
  const idsA = p1.transactions.map((t) => t.clientTxId);
  const idsB = p2.transactions.map((t) => t.clientTxId);
  check('pages do not overlap', idsB.every((id) => !idsA.includes(id)));

  /* --- search --- */
  const pgOne = req('/api/transactions', {}, { session: pgAdm, params: { limit: 100 } }).data.transactions[0];
  const byReceipt = req('/api/transactions', {}, { session: pgAdm, params: { q: pgOne.receiptNo } }).data;
  check('a sale is findable by its receipt number',
    byReceipt.transactions.length === 1 && byReceipt.transactions[0].receiptNo === pgOne.receiptNo,
    JSON.stringify({ q: pgOne.receiptNo, got: byReceipt.transactions.length }));

  check('searching an item name finds the sales',
    req('/api/transactions', {}, { session: pgAdm, params: { q: 'Paging Widget' } }).data.matched >= 100);
  check('searching an amount finds sales of that amount',
    req('/api/transactions', {}, { session: pgAdm, params: { q: '3' } }).data.matched >= 100);
  check('a search that matches nothing returns nothing, not everything',
    req('/api/transactions', {}, { session: pgAdm, params: { q: 'zzz-no-such-thing' } }).data.transactions.length === 0);

  /* customer + serial search */
  req('/api/sync/push', {
    deviceId: 'dev-pg',
    batch: [{ clientTxId: 'tx-pg-cust', userId: pgCashId, customerId: pgCust, grandTotal: 3,
      createdAt: new Date().toISOString(), tenders: [{ type: 'net30', amount: 3 }],
      items: [{ productId: pgProd, quantity: 1, unitPrice: 3 }] }],
  }, { session: pgCash });
  check('a sale is findable by customer name',
    req('/api/transactions', {}, { session: pgAdm, params: { q: 'Priya' } }).data.transactions
      .some((t) => t.clientTxId === 'tx-pg-cust'));
  check('a sale is findable by cashier name',
    req('/api/transactions', {}, { session: pgAdm, params: { q: 'Amara' } }).data.matched > 0);

  /* --- search must not widen a cashier's view --- */
  const pgOther = req('/api/login', { email: 'diego@example.com', pin: CREDS['diego@example.com'] }).data.token;
  check('a cashier searching still only sees their own rows',
    req('/api/transactions', {}, { session: pgOther, params: { q: 'Paging Widget' } }).data.transactions.length === 0);

  /* --- date window --- */
  const pgFrom = new Date(Date.now() - 5 * 60000).toISOString();
  const windowed = req('/api/transactions', {}, { session: pgAdm, params: { from: pgFrom } }).data;
  check('a from-date narrows the window',
    windowed.matched < p1.matched && windowed.matched > 0,
    JSON.stringify({ windowed: windowed.matched, all: p1.matched }));

  /* --- the ceiling nobody had measured --- */
  const bulk = [];
  for (let i = 0; i < 2000; i++) {
    bulk.push({
      clientTxId: 'tx-load-' + i, userId: pgCashId, grandTotal: 2,
      createdAt: new Date(Date.now() - i * 1000).toISOString(),
      tenders: [{ type: 'cash', amount: 2 }],
      items: [{ productId: pgProd, quantity: 1, unitPrice: 2 }],
    });
  }
  for (let c = 0; c < 5; c++) {
    req('/api/sync/push', { deviceId: 'dev-load-' + c, batch: bulk.slice(c * 400, (c + 1) * 400)
      .map((b) => ({ ...b, clientTxId: b.clientTxId + '-' + c })) }, { session: pgCash });
  }
  const t0 = Date.now();
  const big = req('/api/transactions', {}, { session: pgAdm, params: { limit: 100 } }).data;
  const readMs = Date.now() - t0;
  check('a paged read still returns 100 rows with thousands in the ledger',
    big.transactions.length === 100 && big.matched > 2000,
    JSON.stringify({ rows: big.transactions.length, matched: big.matched }));
  console.log('      (ledger ' + big.matched + ' rows, paged read ' + readMs + 'ms in the sim)');
}

{
  section('scheduled reports (v1.26.0)');

  const schAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const schMgr = req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] }).data.token;

  check('only an admin can read or change the schedule',
    req('/api/reports/schedule', {}, { session: schMgr }).status === 403);

  const initial = req('/api/reports/schedule', {}, { session: schAdm }).data;
  check('nothing is scheduled until someone asks for it',
    initial.daily === false && initial.weekly === false && initial.monthly === false
    && initial.recipients.length === 0, JSON.stringify(initial));

  check('a bad email address is refused',
    req('/api/reports/schedule', { recipients: 'not-an-email' }, { session: schAdm }).status === 400);

  const set = req('/api/reports/schedule', {
    recipients: 'owner@example.com, books@example.com',
  }, { session: schAdm }).data;
  check('recipients are stored and trimmed',
    set.recipients.length === 2 && set.recipients[0] === 'owner@example.com', JSON.stringify(set.recipients));

  const on = req('/api/reports/schedule', { cadence: 'daily', on: true }, { session: schAdm }).data;
  check('a cadence can be switched on', on.daily === true && on.weekly === false);

  /* --- sending --- */
  const mailsBefore = mails.length;
  const sent = req('/api/reports/schedule', { sendNow: 'daily' }, { session: schAdm });
  check('send-now sends to every recipient',
    sent.data.sent === true && sent.data.recipients === 2, JSON.stringify(sent.data));
  check('exactly one mail goes out, addressed to both', mails.length === mailsBefore + 1);
  const mail = mails[mails.length - 1];
  check('it is addressed to the nominated admins',
    mail.to.indexOf('owner@example.com') >= 0 && mail.to.indexOf('books@example.com') >= 0, mail.to);
  check('the subject names the shop and the window',
    /report/.test(mail.subject) && /\d{4}-\d{2}-\d{2}/.test(mail.subject), mail.subject);
  check('the figures are in the body',
    /Gross sales/.test(mail.body) && /Net revenue/.test(mail.body) && /Gross profit/.test(mail.body));
  check('cash out is broken down by reason in the body',
    /paid out/.test(mail.body) && /cash pick-up/.test(mail.body) && /staff expense/.test(mail.body));
  check('the period CSV is attached',
    (mail.attachments || []).length === 1 && /\.csv$/.test(mail.attachments[0].fileName),
    JSON.stringify((mail.attachments || []).map((a) => a.fileName)));
  check('the CSV has a header and day rows',
    /^date,sales,count,gross_profit/.test(mail.attachments[0].content));
  check('the send is recorded in the audit log',
    req('/api/audit', {}, { session: schAdm, params: { action: 'report.sent' } }).data.entries.length > 0);
  check('status remembers when the daily last went',
    !!req('/api/reports/schedule', {}, { session: schAdm }).data.lastDaily);

  /* --- the trigger path --- */
  const beforeTrigger = mails.length;
  sandbox.reportDaily();
  check('the scheduled trigger sends when the cadence is on', mails.length === beforeTrigger + 1);

  req('/api/reports/schedule', { cadence: 'daily', on: false }, { session: schAdm });
  const beforeOff = mails.length;
  sandbox.reportDaily();
  check('a cadence that is switched off sends nothing', mails.length === beforeOff);

  /* --- no recipients is a no-op, not a crash --- */
  req('/api/reports/schedule', { recipients: '' }, { session: schAdm });
  const none = req('/api/reports/schedule', { sendNow: 'weekly' }, { session: schAdm }).data;
  check('with nobody to send to it declines rather than throwing',
    none.sent === false && none.reason === 'no_recipients', JSON.stringify(none));

  /* --- a failing send must not kill the trigger --- */
  req('/api/reports/schedule', { recipients: 'owner@example.com' }, { session: schAdm });
  req('/api/reports/schedule', { cadence: 'weekly', on: true }, { session: schAdm });
  const realSend = sandbox.MailApp.sendEmail;
  sandbox.MailApp.sendEmail = () => { throw new Error('Mail quota exceeded'); };
  sandbox.reportWeekly();
  sandbox.MailApp.sendEmail = realSend;
  check('a failing scheduled report does not throw out of the trigger', true);
  check('the failure is recorded in the audit log',
    req('/api/audit', {}, { session: schAdm, params: { action: 'report.failed' } }).data.entries.length > 0);
  check('the failure is visible in the schedule status',
    /Mail quota exceeded/.test(req('/api/reports/schedule', {}, { session: schAdm }).data.lastError));

  /* --- triggers install once --- */
  scriptTriggers.length = 0;
  sandbox.installReportTriggers();
  check('three report triggers are installed', scriptTriggers.length === 3);
  sandbox.installReportTriggers();
  check('installing twice does not stack duplicates', scriptTriggers.length === 3);
}

{
  section('sales made elsewhere (v1.27.0)');

  const chAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const chCash = req('/api/login', { email: 'amara@example.com', pin: '135791' }).data.token;
  const chUsers = req('/api/admin/users/list', {}, { session: chAdm }).data.users;
  const chCashId = chUsers.find((u) => u.email === 'amara@example.com').id;

  const chProd = req('/api/admin/products', {
    name: 'Channel Widget', sku: 'CH-1', category: 'CH', costPrice: 4, retailPrice: 20, onHand: 50,
  }, { session: chAdm }).data.id;

  const chSell = (clientTxId, channel, externalRef, qty) => req('/api/sync/push', {
    deviceId: 'dev-ch',
    batch: [{
      clientTxId, userId: chCashId, grandTotal: 20 * (qty || 1),
      createdAt: new Date().toISOString(),
      channel, externalRef,
      tenders: [{ type: 'transfer', amount: 20 * (qty || 1) }],
      items: [{ productId: chProd, quantity: qty || 1, unitPrice: 20 }],
    }],
  }, { session: chCash });

  const before = req('/api/products', {}, { session: chAdm }).data.find((p) => p.sku === 'CH-1').onHand;

  check('a marketplace sale is accepted',
    chSell('tx-ch-mkt', 'marketplace', 'eBay 12-34567-89012', 2).data.results[0].accepted === true);

  const after = req('/api/products', {}, { session: chAdm }).data.find((p) => p.sku === 'CH-1').onHand;
  check('it takes the stock off the shelf, exactly like a counter sale',
    after === before - 2, JSON.stringify({ before, after }));

  const chLedger = req('/api/transactions', {}, { session: chAdm, params: { q: 'eBay 12-34567' } }).data;
  check('it is findable by its order reference',
    chLedger.transactions.length === 1, String(chLedger.transactions.length));
  const row = chLedger.transactions[0];
  check('the row records where it sold', row.channel === 'marketplace', row.channel);
  check('the row keeps the external reference', row.externalRef === 'eBay 12-34567-89012', row.externalRef);
  check('it is still a numbered customer document', /^Orison-S\d{6}$/.test(row.receiptNo || ''), row.receiptNo);

  /* --- a counter sale is still a counter sale --- */
  chSell('tx-ch-counter', undefined, '', 1);
  const counter = req('/api/transactions', {}, { session: chAdm, params: { q: 'tx-ch-counter' } }).data.transactions[0];
  check('a sale with no channel defaults to in-store', counter.channel === 'in_store', counter.channel);

  /* --- an unknown channel cannot be smuggled in --- */
  chSell('tx-ch-bogus', 'bogus-channel', 'X1', 1);
  const bogus = req('/api/transactions', {}, { session: chAdm, params: { q: 'tx-ch-bogus' } }).data.transactions[0];
  check('an unrecognised channel falls back to in-store rather than storing junk',
    bogus.channel === 'in_store', bogus.channel);

  /* --- reports split it out --- */
  const chRep = req('/api/reports', {}, { session: chAdm }).data;
  const chans = chRep.byChannel || [];
  const mkt = chans.find((c) => c.channel === 'marketplace');
  const store = chans.find((c) => c.channel === 'in_store');
  check('reports break sales down by channel', !!mkt && !!store, JSON.stringify(chans));
  check('the marketplace figures are its own', mkt && mkt.units === 2 && mkt.count === 1,
    JSON.stringify(mkt));
  check('channel sales still count in the overall total',
    chRep.summary.grossSales >= 40 + 20 + 20);

  /* --- serialized stock sold elsewhere --- */
  const chSer = req('/api/admin/products', {
    name: 'Channel Phone', sku: 'CH-PH', category: 'CH', costPrice: 100, retailPrice: 300, isSerialized: true,
  }, { session: chAdm }).data.id;
  req('/api/admin/serials', { productId: chSer, serialNumbers: ['CH-SN-1'] }, { session: chAdm });
  req('/api/sync/push', {
    deviceId: 'dev-ch',
    batch: [{ clientTxId: 'tx-ch-serial', userId: chCashId, grandTotal: 300,
      createdAt: new Date().toISOString(), channel: 'marketplace', externalRef: 'eBay 99-9',
      tenders: [{ type: 'transfer', amount: 300 }],
      items: [{ productId: chSer, quantity: 1, unitPrice: 300, serialNumber: 'CH-SN-1' }] }],
  }, { session: chCash });
  const chSerAfter = req('/api/products', {}, { session: chAdm }).data.find((p) => p.sku === 'CH-PH');
  check('an IMEI sold elsewhere is consumed like any other',
    chSerAfter.onHand === 0 && chSerAfter.serials.length === 0,
    JSON.stringify({ onHand: chSerAfter.onHand, serials: chSerAfter.serials }));

  /* --- and the same unit cannot then be sold at the counter --- */
  const dbl = req('/api/sync/push', {
    deviceId: 'dev-counter',
    batch: [{ clientTxId: 'tx-ch-double', userId: chCashId, grandTotal: 300,
      createdAt: new Date().toISOString(),
      tenders: [{ type: 'cash', amount: 300 }],
      items: [{ productId: chSer, quantity: 1, unitPrice: 300, serialNumber: 'CH-SN-1' }] }],
  }, { session: chCash });
  check('the counter cannot sell a unit the marketplace already took',
    dbl.data.results[0].accepted === false, JSON.stringify(dbl.data.results[0]));
}

{
  section('card tender (v1.29.0)');

  const cdAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const cdCash = req('/api/login', { email: 'amara@example.com', pin: '135791' }).data.token;
  const cdUsers = req('/api/admin/users/list', {}, { session: cdAdm }).data.users;
  const cdCashId = cdUsers.find((u) => u.email === 'amara@example.com').id;

  const cdProd = req('/api/admin/products', {
    name: 'Card Widget', sku: 'CD-1', category: 'CD', costPrice: 10, retailPrice: 50, onHand: 200,
  }, { session: cdAdm }).data.id;

  const cdSell = (clientTxId, tenders, amount) => req('/api/sync/push', {
    deviceId: 'dev-cd',
    batch: [{
      clientTxId, userId: cdCashId, grandTotal: amount, createdAt: new Date().toISOString(),
      tenders, items: [{ productId: cdProd, quantity: 1, unitPrice: amount }],
    }],
  }, { session: cdCash });

  /* the whole point: a card sale must not inflate the drawer */
  const cdShift = req('/api/shifts/open', { openingFloat: 500 }, { session: cdCash }).data.shift.id;

  cdSell('tx-cd-cash', [{ type: 'cash', amount: 50 }], 50);
  cdSell('tx-cd-card', [{ type: 'card', amount: 50 }], 50);
  cdSell('tx-cd-split', [{ type: 'cash', amount: 20 }, { type: 'card', amount: 30 }], 50);

  const cdClose = req('/api/shifts/close', { shiftId: cdShift, denoms: {} }, { session: cdCash }).data.shift;
  check('a card sale never counts toward the expected drawer',
    cdClose.expectedCash === 500 + 50 + 20,
    JSON.stringify({ expected: cdClose.expectedCash, wanted: 570 }));

  /* it is still revenue */
  const cdRep = req('/api/reports', {}, { session: cdAdm }).data;
  const cardLine = (cdRep.byTender || []).find((t) => t.type === 'card');
  check('card is reported as its own tender line', !!cardLine, JSON.stringify(cdRep.byTender));
  check('it is labelled Card, not left as a bare key', cardLine && cardLine.label === 'Card');
  check('card takings are counted', cardLine && cardLine.amount >= 80, JSON.stringify(cardLine));
  check('card sales still count as gross sales', cdRep.summary.grossSales >= 150);

  /* a card refund gives the money back on the card, not out of the till */
  const cdShift2 = req('/api/shifts/open', { openingFloat: 100 }, { session: cdCash }).data.shift.id;
  req('/api/sync/push', {
    deviceId: 'dev-cd',
    batch: [{ clientTxId: 'tx-cd-refund', kind: 'refund', originalClientTx: 'tx-cd-card',
      userId: cdCashId, grandTotal: 50, createdAt: new Date().toISOString(),
      tenders: [{ type: 'card', amount: 50 }],
      items: [{ productId: cdProd, quantity: 1, unitPrice: 50 }] }],
  }, { session: cdAdm });
  const cdClose2 = req('/api/shifts/close', { shiftId: cdShift2, denoms: {} }, { session: cdCash }).data.shift;
  check('a card refund does not take cash out of the drawer either',
    cdClose2.expectedCash === 100, JSON.stringify({ expected: cdClose2.expectedCash }));

  /* the export tells cash and card apart */
  const cdDay = new Date().toISOString().slice(0, 10);
  const cdExp = req('/api/drive/export', { date: cdDay }, { session: cdAdm });
  const cdFile = driveFiles.find((f) => f.id === (cdExp.data || {}).fileId);
  const cdCsv = (cdFile && cdFile.content) || '';
  const cdLine = (label) => {
    const row = cdCsv.split(String.fromCharCode(10)).find((l) => l.indexOf(',,' + label + ',,') === 0);
    return row ? Number(row.split(',')[4]) : null;
  };
  check('the export carries a CARD line', cdLine('CARD') !== null, 'missing');
  check('the export carries what the drawer should actually hold',
    cdLine('CASH IN DRAWER') !== null, 'missing');
  check('cash in drawer is less than net cash once cards are in play',
    cdLine('CASH IN DRAWER') < cdLine('NET CASH'),
    JSON.stringify({ drawer: cdLine('CASH IN DRAWER'), net: cdLine('NET CASH') }));
}

{
  section('remaining open items (v1.30.0)');

  const oiAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const oiMgr = req('/api/login', { email: 'sarah@example.com', pin: CREDS['sarah@example.com'] }).data.token;
  const oiCash = req('/api/login', { email: 'diego@example.com', pin: CREDS['diego@example.com'] }).data.token;

  /* --- the staff roster is no longer handed to every signed-in account --- */
  const cashCfg = req('/api/config', {}, { session: oiCash }).data;
  check('a cashier no longer receives the staff roster',
    Array.isArray(cashCfg.users) && cashCfg.users.length === 0, JSON.stringify(cashCfg.users));
  check('a cashier still gets what the app needs to run',
    !!cashCfg.store && (cashCfg.currencies || []).length > 0);
  check('a manager still sees the roster',
    req('/api/config', {}, { session: oiMgr }).data.users.length > 0);
  check('an admin still sees the roster',
    req('/api/config', {}, { session: oiAdm }).data.users.length > 0);

  /* --- a punch queued offline keeps the time it actually happened --- */
  /* earlier sections left this account clocked in; start from a known state */
  if (req('/api/timeclock', {}, { session: oiCash }).data.me.open) {
    req('/api/timeclock/punch', { direction: 'out' }, { session: oiCash });
  }
  const past = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const queued = req('/api/timeclock/punch', { at: past, deviceId: 'dev-oi' }, { session: oiCash });
  check('a queued punch is accepted', queued.data.punched === 'in');
  check('it keeps the moment it actually happened, not the moment it synced',
    queued.data.entry.clockIn === past, JSON.stringify({ got: queued.data.entry.clockIn, want: past }));

  const outAt = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
  const out = req('/api/timeclock/punch', { at: outAt, deviceId: 'dev-oi' }, { session: oiCash });
  check('the matching clock-out also keeps its own time', out.data.entry.clockOut === outAt);
  check('the hours worked are computed from those times, not from sync time',
    out.data.entry.minutes === 120, String(out.data.entry.minutes));

  check('a nonsense timestamp falls back to now rather than corrupting the record',
    req('/api/timeclock/punch', { at: 'not-a-date', deviceId: 'dev-oi' }, { session: oiCash })
      .data.entry.clockIn.length > 0);
}

{
  section('repair tickets (v1.31.0)');

  check('ticket numbers are Orison-R padded to six',
    sandbox.formatTicketNo_(1) === 'Orison-R000001', sandbox.formatTicketNo_(1));
  check('ticket numbers keep their width at four digits',
    sandbox.formatTicketNo_(1234) === 'Orison-R001234', sandbox.formatTicketNo_(1234));

  const rpT1 = sandbox.reserveTicketNumber_();
  const rpT2 = sandbox.reserveTicketNumber_();
  check('reserved ticket numbers are sequential and gap-free',
    rpT2 === sandbox.formatTicketNo_(Number(rpT1.slice(-6)) + 1), rpT1 + ' ' + rpT2);

  check('every status in the flow is declared',
    sandbox.REPAIR_STATUSES.length === 9
    && sandbox.REPAIR_STATUSES.indexOf('intake') === 0
    && sandbox.REPAIR_STATUSES.indexOf('collected') >= 0,
    JSON.stringify(sandbox.REPAIR_STATUSES));
  check('the four terminal statuses are marked terminal',
    sandbox.REPAIR_TERMINAL.collected === 1
    && sandbox.REPAIR_TERMINAL.unrepairable === 1
    && sandbox.REPAIR_TERMINAL.cancelled === 1
    && sandbox.REPAIR_TERMINAL.voided === 1
    && !sandbox.REPAIR_TERMINAL.ready,
    JSON.stringify(sandbox.REPAIR_TERMINAL));

  const rpAdm = req('/api/login', { email: 'tariq@example.com', pin: CREDS['tariq@example.com'] }).data.token;
  const rpCash = req('/api/login', { email: 'amara@example.com', pin: '135791' }).data.token;
  const rpCashId = req('/api/admin/users/list', {}, { session: rpAdm }).data.users
    .find((u) => u.email === 'amara@example.com').id;

  const made = req('/api/repairs', {
    customerName: 'Priya Sharma', customerPhone: '07700 900123',
    deviceMake: 'Apple', deviceModel: 'iPhone 13', deviceSerial: '356789104523901',
    reportedFault: 'Screen cracked, touch dead bottom third',
    conditionNote: 'Deep scratch on back glass, corner dented',
    accessories: 'Case, no SIM tray tool',
  }, { session: rpCash });

  check('a cashier can take a repair in', made.ok === true, JSON.stringify(made.data));
  check('it comes back with a ticket number',
    /^Orison-R[0-9]{6}$/.test(made.data.ticketNo), made.data.ticketNo);
  check('a new ticket starts at intake', made.data.status === 'intake', made.data.status);

  check('a device is required',
    req('/api/repairs', { customerName: 'X', reportedFault: 'broken' }, { session: rpCash }).status === 400);
  check('a reported fault is required',
    req('/api/repairs', { customerName: 'X', deviceMake: 'Apple' }, { session: rpCash }).status === 400);
  check('some way to reach the customer is required',
    req('/api/repairs', { deviceMake: 'Apple', reportedFault: 'broken' }, { session: rpCash }).status === 400);

  check('taking a repair in is audited',
    req('/api/audit', {}, { session: rpAdm, params: { action: 'repair.created' } }).data.entries.length === 1);

  const rpList = req('/api/repairs', {}, { session: rpCash }).data;
  check('the list comes back', rpList.repairs.length === 1, String(rpList.repairs.length));
  check('a row carries the device as one readable string',
    rpList.repairs[0].device === 'Apple iPhone 13', rpList.repairs[0].device);

  check('a ticket is findable by its number',
    req('/api/repairs', {}, { session: rpCash, params: { q: made.data.ticketNo } }).data.repairs.length === 1);
  check('a ticket is findable by the customer',
    req('/api/repairs', {}, { session: rpCash, params: { q: 'priya' } }).data.repairs.length === 1);
  check('a ticket is findable by the device serial',
    req('/api/repairs', {}, { session: rpCash, params: { q: '356789104523901' } }).data.repairs.length === 1);
  check('a search that matches nothing returns nothing, not everything',
    req('/api/repairs', {}, { session: rpCash, params: { q: 'zzzznope' } }).data.repairs.length === 0);

  check('the list can be filtered by status',
    req('/api/repairs', {}, { session: rpCash, params: { status: 'intake' } }).data.repairs.length === 1
    && req('/api/repairs', {}, { session: rpCash, params: { status: 'ready' } }).data.repairs.length === 0);

  const rpDet = req('/api/repairs/detail', {}, { session: rpCash, params: { id: made.data.id } }).data;
  check('the detail carries the fault and the condition note',
    rpDet.reportedFault.indexOf('Screen cracked') === 0
    && rpDet.conditionNote.indexOf('Deep scratch') === 0, JSON.stringify(rpDet));
  check('the detail carries empty parts and labour to begin with',
    rpDet.parts.length === 0 && rpDet.labour.length === 0);
  check('an unknown ticket is a 404',
    req('/api/repairs/detail', {}, { session: rpCash, params: { id: 'nope' } }).status === 404);
}


console.log('\n-------------------------------------');
console.log(`PASS ${passed}  FAIL ${failed}`);
process.exit(failed ? 1 : 0);