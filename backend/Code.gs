/* Orison POS - Google Apps Script backend.
 *
 * The PWA talks to this script via a Web App deployment. Every request is a
 * POST with a JSON body:  { action, method, params, payload, appToken, session }
 *   - action   : API path, e.g. "/api/login", "/api/sync/push"
 *   - method   : "GET" | "POST" (ignored; routing is by action)
 *   - params   : query-string params (e.g. { limit: "100" })
 *   - payload  : body object
 *   - appToken : shared app token (Script Properties APP_TOKEN)
 *   - session  : signed session token from /api/login (skipped on login)
 *
 * Response envelope:  { ok:true, data:{...} }  or  { ok:false, status, error }
 *
 * Storage: a Google Sheets workbook with tabs Meta, Users, Products, Serials,
 * Transactions, Conflicts, Devices, Customers, Shifts, Suppliers,
 * PurchaseOrders, PriceHistory. Set SPREADSHEET_ID in Script Properties to
 * reuse a workbook; otherwise one is created on first request. A "Orison POS
 * Export" Drive folder holds CSV exports.
 */

/* ------------------------------------------------------------------ *
 *  Entry points
 * ------------------------------------------------------------------ */

function doGet() {
  return ok_({ name: 'orison-pos', status: 'ok' });
}

function doPost(e) {
  var startMs = Date.now();
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents || '{}');
    }

    var appToken = String(PropertiesService.getScriptProperties().getProperty('APP_TOKEN') || '');
    if (!body.appToken || body.appToken !== appToken) {
      throw statusError_(401, 'Invalid app token');
    }

    var action = String(body.action || '');
    var payload = body.payload || {};
    var params = body.params || {};

    var session = null;
    if (action !== '/api/login') {
      session = verifyToken_(body.session);
      if (!session) throw statusError_(401, 'Session expired - sign in again');
    }

    ensureSeed_();

    var data = dispatch_(action, session, payload, params);
    return ok_(data);
  } catch (err) {
    return fail_(err, startMs);
  }
}

function dispatch_(action, session, payload, params) {
  switch (action) {
    case '/api/login':           return login_(payload);
    case '/api/config':          return config_();
    case '/api/products':        return products_(session);
    case '/api/sync/pull':       return syncPull_(session, params);
    case '/api/sync/push':       return syncPush_(session, payload);
    case '/api/transactions':    return transactions_(session, params);
    case '/api/customers':       return customers_(session, payload, params);
    case '/api/customers/ledger': return customerLedger_(session, params);
    case '/api/customers/statement': return customerStatement_(session, params);
    case '/api/customers/receivables': return receivables_(session);
    case '/api/reports':         return reports_(session, params);
    case '/api/shifts':          return shifts_(session, params);
    case '/api/shifts/open':     return shiftOpen_(session, payload);
    case '/api/shifts/close':    return shiftClose_(session, payload);
    case '/api/conflicts':       return conflicts_(session, params);
    case '/api/conflicts/review': return reviewConflict_(session, payload);
    case '/api/admin/unlock':    return adminUnlock_(session, payload);
    case '/api/admin/pin':       return adminSetPin_(session, payload);
    case '/api/admin/revoke':    return adminRevoke_(session, payload);
    case '/api/admin/devices':   return adminDevices_(session, payload);
    case '/api/admin/revoke-device': return adminRevokeDevice_(session, payload);
    case '/api/pin':             return changeOwnPin_(session, payload);
    case '/api/admin/users':     return adminUsers_(session, payload);
    case '/api/admin/users/list': return adminUsersList_(session);
    case '/api/admin/users/patch': return adminUserPatch_(session, payload);
    case '/api/logout':          return logout_(session);
    case '/api/admin/products':  return adminProducts_(session, payload);
    case '/api/admin/customers': return adminCustomers_(session, payload);
    case '/api/admin/serials':   return adminSerials_(session, payload);
    case '/api/admin/inventory': return adminInventory_(session, payload);
    case '/api/admin/products/patch': return adminProductsPatch_(session, payload);
    case '/api/admin/store':   return adminStore_(session, payload);
    case '/api/suppliers':      return suppliers_(session, payload);
    case '/api/purchase-orders': return purchaseOrders_(session, payload);
    case '/api/purchase-orders/detail': return purchaseOrderDetail_(session, params);
    case '/api/purchase-orders/receive': return purchaseOrderReceive_(session, payload);
    case '/api/purchase-orders/cancel': return purchaseOrderCancel_(session, payload);
    case '/api/drive/export':    return driveExport_(session, payload, params);
    case '/api/price-history':   return priceHistory_(session, params);
    case '/api/inventory/aging': return inventoryAging_(session);
    default:
      throw statusError_(404, 'Unknown action: ' + action);
  }
}

function ok_(data) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function fail_(err, startMs) {
  var status = (err && err.__status) || 500;
  var message = (err && err.message) || 'Internal error';
  if (status >= 500) {
    try { Logger.log('[orison-pos] ' + status + ': ' + message + ((err && err.stack) || '')); } catch (_) {}
  }
  var res = { ok: false, status: status, error: message };
  if (err && err.__data) res.data = err.__data;
  res.rtMs = Date.now() - startMs;
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function statusError_(status, message, data) {
  var e = new Error(message);
  e.__status = status;
  if (data) e.__data = data;
  return e;
}

function requireRole_(session, roles) {
  if (!session || roles.indexOf(session.role) === -1) {
    throw statusError_(403, 'Not authorized for this action');
  }
}

/* ------------------------------------------------------------------ *
 *  Session tokens (HMAC-SHA256, base64url payload, exp 12h)
 * ------------------------------------------------------------------ */

function sessionSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('SESSION_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', secret);
  }
  return secret;
}

function signToken_(payload) {
  var body = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  return body + '.' + hmacHex_(sessionSecret_(), body);
}

function verifyToken_(token) {
  try {
    var parts = String(token || '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    var expect = hmacHex_(sessionSecret_(), parts[0]);
    if (parts[1].length !== expect.length) return null;
    var diff = 0;
    for (var i = 0; i < parts[1].length; i++) diff |= parts[1].charCodeAt(i) ^ expect.charCodeAt(i);
    if (diff) return null;
    var payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    if (isTokenRevoked_(payload.uid, payload.iat)) return null;
    // Tokens issued with a device id (v1.2.4+) can be killed per terminal.
    // Older tokens carry no dev claim and stay per-user revocable only.
    if (payload.dev && isDeviceTokenRevoked_(payload.uid, payload.dev, payload.iat)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function hmacHex_(secret, message) {
  return Utilities.computeHmacSha256Signature(message, secret, Utilities.Charset.UTF_8)
    .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); })
    .join('');
}

function sha256Hex_(str) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8)
    .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); })
    .join('');
}

/* ------------------------------------------------------------------ *
 *  Token revocation
 *
 *  Tokens are stateless HMAC-SHA256 with a 12 h expiry.  To invalidate
 *  sessions without rotating SESSION_SECRET, we store "revoked at"
 *  timestamps in CacheService (25 h TTL, matching the worst-case token
 *  lifetime).  verifyToken_ rejects any token whose iat predates the
 *  marker — per user (kills every session) or per device (kills just
 *  one lost terminal).
 * ------------------------------------------------------------------ */

var TOKEN_CACHE_PREFIX = 'tok_rev_';
var TOKEN_DEVICE_CACHE_PREFIX = 'tok_dev_';
var TOKEN_CACHE_TTL = 25 * 60 * 60;  // 25 hours (longer than 12 h max token life)

function cache_() { return CacheService.getScriptCache(); }

function revokeTokensForUser_(uid) {
  cache_().put(TOKEN_CACHE_PREFIX + uid, String(Date.now()), TOKEN_CACHE_TTL);
}

function tokenRevokedAt_(uid) {
  var val = cache_().get(TOKEN_CACHE_PREFIX + uid);
  return val ? Number(val) : 0;
}

function isTokenRevoked_(uid, iat) {
  // <= so a revocation marker written in the same millisecond as a login still
  // invalidates that token (fail closed; login and revoke are never genuinely
  // simultaneous in practice).
  return iat != null && iat <= tokenRevokedAt_(uid);
}

/* Per-device markers.  The cache key hashes the device id so the store never
   becomes a list of device identifiers. */
function deviceCacheKey_(uid, deviceId) {
  return TOKEN_DEVICE_CACHE_PREFIX + uid + '_' + sha256Hex_(String(deviceId || '')).slice(0, 16);
}

function revokeDeviceTokens_(uid, deviceId) {
  cache_().put(deviceCacheKey_(uid, deviceId), String(Date.now()), TOKEN_CACHE_TTL);
}

function deviceTokenRevokedAt_(uid, deviceId) {
  var val = cache_().get(deviceCacheKey_(uid, deviceId));
  return val ? Number(val) : 0;
}

function isDeviceTokenRevoked_(uid, deviceId, iat) {
  return iat != null && iat <= deviceTokenRevokedAt_(uid, deviceId);
}

/* ------------------------------------------------------------------ *
 *  Device registry
 *
 *  The Devices sheet records which terminal ids a user signs in from, so
 *  an admin can see the fleet and kill just the one that was lost.  When
 *  a device row is flagged revoked, that device can no longer acquire a
 *  token — not even after the 25 h cache marker expires — until an admin
 *  scrubs the flag (restoring no sessions; the user just signs in
 *  afresh).
 * ------------------------------------------------------------------ */

function deviceRow_(uid, deviceId) {
  var rows = readRows_('Devices', DEVICE_HEADERS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].user_id) === String(uid) && String(rows[i].device_id) === String(deviceId)) {
      return rows[i];
    }
  }
  return null;
}

/* Register (or refresh) the device row for a user.  ifStaleMs > 0 makes the
   write conditional so a busy pull path does not rewrite a row that was
   touched moments ago. */
function touchDevice_(uid, deviceId, ifStaleMs) {
  if (!deviceId) return;
  var row = deviceRow_(uid, deviceId);
  var nowIso = new Date().toISOString();
  if (row) {
    if (ifStaleMs) {
      var last = Date.parse(String(row.last_seen || ''));
      if (!isNaN(last) && Date.now() - last < ifStaleMs) return;
    }
    applyPatches_('Devices', DEVICE_HEADERS, 'id', { [row.id]: { last_seen: nowIso } });
  } else {
    appendRows_('Devices', DEVICE_HEADERS, [{
      id: Utilities.getUuid(),
      user_id: uid,
      device_id: deviceId,
      first_seen: nowIso,
      last_seen: nowIso,
      revoked: 0,
    }]);
  }
}

function isDeviceRevoked_(uid, deviceId) {
  var row = deviceRow_(uid, deviceId);
  return row != null && String(row.revoked) === '1';
}

function setDeviceRevoked_(uid, deviceId, revoked) {
  var row = deviceRow_(uid, deviceId);
  if (row) applyPatches_('Devices', DEVICE_HEADERS, 'id', { [row.id]: { revoked: revoked ? 1 : 0 } });
}

function markAllDevicesRevoked_(uid) {
  var rows = readRows_('Devices', DEVICE_HEADERS);
  var patch = {};
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].user_id) === String(uid) && String(rows[i].revoked) !== '1') {
      patch[rows[i].id] = { revoked: 1 };
    }
  }
  applyPatches_('Devices', DEVICE_HEADERS, 'id', patch);
}

/* ------------------------------------------------------------------ *
 *  Workbook layout
 * ------------------------------------------------------------------ */

var META_HEADERS    = ['key', 'value'];
var USER_HEADERS    = ['id', 'store_id', 'first_name', 'last_name', 'email', 'pin_salt', 'pin_hash', 'role', 'active', 'created_at'];
var DEVICE_HEADERS  = ['id', 'user_id', 'device_id', 'first_seen', 'last_seen', 'revoked'];
var PRODUCT_HEADERS = ['id', 'sku', 'upc', 'name', 'category', 'cost_price', 'retail_price', 'is_serialized', 'on_hand', 'item_type', 'locked', 'reorder_point', 'last_sold_at', 'active', 'updated_at', 'taxable'];
var SERIAL_HEADERS  = ['id', 'product_id', 'serial_number', 'status', 'tx_id', 'updated_at'];
var TX_HEADERS      = ['id', 'store_id', 'user_id', 'device_id', 'client_tx_id', 'kind', 'original_client_tx', 'counterparty', 'grand_total', 'status', 'tenders_json', 'items_json', 'note', 'created_at', 'subtotal', 'tax_amount', 'discount_pct', 'customer_id'];
var CUSTOMERS_HEADERS = ['id', 'store_id', 'name', 'phone', 'email', 'note', 'created_at'];
var SHIFTS_HEADERS    = ['id', 'store_id', 'user_id', 'device_id', 'opened_at', 'closed_at', 'opening_float', 'cash_expected', 'cash_declared', 'over_short', 'tenders_json', 'note', 'status'];
var CONFLICT_HEADERS = ['id', 'store_id', 'type', 'serial_number', 'device_id', 'loser_client_tx', 'winner_tx_id', 'summary', 'status', 'created_at', 'reviewed_at', 'reviewed_by', 'dedupe_key'];
var SUPPLIER_HEADERS = ['id', 'store_id', 'name', 'phone', 'email', 'address', 'payment_terms', 'active', 'created_at'];
var PO_HEADERS = ['id', 'store_id', 'supplier_id', 'po_number', 'order_date', 'expected_date', 'status', 'items_json', 'received_json', 'subtotal', 'discount_pct', 'tax_amount', 'total', 'note', 'created_by', 'created_at', 'updated_at'];
var PRICE_HISTORY_HEADERS = ['id', 'store_id', 'product_id', 'product_name', 'field', 'old_value', 'new_value', 'source', 'po_id', 'changed_by', 'created_at'];

/* Append a price-change event (cost or retail) to the PriceHistory tab. Called
 * from product create (baseline), product patch, and PO receiving (weighted
 * cost updates). Values are stored as numbers so the sheet stays queryable. */
function recordPriceChange_(product, field, oldValue, newValue, source, po, changedBy) {
  appendRows_('PriceHistory', PRICE_HISTORY_HEADERS, [{
    id: Utilities.getUuid(),
    store_id: getStore_().id,
    product_id: String(product.id),
    product_name: String(product.name || ''),
    field: field,
    old_value: oldValue,
    new_value: newValue,
    source: source,
    po_id: po && po.id ? String(po.id) : '',
    changed_by: String(changedBy || ''),
    created_at: new Date().toISOString(),
  }]);
}

function spreadSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  var ss = null;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (_) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('Orison POS');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  return ss;
}

function sheet_(name, headers) {
  var ss = spreadSheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers.slice()]);
      sh.setFrozenRows(1);
    }
  } else if (headers) {
    /* migration: a schema bump appends any new columns to the existing header
       row so readRows_/appendRows_/applyPatches_ keep mapping correctly. */
    var existing = sh.getDataRange().getValues();
    var haveRow = existing.length ? (existing[0] || []) : [];
    var haveLen = 0;
    for (var hx = 0; hx < haveRow.length; hx++) {
      if (String(haveRow[hx] == null ? '' : haveRow[hx]).length) haveLen = hx + 1;
    }
    var toAdd = [];
    for (var h = haveLen; h < headers.length; h++) toAdd.push(headers[h]);
    if (toAdd.length) {
      sh.getRange(1, haveLen + 1, 1, toAdd.length).setValues([toAdd]);
    }
  }
  return sh;
}

function readRows_(name, headers) {
  var sh = sheet_(name, headers);
  var values = sh.getDataRange().getValues();
  if (!values.length) return [];
  var hdrs = [];
  for (var i = 0; i < values[0].length; i++) hdrs.push(String(values[0][i]));
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.length === 1 && row[0] === '') continue;
    var o = {};
    for (var c = 0; c < hdrs.length; c++) o[hdrs[c]] = row[c];
    out.push(o);
  }
  return out;
}

function appendRows_(name, headers, objs) {
  if (!objs.length) return;
  var sh = sheet_(name, headers);
  var rows = objs.map(function (o) { return headers.map(function (h) { return o[h] == null ? '' : o[h]; }); });
  var start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, headers.length).setValues(rows);
}

function applyPatches_(name, headers, idCol, idToPatch) {
  var keys = Object.keys(idToPatch);
  if (!keys.length) return;
  var sh = sheet_(name, headers);
  var values = sh.getDataRange().getValues();
  var indexRow = {};
  for (var i = 1; i < values.length; i++) indexRow[String(values[i][0])] = i;
  var colById = {};
  for (var j = 0; j < headers.length; j++) colById[headers[j]] = j;
  for (var k = 0; k < keys.length; k++) {
    var row = indexRow[String(keys[k])];
    if (row == null) continue;
    var patch = idToPatch[keys[k]];
    for (var field in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
      var col = colById[field];
      if (col == null) continue;
      sh.getRange(row + 1, col + 1).setValue(patch[field]);
    }
  }
}

function kv_() {
  var rows = readRows_('Meta', META_HEADERS);
  var out = {};
  for (var i = 0; i < rows.length; i++) out[String(rows[i].key)] = rows[i].value;
  return out;
}

function setKv_(key, value) {
  var sh = sheet_('Meta', META_HEADERS);
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === key) {
      sh.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([[key, value]]);
}

function getStore_() {
  var k = kv_();
  return {
    id: String(k.store_id || ''),
    code: String(k.store_code || ''),
    name: String(k.store_name || 'Orison Electronics'),
    address: String(k.store_address || ''),
    phone: String(k.store_phone || ''),
    /* single store-level sales tax, as a percent. Missing kv (pre-1.2.6
       sheets) reads as 0 so older sales stay untaxed. */
    taxRate: k.store_tax_rate == null || k.store_tax_rate === '' ? 0 : num_(k.store_tax_rate),
  };
}

/* ------------------------------------------------------------------ *
 *  Seed
 * ------------------------------------------------------------------ */

/* Starter accounts. NO PINs here: a PIN committed to the repository is a
 * published credential, and this repository is public. seed_() generates a
 * random 6-digit PIN for each account and reports it once — read them from the
 * Apps Script execution log (View > Executions) right after the first run, hand
 * them to staff, and have each person change theirs. Addresses use example.com
 * so committed fixtures never name a real mailbox. */
var SEED_USERS = [
  { first_name: 'Tariq', last_name: 'Al-Sayed', email: 'tariq@example.com', role: 'admin' },
  { first_name: 'Sarah', last_name: 'Lindqvist', email: 'sarah@example.com', role: 'manager' },
  { first_name: 'Amara', last_name: 'Njoku', email: 'amara@example.com', role: 'cashier' },
  { first_name: 'Diego', last_name: 'Ramirez', email: 'diego@example.com', role: 'cashier' },
];

/* Plaintext PINs from the most recent seed_() in THIS execution, so the deploy
 * step can print them once. Apps Script discards globals between executions, so
 * this never outlives the run that created it and is never written to a sheet. */
var SEED_CREDENTIALS = [];

