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
 * Transactions. Set SPREADSHEET_ID in Script Properties to reuse a workbook;
 * otherwise one is created on first request. A "Orison POS Export" Drive
 * folder holds CSV exports.
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
    case '/api/products':        return products_();
    case '/api/sync/pull':       return syncPull_(session, params);
    case '/api/sync/push':       return syncPush_(session, payload);
    case '/api/transactions':    return transactions_(params);
    case '/api/conflicts':       return conflicts_(session, params);
    case '/api/conflicts/review': return reviewConflict_(session, payload);
    case '/api/admin/unlock':    return adminUnlock_(session, payload);
    case '/api/admin/products':  return adminProducts_(session, payload);
    case '/api/admin/serials':   return adminSerials_(session, payload);
    case '/api/admin/inventory': return adminInventory_(session, payload);
    case '/api/admin/products/patch': return adminProductsPatch_(session, payload);
    case '/api/drive/export':    return driveExport_(session, payload, params);
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
 *  Workbook layout
 * ------------------------------------------------------------------ */

var META_HEADERS    = ['key', 'value'];
var USER_HEADERS    = ['id', 'store_id', 'first_name', 'last_name', 'email', 'pin_salt', 'pin_hash', 'role', 'active', 'created_at'];
var PRODUCT_HEADERS = ['id', 'sku', 'upc', 'name', 'category', 'cost_price', 'retail_price', 'is_serialized', 'on_hand', 'item_type', 'locked', 'reorder_point', 'last_sold_at', 'active', 'updated_at'];
var SERIAL_HEADERS  = ['id', 'product_id', 'serial_number', 'status', 'tx_id', 'updated_at'];
var TX_HEADERS      = ['id', 'store_id', 'user_id', 'device_id', 'client_tx_id', 'kind', 'original_client_tx', 'counterparty', 'grand_total', 'status', 'tenders_json', 'items_json', 'note', 'created_at'];
var CONFLICT_HEADERS = ['id', 'store_id', 'type', 'serial_number', 'device_id', 'loser_client_tx', 'winner_tx_id', 'summary', 'status', 'created_at', 'reviewed_at', 'reviewed_by', 'dedupe_key'];

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
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    if (kv_().store_id) return;
    seed_();
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

  // Printed once, to the execution log only. This is the sole opportunity to
  // read these PINs; they are stored only as salted hashes.
  try {
    Logger.log('[orison-pos] seeded users - record these PINs now, they are not recoverable:');
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

function loginFailKey_(email) {
  return 'login_fail_' + sha256Hex_(String(email || '').toLowerCase()).slice(0, 32);
}

/* The failure record, or null when there is none or it has aged out.
 *
 * The window is measured from the LAST failure, not the first. Anchoring to the
 * first let an attacker spread four failures across the window and trip the
 * fifth just before it elapsed, earning a lockout of a second or two and then a
 * clean counter — a fifteen-minute lockout in name only.
 *
 * An expired record is deleted rather than merely ignored: Script Properties is
 * a bounded store (~500 KB) and a failed login mints a key per address tried,
 * so leaving them behind lets an attacker fill it until setProperty throws and
 * SESSION_SECRET and SPREADSHEET_ID can no longer be written. */
function loginFailureRecord_(email, props) {
  var key = loginFailKey_(email);
  var raw = props.getProperty(key);
  if (!raw) return null;
  var rec;
  try {
    rec = JSON.parse(raw);
  } catch (_) {
    props.deleteProperty(key);
    return null;
  }
  if (Date.now() - Number(rec.last || 0) >= LOGIN_LOCKOUT_MS) {
    props.deleteProperty(key);
    return null;
  }
  return rec;
}

/* Milliseconds remaining on an active lockout, or 0 when not locked out. */
function loginLockoutRemainingMs_(email) {
  var rec = loginFailureRecord_(email, PropertiesService.getScriptProperties());
  if (!rec || Number(rec.n || 0) < LOGIN_MAX_FAILURES) return 0;
  var remaining = LOGIN_LOCKOUT_MS - (Date.now() - Number(rec.last || 0));
  return remaining > 0 ? remaining : 0;
}

/* Increment under the script lock. Read-modify-write on Script Properties is
 * not atomic, and a Web App serves requests concurrently: without the lock,
 * parallel guesses all read the same count and all write n=1, so the threshold
 * is never reached and the throttle does nothing against the one attacker it
 * exists to stop. Every other mutating path in this file takes the same lock. */
function recordLoginFailure_(email) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var rec = loginFailureRecord_(email, props) || { n: 0 };
    rec.n = Number(rec.n || 0) + 1;
    rec.last = Date.now();
    props.setProperty(loginFailKey_(email), JSON.stringify(rec));
  } finally {
    lock.releaseLock();
  }
}

