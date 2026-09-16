/* Orison POS demo: the real backend, running in the page.

   backend/Code.gs is the Google Apps Script the shop deploys. This module
   gives it the handful of Google services it calls - Sheets, Script
   Properties, Cache, Lock, Utilities, Drive, Mail, triggers - implemented in
   memory and saved to a storage adapter (localStorage in the browser, a plain
   object in tests). Nothing about the backend is re-implemented: every rule a
   tester sees is the production code deciding.

   The stubs follow tests/backend-sim.mjs, which the release gates already run
   against the same Code.gs. Works in browsers and in Node 20+. */

/* ---------- SHA-256 and HMAC-SHA256, synchronous (Apps Script's are) ---------- */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

export function sha256(bytes) {
  const len = bytes.length;
  const blocks = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(blocks);
  m.set(bytes);
  m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(blocks - 8, Math.floor((len * 8) / 0x100000000));
  dv.setUint32(blocks - 4, (len * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < blocks; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a15 = w[i - 15], a2 = w[i - 2];
      w[i] = (w[i - 16] + (rotr(a15, 7) ^ rotr(a15, 18) ^ (a15 >>> 3)) + w[i - 7] + (rotr(a2, 17) ^ rotr(a2, 19) ^ (a2 >>> 10))) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}

export function hmacSha256(keyBytes, msgBytes) {
  const key = keyBytes.length > 64 ? sha256(keyBytes) : keyBytes;
  const k = new Uint8Array(64);
  k.set(key);
  const inner = new Uint8Array(64 + msgBytes.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) { inner[i] = k[i] ^ 0x36; outer[i] = k[i] ^ 0x5c; }
  inner.set(msgBytes, 64);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const signed = (u8) => Array.from(u8, (x) => (x > 127 ? x - 256 : x));
const unsigned = (arr) => Uint8Array.from(arr, (x) => (x < 0 ? x + 256 : x));
const toBytes = (v) => (typeof v === 'string' ? enc.encode(v) : unsigned(v));

function b64uEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');
}
function b64uDecode(s) {
  let b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const uuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

/* ---------- storage adapters ---------- */

export function memoryStorage(initial) {
  let data = initial || null;
  return { load: () => (data ? JSON.parse(data) : null), save: (state) => { data = JSON.stringify(state); }, clear: () => { data = null; }, raw: () => data };
}

export function localStorageAdapter(key) {
  return {
    load: () => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (_) { return null; } },
    save: (state) => { localStorage.setItem(key, JSON.stringify(state)); },
    clear: () => { try { localStorage.removeItem(key); } catch (_) {} },
  };
}

/* ---------- the runtime ---------- */

function emptyState() {
  return { v: 1, props: {}, cache: {}, books: {}, drive: [], mails: [], triggers: [] };
}

export function createGasRuntime({ source, storage, appToken = 'orison-demo' }) {
  let state = (storage && storage.load()) || emptyState();
  if (!state.props.APP_TOKEN) state.props.APP_TOKEN = appToken;

  /* -- Sheets: a workbook is { name, sheets: { tabName: grid } }, grids are row arrays -- */
  function rangeOf(grid, row, col, numRows, numCols) {
    row -= 1; col -= 1;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const line = [];
          for (let c = 0; c < numCols; c++) {
            const v = grid[row + r] ? grid[row + r][col + c] : undefined;
            line.push(v === undefined || v === null ? '' : v);
          }
          out.push(line);
        }
        return out;
      },
      setValues(rows) {
        for (let r = 0; r < rows.length; r++) {
          while (grid.length <= row + r) grid.push([]);
          for (let c = 0; c < numCols; c++) {
            const v = rows[r] != null ? rows[r][c] : undefined;
            grid[row + r][col + c] = v === undefined ? '' : v;
          }
        }
        return this;
      },
      setValue(v) {
        while (grid.length <= row) grid.push([]);
        grid[row][col] = v;
        return this;
      },
    };
  }
  function sheetHandle(book, name) {
    const grid = book.sheets[name];
    return {
      getName: () => name,
      getLastRow: () => grid.length,
      getRange: (r, c, nr, nc) => rangeOf(grid, r, c, nr || 1, nc || 1),
      getDataRange() {
        const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
        return rangeOf(grid, 1, 1, Math.max(grid.length, 1), cols || 1);
      },
      setFrozenRows() { return this; },
    };
  }
  function bookHandle(id) {
    const book = state.books[id];
    return {
      getId: () => id,
      getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id + '/edit',
      getName: () => book.name,
      getSheetByName: (n) => (book.sheets[n] ? sheetHandle(book, n) : null),
      insertSheet(n) { book.sheets[n] = book.sheets[n] || []; return sheetHandle(book, n); },
    };
  }
  const SpreadsheetApp = {
    create(name) {
      const id = 'demo-' + uuid().replace(/-/g, '');
      state.books[id] = { name: String(name), sheets: {} };
      return bookHandle(id);
    },
    openById(id) {
      if (!state.books[id]) throw new Error('Spreadsheet not found: ' + id);
      return bookHandle(id);
    },
  };

  /* -- Drive: files kept in state; a CSV export can be opened as a download in the browser -- */
  function fileHandle(f) {
    return {
      getId: () => f.id,
      getName: () => f.name,
      getUrl: () => {
        if (f.content != null && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
          try { return URL.createObjectURL(new Blob([f.content], { type: f.mime || 'text/plain' })); } catch (_) {}
        }
        return 'https://drive.google.com/file/d/' + f.id;
      },
      setTrashed: (v) => { f.trashed = !!v; },
      makeCopy: (name, folder) => {
        const copy = { id: 'demo-file-' + uuid(), name, folderId: folder.getId(), trashed: false, backup: true, createdAt: new Date().toISOString() };
        state.drive.push(copy);
        return fileHandle(copy);
      },
    };
  }
  function folderHandle(folder) {
    return {
      getId: () => folder.id,
      getName: () => folder.name,
      createFile: (name, content, mime) => {
        const f = { id: 'demo-file-' + uuid(), name, content: String(content), mime, folderId: folder.id, createdAt: new Date().toISOString() };
        state.drive.push(f);
        /* keep the demo's saved state small: only the latest exports keep their contents */
        const withContent = state.drive.filter((x) => x.content != null);
        if (withContent.length > 10) withContent[0].content = null;
        return fileHandle(f);
      },
      getFilesByType: () => {
        const mine = state.drive.filter((x) => x.folderId === folder.id && x.backup && !x.trashed);
        let i = 0;
        return { hasNext: () => i < mine.length, next: () => fileHandle(mine[i++]) };
      },
    };
  }
  function folders() { return state.drive.filter((x) => x.folder); }
  const DriveApp = {
    getFolderById(id) {
      const f = folders().find((x) => x.id === id);
      if (!f) throw new Error('Folder not found: ' + id);
      return folderHandle(f);
    },
    getFoldersByName(name) {
      const hits = folders().filter((x) => x.name === name);
      let i = 0;
      return { hasNext: () => i < hits.length, next: () => folderHandle(hits[i++]) };
    },
    createFolder(name) {
      const f = { id: 'demo-folder-' + uuid(), name: String(name), folder: true };
      state.drive.push(f);
      return folderHandle(f);
    },
    getFileById: (id) => fileHandle({ id, name: 'Orison POS (demo workbook)' }),
  };

  const Utilities = {
    sleep: () => {},
    getUuid: uuid,
    Charset: { UTF_8: 'UTF-8' },
    DigestAlgorithm: { SHA_256: 'SHA-256' },
    base64EncodeWebSafe: (v) => b64uEncode(toBytes(v)),
    base64DecodeWebSafe: (s) => signed(b64uDecode(s)),
    newBlob: (bytes) => ({ getDataAsString: () => dec.decode(unsigned(bytes)) }),
    computeDigest: (algo, str) => signed(sha256(toBytes(String(str)))),
    computeHmacSha256Signature: (message, key) => signed(hmacSha256(toBytes(key), toBytes(message))),
  };

  const sandbox = {
    Logger: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (Object.prototype.hasOwnProperty.call(state.props, k) ? state.props[k] : null),
        setProperty: (k, v) => { state.props[k] = String(v); },
        deleteProperty: (k) => { delete state.props[k]; },
        getProperties: () => ({ ...state.props }),
      }),
    },
    Utilities,
    SpreadsheetApp,
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: {
      getScriptCache: () => ({
        put: (k, v, ttl) => { state.cache[k] = { v: String(v), exp: Date.now() + (Number(ttl) || 600) * 1000 }; },
        get: (k) => { const e = state.cache[k]; if (!e) return null; if (e.exp < Date.now()) { delete state.cache[k]; return null; } return e.v; },
        remove: (k) => { delete state.cache[k]; },
      }),
    },
    MailApp: {
      sendEmail: (opts) => {
        state.mails.push({ to: opts && opts.to, subject: opts && opts.subject, at: new Date().toISOString() });
        if (state.mails.length > 50) state.mails.shift();
      },
    },
    DriveApp,
    MimeType: { CSV: 'text/csv', JSON: 'application/json', GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (str) => {
        const out = { _text: str, getContent: () => str };
        out.setMimeType = () => out;
        return out;
      },
    },
    ScriptApp: {
      getProjectTriggers: () => state.triggers.map((t) => ({ getHandlerFunction: () => t.fn, _t: t })),
      deleteTrigger: (h) => { state.triggers = state.triggers.filter((t) => t !== h._t); },
      newTrigger: (fn) => {
        const t = { fn: String(fn) };
        const b = {
          timeBased: () => b, atHour: (x) => { t.hour = x; return b; }, everyDays: (x) => { t.days = x; return b; },
          everyHours: (x) => { t.hours = x; return b; }, everyWeeks: (x) => { t.weeks = x; return b; },
          onWeekDay: (x) => { t.weekDay = x; return b; }, everyMinutes: (x) => { t.minutes = x; return b; },
          create: () => { state.triggers.push(t); return { getHandlerFunction: () => t.fn, _t: t }; },
        };
        return b;
      },
    },
  };

  const names = Object.keys(sandbox);
  /* Code.gs's top-level functions become locals of this wrapper, so nothing
     leaks onto the page; `__call` reaches any of them by name. */
  // eslint-disable-next-line no-new-func
  const factory = new Function(...names,
    source + '\n;return { doPost: doPost, __call: function (n, args) { return eval(n).apply(null, args || []); }, __get: function (n) { return eval(n); } };');
  const gas = factory(...names.map((n) => sandbox[n]));

  function save() { if (storage) storage.save(state); }

  return {
    /* one backend request: the same envelope the app posts to Apps Script */
    handle(envelope) {
      const body = Object.assign({}, envelope, { appToken: state.props.APP_TOKEN });
      const out = gas.doPost({ postData: { contents: JSON.stringify(body) } });
      save();
      return JSON.parse(out.getContent());
    },
    call(name, ...args) { const r = gas.__call(name, args); save(); return r; },
    get: (name) => gas.__get(name),
    state: () => state,
    save,
    appToken: () => state.props.APP_TOKEN,
    reset() { state = emptyState(); state.props.APP_TOKEN = appToken; if (storage && storage.clear) storage.clear(); },
    book: (id) => state.books[id] || null,
  };
}