/* Random hex nibbles from v4 UUIDs, skipping the two positions RFC 4122 fixes.
 * With dashes removed, index 12 is always the version '4' and index 16 is the
 * variant (8/9/a/b); harvesting digits without excluding them skews the result
 * badly — measured over 200k samples, a PIN built from the raw digits of a UUID
 * ends in '4' 17% of the time instead of 10%. */
function randomNibbles_(count) {
  var out = [];
  while (out.length < count) {
    var hex = Utilities.getUuid().replace(/-/g, '');
    for (var i = 0; i < hex.length; i++) {
      if (i === 12 || i === 16) continue; // version / variant: not random
      out.push(parseInt(hex.charAt(i), 16));
    }
  }
  return out.slice(0, count);
}

/* A uniform 6-digit PIN. 100x the keyspace of the 4-digit PINs this replaces.
 * Rejection sampling, because 2^24 is not a multiple of 1,000,000 and a plain
 * modulo would make the low values slightly more likely. */
function randomPin_() {
  var LIMIT = 16000000; // largest multiple of 1e6 that fits in 24 bits
  for (var attempt = 0; attempt < 64; attempt++) {
    var n = randomNibbles_(6);
    var value = 0;
    for (var i = 0; i < 6; i++) value = value * 16 + n[i];
    if (value < LIMIT) {
      var pin = String(value % 1000000);
      while (pin.length < 6) pin = '0' + pin;
      return pin;
    }
  }
  throw new Error('randomPin_: exhausted retries');
}

/* Port of server/seed.js catalog (42 products). Serialized products list
 * IMEIs/serials; non-serialized carry a qty. */
var SEED_PRODUCTS = [
  { sku: 'PH-S24U-256', upc: '0012345620011', name: 'Samsung Galaxy S24 Ultra 256GB', category: 'Phones', cost: 1199, retail: 1299, serials: ['359999001234567', '359999001234568', '359999001234569', '359999001234570'] },
  { sku: 'PH-S24-128', upc: '0012345620028', name: 'Samsung Galaxy S24 128GB', category: 'Phones', cost: 799, retail: 899, serials: ['359999002345671', '359999002345672', '359999002345673'] },
  { sku: 'PH-IP15-128', upc: '0012345620035', name: 'Apple iPhone 15 128GB', category: 'Phones', cost: 799, retail: 849, serials: ['359999003456782', '359999003456783'] },
  { sku: 'PH-IP15PM-256', upc: '0012345620042', name: 'Apple iPhone 15 Pro Max 256GB', category: 'Phones', cost: 1099, retail: 1199, serials: ['359999004567893', '359999004567894', '359999004567895'] },
  { sku: 'PH-G62-128', upc: '0012345620059', name: 'Google Pixel 8a 128GB', category: 'Phones', cost: 399, retail: 499, serials: ['359999005678904', '359999005678905', '359999005678906', '359999005678907'] },
  { sku: 'PH-RN13-128', upc: '0012345620066', name: 'Samsung Galaxy A15 128GB', category: 'Phones', cost: 169, retail: 219, serials: ['359999006789015', '359999006789016'] },
  { sku: 'TB-IPAD10-64', upc: '0012345620073', name: 'Apple iPad 10th Gen 64GB', category: 'Tablets', cost: 329, retail: 399, serials: ['359999007890126', '359999007890127'] },
  { sku: 'TB-S9-128', upc: '0012345620080', name: 'Samsung Galaxy Tab S9 128GB', category: 'Tablets', cost: 699, retail: 799, serials: ['359999008901237'] },
  { sku: 'LT-MBA-M2-256', upc: '0012345620097', name: 'Apple MacBook Air M2 256GB', category: 'Laptops', cost: 999, retail: 1099, serials: ['C02XK1234567'] },
  { sku: 'LT-X13-16', upc: '0012345620103', name: 'Lenovo ThinkPad X13 Gen4', category: 'Laptops', cost: 949, retail: 1049, serials: ['PF3XK9A2'] },
  { sku: 'LT-G14-512', upc: '0012345620110', name: 'ASUS ROG Zephyrus G14', category: 'Laptops', cost: 1249, retail: 1399, serials: ['N5RQ9XG3'] },
  { sku: 'AU-WF1000XM5', upc: '0012345620127', name: 'Sony WF-1000XM5 Earbuds', category: 'Audio', cost: 220, retail: 299, qty: 8 },
  { sku: 'AU-AIRPODS3', upc: '0012345620134', name: 'Apple AirPods 3rd Gen', category: 'Audio', cost: 159, retail: 179, qty: 10 },
  { sku: 'AU-BOSEQC45', upc: '0012345620141', name: 'Bose QuietComfort 45', category: 'Audio', cost: 279, retail: 329, qty: 6 },
  { sku: 'AU-JBLGO4', upc: '0012345620158', name: 'JBL GO 4 Speaker', category: 'Audio', cost: 40, retail: 49, qty: 15 },
  { sku: 'WR-APPLE-S9', upc: '0012345620165', name: 'Apple Watch Series 9 45mm', category: 'Wearables', cost: 359, retail: 399, qty: 5 },
  { sku: 'WR-GW6', upc: '0012345620172', name: 'Samsung Galaxy Watch 6', category: 'Wearables', cost: 259, retail: 299, qty: 5 },
  { sku: 'CB-USBC-1M', upc: '0012345620189', name: 'USB-C Cable 1m (braided)', category: 'Cables', cost: 6, retail: 12, qty: 40 },
  { sku: 'CB-LTN-1M', upc: '0012345620196', name: 'Lightning Cable 1m', category: 'Cables', cost: 9, retail: 18, qty: 30 },
  { sku: 'CH-65W-GAN', upc: '0012345620202', name: '65W GaN Wall Charger', category: 'Cables', cost: 18, retail: 32, qty: 25 },
  { sku: 'CH-WIRELESS-15W', upc: '0012345620219', name: '15W Wireless Charging Pad', category: 'Cables', cost: 9, retail: 19, qty: 20 },
  { sku: 'AU-PB-10000', upc: '0012345620226', name: '10000mAh Power Bank', category: 'Cables', cost: 14, retail: 25, qty: 18 },
  { sku: 'ST-SSD-1TB-P5', upc: '0012345620233', name: 'Crucial P5 Plus 1TB NVMe SSD', category: 'Storage', cost: 79, retail: 109, qty: 12 },
  { sku: 'ST-SDCARD-128', upc: '0012345620240', name: 'microSD 128GB U3', category: 'Storage', cost: 13, retail: 22, qty: 25 },
  { sku: 'ST-SDCARD-64', upc: '0012345620257', name: 'microSD 64GB U1', category: 'Storage', cost: 7, retail: 13, qty: 25 },
  { sku: 'GM-DUALSHOCK5', upc: '0012345620264', name: 'DualSense Wireless Controller', category: 'Gaming', cost: 59, retail: 74, qty: 9 },
  { sku: 'GM-PS5SLIM-D', upc: '0012345620271', name: 'PlayStation 5 Slim Disc', category: 'Gaming', cost: 429, retail: 499, serials: ['PS5D000001', 'PS5D000002', 'PS5D000003'] },
  { sku: 'GM-SWITCH-OLED', upc: '0012345620288', name: 'Nintendo Switch OLED', category: 'Gaming', cost: 300, retail: 349, qty: 6 },
  { sku: 'GM-XBOXWIRELESS', upc: '0012345620295', name: 'Xbox Wireless Controller', category: 'Gaming', cost: 49, retail: 59, qty: 9 },
  { sku: 'SH-ECOBEE5', upc: '0012345620301', name: 'Ecobee Smart Thermostat', category: 'Smart Home', cost: 169, retail: 219, qty: 7 },
  { sku: 'SH-HUE-START', upc: '0012345620318', name: 'Philips Hue Starter Kit', category: 'Smart Home', cost: 179, retail: 229, qty: 6 },
  { sku: 'CA-RING-DOORBELL4', upc: '0012345620325', name: 'Ring Video Doorbell 4', category: 'Smart Home', cost: 169, retail: 199, qty: 7 },
  { sku: 'CA-CANON-EOSR50', upc: '0012345620332', name: 'Canon EOS R50 + 18-45mm', category: 'Cameras', cost: 599, retail: 679, serials: ['CE0510123456'] },
  { sku: 'CA-GO3', upc: '0012345620349', name: 'DJI Osmo Pocket 3', category: 'Cameras', cost: 519, retail: 549, qty: 4 },
  { sku: 'NW-ROUTER-AX55', upc: '0012345620356', name: 'TP-Link Archer AX55', category: 'Networking', cost: 89, retail: 119, qty: 8 },
  { sku: 'NW-MESH-EERO6', upc: '0012345620363', name: 'Eero 6 Mesh (3-pack)', category: 'Networking', cost: 164, retail: 199, qty: 4 },
  { sku: 'NW-RS485-CBL', upc: '0012345620370', name: 'Cat6 Ethernet Cable 10m', category: 'Networking', cost: 8, retail: 16, qty: 20 },
  { sku: 'AC-SCREEN-S24U', upc: '0012345620387', name: 'Tempered Glass - Galaxy S24 Ultra', category: 'Accessories', cost: 4, retail: 12, qty: 30 },
  { sku: 'AC-CASE-IP15', upc: '0012345620394', name: 'Silicone Case - iPhone 15', category: 'Accessories', cost: 8, retail: 19, qty: 25 },
  { sku: 'AC-HDMI-2M', upc: '0012345620400', name: 'HDMI 2.1 Cable 2m', category: 'Cables', cost: 10, retail: 24, qty: 20 },
  { sku: 'AC-ADAPTER-LT', upc: '0012345620417', name: 'USB-C Laptop Adapter 100W', category: 'Cables', cost: 28, retail: 49, qty: 15 },
  { sku: 'AC-STAND-LAPTOP', upc: '0012345620424', name: 'Laptop Stand - Aluminum', category: 'Accessories', cost: 15, retail: 29, qty: 12 },
  { sku: 'SRV-REPAIR', upc: '', name: 'Phone Repair - Labor', category: 'Services', retail: 49, qty: 0, service: 1 },
  { sku: 'SRV-SCREEN', upc: '', name: 'Screen Replacement - Labor', category: 'Services', retail: 89, qty: 0, service: 1 },
];

function ensureSeed_() {
  // Cheap gate so the common case does not queue behind whatever holds the
  // script lock — syncPush_ holds it for seconds, and a login stalled that way
  // blows past the client's 8s timeout, which api.js reports as "offline".
  //
  // It reads a Script Property and NOT kv_(): kv_ reaches spreadSheet_, which
  // CREATES the workbook when none exists, so gating on it would move first-run
  // creation outside the lock and let two simultaneous first requests build two
  // workbooks and seed twice — two sets of users with different PINs, and an
  // already-issued token whose uid is absent from whichever workbook survives.
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SEEDED') === '1') return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    // Set the flag for a deployment seeded before it existed, so it too stops
    // taking the lock on every request from here on.
    if (kv_().store_id) { props.setProperty('SEEDED', '1'); return; }
    seed_();
    props.setProperty('SEEDED', '1');
  } finally {
    lock.releaseLock();
  }
}

function seed_() {
  var storeId = Utilities.getUuid();
  setKv_('store_id', storeId);
  setKv_('store_code', 'ORSTN-01');
  setKv_('store_name', 'Orison Electronics - Main Street');
  setKv_('store_address', '12 Main Street');
  setKv_('store_phone', '(555) 010-0101');

  var userRows = [];
  SEED_CREDENTIALS = [];
  for (var i = 0; i < SEED_USERS.length; i++) {
    var u = SEED_USERS[i];
    var pin = randomPin_();
    SEED_CREDENTIALS.push({ email: u.email, pin: pin, role: u.role });
    var salt = Utilities.getUuid().split('-')[0];
    var hash = sha256Hex_(salt + ':' + pin);
    userRows.push({
      id: Utilities.getUuid(),
      store_id: storeId,
      first_name: u.first_name,
      last_name: u.last_name,
      email: u.email,
      pin_salt: salt,
      pin_hash: hash,
      role: u.role,
      active: 1,
      created_at: new Date().toISOString(),
    });
  }
  appendRows_('Users', USER_HEADERS, userRows);

  // Written to the execution log, which Apps Script retains. That makes these
  // starter PINs credentials a second party has seen, so they are a way in for
  // the first day and not a lasting one: staff should change theirs via
  // /api/pin, and an admin can force one via /api/admin/pin. The Users sheet
  // itself only ever holds the salted hash.
  try {
    Logger.log('[orison-pos] seeded users - starter PINs, rotate after handing them out:');
    for (var c = 0; c < SEED_CREDENTIALS.length; c++) {
      Logger.log('[orison-pos]   ' + SEED_CREDENTIALS[c].email +
                 '  PIN ' + SEED_CREDENTIALS[c].pin +
                 '  (' + SEED_CREDENTIALS[c].role + ')');
    }
  } catch (_) {}

  var now = new Date().toISOString();
  var prodRows = [];
  var serialRows = [];
  for (var p = 0; p < SEED_PRODUCTS.length; p++) {
    var pr = SEED_PRODUCTS[p];
    var pid = Utilities.getUuid();
    var serials = pr.serials || [];
    var isSerialized = serials.length > 0 ? 1 : 0;
    var onHand = isSerialized ? serials.length : (pr.qty || 0);
    var isService = pr.service ? 1 : 0;
    prodRows.push({
      id: pid,
      sku: pr.sku,
      upc: pr.upc,
      name: pr.name,
      category: pr.category,
      cost_price: pr.cost || 0,
      retail_price: pr.retail,
      is_serialized: isSerialized,
      on_hand: isService ? 0 : onHand,
      item_type: isService ? 'service' : 'product',
      locked: 0,
      reorder_point: '',
      last_sold_at: '',
      active: 1,
      updated_at: now,
    });
    for (var s = 0; s < serials.length; s++) {
      serialRows.push({
        id: Utilities.getUuid(),
        product_id: pid,
        serial_number: serials[s],
        status: 'IN_STOCK',
        tx_id: '',
        updated_at: now,
      });
    }
  }
  appendRows_('Products', PRODUCT_HEADERS, prodRows);
  appendRows_('Serials', SERIAL_HEADERS, serialRows);
  sheet_('Transactions', TX_HEADERS);
  sheet_('Conflicts', CONFLICT_HEADERS);
  sheet_('Customers', CUSTOMERS_HEADERS);
  sheet_('Shifts', SHIFTS_HEADERS);
  sheet_('Suppliers', SUPPLIER_HEADERS);
  sheet_('PurchaseOrders', PO_HEADERS);
  sheet_('PriceHistory', PRICE_HISTORY_HEADERS);
  appendRows_('Suppliers', SUPPLIER_HEADERS, [{
    id: Utilities.getUuid(),
    store_id: storeId,
    name: 'Swift Supplies',
    phone: '(555) 020-0202',
    email: 'sales@swiftsupplies.example.com',
    address: '9 Industrial Avenue',
    payment_terms: 'Net 30',
    active: 1,
    created_at: now,
  }]);
}

/* ------------------------------------------------------------------ *
 *  Login / config / catalog / sync pull
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 *  Login throttling
 *
 *  A PIN is a small secret — six digits is a million candidates, four was ten
 *  thousand — and this Web App is reachable by anyone with the URL. Without a
 *  cost per attempt an attacker simply enumerates the space, so failures are
 *  counted per account and answered with a growing delay, then a lockout.
 *
 *  Counters live in Script Properties rather than CacheService so a lockout
 *  survives cache eviction, and are keyed by a hash of the email so the
 *  property store never becomes a list of staff addresses.
 * ------------------------------------------------------------------ */

var LOGIN_MAX_FAILURES = 5;
var LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

/* Failures are stored as one property per attempt rather than a counter.
 *
 * A counter needs read-modify-write, which Script Properties does not make
 * atomic, so it needs LockService — and that turned out to be a bad trade on
 * this path: tryLock stalls behind syncPush_, which routinely holds the script
 * lock for seconds, pushing the 401 past the client's 8s timeout, where api.js
 * maps it to err.offline and login.js silently drops the cashier into the
 * offline-PIN fallback. Failing open when the lock could not be taken also
 * meant guesses during contention went uncounted.
 *
 * Appending a uniquely-named marker needs no lock and loses no writes. The one
 * concession is that the gate is read before the marker is written, so a burst
 * arriving together can all pass it; the overshoot is bounded by Apps Script's
 * simultaneous-execution limit and the lockout engages immediately after.
 */
var LOGIN_FAIL_PREFIX = 'lf_';
/* Hard ceiling on stored markers. Script Properties is a bounded store (~500 KB)
 * and every failure against a fresh address mints a key, so without a ceiling a
 * sustained run of bad logins fills it and setProperty starts throwing — taking
 * SESSION_SECRET and SPREADSHEET_ID writes down with it. */
var LOGIN_FAIL_MAX_MARKERS = 1000;
/* Markers kept per account. Five locks an account; the rest is ballast. */
var LOGIN_FAIL_MAX_PER_ACCOUNT = 8;
/* Deletions per request, so a large backlog never stalls one login. */
var LOGIN_FAIL_MAX_DELETES_PER_CALL = 50;

function loginFailPrefix_(email) {
  return LOGIN_FAIL_PREFIX + sha256Hex_(String(email || '').toLowerCase()).slice(0, 16) + '_';
}

function markerTimestamp_(key) {
  var parts = key.split('_');
  return Number(parts[2] || 0);
}

/* Expire markers, keeping storage bounded without releasing anyone's lockout.
 *
 * Two rules, in order:
 *   - per account, keep only the newest few markers. Five is what locks an
 *     account; more than that is just ballast.
 *   - if the store is still over its ceiling, drop whole accounts that are NOT
 *     currently locked, oldest first. Evicting the globally oldest markers
 *     instead would let ~1000 one-off failures against throwaway addresses
 *     delete a locked victim's markers and hand them a clean slate — the
 *     attacker would be using the defence to undo itself.
 *
 * Deletions are capped per request: PropertiesService charges one call per key,
 * and clearing a large backlog in a single login would push it past the 8s
 * client timeout that api.js reports as "offline". The backlog drains across
 * requests instead, which is fine because expiry is already time-based.
 */
function sweepLoginFailures_(props, all) {
  var cutoff = Date.now() - LOGIN_LOCKOUT_MS;
  var budget = LOGIN_FAIL_MAX_DELETES_PER_CALL;
  var byAccount = {};

  function drop(key) {
    if (budget <= 0) return false;
    props.deleteProperty(key);
    delete all[key];
    budget--;
    return true;
  }

  for (var key in all) {
    if (key.indexOf(LOGIN_FAIL_PREFIX) !== 0) continue;
    if (markerTimestamp_(key) < cutoff) {
      drop(key);
      continue;
    }
    var account = key.split('_').slice(0, 2).join('_');
    (byAccount[account] = byAccount[account] || []).push(key);
  }

  var accounts = [];
  var liveCount = 0;
  for (var acct in byAccount) {
    var keys = byAccount[acct];
    keys.sort(function (a, b) { return markerTimestamp_(a) - markerTimestamp_(b); });
    while (keys.length > LOGIN_FAIL_MAX_PER_ACCOUNT && budget > 0) {
      if (!drop(keys[0])) break;
      keys.shift();
    }
    liveCount += keys.length;
    accounts.push({ key: acct, keys: keys, newest: markerTimestamp_(keys[keys.length - 1]) });
  }

  if (liveCount <= LOGIN_FAIL_MAX_MARKERS) return;

  // Over the ceiling: shed unlocked accounts, least recently seen first. A
  // locked account keeps its markers — losing them is what an attacker wants.
  accounts.sort(function (a, b) { return a.newest - b.newest; });
  for (var i = 0; i < accounts.length && liveCount > LOGIN_FAIL_MAX_MARKERS && budget > 0; i++) {
    if (accounts[i].keys.length >= LOGIN_MAX_FAILURES) continue; // locked: keep
    var ks = accounts[i].keys;
    for (var j = 0; j < ks.length && budget > 0; j++) {
      if (drop(ks[j])) liveCount--;
    }
  }
}