function clearLoginFailures_(email) {
  PropertiesService.getScriptProperties().deleteProperty(loginFailKey_(email));
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

  clearLoginFailures_(email);
  var token = signToken_({
    uid: found.id,
    role: found.role,
    exp: Date.now() + 12 * 60 * 60 * 1000,
  });
  return {
    token: token,
    user: userDto_(found),
    store: getStore_(),
  };
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
    users: readRows_('Users', USER_HEADERS).map(userDto_),
  };
}

function users_() {
  return readRows_('Users', USER_HEADERS)
    .filter(function (u) { return String(u.active) === '1'; })
    .map(userDto_);
}

function products_() {
  return productsSnapshot_();
}

function syncPull_(session, params) {
  var cfRows = readRows_('Conflicts', CONFLICT_HEADERS);
  var openConflicts = 0;
  for (var i = 0; i < cfRows.length; i++) {
    if (String(cfRows[i].status) === 'OPEN') openConflicts++;
  }
  return {
    store: getStore_(),
    users: users_(),
    products: productsSnapshot_(),
    watermark: new Date().toISOString(),
    requester: session.uid,
    openConflicts: openConflicts,
  };
}

function productsSnapshot_() {
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
      costPrice: num_(p.cost_price),
      retailPrice: num_(p.retail_price),
      isSerialized: isSerialized,
      onHand: isSerialized ? serials.length : num_(p.on_hand),
      serials: serials,
      itemType: String(p.item_type) === 'product' ? 'product' : (String(p.item_type || 'product')),
      locked: String(p.locked) === '1' || Boolean(p.locked),
      reorderPoint: p.reorder_point != null ? num_(p.reorder_point) : '',
      lastSoldAt: String(p.last_sold_at || ''),
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

    var prodById = {};
    for (var i = 0; i < prodRows.length; i++) prodById[String(prodRows[i].id)] = prodRows[i];
    var serialBySn = {};
    for (var j = 0; j < serialRows.length; j++) serialBySn[String(serialRows[j].serial_number)] = serialRows[j];
    var userIds = {};
    for (var u = 0; u < userRows.length; u++) userIds[String(userRows[u].id)] = userRows[u];

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
          resolved.push({ product: product, serial: serial, quantity: 1, unitPrice: unitPrice });
        } else if (itemType === 'service') {
          // No stock tracked for a service / offering.
          resolved.push({ product: product, serial: null, quantity: 1, unitPrice: unitPrice, onHand: null });
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
          });
        }
      }

      /* duplicate push already handled above (raw content compare) */
      var itemsJson = JSON.stringify(resolvedItems_(resolved));

      var hasErrors = errors.length > 0;
      var txId = Utilities.getUuid();
      var grandTotal = num_(tx.grandTotal);
      if (!grandTotal) {
        grandTotal = resolved.reduce(function (sum, r) { return sum + r.unitPrice * r.quantity; }, 0);
      }
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
        grand_total: grandTotal,
        status: hasErrors ? 'VOIDED' : 'COMPLETED',
        tenders_json: JSON.stringify(Array.isArray(tx.tenders) ? tx.tenders : []),
        items_json: itemsJson,
        note: note,
        created_at: created,
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

  return { results: results };
}