/* Live failure marker timestamps for one address, newest last. */
function loginFailureTimes_(email, all) {
  var prefix = loginFailPrefix_(email);
  var cutoff = Date.now() - LOGIN_LOCKOUT_MS;
  var times = [];
  for (var key in all) {
    if (key.indexOf(prefix) !== 0) continue;
    var ts = markerTimestamp_(key);
    if (ts >= cutoff) times.push(ts);
  }
  times.sort(function (a, b) { return a - b; });
  return times;
}

/* Milliseconds remaining on an active lockout, or 0 when not locked out.
 * The window runs from the most recent failure: anchored to the first, an
 * attacker could spread failures across the window and trip the last one just
 * before it elapsed, earning a lockout of a second or two and a clean slate. */
function loginLockoutRemainingMs_(email) {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  sweepLoginFailures_(props, all);
  var times = loginFailureTimes_(email, all);
  if (times.length < LOGIN_MAX_FAILURES) return 0;
  var remaining = LOGIN_LOCKOUT_MS - (Date.now() - times[times.length - 1]);
  return remaining > 0 ? remaining : 0;
}

function recordLoginFailure_(email) {
  var props = PropertiesService.getScriptProperties();
  var key = loginFailPrefix_(email) + Date.now() + '_' +
            Math.floor(Math.random() * 1e6);
  props.setProperty(key, '1');
}

function clearLoginFailures_(email) {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var prefix = loginFailPrefix_(email);
  for (var key in all) {
    if (key.indexOf(prefix) === 0) props.deleteProperty(key);
  }
}

/* Release an account locked out by a mistyped PIN or a deliberate lockout.
 * Also reachable at /api/admin/unlock so a manager can do it from the till —
 * a store cannot wait for someone to open the Apps Script editor mid-shift. */
function clearLoginLockout(email) {
  clearLoginFailures_(email);
  Logger.log('[orison-pos] cleared login lockout for ' + email);
}

function login_(payload) {
  var email = String(payload.email || '').trim().toLowerCase();
  var pin = String(payload.pin || '');
  var deviceId = String(payload.deviceId || '').trim();

  var lockedMs = loginLockoutRemainingMs_(email);
  if (lockedMs > 0) {
    throw statusError_(429, 'Too many failed attempts. Try again in ' +
      Math.ceil(lockedMs / 60000) + ' minute(s).');
  }

  var users = readRows_('Users', USER_HEADERS);
  var found = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email).toLowerCase() === email && String(users[i].active) === '1') {
      found = users[i];
      break;
    }
  }
  if (!found || sha256Hex_(String(found.pin_salt) + ':' + pin) !== String(found.pin_hash)) {
    // Counted, but deliberately NOT delayed. Utilities.sleep bills against the
    // script's daily runtime quota and holds a simultaneous-execution slot, so
    // a delay long enough to matter is itself a way to take the till offline;
    // it also pushed responses past the client's 8s timeout, which api.js maps
    // to "offline" and hides the real error. The attempt cap does the work.
    recordLoginFailure_(email);
    throw statusError_(401, 'Invalid email or PIN');
  }

  // A revoked terminal is refused even with the right PIN: after the 25 h cache
  // marker lapses this is what keeps a lost device from quietly re-logging in.
  // Not a wrong PIN, so it does not count toward the lockout.
  if (deviceId && isDeviceRevoked_(found.id, deviceId)) {
    throw statusError_(403, 'This terminal has been deactivated — ask an admin.');
  }

  clearLoginFailures_(email);
  touchDevice_(found.id, deviceId, 0);
  var token = signToken_({
    uid: found.id,
    role: found.role,
    iat: Date.now(),
    exp: Date.now() + 12 * 60 * 60 * 1000,
    dev: deviceId || undefined,
  });
  return {
    token: token,
    user: userDto_(found),
    store: getStore_(),
    /* A 256-bit per-device credential for offline sign-in. Cataloguing it next
     * to the session token means nothing on the device is derived from the PIN
     * — steal the storage and you get an opaque blob, never the PIN itself. */
    offlineKey: offlineCred_(),
  };
}

/* 256-bit opaque offline credential, issued fresh on every sign-in. Two v4
 * UUIDs (122 bits of entropy each) without dashes give 64 hex chars; it is
 * never stored server-side and carries zero information about the PIN. */
function offlineCred_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function userDto_(u) {
  return {
    id: u.id,
    firstName: u.first_name,
    lastName: u.last_name,
    email: u.email,
    role: u.role,
  };
}

function config_() {
  return {
    store: getStore_(),
    users: readRows_('Users', USER_HEADERS)
      .filter(function (u) { return String(u.active) === '1'; })
      .map(userDto_),
  };
}

function users_() {
  return readRows_('Users', USER_HEADERS)
    .filter(function (u) { return String(u.active) === '1'; })
    .map(userDto_);
}

function products_(session) {
  return productsSnapshot_(session && session.role);
}

function syncPull_(session, params) {
  // Keep the admin's device list live across long-lived sessions: refresh the
  // device row no more than once per 10 minutes per terminal.
  touchDevice_(session.uid, session.dev, 10 * 60 * 1000);
  var cfRows = readRows_('Conflicts', CONFLICT_HEADERS);
  var openConflicts = 0;
  for (var i = 0; i < cfRows.length; i++) {
    if (String(cfRows[i].status) === 'OPEN') openConflicts++;
  }
  return {
    store: getStore_(),
    users: users_(),
    products: productsSnapshot_(session && session.role),
    watermark: new Date().toISOString(),
    requester: session.uid,
    openConflicts: openConflicts,
  };
}

function isStoreRole_(role) {
  return role === 'admin' || role === 'manager';
}

function productsSnapshot_(role) {
  var showCost = isStoreRole_(role);
  var prodRows = readRows_('Products', PRODUCT_HEADERS);
  var serialRows = readRows_('Serials', SERIAL_HEADERS);
  var byProd = {};
  for (var i = 0; i < serialRows.length; i++) {
    if (String(serialRows[i].status) !== 'IN_STOCK') continue;
    var pid = String(serialRows[i].product_id);
    (byProd[pid] = byProd[pid] || []).push(String(serialRows[i].serial_number));
  }
  var out = [];
  for (var j = 0; j < prodRows.length; j++) {
    var p = prodRows[j];
    if (String(p.active) !== '1') continue;
    var isSerialized = String(p.is_serialized) === '1';
    var serials = isSerialized ? (byProd[String(p.id)] || []) : [];
    out.push({
      id: String(p.id),
      sku: String(p.sku),
      upc: String(p.upc),
      name: String(p.name),
      category: String(p.category),
      costPrice: showCost ? num_(p.cost_price) : null,
      retailPrice: num_(p.retail_price),
      isSerialized: isSerialized,
      onHand: isSerialized ? serials.length : num_(p.on_hand),
      serials: serials,
      itemType: String(p.item_type) === 'product' ? 'product' : (String(p.item_type || 'product')),
      locked: String(p.locked) === '1' || Boolean(p.locked),
      reorderPoint: p.reorder_point != null ? num_(p.reorder_point) : '',
      lastSoldAt: String(p.last_sold_at || ''),
      /* pre-1.2.6 rows have no taxable cell; default them to taxable so a
         store that sets tax later doesn't silently exempt older items. */
      taxable: String(p.taxable) === '0' ? false : true,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Sync push — first-committed-wins IMEI claims under a script lock
 * ------------------------------------------------------------------ */

function syncPush_(session, payload) {
  var deviceId = String(payload.deviceId || '');
  var batch = Array.isArray(payload.batch) ? payload.batch : [];
  var results = [];

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    for (var b0 = 0; b0 < batch.length; b0++) {
      results.push({
        clientTxId: batch[b0].clientTxId,
        transactionId: '',
        accepted: false,
        status: 'VOIDED',
        conflicts: [{ reason: 'server_busy' }],
      });
    }
    return { results: results };
  }

  try {
    var txRows = readRows_('Transactions', TX_HEADERS);
    var prodRows = readRows_('Products', PRODUCT_HEADERS);
    var serialRows = readRows_('Serials', SERIAL_HEADERS);
    var userRows = readRows_('Users', USER_HEADERS);
    var customerRows = readRows_('Customers', CUSTOMERS_HEADERS);

    var prodById = {};
    for (var i = 0; i < prodRows.length; i++) prodById[String(prodRows[i].id)] = prodRows[i];
    var serialBySn = {};
    for (var j = 0; j < serialRows.length; j++) serialBySn[String(serialRows[j].serial_number)] = serialRows[j];
    var userIds = {};
    for (var u = 0; u < userRows.length; u++) userIds[String(userRows[u].id)] = userRows[u];
    var customerIds = {};
    for (var cu = 0; cu < customerRows.length; cu++) customerIds[String(customerRows[cu].id)] = customerRows[cu];

    /* idempotency + duplicate-client detection: index existing rows by device+client */
    var deviceTx = {};
    for (var e = 0; e < txRows.length; e++) {
      var ek = String(txRows[e].device_id) + '::' + String(txRows[e].client_tx_id || '');
      if (!deviceTx[ek]) deviceTx[ek] = txRows[e];
    }

    /* open conflict dedupe set */
    var openConflictSet = {};
    var conflictRows = readRows_('Conflicts', CONFLICT_HEADERS);
    for (var cf = 0; cf < conflictRows.length; cf++) {
      if (String(conflictRows[cf].status) === 'OPEN') {
        openConflictSet[String(conflictRows[cf].dedupe_key)] = true;
      }
    }

    var store = getStore_();
    var newTxRows = [];
    var newConflictRows = [];
    var serialPatches = {};
    var productPatches = {};

    var nowMs = Date.now();
    var skewFuture = 15 * 60 * 1000;      /* > 15 min ahead of server clock */
    var skewPast = 90 * 24 * 3600 * 1000; /* older than 90 days */

    for (var bi = 0; bi < batch.length; bi++) {
      var tx = batch[bi];
      var errors = [];
      var resolved = [];
      var items = Array.isArray(tx.items) ? tx.items : [];
      var clientKey = deviceId + '::' + String(tx.clientTxId || '');

      /* duplicate push for the same device+client id? (compare raw content) */
      var existing = deviceTx[clientKey];
      if (existing) {
        var sigSame = txSignature_(items) === txSignature_(itobjs_(existing.items_json))
          && String(existing.grand_total) === String(num_(tx.grandTotal))
          && canonicalJson_(existing.tenders_json) === canonicalJson_(JSON.stringify(tx.tenders || []))
          && String(existing.note || '') === String(tx.note || '');
        if (sigSame) {
          results.push({
            clientTxId: tx.clientTxId,
            transactionId: String(existing.id),
            accepted: true,
            status: 'ALREADY_SYNCED',
            conflicts: [],
          });
          continue;
        }
        var dupId = conflictRow_(openConflictSet, newConflictRows, store, 'DUPLICATE_CLIENT', '',
          deviceId, String(tx.clientTxId || ''), String(existing.id),
          'Same device + transaction id pushed twice with different contents', session.uid);
        results.push({
          clientTxId: tx.clientTxId,
          transactionId: String(existing.id),
          accepted: true,
          status: 'COMPLETED',
          conflicts: [{ reason: 'duplicate_client_tx', conflictId: dupId }],
        });
        continue;
      }

      var kind = String(tx.kind || 'sale');
      if (kind === 'payout') {
        pushResult_(results, tx, processPayout_(session, store, newTxRows, tx, deviceId, userRows));
        continue;
      }
      if (kind === 'payment') {
        pushResult_(results, tx, processPayment_(session, store, newTxRows, tx, deviceId, userRows, customerIds));
        continue;
      }
      if (kind === 'refund') {
        pushResult_(results, tx, processRefund_(
          txRows, prodRows, serialRows, store, newTxRows, newConflictRows,
          serialPatches, productPatches, session, deviceId, tx, userRows));
        continue;
      }

      for (var k = 0; k < items.length; k++) {
        var item = items[k];
        var product = prodById[String(item.productId || '')];
        if (!product || String(product.active) !== '1') {
          errors.push({ productId: item.productId, reason: 'unknown_product' });
          continue;
        }
        var isSerialized = String(product.is_serialized) === '1';
        var itemType = String(product.item_type || 'product');
        var unitPrice = typeof item.unitPrice === 'number' ? item.unitPrice : num_(product.retail_price);
        if (isSerialized) {
          var sn = item.serialNumber != null ? String(item.serialNumber).trim() : '';
          var serial = serialBySn[sn] || null;
          if (!serial || String(serial.product_id) !== String(product.id)) {
            errors.push({ productId: product.id, serialNumber: sn, reason: 'serial_not_found' });
            continue;
          }
          if (String(serial.status) !== 'IN_STOCK') {
            var errSn = errors.length;
            errors.push({ productId: product.id, serialNumber: String(serial.serial_number), reason: 'serial_not_in_stock' });
            /* two devices sold the same unit — flag for manager review */
            var claimId = conflictRow_(openConflictSet, newConflictRows, store, 'SERIAL_CLAIM',
              String(serial.serial_number), deviceId, String(tx.clientTxId || ''), String(serial.tx_id || ''),
              'Serial ' + serial.serial_number + ' sold by two devices (winner tx ' + String(serial.tx_id || '?') + ')', session.uid);
            if (claimId) errors[errSn].conflictId = claimId;
            continue;
          }
          resolved.push({ product: product, serial: serial, quantity: 1, unitPrice: unitPrice, discountPct: clampPct_(num_(item.discountPct)) });
        } else if (itemType === 'service') {
          // No stock tracked for a service / offering.
          resolved.push({ product: product, serial: null, quantity: 1, unitPrice: unitPrice, onHand: null, discountPct: clampPct_(num_(item.discountPct)) });
        } else {
          if (product.lockedToggle) {
            if (product.lockedToggle.flag) {
              errors.push({ productId: product.id, reason: 'product_locked' });
              continue;
            }
          } else if (String(product.locked) === '1') {
            errors.push({ productId: product.id, reason: 'product_locked' });
            continue;
          }
          resolved.push({
            product: product,
            serial: null,
            quantity: Math.max(1, item.quantity || 1),
            unitPrice: unitPrice,
            onHand: num_(product.on_hand),
            discountPct: clampPct_(num_(item.discountPct)),
          });
        }
      }

      /* duplicate push already handled above (raw content compare) */
      var itemsJson = JSON.stringify(resolvedItems_(resolved));

      var hasErrors = errors.length > 0;
      var txId = Utilities.getUuid();
      /* a sale linked to a customer that does not exist must not complete —
         it would create an unmatched receivable or empty the ledger book. */
      var custId = String(tx.customerId || '');
      if (custId !== '' && !customerIds[custId]) {
        errors.push({ reason: 'unknown_customer' });
        hasErrors = true;
      }
      /* v1.2.6 sends discountPct on the envelope; pre-upgrade queued sales
         don't, so they keep their client totals (and stay untaxed) — you never
         retroactively tax a sale a cashier already rang up offline. */
      var newFormat = tx.discountPct !== undefined && tx.discountPct !== null;
      var orderPct = clampPct_(num_(tx.discountPct));
      var taxRate = num_(store.taxRate);
      var totals = null;
      if (newFormat && !hasErrors && resolved.length) {
        totals = saleTotals_(resolved.map(saleLine_), orderPct, taxRate);
      }
      var grandTotal = totals
        ? totals.total
        : (num_(tx.grandTotal) || resolved.reduce(function (sum, r) { return sum + r.unitPrice * r.quantity; }, 0));
      var userId = userIds[String(tx.userId || '')] ? String(tx.userId) : fallbackUserId_(userRows);
      var created = String(tx.createdAt || new Date().toISOString());
      var createdMs = new Date(created).getTime();
      var clockFlagged = !isNaN(createdMs) && (createdMs > nowMs + skewFuture || createdMs < nowMs - skewPast);

      var note = hasErrors
        ? 'Conflict rejected: ' + errors.map(function (er) { return er.reason; }).join(', ')
        : (tx.note || '');

      newTxRows.push({
        id: txId,
        store_id: store.id,
        user_id: userId,
        device_id: deviceId,
        client_tx_id: String(tx.clientTxId || ''),
        kind: 'sale',
        original_client_tx: '',
        counterparty: '',
        grand_total: grandTotal,
        status: hasErrors ? 'VOIDED' : 'COMPLETED',
        tenders_json: JSON.stringify(Array.isArray(tx.tenders) ? tx.tenders : []),
        items_json: itemsJson,
        note: note,
        created_at: created,
        subtotal: totals ? totals.subtotal : grandTotal,
        tax_amount: totals ? totals.tax : 0,
        discount_pct: orderPct,
        customer_id: custId,
      });

      var txConflicts = hasErrors ? errors.slice() : [];
      if (!hasErrors) {
        if (clockFlagged) {
          var skewId = conflictRow_(openConflictSet, newConflictRows, store, 'CLOCK_SKEW', '',
            deviceId, String(tx.clientTxId || ''), txId,
            'Device clock out of range for transaction time ' + created + ' (accepted but flagged)', session.uid);
          if (skewId) txConflicts.push({ reason: 'clock_skew', conflictId: skewId });
        }
        var stamp = new Date().toISOString();
        for (var m = 0; m < resolved.length; m++) {
          var r = resolved[m];
          /* every sold line stamps last_sold_at so slow-mover / aging rules work */
          productPatches[String(r.product.id)] = Object.assign({}, productPatches[String(r.product.id)], { last_sold_at: stamp, updated_at: stamp });
          if (r.serial) {
            serialPatches[String(r.serial.id)] = { status: 'SOLD', tx_id: txId, updated_at: stamp };
            r.serial.status = 'SOLD';
          } else if (r.onHand !== null) {
            /* non-service product decrements stock; services consume none */
            var next = Math.max(0, r.onHand - r.quantity);
            productPatches[String(r.product.id)].on_hand = next;
            r.product.on_hand = next;
          }
        }
      }

      results.push({
        clientTxId: tx.clientTxId,
        transactionId: txId,
        accepted: !hasErrors,
        status: hasErrors ? 'VOIDED' : 'COMPLETED',
        conflicts: txConflicts,
      });
    }

    appendRows_('Transactions', TX_HEADERS, newTxRows);
    if (newConflictRows.length) appendRows_('Conflicts', CONFLICT_HEADERS, newConflictRows);
    applyPatches_('Serials', SERIAL_HEADERS, 'id', serialPatches);
    applyPatches_('Products', PRODUCT_HEADERS, 'id', productPatches);
  } finally {
    lock.releaseLock();
  }

  /* Sync conflicts are for humans, not just the Conflicts tab: one coalesced
     digest per push to every active admin/manager. Mail failure must never
     fail a sale, so the send is fire-and-forget. */
  if (newConflictRows.length) {
    try {
      sendConflictAlerts_(store, userRows, newConflictRows);
    } catch (e) {
      Logger.log('[orison-pos] conflict alert mail failed: ' + (e && e.message));
    }
  }

  return { results: results };
}

function sendConflictAlerts_(store, userRows, conflictRows) {
  var emails = [];
  for (var i = 0; i < userRows.length; i++) {
    var u = userRows[i];
    var role = String(u.role || '');
    if ((role === 'admin' || role === 'manager') && String(u.active) === '1') {
      var email = String(u.email || '').trim();
      if (email && emails.indexOf(email) === -1) emails.push(email);
    }
  }
  if (!emails.length) return;

  var storeName = String((store && (store.name || store.code)) || 'store');
  var n = conflictRows.length;
  var lines = [];
  for (var j = 0; j < conflictRows.length; j++) {
    var c = conflictRows[j];
    lines.push('· ' + String(c.type || 'CONFLICT'));
    if (c.serial_number) lines.push('  serial: ' + c.serial_number);
    if (c.device_id) lines.push('  device: ' + c.device_id);
    if (c.loser_client_tx) lines.push('  loser client tx: ' + c.loser_client_tx);
    if (c.winner_tx_id) lines.push('  winner tx: ' + c.winner_tx_id);
    if (c.summary) lines.push('  ' + c.summary);
  }
  MailApp.sendEmail({
    to: emails.join(', '),
    subject: '[' + storeName + '] ' + n + ' new sync conflict' + (n === 1 ? '' : 's') + ' — review required',
    body: n + ' new sync conflict(s) waiting in the Conflicts tab:\n\n' + lines.join('\n'),
  });
}

function resolvedItems_(resolved) {
  return resolved.map(function (r) {
    /* discountPct/taxable are omitted at their defaults so legacy items keep
       byte-identical signatures (idempotent re-pushes must not regress). */
    var it = {
      productId: String(r.product.id),
      name: String(r.product.name),
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      serialNumber: r.serial ? String(r.serial.serial_number) : null,
    };
    var dp = clampPct_(num_(r.discountPct));
    if (dp > 0) it.discountPct = dp;
    if (String(r.product.taxable) === '0') it.taxable = false;
    /* Cost is captured at sale time so profit history is stable even if the
       product's cost is edited later. Omitted when zero so costless lines
       (and legacy rows) stay compact. */
    var uc = Math.round(num_(r.product.cost_price) * 100) / 100;
    if (uc > 0) it.unitCost = uc;
    return it;
  });
}

/* order-independent signature of the sale content used to detect real
   duplicates vs identical re-pushes (idempotent). */
function txSignature_(items) {
  var sig = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    sig.push([
      String(it.productId || ''),
      it.quantity || 1,
      typeof it.unitPrice === 'number' ? it.unitPrice : '',
      it.serialNumber != null ? String(it.serialNumber) : '',
      typeof it.discountPct === 'number' ? it.discountPct : '',
    ].join('|'));
  }
  sig.sort();
  return sig.join(';');
}

function itobjs_(itemsJson) {
  try { return JSON.parse(itemsJson || '[]'); } catch (_) { return []; }
}

function canonicalJson_(s) {
  try { return JSON.stringify(JSON.parse(s || '[]')); } catch (_) { return String(s); }
}

function pushResult_(results, tx, outcome) {
  var errors = (outcome && outcome.errors) || [];
  results.push({
    clientTxId: String(tx.clientTxId || ''),
    transactionId: (outcome && outcome.transactionId) || '',
    accepted: errors.length === 0,
    status: errors.length ? 'VOIDED' : 'COMPLETED',
    conflicts: errors.map(function (er) {
      return { reason: er.reason, serialNumber: er.serialNumber ? String(er.serialNumber) : '' };
    }),
  });
}

/* Cash payout ("money out"): vendor payment, cash pick-up, or expense. Only
   admin/manager. Recorded like any transaction for the cash audit trail. */
function processPayout_(session, store, newTxRows, tx, deviceId, userRows) {
  var role = session ? String(session.role || '') : '';
  if (role !== 'admin' && role !== 'manager') {
    return { errors: [{ reason: 'unauthorized_role' }] };
  }
  var amount = num_(tx.grandTotal);
  if (amount <= 0) return { errors: [{ reason: 'invalid_amount' }] };

  var userIds = {};
  for (var u = 0; u < userRows.length; u++) userIds[String(userRows[u].id)] = true;
  var txId = Utilities.getUuid();
  newTxRows.push({
    id: txId,
    store_id: store.id,
    user_id: userIds[String(tx.userId || '')] ? String(tx.userId) : fallbackUserId_(userRows),
    device_id: deviceId,
    client_tx_id: String(tx.clientTxId || ''),
    kind: 'payout',
    original_client_tx: '',
    counterparty: String(tx.counterparty || ''),
    grand_total: amount,
    status: 'COMPLETED',
    tenders_json: JSON.stringify(Array.isArray(tx.tenders) && tx.tenders.length ? tx.tenders : [{ type: 'cash', amount: amount }]),
    items_json: '[]',
    note: String(tx.note || ''),
    created_at: String(tx.createdAt || new Date().toISOString()),
  });
  return { transactionId: txId, errors: [] };
}

/* Money in against a customer's account ("collection"). Admin/manager only,
   exactly like a payout — a cashier deciding what counts as paid is an
   accounts hazard. Recorded as kind 'payment' so the ledger can net it. */
function processPayment_(session, store, newTxRows, tx, deviceId, userRows, customerIds) {
  var role = session ? String(session.role || '') : '';
  if (role !== 'admin' && role !== 'manager') {
    return { errors: [{ reason: 'unauthorized_role' }] };
  }
  var amount = num_(tx.grandTotal);
  if (amount <= 0) return { errors: [{ reason: 'invalid_amount' }] };
  var custId = String(tx.customerId || '');
  if (!customerIds[custId]) return { errors: [{ reason: 'unknown_customer' }] };

  var userIds = {};
  for (var u = 0; u < userRows.length; u++) userIds[String(userRows[u].id)] = true;
  var txId = Utilities.getUuid();
  newTxRows.push({
    id: txId,
    store_id: store.id,
    user_id: userIds[String(tx.userId || '')] ? String(tx.userId) : fallbackUserId_(userRows),
    device_id: deviceId,
    client_tx_id: String(tx.clientTxId || ''),
    kind: 'payment',
    original_client_tx: '',
    counterparty: '',
    grand_total: amount,
    status: 'COMPLETED',
    tenders_json: JSON.stringify(Array.isArray(tx.tenders) && tx.tenders.length ? tx.tenders : [{ type: 'cash', amount: amount }]),
    items_json: '[]',
    note: String(tx.note || ''),
    created_at: String(tx.createdAt || new Date().toISOString()),
    customer_id: custId,
  });
  return { transactionId: txId, errors: [] };
}

/* Refund: reverses part or all of a completed sale. Serialized units return
   to IN_STOCK; non-serialized products regain stock. Guards: admin/manager
   only (a cashier deciding what gets reversed is an accounts hazard, exactly
   like payouts and collections), the original sale must exist, refund amount
   can't exceed the outstanding balance, and returned quantities/serials must
   still be outstanding. Idempotent via the normal device+clientTxId check. */
function processRefund_(txRows, prodRows, serialRows, store, newTxRows, newConflictRows,
                        serialPatches, productPatches, session, deviceId, tx, userRows) {
  var role = session ? String(session.role || '') : '';
  if (role !== 'admin' && role !== 'manager') {
    return { errors: [{ reason: 'unauthorized_role' }] };
  }
  var errors = [];
  var originalClientTx = String(tx.originalClientTx || '');
  var original = null;
  for (var i = 0; i < txRows.length; i++) {
    var r = txRows[i];
    if (String(r.client_tx_id) === originalClientTx
        && String(r.status) === 'COMPLETED'
        && (String(r.kind || '') === '' || String(r.kind) === 'sale')) {
      original = r;
      break;
    }
  }
  if (!original) return { errors: [{ reason: 'original_not_found' }] };

  var refundAmount = num_(tx.grandTotal);
  if (refundAmount <= 0) return { errors: [{ reason: 'invalid_amount' }], original: original };

  var priorTotal = 0;
  for (var p = 0; p < txRows.length; p++) {
    var pr = txRows[p];
    if (String(pr.kind) === 'refund'
        && String(pr.original_client_tx) === originalClientTx
        && String(pr.status) === 'COMPLETED') {
      priorTotal += num_(pr.grand_total);
    }
  }
  var remaining = Math.max(0, num_(original.grand_total) - priorTotal);
  if (refundAmount > remaining + 0.005) {
    return { errors: [{ reason: 'refund_exceeds_sale', refundedTotal: priorTotal }], original: original };
  }

  /* outstanding quantity + serials still returnable per product */
  var byProduct = {};
  var origItems = itobjs_(original.items_json);
  for (var oi = 0; oi < origItems.length; oi++) {
    var o = origItems[oi];
    var opk = String(o.productId || '');
    if (!byProduct[opk]) byProduct[opk] = { qty: 0, serials: [] };
    byProduct[opk].qty += o.quantity || 1;
    if (o.serialNumber) byProduct[opk].serials.push(String(o.serialNumber));
  }
  for (var pr2 = 0; pr2 < txRows.length; pr2++) {
    var pr2r = txRows[pr2];
    if (String(pr2r.kind) === 'refund'
        && String(pr2r.original_client_tx) === originalClientTx
        && String(pr2r.status) === 'COMPLETED') {
      var priorItems = itobjs_(pr2r.items_json);
      for (var qi = 0; qi < priorItems.length; qi++) {
        var pq = priorItems[qi];
        var ppk = String(pq.productId || '');
        if (!byProduct[ppk]) byProduct[ppk] = { qty: 0, serials: [] };
        byProduct[ppk].qty -= pq.quantity || 1;
        if (pq.serialNumber) {
          var idx = byProduct[ppk].serials.indexOf(String(pq.serialNumber));
          if (idx >= 0) byProduct[ppk].serials.splice(idx, 1);
        }
      }
    }
  }

  var serialBySn = {};
  for (var s2 = 0; s2 < serialRows.length; s2++) serialBySn[String(serialRows[s2].serial_number)] = serialRows[s2];
  var prodById = {};
  for (var p2 = 0; p2 < prodRows.length; p2++) prodById[String(prodRows[p2].id)] = prodRows[p2];

  var items = Array.isArray(tx.items) ? tx.items : [];
  var resolved = [];
  for (var k = 0; k < items.length; k++) {
    var item = items[k];
    var product = prodById[String(item.productId || '')];
    if (!product || String(product.active) !== '1') {
      errors.push({ productId: item.productId, reason: 'unknown_product' });
      continue;
    }
    var unitPrice = typeof item.unitPrice === 'number' ? item.unitPrice : num_(product.retail_price);
    if (String(product.is_serialized) === '1') {
      var sn = item.serialNumber != null ? String(item.serialNumber).trim() : '';
      var serial = serialBySn[sn] || null;
      if (!sn || !serial || String(serial.product_id) !== String(product.id)) {
        errors.push({ productId: String(product.id), serialNumber: sn, reason: 'serial_not_found' });
        continue;
      }
      if (String(serial.status) !== 'SOLD') {
        errors.push({ productId: String(product.id), serialNumber: sn, reason: 'serial_not_sold' });
        continue;
      }
      var line = byProduct[String(product.id)];
      if (!line || line.serials.indexOf(sn) < 0) {
        errors.push({ productId: String(product.id), serialNumber: sn, reason: 'serial_not_in_original' });
        continue;
      }
      line.serials.splice(line.serials.indexOf(sn), 1);
      resolved.push({ product: product, serial: serial, quantity: 1, unitPrice: unitPrice });
    } else {
      var qty = Math.max(1, item.quantity || 1);
      var line2 = byProduct[String(product.id)];
      var availQty = line2 ? Math.max(0, line2.qty) : 0;
      if (qty > availQty) {
        errors.push({ productId: String(product.id), quantity: qty, reason: 'refund_exceeds_sale_lines' });
        continue;
      }
      line2.qty -= qty;
      var restoreStock = String(product.item_type) !== 'service';
      resolved.push({ product: product, serial: null, quantity: qty, unitPrice: unitPrice, restoreStock: restoreStock });
    }
  }
  if (errors.length) return { errors: errors, original: original };

  var stamp = new Date().toISOString();
  for (var m = 0; m < resolved.length; m++) {
    var re = resolved[m];
    if (re.serial) {
      serialPatches[String(re.serial.id)] = { status: 'IN_STOCK', tx_id: '', updated_at: stamp };
      re.serial.status = 'IN_STOCK';
    } else if (re.restoreStock) {
      var next = num_(re.product.on_hand) + re.quantity;
      productPatches[String(re.product.id)] = Object.assign({}, productPatches[String(re.product.id)], { on_hand: next, updated_at: stamp });
      re.product.on_hand = next;
    }
  }

  var userIds = {};
  for (var u2 = 0; u2 < userRows.length; u2++) userIds[String(userRows[u2].id)] = true;
  var txId = Utilities.getUuid();
  newTxRows.push({
    id: txId,
    store_id: store.id,
    user_id: userIds[String(tx.userId || '')] ? String(tx.userId) : fallbackUserId_(userRows),
    device_id: deviceId,
    client_tx_id: String(tx.clientTxId || ''),
    kind: 'refund',
    original_client_tx: originalClientTx,
    counterparty: String(tx.counterparty || ''),
    grand_total: refundAmount,
    status: 'COMPLETED',
    tenders_json: JSON.stringify(Array.isArray(tx.tenders) ? tx.tenders : []),
    items_json: JSON.stringify(resolvedItems_(resolved)),
    note: String(tx.note || ''),
    created_at: String(tx.createdAt || new Date().toISOString()),
    customer_id: String(original.customer_id || ''),
  });
  return { transactionId: txId, errors: [], original: original };
}

function conflictRow_(openSet, newRows, store, type, serialNumber, deviceId, loserClient, winnerTx, summary, uid) {
  var key = type + '::' + deviceId + '::' + String(loserClient || '');
  if (openSet[key]) return '';
  openSet[key] = true;
  var id = Utilities.getUuid();
  newRows.push({
    id: id,
    store_id: store.id,
    type: type,
    serial_number: serialNumber,
    device_id: deviceId,
    loser_client_tx: String(loserClient || ''),
    winner_tx_id: String(winnerTx || ''),
    summary: String(summary || ''),
    status: 'OPEN',
    created_at: new Date().toISOString(),
    reviewed_at: '',
    reviewed_by: '',
    dedupe_key: key,
  });
  return id;
}

function fallbackUserId_(userRows) {
  for (var i = 0; i < userRows.length; i++) {
    if (userRows[i].role === 'admin' && String(userRows[i].active) === '1') return String(userRows[i].id);
  }
  return userRows.length ? String(userRows[0].id) : '';
}

/* ------------------------------------------------------------------ *
 *  Transactions list
 * ------------------------------------------------------------------ */

function transactions_(session, params) {
  var limit = parseInt(params && params.limit, 10);
  if (isNaN(limit) || limit < 1) limit = 100;
  limit = Math.min(limit, 500);

  /* cashier scope: own rows only; admin/manager see the full store ledger. */
  var isStore = isStoreRole_(session && session.role);
  var txRows = readRows_('Transactions', TX_HEADERS)
    .filter(function (t) {
      if (String(t.status) !== 'COMPLETED') return false;
      if (isStore) return true;
      return String(t.user_id) === String(session.uid);
    });
  txRows.sort(function (a, b) {
    return String(b.created_at).localeCompare(String(a.created_at));
  });

  var userRows = readRows_('Users', USER_HEADERS);
  var nameById = {};
  for (var i = 0; i < userRows.length; i++) {
    var uid = String(userRows[i].id);
    var fn = String(userRows[i].first_name || '');
    var ln = String(userRows[i].last_name || '');
    nameById[uid] = (fn + ' ' + ln).trim();
  }
  var custRows = readRows_('Customers', CUSTOMERS_HEADERS);
  var custById = {};
  for (var cc = 0; cc < custRows.length; cc++) custById[String(custRows[cc].id)] = custRows[cc];

  var out = [];
  for (var j = 0; j < txRows.length && out.length < limit; j++) {
    var t = txRows[j];
    var tenders = [];
    try { tenders = JSON.parse(t.tenders_json || '[]'); } catch (_) {}
    var items = [];
    try { items = JSON.parse(t.items_json || '[]'); } catch (_) {}
    var costTotal = 0;
    for (var ii = 0; ii < items.length; ii++) costTotal += (num_(items[ii].unitCost)) * (items[ii].quantity || 1);
    var kindName = String(t.kind || 'sale');
    var hasMoney = t.subtotal !== '' && t.subtotal != null && num_(t.subtotal) > 0;
    var grossProfit = null;
    if (kindName === 'refund') grossProfit = -costTotal;
    else if (kindName === 'payout') grossProfit = 0;
    else if (hasMoney) {
      /* net revenue = line subtotal − order discount; margin = that − cost. */
      grossProfit = num_(t.subtotal) - Math.round(num_(t.subtotal) * num_(t.discount_pct) / 100) - costTotal;
    }
    out.push({
      id: String(t.id),
      storeId: String(t.store_id),
      user_id: String(t.user_id),
      deviceId: String(t.device_id),
      clientTxId: String(t.client_tx_id || ''),
      kind: kindName,
      originalClientTx: String(t.original_client_tx || ''),
      counterparty: String(t.counterparty || ''),
      cashier: nameById[String(t.user_id)] || '',
      grandTotal: num_(t.grand_total),
      subtotal: num_(t.subtotal),
      taxAmount: num_(t.tax_amount),
      discountPct: num_(t.discount_pct),
      tenders: tenders,
      createdAt: String(t.created_at),
      items: items.map(function (it) {
        var mapped = {
          productId: String(it.productId || ''),
          name: String(it.name || ''),
          quantity: it.quantity || 1,
          unitPrice: num_(it.unitPrice),
          discountPct: typeof it.discountPct === 'number' ? (it.discountPct < 0 ? 0 : (it.discountPct > 100 ? 100 : it.discountPct)) : 0,
          taxable: !(String(it.taxable) === '0'),
          serialNumber: it.serialNumber ? String(it.serialNumber) : null,
        };
        /* Cost is manager/admin-only: a cashier's copy never carries it. */
        if (isStore) mapped.unitCost = num_(it.unitCost);
        return mapped;
      }),
      note: String(t.note || ''),
    });
    var cust = t.customer_id ? custById[String(t.customer_id)] : null;
    if (cust) {
      out[out.length - 1].customerId = String(t.customer_id);
      out[out.length - 1].customer = String(cust.name || '');
    }
    /* Gross profit is a manager/admin figure and stays off cashier responses. */
    if (isStore) out[out.length - 1].grossProfit = grossProfit;
  }
  return { transactions: out };
}

/* ------------------------------------------------------------------ *
 *  Customer ledger — the store's book of who owes what and who is owed.
 *  Balances are money-shaped facts, so they are admin/manager-only.
 * ------------------------------------------------------------------ */

/* checkout search: any signed-in role can look up a name to attach to a sale,
   but the reply never carries balance figures. */
function customers_(session, payload, params) {
  var q = String(((params && params.q) || '').trim()).toLowerCase();
  if (!q) return { customers: [] };
  var rows = readRows_('Customers', CUSTOMERS_HEADERS);
  var out = [];
  for (var i = 0; i < rows.length && out.length < 10; i++) {
    var c = rows[i];
    var hay = (String(c.name || '') + ' ' + String(c.phone || '') + ' ' + String(c.email || '')).toLowerCase();
    if (hay.indexOf(q) >= 0) {
      out.push({ id: String(c.id), name: String(c.name || ''), phone: String(c.phone || ''), email: String(c.email || '') });
    }
  }
  return { customers: out };
}

function adminCustomers_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  var name = String((payload && payload.name) || '').trim();
  if (!name) throw statusError_(400, 'Customer name is required');
  var row = {
    id: Utilities.getUuid(),
    store_id: getStore_().id,
    name: name,
    phone: String((payload && payload.phone) || '').trim(),
    email: String((payload && payload.email) || '').trim(),
    note: String((payload && payload.note) || '').trim(),
    created_at: new Date().toISOString(),
  };
  appendRows_('Customers', CUSTOMERS_HEADERS, [row]);
  return { customer: { id: row.id, name: row.name, phone: row.phone, email: row.email } };
}

/* How a customer's dollars lie:
   - "credit"  = store credit the customer holds (refunds to store credit,
                 minus store-credit tenders spent on sales).
   - "account" = what the customer owes (net-30 / on-account tenders,
                 minus any collections).
   - "balance" = account − credit; positive means the customer owes the store.
 */
function customerLedger_(session, params) {
  requireRole_(session, ['admin', 'manager']);
  var cid = String((params && params.customerId) || '');
  if (!cid) throw statusError_(400, 'customerId is required');
  var cust = null;
  var rows = readRows_('Customers', CUSTOMERS_HEADERS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === cid) { cust = rows[i]; break; }
  }
  if (!cust) throw statusError_(404, 'Customer not found');

  var txRows = readRows_('Transactions', TX_HEADERS)
    .filter(function (t) { return String(t.status) === 'COMPLETED' && String(t.customer_id) === cid; });
  txRows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });

  var credit = 0, account = 0;
  for (var j = 0; j < txRows.length; j++) {
    var t = txRows[j];
    var kind = String(t.kind || 'sale');
    var tenders = [];
    try { tenders = JSON.parse(t.tenders_json || '[]'); } catch (_) {}
    if (kind === 'sale') {
      for (var k = 0; k < tenders.length; k++) {
        var ty = String(tenders[k].type || '');
        var amt = num_(tenders[k].amount);
        if (ty === 'store_credit') credit -= amt;
        else if (ty === 'net30' || ty === 'account') account += amt;
      }
    } else if (kind === 'refund') {
      for (var m = 0; m < tenders.length; m++) {
        if (String(tenders[m].type || '') === 'store_credit') credit += num_(tenders[m].amount);
      }
    } else if (kind === 'payment') {
      account -= num_(t.grand_total);
    }
  }

  var txs = txRows.slice(0, 100).map(function (t) {
    var items = [];
    try { items = JSON.parse(t.items_json || '[]'); } catch (_) {}
    return {
      id: String(t.id),
      clientTxId: String(t.client_tx_id || ''),
      kind: String(t.kind || 'sale'),
      originalClientTx: String(t.original_client_tx || ''),
      grandTotal: num_(t.grand_total),
      createdAt: String(t.created_at),
      items: items.map(function (it) { return { name: String(it.name || ''), quantity: it.quantity || 1 }; }),
    };
  });

  return {
    customer: { id: cust.id, name: String(cust.name || ''), phone: String(cust.phone || ''), email: String(cust.email || '') },
    credit: credit,
    account: account,
    balance: account - credit,
    aging: agingBuckets_(txRows),
    transactions: txs,
  };
}