function resolvedItems_(resolved) {
  return resolved.map(function (r) {
    return {
      productId: String(r.product.id),
      name: String(r.product.name),
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      serialNumber: r.serial ? String(r.serial.serial_number) : null,
    };
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

/* Refund: reverses part or all of a completed sale. Serialized units return
   to IN_STOCK; non-serialized products regain stock. Guards: the original
   sale must exist, refund amount can't exceed the outstanding balance, and
   returned quantities/serials must still be outstanding. Idempotent via the
   normal device+clientTxId duplicate check. */
function processRefund_(txRows, prodRows, serialRows, store, newTxRows, newConflictRows,
                        serialPatches, productPatches, session, deviceId, tx, userRows) {
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

function transactions_(params) {
  var limit = parseInt(params && params.limit, 10);
  if (isNaN(limit) || limit < 1) limit = 100;
  limit = Math.min(limit, 500);

  var txRows = readRows_('Transactions', TX_HEADERS)
    .filter(function (t) { return String(t.status) === 'COMPLETED'; });
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

  var out = [];
  for (var j = 0; j < txRows.length && out.length < limit; j++) {
    var t = txRows[j];
    var tenders = [];
    try { tenders = JSON.parse(t.tenders_json || '[]'); } catch (_) {}
    var items = [];
    try { items = JSON.parse(t.items_json || '[]'); } catch (_) {}
    out.push({
      id: String(t.id),
      storeId: String(t.store_id),
      user_id: String(t.user_id),
      deviceId: String(t.device_id),
      clientTxId: String(t.client_tx_id || ''),
      kind: String(t.kind || 'sale'),
      originalClientTx: String(t.original_client_tx || ''),
      counterparty: String(t.counterparty || ''),
      cashier: nameById[String(t.user_id)] || '',
      grandTotal: num_(t.grand_total),
      tenders: tenders,
      createdAt: String(t.created_at),
      items: items.map(function (it) {
        return {
          productId: String(it.productId || ''),
          name: String(it.name || ''),
          quantity: it.quantity || 1,
          unitPrice: num_(it.unitPrice),
          serialNumber: it.serialNumber ? String(it.serialNumber) : null,
        };
      }),
      note: String(t.note || ''),
    });
  }
  return { transactions: out };
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
    }]);
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

  var csv = 'created_at,id,kind,counterparty,cashier,grand_total,items,tenders,note\n';
  var sales = 0, refunds = 0, payouts = 0;
  for (var j = 0; j < dayRows.length; j++) {
    var t = dayRows[j];
    var k = String(t.kind || 'sale');
    var v = num_(t.grand_total);
    if (k === 'refund') refunds += v;
    else if (k === 'payout') payouts += v;
    else sales += v;

    var items = [];
    try { items = JSON.parse(t.items_json || '[]'); } catch (_) {}
    var itemSummary = items
      .map(function (it) { return String(it.quantity || 1) + 'x ' + String(it.name || ''); })
      .join(' | ');
    csv += [
      csvCell_(t.created_at),
      csvCell_(t.client_tx_id),
      csvCell_(k),
      csvCell_(t.counterparty),
      csvCell_(nameById[String(t.user_id)] || ''),
      String(v),
      csvCell_(itemSummary),
      csvCell_(t.tenders_json),
      csvCell_(t.note),
    ].join(',') + '\n';
  }

  /* Cash summary block appended after the detail rows so managers/admins
     can reconcile drawer cash in one glance. */
  var net = sales - refunds - payouts;
  csv += '\n';
  csv += ',,SUMMARY,,,,\n';
  csv += ',,SALES,,' + String(sales) + ',\n';
  csv += ',,REFUNDS,,' + String(refunds) + ',\n';
  csv += ',,PAID OUT,,' + String(payouts) + ',\n';
  csv += ',,NET CASH,,' + String(net) + ',\n';
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
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ------------------------------------------------------------------ *
 *  Utils
 * ------------------------------------------------------------------ */

function num_(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function uuid_() {
  return Utilities.getUuid();
}