/* a formal statement of account: every transaction the customer touched, in
   chronological order, as debit/credit lines with a running balance — so the
   book can be printed or exported and trusted against the receivables total. */
function customerStatement_(session, params) {
  requireRole_(session, ['admin', 'manager']);
  var cid = String((params && params.customerId) || '');
  if (!cid) throw statusError_(400, 'customerId is required');
  var cust = null;
  var rows = readRows_('Customers', CUSTOMERS_HEADERS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === cid) { cust = rows[i]; break; }
  }
  if (!cust) throw statusError_(404, 'Customer not found');

  var txRows = readRows_('Transactions', TX_HEADERS)
    .filter(function (t) { return String(t.status) === 'COMPLETED' && String(t.customer_id) === cid; });
  txRows.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });

  var users = readRows_('Users', USER_HEADERS);
  var nameById = {};
  for (var u = 0; u < users.length; u++) {
    nameById[String(users[u].id)] =
      String(users[u].first_name || '') + ' ' + String(users[u].last_name || '');
  }

  var running = 0;
  var items = txRows.map(function (t) {
    var kind = String(t.kind || 'sale');
    var tenders = [];
    try { tenders = JSON.parse(t.tenders_json || '[]'); } catch (_) {}
    var itemNames = [];
    try {
      var arr = JSON.parse(t.items_json || '[]');
      for (var q = 0; q < arr.length; q++) {
        var nm = String(arr[q].name || '');
        var qt = num_(arr[q].quantity);
        itemNames.push(nm + (qt > 1 ? ' \u00d7' + qt : ''));
      }
    } catch (_) {}

    var debit = 0, credit = 0;
    if (kind === 'sale') {
      for (var k = 0; k < tenders.length; k++) {
        var ty = String(tenders[k].type || '');
        var amt = num_(tenders[k].amount);
        if (ty === 'store_credit' || ty === 'net30' || ty === 'account') debit += amt;
      }
    } else if (kind === 'refund') {
      for (var m = 0; m < tenders.length; m++) {
        if (String(tenders[m].type || '') === 'store_credit') credit += num_(tenders[m].amount);
      }
    } else if (kind === 'payment') {
      credit += num_(t.grand_total);
    }
    running += debit - credit;

    var label = kind === 'sale' ? 'Sale'
      : kind === 'refund' ? 'Refund'
      : kind === 'payment' ? 'Payment received'
      : kind === 'payout' ? 'Paid out'
      : String(kind || 'sale');
    var detail = itemNames.slice(0, 3).join(', ');
    if (itemNames.length > 3) detail += ' +' + (itemNames.length - 3) + ' more';

    return {
      id: String(t.id),
      reference: String(t.client_tx_id || ''),
      kind: kind,
      date: String(t.created_at || ''),
      description: label + (detail ? ' \u2014 ' + detail : ''),
      note: String(t.note || ''),
      cashier: nameById[String(t.user_id || '')] || '',
      debit: debit,
      credit: credit,
      balance: running,
    };
  });

  return {
    customer: { id: cust.id, name: String(cust.name || ''), phone: String(cust.phone || ''), email: String(cust.email || '') },
    asOf: new Date().toISOString(),
    opening: 0,
    closing: running,
    items: items,
  };
}

/* one aggregate for the Customers screen: every customer with a non-zero
   balance plus the total outstanding across the book. */
function receivables_(session) {
  requireRole_(session, ['admin', 'manager']);
  var txRows = readRows_('Transactions', TX_HEADERS)
    .filter(function (t) { return String(t.status) === 'COMPLETED' && String(t.customer_id || '') !== ''; });

  var byCustRows = {};
  for (var r = 0; r < txRows.length; r++) {
    var ck = String(txRows[r].customer_id);
    if (!byCustRows[ck]) byCustRows[ck] = [];
    byCustRows[ck].push(txRows[r]);
  }

  var cells = [];
  var totalOut = 0;
  var custRows = readRows_('Customers', CUSTOMERS_HEADERS);
  for (var c = 0; c < custRows.length; c++) {
    var id = String(custRows[c].id);
    var rows = byCustRows[id];
    if (!rows) continue;
    var credit = 0, account = 0, lastSeen = '';
    for (var j = 0; j < rows.length; j++) {
      var t = rows[j];
      var kind = String(t.kind || 'sale');
      var tenders = [];
      try { tenders = JSON.parse(t.tenders_json || '[]'); } catch (_) {}
      if (kind === 'sale') {
        for (var k = 0; k < tenders.length; k++) {
          var ty = String(tenders[k].type || '');
          var amt = num_(tenders[k].amount);
          if (ty === 'store_credit') credit -= amt;
          else if (ty === 'net30' || ty === 'account') account += amt;
        }
      } else if (kind === 'refund') {
        for (var m = 0; m < tenders.length; m++) {
          if (String(tenders[m].type || '') === 'store_credit') credit += num_(tenders[m].amount);
        }
      } else if (kind === 'payment') {
        account -= num_(t.grand_total);
      }
      if (String(t.created_at) > lastSeen) lastSeen = String(t.created_at);
    }
    var balance = account - credit;
    if (Math.abs(balance) < 0.005 && Math.abs(account) < 0.005 && Math.abs(credit) < 0.005) continue;
    var aging = agingBuckets_(rows);
    cells.push({
      id: id,
      name: String(custRows[c].name || ''),
      phone: String(custRows[c].phone || ''),
      credit: credit,
      account: account,
      balance: balance,
      lastSeen: lastSeen,
      aging: aging,
    });
    if (balance > 0) totalOut += balance;
  }
  cells.sort(function (a, b) { return b.balance - a.balance; });
  return { customers: cells, totalOutstanding: totalOut };
}

/* FIFO aging: the oldest dollar on account ages first. Bucket labels are the
   day ranges: current (< 30), 30–59, 60–89, and 90+. */
function agingBuckets_(txRows) {
  var nowMs = Date.now();
  var DAY = 24 * 3600 * 1000;
  var sales = [];
  var payTotal = 0;
  for (var i = 0; i < txRows.length; i++) {
    var t = txRows[i];
    var kind = String(t.kind || 'sale');
    var at = new Date(String(t.created_at || '')).getTime();
    if (isNaN(at)) at = nowMs;
    if (kind === 'sale') {
      var tenders = [];
      try { tenders = JSON.parse(t.tenders_json || '[]'); } catch (_) {}
      for (var k = 0; k < tenders.length; k++) {
        var ty = String(tenders[k].type || '');
        var amt = num_(tenders[k].amount);
        if ((ty === 'net30' || ty === 'account') && amt > 0) sales.push({ amount: amt, at: at });
      }
    } else if (kind === 'payment') {
      payTotal += num_(t.grand_total);
    }
  }
  sales.sort(function (a, b) { return a.at - b.at; });
  /* FIFO: every payment settles the oldest outstanding dollars first, so walk
     the sales oldest→newest and zero out their amounts as payments are applied,
     then age whatever is left by each sale's own age. */
  var payLeft = payTotal;
  for (var p = 0; p < sales.length && payLeft > 0; p++) {
    var pm = Math.min(sales[p].amount, payLeft);
    sales[p].amount -= pm;
    payLeft -= pm;
  }
  var b = { current: 0, d30: 0, d60: 0, d90: 0 };
  var oldestDays = 0;
  for (var j = 0; j < sales.length; j++) {
    var s = sales[j];
    if (s.amount <= 0) continue;
    var days = Math.max(0, Math.floor((nowMs - s.at) / DAY));
    if (days < 30) b.current += s.amount;
    else if (days < 60) b.d30 += s.amount;
    else if (days < 90) b.d60 += s.amount;
    else b.d90 += s.amount;
    if (!oldestDays) oldestDays = days;
  }
  return { current: b.current, d30: b.d30, d60: b.d60, d90: b.d90, oldestDays: oldestDays };
}

/* ------------------------------------------------------------------ *
 *  Reports: one store-wide analytics snapshot for a date window.
 *
 *  Manager/admin only. Everything is recomputed live from the ledger rows
 *  (never from client-cached state) using the same money model as the API:
 *  gross-profit = subtotal − round(subtotal·discount%) − cost, refunds as a
 *  negative line, payouts as cash out. byTender nets sales + payments up and
 *  refunds + payouts down per method, so a manager can see *where* cash lives.
 * ------------------------------------------------------------------ */

var REPORT_DENOM_LABELS = { cash: 'Cash', transfer: 'Transfer', store_credit: 'Store credit', net30: 'On account', account: 'On account' };

function reports_(session, params) {
  requireRole_(session, ['admin', 'manager']);
  var from = String((params && params.from) || '');
  var to = String((params && params.to) || '');
  var nowMs = Date.now();
  if (!from || !to) {
    from = new Date(nowMs - 29 * 86400000).toISOString();
    to = new Date(nowMs + 86400000).toISOString();
  }
  var fromIso = from.indexOf('T') >= 0 ? from : from + 'T00:00:00.000Z';
  var toIso = to.indexOf('T') >= 0 ? to : to + 'T23:59:59.999Z';
  if (fromIso > toIso) { var tmp = fromIso; fromIso = toIso; toIso = tmp; }

  var prodRows = readRows_('Products', PRODUCT_HEADERS);
  var prodById = {};
  for (var pi = 0; pi < prodRows.length; pi++) prodById[String(prodRows[pi].id)] = prodRows[pi];

  var txRows = readRows_('Transactions', TX_HEADERS).filter(function (t) {
    return String(t.status) === 'COMPLETED'
      && String(t.created_at || '') >= fromIso
      && String(t.created_at || '') <= toIso;
  });

  var userRows = readRows_('Users', USER_HEADERS);
  var userName = {};
  for (var ui = 0; ui < userRows.length; ui++) {
    var u = userRows[ui];
    userName[String(u.id)] = String(u.first_name || '') + ' ' + String(u.last_name || '');
  }

  var byDay = {};
  var byCat = {};
  var byCash = {};
  var byTender = {};
  var byProduct = {};
  var byCustomerTx = {};
  var summary = { grossSales: 0, refunds: 0, payouts: 0, collections: 0, salesCount: 0, units: 0, tax: 0, grossProfit: 0 };

  function costOf_(t) {
    var items = itobjs_(t.items_json);
    var cost = 0;
    for (var i = 0; i < items.length; i++) {
      var prod = prodById[String(items[i].productId || '')];
      cost += (items[i].quantity || 1) * (prod ? num_(prod.cost_price) : 0);
    }
    return cost;
  }
  function gpOf_(t, costTotal) {
    if (String(t.subtotal || '') === '') return 0;
    return num_(t.subtotal) - Math.round(num_(t.subtotal) * num_(t.discount_pct) / 100) - costTotal;
  }
  function tendersOf_(t) {
    var out = [];
    try { out = JSON.parse(t.tenders_json || '[]'); } catch (_) {}
    return out;
  }
  function dayKeyOf_(iso) { return String(iso || '').slice(0, 10); }

  for (var r = 0; r < txRows.length; r++) {
    var t = txRows[r];
    var kind = String(t.kind || 'sale');
    var tenders = tendersOf_(t);
    var items = itobjs_(t.items_json);
    var costTotal = costOf_(t);
    var day = dayKeyOf_(t.created_at);
    var d = byDay[day] || (byDay[day] = { sales: 0, count: 0, gp: 0 });
    var c = byCash[String(t.user_id || '')] || (byCash[String(t.user_id || '')] = { sales: 0, count: 0, units: 0, gp: 0 });

    if (kind === 'sale') {
      var g1 = num_(t.grand_total);
      summary.grossSales += g1;
      summary.salesCount += 1;
      summary.units += items.reduce(function (s, it) { return s + (it.quantity || 1); }, 0);
      summary.tax += num_(t.tax_amount);
      var gp = gpOf_(t, costTotal);
      summary.grossProfit += gp;
      d.sales += g1; d.count += 1; d.gp += gp;
      c.sales += g1; c.count += 1; c.gp += gp;
      c.units += items.reduce(function (s, it) { return s + (it.quantity || 1); }, 0);

      for (var ti = 0; ti < tenders.length; ti++) {
        var tc = tenders[ti];
        var ty = String(tc.type || 'cash');
        var e = byTender[ty] || (byTender[ty] = { amount: 0, count: 0 });
        e.amount += num_(tc.amount);
        e.count += 1;
      }
      for (var it1 = 0; it1 < items.length; it1++) {
        var it = items[it1];
        var prod = prodById[String(it.productId || '')];
        var cat = prod ? String(prod.category || 'Uncategorized') : 'Uncategorized';
        var ce = byCat[cat] || (byCat[cat] = { units: 0, sales: 0, gp: 0 });
        ce.units += it.quantity || 1;
        ce.sales += (it.unitPrice || 0) * (it.quantity || 1);
        ce.gp += ((it.unitPrice || 0) - (prod ? num_(prod.cost_price) : 0)) * (it.quantity || 1);
        var pe = byProduct[String(it.productId || '')] || (byProduct[String(it.productId || '')] = { name: prod ? String(prod.name || 'Item') : 'Item', sku: prod ? String(prod.sku || '') : '', units: 0, sales: 0, gp: 0 });
        pe.units += it.quantity || 1;
        pe.sales += (it.unitPrice || 0) * (it.quantity || 1);
        pe.gp += ((it.unitPrice || 0) - (prod ? num_(prod.cost_price) : 0)) * (it.quantity || 1);
      }
      var custId = String(t.customer_id || '');
      if (custId) {
        var ce2 = byCustomerTx[custId] || (byCustomerTx[custId] = { spent: 0, count: 0 });
        ce2.spent += g1;
        ce2.count += 1;
      }
    } else if (kind === 'refund') {
      summary.refunds += num_(t.grand_total);
      summary.grossProfit -= costTotal;
      c.sales -= num_(t.grand_total); c.gp -= costTotal;
      for (var ri = 0; ri < tenders.length; ri++) {
        var re = byTender[String(tenders[ri].type || 'cash')] || (byTender[String(tenders[ri].type || 'cash')] = { amount: 0, count: 0 });
        re.amount -= num_(tenders[ri].amount);
        re.count += 1;
      }
    } else if (kind === 'payout') {
      summary.payouts += num_(t.grand_total);
      c.sales -= num_(t.grand_total);
      var pe2 = byTender['cash'] || (byTender['cash'] = { amount: 0, count: 0 });
      pe2.amount -= num_(t.grand_total);
    } else if (kind === 'payment') {
      summary.collections += num_(t.grand_total);
      c.sales += num_(t.grand_total); c.count += 0;
      for (var pi2 = 0; pi2 < tenders.length; pi2++) {
        var pe3 = byTender[String(tenders[pi2].type || 'cash')] || (byTender[String(tenders[pi2].type || 'cash')] = { amount: 0, count: 0 });
        pe3.amount += num_(tenders[pi2].amount);
        pe3.count += 1;
      }
    }
  }

  var custRows = readRows_('Customers', CUSTOMERS_HEADERS);
  var custName = {};
  for (var ci = 0; ci < custRows.length; ci++) {
    custName[String(custRows[ci].id)] = String(custRows[ci].name || 'Customer');
  }
  var balanceById = {};
  try { var rec = receivables_(session).customers || []; for (var bc = 0; bc < rec.length; bc++) balanceById[String(rec[bc].id)] = rec[bc].balance; } catch (_) {}

  var byDayOut = Object.keys(byDay).sort().map(function (k) {
    return { date: k, sales: num_(byDay[k].sales), count: byDay[k].count, gp: num_(byDay[k].gp) };
  });
  var byCatOut = Object.keys(byCat).map(function (k) {
    return { category: k, units: byCat[k].units, sales: num_(byCat[k].sales), gp: num_(byCat[k].gp) };
  }).sort(function (a, b) { return b.sales - a.sales; });
  var byCashOut = Object.keys(byCash).map(function (k) {
    return { userName: userName[k] || '—', sales: num_(byCash[k].sales), count: byCash[k].count, units: byCash[k].units, gp: num_(byCash[k].gp) };
  }).sort(function (a, b) { return b.sales - a.sales; });
  var byTenderOut = Object.keys(byTender).map(function (k) {
    return { type: k, label: REPORT_DENOM_LABELS[k] || k, amount: num_(byTender[k].amount), count: byTender[k].count };
  }).sort(function (a, b) { return b.amount - a.amount; });
  var byProductOut = Object.keys(byProduct).map(function (k) {
    var e = byProduct[k];
    return { name: e.name, sku: e.sku, units: e.units, sales: num_(e.sales), gp: num_(e.gp) };
  }).sort(function (a, b) { return b.sales - a.sales; }).slice(0, 10);
  var topCust = Object.keys(byCustomerTx).map(function (k) {
    return { name: custName[k] || 'Customer', id: k, spent: num_(byCustomerTx[k].spent), count: byCustomerTx[k].count, balance: balanceById[k] == null ? null : num_(balanceById[k]) };
  }).sort(function (a, b) { return b.spent - a.spent; }).slice(0, 10);

  return {
    period: { from: fromIso, to: toIso, days: byDayOut.length },
    summary: {
      grossSales: summary.grossSales,
      refunds: summary.refunds,
      payouts: summary.payouts,
      collections: summary.collections,
      netRevenue: summary.grossSales - summary.refunds - summary.payouts,
      salesCount: summary.salesCount,
      units: summary.units,
      tax: summary.tax,
      grossProfit: summary.grossProfit,
      avgTicket: summary.salesCount ? summary.grossSales / summary.salesCount : 0,
    },
    byDay: byDayOut,
    byCategory: byCatOut,
    byCashier: byCashOut,
    byTender: byTenderOut,
    topProducts: byProductOut,
    topCustomers: topCust,
  };
}

/* Price history: who changed a product's cost or retail, when, and why
 * (manual patch vs purchase-order receiving vs create). Manager/admin only. */
function priceHistory_(session, params) {
  requireRole_(session, ['admin', 'manager']);
  var productId = String((params && params.productId) || '');
  var limit = parseInt(params && params.limit, 10);
  if (isNaN(limit) || limit < 1) limit = 200;
  limit = Math.min(limit, 1000);

  var rows = readRows_('PriceHistory', PRICE_HISTORY_HEADERS);
  if (productId) rows = rows.filter(function (r) { return String(r.product_id) === productId; });
  rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  rows = rows.slice(0, limit);

  var userRows = readRows_('Users', USER_HEADERS);
  var nameById = {};
  for (var i = 0; i < userRows.length; i++) {
    nameById[String(userRows[i].id)] = (String(userRows[i].first_name || '') + ' ' + String(userRows[i].last_name || '')).trim();
  }
  var poRows = readRows_('PurchaseOrders', PO_HEADERS);
  var poNumberById = {};
  for (var j = 0; j < poRows.length; j++) poNumberById[String(poRows[j].id)] = String(poRows[j].po_number || '');

  var history = rows.map(function (r) {
    return {
      id: String(r.id || ''),
      productId: String(r.product_id || ''),
      productName: String(r.product_name || ''),
      field: String(r.field || ''),
      oldValue: num_(r.old_value),
      newValue: num_(r.new_value),
      source: String(r.source || ''),
      poNumber: poNumberById[String(r.po_id || '')] || '',
      changedBy: nameById[String(r.changed_by || '')] || '',
      createdAt: String(r.created_at || ''),
    };
  });
  return { history: history, productId: productId || null };
}

/* stock aging: how long has the on-hand inventory been sitting? A product's
   age starts at creation and is re-set every time a purchase-order receipt
   brings more in (the receipt's own timestamp). Buckets 0-30/31-60/61-90/90+
   days; every row valued at current cost. */
function inventoryAging_(session) {
  requireRole_(session, ['admin', 'manager']);
  var nowMs = Date.now();
  var dayMs = 86400000;

  var lastIn = {};
  var histRows = readRows_('PriceHistory', PRICE_HISTORY_HEADERS);
  for (var h = 0; h < histRows.length; h++) {
    var pr = histRows[h];
    if (String(pr.source) !== 'po' || String(pr.field) !== 'cost_price') continue;
    var pid = String(pr.product_id);
    var ts = String(pr.created_at || '');
    if (!lastIn[pid] || ts > lastIn[pid]) lastIn[pid] = ts;
  }

  var serialAvailable = {};
  var serRows = readRows_('Serials', SERIAL_HEADERS);
  for (var s = 0; s < serRows.length; s++) {
    if (String(serRows[s].status) !== 'IN_STOCK') continue;
    var spid = String(serRows[s].product_id);
    serialAvailable[spid] = (serialAvailable[spid] || 0) + 1;
  }

  var summary = {
    current: { units: 0, value: 0 },
    d30: { units: 0, value: 0 },
    d60: { units: 0, value: 0 },
    d90: { units: 0, value: 0 },
  };
  var items = [];
  var prods = readRows_('Products', PRODUCT_HEADERS);
  for (var i = 0; i < prods.length; i++) {
    var p = prods[i];
    if (String(p.item_type) === 'service' || String(p.active) !== '1') continue;
    var isSerialized = String(p.is_serialized) === '1';
    var onHand = isSerialized ? (serialAvailable[String(p.id)] || 0) : num_(p.on_hand);
    if (onHand <= 0) continue;

    var lastInTs = lastIn[String(p.id)] || String(p.created_at || '');
    var ageDays = 0;
    var parsed = Date.parse(lastInTs);
    if (!isNaN(parsed)) ageDays = Math.max(0, Math.floor((nowMs - parsed) / dayMs));
    var bucket = ageDays >= 90 ? 'd90' : ageDays >= 60 ? 'd60' : ageDays >= 30 ? 'd30' : 'current';
    var value = round2_(onHand * num_(p.cost_price));

    items.push({
      id: String(p.id),
      name: String(p.name || ''),
      sku: String(p.sku || ''),
      category: String(p.category || ''),
      onHand: onHand,
      costPrice: num_(p.cost_price),
      ageDays: ageDays,
      value: value,
      lastIn: lastInTs || '',
    });
    summary[bucket].units += onHand;
    summary[bucket].value += value;
  }

  items.sort(function (a, b) { return b.ageDays - a.ageDays; });
  return { asOf: new Date().toISOString(), items: items, summary: summary };
}

/* ------------------------------------------------------------------ *
 *  Purchase orders: supplier list, PO lifecycle, and stock-in posting.
 *
 *  suppliers   → POST creates/updates, GET (no payload) lists.
 *  PO          → POST creates a DRAFT/ORDERED order, GET lists all.
 *  detail      → full order incl. line snapshots + received quantities.
 *  receive     → posts stock in (weighted-average cost, serial intake)
 *                and advances the order DRAFT?→ORDERED→PARTIAL→RECEIVED.
 *  cancel      → only from DRAFT or ORDERED.
 *
 *  Everything is manager/admin only. Receiving writes a kind='purchase'
 *  transaction so stock that arrives has a ledger trail and the drawer
 *  math never mistakes a delivery for a sale.
 * ------------------------------------------------------------------ */

function poSupplierMap_(supplierRows) {
  var byId = {};
  for (var i = 0; i < supplierRows.length; i++) byId[String(supplierRows[i].id)] = supplierRows[i];
  return byId;
}

function suppliers_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  /* list mode */
  if (!payload || !Object.keys(payload).length) {
    var rows = readRows_('Suppliers', SUPPLIER_HEADERS);
    rows.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    var store = getStore_();
    return {
      suppliers: rows.filter(function (r) { return String(r.store_id) === store.id; })
        .map(function (r) {
          return { id: String(r.id), name: String(r.name), phone: String(r.phone || ''), email: String(r.email || ''),
            address: String(r.address || ''), paymentTerms: String(r.payment_terms || ''), active: String(r.active) === '1', createdAt: String(r.created_at || '') };
        }),
    };
  }

  var name = String(payload.name || '').trim();
  if (!name) throw statusError_(400, 'Supplier name is required');
  var existing = readRows_('Suppliers', SUPPLIER_HEADERS);
  var store = getStore_();
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i].store_id) === store.id
        && String(existing[i].name).toLowerCase() === name.toLowerCase()) {
      throw statusError_(409, 'A supplier with that name already exists');
    }
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var now = new Date().toISOString();
    var id = Utilities.getUuid();
    appendRows_('Suppliers', SUPPLIER_HEADERS, [{
      id: id, store_id: store.id, name: name,
      phone: String(payload.phone || '').trim(), email: String(payload.email || '').trim(),
      address: String(payload.address || '').trim(), payment_terms: String(payload.paymentTerms || '').trim(),
      active: payload.active === false ? 0 : 1, created_at: now,
    }]);
    return { id: id };
  } finally {
    lock.releaseLock();
  }
}

function round2_(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function poItemsFromPayload_(lines, createdBy) {
  if (!Array.isArray(lines) || !lines.length) throw statusError_(400, 'At least one line is required');
  var prodRows = readRows_('Products', PRODUCT_HEADERS);
  var prodById = {};
  for (var i = 0; i < prodRows.length; i++) prodById[String(prodRows[i].id)] = prodRows[i];

  var seen = {};
  var items = [];
  for (var j = 0; j < lines.length; j++) {
    var ln = lines[j];
    var pid = String(ln.productId || '');
    var prod = prodById[pid];
    if (!prod || String(prod.active) !== '1') throw statusError_(400, 'Unknown or inactive product');
    if (String(prod.item_type) === 'service') throw statusError_(400, 'Cannot order services on a PO');
    var qty = num_(ln.quantity);
    if (!(qty > 0)) throw statusError_(400, 'Quantity must be greater than zero');
    var unitCost = num_(ln.unitCost);
    if (unitCost < 0) throw statusError_(400, 'Unit cost cannot be negative');
    if (seen[pid]) throw statusError_(400, 'Duplicate line for the same product');
    seen[pid] = true;
    items.push({
      productId: pid, name: String(prod.name || ''), sku: String(prod.sku || ''),
      quantity: qty, unitCost: round2_(unitCost), taxable: String(prod.taxable) === '1',
    });
  }
  return { items: items, prodById: prodById };
}

function purchaseOrders_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  if (!payload || !Object.keys(payload).length) {
    var poRows = readRows_('PurchaseOrders', PO_HEADERS);
    var suppliers = poSupplierMap_(readRows_('Suppliers', SUPPLIER_HEADERS));
    poRows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    return {
      orders: poRows.map(function (po) {
        var items = itobjs_(po.items_json);
        var received = itobjs_(po.received_json);
        var ordered = 0, got = 0;
        for (var i = 0; i < items.length; i++) { ordered += items[i].quantity || 1; got += (received[i] && received[i].quantity) || 0; }
        return {
          id: String(po.id), poNumber: String(po.po_number || ''), supplierName: (suppliers[String(po.supplier_id)] || {}).name || '',
          supplierId: String(po.supplier_id || ''), status: String(po.status || 'DRAFT'),
          expectedDate: String(po.expected_date || ''), orderDate: String(po.order_date || ''),
          total: num_(po.total), itemCount: items.length, orderedQty: ordered, receivedQty: got,
          createdAt: String(po.created_at || ''), note: String(po.note || ''),
        };
      }),
    };
  }

  var supplierId = String(payload.supplierId || '');
  var supplierRows = readRows_('Suppliers', SUPPLIER_HEADERS);
  var supplier = null;
  for (var s = 0; s < supplierRows.length; s++) {
    if (String(supplierRows[s].id) === supplierId && String(supplierRows[s].active) === '1') { supplier = supplierRows[s]; break; }
  }
  if (!supplier) throw statusError_(404, 'Supplier not found');

  var built = poItemsFromPayload_(payload.lines, session.uid);
  var discount = Math.min(100, Math.max(0, num_(payload.discountPct)));
  var taxAmount = Math.max(0, num_(payload.taxAmount));
  var subtotal = 0;
  for (var b = 0; b < built.items.length; b++) subtotal += built.items[b].quantity * built.items[b].unitCost;
  subtotal = round2_(subtotal);
  var total = round2_(subtotal * (1 - discount / 100) + taxAmount);
  var status = String(payload.status || 'DRAFT') === 'ORDERED' ? 'ORDERED' : 'DRAFT';

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var now = new Date().toISOString();
    var poRows2 = readRows_('PurchaseOrders', PO_HEADERS);
    var seq = poRows2.length + 1;
    var poNumber = 'PO-' + ('0000' + seq).slice(-4);
    var id = Utilities.getUuid();
    appendRows_('PurchaseOrders', PO_HEADERS, [{
      id: id, store_id: getStore_().id, supplier_id: supplierId, po_number: poNumber,
      order_date: now, expected_date: String(payload.expectedDate || '').slice(0, 10),
      status: status, items_json: JSON.stringify(built.items), received_json: '[]',
      subtotal: subtotal, discount_pct: discount, tax_amount: taxAmount, total: total,
      note: String(payload.note || '').slice(0, 500), created_by: String(session.uid || ''),
      created_at: now, updated_at: now,
    }]);
    return { id: id, poNumber: poNumber, status: status, total: total };
  } finally {
    lock.releaseLock();
  }
}

function purchaseOrderDetail_(session, params) {
  requireRole_(session, ['admin', 'manager']);
  var id = String((params && params.id) || '');
  var poRows = readRows_('PurchaseOrders', PO_HEADERS);
  var po = null;
  for (var i = 0; i < poRows.length; i++) {
    if (String(poRows[i].id) === id) { po = poRows[i]; break; }
  }
  if (!po) throw statusError_(404, 'Purchase order not found');

  var suppliers = poSupplierMap_(readRows_('Suppliers', SUPPLIER_HEADERS));
  var supplier = suppliers[String(po.supplier_id)] || {};
  var items = itobjs_(po.items_json);
  var received = itobjs_(po.received_json);
  var prods = readRows_('Products', PRODUCT_HEADERS);
  var onHandById = {};
  for (var p = 0; p < prods.length; p++) onHandById[String(prods[p].id)] = num_(prods[p].on_hand);

  var outItems = items.map(function (it, idx) {
    var got = (received[idx] && received[idx].quantity) || 0;
    return {
      productId: String(it.productId || ''), name: String(it.name || ''), sku: String(it.sku || ''),
      quantity: num_(it.quantity || 1), unitCost: num_(it.unitCost),
      receivedQty: got, remaining: num_(it.quantity || 1) - got,
      onHand: onHandById[String(it.productId || '')] == null ? null : onHandById[String(it.productId || '')],
      serialized: String((prods.find(function (pr) { return String(pr.id) === String(it.productId); }) || {}).is_serialized) === '1',
    };
  });

  return {
    order: {
      id: String(po.id), poNumber: String(po.po_number || ''), status: String(po.status || 'DRAFT'),
      supplierId: String(po.supplier_id || ''), supplierName: String(supplier.name || ''),
      orderDate: String(po.order_date || ''), expectedDate: String(po.expected_date || ''),
      subtotal: num_(po.subtotal), discountPct: num_(po.discount_pct), taxAmount: num_(po.tax_amount), total: num_(po.total),
      note: String(po.note || ''), createdAt: String(po.created_at || ''), updatedAt: String(po.updated_at || ''),
      lines: outItems,
    },
  };
}

function purchaseOrderReceive_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  var id = String((payload && payload.id) || '');
  var lines = Array.isArray(payload && payload.lines) ? payload.lines : [];
  if (!id || !lines.length) throw statusError_(400, 'Order id and lines are required');

  var poRows = readRows_('PurchaseOrders', PO_HEADERS);
  var po = null;
  for (var i = 0; i < poRows.length; i++) {
    if (String(poRows[i].id) === id) { po = poRows[i]; break; }
  }
  if (!po) throw statusError_(404, 'Purchase order not found');
  var status = String(po.status || 'DRAFT');
  if (status !== 'ORDERED' && status !== 'PARTIAL') {
    throw statusError_(409, 'Only an ordered purchase can be received');
  }

  var items = itobjs_(po.items_json);
  var received = itobjs_(po.received_json);
  var prodRows = readRows_('Products', PRODUCT_HEADERS);
  var prodById = {};
  for (var p = 0; p < prodRows.length; p++) prodById[String(prodRows[p].id)] = prodRows[p];
  var suppliers = poSupplierMap_(readRows_('Suppliers', SUPPLIER_HEADERS));
  var supplierName = String((suppliers[String(po.supplier_id)] || {}).name || '');

  /* index ordered lines by product */
  var orderedById = {};
  for (var oi = 0; oi < items.length; oi++) orderedById[String(items[oi].productId)] = items[oi];
  var receivedById = {};
  for (var ri = 0; ri < received.length; ri++) receivedById[String(received[ri].productId)] = received[ri];

  var newReceived = [];
  var patches = {};
  var serialNew = [];
  var serialSet = {};
  var serialRows = readRows_('Serials', SERIAL_HEADERS);
  for (var sr = 0; sr < serialRows.length; sr++) serialSet[String(serialRows[sr].serial_number)] = true;

  var stamp = new Date().toISOString();
  var receivedValue = 0;
  var txItems = [];

  var project = {};
  for (var li = 0; li < lines.length; li++) {
    var ln = lines[li];
    var pid = String(ln.productId || '');
    var ordered = orderedById[pid];
    if (!ordered) throw statusError_(400, 'Line not on this order');
    var prod = prodById[pid];
    if (!prod || String(prod.active) !== '1') throw statusError_(400, 'Product is unknown or inactive');
    var qty = num_(ln.quantity);
    if (!(qty > 0)) throw statusError_(400, 'Quantity must be greater than zero');
    var prevQty = num_(receivedById[pid] ? receivedById[pid].quantity : 0);
    var remaining = num_(ordered.quantity) - prevQty;
    if (qty > remaining) throw statusError_(400, 'Cannot receive more than the outstanding quantity');
    var unitCost = num_(ordered.unitCost);
    var sn = Array.isArray(ln.serialNumbers) ? ln.serialNumbers.map(function (s) { return String(s).trim(); }).filter(Boolean) : [];
    if (String(prod.is_serialized) === '1') {
      if (sn.length !== qty) throw statusError_(400, 'Serials required for serialized stock');
      for (var s2 = 0; s2 < sn.length; s2++) {
        if (serialSet[sn[s2]]) throw statusError_(409, 'Serial already registered: ' + sn[s2]);
        serialSet[sn[s2]] = true;
        serialNew.push({ id: Utilities.getUuid(), product_id: pid, serial_number: sn[s2], status: 'IN_STOCK', tx_id: '', updated_at: stamp });
      }
    }
    newReceived.push({ productId: pid, quantity: prevQty + qty, serials: sn });
    receivedValue += qty * unitCost;
    for (var tx = 0; tx < qty; tx++) {
      txItems.push({ productId: pid, name: String(ordered.name || ''), quantity: 1, unitPrice: unitCost, unitCost: unitCost, taxable: !(String(prod.taxable) === '0') });
    }
    if (String(prod.is_serialized) !== '1') {
      var onHand = num_(prod.on_hand);
      var newOnHand = onHand + qty;
      var newCost = (onHand * num_(prod.cost_price) + qty * unitCost) / newOnHand;
      if (!(newCost > 0)) newCost = unitCost;
      patches[pid] = { on_hand: newOnHand, cost_price: round2_(newCost), updated_at: stamp };
      project[pid] = { onHand: newOnHand, unitCost: round2_(newCost) };
    } else {
      project[pid] = { onHand: num_(prod.on_hand) + qty, unitCost: num_(prod.cost_price) };
    }
  }

  /* all outstanding received? */
  var allDone = items.every(function (it) {
    var post = newReceived.find(function (r) { return String(r.productId) === String(it.productId); });
    return post ? num_(post.quantity) >= num_(it.quantity) : num_(receivedById[String(it.productId)] || 0) >= num_(it.quantity);
  });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var merged = received.slice();
    for (var m = 0; m < newReceived.length; m++) {
      var hit = merged.find(function (r) { return String(r.productId) === String(newReceived[m].productId); });
      if (hit) hit.quantity = newReceived[m].quantity;
      else merged.push(newReceived[m]);
    }
    var newStatus = allDone ? 'RECEIVED' : 'PARTIAL';
    applyPatches_('PurchaseOrders', PO_HEADERS, 'id', {
      [id]: { received_json: JSON.stringify(merged), status: newStatus, updated_at: stamp },
    });
    applyPatches_('Products', PRODUCT_HEADERS, 'id', patches);
    for (var ph in patches) {
      if (!Object.prototype.hasOwnProperty.call(patches, ph)) continue;
      if (patches[ph].cost_price === undefined) continue;
      var preCost = num_(prodById[ph].cost_price);
      var postCost = num_(patches[ph].cost_price);
      if (preCost !== postCost) recordPriceChange_(prodById[ph], 'cost_price', preCost, postCost, 'po', po, String(session.uid || ''));
    }
    appendRows_('Serials', SERIAL_HEADERS, serialNew);
    if (receivedValue > 0) {
      appendRows_('Transactions', TX_HEADERS, [{
        id: Utilities.getUuid(), store_id: getStore_().id, user_id: String(session.uid || ''), device_id: 'server',
        client_tx_id: 'po-' + id.slice(0, 8) + '-' + stamp.slice(0, 10), kind: 'purchase',
        original_client_tx: '', counterparty: supplierName, grand_total: round2_(receivedValue),
        status: 'COMPLETED', tenders_json: '[]', items_json: JSON.stringify(txItems),
        note: 'Received against ' + String(po.po_number || ''), created_at: new Date().toISOString(), subtotal: '', tax_amount: '', discount_pct: '', customer_id: '',
      }]);
    }
    return {
      id: id, status: newStatus, receivedValue: round2_(receivedValue), lines: newReceived.map(function (r) {
        return { productId: String(r.productId), quantity: num_(r.quantity), onHand: project[String(r.productId)] ? project[String(r.productId)].onHand : null, unitCost: project[String(r.productId)] ? project[String(r.productId)].unitCost : null };
      }),
    };
  } finally {
    lock.releaseLock();
  }
}

function purchaseOrderCancel_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  var id = String((payload && payload.id) || '');
  var poRows = readRows_('PurchaseOrders', PO_HEADERS);
  var po = null;
  for (var i = 0; i < poRows.length; i++) {
    if (String(poRows[i].id) === id) { po = poRows[i]; break; }
  }
  if (!po) throw statusError_(404, 'Purchase order not found');
  var status = String(po.status || 'DRAFT');
  if (status !== 'DRAFT' && status !== 'ORDERED') throw statusError_(409, 'Only draft or ordered purchases can be cancelled');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    applyPatches_('PurchaseOrders', PO_HEADERS, 'id', { [id]: { status: 'CANCELLED', updated_at: new Date().toISOString() } });
    return { id: id, status: 'CANCELLED' };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ *
 *  Shifts: soft lifecycle for till reconciliation.
 *
 *  open  → float + opening frame. close → the cashier declares the physical
 *  drawer (as a denomination breakdown) and we compare it to what the POS
 *  says the drawer should hold: float + cash sales − cash out (refunds made
 *  in cash, payouts) + cash collections, scoped to the shift's user window.
 *
 *  Enforcement is deliberately soft: sales never require an open shift, so a
 *  register can never be locked out. The shift is a reconciliation record.
 * ------------------------------------------------------------------ */

function shiftDenomsValue_(denoms) {
  var denominations = [1000, 500, 200, 100, 50, 20];
  var total = 0;
  denoms = denoms || {};
  for (var d = 0; d < denominations.length; d++) {
    var qty = num_(denoms[denominations[d]]);
    if (qty > 0) total += denominations[d] * qty;
  }
  return total;
}

function shiftOpen_(session, payload) {
  var openingFloat = num_(payload && payload.openingFloat);
  if (!(openingFloat >= 0)) throw statusError_(400, 'opening_float_required');
  var note = String((payload && payload.note) || '').slice(0, 200);
  var store = getStore_();
  var shiftRows = readRows_('Shifts', SHIFTS_HEADERS);
  for (var s = 0; s < shiftRows.length; s++) {
    if (String(shiftRows[s].status) === 'OPEN' && String(shiftRows[s].user_id) === String(session.uid)) {
      throw statusError_(409, 'shift_already_open');
    }
  }
  var row = {
    id: Utilities.getUuid(),
    store_id: store.id,
    user_id: String(session.uid),
    device_id: String((payload && payload.deviceId) || ''),
    opened_at: new Date().toISOString(),
    closed_at: '',
    opening_float: openingFloat,
    cash_expected: '',
    cash_declared: '',
    over_short: '',
    tenders_json: '{}',
    note: note,
    status: 'OPEN',
  };
  appendRows_('Shifts', SHIFTS_HEADERS, [row]);
  return { shift: shift_views_(session, [row])[0], open: true, msg: 'Shift opened' };
}

function shiftClose_(session, payload) {
  var shiftId = String((payload && payload.shiftId) || '');
  var note = String((payload && payload.note) || '').slice(0, 200);
  var shiftRows = readRows_('Shifts', SHIFTS_HEADERS);
  var shift = null;
  for (var s = 0; s < shiftRows.length; s++) {
    if (shiftId && String(shiftRows[s].id) === shiftId) { shift = shiftRows[s]; break; }
    if (String(shiftRows[s].status) === 'OPEN' && String(shiftRows[s].user_id) === String(session.uid)) shift = shiftRows[s];
  }
  if (!shift) throw statusError_(404, 'no_open_shift');
  if (String(shift.user_id) !== String(session.uid)) throw statusError_(403, 'not_your_shift');
  if (String(shift.status) !== 'OPEN') throw statusError_(409, 'shift_already_closed');

  var declared = shiftDenomsValue_(payload && payload.denoms);
  var openedAt = new Date(String(shift.opened_at)).getTime();
  var txRows = readRows_('Transactions', TX_HEADERS)
    .filter(function (t) {
      return String(t.status) === 'COMPLETED'
        && String(t.user_id) === String(shift.user_id)
        && new Date(String(t.created_at)).getTime() >= openedAt
        && new Date(String(t.created_at)).getTime() <= Date.now();
    });
  var expected = num_(shift.opening_float);
  for (var t = 0; t < txRows.length; t++) {
    var tr = txRows[t];
    var kind = String(tr.kind || 'sale');
    var tenders = [];
    try { tenders = JSON.parse(tr.tenders_json || '[]'); } catch (_) {}
    if (kind === 'sale') {
      for (var k = 0; k < tenders.length; k++) {
        if (String(tenders[k].type || '') === 'cash') expected += num_(tenders[k].amount);
      }
    } else if (kind === 'payout') {
      expected -= num_(tr.grand_total);
    } else if (kind === 'refund') {
      for (var m = 0; m < tenders.length; m++) {
        if (String(tenders[m].type || '') === 'cash') expected -= num_(tenders[m].amount);
      }
    } else if (kind === 'payment') {
      for (var p = 0; p < tenders.length; p++) {
        if (String(tenders[p].type || '') === 'cash') expected += num_(tenders[p].amount);
      }
    }
  }
  var overShort = declared - expected;

  /* update the existing OPEN row in place rather than appending a second. */
  var sh = sheet_('Shifts', SHIFTS_HEADERS);
  var values = sh.getDataRange().getValues();
  var hdrs = [];
  for (var c = 0; c < values[0].length; c++) hdrs.push(String(values[0][c]));
  var idCol = hdrs.indexOf('id');
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) !== String(shift.id)) continue;
    var map = {};
    for (var cc = 0; cc < hdrs.length; cc++) map[hdrs[cc]] = values[r][cc];
    map.closed_at = new Date().toISOString();
    map.cash_expected = expected;
    map.cash_declared = declared;
    map.over_short = overShort;
    map.tenders_json = JSON.stringify((payload && payload.denoms) || {});
    map.note = map.note ? String(map.note) + ' | ' + note : note;
    map.status = 'CLOSED';
    var out = [];
    for (var cc2 = 0; cc2 < hdrs.length; cc2++) out.push(map[hdrs[cc2]] == null ? '' : String(map[hdrs[cc2]]));
    sh.getRange(r + 1, 1, 1, hdrs.length).setValues([out]);
  }
  return {
    shift: shift_views_(session, [Object.assign(shift, { closed_at: map ? map.closed_at : '', cash_expected: expected, cash_declared: declared, over_short: overShort, tenders_json: JSON.stringify((payload && payload.denoms) || {}), status: 'CLOSED' })])[0],
    open: false,
    msg: 'Shift closed',
  };
}

function shifts_(session, params) {
  var role = String(session.role || '');
  var all = String((params && params.status) || '') === 'all' || role === 'admin' || role === 'manager';
  var rows = readRows_('Shifts', SHIFTS_HEADERS)
    .filter(function (s) { return all || String(s.user_id) === String(session.uid); })
    .sort(function (a, b) { return String(b.opened_at).localeCompare(String(a.opened_at)); });
  return { shifts: shift_views_(session, rows), open: shiftOpenCount_() };
}

function shiftOpenCount_() {
  var rows = readRows_('Shifts', SHIFTS_HEADERS);
  var n = 0;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].status) === 'OPEN') n++;
  return n;
}

function shift_views_(session, rows) {
  var userRows = readRows_('Users', USER_HEADERS);
  var byUser = {};
  for (var u = 0; u < userRows.length; u++) byUser[String(userRows[u].id)] = userRows[u];
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var s = rows[i];
    var denoms = {};
    try { denoms = JSON.parse(String(s.tenders_json || '{}')); } catch (_) {}
    var u = byUser[String(s.user_id)] || {};
    out.push({
      id: String(s.id),
      userId: String(s.user_id),
      userName: String(u.first_name || '') + ' ' + String(u.last_name || ''),
      openedAt: String(s.opened_at || ''),
      closedAt: String(s.closed_at || ''),
      openingFloat: num_(s.opening_float),
      expectedCash: s.cash_expected === '' ? null : num_(s.cash_expected),
      declaredCash: s.cash_declared === '' ? null : num_(s.cash_declared),
      overShort: s.over_short === '' ? null : num_(s.over_short),
      denoms: denoms,
      note: String(s.note || ''),
      status: String(s.status || 'OPEN'),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Conflict registry — multi-device anomalies flagged for review
 * ------------------------------------------------------------------ */

function conflicts_(session, params) {
  requireRole_(session, ['admin', 'manager']);
  var rows = readRows_('Conflicts', CONFLICT_HEADERS);
  rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  var out = rows.slice(0, 200).map(function (c) {
    return {
      id: String(c.id),
      type: String(c.type || ''),
      serialNumber: String(c.serial_number || ''),
      deviceId: String(c.device_id || ''),
      loserClientTx: String(c.loser_client_tx || ''),
      winnerTx: String(c.winner_tx_id || ''),
      summary: String(c.summary || ''),
      status: String(c.status || 'OPEN'),
      createdAt: String(c.created_at || ''),
      reviewedAt: String(c.reviewed_at || ''),
      reviewedBy: String(c.reviewed_by || ''),
    };
  });
  return { conflicts: out };
}

function reviewConflict_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  var id = String(payload.id || '').trim();
  var decision = String(payload.decision || '').trim(); /* 'dismiss' | 'resolve' */
  if (!id || (decision !== 'dismiss' && decision !== 'resolve')) {
    throw statusError_(400, 'id and decision (dismiss|resolve) are required');
  }
  var status = decision === 'resolve' ? 'RESOLVED' : 'DISMISSED';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    applyPatches_('Conflicts', CONFLICT_HEADERS, 'id', {
      [id]: { status: status, reviewed_at: new Date().toISOString(), reviewed_by: session.uid },
    });
    return { ok: true, id: id, status: status };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ *
 *  Admin (admin / manager) + Drive export
 * ------------------------------------------------------------------ */

/* Change your own PIN. Any signed-in role.
 *
 * Seed PINs are written to the execution log, and Apps Script keeps that log —
 * so a seeded PIN is a credential a second party has seen and can go on seeing.
 * Telling staff to change theirs only means something if they can, without
 * going through an admin, so this takes the current PIN and replaces it.
 */
function changeOwnPin_(session, payload) {
  if (!session || !session.uid) throw statusError_(401, 'Sign in first');
  var current = String((payload && payload.currentPin) || '');
  var next = String((payload && payload.newPin) || '');
  if (!/^[0-9]{6}$/.test(next)) throw statusError_(400, 'new PIN must be 6 digits');

  var users = readRows_('Users', USER_HEADERS);
  var me = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].id) === String(session.uid)) { me = users[i]; break; }
  }
  if (!me) throw statusError_(404, 'No such user');
  if (sha256Hex_(String(me.pin_salt) + ':' + current) !== String(me.pin_hash)) {
    throw statusError_(403, 'Current PIN is incorrect');
  }

  var salt = Utilities.getUuid().split('-')[0];
  applyPatches_('Users', USER_HEADERS, 'id', {
    [me.id]: { pin_salt: salt, pin_hash: sha256Hex_(salt + ':' + next) },
  });
  revokeTokensForUser_(me.id);
  Logger.log('[orison-pos] PIN changed by ' + session.uid);
  return { ok: true };
}

/* Set a staff member's PIN. Admin only.
 *
 * Seeded PINs are random and reported once to the execution log, and
 * spreadSheet_ recreates the workbook if openById ever fails — which reseeds
 * and rotates all four. Without a reset path that leaves nobody able to sign
 * in, so this is the recovery route as well as the everyday "I forgot my PIN"
 * one. Stored the same way login checks it: salted, hashed, never in cleartext.
 */
function adminSetPin_(session, payload) {
  requireRole_(session, ['admin']);
  var email = String((payload && payload.email) || '').trim().toLowerCase();
  var pin = String((payload && payload.pin) || '');
  if (!email) throw statusError_(400, 'email is required');
  if (!/^[0-9]{6}$/.test(pin)) throw statusError_(400, 'pin must be 6 digits');

  var users = readRows_('Users', USER_HEADERS);
  var found = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email).toLowerCase() === email) { found = users[i]; break; }
  }
  if (!found) throw statusError_(404, 'No such user');

  var salt = Utilities.getUuid().split('-')[0];
  applyPatches_('Users', USER_HEADERS, 'id', {
    [found.id]: { pin_salt: salt, pin_hash: sha256Hex_(salt + ':' + pin) },
  });
  clearLoginFailures_(email);
  revokeTokensForUser_(found.id);
  Logger.log('[orison-pos] PIN reset for ' + email + ' by ' + session.uid);
  return { ok: true };
}

/* Release a staff login lockout. Admin/manager only, and it deliberately does
 * not reveal whether the address was locked — the caller is already trusted,
 * but the response should not become a way to probe which accounts exist. */
function adminUnlock_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  var email = String((payload && payload.email) || '').trim().toLowerCase();
  if (!email) throw statusError_(400, 'email is required');
  clearLoginFailures_(email);
  Logger.log('[orison-pos] lockout cleared for ' + email + ' by ' + session.uid);
  return { ok: true };
}

/* Create a staff account. Admin only.
 *
 * The PIN is generated server-side and returned exactly once in the response
 * (and logged once) so the admin can hand it off; the sheet only ever stores
 * the salted hash, so there is no second copy to leak. Staff change their own
 * PIN afterwards via /api/pin. */
function adminUsers_(session, payload) {
  requireRole_(session, ['admin']);
  var firstName = String((payload && payload.firstName) || '').trim();
  var lastName = String((payload && payload.lastName) || '').trim();
  var email = String((payload && payload.email) || '').trim().toLowerCase();
  var role = String((payload && payload.role) || 'cashier').trim();
  if (!firstName || !lastName) throw statusError_(400, 'First and last name are required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw statusError_(400, 'A valid email is required');
  if (['admin', 'manager', 'cashier'].indexOf(role) < 0) {
    throw statusError_(400, 'role must be admin, manager or cashier');
  }

  var users = readRows_('Users', USER_HEADERS);
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email).toLowerCase() === email) {
      throw statusError_(409, 'An account with that email already exists');
    }
  }

  var pin = randomPin_();
  var salt = Utilities.getUuid().split('-')[0];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    appendRows_('Users', USER_HEADERS, [{
      id: Utilities.getUuid(),
      store_id: kv_().store_id || '',
      first_name: firstName,
      last_name: lastName,
      email: email,
      pin_salt: salt,
      pin_hash: sha256Hex_(salt + ':' + pin),
      role: role,
      active: 1,
      created_at: new Date().toISOString(),
    }]);
  } finally {
    lock.releaseLock();
  }
  Logger.log('[orison-pos] new staff account ' + email + ' (' + role + ') created by ' + session.uid);
  Logger.log('[orison-pos]   one-time PIN ' + pin + ' for ' + email);
  return { ok: true, oneTimePin: pin, email: email };
}

/* Full staff roster for the Settings screen. Admin only. Deliberately omits
 * anything credential-shaped; the client only needs identity + role + state. */
function adminUsersList_(session) {
  requireRole_(session, ['admin']);
  return {
    users: readRows_('Users', USER_HEADERS).map(function (u) {
      return {
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        email: u.email,
        role: u.role,
        active: String(u.active) === '1',
      };
    }),
  };
}

/* Edit a staff account: role, active flag. Admin only. Deactivating a user
 * revokes their sessions and marks their terminals revoked so a lost device
 * stays out even after the auth-cache markers lapse. */
function adminUserPatch_(session, payload) {
  requireRole_(session, ['admin']);
  var id = String((payload && payload.id) || '');
  if (!id) throw statusError_(400, 'id is required');

  var users = readRows_('Users', USER_HEADERS);
  var found = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].id) === id) { found = users[i]; break; }
  }
  if (!found) throw statusError_(404, 'No such user');
  if (String(found.role) === 'admin' && String(session.uid) === id) {
    throw statusError_(400, 'You cannot deactivate or demote yourself');
  }

  var patch = {};
  if (typeof payload.active === 'boolean') {
    patch.active = payload.active ? 1 : 0;
  } else if (payload.active === 0 || payload.active === 1) {
    patch.active = payload.active;
  }
  if (typeof payload.role === 'string' && ['admin', 'manager', 'cashier'].indexOf(payload.role) >= 0) {
    patch.role = payload.role;
  }
  if (!Object.keys(patch).length) return { ok: true, changed: false };

  applyPatches_('Users', USER_HEADERS, 'id', { [id]: patch });
  if (patch.active === 0) { revokeTokensForUser_(id); markAllDevicesRevoked_(id); }
  else if (patch.role && patch.role !== String(found.role)) { revokeTokensForUser_(id); }
  Logger.log('[orison-pos] user ' + id + ' patched ' + JSON.stringify(patch) + ' by ' + session.uid);
  return { ok: true, changed: true };
}

/* Revoke all active sessions for the calling user.  Called on sign-out so a
 * lost or stolen device's token stops working even before its 12 h expiry. */
function logout_(session) {
  if (!session || !session.uid) throw statusError_(401, 'Sign in first');
  revokeTokensForUser_(session.uid);
  Logger.log('[orison-pos] sessions revoked for ' + session.uid);
  return { ok: true };
}

/* Revoke all sessions for a target user.  Admin only.  Used after a PIN
 * reset or when every device for a staff member is suspect.  Also marks each
 * of the user's device rows revoked, so no lost terminal can re-login once
 * the cache marker lapses. */
function adminRevoke_(session, payload) {
  requireRole_(session, ['admin']);
  var email = String((payload && payload.email) || '').trim().toLowerCase();
  if (!email) throw statusError_(400, 'email is required');
  var users = readRows_('Users', USER_HEADERS);
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email).toLowerCase() === email) {
      var uid = String(users[i].id);
      revokeTokensForUser_(uid);
      markAllDevicesRevoked_(uid);
      Logger.log('[orison-pos] sessions revoked for ' + email + ' by ' + session.uid);
      return { ok: true };
    }
  }
  throw statusError_(404, 'No such user');
}

/* List the terminals a staff member signs in from, so an admin can identify
 * the lost one (compare the short id with Settings → Terminal ID on each
 * terminal) before revoking just that device.  Admin only. */
function adminDevices_(session, payload) {
  requireRole_(session, ['admin']);
  var email = String((payload && payload.email) || '').trim().toLowerCase();
  if (!email) throw statusError_(400, 'email is required');
  var users = readRows_('Users', USER_HEADERS);
  var found = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email).toLowerCase() === email) { found = users[i]; break; }
  }
  if (!found) throw statusError_(404, 'No such user');
  var rows = readRows_('Devices', DEVICE_HEADERS);
  var devices = [];
  for (var j = 0; j < rows.length; j++) {
    if (String(rows[j].user_id) !== String(found.id)) continue;
    devices.push({
      deviceId: String(rows[j].device_id),
      firstSeen: String(rows[j].first_seen || ''),
      lastSeen: String(rows[j].last_seen || ''),
      revoked: String(rows[j].revoked) === '1',
    });
  }
  return { devices: devices };
}

/* Kill every session on one terminal: token marker (current sessions die) plus
 * the device row flag (re-login from that device is refused).  Admin only. */
function adminRevokeDevice_(session, payload) {
  requireRole_(session, ['admin']);
  var email = String((payload && payload.email) || '').trim().toLowerCase();
  var deviceId = String((payload && payload.deviceId) || '').trim();
  if (!email || !deviceId) throw statusError_(400, 'email and deviceId are required');
  var users = readRows_('Users', USER_HEADERS);
  var found = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email).toLowerCase() === email) { found = users[i]; break; }
  }
  if (!found) throw statusError_(404, 'No such user');
  if (!deviceRow_(found.id, deviceId)) throw statusError_(404, 'Device not registered');
  setDeviceRevoked_(found.id, deviceId, true);
  revokeDeviceTokens_(found.id, deviceId);
  Logger.log('[orison-pos] device revoked for ' + email + ' by ' + session.uid);
  return { ok: true };
}

function adminProducts_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  var name = String(payload.name || '').trim();
  var sku = String(payload.sku || '').trim();
  var upc = String(payload.upc || '').trim();
  var itemType = String(payload.itemType || 'product').trim();
  if (['product', 'service'].indexOf(itemType) < 0) itemType = 'product';
  if (!name || !sku) {
    throw statusError_(400, 'Name and SKU are required');
  }
  var isSerialized = itemType !== 'service' && payload.isSerialized ? 1 : 0;
  var onHand = itemType === 'service' ? 0 : num_(payload.onHand);
  var retail = num_(payload.retailPrice);
  var cost = num_(payload.costPrice);
  var locked = payload.locked ? 1 : 0;
  var taxable = payload.taxable === false ? 0 : 1;
  var reorderPoint = itemType === 'product' && !isSerialized && payload.reorderPoint != null
    ? num_(payload.reorderPoint)
    : '';

  var existing = readRows_('Products', PRODUCT_HEADERS);
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i].sku) === sku || (upc && String(existing[i].upc) === upc)) {
      throw statusError_(409, 'A product with that SKU or UPC already exists');
    }
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var now = new Date().toISOString();
    var id = Utilities.getUuid();
    appendRows_('Products', PRODUCT_HEADERS, [{
      id: id,
      sku: sku,
      upc: upc,
      name: name,
      category: String(payload.category || '').trim(),
      cost_price: cost,
      retail_price: retail,
      is_serialized: isSerialized,
      on_hand: onHand,
      item_type: itemType,
      locked: locked,
      reorder_point: reorderPoint,
      last_sold_at: '',
      active: 1,
      updated_at: now,
      taxable: taxable,
    }]);
    recordPriceChange_({ id: id, name: name }, 'cost_price', '', cost, 'create', null, String(session.uid || ''));
    recordPriceChange_({ id: id, name: name }, 'retail_price', '', retail, 'create', null, String(session.uid || ''));
    return { id: id };
  } finally {
    lock.releaseLock();
  }
}

function adminSerials_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  var productId = String(payload.productId || '');
  var serialNumbers = Array.isArray(payload.serialNumbers) ? payload.serialNumbers : [];
  if (!productId || !serialNumbers.length) {
    throw statusError_(400, 'Product id and serial numbers are required');
  }
  serialNumbers = serialNumbers
    .map(function (s) { return String(s).trim(); })
    .filter(function (s) { return s; });

  var prodRows = readRows_('Products', PRODUCT_HEADERS);
  var product = null;
  for (var i = 0; i < prodRows.length; i++) {
    if (String(prodRows[i].id) === productId) { product = prodRows[i]; break; }
  }
  if (!product) throw statusError_(404, 'Product not found');
  if (String(product.is_serialized) !== '1') {
    throw statusError_(400, 'Serials only apply to serialized products');
  }

  var serialRows = readRows_('Serials', SERIAL_HEADERS);
  var snSet = {};
  for (var j = 0; j < serialRows.length; j++) snSet[String(serialRows[j].serial_number)] = true;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var now = new Date().toISOString();
    var added = [];
    var duplicates = [];
    var newRows = [];
    for (var k = 0; k < serialNumbers.length; k++) {
      var sn = serialNumbers[k];
      if (snSet[sn]) { duplicates.push(sn); continue; }
      snSet[sn] = true;
      added.push(sn);
      newRows.push({
        id: Utilities.getUuid(),
        product_id: productId,
        serial_number: sn,
        status: 'IN_STOCK',
        tx_id: '',
        updated_at: now,
      });
    }
    appendRows_('Serials', SERIAL_HEADERS, newRows);
    applyPatches_('Products', PRODUCT_HEADERS, 'id', {
      [productId]: { updated_at: now },
    });
    return { productId: productId, added: added, duplicates: duplicates };
  } finally {
    lock.releaseLock();
  }
}

function adminInventory_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  var productId = String(payload.productId || '');
  var onHand = num_(payload.onHand);
  if (!productId || onHand < 0) throw statusError_(400, 'Product id and onHand are required');

  var prodRows = readRows_('Products', PRODUCT_HEADERS);
  var product = null;
  for (var i = 0; i < prodRows.length; i++) {
    if (String(prodRows[i].id) === productId) { product = prodRows[i]; break; }
  }
  if (!product) throw statusError_(404, 'Product not found');
  if (String(product.is_serialized) === '1') {
    throw statusError_(400, 'Use serials to manage stock for serialized products');
  }
  if (String(product.item_type) === 'service') {
    throw statusError_(400, 'Services carry no stock to manage');
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    applyPatches_('Products', PRODUCT_HEADERS, 'id', {
      [productId]: { on_hand: onHand, updated_at: new Date().toISOString() },
    });
    return { ok: true, onHand: onHand };
  } finally {
    lock.releaseLock();
  }
}

/* Admin/manager: edit a product or service's core rules (price, lock status,
   and the reorder point that drives low-stock alerts). */
/* Admin: edit the store's single sales-tax rate (a percent, 0–100). Only an
   admin — a manager changing tax policy should be a visible act. */
function adminStore_(session, payload) {
  requireRole_(session, ['admin']);
  var taxRate = num_(payload.taxRate);
  if (taxRate < 0 || taxRate > 100) {
    throw statusError_(400, 'taxRate must be between 0 and 100');
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    setKv_('store_tax_rate', taxRate);
    return getStore_();
  } finally {
    lock.releaseLock();
  }
}

function adminProductsPatch_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  var productId = String(payload.productId || '').trim();
  if (!productId) throw statusError_(400, 'productId is required');

  var prodRows = readRows_('Products', PRODUCT_HEADERS);
  var product = null;
  for (var i = 0; i < prodRows.length; i++) {
    if (String(prodRows[i].id) === productId) { product = prodRows[i]; break; }
  }
  if (!product) throw statusError_(404, 'Product/service not found');

  var patch = {};
  if (payload.retailPrice != null) patch.retail_price = num_(payload.retailPrice);
  if (payload.costPrice != null) patch.cost_price = num_(payload.costPrice);
  if (payload.locked != null) patch.locked = payload.locked ? 1 : 0;
  if (payload.taxable === true) patch.taxable = 1;
  else if (payload.taxable === false) patch.taxable = 0;
  var itemType = String(product.item_type || 'product');
  if (payload.reorderPoint !== undefined && payload.reorderPoint !== null) {
    if (itemType === 'service' || String(product.is_serialized) === '1') {
      throw statusError_(400, 'Reorder point only applies to non-serialized products');
    }
    patch.reorder_point = num_(payload.reorderPoint);
  }
  if (!Object.keys(patch).length) throw statusError_(400, 'Nothing to update');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    patch.updated_at = new Date().toISOString();
    applyPatches_('Products', PRODUCT_HEADERS, 'id', { [productId]: patch });
    if (patch.retail_price !== undefined && num_(product.retail_price) !== num_(patch.retail_price)) {
      recordPriceChange_(product, 'retail_price', num_(product.retail_price), num_(patch.retail_price), 'patch', null, String(session.uid || ''));
    }
    if (patch.cost_price !== undefined && num_(product.cost_price) !== num_(patch.cost_price)) {
      recordPriceChange_(product, 'cost_price', num_(product.cost_price), num_(patch.cost_price), 'patch', null, String(session.uid || ''));
    }
    return { ok: true, id: productId };
  } finally {
    lock.releaseLock();
  }
}

function driveExport_(session, payload, params) {
  var role = String(session.role || 'cashier');
  var isStore = role === 'admin' || role === 'manager';
  var ownerId = String(session.uid || '');
  if (!isStore && !ownerId) throw statusError_(403, 'Cannot attribute report');

  var day = String(payload.date || params.date || new Date().toISOString().slice(0, 10));
  var txRows = readRows_('Transactions', TX_HEADERS);
  var dayRows = txRows.filter(function (t) {
    if (String(t.status) !== 'COMPLETED') return false;
    if (String(t.created_at).slice(0, 10) !== day) return false;
    return isStore || String(t.user_id) === ownerId;
  });

  var userRows = readRows_('Users', USER_HEADERS);
  var nameById = {};
  for (var i = 0; i < userRows.length; i++) {
    nameById[String(userRows[i].id)] = (String(userRows[i].first_name || '') + ' ' + String(userRows[i].last_name || '')).trim();
  }

  var csv = 'created_at,id,kind,counterparty,cashier,grand_total,tax,items,tenders,note' + (isStore ? ',cost,gross_profit' : '') + '\n';
  var sales = 0, refunds = 0, payouts = 0, collections = 0, taxTotal = 0, costTotalDay = 0, gpDay = 0;
  for (var j = 0; j < dayRows.length; j++) {
    var t = dayRows[j];
    var k = String(t.kind || 'sale');
    var v = num_(t.grand_total);
    if (k === 'refund') refunds += v;
    else if (k === 'payout') payouts += v;
    else if (k === 'payment') collections += v;
    else if (k !== 'purchase') sales += v;
    if (String(t.tax_amount || '') !== '') taxTotal += num_(t.tax_amount);

    var items = [];
    try { items = JSON.parse(t.items_json || '[]'); } catch (_) {}
    var itemSummary = items
      .map(function (it) { return String(it.quantity || 1) + 'x ' + String(it.name || ''); })
      .join(' | ');
    var costTotal = 0;
    for (var itx = 0; itx < items.length; itx++) costTotal += num_(items[itx].unitCost) * (items[itx].quantity || 1);
    if (k === 'refund') costTotalDay -= costTotal;
    else costTotalDay += costTotal;
    var row = [
      csvCell_(t.created_at),
      csvCell_(t.client_tx_id),
      csvCell_(k),
      csvCell_(t.counterparty),
      csvCell_(nameById[String(t.user_id)] || ''),
      String(v),
      csvCell_(t.tax_amount),
      csvCell_(itemSummary),
      csvCell_(t.tenders_json),
      csvCell_(t.note),
    ];
    if (isStore) {
      var gp = null;
      if (k === 'refund') gp = -costTotal;
      else if (k === 'payout') gp = 0;
      else if (String(t.subtotal || '') !== '') gp = num_(t.subtotal) - Math.round(num_(t.subtotal) * num_(t.discount_pct) / 100) - costTotal;
      if (gp != null) gpDay += gp;
      row.push(String(costTotal));
      row.push(gp == null ? '' : String(gp));
    }
    csv += row.join(',') + '\n';
  }

  /* Cash summary block appended after the detail rows so managers/admins
     can reconcile drawer cash in one glance. */
  var net = sales - refunds - payouts + collections;
  csv += '\n';
  csv += ',,SUMMARY,,,,\n';
  csv += ',,SALES,,' + String(sales) + ',\n';
  csv += ',,TAX COLLECTED,,' + String(taxTotal) + ',\n';
  csv += ',,REFUNDS,,' + String(refunds) + ',\n';
  csv += ',,PAID OUT,,' + String(payouts) + ',\n';
  csv += ',,COLLECTIONS,,' + String(collections) + ',\n';
  csv += ',,NET CASH,,' + String(net) + ',\n';
  if (isStore) {
    csv += ',,TOTAL COST,,' + String(costTotalDay) + ',\n';
    csv += ',,GROSS PROFIT,,' + String(gpDay) + ',\n';
  }
  csv += ',,TRANSACTIONS,,' + String(dayRows.length) + ',\n';

  var folder = getDriveFolder_();
  var suffix = isStore ? '' : '-' + ownerId.slice(0, 8);
  var file = folder.createFile('orison-pos-sales-' + day + suffix + '.csv', csv, MimeType.CSV);
  return {
    fileId: file.getId(),
    name: file.getName(),
    url: file.getUrl(),
    rows: dayRows.length,
    day: day,
    scope: isStore ? 'store' : 'cashier',
  };
}

function getDriveFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('FOLDER_ID');
  var folder = null;
  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); } catch (_) { folder = null; }
  }
  if (!folder) {
    var it = DriveApp.getFoldersByName('Orison POS Export');
    folder = it.hasNext() ? it.next() : DriveApp.createFolder('Orison POS Export');
    props.setProperty('FOLDER_ID', folder.getId());
  }
  return folder;
}

function csvCell_(v) {
  var s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ------------------------------------------------------------------ *
 *  Utils
 * ------------------------------------------------------------------ */

function num_(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function clampPct_(x) {
  var n = Number(x) || 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/* integer-cents money. The +1e-9 epsilon swallows binary float dust the same
   way on GAS and in browsers, and this exact shape is mirrored in
   public/js/money.js so the register and the server agree to the cent. */
function cents_(n) {
  return Math.round((Number(n) || 0) * 100 + 0.000000001);
}

function saleLine_(r) {
  return {
    unitPrice: r.unitPrice,
    quantity: r.quantity,
    discountPct: clampPct_(num_(r.discountPct)),
    taxable: !(String(r.product.taxable) === '0'),
  };
}

/* One money engine. Line price is taxed only on 100% of the order's post-
   discount basis for the taxable lines — order percent prorates across all
   lines, including exempt ones, so mixed baskets never over-withhold. */
function saleTotals_(lines, orderPct, taxRate) {
  var pct = clampPct_(orderPct);
  var rate = num_(taxRate);
  var subC = 0, taxableSubC = 0, discC = 0;
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    var lineC = cents_(l.unitPrice) * Math.max(1, l.quantity);
    var lineDiscC = Math.round(lineC * clampPct_(l.discountPct) / 100);
    var netC = lineC - lineDiscC;
    discC += lineDiscC;
    subC += netC;
    if (l.taxable) taxableSubC += netC;
  }
  var orderC = Math.round(subC * pct / 100);
  var taxBasisC = Math.round(taxableSubC * (100 - pct) / 100);
  var taxC = Math.round(taxBasisC * rate / 100);
  var grandC = subC - orderC + taxC;
  return {
    subC: subC,
    discC: discC,
    taxableSubC: taxableSubC,
    orderC: orderC,
    taxC: taxC,
    grandC: grandC,
    subtotal: subC / 100,
    discount: (discC + orderC) / 100,
    tax: taxC / 100,
    total: grandC / 100,
  };
}

function uuid_() {
  return Utilities.getUuid();
}