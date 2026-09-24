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
    case '/api/config':          return config_(session);
    case '/api/products':        return products_(session);
    case '/api/sync/pull':       return syncPull_(session, params);
    case '/api/sync/push':       return syncPush_(session, payload);
    case '/api/transactions':    return transactions_(session, params);
    case '/api/customers':       return customers_(session, payload, params);
    case '/api/customers/ledger': return customerLedger_(session, params);
    case '/api/customers/statement': return customerStatement_(session, params);
    case '/api/customers/receivables': return receivables_(session);
    case '/api/reports':         return reports_(session, params);
    case '/api/accounting':      return accounting_(session, params);
    case '/api/reports/sales':   return salesReport_(session, params);
    case '/api/shifts':          return shifts_(session, params);
    case '/api/shifts/open':     return shiftOpen_(session, payload);
    case '/api/shifts/close':    return shiftClose_(session, payload);
    case '/api/timeclock':       return timeClock_(session, params);
    case '/api/timeclock/punch': return timeClockPunch_(session, payload);
    case '/api/timeclock/correct': return timeClockCorrect_(session, payload);
    case '/api/shifts/force-close': return shiftForceClose_(session, payload);
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
    case '/api/admin/customers/patch': return adminCustomerPatch_(session, payload);
    case '/api/customers/balance': return customerBalance_(session, params);
    case '/api/admin/serials':   return adminSerials_(session, payload);
    case '/api/admin/inventory': return adminInventory_(session, payload);
    case '/api/admin/products/patch': return adminProductsPatch_(session, payload);
    case '/api/admin/store':   return adminStore_(session, payload);
    case '/api/suppliers':      return suppliers_(session, payload);
    case '/api/purchase-orders': return purchaseOrders_(session, payload);
    case '/api/purchase-orders/detail': return purchaseOrderDetail_(session, params);
    case '/api/purchase-orders/receive': return purchaseOrderReceive_(session, payload);
    case '/api/purchase-orders/cancel': return purchaseOrderCancel_(session, payload);
    case '/api/suppliers/payables': return supplierPayables_(session);
    case '/api/suppliers/statement': return supplierStatement_(session, params);
    case '/api/suppliers/payment': return supplierPayment_(session, payload);
    case '/api/suppliers/payment/void': return supplierPaymentVoid_(session, payload);
    case '/api/repairs':         return repairs_(session, payload, params);
    case '/api/repairs/detail':  return repairDetail_(session, params);
    case '/api/repairs/parts':   return repairParts_(session, payload);
    case '/api/repairs/needs':   return repairNeeds_(session, payload, params);
    case '/api/repairs/labour':  return repairLabour_(session, payload);
    case '/api/repairs/status':  return repairStatus_(session, payload);
    case '/api/repairs/void':    return repairVoid_(session, payload);
    case '/api/repairs/deposit': return repairDeposit_(session, payload);
    case '/api/repairs/collect': return repairCollect_(session, payload);
    case '/api/repairs/deposit-refund': return repairDepositRefund_(session, payload);
    case '/api/tradein':         return tradeIn_(session, payload);
    case '/api/tradeins':        return tradeIns_(session, params);
    case '/api/drawer/open':     return drawerOpen_(session, payload);
    case '/api/approve':         return approve_(session, payload);
    case '/api/warranty':        return warrantyLookup_(session, params);
    case '/api/marketplace/settings': return marketplaceSettings_(session, payload);
    case '/api/marketplace/import': return marketplaceImport_(session);
    case '/api/drive/export':    return driveExport_(session, payload, params);
    case '/api/price-history':   return priceHistory_(session, params);
    case '/api/inventory/aging': return inventoryAging_(session);
    case '/api/audit':           return auditLog_(session, params);
    case '/api/reports/schedule': return reportSettings_(session, payload);
    case '/api/backup/status':   return backupStatus_(session);
    case '/api/backup/run':      return backupNow_(session);
    case '/api/inventory/reorder': return inventoryReorder_(session, params);
    case '/api/inventory/health':  return inventoryHealth_(session, params);
    case '/api/admin/products/bulk-price': return adminBulkPrice_(session, payload);
    case '/api/admin/stock-take': return adminStockTake_(session, payload);
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

/* Length-independent, early-exit-free comparison for secrets. Used for the
 * session MAC and for the PIN hash: `===` on a hash leaks how many leading
 * characters matched, and there is no reason to hand that out. */
function constantEquals_(a, b) {
  var x = String(a == null ? '' : a);
  var y = String(b == null ? '' : b);
  if (x.length !== y.length) return false;
  var diff = 0;
  for (var i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function verifyToken_(token) {
  try {
    var parts = String(token || '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    if (!constantEquals_(parts[1], hmacHex_(sessionSecret_(), parts[0]))) return null;
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
var PRODUCT_HEADERS = ['id', 'sku', 'upc', 'name', 'category', 'cost_price', 'retail_price', 'is_serialized', 'on_hand', 'item_type', 'locked', 'reorder_point', 'last_sold_at', 'active', 'updated_at', 'taxable', 'warranty_days'];
var SERIAL_HEADERS  = ['id', 'product_id', 'serial_number', 'status', 'tx_id', 'updated_at', 'cost', 'source'];
var TX_HEADERS      = ['id', 'store_id', 'user_id', 'device_id', 'client_tx_id', 'kind', 'original_client_tx', 'counterparty', 'grand_total', 'status', 'tenders_json', 'items_json', 'note', 'created_at', 'subtotal', 'tax_amount', 'discount_pct', 'customer_id', 'receipt_no', 'channel', 'external_ref', 'approved_by', 'tax_inclusive', 'tax_rate', 'supplier_id', 'po_id'];
var CUSTOMERS_HEADERS = ['id', 'store_id', 'name', 'phone', 'email', 'note', 'created_at', 'credit_limit', 'trn'];
var SHIFTS_HEADERS    = ['id', 'store_id', 'user_id', 'device_id', 'opened_at', 'closed_at', 'opening_float', 'cash_expected', 'cash_declared', 'over_short', 'tenders_json', 'note', 'status', 'closed_by'];
var CONFLICT_HEADERS = ['id', 'store_id', 'type', 'serial_number', 'device_id', 'loser_client_tx', 'winner_tx_id', 'summary', 'status', 'created_at', 'reviewed_at', 'reviewed_by', 'dedupe_key'];
var SUPPLIER_HEADERS = ['id', 'store_id', 'name', 'phone', 'email', 'address', 'payment_terms', 'active', 'created_at'];
var PO_HEADERS = ['id', 'store_id', 'supplier_id', 'po_number', 'order_date', 'expected_date', 'status', 'items_json', 'received_json', 'subtotal', 'discount_pct', 'tax_amount', 'total', 'note', 'created_by', 'created_at', 'updated_at'];
var AUDIT_HEADERS = ['id', 'store_id', 'at', 'user_id', 'user_name', 'role', 'action', 'target_type', 'target_id', 'summary', 'device_id'];
var STOCKTAKE_HEADERS = ['id', 'store_id', 'session_id', 'product_id', 'product_name', 'sku', 'expected', 'counted', 'variance', 'unit_cost', 'value_delta', 'counted_by', 'note', 'created_at'];
var TIMECLOCK_HEADERS = ['id', 'store_id', 'user_id', 'device_id', 'clock_in', 'clock_out', 'minutes', 'note', 'status', 'corrected_by'];

var REPAIR_HEADERS = ['id', 'store_id', 'ticket_no', 'customer_id', 'customer_name',
  'customer_phone', 'device_make', 'device_model', 'device_serial', 'reported_fault',
  'condition_note', 'accessories', 'status', 'parts_json', 'labour_json',
  'estimate_total', 'deposit_total', 'final_total', 'assigned_to', 'note',
  'created_by', 'created_at', 'updated_at', 'promised_at', 'closed_at', 'invoice_tx_id',
  'warranty_status', 'warranty_until', 'warranty_receipt', 'needs_json'];

/* The flow a job actually walks. Order matters: the UI renders it in this
 * order, and "can this move forward" is an index comparison. */
var REPAIR_STATUSES = ['intake', 'diagnosed', 'awaiting_parts', 'in_progress',
  'ready', 'collected', 'unrepairable', 'cancelled', 'voided'];

/* Terminal means terminal: no reopening, no re-closing. A collected ticket has
 * money against it and a customer holding the device. */
var REPAIR_TERMINAL = { collected: 1, unrepairable: 1, cancelled: 1, voided: 1 };
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

/* ------------------------------------------------------------------ *
 *  Store localisation (v1.16.0): language, country, currency
 *
 *  One store, one locale. Everything that prints money — receipts, reports,
 *  the customer display, exports — formats through the store's locale and
 *  currency, and the till counts the notes and coins that currency actually
 *  circulates. Before this, figures printed as US dollars while the drawer
 *  was counted in a fixed 1000/500/200/100/50/20 ladder, so "expected vs
 *  declared" compared two different currencies.
 * ------------------------------------------------------------------ */

/* Default cash ladders, largest first. Values are in major units and may be
 * fractional (coins). An admin can replace any ladder with their own — these
 * are only what a fresh setup starts from. */
var CURRENCY_TABLE = {
  USD: { name: 'US Dollar', symbol: '$', denoms: [100, 50, 20, 10, 5, 1, 0.25, 0.1, 0.05] },
  NGN: { name: 'Nigerian Naira', symbol: '₦', denoms: [1000, 500, 200, 100, 50, 20, 10] },
  EUR: { name: 'Euro', symbol: '€', denoms: [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1] },
  GBP: { name: 'Pound Sterling', symbol: '£', denoms: [50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1] },
  CAD: { name: 'Canadian Dollar', symbol: '$', denoms: [100, 50, 20, 10, 5, 2, 1, 0.25, 0.1, 0.05] },
  AUD: { name: 'Australian Dollar', symbol: '$', denoms: [100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1] },
  INR: { name: 'Indian Rupee', symbol: '₹', denoms: [500, 200, 100, 50, 20, 10, 5, 2, 1] },
  ZAR: { name: 'South African Rand', symbol: 'R', denoms: [200, 100, 50, 20, 10, 5, 2, 1] },
  KES: { name: 'Kenyan Shilling', symbol: 'KSh', denoms: [1000, 500, 200, 100, 50, 20, 10, 5, 1] },
  GHS: { name: 'Ghanaian Cedi', symbol: 'GH₵', denoms: [200, 100, 50, 20, 10, 5, 2, 1] },
  AED: { name: 'UAE Dirham', symbol: 'AED', denoms: [1000, 500, 200, 100, 50, 20, 10, 5, 1] },
  SAR: { name: 'Saudi Riyal', symbol: 'SAR', denoms: [500, 100, 50, 10, 5, 1] },
  PKR: { name: 'Pakistani Rupee', symbol: 'Rs', denoms: [5000, 1000, 500, 100, 50, 20, 10] },
  PHP: { name: 'Philippine Peso', symbol: '₱', denoms: [1000, 500, 200, 100, 50, 20, 10, 5, 1] },
  KHR: { name: 'Cambodian Riel', symbol: '៛', denoms: [50000, 20000, 10000, 5000, 2000, 1000, 500, 100] },
  JPY: { name: 'Japanese Yen', symbol: '¥', denoms: [10000, 5000, 1000, 500, 100, 50, 10, 5, 1] },
  BRL: { name: 'Brazilian Real', symbol: 'R$', denoms: [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25] },
  MXN: { name: 'Mexican Peso', symbol: '$', denoms: [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] },
};

var DEFAULT_LOCALE = 'en-US';
var DEFAULT_COUNTRY = 'US';
var DEFAULT_CURRENCY = 'USD';

/* A BCP-47 tag this app will accept: language, optional script, optional
 * region. Deliberately strict — the value is handed to Intl on every client,
 * and a malformed tag throws there rather than here. */
function isLocaleTag_(v) {
  return /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$/.test(String(v || ''));
}

function isCountryCode_(v) {
  return /^[A-Z]{2}$/.test(String(v || ''));
}

function isCurrencyCode_(v) {
  return /^[A-Z]{3}$/.test(String(v || ''));
}

/* Validate and normalise a cash ladder: positive major-unit amounts, at most
 * two decimal places, largest first, no duplicates. A ladder with a value the
 * drawer does not hold silently corrupts a shift's declared total, so this is
 * strict rather than forgiving. */
function normaliseDenoms_(list) {
  if (Object.prototype.toString.call(list) !== '[object Array]') return null;
  if (!list.length || list.length > 20) return null;
  var seen = Object.create(null);
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var v = num_(list[i]);
    if (!(v > 0) || v > 1000000) return null;
    if (Math.round(v * 100) !== v * 100) return null;
    var key = String(Math.round(v * 100));
    if (seen[key]) return null;
    seen[key] = true;
    out.push(Math.round(v * 100) / 100);
  }
  out.sort(function (a, b) { return b - a; });
  return out;
}

function currencyDenoms_(code) {
  var entry = CURRENCY_TABLE[String(code || '').toUpperCase()];
  return entry ? entry.denoms.slice() : CURRENCY_TABLE[DEFAULT_CURRENCY].denoms.slice();
}

/* The catalogue the setup screen offers. Sent to any signed-in terminal so the
 * first-run dialog can be filled in offline-first, without a second call. */
function currencyCatalogue_() {
  var out = [];
  for (var code in CURRENCY_TABLE) {
    if (!Object.prototype.hasOwnProperty.call(CURRENCY_TABLE, code)) continue;
    out.push({
      code: code,
      name: CURRENCY_TABLE[code].name,
      symbol: CURRENCY_TABLE[code].symbol,
      denoms: CURRENCY_TABLE[code].denoms.slice(),
    });
  }
  out.sort(function (a, b) { return a.code.localeCompare(b.code); });
  return out;
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
    /* store wall-clock offset vs UTC, in minutes (−720..+840). Drives which
       calendar day a sale belongs to for reports/export bucketing. */
    tzOffsetMin: k.store_tz_offset == null || k.store_tz_offset === '' || isNaN(num_(k.store_tz_offset)) ? 0 : num_(k.store_tz_offset),
    /* localisation. `configured` is what the first-run setup dialog keys off:
       a workbook that has never had a locale saved is a store nobody has set
       up yet, and it should not quietly bill anyone in dollars by default. */
    locale: isLocaleTag_(k.store_locale) ? String(k.store_locale) : DEFAULT_LOCALE,
    country: isCountryCode_(k.store_country) ? String(k.store_country) : DEFAULT_COUNTRY,
    currency: isCurrencyCode_(k.store_currency) ? String(k.store_currency) : DEFAULT_CURRENCY,
    denoms: storeDenoms_(k),
    configured: isLocaleTag_(k.store_locale) && isCurrencyCode_(k.store_currency),
    /* the largest line discount (line and order combined) each role gives
       without a manager's approval. Admins are never limited. */
    discountLimitCashier: storePct_(k.discount_limit_cashier, DEFAULT_DISCOUNT_LIMIT_CASHIER),
    discountLimitManager: storePct_(k.discount_limit_manager, DEFAULT_DISCOUNT_LIMIT_MANAGER),
    /* Tax jurisdiction (v1.40.0). US: sales tax added on top of shelf prices.
       AE: 5 % VAT included in the shelf price, a receipt titled Tax Invoice
       carrying the shop's TRN. NONE: no tax wording at all. */
    taxJurisdiction: TAX_JURISDICTIONS[k.tax_jurisdiction] ? String(k.tax_jurisdiction) : 'US',
    taxRegNo: String(k.tax_reg_no || ''),
    pricesIncludeTax: String(k.prices_include_tax) === '1',
  };
}

var TAX_JURISDICTIONS = {
  US: { label: 'sales_tax', invoice: false, defaultRate: null, inclusive: false },
  AE: { label: 'vat', invoice: true, defaultRate: 5, inclusive: true },
  NONE: { label: 'none', invoice: false, defaultRate: 0, inclusive: false },
};

/* A UAE Tax Registration Number is 15 digits. */
function isTrn_(v) {
  return /^[0-9]{15}$/.test(String(v || ''));
}

var DEFAULT_DISCOUNT_LIMIT_CASHIER = 10;
var DEFAULT_DISCOUNT_LIMIT_MANAGER = 50;

function storePct_(v, fallback) {
  if (v == null || v === '' || isNaN(Number(v))) return fallback;
  return clampPct_(Number(v));
}

/* The saved ladder if there is a valid one, otherwise the default for the
   store's currency — never an empty ladder, which would make every declared
   drawer total zero. */
function storeDenoms_(k) {
  var saved = null;
  try { saved = normaliseDenoms_(JSON.parse(String(k.store_denoms || 'null'))); } catch (_) { saved = null; }
  if (saved) return saved;
  return currencyDenoms_(isCurrencyCode_(k.store_currency) ? k.store_currency : DEFAULT_CURRENCY);
}

/* ------------------------------------------------------------------ *
 *  Receipt numbers and the audit log
 * ------------------------------------------------------------------ */

/* A gap-free document series. The counter lives in Meta and is only ever read
 * and advanced inside the script lock that also appends the transaction, so two
 * terminals syncing at once cannot take the same number.
 *
 * Numbers are allocated at SYNC, not on the device: an offline terminal cannot
 * know what the next one is. A receipt printed before sync therefore shows its
 * client id and says the number is pending - which is the honest behaviour, and
 * is why the series has no gaps.
 *
 * Only customer documents are numbered (a sale or a refund). Internal cash
 * movements are not documents and would put holes in the series. */
var RECEIPT_PREFIX_DEFAULT = 'Orison-S';
var RECEIPT_PAD = 6;

function receiptPrefix_() {
  var k = kv_();
  return String(k.receipt_prefix == null || k.receipt_prefix === '' ? RECEIPT_PREFIX_DEFAULT : k.receipt_prefix);
}

function formatReceiptNo_(n) {
  var digits = String(Math.max(0, Math.floor(num_(n))));
  while (digits.length < RECEIPT_PAD) digits = '0' + digits;
  return receiptPrefix_() + digits;
}

var TICKET_PREFIX_DEFAULT = 'Orison-R';

function ticketPrefix_() {
  var k = kv_();
  return String(k.ticket_prefix == null || k.ticket_prefix === '' ? TICKET_PREFIX_DEFAULT : k.ticket_prefix);
}

function formatTicketNo_(n) {
  var digits = String(Math.max(0, Math.floor(num_(n))));
  while (digits.length < RECEIPT_PAD) digits = '0' + digits;
  return ticketPrefix_() + digits;
}

/* One at a time: a ticket is created with the customer standing there, so
 * there is never a batch to reserve. Caller must already hold the lock. */
function reserveTicketNumber_() {
  var k = kv_();
  var last = num_(k.repair_seq);
  if (!(last >= 0)) last = 0;
  setKv_('repair_seq', last + 1);
  return formatTicketNo_(last + 1);
}

function isDocumentKind_(kind) {
  var k = String(kind || 'sale');
  return k === 'sale' || k === 'refund';
}

/* Reserve `count` numbers in one read/write. Caller must already hold the lock. */
function reserveReceiptNumbers_(count) {
  if (!(count > 0)) return [];
  var k = kv_();
  var last = num_(k.receipt_seq);
  if (!(last >= 0)) last = 0;
  var out = [];
  for (var i = 1; i <= count; i++) out.push(formatReceiptNo_(last + i));
  setKv_('receipt_seq', last + count);
  return out;
}

/* Stamp every customer document in this batch that does not already carry a
 * number. Rewrites (a VOIDED row retried and now accepted) are included. */
function assignReceiptNumbers_(newTxRows, txRewrites) {
  var pending = [];
  var i;
  for (i = 0; i < newTxRows.length; i++) {
    var r = newTxRows[i];
    if (String(r.status) === 'COMPLETED' && isDocumentKind_(r.kind) && !String(r.receipt_no || '')) pending.push(r);
  }
  var ids = Object.keys(txRewrites || {});
  for (i = 0; i < ids.length; i++) {
    var w = txRewrites[ids[i]];
    if (String(w.status) === 'COMPLETED' && isDocumentKind_(w.kind) && !String(w.receipt_no || '')) pending.push(w);
  }
  if (!pending.length) return;
  var numbers = reserveReceiptNumbers_(pending.length);
  for (i = 0; i < pending.length; i++) pending[i].receipt_no = numbers[i];
}

/* Append-only record of who did what. There is no update or delete path in the
 * API by design: a log that can be edited is not evidence. Logging must never
 * fail the action it describes, so every call is wrapped. */
/* Staff names for the log, read once per execution: a push that audits every
   refund in a batch must not re-read the Users tab for each row. A name that
   changes mid-execution is still correct on the next request. */
var AUDIT_NAMES_ = null;

function auditName_(uid) {
  if (!uid) return '';
  if (!AUDIT_NAMES_ || !(uid in AUDIT_NAMES_)) {
    AUDIT_NAMES_ = Object.create(null);
    var users = readRows_('Users', USER_HEADERS);
    for (var i = 0; i < users.length; i++) {
      AUDIT_NAMES_[String(users[i].id)] = (String(users[i].first_name || '') + ' ' + String(users[i].last_name || '')).trim();
    }
  }
  return AUDIT_NAMES_[uid] || '';
}

function auditRow_(session, action, targetType, targetId, summary, deviceId) {
  var uid = session ? String(session.uid || '') : '';
  return {
    id: Utilities.getUuid(),
    store_id: getStore_().id,
    at: new Date().toISOString(),
    user_id: uid,
    user_name: auditName_(uid),
    role: session ? String(session.role || '') : '',
    action: String(action || ''),
    target_type: String(targetType || ''),
    target_id: String(targetId || ''),
    summary: String(summary == null ? '' : summary).slice(0, 500),
    device_id: String(deviceId || ''),
  };
}

function logAudit_(session, action, targetType, targetId, summary, deviceId) {
  try {
    appendRows_('AuditLog', AUDIT_HEADERS, [auditRow_(session, action, targetType, targetId, summary, deviceId)]);
  } catch (_) { /* never fail the action being logged */ }
}

function auditLog_(session, params) {
  requireRole_(session, ['admin']);
  var limit = parseInt(params && params.limit, 10);
  if (isNaN(limit) || limit < 1) limit = 100;
  limit = Math.min(limit, 100);
  var actor = String((params && params.userId) || '');
  var action = String((params && params.action) || '');
  var from = String((params && params.from) || '');
  var to = String((params && params.to) || '');
  var cursor = String((params && params.cursor) || '');

  var rows = readRows_('AuditLog', AUDIT_HEADERS).filter(function (r) {
    if (actor && String(r.user_id) !== actor) return false;
    if (action && String(r.action) !== action) return false;
    if (from && String(r.at || '') < from) return false;
    if (to && String(r.at || '') > to) return false;
    return true;
  });
  rows.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
  if (cursor) rows = rows.filter(function (r) { return String(r.at) < cursor; });

  var page = rows.slice(0, limit);
  var entries = page.map(function (r) {
    return {
      id: String(r.id || ''),
      at: String(r.at || ''),
      userId: String(r.user_id || ''),
      userName: String(r.user_name || ''),
      role: String(r.role || ''),
      action: String(r.action || ''),
      targetType: String(r.target_type || ''),
      targetId: String(r.target_id || ''),
      summary: String(r.summary || ''),
      deviceId: String(r.device_id || ''),
    };
  });
  return {
    entries: entries,
    nextCursor: rows.length > limit ? String(page[page.length - 1].at) : null,
    total: rows.length,
  };
}

/* ------------------------------------------------------------------ *
 *  Backups
 *
 *  The entire business lives in one spreadsheet. A bad edit, a wrong
 *  re-seed, or an account problem loses the shop's whole history, so a
 *  nightly copy lands in its own Drive folder with the date and time in
 *  the file name.
 *
 *  A silent backup failure is worse than no backup, because it is
 *  believed - so a failure emails the admins and is written to the audit
 *  log, and the Settings screen shows when the last good one ran.
 * ------------------------------------------------------------------ */

var BACKUP_FOLDER_NAME = 'POS Backup';
var BACKUP_KEEP_DAILY = 30;
var BACKUP_KEEP_MONTHLY = 12;

function getBackupFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('BACKUP_FOLDER_ID');
  var folder = null;
  if (id) {
    try { folder = DriveApp.getFolderById(id); } catch (_) { folder = null; }
  }
  if (!folder) {
    var it = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
    folder = it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER_NAME);
    props.setProperty('BACKUP_FOLDER_ID', folder.getId());
  }
  return folder;
}

/* Local wall-clock stamp, because a shop reads its own clock, not UTC. */
function backupStamp_(date, tzMin) {
  var d = new Date(date.getTime() + (num_(tzMin) || 0) * 60000);
  function two(n) { return (n < 10 ? '0' : '') + n; }
  return d.getUTCFullYear() + '-' + two(d.getUTCMonth() + 1) + '-' + two(d.getUTCDate())
    + '_' + two(d.getUTCHours()) + two(d.getUTCMinutes());
}

function backupFileName_(stamp) {
  return 'Orison-POS-Backup_' + stamp + '.xlsx';
}

/* A real copy of the workbook, not loose CSVs: it restores by opening it. */
function runBackup_(session, reason) {
  var store = getStore_();
  var stamp = backupStamp_(new Date(), store.tzOffsetMin);
  var name = backupFileName_(stamp);
  var folder = getBackupFolder_();
  var ssFile = DriveApp.getFileById(spreadSheet_().getId());
  var copy = ssFile.makeCopy(name, folder);

  var info = {
    name: name,
    fileId: copy.getId(),
    url: copy.getUrl(),
    at: new Date().toISOString(),
    reason: String(reason || 'manual'),
  };
  setKv_('backup_last_at', info.at);
  setKv_('backup_last_name', name);
  logAudit_(session, 'backup.run', 'file', info.fileId, name + ' (' + info.reason + ')', '');
  pruneBackups_(folder);
  return info;
}

/* Keep the last 30 dailies and the first backup of each of the last 12 months.
   Drive filling up silently is its own kind of backup failure. */
function pruneBackups_(folder) {
  try {
    var files = [];
    var it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    while (it.hasNext()) {
      var f = it.next();
      var nm = f.getName();
      if (nm.indexOf('Orison-POS-Backup_') !== 0) continue;
      files.push({ file: f, name: nm, stamp: nm.slice('Orison-POS-Backup_'.length).replace('.xlsx', '') });
    }
    files.sort(function (a, b) { return b.stamp.localeCompare(a.stamp); });

    var keep = {};
    var i;
    for (i = 0; i < files.length && i < BACKUP_KEEP_DAILY; i++) keep[files[i].name] = true;
    var monthsSeen = {};
    for (i = 0; i < files.length; i++) {
      var month = files[i].stamp.slice(0, 7);
      if (monthsSeen[month]) continue;
      monthsSeen[month] = true;
      if (Object.keys(monthsSeen).length <= BACKUP_KEEP_MONTHLY) keep[files[i].name] = true;
    }
    for (i = 0; i < files.length; i++) {
      if (!keep[files[i].name]) files[i].file.setTrashed(true);
    }
  } catch (_) { /* pruning must never fail a backup that already succeeded */ }
}

/* Called by the nightly time-driven trigger. Never throws: a trigger that
   throws stops being scheduled, which would silently end all backups. */
function backupDaily() {
  try {
    runBackup_(null, 'scheduled');
  } catch (err) {
    var msg = (err && err.message) || String(err);
    try {
      setKv_('backup_last_error', new Date().toISOString() + ' ' + msg);
      logAudit_(null, 'backup.failed', 'file', '', msg, '');
      notifyAdmins_('Orison POS backup FAILED',
        'The nightly backup did not run.\n\n' + msg + '\n\nThe shop is running without a current backup.');
    } catch (_) {}
  }
}

/* One place that finds the admins to tell. */
function notifyAdmins_(subject, body) {
  var users = readRows_('Users', USER_HEADERS);
  var to = [];
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].active) !== '1') continue;
    if (String(users[i].role) !== 'admin') continue;
    var email = String(users[i].email || '');
    if (email) to.push(email);
  }
  if (!to.length) return 0;
  MailApp.sendEmail({ to: to.join(','), subject: subject, body: body });
  return to.length;
}

/* Install the nightly trigger. Safe to run repeatedly - it clears its own
   previous trigger first rather than stacking duplicates. */
function installBackupTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'backupDaily') ScriptApp.deleteTrigger(existing[i]);
  }
  ScriptApp.newTrigger('backupDaily').timeBased().atHour(2).everyDays(1).create();
  return { installed: true, hour: 2 };
}

function backupStatus_(session) {
  requireRole_(session, ['admin']);
  var k = kv_();
  return {
    lastAt: String(k.backup_last_at || ''),
    lastName: String(k.backup_last_name || ''),
    lastError: String(k.backup_last_error || ''),
    folder: BACKUP_FOLDER_NAME,
    keepDaily: BACKUP_KEEP_DAILY,
    keepMonthly: BACKUP_KEEP_MONTHLY,
  };
}

function backupNow_(session) {
  requireRole_(session, ['admin']);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw statusError_(503, 'Storage busy, retry');
  try {
    return runBackup_(session, 'manual');
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ *
 *  Scheduled reports
 *
 *  Daily, weekly and monthly figures emailed to the admins the owner
 *  nominates. The numbers come from reports_(), so a scheduled report and
 *  the Reports screen can never disagree.
 * ------------------------------------------------------------------ */

var REPORT_CADENCES = ['daily', 'weekly', 'monthly'];

function reportRecipients_() {
  var raw = String(kv_().report_recipients || '');
  if (!raw) return [];
  return raw.split(',').map(function (x) { return String(x).trim(); }).filter(function (x) { return x; });
}

function reportCadenceOn_(cadence) {
  var k = kv_();
  var key = 'report_' + cadence;
  /* default off: nobody should start receiving mail because a release shipped */
  return String(k[key] || '') === '1';
}

/* Local calendar day, offset by the store's own clock. */
function reportDayKey_(date, tzMin) {
  return localDayKey_(date.toISOString(), num_(tzMin) || 0);
}

/* The window a cadence covers, ending yesterday - a "daily" report sent at
 * 06:00 is about the day that just closed, not the one that just started. */
function reportWindow_(cadence, now, tzMin) {
  var end = new Date(now.getTime() - 86400000);
  var start = new Date(end.getTime());
  if (cadence === 'weekly') start = new Date(end.getTime() - 6 * 86400000);
  else if (cadence === 'monthly') start = new Date(end.getTime() - 29 * 86400000);
  return { from: reportDayKey_(start, tzMin), to: reportDayKey_(end, tzMin) };
}

function money_(v, store) {
  return (store.currencySymbol || '') + num_(v).toFixed(2);
}

function reportEmailBody_(cadence, win, data, store) {
  var s = data.summary || {};
  var lines = [];
  lines.push(store.name + ' — ' + cadence + ' report');
  lines.push(win.from === win.to ? win.from : win.from + ' to ' + win.to);
  lines.push('');
  lines.push('Gross sales      ' + money_(s.grossSales, store));
  lines.push('Refunds          ' + money_(s.refunds, store));
  lines.push('Cash out         ' + money_(s.cashOut, store));
  lines.push('  paid out       ' + money_(s.payouts, store));
  lines.push('  cash pick-up   ' + money_(s.pickups, store));
  lines.push('  staff expense  ' + money_(s.expenses, store));
  lines.push('Collections      ' + money_(s.collections, store));
  lines.push('Deposits held    ' + money_(s.depositsHeld, store));
  lines.push('Net revenue      ' + money_(s.netRevenue, store));
  lines.push('Gross profit     ' + money_(s.grossProfit, store));
  lines.push('Sales            ' + s.salesCount + '   units ' + s.units);
  lines.push('Average ticket   ' + money_(s.avgTicket, store));
  lines.push('');

  var cashiers = data.byCashier || [];
  if (cashiers.length) {
    lines.push('By cashier');
    for (var c = 0; c < cashiers.length; c++) {
      lines.push('  ' + cashiers[c].userName + '  ' + money_(cashiers[c].sales, store)
        + '  (' + cashiers[c].count + ' sales)');
    }
    lines.push('');
  }
  var top = data.topProducts || [];
  if (top.length) {
    lines.push('Top sellers');
    for (var t = 0; t < top.length && t < 5; t++) {
      lines.push('  ' + top[t].name + '  ' + top[t].units + ' ×  ' + money_(top[t].sales, store));
    }
    lines.push('');
  }
  lines.push('The period CSV is attached.');
  lines.push('');
  lines.push('An AYiN Advisors Project');
  return lines.join('\n');
}

function reportCsv_(data) {
  var rows = [];
  rows.push(['date', 'sales', 'count', 'gross_profit'].join(','));
  var byDay = data.byDay || [];
  for (var i = 0; i < byDay.length; i++) {
    rows.push([csvCell_(byDay[i].date), num_(byDay[i].sales).toFixed(2),
      String(byDay[i].count), num_(byDay[i].gp).toFixed(2)].join(','));
  }
  return rows.join('\n');
}

/* Build and send one cadence. Returns what happened so the trigger and the
 * manual "send now" button can both report it honestly. */
function sendScheduledReport_(cadence, session) {
  if (REPORT_CADENCES.indexOf(cadence) < 0) throw statusError_(400, 'unknown cadence');
  var store = getStore_();
  var to = reportRecipients_();
  if (!to.length) return { sent: false, reason: 'no_recipients', cadence: cadence };

  var win = reportWindow_(cadence, new Date(), store.tzOffsetMin);
  var data = reports_({ role: 'admin', uid: (session && session.uid) || '' }, { from: win.from, to: win.to });
  var subject = store.name + ' — ' + cadence + ' report — '
    + (win.from === win.to ? win.from : win.from + ' to ' + win.to);

  MailApp.sendEmail({
    to: to.join(','),
    subject: subject,
    body: reportEmailBody_(cadence, win, data, store),
    attachments: [{
      fileName: 'orison-' + cadence + '-' + win.to + '.csv',
      mimeType: 'text/csv',
      content: reportCsv_(data),
    }],
  });
  setKv_('report_last_' + cadence, new Date().toISOString());
  logAudit_(session, 'report.sent', 'report', cadence,
    'Sent ' + cadence + ' report for ' + win.from + '..' + win.to + ' to ' + to.length + ' recipient(s)', '');
  return { sent: true, cadence: cadence, recipients: to.length, window: win };
}

/* Trigger entry points. Each swallows its own failure for the same reason the
 * backup does: a trigger that throws stops being scheduled. */
function reportDaily()   { runScheduledReport_('daily'); }
function reportWeekly()  { runScheduledReport_('weekly'); }
function reportMonthly() { runScheduledReport_('monthly'); }

function runScheduledReport_(cadence) {
  try {
    if (!reportCadenceOn_(cadence)) return;
    sendScheduledReport_(cadence, null);
  } catch (err) {
    var msg = (err && err.message) || String(err);
    try {
      setKv_('report_last_error', new Date().toISOString() + ' ' + cadence + ': ' + msg);
      logAudit_(null, 'report.failed', 'report', cadence, msg, '');
    } catch (_) {}
  }
}

function installReportTriggers() {
  var wanted = { reportDaily: 1, reportWeekly: 1, reportMonthly: 1 };
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (wanted[existing[i].getHandlerFunction()]) ScriptApp.deleteTrigger(existing[i]);
  }
  ScriptApp.newTrigger('reportDaily').timeBased().atHour(6).everyDays(1).create();
  ScriptApp.newTrigger('reportWeekly').timeBased().atHour(7).everyWeeks(1).create();
  ScriptApp.newTrigger('reportMonthly').timeBased().atHour(8).everyDays(30).create();
  return { installed: 3 };
}

function reportSettings_(session, payload) {
  requireRole_(session, ['admin']);
  var isWrite = payload && (payload.recipients !== undefined || payload.cadence !== undefined || payload.sendNow);

  if (payload && payload.sendNow) {
    return sendScheduledReport_(String(payload.sendNow), session);
  }

  if (isWrite) {
    if (payload.recipients !== undefined) {
      var list = String(payload.recipients || '').split(',')
        .map(function (x) { return String(x).trim(); })
        .filter(function (x) { return x; });
      for (var i = 0; i < list.length; i++) {
        if (list[i].indexOf('@') < 1 || list[i].indexOf('.') < 0) {
          throw statusError_(400, 'Not an email address: ' + list[i]);
        }
      }
      if (list.length > 10) throw statusError_(400, 'At most 10 recipients');
      setKv_('report_recipients', list.join(','));
      logAudit_(session, 'report.recipients', 'report', '', list.join(', ') || '(none)', '');
    }
    if (payload.cadence !== undefined) {
      var c = String(payload.cadence);
      if (REPORT_CADENCES.indexOf(c) < 0) throw statusError_(400, 'unknown cadence');
      setKv_('report_' + c, payload.on ? '1' : '0');
      logAudit_(session, 'report.cadence', 'report', c, (payload.on ? 'on' : 'off'), '');
    }
  }

  var k = kv_();
  return {
    recipients: reportRecipients_(),
    daily: reportCadenceOn_('daily'),
    weekly: reportCadenceOn_('weekly'),
    monthly: reportCadenceOn_('monthly'),
    lastDaily: String(k.report_last_daily || ''),
    lastWeekly: String(k.report_last_weekly || ''),
    lastMonthly: String(k.report_last_monthly || ''),
    lastError: String(k.report_last_error || ''),
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

/* The deploy step. Run it once from the Apps Script editor after pasting this
 * file: the first run approves the script's Google permissions, creates the
 * workbook and seeds the starter accounts, and their one-time PINs appear in
 * this run's log. Safe to run again - a seeded workbook is left alone and one
 * with sales in it is refused. Every request also seeds on its own, so this
 * exists to make the first run deliberate and its PINs easy to find. */
function setup() {
  SEED_CREDENTIALS = [];
  ensureSeed_();
  var fresh = SEED_CREDENTIALS.length > 0;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
  Logger.log('[orison-pos] workbook ready: ' + id +
             (fresh ? '' : ' - already seeded, no new PINs issued'));
  return { spreadsheetId: id, seeded: fresh };
}

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
    // taking the lock on every request from here on. The users-count guard
    // also crash-proofs a partial seed: if that property write was skipped
    // (gated by the 50s Apps Script max-execution, a lock timeout, ...) a
    // second run must see the already-created accounts and NOT seed twice.
    if (kv_().store_id && readRows_('Users', USER_HEADERS).length > 0) { props.setProperty('SEEDED', '1'); return; }
    /* A workbook with trade in it must never be re-seeded by accident: seeding
       rewrites users and the catalog, and one wrong run in the Apps Script
       editor would take the shop's history with it. */
    if (readRows_('Transactions', TX_HEADERS).length > 0
        && props.getProperty('CONFIRM_RESEED') !== 'yes') {
      throw statusError_(409, 'Refusing to seed over a workbook that already has transactions. Set the CONFIRM_RESEED script property to "yes" if this is really intended.');
    }
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
  if (!found || !constantEquals_(sha256Hex_(String(found.pin_salt) + ':' + pin), found.pin_hash)) {
    // Counted, but deliberately NOT delayed. Utilities.sleep bills against the
    // script's daily runtime quota and holds a simultaneous-execution slot, so
    // a delay long enough to matter is itself a way to take the till offline;
    // it also pushed responses past the client's 8s timeout, which api.js maps
    // to "offline" and hides the real error. The attempt cap does the work.
    recordLoginFailure_(email);
    /* Only the attempt that trips the lockout is logged. Every failure would let
       anyone who knows an address fill the audit log from outside. */
    if (loginLockoutRemainingMs_(email) > 0) {
      logAudit_(found ? { uid: found.id, role: found.role } : null, 'auth.locked', 'user',
        found ? String(found.id) : '', 'Sign-in locked after repeated wrong PINs for ' + email, deviceId);
    }
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
  logAudit_({ uid: found.id, role: found.role }, 'auth.login', 'user', String(found.id), 'Signed in', deviceId);
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

/* ------------------------------------------------------------------ *
 *  Manager approval
 *
 *  A cashier asks, a manager or admin enters their own email and PIN on the
 *  cashier's screen, and the server hands back a signed approval for exactly
 *  one thing: this refund, this discount, this drawer open. The cashier stays
 *  signed in, the approver is recorded against the transaction, and the grant
 *  is in the audit log.
 *
 *  An approval is signed over a different message than a session token
 *  ('approval:' + body), so it can never be replayed as a session. It is bound
 *  to an action and a reference the terminal chose before asking (the refund's
 *  clientTxId, the sale's clientTxId, a drawer-open nonce), lives 24 hours so a
 *  refund queued by a dropped connection still lands, and is re-checked when
 *  used: an approver switched off or demoted since no longer counts.
 *
 *  PINs are only ever checked by the server, so approvals need a connection.
 * ------------------------------------------------------------------ */

var APPROVAL_ACTIONS = { refund: 1, discount: 1, drawer: 1, deposit_refund: 1, credit: 1, tradein: 1 };
var APPROVAL_TTL_MS = 24 * 3600 * 1000;

/* A sale can need two approvals at once (a big discount charged past a credit
   limit), so a transaction carries `approvals: { discount, credit }`. A lone
   `approval` still counts for whichever action it was granted for. */
function approvalFor_(tx, action) {
  var map = tx && tx.approvals;
  if (map && typeof map === 'object' && map[action]) return map[action];
  return tx ? tx.approval : null;
}

function signApproval_(payload) {
  var body = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  return body + '.' + hmacHex_(sessionSecret_(), 'approval:' + body);
}

/* The approval, or null. `userRows` lets a batch push check the approver
   without re-reading Users per row. */
function verifyApproval_(token, action, ref, userRows) {
  try {
    var parts = String(token || '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    if (!constantEquals_(parts[1], hmacHex_(sessionSecret_(), 'approval:' + parts[0]))) return null;
    var p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    if (!p || p.typ !== 'approval' || p.a !== action || String(p.r) !== String(ref)) return null;
    if (!p.exp || Date.now() > p.exp) return null;
    var users = userRows || readRows_('Users', USER_HEADERS);
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (String(u.id) !== String(p.u)) continue;
      if (String(u.active) !== '1') return null;
      if (String(u.role) !== 'admin' && String(u.role) !== 'manager') return null;
      p.approverRole = String(u.role);
      p.approverName = (String(u.first_name || '') + ' ' + String(u.last_name || '')).trim();
      return p;
    }
    return null;
  } catch (_) {
    return null;
  }
}

/* The largest discount a role may give on a line without asking, as a percent
   of the line (line and order discounts combined). Admins are never limited. */
function discountLimitFor_(role, store) {
  if (role === 'admin') return 100;
  if (role === 'manager') return store.discountLimitManager;
  return store.discountLimitCashier;
}

/* One line's discount as the customer sees it: 10 % off the line and then
   10 % off the order is 19 % off, not 20 %. */
function effectiveDiscountPct_(linePct, orderPct) {
  var l = clampPct_(linePct) / 100;
  var o = clampPct_(orderPct) / 100;
  return Math.round((1 - (1 - l) * (1 - o)) * 10000) / 100;
}

/* Single-use for approvals that do not create a transaction (a drawer open, a
   deposit refund): the reference is remembered for the approval's lifetime. */
function consumeApproval_(p) {
  var cache = CacheService.getScriptCache();
  var key = 'apv:' + String(p.a) + ':' + String(p.r);
  if (cache.get(key)) return false;
  cache.put(key, '1', 21600);
  return true;
}

function approve_(session, payload) {
  if (!session || !session.uid) throw statusError_(401, 'Sign in first');
  payload = payload || {};
  var email = String(payload.email || '').trim().toLowerCase();
  var pin = String(payload.pin || '');
  var action = String(payload.action || '');
  var ref = String(payload.ref || '').trim().slice(0, 160);
  if (!APPROVAL_ACTIONS[action]) throw statusError_(400, 'Unknown approval');
  if (!ref) throw statusError_(400, 'An approval needs a reference');
  if (!email || !pin) throw statusError_(400, 'Enter the approver\'s email and PIN');

  /* The same throttle as sign-in: an approval prompt must not become a way to
     guess a manager's PIN five attempts at a time, forever. */
  var lockedMs = loginLockoutRemainingMs_(email);
  if (lockedMs > 0) {
    throw statusError_(429, 'Too many failed attempts. Try again in ' + Math.ceil(lockedMs / 60000) + ' minute(s).');
  }
  var users = readRows_('Users', USER_HEADERS);
  var found = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email).toLowerCase() === email && String(users[i].active) === '1') { found = users[i]; break; }
  }
  if (!found || !constantEquals_(sha256Hex_(String(found.pin_salt) + ':' + pin), found.pin_hash)) {
    recordLoginFailure_(email);
    if (loginLockoutRemainingMs_(email) > 0) {
      logAudit_(session, 'auth.locked', 'user', found ? String(found.id) : '', 'Locked after repeated wrong approval PINs for ' + email, payload.deviceId);
    }
    /* 403, not 401: the cashier's own session is fine, and the terminal signs
       anyone out on a 401. A manager fumbling their PIN must not end the sale. */
    throw statusError_(403, 'Approval refused - wrong email or PIN');
  }
  clearLoginFailures_(email);
  var role = String(found.role);
  if (role !== 'admin' && role !== 'manager') throw statusError_(403, 'Only a manager or admin can approve');
  if (String(found.id) === String(session.uid)) throw statusError_(403, 'Someone else has to approve this');

  var store = getStore_();
  var pct = null;
  if (action === 'discount') {
    pct = Math.round(clampPct_(num_(payload.pct)) * 100) / 100;
    if (!(pct > 0)) throw statusError_(400, 'Say how much discount is being approved');
    if (pct > discountLimitFor_(role, store)) throw statusError_(403, 'That discount is over your own limit - an admin has to approve it');
  }
  var amount = payload.amount == null || payload.amount === '' ? null : Math.round(num_(payload.amount) * 100) / 100;

  var now = Date.now();
  var p = { typ: 'approval', a: action, r: ref, u: String(found.id), by: String(session.uid), iat: now, exp: now + APPROVAL_TTL_MS };
  if (pct != null) p.p = pct;
  if (amount != null) p.m = amount;
  var name = (String(found.first_name || '') + ' ' + String(found.last_name || '')).trim();
  logAudit_({ uid: found.id, role: role }, 'approval.granted', 'approval', ref,
    action + (pct != null ? ' ' + pct + '%' : '') + (amount != null ? ' ' + amount : '') +
    ' for ' + auditName_(String(session.uid)) + (payload.note ? ' — ' + String(payload.note).slice(0, 160) : ''),
    payload.deviceId);
  return { approval: signApproval_(p), approver: { name: name, role: role }, expiresAt: new Date(p.exp).toISOString() };
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

/* The roster is only for those who manage it. Handing every cashier the name
 * and email of every colleague, next to a login lockout that triggers on five
 * wrong PINs, let one cashier lock the whole shop out of the till. */
function config_(session) {
  var out = {
    store: getStore_(),
    /* the setup dialog offers exactly what the server will accept, so the two
       cannot drift into a currency the client can pick and the server rejects. */
    currencies: currencyCatalogue_(),
    users: [],
  };
  if (isStoreRole_(session && session.role)) {
    out.users = readRows_('Users', USER_HEADERS)
      .filter(function (u) { return String(u.active) === '1'; })
      .map(userDto_);
  }
  return out;
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
      warrantyDays: productWarrantyDays_(p),
    });
  }
  return out;
}

/* Warranty (v1.41.0): 1 year for brand-new hardware, 30 days otherwise, none
   for a service. A product with no setting yet reads as the default for its
   type, so nothing sold before this release silently loses cover. */
var WARRANTY_CHOICES = { 0: 1, 30: 1, 365: 1 };

function productWarrantyDays_(p) {
  var v = p ? p.warranty_days : '';
  if (v !== '' && v != null && WARRANTY_CHOICES[num_(v)]) return num_(v);
  return String(p && p.item_type) === 'service' ? 0 : 30;
}

function parseWarrantyDays_(v) {
  if (v == null || v === '') return null;
  var n = num_(v);
  if (!WARRANTY_CHOICES[n]) throw statusError_(400, 'Warranty must be none, 30 days or 1 year');
  return n;
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
    /* in-place rewrites for retried VOIDED sales (see clientKey handling) */
    var txRewrites = {};
    /* same-batch duplicate guard: rows accepted earlier in THIS batch must be
       visible to later batch entries, exactly like rows from earlier pushes. */
    var batchSeen = {};

    var nowMs = Date.now();
    var skewFuture = 15 * 60 * 1000;      /* > 15 min ahead of server clock */
    var skewPast = 90 * 24 * 3600 * 1000; /* older than 90 days */

    for (var bi = 0; bi < batch.length; bi++) {
      var tx = batch[bi];
      var errors = [];
      var resolved = [];
      var items = Array.isArray(tx.items) ? tx.items : [];
      var clientKey = deviceId + '::' + String(tx.clientTxId || '');

      /* duplicate push for the same device+client id? (compare raw content).
         A COMPLETED row is answered idempotently. A VOIDED row, however, was
         a *failed* push — the terminal never saw accepted:true, so it keeps
         retrying, and the blocker (locked product, serial claimed elsewhere)
         may have cleared since. Those must fall through to a fresh re-evaluation,
         never an ALREADY_SYNCED lie. */
      var existing = batchSeen[clientKey] || deviceTx[clientKey];
      if (existing && String(existing.status) !== 'VOIDED') {
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
      /* re-processing a VOIDED row: reuse its id so a retry that now succeeds
         rewrites the original failure in place instead of stacking a second
         transaction row (and a retry that still fails leaves the sheet alone). */
      var reuseId = (existing && String(existing.status) === 'VOIDED') ? String(existing.id) : '';

      var kind = String(tx.kind || 'sale');
      /* Deposits are written only by the repair endpoints, under the lock, against
         a ticket. A device pushing one directly would otherwise fall through to
         the sale path and be recorded as revenue. */
      if (SERVER_ONLY_KINDS[kind]) {
        pushResult_(results, tx, { errors: [{ reason: 'server_only_kind' }] });
        continue;
      }
      /* A 'deposit' tender settles a sale against money already held on a repair
         ticket. Accepting one from a device would let goods leave with nothing
         in the drawer and the report showing the sale as paid. */
      if (hasDepositTender_(tx.tenders)) {
        pushResult_(results, tx, { errors: [{ reason: 'deposit_tender_not_allowed' }] });
        continue;
      }
      if (isCashOutKind_(kind)) {
        pushResult_(results, tx, processCashOut_(session, store, newTxRows, tx, deviceId, userRows, kind));
        indexAccepted_(batchSeen, deviceId, clientKey, tx, newTxRows);
        continue;
      }
      if (kind === 'payment') {
        pushResult_(results, tx, processPayment_(session, store, newTxRows, tx, deviceId, userRows, customerIds));
        indexAccepted_(batchSeen, deviceId, clientKey, tx, newTxRows);
        continue;
      }
      /* Sold Elsewhere is a manager's tool. A cashier's device recording an
         online or marketplace sale is refused here, not just hidden on screen. */
      if (kind === 'sale' && normaliseChannel_(tx.channel) !== 'in_store' && !isStoreRole_(session && session.role)) {
        pushResult_(results, tx, { errors: [{ reason: 'unauthorized_role' }] });
        continue;
      }
      if (kind === 'refund') {
        pushResult_(results, tx, processRefund_(
          txRows, prodRows, serialRows, store, newTxRows, newConflictRows,
          serialPatches, productPatches, session, deviceId, tx, userRows));
        indexAccepted_(batchSeen, deviceId, clientKey, tx, newTxRows);
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
          /* a traded-in device was bought at its own price: that is its cost */
          resolved.push({ product: product, serial: serial, quantity: 1, unitPrice: unitPrice, discountPct: clampPct_(num_(item.discountPct)),
            unitCost: num_(serial.cost) > 0 ? num_(serial.cost) : undefined });
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
      var txId = reuseId || Utilities.getUuid();
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

      /* Discount limits (v1.37.0). The deepest discount on any line - line and
         order combined - must be within the seller's limit, or carry a manager's
         approval for at least that much, bound to this sale. Checked on the
         server because the register is only advisory. */
      var saleApprovedBy = '';
      if (!hasErrors && resolved.length) {
        var deepest = 0;
        for (var dl = 0; dl < resolved.length; dl++) {
          deepest = Math.max(deepest, effectiveDiscountPct_(resolved[dl].discountPct, orderPct));
        }
        var sellerRole = String((session && session.role) || 'cashier');
        if (deepest > discountLimitFor_(sellerRole, store) + 0.001) {
          var dTok = approvalFor_(tx, 'discount');
          var dAppr = dTok ? verifyApproval_(dTok, 'discount', String(tx.clientTxId || ''), userRows) : null;
          if (!dAppr || num_(dAppr.p) + 0.001 < deepest || discountLimitFor_(dAppr.approverRole, store) + 0.001 < deepest) {
            errors.push({ reason: 'discount_over_limit', pct: deepest });
            hasErrors = true;
          } else {
            saleApprovedBy = String(dAppr.u);
          }
        }
      }

      /* Credit limits (v1.38.0). Charging to account past a customer's limit
         needs a manager's 'credit' approval for this sale, covering at least
         the overage. A limit of 0 means no limit. Earlier sales in this same
         batch count, so a split batch cannot slip under it. */
      var terms = termsAmount_(tx.tenders);
      if (!hasErrors && terms > 0 && custId && customerIds[custId] && num_(customerIds[custId].credit_limit) > 0) {
        var limitC = num_(customerIds[custId].credit_limit);
        var owed = customerMoney_(txRows.concat(newTxRows), custId).account;
        var over = round2_(owed + terms - limitC);
        if (over > 0.005) {
          var cTok = approvalFor_(tx, 'credit');
          var cAppr = cTok ? verifyApproval_(cTok, 'credit', String(tx.clientTxId || ''), userRows) : null;
          if (!cAppr || (cAppr.m != null && cents_(cAppr.m) < cents_(over))) {
            errors.push({ reason: 'credit_over_limit', over: over });
            hasErrors = true;
          } else if (!saleApprovedBy) {
            saleApprovedBy = String(cAppr.u);
          }
        }
      }
      var taxRate = num_(store.taxRate);
      var totals = null;
      if (newFormat && !hasErrors && resolved.length) {
        totals = saleTotals_(resolved.map(saleLine_), orderPct, taxRate, store.pricesIncludeTax);
      }
      var grandTotal = totals
        ? totals.total
        : (num_(tx.grandTotal) || resolved.reduce(function (sum, r) { return sum + r.unitPrice * r.quantity; }, 0));
      var userId = userIds[String(tx.userId || '')] ? String(tx.userId) : fallbackUserId_(userRows, session);
      var created = String(tx.createdAt || new Date().toISOString());
      var createdMs = new Date(created).getTime();
      var clockFlagged = !isNaN(createdMs) && (createdMs > nowMs + skewFuture || createdMs < nowMs - skewPast);

      var note = hasErrors
        ? 'Conflict rejected: ' + errors.map(function (er) { return er.reason; }).join(', ')
        : (tx.note || '');

      var rowObj = {
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
        channel: normaliseChannel_(tx.channel),
        external_ref: String(tx.externalRef || '').slice(0, 120),
        approved_by: saleApprovedBy,
        tax_inclusive: totals && totals.inclusive ? 1 : '',
        tax_rate: totals ? taxRate : '',
      };
      if (reuseId && hasErrors) {
        /* still blocked: report the fresh failure against the SAME transaction
           id and leave the existing VOIDED row untouched — no new row. */
        results.push({
          clientTxId: tx.clientTxId,
          transactionId: String(existing.id),
          accepted: false,
          status: 'VOIDED',
          conflicts: errors.slice(),
        });
        continue;
      }
      if (reuseId) {
        txRewrites[String(existing.id)] = rowObj;
      } else {
        newTxRows.push(rowObj);
      }

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

      /* index accepted rows so a repeated clientTxId later in this same batch
         resolves to ALREADY_SYNCED (identical) or DUPLICATE_CLIENT (differs),
         exactly as if it had been pushed in an earlier request. */
      if (!reuseId && !hasErrors) batchSeen[clientKey] = rowObj;
    }

    assignReceiptNumbers_(newTxRows, txRewrites);
    backfillReceiptResults_(results, newTxRows, txRewrites);
    appendRows_('Transactions', TX_HEADERS, newTxRows);
    if (Object.keys(txRewrites).length) applyPatches_('Transactions', TX_HEADERS, 'id', txRewrites);
    if (newConflictRows.length) appendRows_('Conflicts', CONFLICT_HEADERS, newConflictRows);
    applyPatches_('Serials', SERIAL_HEADERS, 'id', serialPatches);
    applyPatches_('Products', PRODUCT_HEADERS, 'id', productPatches);
  } finally {
    lock.releaseLock();
  }

  /* Money that leaves the business or returns to a customer is a trail the
     owner reads in the audit log, not only a row in the ledger. Written after
     the lock: the log must never hold up a till's push. */
  if (newTxRows && newTxRows.length) auditPushedMoney_(session, newTxRows, deviceId);

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
       (and legacy rows) stay compact. An explicit per-line cost override
       (refunds re-using the original sale's captured cost) wins. */
    var uc = (typeof r.unitCost === 'number' && r.unitCost > 0)
      ? r.unitCost
      : Math.round(num_(r.product.cost_price) * 100) / 100;
    if (uc > 0) it.unitCost = uc;
    /* the warranty the customer was sold, fixed at the moment of sale */
    if (!r.isRefundLine) {
      var wdays = productWarrantyDays_(r.product);
      /* one year is for brand-new hardware; a device the shop bought used gets 30 days at most */
      if (r.serial && String(r.serial.source) === 'tradein') wdays = Math.min(wdays, USED_WARRANTY_MAX);
      if (wdays > 0) it.warrantyDays = wdays;
    }
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

/* Store-local calendar-day helpers. created_at timestamps are UTC, so a store
   at UTC+1 that rings a sale at 23:30Z is doing it on the NEXT local day.
   Every "which calendar day?" question — reports windows, byDay buckets, the
   Drive export date — shifts by the store's tzOffsetMin before slicing. */
function localDayKey_(iso, tzMin) {
  var ms = new Date(String(iso || '')).getTime();
  if (isNaN(ms)) return String(iso || '').slice(0, 10);
  return new Date(ms + (tzMin || 0) * 60000).toISOString().slice(0, 10);
}

function dateOnlyToIso_(dateStr, tzMin, endOfDay) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) return String(dateStr);
  var base = Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return new Date((endOfDay ? base + 86399999 : base) - (tzMin || 0) * 60000).toISOString();
}

/* The numbers are allocated after the push loop has already built its results,
   so copy them back onto the matching entries - a terminal that syncs online
   then knows its receipt number without a second round trip. */
function backfillReceiptResults_(results, newTxRows, txRewrites) {
  var byClient = {};
  var i;
  for (i = 0; i < newTxRows.length; i++) {
    if (newTxRows[i].receipt_no) byClient[String(newTxRows[i].client_tx_id)] = String(newTxRows[i].receipt_no);
  }
  var ids = Object.keys(txRewrites || {});
  for (i = 0; i < ids.length; i++) {
    var w = txRewrites[ids[i]];
    if (w && w.receipt_no) byClient[String(w.client_tx_id)] = String(w.receipt_no);
  }
  for (i = 0; i < results.length; i++) {
    var hit = byClient[String(results[i].clientTxId)];
    if (hit) results[i].receiptNo = hit;
  }
}

var AUDITED_PUSH_KINDS_ = { refund: 'refund', payout: 'cash.payout', pickup: 'cash.pickup', expense: 'cash.expense', payment: 'customer.payment' };

function auditPushedMoney_(session, rows, deviceId) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var action = AUDITED_PUSH_KINDS_[String(r.kind)];
    if (!action || String(r.status) !== 'COMPLETED') continue;
    var who = String(r.counterparty || '');
    var summary = String(r.kind) + ' ' + num_(r.grand_total) +
      (r.receipt_no ? ' · ' + r.receipt_no : '') +
      (r.original_client_tx ? ' · against ' + r.original_client_tx : '') +
      (who ? ' · ' + who : '') +
      (r.note ? ' — ' + String(r.note).slice(0, 160) : '');
    out.push(auditRow_(session, action, 'transaction', String(r.id), summary, deviceId));
  }
  if (!out.length) return;
  try { appendRows_('AuditLog', AUDIT_HEADERS, out); } catch (_) { /* never fail a push over its log */ }
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

/* Record a just-accepted payout/payment/refund row into the batch-level
   duplicate index so a repeated clientTxId later in the same batch resolves
   to ALREADY_SYNCED (identical) or DUPLICATE_CLIENT (differs) instead of
   double-applying. Rejected rows are never indexed — a failed retry must stay
   re-evaluable. */
function indexAccepted_(batchSeen, deviceId, clientKey, tx, newTxRows) {
  var last = newTxRows[newTxRows.length - 1];
  if (!last) return;
  if (String(last.device_id) !== deviceId) return;
  if (String(last.client_tx_id || '') !== String(tx.clientTxId || '')) return;
  batchSeen[clientKey] = last;
}

/* Cash payout ("money out"): vendor payment, cash pick-up, or expense. Only
   admin/manager. Recorded like any transaction for the cash audit trail. */
/* The three ways cash leaves the drawer. They behave identically - same guard,
 * same maths, same cash tender - and differ only in the reason recorded, which
 * is the whole point: an owner can ask "how much went out as staff expense?"
 * without reading every note by hand. */
var CASH_OUT_KINDS = { payout: 'Paid out', pickup: 'Cash pick-up', expense: 'Staff expense' };

/* Ledger kinds that only the server writes. Never accepted from a device. */
var SERVER_ONLY_KINDS = { deposit: 1, deposit_refund: 1, tradein: 1, supplier_payment: 1 };

function hasDepositTender_(tenders) {
  if (!Array.isArray(tenders)) return false;
  for (var i = 0; i < tenders.length; i++) {
    if (tenders[i] && String(tenders[i].type || '') === 'deposit') return true;
  }
  return false;
}

function isCashOutKind_(kind) {
  return Object.prototype.hasOwnProperty.call(CASH_OUT_KINDS, String(kind));
}

function processCashOut_(session, store, newTxRows, tx, deviceId, userRows, kind) {
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
    user_id: userIds[String(tx.userId || '')] ? String(tx.userId) : fallbackUserId_(userRows, session),
    device_id: deviceId,
    client_tx_id: String(tx.clientTxId || ''),
    kind: isCashOutKind_(kind) ? String(kind) : 'payout',
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
    user_id: userIds[String(tx.userId || '')] ? String(tx.userId) : fallbackUserId_(userRows, session),
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
  var approval = null;
  if (role !== 'admin' && role !== 'manager') {
    /* A cashier's refund goes through with a manager's approval bound to this
       refund's own clientTxId (v1.37.0). Without one it is refused as before. */
    var rTok = approvalFor_(tx, 'refund');
    approval = rTok ? verifyApproval_(rTok, 'refund', String(tx.clientTxId || ''), userRows) : null;
    if (!approval) return { errors: [{ reason: rTok ? 'approval_invalid' : 'unauthorized_role' }] };
  }
  /* Services provided are not refunded - the work was done. Checked first, so
     the refusal says why rather than surfacing as some later arithmetic error,
     and a refund that includes a service is refused whole. */
  var serviceIds = {};
  for (var sv = 0; sv < prodRows.length; sv++) {
    if (String(prodRows[sv].item_type) === 'service') serviceIds[String(prodRows[sv].id)] = true;
  }
  var refundItems = Array.isArray(tx.items) ? tx.items : [];
  var serviceErrors = [];
  for (var si = 0; si < refundItems.length; si++) {
    var sid = String((refundItems[si] || {}).productId || '');
    if (sid === 'repair-labour' || serviceIds[sid]) {
      serviceErrors.push({ productId: sid, reason: 'service_not_refundable' });
    }
  }
  if (serviceErrors.length) return { errors: serviceErrors };
  var errors = [];
  var originalClientTx = String(tx.originalClientTx || '');
  /* A sale and its refund can arrive in the same batch (an offline terminal
     can void a sale it rung up minutes earlier while still offline). Validate
     against the persisted ledger PLUS anything already accepted earlier in
     this batch, so prior refunds within the batch count toward "remaining". */
  var allRows = txRows.concat(newTxRows);
  var original = null;
  for (var i = 0; i < allRows.length; i++) {
    var r = allRows[i];
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
  for (var p = 0; p < allRows.length; p++) {
    var pr = allRows[p];
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
  var origCostByProduct = {};
  var origCostBySerial = Object.create(null);
  for (var oi = 0; oi < origItems.length; oi++) {
    var o = origItems[oi];
    var opk = String(o.productId || '');
    if (!byProduct[opk]) byProduct[opk] = { qty: 0, serials: [] };
    byProduct[opk].qty += o.quantity || 1;
    if (o.serialNumber) byProduct[opk].serials.push(String(o.serialNumber));
    if (o.serialNumber && typeof o.unitCost === 'number' && o.unitCost > 0) origCostBySerial[String(o.serialNumber)] = o.unitCost;
    if (typeof o.unitCost === 'number' && o.unitCost > 0 && !origCostByProduct[opk]) {
      origCostByProduct[opk] = o.unitCost;
    }
  }
  for (var pr2 = 0; pr2 < allRows.length; pr2++) {
    var pr2r = allRows[pr2];
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
      resolved.push({ product: product, serial: serial, quantity: 1, unitPrice: unitPrice, unitCost: origCostBySerial[sn] || origCostByProduct[String(product.id)] });
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
      resolved.push({ product: product, serial: null, quantity: qty, unitPrice: unitPrice, restoreStock: restoreStock, unitCost: origCostByProduct[String(product.id)] });
    }
  }
  if (errors.length) return { errors: errors, original: original };
  if (approval && approval.m != null && cents_(refundAmount) > cents_(approval.m)) {
    return { errors: [{ reason: 'approval_amount_exceeded' }], original: original };
  }

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
  for (var rl = 0; rl < resolved.length; rl++) resolved[rl].isRefundLine = true;
  var txId = Utilities.getUuid();
  newTxRows.push({
    id: txId,
    store_id: store.id,
    user_id: userIds[String(tx.userId || '')] ? String(tx.userId) : fallbackUserId_(userRows, session),
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
    approved_by: approval ? String(approval.u) : '',
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

function fallbackUserId_(userRows, session) {
  /* prefer the authenticated caller when they're a real account: a payout/payment
     recorded under the first admin instead of the actual cashier misattributes
     money. Falls back to the first active admin, then any user, then ''. */
  if (session && session.uid) {
    for (var s2 = 0; s2 < userRows.length; s2++) {
      if (String(userRows[s2].id) === String(session.uid)) return String(userRows[s2].id);
    }
  }
  for (var i = 0; i < userRows.length; i++) {
    if (userRows[i].role === 'admin' && String(userRows[i].active) === '1') return String(userRows[i].id);
  }
  return userRows.length ? String(userRows[0].id) : '';
}

/* ------------------------------------------------------------------ *
 *  Transactions list
 * ------------------------------------------------------------------ */

/* Does this row match the typed search? Evaluated on the server so a terminal
 * never has to hold the whole ledger to find one sale. Matches the receipt
 * number, the customer, the cashier, an item name, a serial/IMEI, the note,
 * the kind, and an exact amount. */
function txMatchesQuery_(t, q, custName, cashier) {
  if (!q) return true;
  var needle = q.toLowerCase();
  var hay = [
    String(t.receipt_no || ''),
    String(t.client_tx_id || ''),
    String(t.external_ref || ''),
    String(t.channel || ''),
    String(t.counterparty || ''),
    String(t.note || ''),
    String(t.kind || 'sale'),
    String(custName || ''),
    String(cashier || ''),
  ].join(' ').toLowerCase();
  if (hay.indexOf(needle) >= 0) return true;

  /* an amount typed as 949 or 949.00 should find the sale either way */
  var asNum = Number(q);
  if (!isNaN(asNum) && asNum !== 0 && Math.abs(num_(t.grand_total) - asNum) < 0.005) return true;

  var items = itobjs_(t.items_json);
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var line = (String(it.name || '') + ' ' + String(it.serialNumber || '')).toLowerCase();
    if (line.indexOf(needle) >= 0) return true;
  }
  return false;
}

/* Where a sale happened. Stock has to come off whether the customer stood at
 * the counter or clicked Buy It Now somewhere else, and the shop needs to be
 * able to tell the two apart afterwards. */
var SALE_CHANNELS = ['in_store', 'online', 'marketplace', 'phone', 'other'];

function normaliseChannel_(c) {
  var v = String(c || 'in_store');
  return SALE_CHANNELS.indexOf(v) >= 0 ? v : 'in_store';
}

var TX_PAGE_MAX = 100;

function transactions_(session, params) {
  /* Hard cap. Reading the whole ledger into a terminal is the thing that
     stops working as the shop grows, so no caller may ask for more. */
  var limit = parseInt(params && params.limit, 10);
  if (isNaN(limit) || limit < 1) limit = TX_PAGE_MAX;
  limit = Math.min(limit, TX_PAGE_MAX);
  var q = String((params && params.q) || '').trim();
  var cursor = String((params && params.cursor) || '');
  var from = String((params && params.from) || '');
  var to = String((params && params.to) || '');
  var kindFilter = String((params && params.kind) || '');

  /* cashier scope: own rows only; admin/manager see the full store ledger. */
  var isStore = isStoreRole_(session && session.role);
  /* A cashier checking a return or a warranty claim can look up any sale or
     refund in the shop by a search of at least four characters (v1.38.0).
     Customer documents only - never cash-outs - and never cost or margin. */
  var lookup = !isStore && String((params && params.lookup) || '') === '1';
  if (lookup) {
    if (q.length < 4) throw statusError_(400, 'Type at least four characters to look up a sale');
    limit = Math.min(limit, 20);
  }

  var qUserRows = readRows_('Users', USER_HEADERS);
  var qNameById = {};
  for (var qu = 0; qu < qUserRows.length; qu++) {
    qNameById[String(qUserRows[qu].id)] =
      (String(qUserRows[qu].first_name || '') + ' ' + String(qUserRows[qu].last_name || '')).trim();
  }
  var qCustRows = readRows_('Customers', CUSTOMERS_HEADERS);
  var qCustById = {};
  for (var qc = 0; qc < qCustRows.length; qc++) qCustById[String(qCustRows[qc].id)] = String(qCustRows[qc].name || '');

  var txRows = readRows_('Transactions', TX_HEADERS)
    .filter(function (t) {
      if (String(t.status) !== 'COMPLETED') return false;
      if (lookup) {
        var lk = String(t.kind || 'sale');
        if (lk !== 'sale' && lk !== 'refund') return false;
      } else if (!isStore && String(t.user_id) !== String(session.uid)) return false;
      if (kindFilter && String(t.kind || 'sale') !== kindFilter) return false;
      if (from && String(t.created_at || '') < from) return false;
      if (to && String(t.created_at || '') > to) return false;
      return txMatchesQuery_(t, q, qCustById[String(t.customer_id || '')], qNameById[String(t.user_id)]);
    });
  txRows.sort(function (a, b) {
    return String(b.created_at).localeCompare(String(a.created_at));
  });
  var matched = txRows.length;
  /* keyset paging on created_at: stable as new sales arrive at the top. */
  if (cursor) {
    txRows = txRows.filter(function (t) { return String(t.created_at) < cursor; });
  }

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
    else if (isCashOutKind_(kindName)) grossProfit = 0;
    else if (hasMoney) {
      /* net revenue = line subtotal − order discount; margin = that − cost. */
      grossProfit = round2_(saleNetExTax_(t) - costTotal);
    }
    out.push({
      id: String(t.id),
      storeId: String(t.store_id),
      user_id: String(t.user_id),
      deviceId: String(t.device_id),
      clientTxId: String(t.client_tx_id || ''),
      receiptNo: String(t.receipt_no || ''),
      channel: normaliseChannel_(t.channel),
      externalRef: String(t.external_ref || ''),
      kind: kindName,
      originalClientTx: String(t.original_client_tx || ''),
      counterparty: String(t.counterparty || ''),
      cashier: nameById[String(t.user_id)] || '',
      approvedBy: t.approved_by ? (nameById[String(t.approved_by)] || '') : '',
      taxInclusive: String(t.tax_inclusive) === '1',
      taxRate: t.tax_rate === '' || t.tax_rate == null ? null : num_(t.tax_rate),
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
        if (num_(it.warrantyDays) > 0) mapped.warrantyDays = num_(it.warrantyDays);
        return mapped;
      }),
      note: String(t.note || ''),
    });
    var cust = t.customer_id ? custById[String(t.customer_id)] : null;
    if (cust) {
      out[out.length - 1].customerId = String(t.customer_id);
      out[out.length - 1].customer = String(cust.name || '');
      out[out.length - 1].customerTrn = String(cust.trn || '');
    }
    /* Gross profit is a manager/admin figure and stays off cashier responses. */
    if (isStore) out[out.length - 1].grossProfit = grossProfit;
    if (lookup) out[out.length - 1].own = String(t.user_id) === String(session.uid);
  }
  return {
    transactions: out,
    matched: matched,
    nextCursor: txRows.length > out.length ? String(out[out.length - 1].createdAt) : null,
    query: q,
    lookup: lookup,
  };
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
      out.push(customerDto_(c));
    }
  }
  return { customers: out };
}

/* What a customer's completed transactions add up to. "account" is what they
   owe on Net-30, "credit" the store credit they hold, "balance" the two netted
   (positive = they owe the shop). One definition, used by the ledger, the
   checkout balance and the credit-limit check at push. */
function customerMoney_(txRows, cid) {
  var credit = 0, account = 0;
  for (var j = 0; j < txRows.length; j++) {
    var t = txRows[j];
    if (String(t.status) !== 'COMPLETED' || String(t.customer_id || '') !== cid) continue;
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
    } else if (kind === 'refund' || kind === 'tradein') {
      for (var m = 0; m < tenders.length; m++) {
        if (String(tenders[m].type || '') === 'store_credit') credit += num_(tenders[m].amount);
      }
    } else if (kind === 'payment') {
      account -= num_(t.grand_total);
    }
  }
  return { credit: round2_(credit), account: round2_(account), balance: round2_(account - credit) };
}

function termsAmount_(tenders) {
  var sum = 0;
  for (var i = 0; i < (tenders || []).length; i++) {
    var ty = String((tenders[i] || {}).type || '');
    if (ty === 'net30' || ty === 'account') sum += num_(tenders[i].amount);
  }
  return round2_(sum);
}

function customerDto_(c) {
  return {
    id: String(c.id), name: String(c.name || ''), phone: String(c.phone || ''), email: String(c.email || ''),
    creditLimit: num_(c.credit_limit) > 0 ? num_(c.credit_limit) : 0,
    trn: String(c.trn || ''),
  };
}

/* What the cashier needs before charging to account: what is owed, the limit,
   and the headroom. No ledger lines, no history - those stay with managers. */
function customerBalance_(session, params) {
  if (!session || !session.uid) throw statusError_(401, 'Sign in first');
  var cid = String((params && params.customerId) || '');
  if (!cid) throw statusError_(400, 'customerId is required');
  var rows = readRows_('Customers', CUSTOMERS_HEADERS);
  var cust = null;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === cid) { cust = rows[i]; break; }
  if (!cust) throw statusError_(404, 'Customer not found');
  var money = customerMoney_(readRows_('Transactions', TX_HEADERS), cid);
  var dto = customerDto_(cust);
  return {
    customer: dto,
    owes: money.account,
    storeCredit: money.credit,
    balance: money.balance,
    creditLimit: dto.creditLimit,
    available: dto.creditLimit > 0 ? round2_(Math.max(0, dto.creditLimit - money.account)) : null,
  };
}

/* Managers set a customer's credit limit and correct their details. */
function adminCustomerPatch_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  payload = payload || {};
  var id = String(payload.id || '');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var rows = readRows_('Customers', CUSTOMERS_HEADERS);
    var cust = null;
    for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === id) { cust = rows[i]; break; }
    if (!cust) throw statusError_(404, 'Customer not found');
    var patch = {};
    var changes = [];
    if (payload.name != null) {
      var nm = String(payload.name).trim().slice(0, 120);
      if (!nm) throw statusError_(400, 'Customer name is required');
      if (nm !== String(cust.name)) { patch.name = nm; changes.push('name ' + cust.name + ' → ' + nm); }
    }
    ['phone', 'email', 'note'].forEach(function (f) {
      if (payload[f] != null && String(payload[f]).trim() !== String(cust[f] || '')) {
        patch[f] = String(payload[f]).trim().slice(0, 200);
        changes.push(f + ' changed');
      }
    });
    if (payload.trn != null) {
      var trn = String(payload.trn).replace(/\s+/g, '');
      if (trn && getStore_().taxJurisdiction === 'AE' && !isTrn_(trn)) throw statusError_(400, 'A UAE TRN is 15 digits');
      if (trn !== String(cust.trn || '')) { patch.trn = trn; changes.push('TRN ' + (cust.trn || '—') + ' → ' + (trn || '—')); }
    }
    if (payload.creditLimit != null && payload.creditLimit !== '') {
      var lim = num_(payload.creditLimit);
      if (!(lim >= 0)) throw statusError_(400, 'A credit limit cannot be negative');
      lim = round2_(lim);
      if (lim !== num_(cust.credit_limit)) { patch.credit_limit = lim; changes.push('credit limit ' + num_(cust.credit_limit) + ' → ' + lim); }
    }
    if (!changes.length) return { customer: customerDto_(cust), changed: false };
    applyPatches_('Customers', CUSTOMERS_HEADERS, 'id', { [id]: patch });
    for (var k in patch) cust[k] = patch[k];
    logAudit_(session, 'customer.update', 'customer', id, String(cust.name) + ': ' + changes.join(', '), payload.deviceId);
    return { customer: customerDto_(cust), changed: true };
  } finally {
    lock.releaseLock();
  }
}

function adminCustomers_(session, payload) {
  /* any signed-in role since v1.38.0: a cashier with a new customer at the
     counter must be able to open their account. Ledgers stay with managers. */
  if (!session || !session.uid) throw statusError_(401, 'Sign in first');
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
  if (payload && payload.trn) {
    var newTrn = String(payload.trn).replace(/\s+/g, '');
    if (getStore_().taxJurisdiction === 'AE' && !isTrn_(newTrn)) throw statusError_(400, 'A UAE TRN is 15 digits');
    row.trn = newTrn;
  }
  if (isStoreRole_(session.role) && payload && payload.creditLimit != null && payload.creditLimit !== '') {
    row.credit_limit = Math.max(0, round2_(num_(payload.creditLimit)));
  }
  appendRows_('Customers', CUSTOMERS_HEADERS, [row]);
  logAudit_(session, 'customer.create', 'customer', row.id, row.name + (row.phone ? ' · ' + row.phone : ''), payload && payload.deviceId);
  return { customer: customerDto_(row) };
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
    } else if (kind === 'refund' || kind === 'tradein') {
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
    customer: customerDto_(cust),
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
    } else if (kind === 'refund' || kind === 'tradein') {
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
      : kind === 'tradein' ? 'Trade-in'
      : isCashOutKind_(kind) ? CASH_OUT_KINDS[String(kind)]
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
      } else if (kind === 'refund' || kind === 'tradein') {
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

/* ------------------------------------------------------------------ *
 *  Marketplace sync from a Google Sheet (v1.42.0)
 *
 *  The shop keeps its marketplace orders in one spreadsheet. An "Orders" tab
 *  holds one row per line; the POS imports rows whose Status is empty, grouped
 *  by order reference, as sales on the marketplace channel - through the same
 *  push path as a till, so stock moves, serials are claimed first-committed-
 *  wins and a receipt number is issued. Each row gets its Status written back.
 *  A "Stock" tab is rewritten on every run so listings can follow the shelf.
 *
 *  Prices come in as the platform charged them and no POS tax is added: the
 *  platform collects the tax. Re-importing is harmless - an order's clientTxId
 *  is derived from its reference, so a second push is ALREADY_SYNCED.
 * ------------------------------------------------------------------ */

var MARKET_ORDER_HEADERS = ['Order ref', 'Date', 'Channel', 'SKU', 'IMEI / Serial', 'Quantity', 'Unit price', 'Status', 'Note'];
var MARKET_STOCK_HEADERS = ['SKU', 'Name', 'Available', 'Price', 'Updated'];
var MARKET_DEVICE = 'marketplace-sheet';

function sheetIdFrom_(v) {
  var s = String(v || '').trim();
  var m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{10,}$/.test(s) ? s : '';
}

function marketplaceBook_() {
  var id = PropertiesService.getScriptProperties().getProperty('MARKETPLACE_SHEET_ID');
  if (!id) throw statusError_(409, 'No marketplace sheet is set up');
  var ss;
  try { ss = SpreadsheetApp.openById(id); } catch (_) { ss = null; }
  if (!ss) throw statusError_(404, 'Could not open the marketplace sheet - check the link, and that the account running the POS can edit it');
  var orders = ss.getSheetByName('Orders');
  if (!orders) {
    orders = ss.insertSheet('Orders');
    orders.getRange(1, 1, 1, MARKET_ORDER_HEADERS.length).setValues([MARKET_ORDER_HEADERS]);
  }
  var stock = ss.getSheetByName('Stock');
  if (!stock) stock = ss.insertSheet('Stock');
  return { id: id, ss: ss, orders: orders, stock: stock };
}

function marketplaceLast_() {
  try { return JSON.parse(String(kv_().marketplace_last || 'null')); } catch (_) { return null; }
}

function marketplaceSettings_(session, payload) {
  payload = payload || {};
  var isAdmin = String(session && session.role) === 'admin';
  if (payload.sheet != null) {
    requireRole_(session, ['admin']);
    var id = sheetIdFrom_(payload.sheet);
    if (!id) throw statusError_(400, 'Paste the Google Sheets link or its ID');
    var props = PropertiesService.getScriptProperties();
    var before = props.getProperty('MARKETPLACE_SHEET_ID');
    props.setProperty('MARKETPLACE_SHEET_ID', id);
    try {
      marketplaceBook_();
    } catch (e) {
      if (before) props.setProperty('MARKETPLACE_SHEET_ID', before); else props.deleteProperty('MARKETPLACE_SHEET_ID');
      throw e;
    }
    setKv_('marketplace_user', String(session.uid));
    logAudit_(session, 'marketplace.settings', 'marketplace', id, 'Marketplace sheet set', payload.deviceId);
  } else {
    requireRole_(session, ['admin', 'manager']);
  }
  var sheetId = PropertiesService.getScriptProperties().getProperty('MARKETPLACE_SHEET_ID') || '';
  return {
    configured: !!sheetId,
    sheetId: isAdmin ? sheetId : '',
    url: isAdmin && sheetId ? 'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit' : '',
    last: marketplaceLast_(),
    headers: MARKET_ORDER_HEADERS,
  };
}

var MARKET_REASONS = {
  unknown_product: 'SKU not found or inactive',
  serial_not_found: 'IMEI / serial not found for that SKU',
  serial_not_in_stock: 'IMEI / serial already sold',
  product_locked: 'Product is locked',
  server_busy: 'The POS was busy - it will retry next run',
  unauthorized_role: 'Not allowed',
};

function marketplaceImportRun_(session) {
  var book = marketplaceBook_();
  var values = book.orders.getDataRange().getValues();
  if (!values.length) return { imported: 0, errors: 0, already: 0, rows: 0 };
  var head = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var col = {};
  for (var h = 0; h < MARKET_ORDER_HEADERS.length; h++) col[MARKET_ORDER_HEADERS[h]] = head.indexOf(MARKET_ORDER_HEADERS[h].toLowerCase());
  if (col['Order ref'] < 0 || col['SKU'] < 0 || col['Unit price'] < 0 || col['Status'] < 0) {
    throw statusError_(400, 'The Orders tab needs the columns Order ref, SKU, Unit price and Status');
  }
  var cell = function (row, name) { return col[name] >= 0 ? row[col[name]] : ''; };

  var groups = [];
  var byRef = Object.create(null);
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var ref = String(cell(row, 'Order ref') || '').trim();
    if (!ref || String(cell(row, 'Status') || '').trim()) continue;
    var g = byRef[ref];
    if (!g) { g = byRef[ref] = { ref: ref, rows: [], lines: [], error: '' }; groups.push(g); }
    g.rows.push(r);
    g.lines.push(row);
  }
  if (!groups.length) {
    writeMarketplaceStock_(book);
    var none = { at: new Date().toISOString(), imported: 0, errors: 0, already: 0, rows: 0 };
    setKv_('marketplace_last', JSON.stringify(none));
    return none;
  }

  var prodRows = readRows_('Products', PRODUCT_HEADERS);
  var bySku = Object.create(null);
  for (var p = 0; p < prodRows.length; p++) if (String(prodRows[p].active) === '1') bySku[String(prodRows[p].sku).toLowerCase()] = prodRows[p];

  var batch = [];
  /* units already promised to earlier orders in this run */
  var taken = Object.create(null);
  /* orders already in the ledger: re-pushed for an honest "already imported",
     never re-checked against stock they themselves already took */
  var seen = Object.create(null);
  var txAll = readRows_('Transactions', TX_HEADERS);
  for (var ti = 0; ti < txAll.length; ti++) {
    if (String(txAll[ti].device_id) === MARKET_DEVICE && String(txAll[ti].status) === 'COMPLETED') seen[String(txAll[ti].client_tx_id)] = true;
  }
  for (var gi = 0; gi < groups.length; gi++) {
    var grp = groups[gi];
    grp.clientTxId = 'mkt-' + sha256Hex_('marketplace:' + grp.ref).slice(0, 24);
    var already = !!seen[grp.clientTxId];
    var items = [];
    var total = 0;
    var when = '';
    var channel = 'marketplace';
    var wantQty = Object.create(null);
    for (var li = 0; li < grp.lines.length && !grp.error; li++) {
      var ln = grp.lines[li];
      var prod = bySku[String(cell(ln, 'SKU') || '').trim().toLowerCase()];
      var qty = String(cell(ln, 'Quantity')).trim() === '' ? 1 : Number(cell(ln, 'Quantity'));
      var price = Number(cell(ln, 'Unit price'));
      var serial = String(cell(ln, 'IMEI / Serial') || '').trim();
      if (!prod) { grp.error = 'SKU not found: ' + String(cell(ln, 'SKU')); break; }
      if (String(prod.item_type) === 'service') { grp.error = 'Services cannot be sold on a marketplace order'; break; }
      if (!(qty >= 1) || Math.floor(qty) !== qty) { grp.error = 'Quantity must be a whole number of at least 1'; break; }
      if (!(price >= 0) || String(cell(ln, 'Unit price')).trim() === '') { grp.error = 'Unit price is missing'; break; }
      if (String(prod.is_serialized) === '1') {
        if (!serial) { grp.error = prod.name + ' needs an IMEI / serial'; break; }
        if (qty !== 1) { grp.error = 'One IMEI per row - quantity must be 1'; break; }
      } else if (!already) {
        wantQty[String(prod.id)] = (wantQty[String(prod.id)] || 0) + qty;
        var left = num_(prod.on_hand) - (taken[String(prod.id)] || 0);
        if (wantQty[String(prod.id)] > left) { grp.error = 'Only ' + Math.max(0, left) + ' of ' + prod.name + ' in stock'; break; }
      }
      items.push({ productId: String(prod.id), quantity: qty, unitPrice: round2_(price), serialNumber: serial || null });
      total += qty * price;
      var d = cell(ln, 'Date');
      if (!when && d) {
        var ms = d instanceof Date ? d.getTime() : Date.parse(String(d));
        if (!isNaN(ms)) when = new Date(ms).toISOString();
      }
      var ch = String(cell(ln, 'Channel') || '').trim().toLowerCase();
      if (ch === 'online' || ch === 'phone' || ch === 'other' || ch === 'marketplace') channel = ch;
    }
    if (grp.error) continue;
    for (var tk in wantQty) taken[tk] = (taken[tk] || 0) + wantQty[tk];
    batch.push({
      clientTxId: grp.clientTxId,
      userId: String(session.uid),
      grandTotal: round2_(total),
      tenders: [{ type: 'marketplace', amount: round2_(total) }],
      items: items,
      note: 'Marketplace order ' + grp.ref,
      createdAt: when || new Date().toISOString(),
      channel: channel,
      externalRef: grp.ref,
    });
  }

  var byId = Object.create(null);
  if (batch.length) {
    var res = syncPush_({ uid: session.uid, role: 'manager' }, { deviceId: MARKET_DEVICE, batch: batch });
    for (var x = 0; x < res.results.length; x++) byId[res.results[x].clientTxId] = res.results[x];
  }

  var statusCol = col['Status'] + 1;
  var noteCol = col['Note'];
  var summary = { at: new Date().toISOString(), imported: 0, errors: 0, already: 0, rows: 0 };
  for (var k = 0; k < groups.length; k++) {
    var gr = groups[k];
    var status;
    var note = '';
    var hit = gr.clientTxId ? byId[gr.clientTxId] : null;
    if (gr.error) { status = 'Error: ' + gr.error; summary.errors++; }
    else if (hit && hit.accepted && hit.status === 'ALREADY_SYNCED') { status = 'Already imported'; summary.already++; }
    else if (hit && hit.accepted) { status = 'Imported ' + (hit.receiptNo || ''); summary.imported++; }
    else {
      var reasons = hit ? (hit.conflicts || []).map(function (c) { return MARKET_REASONS[c.reason] || c.reason; }) : ['not processed'];
      status = 'Error: ' + reasons.join(', ');
      summary.errors++;
    }
    note = new Date().toISOString().slice(0, 16).replace('T', ' ');
    for (var rr = 0; rr < gr.rows.length; rr++) {
      book.orders.getRange(gr.rows[rr] + 1, statusCol, 1, 1).setValues([[status]]);
      if (noteCol >= 0) book.orders.getRange(gr.rows[rr] + 1, noteCol + 1, 1, 1).setValues([[note]]);
      summary.rows++;
    }
  }
  writeMarketplaceStock_(book);
  setKv_('marketplace_last', JSON.stringify(summary));
  logAudit_(session, 'marketplace.import', 'marketplace', book.id,
    summary.imported + ' order(s) imported, ' + summary.already + ' already imported, ' + summary.errors + ' with errors', MARKET_DEVICE);
  return summary;
}

/* What the shop has to sell right now, for the listings. */
function writeMarketplaceStock_(book) {
  var prodRows = readRows_('Products', PRODUCT_HEADERS);
  var serialRows = readRows_('Serials', SERIAL_HEADERS);
  var inStock = Object.create(null);
  for (var i = 0; i < serialRows.length; i++) {
    if (String(serialRows[i].status) === 'IN_STOCK') inStock[String(serialRows[i].product_id)] = (inStock[String(serialRows[i].product_id)] || 0) + 1;
  }
  var stamp = new Date().toISOString();
  var out = [MARKET_STOCK_HEADERS];
  for (var j = 0; j < prodRows.length; j++) {
    var p = prodRows[j];
    if (String(p.active) !== '1' || String(p.item_type) === 'service') continue;
    var avail = String(p.locked) === '1' ? 0 : (String(p.is_serialized) === '1' ? (inStock[String(p.id)] || 0) : Math.max(0, num_(p.on_hand)));
    out.push([String(p.sku), String(p.name), avail, num_(p.retail_price), stamp]);
  }
  var old = book.stock.getLastRow();
  book.stock.getRange(1, 1, out.length, MARKET_STOCK_HEADERS.length).setValues(out);
  if (old > out.length) {
    var blank = [];
    for (var b = out.length; b < old; b++) blank.push(['', '', '', '', '']);
    book.stock.getRange(out.length + 1, 1, blank.length, MARKET_STOCK_HEADERS.length).setValues(blank);
  }
}

function marketplaceImport_(session) {
  requireRole_(session, ['admin', 'manager']);
  return marketplaceImportRun_(session);
}

/* The hourly trigger. Runs as the admin who set the sheet up. Never throws: a
   trigger that throws is not run again. */
function marketplaceImport() {
  try {
    var uid = String(kv_().marketplace_user || '');
    if (!uid || !PropertiesService.getScriptProperties().getProperty('MARKETPLACE_SHEET_ID')) return;
    var users = readRows_('Users', USER_HEADERS);
    var who = null;
    for (var i = 0; i < users.length; i++) if (String(users[i].id) === uid && String(users[i].active) === '1') who = users[i];
    if (!who) return;
    marketplaceImportRun_({ uid: uid, role: String(who.role) });
  } catch (err) {
    try {
      setKv_('marketplace_last', JSON.stringify({ at: new Date().toISOString(), failed: String((err && err.message) || err) }));
    } catch (_) {}
  }
}

function installMarketplaceTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'marketplaceImport') ScriptApp.deleteTrigger(existing[i]);
  }
  ScriptApp.newTrigger('marketplaceImport').timeBased().everyHours(1).create();
  return { installed: true, every: '1 hour' };
}

var REPORT_DENOM_LABELS = { cash: 'Cash', card: 'Card', transfer: 'Transfer', store_credit: 'Store credit', net30: 'On account', account: 'On account', deposit: 'Deposit applied', marketplace: 'Marketplace' };

/* What the shop is holding for customers right now. A liability is a balance,
 * not a flow, so it is read from the tickets rather than summed over whatever
 * date range the report happens to cover. */
function depositsHeld_() {
  var rows = readRows_('Repairs', REPAIR_HEADERS);
  var c = 0;
  for (var i = 0; i < rows.length; i++) c += cents_(rows[i].deposit_total);
  return c / 100;
}

function reports_(session, params) {
  requireRole_(session, ['admin', 'manager']);
  var from = String((params && params.from) || '');
  var to = String((params && params.to) || '');
  var nowMs = Date.now();
  var tzMin = num_(getStore_().tzOffsetMin);
  if (!from || !to) {
    from = new Date(nowMs - 29 * 86400000 + tzMin * 60000).toISOString().slice(0, 10);
    to = new Date(nowMs + 86400000 + tzMin * 60000).toISOString().slice(0, 10);
  }
  /* date-only params are LOCAL calendar days, not UTC: translate them to UTC
     instants via the store's tzOffsetMin so a 23:30 sale in UTC+1 lands in the
     NEXT local day's window (and midnight ones stay out of yesterday's). */
  var fromIso = from.indexOf('T') >= 0 ? from : dateOnlyToIso_(from, tzMin, false);
  var toIso = to.indexOf('T') >= 0 ? to : dateOnlyToIso_(to, tzMin, true);
  if (fromIso > toIso) { var tmp = fromIso; fromIso = toIso; toIso = tmp; }

  var prodRows = readRows_('Products', PRODUCT_HEADERS);
  var prodById = {};
  for (var pi = 0; pi < prodRows.length; pi++) prodById[String(prodRows[pi].id)] = prodRows[pi];

  var allTxRows = readRows_('Transactions', TX_HEADERS);
  var saleByClient = saleIndex_(allTxRows);
  var txRows = allTxRows.filter(function (t) {
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

  /* Keys here come from data a terminal can choose — a tender type, a product
   * category. A plain object literal inherits Object.prototype, so a row typed
   * "__proto__" or "constructor" would land on the prototype chain instead of
   * the map: the line vanishes from the report, or worse, writes onto a shared
   * built-in. Null-prototype maps have no such keys to collide with. */
  var byDay = Object.create(null);
  var byCat = Object.create(null);
  var byCash = Object.create(null);
  var byTender = Object.create(null);
  var byProduct = Object.create(null);
  var byCustomerTx = Object.create(null);
  var byChannel = Object.create(null);
  var byHour = Object.create(null);
  var summary = { grossSales: 0, refunds: 0, payouts: 0, pickups: 0, expenses: 0, collections: 0, salesCount: 0, units: 0, tax: 0, grossProfit: 0, depositsIn: 0, depositsApplied: 0, depositsRefunded: 0, discounts: 0, approvedDiscounts: 0, tradeIns: 0, tradeInCount: 0, supplierPayments: 0, supplierPaymentCount: 0 };

  function costOf_(t) {
    var items = itobjs_(t.items_json);
    var cost = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var prod = prodById[String(it.productId || '')];
      /* cost-at-sale first (captured by resolvedItems_ in cents); legacy rows
         with no captured cost fall back to the product's current cost. */
      var costPer = (typeof it.unitCost === 'number' && it.unitCost > 0) ? it.unitCost
        : (prod ? num_(prod.cost_price) : 0);
      cost += (it.quantity || 1) * costPer;
    }
    return cost;
  }
  function gpOf_(t, costTotal) {
    var net = saleNetExTax_(t);
    return net == null ? 0 : round2_(net - costTotal);
  }
  function tendersOf_(t) {
    var out = [];
    try { out = JSON.parse(t.tenders_json || '[]'); } catch (_) {}
    return out;
  }
  function dayKeyOf_(iso) { return localDayKey_(iso, tzMin); }

  for (var r = 0; r < txRows.length; r++) {
    var t = txRows[r];
    var kind = String(t.kind || 'sale');
    var tenders = tendersOf_(t);
    var items = itobjs_(t.items_json);
    var costTotal = costOf_(t);
    var day = dayKeyOf_(t.created_at);
    var d = byDay[day] || (byDay[day] = { sales: 0, count: 0, gp: 0 });
    var c = byCash[String(t.user_id || '')] || (byCash[String(t.user_id || '')] = { sales: 0, count: 0, units: 0, gp: 0, discounts: 0, discountedSales: 0, approved: 0,
      grossSales: 0, refunds: 0, refundCount: 0, revC: 0 });

    if (kind === 'sale') {
      var g1 = num_(t.grand_total);
      var ch = normaliseChannel_(t.channel);
      var che = byChannel[ch] || (byChannel[ch] = { sales: 0, count: 0, units: 0 });
      che.sales += g1;
      che.count += 1;
      che.units += items.reduce(function (n, it2) { return n + (it2.quantity || 1); }, 0);
      summary.grossSales += g1;
      summary.salesCount += 1;
      summary.units += items.reduce(function (s, it) { return s + (it.quantity || 1); }, 0);
      summary.tax += num_(t.tax_amount);
      var gp = gpOf_(t, costTotal);
      summary.grossProfit += gp;
      d.sales += g1; d.count += 1; d.gp += gp;
      c.sales += g1; c.count += 1; c.gp += gp;
      c.grossSales += g1;
      c.revC += cents_(saleNetExTax_(t) || 0);
      var hourKey = new Date(new Date(String(t.created_at)).getTime() + tzMin * 60000).getUTCHours();
      if (!isNaN(hourKey)) {
        var hb = byHour[hourKey] || (byHour[hourKey] = { sales: 0, count: 0 });
        hb.sales += g1; hb.count += 1;
      }
      c.units += items.reduce(function (s, it) { return s + (it.quantity || 1); }, 0);
      var saleDiscC = 0;

      for (var ti = 0; ti < tenders.length; ti++) {
        var tc = tenders[ti];
        var ty = String(tc.type || 'cash');
        var e = byTender[ty] || (byTender[ty] = { amount: 0, count: 0 });
        e.amount += num_(tc.amount);
        e.count += 1;
        if (ty === 'deposit') summary.depositsApplied += num_(tc.amount);
      }
      for (var it1 = 0; it1 < items.length; it1++) {
        var it = items[it1];
        var prod = prodById[String(it.productId || '')];
        var cat = prod ? String(prod.category || 'Uncategorized') : String(it.category || 'Uncategorized');
        var qty = it.quantity || 1;
        /* revenue per line: line unitPrice × qty, minus the line's own
           discountPct, then the order-level discount, both in rounded cents. */
        var linePct = clampPct_(num_(it.discountPct));
        var orderPct = num_(t.discount_pct);
        var lineNetCents = round2_(num_(it.unitPrice) * 100 * qty * (1 - linePct / 100));
        var revCents = round2_(lineNetCents * (100 - orderPct) / 100);
        /* a VAT-inclusive line earned its price less the VAT inside it */
        if (String(t.tax_inclusive) === '1' && it.taxable !== false && num_(t.tax_rate) > 0) {
          revCents = revCents * 100 / (100 + num_(t.tax_rate));
        }
        var lineRev = Math.round(revCents) / 100;
        /* what the discounts took off this line, before tax */
        saleDiscC += Math.max(0, Math.round(num_(it.unitPrice) * 100 * qty) - Math.round(revCents));
        var costPer = (typeof it.unitCost === 'number' && it.unitCost > 0) ? it.unitCost
          : (prod ? num_(prod.cost_price) : 0);
        var lineGp = lineRev - qty * costPer;
        var ce = byCat[cat] || (byCat[cat] = { units: 0, sales: 0, gp: 0 });
        ce.units += qty;
        ce.sales += lineRev;
        ce.gp += lineGp;
        var peKey = prod ? String(it.productId) : 'nameonly:' + String(it.name || 'Item');
        var pe = byProduct[peKey] || (byProduct[peKey] = { name: prod ? String(prod.name || 'Item') : String(it.name || 'Item'), sku: prod ? String(prod.sku || '') : '', units: 0, sales: 0, gp: 0 });
        pe.units += qty;
        pe.sales += lineRev;
        pe.gp += lineGp;
      }
      if (saleDiscC > 0) {
        summary.discounts += saleDiscC / 100;
        c.discounts += saleDiscC / 100;
        c.discountedSales += 1;
        if (String(t.approved_by || '')) { summary.approvedDiscounts += 1; c.approved += 1; }
      }
      var custId = String(t.customer_id || '');
      if (custId) {
        var ce2 = byCustomerTx[custId] || (byCustomerTx[custId] = { spent: 0, count: 0 });
        ce2.spent += g1;
        ce2.count += 1;
      }
    } else if (kind === 'refund') {
      summary.refunds += num_(t.grand_total);
      /* a return gives back its revenue (less the tax in it) and puts the
         cost back on the shelf: profit falls by the margin, not the cost */
      var refundGp = refundSplit_(t, saleByClient).netC / 100 - costTotal;
      summary.grossProfit -= refundGp;
      c.sales -= num_(t.grand_total); c.gp -= refundGp;
      c.refunds += num_(t.grand_total); c.refundCount += 1;
      c.revC -= refundSplit_(t, saleByClient).netC;
      for (var ri = 0; ri < tenders.length; ri++) {
        var re = byTender[String(tenders[ri].type || 'cash')] || (byTender[String(tenders[ri].type || 'cash')] = { amount: 0, count: 0 });
        re.amount -= num_(tenders[ri].amount);
        re.count += 1;
      }
    } else if (isCashOutKind_(kind)) {
      var outAmt = num_(t.grand_total);
      if (kind === 'pickup') summary.pickups += outAmt;
      else if (kind === 'expense') summary.expenses += outAmt;
      else summary.payouts += outAmt;
      c.sales -= outAmt;
      var pe2 = byTender['cash'] || (byTender['cash'] = { amount: 0, count: 0 });
      pe2.amount -= outAmt;
    } else if (kind === 'deposit') {
      /* Money in, not revenue: never gross sales, GP or a cashier's sales. */
      summary.depositsIn += num_(t.grand_total);
      for (var di = 0; di < tenders.length; di++) {
        var de = byTender[String(tenders[di].type || 'cash')] || (byTender[String(tenders[di].type || 'cash')] = { amount: 0, count: 0 });
        de.amount += num_(tenders[di].amount);
        de.count += 1;
      }
    } else if (kind === 'deposit_refund') {
      summary.depositsRefunded += num_(t.grand_total);
      for (var dj = 0; dj < tenders.length; dj++) {
        var dje = byTender[String(tenders[dj].type || 'cash')] || (byTender[String(tenders[dj].type || 'cash')] = { amount: 0, count: 0 });
        dje.amount -= num_(tenders[dj].amount);
        dje.count += 1;
      }
    } else if (kind === 'supplier_payment') {
      /* settling what the shop owes a supplier: money out, never an expense or a sale */
      summary.supplierPayments += num_(t.grand_total);
      summary.supplierPaymentCount += 1;
      for (var sp = 0; sp < tenders.length; sp++) {
        if (String(tenders[sp].type || '') !== 'cash') continue;
        var spe = byTender.cash || (byTender.cash = { amount: 0, count: 0 });
        spe.amount -= num_(tenders[sp].amount);
      }
    } else if (kind === 'tradein') {
      /* stock bought from a customer: money out, never a sale or a cost of one */
      summary.tradeIns += num_(t.grand_total);
      summary.tradeInCount += 1;
      for (var tn = 0; tn < tenders.length; tn++) {
        var tne = byTender[String(tenders[tn].type || 'cash')] || (byTender[String(tenders[tn].type || 'cash')] = { amount: 0, count: 0 });
        tne.amount -= num_(tenders[tn].amount);
        tne.count += 1;
      }
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
    var e = byCash[k];
    return { userId: k, userName: userName[k] || '—', sales: num_(e.sales), count: e.count, units: e.units, gp: num_(e.gp),
      discounts: round2_(e.discounts), discountedSales: e.discountedSales, approvedDiscounts: e.approved,
      /* v1.47.0: the detail a manager asks about a person's till */
      grossSales: round2_(e.grossSales), refunds: round2_(e.refunds), refundCount: e.refundCount,
      avgSale: e.count ? round2_(e.grossSales / e.count) : 0,
      itemsPerSale: e.count ? Math.round(e.units * 100 / e.count) / 100 : 0,
      margin: e.revC ? Math.round(e.gp * 100 * 1000 / e.revC) / 10 : null };
  }).sort(function (a, b) { return b.sales - a.sales; });
  var byHourOut = [];
  for (var hk = 0; hk < 24; hk++) {
    if (byHour[hk]) byHourOut.push({ hour: hk, sales: round2_(byHour[hk].sales), count: byHour[hk].count });
  }
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
      pickups: summary.pickups,
      expenses: summary.expenses,
      cashOut: summary.payouts + summary.pickups + summary.expenses,
      collections: summary.collections,
      depositsIn: round2_(summary.depositsIn),
      depositsApplied: round2_(summary.depositsApplied),
      depositsRefunded: round2_(summary.depositsRefunded),
      depositsHeld: depositsHeld_(),
      tradeIns: round2_(summary.tradeIns),
      tradeInCount: summary.tradeInCount,
      supplierPayments: round2_(summary.supplierPayments),
      supplierPaymentCount: summary.supplierPaymentCount,
      netRevenue: summary.grossSales - summary.refunds - summary.payouts - summary.pickups - summary.expenses,
      salesCount: summary.salesCount,
      units: summary.units,
      tax: summary.tax,
      grossProfit: summary.grossProfit,
      discounts: round2_(summary.discounts),
      approvedDiscounts: summary.approvedDiscounts,
      avgTicket: summary.salesCount ? summary.grossSales / summary.salesCount : 0,
    },
    byDay: byDayOut,
    byCategory: byCatOut,
    byCashier: byCashOut,
    byHour: byHourOut,
    byTender: byTenderOut,
    byChannel: Object.keys(byChannel).map(function (k) {
      return { channel: k, sales: num_(byChannel[k].sales), count: byChannel[k].count, units: byChannel[k].units };
    }).sort(function (a, b) { return b.sales - a.sales; }),
    topProducts: byProductOut,
    topCustomers: topCust,
  };
}

/* ------------------------------------------------------------------ *
 *  Accounting (v1.43.0)
 *
 *  Double-entry books kept to generally accepted accounting principles,
 *  derived from the ledger rather than stored beside it, so they can never
 *  drift from the sales they describe. Accrual basis: a sale is revenue when
 *  it is made, whether it was paid in cash, on account or by a marketplace
 *  that settles later; a deposit is a liability until it is applied; cost of
 *  goods sold is recognised with the sale at the cost captured when it was
 *  sold. Everything is posted in cents, and an entry that does not balance to
 *  the cent is squared to Rounding, never left open.
 * ------------------------------------------------------------------ */

var CHART_OF_ACCOUNTS = [
  { code: '1000', name: 'Cash', type: 'asset' },
  { code: '1010', name: 'Card clearing', type: 'asset' },
  { code: '1020', name: 'Bank transfers', type: 'asset' },
  { code: '1030', name: 'Cash in transit', type: 'asset' },
  { code: '1100', name: 'Accounts receivable', type: 'asset' },
  { code: '1150', name: 'Marketplace receivable', type: 'asset' },
  { code: '1200', name: 'Inventory', type: 'asset' },
  { code: '2000', name: 'Sales tax / VAT payable', type: 'liability' },
  { code: '2100', name: 'Customer deposits', type: 'liability' },
  { code: '2200', name: 'Store credit', type: 'liability' },
  { code: '2300', name: 'Accounts payable', type: 'liability' },
  { code: '4000', name: 'Product sales', type: 'revenue' },
  { code: '4010', name: 'Service sales', type: 'revenue' },
  { code: '4100', name: 'Sales returns', type: 'contra_revenue' },
  { code: '5000', name: 'Cost of goods sold', type: 'expense' },
  { code: '5100', name: 'Inventory shrinkage', type: 'expense' },
  { code: '6000', name: 'Paid out', type: 'expense' },
  { code: '6100', name: 'Staff expenses', type: 'expense' },
  { code: '6900', name: 'Rounding', type: 'expense' },
];

/* Where each way of paying lands. A tender the books do not know is cash,
 * the same default the drawer and Reports use. */
var TENDER_ACCOUNTS = { cash: '1000', card: '1010', transfer: '1020', net30: '1100', account: '1100', marketplace: '1150', deposit: '2100', store_credit: '2200', bank: '1020', cheque: '1020' };
var CASH_OUT_ACCOUNTS = { payout: '6000', expense: '6100', pickup: '1030' };

function tenderAccount_(type) {
  var ty = String(type || 'cash');
  return Object.prototype.hasOwnProperty.call(TENDER_ACCOUNTS, ty) ? TENDER_ACCOUNTS[ty] : '1000';
}

/* Completed sales by the id the terminal gave them, which is what a refund
 * points back at. */
function saleIndex_(txRows) {
  var out = Object.create(null);
  for (var i = 0; i < txRows.length; i++) {
    var t = txRows[i];
    if (String(t.status) !== 'COMPLETED') continue;
    if (String(t.kind || '') !== '' && String(t.kind) !== 'sale') continue;
    out[String(t.client_tx_id || '')] = t;
  }
  return out;
}

/* A refund row stores what went back to the customer, tax included. The tax
 * in it is the original sale's share of tax in its total, so a half refund
 * gives back half the tax; the rest is the revenue being returned. */
function refundSplit_(refund, saleByClient) {
  var grossC = cents_(refund.grand_total);
  var orig = saleByClient[String(refund.original_client_tx || '')];
  var taxC = 0;
  if (orig) {
    var og = cents_(orig.grand_total), ot = cents_(orig.tax_amount);
    if (og > 0 && ot > 0) taxC = Math.min(grossC, Math.round(grossC * ot / og));
  }
  return { grossC: grossC, taxC: taxC, netC: grossC - taxC };
}

/* Cost of a row's lines: the cost captured when it was sold, else the
 * product's cost now (legacy rows) - the same rule Reports uses. */
function itemsCostC_(t, prodById) {
  var items = itobjs_(t.items_json);
  var cost = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var prod = prodById[String(it.productId || '')];
    var costPer = (typeof it.unitCost === 'number' && it.unitCost > 0) ? it.unitCost
      : (prod ? num_(prod.cost_price) : 0);
    cost += (it.quantity || 1) * costPer;
  }
  return Math.round(cost * 100);
}

function isServiceLine_(it, prodById) {
  var pid = String((it && it.productId) || '');
  if (pid === 'repair-labour') return true;
  var prod = prodById[pid];
  return !!(prod && String(prod.item_type) === 'service');
}

/* The period a report covers, as UTC instants. Date-only values are local
 * calendar days in the store's time zone. Defaults to the last 30 days. */
function reportPeriod_(params) {
  var from = String((params && params.from) || '');
  var to = String((params && params.to) || '');
  var nowMs = Date.now();
  var tzMin = num_(getStore_().tzOffsetMin);
  if (!from || !to) {
    from = new Date(nowMs - 29 * 86400000 + tzMin * 60000).toISOString().slice(0, 10);
    to = new Date(nowMs + 86400000 + tzMin * 60000).toISOString().slice(0, 10);
  }
  var fromIso = from.indexOf('T') >= 0 ? from : dateOnlyToIso_(from, tzMin, false);
  var toIso = to.indexOf('T') >= 0 ? to : dateOnlyToIso_(to, tzMin, true);
  if (fromIso > toIso) { var tmp = fromIso; fromIso = toIso; toIso = tmp; }
  return { fromIso: fromIso, toIso: toIso, tzMin: tzMin };
}

function accounting_(session, params) {
  requireRole_(session, ['admin']);
  var period = reportPeriod_(params);
  var fromIso = period.fromIso, toIso = period.toIso;
  var inPeriod = function (iso) { iso = String(iso || ''); return iso >= fromIso && iso <= toIso; };

  var prodRows = readRows_('Products', PRODUCT_HEADERS);
  var prodById = Object.create(null);
  for (var pi = 0; pi < prodRows.length; pi++) prodById[String(prodRows[pi].id)] = prodRows[pi];
  var allTx = readRows_('Transactions', TX_HEADERS);
  var saleByClient = saleIndex_(allTx);
  var accountName = Object.create(null);
  for (var ai = 0; ai < CHART_OF_ACCOUNTS.length; ai++) accountName[CHART_OF_ACCOUNTS[ai].code] = CHART_OF_ACCOUNTS[ai].name;

  var entries = [];
  function entry(date, kind, ref, memo) {
    var e = { date: String(date || ''), kind: kind, ref: String(ref || ''), memo: String(memo || ''), post: Object.create(null), order: [] };
    entries.push(e);
    return e;
  }
  function post(e, code, dC) {
    if (!dC) return;
    if (e.post[code] == null) { e.post[code] = 0; e.order.push(code); }
    e.post[code] += dC;
  }
  function tenders(e, t, sign, fallbackC) {
    var list = [];
    try { list = JSON.parse(t.tenders_json || '[]'); } catch (_) {}
    if (!Array.isArray(list) || !list.length) { post(e, '1000', sign * fallbackC); return fallbackC; }
    var total = 0;
    for (var i = 0; i < list.length; i++) {
      var a = cents_((list[i] || {}).amount);
      post(e, tenderAccount_((list[i] || {}).type), sign * a);
      total += a;
    }
    return total;
  }

  var txRows = allTx.filter(function (t) { return String(t.status) === 'COMPLETED' && inPeriod(t.created_at); });
  txRows.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });

  for (var r = 0; r < txRows.length; r++) {
    var t = txRows[r];
    var kind = String(t.kind || 'sale');
    var ref = String(t.receipt_no || t.external_ref || t.client_tx_id || '');
    var grossC = cents_(t.grand_total);
    var e;
    if (kind === 'sale') {
      e = entry(t.created_at, 'sale', ref, String(t.channel || '') === 'marketplace' ? 'Marketplace sale ' + String(t.external_ref || '') : 'Sale');
      var tendered = tenders(e, t, 1, grossC);
      /* cash handed back is money that never stayed in the drawer */
      if (tendered > grossC) post(e, '1000', -(tendered - grossC));
      var taxC = cents_(t.tax_amount);
      var netC = grossC - taxC;
      var items = itobjs_(t.items_json);
      var allW = 0, svcW = 0;
      for (var li = 0; li < items.length; li++) {
        var it = items[li] || {};
        var w = cents_(it.unitPrice) * (it.quantity || 1) * (1 - clampPct_(num_(it.discountPct)) / 100);
        allW += w;
        if (isServiceLine_(it, prodById)) svcW += w;
      }
      var svcC = allW > 0 ? Math.round(netC * svcW / allW) : 0;
      post(e, '2000', -taxC);
      post(e, '4010', -svcC);
      post(e, '4000', -(netC - svcC));
      var costC = itemsCostC_(t, prodById);
      post(e, '5000', costC);
      post(e, '1200', -costC);
    } else if (kind === 'refund') {
      var split = refundSplit_(t, saleByClient);
      var orig = saleByClient[String(t.original_client_tx || '')];
      e = entry(t.created_at, 'refund', ref, 'Refund' + (orig && orig.receipt_no ? ' of ' + String(orig.receipt_no) : ''));
      post(e, '4100', split.netC);
      post(e, '2000', split.taxC);
      tenders(e, t, -1, grossC);
      var rCost = itemsCostC_(t, prodById);
      post(e, '1200', rCost);
      post(e, '5000', -rCost);
    } else if (isCashOutKind_(kind)) {
      e = entry(t.created_at, kind, ref, CASH_OUT_KINDS[kind] + (t.counterparty ? ': ' + String(t.counterparty) : ''));
      post(e, CASH_OUT_ACCOUNTS[kind], grossC);
      post(e, '1000', -grossC);
    } else if (kind === 'payment') {
      e = entry(t.created_at, 'payment', ref, 'Payment on account');
      tenders(e, t, 1, grossC);
      post(e, '1100', -grossC);
    } else if (kind === 'deposit') {
      e = entry(t.created_at, 'deposit', ref, 'Deposit on ' + String(t.counterparty || ''));
      tenders(e, t, 1, grossC);
      post(e, '2100', -grossC);
    } else if (kind === 'deposit_refund') {
      e = entry(t.created_at, 'deposit_refund', ref, 'Deposit refunded on ' + String(t.counterparty || ''));
      post(e, '2100', grossC);
      tenders(e, t, -1, grossC);
    } else if (kind === 'supplier_payment') {
      e = entry(t.created_at, 'supplier_payment', String(t.external_ref || ref), 'Paid ' + String(t.counterparty || 'supplier'));
      post(e, '2300', grossC);
      tenders(e, t, -1, grossC);
    } else if (kind === 'tradein') {
      e = entry(t.created_at, 'tradein', ref, 'Trade-in bought from ' + String(t.counterparty || ''));
      post(e, '1200', grossC);
      tenders(e, t, -1, grossC);
    } else if (kind === 'purchase') {
      e = entry(t.created_at, 'purchase', ref, String(t.note || 'Stock received') + (t.counterparty ? ' · ' + String(t.counterparty) : ''));
      /* the order's tax is input tax the store reclaims, not stock cost */
      var inputTaxC = cents_(t.tax_amount);
      if (!(inputTaxC > 0) || inputTaxC > grossC) inputTaxC = 0;
      post(e, '1200', grossC - inputTaxC);
      if (inputTaxC) post(e, '2000', inputTaxC);
      post(e, '2300', -grossC);
    } else {
      continue;
    }
  }

  /* a stock take's counted difference, one entry per count */
  var takes = readRows_('StockTakes', STOCKTAKE_HEADERS).filter(function (s) { return inPeriod(s.created_at); });
  var bySession = Object.create(null), sessionOrder = [];
  for (var si = 0; si < takes.length; si++) {
    var sid = String(takes[si].session_id || takes[si].id);
    if (!bySession[sid]) { bySession[sid] = { at: String(takes[si].created_at || ''), deltaC: 0 }; sessionOrder.push(sid); }
    bySession[sid].deltaC += cents_(takes[si].value_delta);
  }
  for (var so = 0; so < sessionOrder.length; so++) {
    var st = bySession[sessionOrder[so]];
    if (!st.deltaC) continue;
    var se = entry(st.at, 'stocktake', sessionOrder[so], st.deltaC < 0 ? 'Stock take: shortage' : 'Stock take: surplus');
    post(se, '1200', st.deltaC);
    post(se, '5100', -st.deltaC);
  }
  entries.sort(function (a, b) { return a.date.localeCompare(b.date); });

  /* square every entry to the cent, then total the accounts */
  var totals = Object.create(null);
  var rounded = 0;
  var journal = entries.map(function (en, idx) {
    var sum = 0;
    for (var k in en.post) sum += en.post[k];
    if (sum) { post(en, '6900', -sum); rounded++; }
    var lines = [];
    for (var oi = 0; oi < en.order.length; oi++) {
      var code = en.order[oi];
      var v = en.post[code];
      if (!v) continue;
      var tt = totals[code] || (totals[code] = { d: 0, c: 0 });
      if (v > 0) tt.d += v; else tt.c += -v;
      lines.push({ code: code, name: accountName[code], debit: v > 0 ? v / 100 : 0, credit: v < 0 ? -v / 100 : 0 });
    }
    return { no: idx + 1, date: en.date, kind: en.kind, ref: en.ref, memo: en.memo, lines: lines };
  }).filter(function (j) { return j.lines.length; });

  var trial = [];
  var tdC = 0, tcC = 0;
  for (var ci = 0; ci < CHART_OF_ACCOUNTS.length; ci++) {
    var acc = CHART_OF_ACCOUNTS[ci];
    var tot = totals[acc.code];
    if (!tot) continue;
    tdC += tot.d; tcC += tot.c;
    trial.push({ code: acc.code, name: acc.name, type: acc.type, debit: tot.d / 100, credit: tot.c / 100, balance: (tot.d - tot.c) / 100 });
  }
  function dr(code) { var x = totals[code]; return x ? x.d - x.c : 0; }

  var productC = -dr('4000'), serviceC = -dr('4010'), returnsC = dr('4100');
  var netSalesC = productC + serviceC - returnsC;
  var cogsC = dr('5000');
  var gpC = netSalesC - cogsC;
  var shrinkC = dr('5100'), paidC = dr('6000'), staffC = dr('6100'), roundC = dr('6900');
  var expC = shrinkC + paidC + staffC + roundC;

  var movements = ['1000', '1010', '1020', '1030', '1100', '1150', '1200', '2000', '2100', '2200', '2300'].map(function (code) {
    var liability = code.charAt(0) === '2';
    return { code: code, name: accountName[code], change: (liability ? -dr(code) : dr(code)) / 100 };
  });

  return {
    period: { from: fromIso, to: toIso },
    accounts: CHART_OF_ACCOUNTS,
    pnl: {
      productSales: productC / 100,
      serviceSales: serviceC / 100,
      returns: returnsC / 100,
      netSales: netSalesC / 100,
      cogs: cogsC / 100,
      grossProfit: gpC / 100,
      shrinkage: shrinkC / 100,
      paidOut: paidC / 100,
      staffExpenses: staffC / 100,
      rounding: roundC / 100,
      expenses: expC / 100,
      netIncome: (gpC - expC) / 100,
    },
    trialBalance: { accounts: trial, debit: tdC / 100, credit: tcC / 100, balanced: tdC === tcC },
    movements: movements,
    journal: journal,
    checks: { entries: journal.length, rounded: rounded, balanced: tdC === tcC },
  };
}

/* ------------------------------------------------------------------ *
 *  Sales report (v1.47.0)
 *
 *  Every sale and refund, broken into its lines, with each line's share of
 *  the discount, the tax and the cost worked out in whole cents so the lines
 *  of a transaction always add back to it exactly. Filters and groupings then
 *  work on lines: "Phones in March" is the phones' own revenue, not the whole
 *  of every basket that had a phone in it. The money rules are the ones
 *  Reports and the books use (saleNetExTax_, refundSplit_, captured cost).
 * ------------------------------------------------------------------ */

var SALES_GROUP_BY = { day: 1, staff: 1, category: 1, product: 1, tender: 1, channel: 1, customer: 1, hour: 1 };
var SALES_ROWS_MAX = 5000;

/* Share whole cents out by weight so the parts add back to the total exactly
   (largest remainder). No weight at all shares equally. */
function splitCents_(totalC, weights) {
  var n = weights.length;
  if (!n) return [];
  var w = [], sum = 0;
  for (var i = 0; i < n; i++) { w.push(Math.max(0, Number(weights[i]) || 0)); sum += w[i]; }
  if (sum <= 0) { for (var e = 0; e < n; e++) w[e] = 1; sum = n; }
  var sign = totalC < 0 ? -1 : 1, abs = Math.abs(Math.round(totalC));
  var out = [], rem = [], used = 0;
  for (var j = 0; j < n; j++) {
    var exact = abs * w[j] / sum;
    var fl = Math.floor(exact);
    out.push(fl); used += fl;
    rem.push({ i: j, r: exact - fl });
  }
  rem.sort(function (a, b) { return b.r - a.r || a.i - b.i; });
  for (var k = 0; k < abs - used; k++) out[rem[k % n].i] += 1;
  return out.map(function (v) { return v * sign; });
}

/* The lines of one completed sale or refund, each with its own cents. */
function salesLines_(t, kind, prodById, saleByClient) {
  var items = itobjs_(t.items_json);
  var grossC = cents_(t.grand_total);
  if (!items.length) {
    /* an amount-only refund (or a legacy row) still moved money: it is one line
       holding the whole amount, so the report never quietly drops it */
    var bareTaxC = kind === 'sale' ? cents_(t.tax_amount) : refundSplit_(t, saleByClient).taxC;
    return [{ productId: '', name: kind === 'refund' ? 'Refund (no items)' : 'Sale (no items)', sku: '', category: 'Uncategorized',
      serialNumber: '', qty: 0, unitPrice: 0, discountPct: 0,
      listC: 0, discC: 0, netC: grossC - bareTaxC, taxC: bareTaxC, grossC: grossC, costC: 0 }];
  }
  var taxC, netTotalC;
  var weights = [], taxWeights = [], listCs = [], discCs = [], costWeights = [], costFloat = 0;
  var orderPct = kind === 'sale' ? num_(t.discount_pct) : 0;
  var inclusive = String(t.tax_inclusive) === '1' && num_(t.tax_rate) > 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var qty = it.quantity || 1;
    var prod = prodById[String(it.productId || '')];
    var listC = Math.round(num_(it.unitPrice) * 100 * qty);
    var revC = listC;
    if (kind === 'sale') {
      var lineNetC = Math.round(num_(it.unitPrice) * 100 * qty * (1 - clampPct_(num_(it.discountPct)) / 100));
      revC = lineNetC * (100 - orderPct) / 100;
      if (inclusive && it.taxable !== false) revC = revC * 100 / (100 + num_(t.tax_rate));
    }
    weights.push(revC);
    taxWeights.push(it.taxable === false ? 0 : revC);
    listCs.push(listC);
    discCs.push(kind === 'sale' ? Math.max(0, listC - Math.round(revC)) : 0);
    var costPer = (typeof it.unitCost === 'number' && it.unitCost > 0) ? it.unitCost : (prod ? num_(prod.cost_price) : 0);
    costWeights.push(qty * costPer);
    costFloat += qty * costPer;
  }
  if (kind === 'sale') {
    taxC = cents_(t.tax_amount);
  } else {
    taxC = refundSplit_(t, saleByClient).taxC;
  }
  netTotalC = grossC - taxC;
  var sumTaxW = 0;
  for (var s = 0; s < taxWeights.length; s++) sumTaxW += taxWeights[s];
  var netCs = splitCents_(netTotalC, weights);
  var taxCs = splitCents_(taxC, sumTaxW > 0 ? taxWeights : weights);
  var costCs = splitCents_(Math.round(costFloat * 100), costWeights);
  var out = [];
  for (var l = 0; l < items.length; l++) {
    var li = items[l] || {};
    var pr = prodById[String(li.productId || '')];
    out.push({
      productId: String(li.productId || ''),
      name: String(li.name || (pr && pr.name) || 'Item'),
      sku: pr ? String(pr.sku || '') : '',
      category: pr ? (String(pr.category || '').trim() || 'Uncategorized') : (String(li.productId) === 'repair-labour' ? 'Services' : 'Uncategorized'),
      serialNumber: li.serialNumber ? String(li.serialNumber) : '',
      qty: li.quantity || 1,
      unitPrice: num_(li.unitPrice),
      discountPct: clampPct_(num_(li.discountPct)),
      listC: listCs[l], discC: discCs[l], netC: netCs[l], taxC: taxCs[l], grossC: netCs[l] + taxCs[l], costC: costCs[l],
    });
  }
  return out;
}

/* Money in by tender for a transaction, change taken off cash. */
function tenderAmountsC_(t) {
  var list = [];
  try { list = JSON.parse(t.tenders_json || '[]'); } catch (_) {}
  var grossC = cents_(t.grand_total);
  if (!Array.isArray(list) || !list.length) return [{ type: 'cash', c: grossC }];
  var out = [], sum = 0;
  for (var i = 0; i < list.length; i++) {
    var c = cents_((list[i] || {}).amount);
    out.push({ type: String((list[i] || {}).type || 'cash'), c: c });
    sum += c;
  }
  var change = sum - grossC;
  for (var j = 0; j < out.length && change > 0; j++) {
    if (out[j].type !== 'cash') continue;
    var take = Math.min(change, out[j].c);
    out[j].c -= take; change -= take;
  }
  return out.filter(function (x) { return x.c !== 0; });
}

function salesReport_(session, params) {
  requireRole_(session, ['admin', 'manager', 'cashier']);
  params = params || {};
  var role = String(session.role || '');
  var isStore = role === 'admin' || role === 'manager';
  var period = reportPeriod_(params);
  var tzMin = period.tzMin;
  var groupBy = SALES_GROUP_BY[String(params.groupBy || '')] ? String(params.groupBy) : 'day';
  var f = {
    userId: isStore ? String(params.userId || '') : String(session.uid || ''),
    customerId: String(params.customerId || ''),
    channel: String(params.channel || ''),
    tender: String(params.tender || ''),
    kind: params.kind === 'sale' || params.kind === 'refund' ? String(params.kind) : '',
    category: String(params.category || ''),
    productId: String(params.productId || ''),
  };
  var offset = Math.max(0, parseInt(params.offset, 10) || 0);
  var limit = Math.min(SALES_ROWS_MAX, Math.max(1, parseInt(params.limit, 10) || 100));

  var prodRows = readRows_('Products', PRODUCT_HEADERS);
  var prodById = Object.create(null);
  for (var p = 0; p < prodRows.length; p++) prodById[String(prodRows[p].id)] = prodRows[p];
  var custName = Object.create(null);
  var custRows = readRows_('Customers', CUSTOMERS_HEADERS);
  for (var c = 0; c < custRows.length; c++) custName[String(custRows[c].id)] = String(custRows[c].name || '');
  var allTx = readRows_('Transactions', TX_HEADERS);
  var saleByClient = saleIndex_(allTx);

  var inPeriod = allTx.filter(function (t) {
    var k = String(t.kind || 'sale');
    return String(t.status) === 'COMPLETED' && (k === 'sale' || k === 'refund')
      && String(t.created_at || '') >= period.fromIso && String(t.created_at || '') <= period.toIso;
  });

  /* filter choices come from the period before the filters, so picking one never empties the others */
  var opt = { staff: Object.create(null), categories: Object.create(null), tenders: Object.create(null), channels: Object.create(null), customers: Object.create(null), products: Object.create(null) };

  var lineMatch = function (ln) {
    if (f.category && ln.category !== f.category) return false;
    if (f.productId && ln.productId !== f.productId) return false;
    return true;
  };

  var sum = { salesCount: 0, refundCount: 0, grossC: 0, refundsC: 0, taxInC: 0, taxOutC: 0, netExC: 0, discC: 0, costC: 0, unitsSold: 0, unitsReturned: 0 };
  var groups = Object.create(null);
  var rows = [];

  function groupOf(key, label) {
    var g = groups[key] || (groups[key] = { key: key, label: label, sales: Object.create(null), refunds: Object.create(null), units: 0, grossC: 0, refundsC: 0, taxC: 0, netExC: 0, discC: 0, costC: 0 });
    return g;
  }

  for (var r = 0; r < inPeriod.length; r++) {
    var t = inPeriod[r];
    var kind = String(t.kind || 'sale');
    var uid = String(t.user_id || '');
    var ch = normaliseChannel_(t.channel);
    var cid = String(t.customer_id || '');
    var tenders = tenderAmountsC_(t);
    var lines = salesLines_(t, kind, prodById, saleByClient);

    opt.staff[uid] = 1; opt.channels[ch] = 1;
    if (cid) opt.customers[cid] = 1;
    for (var ot = 0; ot < tenders.length; ot++) opt.tenders[tenders[ot].type] = 1;
    for (var ol = 0; ol < lines.length; ol++) { opt.categories[lines[ol].category] = 1; if (lines[ol].productId) opt.products[lines[ol].productId] = lines[ol].name; }

    if (f.userId && uid !== f.userId) continue;
    if (f.customerId && cid !== f.customerId) continue;
    if (f.channel && ch !== f.channel) continue;
    if (f.kind && kind !== f.kind) continue;
    if (f.tender && !tenders.some(function (x) { return x.type === f.tender; })) continue;
    var kept = lines.filter(lineMatch);
    if (!kept.length) continue;

    var sign = kind === 'refund' ? -1 : 1;
    var txGrossC = 0, txTaxC = 0, txNetC = 0, txDiscC = 0, txCostC = 0, txUnits = 0;
    for (var k = 0; k < kept.length; k++) {
      var ln = kept[k];
      txGrossC += ln.grossC; txTaxC += ln.taxC; txNetC += ln.netC; txDiscC += ln.discC; txCostC += ln.costC; txUnits += ln.qty;
    }
    if (kind === 'sale') {
      sum.salesCount++; sum.grossC += txGrossC; sum.taxInC += txTaxC; sum.netExC += txNetC; sum.discC += txDiscC; sum.costC += txCostC; sum.unitsSold += txUnits;
    } else {
      sum.refundCount++; sum.refundsC += txGrossC; sum.taxOutC += txTaxC; sum.netExC -= txNetC; sum.costC -= txCostC; sum.unitsReturned += txUnits;
    }

    var staffName = auditName_(uid) || '—';
    var custLabel = cid ? (custName[cid] || 'Customer') : '';
    if (groupBy === 'tender') {
      /* a basket paid two ways counts in both, in proportion to what was kept */
      var fullC = 0;
      for (var fl = 0; fl < lines.length; fl++) fullC += lines[fl].grossC;
      var shares = splitCents_(txGrossC, tenders.map(function (x) { return x.c; }));
      for (var ti = 0; ti < tenders.length; ti++) {
        var tg = groupOf('t:' + tenders[ti].type, tenders[ti].type);
        if (kind === 'sale') { tg.sales[t.id] = 1; tg.grossC += shares[ti]; }
        else { tg.refunds[t.id] = 1; tg.refundsC += shares[ti]; }
        void fullC;
      }
    } else {
      for (var g2 = 0; g2 < kept.length; g2++) {
        var L = kept[g2];
        var key, label;
        if (groupBy === 'day') { key = localDayKey_(t.created_at, tzMin); label = key; }
        else if (groupBy === 'hour') {
          var ms = new Date(String(t.created_at)).getTime() + tzMin * 60000;
          var hh = isNaN(ms) ? 0 : new Date(ms).getUTCHours();
          key = (hh < 10 ? '0' : '') + hh; label = key + ':00';
        }
        else if (groupBy === 'staff') { key = uid; label = staffName; }
        else if (groupBy === 'category') { key = L.category; label = L.category; }
        else if (groupBy === 'product') { key = L.productId || ('name:' + L.name); label = L.name; }
        else if (groupBy === 'channel') { key = ch; label = ch; }
        else { key = cid || 'walk-in'; label = cid ? custLabel : ''; }
        var gg = groupOf(key, label);
        if (kind === 'sale') {
          gg.sales[t.id] = 1; gg.units += L.qty; gg.grossC += L.grossC; gg.taxC += L.taxC; gg.netExC += L.netC; gg.discC += L.discC; gg.costC += L.costC;
        } else {
          gg.refunds[t.id] = 1; gg.units -= L.qty; gg.refundsC += L.grossC; gg.taxC -= L.taxC; gg.netExC -= L.netC; gg.costC -= L.costC;
        }
      }
    }

    var orig = kind === 'refund' ? saleByClient[String(t.original_client_tx || '')] : null;
    rows.push({
      id: String(t.id),
      kind: kind,
      receiptNo: String(t.receipt_no || ''),
      originalReceiptNo: orig ? String(orig.receipt_no || '') : '',
      createdAt: String(t.created_at || ''),
      staff: staffName,
      userId: uid,
      customer: custLabel,
      customerId: cid,
      channel: ch,
      externalRef: String(t.external_ref || ''),
      units: txUnits,
      discount: txDiscC / 100,
      tax: sign * txTaxC / 100,
      total: sign * txGrossC / 100,
      partial: kept.length < lines.length,
      tenders: tenders.map(function (x) { return { type: x.type, amount: sign * x.c / 100 }; }),
      grossProfit: isStore ? sign * (txNetC - txCostC) / 100 : undefined,
      lines: kept.map(function (x) {
        var o = { name: x.name, sku: x.sku, category: x.category, serialNumber: x.serialNumber, qty: x.qty, unitPrice: x.unitPrice,
          discountPct: x.discountPct, discount: x.discC / 100, tax: sign * x.taxC / 100, total: sign * x.grossC / 100 };
        if (isStore) { o.cost = sign * x.costC / 100; o.grossProfit = sign * (x.netC - x.costC) / 100; }
        return o;
      }),
    });
  }

  rows.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });

  var totalNetC = sum.grossC - sum.refundsC;
  var groupList = Object.keys(groups).map(function (key) {
    var g = groups[key];
    var netC = g.grossC - g.refundsC;
    var out = {
      key: g.key, label: g.label,
      sales: Object.keys(g.sales).length, refunds: Object.keys(g.refunds).length,
      units: g.units, gross: g.grossC / 100, refundsAmount: g.refundsC / 100, net: netC / 100,
      tax: g.taxC / 100, netExTax: g.netExC / 100, discounts: g.discC / 100,
      share: totalNetC ? Math.round(netC * 10000 / totalNetC) / 100 : 0,
    };
    if (groupBy === 'tender') { out.tax = null; out.netExTax = null; out.discounts = null; out.units = null; }
    if (isStore && groupBy !== 'tender') {
      out.cost = g.costC / 100;
      out.grossProfit = (g.netExC - g.costC) / 100;
      out.margin = g.netExC ? Math.round((g.netExC - g.costC) * 1000 / g.netExC) / 10 : null;
    }
    return out;
  });
  if (groupBy === 'day' || groupBy === 'hour') groupList.sort(function (a, b) { return String(a.key).localeCompare(String(b.key)); });
  else groupList.sort(function (a, b) { return b.net - a.net; });

  var summary = {
    salesCount: sum.salesCount,
    refundCount: sum.refundCount,
    grossSales: sum.grossC / 100,
    refunds: sum.refundsC / 100,
    netSales: totalNetC / 100,
    taxCollected: sum.taxInC / 100,
    taxRefunded: sum.taxOutC / 100,
    tax: (sum.taxInC - sum.taxOutC) / 100,
    netExTax: sum.netExC / 100,
    discounts: sum.discC / 100,
    unitsSold: sum.unitsSold,
    unitsReturned: sum.unitsReturned,
    avgSale: sum.salesCount ? Math.round(sum.grossC / sum.salesCount) / 100 : 0,
    itemsPerSale: sum.salesCount ? Math.round(sum.unitsSold * 100 / sum.salesCount) / 100 : 0,
  };
  if (isStore) {
    summary.cost = sum.costC / 100;
    summary.grossProfit = (sum.netExC - sum.costC) / 100;
    summary.margin = sum.netExC ? Math.round((sum.netExC - sum.costC) * 1000 / sum.netExC) / 10 : null;
  }

  var nameList = function (map, label) {
    return Object.keys(map).map(function (id) { return { id: id, name: label(id) }; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  };
  return {
    period: { from: period.fromIso, to: period.toIso },
    filters: f,
    groupBy: groupBy,
    canSeeCost: isStore,
    summary: summary,
    groups: groupList,
    rows: rows.slice(offset, offset + limit),
    rowsTotal: rows.length,
    offset: offset,
    options: {
      staff: isStore ? nameList(opt.staff, function (id) { return auditName_(id) || '—'; }) : [],
      categories: Object.keys(opt.categories).sort(),
      tenders: Object.keys(opt.tenders).sort(),
      channels: Object.keys(opt.channels).sort(),
      customers: nameList(opt.customers, function (id) { return custName[id] || 'Customer'; }),
      products: nameList(opt.products, function (id) { return opt.products[id]; }).slice(0, 500),
    },
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
  /* a traded-in device carries its own cost; the rest are at the product's */
  var serialCostKnown = {}, serialCostUnknown = {};
  var serRows = readRows_('Serials', SERIAL_HEADERS);
  for (var s = 0; s < serRows.length; s++) {
    if (String(serRows[s].status) !== 'IN_STOCK') continue;
    var spid = String(serRows[s].product_id);
    serialAvailable[spid] = (serialAvailable[spid] || 0) + 1;
    if (num_(serRows[s].cost) > 0) serialCostKnown[spid] = (serialCostKnown[spid] || 0) + num_(serRows[s].cost);
    else serialCostUnknown[spid] = (serialCostUnknown[spid] || 0) + 1;
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
    var value = isSerialized
      ? round2_((serialCostKnown[String(p.id)] || 0) + (serialCostUnknown[String(p.id)] || 0) * num_(p.cost_price))
      : round2_(onHand * num_(p.cost_price));

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
 *  Inventory tools (v1.15.0): reorder worksheet, bulk repricing,
 *  stock-take. All manager/admin; every write runs inside the script
 *  lock with its own audit trail.
 * ------------------------------------------------------------------ */

/* What to buy next. Velocity comes from actual sold units over a lookback
 * window (default 30 days, store-local days), so "days of cover" answers how
 * long the shelf lasts at the current rate. Suggested quantity tops the shelf
 * back up to the target cover, never below the reorder point, and is only
 * ever a suggestion — nothing is ordered here. */
function inventoryReorder_(session, params) {
  requireRole_(session, ['admin', 'manager']);
  var days = parseInt(params && params.days, 10);
  if (isNaN(days) || days < 1) days = 30;
  days = Math.min(days, 365);
  var targetDays = parseInt(params && params.cover, 10);
  if (isNaN(targetDays) || targetDays < 1) targetDays = 14;
  targetDays = Math.min(targetDays, 180);

  var nowMs = Date.now();
  var sinceIso = new Date(nowMs - days * 86400000).toISOString();

  /* units sold per product over the window; refunds give units back so a
     returned phone doesn't inflate the reorder. */
  var sold = {};
  var txRows = readRows_('Transactions', TX_HEADERS);
  for (var t = 0; t < txRows.length; t++) {
    var tx = txRows[t];
    if (String(tx.status) !== 'COMPLETED') continue;
    if (String(tx.created_at || '') < sinceIso) continue;
    var kind = String(tx.kind || 'sale');
    if (kind !== 'sale' && kind !== 'refund') continue;
    var sign = kind === 'refund' ? -1 : 1;
    var items = itobjs_(tx.items_json);
    for (var i = 0; i < items.length; i++) {
      var pid = String(items[i].productId || '');
      if (!pid) continue;
      sold[pid] = (sold[pid] || 0) + sign * (num_(items[i].quantity) || 1);
    }
  }

  /* the most recent supplier and unit cost that actually delivered this item,
     so the worksheet says who to call. */
  var lastSupplier = {};
  var supplierRows = readRows_('Suppliers', SUPPLIER_HEADERS);
  var supplierById = poSupplierMap_(supplierRows);
  var poRows = readRows_('PurchaseOrders', PO_HEADERS);
  poRows.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
  for (var po = 0; po < poRows.length; po++) {
    var lines = itobjs_(poRows[po].items_json);
    for (var li = 0; li < lines.length; li++) {
      var lpid = String(lines[li].productId || '');
      if (!lpid) continue;
      var sup = supplierById[String(poRows[po].supplier_id)];
      lastSupplier[lpid] = {
        supplierId: String(poRows[po].supplier_id || ''),
        supplierName: sup ? String(sup.name || '') : '',
        poNumber: String(poRows[po].po_number || ''),
        unitCost: num_(lines[li].unitCost),
        orderedAt: String(poRows[po].created_at || ''),
      };
    }
  }

  var serialAvailable = {};
  var serRows = readRows_('Serials', SERIAL_HEADERS);
  for (var s = 0; s < serRows.length; s++) {
    if (String(serRows[s].status) !== 'IN_STOCK') continue;
    var spid = String(serRows[s].product_id);
    serialAvailable[spid] = (serialAvailable[spid] || 0) + 1;
  }

  var items2 = [];
  var totalCost = 0;
  var prods = readRows_('Products', PRODUCT_HEADERS);
  for (var p = 0; p < prods.length; p++) {
    var prod = prods[p];
    if (String(prod.item_type) === 'service' || String(prod.active) !== '1') continue;
    var isSerialized = String(prod.is_serialized) === '1';
    var onHand = isSerialized ? (serialAvailable[String(prod.id)] || 0) : num_(prod.on_hand);
    var soldUnits = Math.max(0, sold[String(prod.id)] || 0);
    var perDay = soldUnits / days;
    var reorderPoint = prod.reorder_point === '' || prod.reorder_point == null ? 0 : num_(prod.reorder_point);
    var cover = perDay > 0 ? onHand / perDay : null;

    /* worth listing when the shelf is at/below its reorder point, empty with
       demand behind it, or short of the target cover at the current rate. */
    var wantForCover = perDay > 0 ? Math.ceil(perDay * targetDays) : 0;
    var target = Math.max(wantForCover, reorderPoint);
    var suggested = Math.max(0, target - onHand);
    var flagged = (reorderPoint > 0 && onHand <= reorderPoint)
      || (onHand <= 0 && soldUnits > 0)
      || (perDay > 0 && cover !== null && cover < targetDays);
    if (!flagged || suggested <= 0) continue;

    var unitCost = num_(prod.cost_price);
    var supplier = lastSupplier[String(prod.id)] || null;
    if (supplier && supplier.unitCost > 0) unitCost = supplier.unitCost;
    var lineCost = round2_(suggested * unitCost);
    totalCost += lineCost;

    items2.push({
      id: String(prod.id),
      name: String(prod.name || ''),
      sku: String(prod.sku || ''),
      category: String(prod.category || ''),
      isSerialized: isSerialized,
      onHand: onHand,
      reorderPoint: reorderPoint,
      soldUnits: soldUnits,
      perDay: Math.round(perDay * 100) / 100,
      daysOfCover: cover === null ? null : Math.round(cover * 10) / 10,
      suggested: suggested,
      unitCost: unitCost,
      lineCost: lineCost,
      supplierId: supplier ? supplier.supplierId : '',
      supplierName: supplier ? supplier.supplierName : '',
      lastPo: supplier ? supplier.poNumber : '',
    });
  }

  /* emptiest shelves with the strongest demand first. */
  items2.sort(function (a, b) {
    var ca = a.daysOfCover === null ? 9999 : a.daysOfCover;
    var cb = b.daysOfCover === null ? 9999 : b.daysOfCover;
    if (ca !== cb) return ca - cb;
    return b.suggested - a.suggested;
  });

  return {
    asOf: new Date().toISOString(),
    window: { days: days, coverDays: targetDays, since: sinceIso },
    items: items2,
    summary: { lines: items2.length, units: items2.reduce(function (n, x) { return n + x.suggested; }, 0), cost: round2_(totalCost) },
  };
}

/* What the shelf is worth, and how long it lasts. Every active product is
 * valued at retail (units × shelf price) and at cost (units × the
 * PO-received weighted cost; serialized products value each serial at its
 * own sticker cost, falling back to the product cost), shows its days of
 * cover from the same velocity the reorder worksheet uses, and is classified
 * fast / slow / dead by the program rules (D3). Slow and dead money is
 * reported, never auto-hidden and never repriced. Read-only like Reports:
 * admin and manager only, no write path here. */
function inventoryHealth_(session, params) {
  requireRole_(session, ['admin', 'manager']);
  if (String(params && params.view || '') === 'velocity') return inventoryVelocity_(session, params);
  var days = parseInt(params && params.days, 10);
  if (isNaN(days) || days < 1) days = 90;
  days = Math.min(days, 365);
  var deadDays = 180;
  var slowCoverDays = 180;
  var slowSoldMax = 1;
  var nowMs = Date.now();
  var dayMs = 86400000;
  var sinceIso = new Date(nowMs - days * dayMs).toISOString();
  var sinceDeadIso = new Date(nowMs - deadDays * dayMs).toISOString();

  /* units sold per product over the window, and over the dead-stock window;
     refunds give units back, exactly like the reorder worksheet. */
  var sold = {}, soldDead = {};
  var txRows = readRows_('Transactions', TX_HEADERS);
  for (var t = 0; t < txRows.length; t++) {
    var tx = txRows[t];
    if (String(tx.status) !== 'COMPLETED') continue;
    var kind = String(tx.kind || 'sale');
    if (kind !== 'sale' && kind !== 'refund') continue;
    var createdAt = String(tx.created_at || '');
    var sign = kind === 'refund' ? -1 : 1;
    var items = itobjs_(tx.items_json);
    var inWindow = createdAt >= sinceIso;
    var inDeadWindow = createdAt >= sinceDeadIso;
    for (var i = 0; i < items.length; i++) {
      var pid = String(items[i].productId || '');
      if (!pid) continue;
      var qty = sign * (num_(items[i].quantity) || 1);
      if (inWindow) sold[pid] = (sold[pid] || 0) + qty;
      if (inDeadWindow) soldDead[pid] = (soldDead[pid] || 0) + qty;
    }
  }

  var serialCount = {}, serialCostKnown = {}, serialCostUnknown = {};
  var serRows = readRows_('Serials', SERIAL_HEADERS);
  for (var s = 0; s < serRows.length; s++) {
    if (String(serRows[s].status) !== 'IN_STOCK') continue;
    var spid = String(serRows[s].product_id);
    serialCount[spid] = (serialCount[spid] || 0) + 1;
    if (num_(serRows[s].cost) > 0) serialCostKnown[spid] = (serialCostKnown[spid] || 0) + num_(serRows[s].cost);
    else serialCostUnknown[spid] = (serialCostUnknown[spid] || 0) + 1;
  }

  var summary = { products: 0, units: 0, retailValue: 0, costValue: 0, slowCount: 0, deadCount: 0 };
  /* null prototype so a category name like 'toString' cannot hit Object.prototype */
  var catMap = Object.create(null);
  var items2 = [];
  var prods = readRows_('Products', PRODUCT_HEADERS);
  for (var p = 0; p < prods.length; p++) {
    var prod = prods[p];
    if (String(prod.item_type) === 'service' || String(prod.active) !== '1') continue;
    var isSerialized = String(prod.is_serialized) === '1';
    var onHand = isSerialized ? (serialCount[String(prod.id)] || 0) : num_(prod.on_hand);
    if (onHand <= 0) continue;

    var retailPrice = num_(prod.retail_price);
    var retailValue = round2_(onHand * retailPrice);
    var costValue = isSerialized
      ? round2_((serialCostKnown[String(prod.id)] || 0) + (serialCostUnknown[String(prod.id)] || 0) * num_(prod.cost_price))
      : round2_(onHand * num_(prod.cost_price));

    var soldUnits = Math.max(0, sold[String(prod.id)] || 0);
    var soldDeadUnits = Math.max(0, soldDead[String(prod.id)] || 0);
    var perDay = soldUnits / days;
    var cover = perDay > 0 ? onHand / perDay : null;
    var movement = soldDeadUnits === 0 ? 'dead'
      : (soldUnits <= slowSoldMax || (cover !== null && cover > slowCoverDays)) ? 'slow' : 'fast';

    var category = String(prod.category || '');
    var cat = catMap[category] || (catMap[category] = { category: category, units: 0, retailValue: 0, costValue: 0 });

    items2.push({
      id: String(prod.id),
      name: String(prod.name || ''),
      sku: String(prod.sku || ''),
      category: category,
      isSerialized: isSerialized,
      onHand: onHand,
      retailPrice: retailPrice,
      /* the per-unit cost figure a serialized product shows is its weighted
         on-the-shelf cost, because each serial may carry its own sticker. */
      costPrice: isSerialized ? round2_(costValue / onHand) : num_(prod.cost_price),
      retailValue: retailValue,
      costValue: costValue,
      soldUnits: soldUnits,
      perDay: Math.round(perDay * 100) / 100,
      daysOfCover: cover === null ? null : Math.round(cover * 10) / 10,
      movement: movement,
    });

    summary.products += 1;
    summary.units += onHand;
    summary.retailValue += retailValue;
    summary.costValue += costValue;
    if (movement === 'slow') summary.slowCount += 1;
    if (movement === 'dead') summary.deadCount += 1;
    cat.units += onHand;
    cat.retailValue += retailValue;
    cat.costValue += costValue;
  }

  summary.retailValue = round2_(summary.retailValue);
  summary.costValue = round2_(summary.costValue);
  var categories = [];
  for (var key in catMap) {
    catMap[key].retailValue = round2_(catMap[key].retailValue);
    catMap[key].costValue = round2_(catMap[key].costValue);
    categories.push(catMap[key]);
  }
  /* the most money stuck in a category first. */
  categories.sort(function (a, b) { return b.costValue - a.costValue; });
  items2.sort(function (a, b) { return b.costValue - a.costValue; });

  return {
    asOf: new Date().toISOString(),
    window: { days: days, since: sinceIso },
    rules: { slowCoverDays: slowCoverDays, slowSoldMax: slowSoldMax, deadDays: deadDays },
    summary: summary,
    categories: categories,
    items: items2,
  };
}

/* Sell-through (v1.52.0): how fast things actually move, so buying has
 * numbers behind it. Units and AED sold and refunded in the window (30 days
 * for sell-through, D2; `days` clamps 1-365), per product and per category,
 * using the Sales-report money rules: line price minus the line and order
 * discounts, tax taken out of a tax-inclusive line. turnover is AED sold
 * divided by the average shelf value over the period - the retail turnover
 * ratio. buyAgain is the product already selling through faster than it is
 * replacing (more units out than in, and the shelf would not last the
 * window): a buying signal on screen, nothing auto-ordered. */
function inventoryVelocity_(session, params) {
  requireRole_(session, ['admin', 'manager']);
  var days = parseInt(params && params.days, 10);
  if (isNaN(days) || days < 1) days = 30;
  days = Math.min(days, 365);
  var nowMs = Date.now();
  var sinceIso = new Date(nowMs - days * 86400000).toISOString();

  var prodById = {};
  var prods = readRows_('Products', PRODUCT_HEADERS);
  for (var p = 0; p < prods.length; p++) prodById[String(prods[p].id)] = prods[p];

  /* units and AED sold / refunded, units received (purchase rows), and the
     cost-at-sale for gross profit - the same money the Sales report computes. */
  var soldU = {}, refundU = {}, soldRev = {}, refundRev = {}, received = {}, cost = {};
  var add = function (map, key, n) { map[key] = (map[key] || 0) + n; };
  var txRows = readRows_('Transactions', TX_HEADERS);
  for (var t = 0; t < txRows.length; t++) {
    var tx = txRows[t];
    if (String(tx.status) !== 'COMPLETED') continue;
    if (String(tx.created_at || '') < sinceIso) continue;
    var kind = String(tx.kind || 'sale');
    var items = itobjs_(tx.items_json);
    if (kind === 'sale' || kind === 'refund') {
      var sign = kind === 'refund' ? -1 : 1;
      var orderPct = num_(tx.discount_pct);
      for (var i = 0; i < items.length; i++) {
        var it = items[i] || {};
        var pid = String(it.productId || '');
        if (!pid) continue;
        var qty = Math.max(1, num_(it.quantity) || 1);
        var linePct = clampPct_(num_(it.discountPct));
        var lineNetCents = round2_(num_(it.unitPrice) * 100 * qty * (1 - linePct / 100));
        var revCents = round2_(lineNetCents * (100 - orderPct) / 100);
        if (String(tx.tax_inclusive) === '1' && it.taxable !== false && num_(tx.tax_rate) > 0) {
          revCents = revCents * 100 / (100 + num_(tx.tax_rate));
        }
        var lineRev = round2_(Math.round(revCents) / 100);
        if (sign < 0) { add(refundU, pid, qty); add(refundRev, pid, lineRev); }
        else { add(soldU, pid, qty); add(soldRev, pid, lineRev); }
        var prod = prodById[pid];
        var costPer = (typeof it.unitCost === 'number' && it.unitCost > 0) ? it.unitCost
          : (prod ? num_(prod.cost_price) : 0);
        add(cost, pid, sign * costPer * qty);
      }
    } else if (kind === 'purchase') {
      for (var pi = 0; pi < items.length; pi++) {
        var itp = items[pi] || {};
        var pid2 = String(itp.productId || '');
        if (!pid2) continue;
        add(received, pid2, Math.max(1, num_(itp.quantity) || 1));
      }
    }
  }

  var serialCount = {};
  var serRows = readRows_('Serials', SERIAL_HEADERS);
  for (var s = 0; s < serRows.length; s++) {
    if (String(serRows[s].status) !== 'IN_STOCK') continue;
    var spid = String(serRows[s].product_id);
    serialCount[spid] = (serialCount[spid] || 0) + 1;
  }

  var probe = {};
  for (var pr = 0; pr < prods.length; pr++) {
    probe[String(prods[pr].id)] = 1;
  }
  for (var mu in soldU) probe[mu] = 1;
  for (var mr in refundU) probe[mr] = 1;
  for (var mm in received) probe[mm] = 1;

  var rows = [];
  var catMap = Object.create(null);
  var summary = { products: 0, units: 0, netRevenue: 0, grossProfit: 0, avgShelfValue: 0, buyAgainCount: 0, turnover: null };
  var buyAgain = [];
  for (var id in probe) {
    var prod = prodById[id];
    if (!prod || String(prod.item_type) === 'service' || String(prod.active) !== '1') continue;
    var isSerialized = String(prod.is_serialized) === '1';
    var onHand = isSerialized ? (serialCount[id] || 0) : Math.max(0, num_(prod.on_hand));
    var unitsSold = soldU[id] || 0;
    var unitsRefunded = refundU[id] || 0;
    var netUnits = unitsSold - unitsRefunded;
    var revenueSold = round2_(soldRev[id] || 0);
    var revenueRefunded = round2_(refundRev[id] || 0);
    var netRevenue = round2_(revenueSold - revenueRefunded);
    var receivedUnits = received[id] || 0;
    /* only rows that moved in the window or still sit on the shelf. */
    if (netUnits === 0 && receivedUnits === 0 && onHand <= 0) continue;

    var grossProfit = round2_(netRevenue - round2_(cost[id] || 0));
    var margin = netRevenue ? Math.round(grossProfit * 1000 / netRevenue) / 10 : null;

    /* average shelf value over the window: the shelf began where it is today
       less what arrived, plus what left; at retail, because turnover is
       revenue against the price on the labels. */
    var beginUnits = Math.max(0, onHand + netUnits - receivedUnits);
    var avgUnits = (beginUnits + onHand) / 2;
    var avgShelfValue = round2_(avgUnits * num_(prod.retail_price));
    var perDay = netUnits / days;
    var cover = perDay > 0 ? round2_(onHand / perDay * 10) / 10 : null;
    /* outpaces replacement, and the shelf would not last the window. */
    var buy = netUnits > 0 && netUnits > receivedUnits && (onHand === 0 || (cover !== null && cover < days));

    var category = String(prod.category || '');
    var cat = catMap[category] || (catMap[category] = {
      category: category, products: 0, units: 0, netRevenue: 0, grossProfit: 0, avgShelfValue: 0,
    });

    var row = {
      id: id, name: String(prod.name || ''), sku: String(prod.sku || ''),
      category: category, isSerialized: isSerialized, onHand: onHand,
      unitsSold: unitsSold, unitsRefunded: unitsRefunded, netUnits: netUnits,
      revenueSold: revenueSold, revenueRefunded: revenueRefunded, netRevenue: netRevenue,
      avgShelfValue: avgShelfValue,
      turnover: netRevenue > 0 && avgShelfValue > 0 ? round2_(netRevenue / avgShelfValue * 100) / 100 : null,
      perDay: Math.round(perDay * 100) / 100,
      daysOfCover: cover,
      grossProfit: grossProfit, margin: margin,
      receivedUnits: receivedUnits,
      buyAgain: buy,
    };
    rows.push(row);
    if (buy) buyAgain.push(row);

    summary.products += 1;
    summary.units += netUnits;
    summary.netRevenue += netRevenue;
    summary.grossProfit += grossProfit;
    summary.avgShelfValue += avgShelfValue;
    if (buy) summary.buyAgainCount += 1;
    cat.products += 1;
    cat.units += netUnits;
    cat.netRevenue += netRevenue;
    cat.grossProfit += grossProfit;
    cat.avgShelfValue += avgShelfValue;
  }

  var categories = [];
  for (var key in catMap) {
    var c = catMap[key];
    c.turnover = c.netRevenue > 0 && c.avgShelfValue > 0 ? round2_(c.netRevenue / c.avgShelfValue * 100) / 100 : null;
    categories.push(c);
  }
  categories.sort(function (a, b) { return b.netRevenue - a.netRevenue; });
  rows.sort(function (a, b) { return b.netRevenue - a.netRevenue; });
  buyAgain.sort(function (a, b) { return b.netUnits - a.netUnits; });

  summary.netRevenue = round2_(summary.netRevenue);
  summary.grossProfit = round2_(summary.grossProfit);
  summary.avgShelfValue = round2_(summary.avgShelfValue);
  summary.turnover = summary.netRevenue > 0 && summary.avgShelfValue > 0 ? round2_(summary.netRevenue / summary.avgShelfValue * 100) / 100 : null;

  return {
    asOf: new Date().toISOString(),
    view: 'velocity',
    window: { days: days, since: sinceIso },
    summary: summary,
    categories: categories,
    items: rows,
    buyAgain: buyAgain,
  };
}

/* Bulk reprice. The client sends a RULE, not prices: the server reads each
 * product under the lock and computes the new value itself, so a stale catalog
 * on the terminal can never write a price nobody chose. `preview: true`
 * returns the same list without writing a thing. Every applied change lands in
 * PriceHistory with source 'bulk', exactly like a manual edit. */
function bulkPriceTargets_(prodRows, payload) {
  var ids = {};
  var idList = payload && payload.productIds;
  if (Object.prototype.toString.call(idList) === '[object Array]') {
    for (var i = 0; i < idList.length; i++) ids[String(idList[i])] = true;
  }
  var category = String((payload && payload.category) || '').trim();
  var out = [];
  for (var p = 0; p < prodRows.length; p++) {
    var prod = prodRows[p];
    if (String(prod.active) !== '1') continue;
    if (String(prod.item_type) === 'service' && !ids[String(prod.id)]) continue;
    if (idList && idList.length) {
      if (!ids[String(prod.id)]) continue;
    } else if (category && category !== 'All') {
      if (String(prod.category || '') !== category) continue;
    }
    out.push(prod);
  }
  return out;
}

function bulkPriceNext_(current, mode, value, roundTo) {
  var next;
  if (mode === 'set') next = value;
  else if (mode === 'delta') next = current + value;
  else next = current * (1 + value / 100);   /* 'pct' */
  if (next < 0) next = 0;
  next = round2_(next);
  if (roundTo > 0) {
    next = Math.round(next / roundTo) * roundTo;
    next = round2_(next);
  }
  return next;
}

function adminBulkPrice_(session, payload) {
  /* admin only: repricing the catalog is an ownership act, not a daily one */
  requireRole_(session, ['admin']);
  var field = String((payload && payload.field) || 'retail_price');
  if (field !== 'retail_price' && field !== 'cost_price') {
    throw statusError_(400, 'field must be retail_price or cost_price');
  }
  var mode = String((payload && payload.mode) || 'pct');
  if (['pct', 'delta', 'set'].indexOf(mode) < 0) {
    throw statusError_(400, 'mode must be pct, delta or set');
  }
  var value = num_(payload && payload.value);
  if (mode === 'pct' && (value < -90 || value > 900)) {
    throw statusError_(400, 'percentage change must be between -90 and 900');
  }
  if ((mode === 'set' || mode === 'delta') && (value < -1000000 || value > 1000000)) {
    throw statusError_(400, 'value out of range');
  }
  if (mode === 'set' && value < 0) throw statusError_(400, 'a price cannot be negative');
  var roundTo = num_(payload && payload.roundTo);
  if (roundTo < 0 || roundTo > 1000) throw statusError_(400, 'roundTo out of range');
  var preview = !!(payload && payload.preview);
  var note = String((payload && payload.note) || '').slice(0, 120);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var prodRows = readRows_('Products', PRODUCT_HEADERS);
    var targets = bulkPriceTargets_(prodRows, payload);
    if (!targets.length) throw statusError_(400, 'no products matched');
    if (targets.length > 500) throw statusError_(400, 'too many products in one run (max 500)');

    var changes = [];
    var patches = {};
    var now = new Date().toISOString();
    for (var i = 0; i < targets.length; i++) {
      var prod = targets[i];
      var current = num_(prod[field]);
      var next = bulkPriceNext_(current, mode, value, roundTo);
      if (next === current) continue;
      changes.push({
        id: String(prod.id),
        name: String(prod.name || ''),
        sku: String(prod.sku || ''),
        field: field,
        oldValue: current,
        newValue: next,
      });
      if (!preview) {
        var patch = { updated_at: now };
        patch[field] = next;
        patches[String(prod.id)] = patch;
      }
    }

    if (!preview && changes.length) {
      applyPatches_('Products', PRODUCT_HEADERS, 'id', patches);
      for (var c = 0; c < changes.length; c++) {
        recordPriceChange_(
          { id: changes[c].id, name: changes[c].name },
          field, changes[c].oldValue, changes[c].newValue,
          'bulk', null, String(session.uid || ''));
      }
      logAudit_(session, 'price.bulk', 'catalog', field,
        changes.length + ' prices changed (' + mode + ' ' + value + ')', '');
    }

    return {
      preview: preview,
      matched: targets.length,
      changed: changes.length,
      field: field,
      mode: mode,
      value: value,
      note: note,
      changes: changes,
    };
  } finally {
    lock.releaseLock();
  }
}

/* Stock-take: a counted shelf becomes the truth. Every line records what the
 * book said, what was counted, the variance and what that variance is worth at
 * cost, so a shrinkage number survives the recount. Serialized stock is
 * counted by scanning serials, not by typing a number, so it is refused here.
 * Read + write happen under the lock: the "expected" a variance is measured
 * against must be the value that is actually being overwritten. */
function adminStockTake_(session, payload) {
  /* admin only: committing a count rewrites stock on the owner's authority */
  requireRole_(session, ['admin']);
  var counts = payload && payload.counts;
  if (Object.prototype.toString.call(counts) !== '[object Array]' || !counts.length) {
    throw statusError_(400, 'counts are required');
  }
  if (counts.length > 500) throw statusError_(400, 'too many lines in one count (max 500)');
  var note = String((payload && payload.note) || '').slice(0, 200);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var prodRows = readRows_('Products', PRODUCT_HEADERS);
    var byId = {};
    for (var i = 0; i < prodRows.length; i++) byId[String(prodRows[i].id)] = prodRows[i];

    var sessionId = Utilities.getUuid();
    var now = new Date().toISOString();
    var patches = {};
    var auditRows = [];
    var lines = [];
    var totalVariance = 0;
    var valueDelta = 0;

    for (var c = 0; c < counts.length; c++) {
      var line = counts[c] || {};
      var pid = String(line.productId || '');
      var prod = byId[pid];
      if (!prod) throw statusError_(404, 'Product not found: ' + pid);
      if (String(prod.item_type) === 'service') {
        throw statusError_(400, 'Services carry no stock to count: ' + String(prod.name || pid));
      }
      if (String(prod.is_serialized) === '1') {
        throw statusError_(400, 'Serialized stock is counted by serial, not by quantity: ' + String(prod.name || pid));
      }
      var counted = num_(line.counted);
      if (!(counted >= 0) || counted !== Math.floor(counted)) {
        throw statusError_(400, 'counted must be a whole number >= 0');
      }
      var expected = num_(prod.on_hand);
      var variance = counted - expected;
      var unitCost = num_(prod.cost_price);
      var delta = round2_(variance * unitCost);

      totalVariance += variance;
      valueDelta += delta;
      lines.push({
        productId: pid,
        name: String(prod.name || ''),
        sku: String(prod.sku || ''),
        expected: expected,
        counted: counted,
        variance: variance,
        unitCost: unitCost,
        valueDelta: delta,
      });

      if (variance !== 0) {
        patches[pid] = { on_hand: counted, updated_at: now };
      }
      auditRows.push({
        id: Utilities.getUuid(),
        store_id: getStore_().id,
        session_id: sessionId,
        product_id: pid,
        product_name: String(prod.name || ''),
        sku: String(prod.sku || ''),
        expected: expected,
        counted: counted,
        variance: variance,
        unit_cost: unitCost,
        value_delta: delta,
        counted_by: String(session.uid || ''),
        note: note,
        created_at: now,
      });
    }

    if (Object.keys(patches).length) {
      applyPatches_('Products', PRODUCT_HEADERS, 'id', patches);
    }
    appendRows_('StockTakes', STOCKTAKE_HEADERS, auditRows);
    logAudit_(session, 'stock.take', 'session', sessionId,
      lines.length + ' lines counted, ' + Object.keys(patches).length + ' adjusted', '');

    return {
      sessionId: sessionId,
      countedAt: now,
      lines: lines,
      summary: {
        lines: lines.length,
        adjusted: Object.keys(patches).length,
        unitVariance: totalVariance,
        valueDelta: round2_(valueDelta),
      },
    };
  } finally {
    lock.releaseLock();
  }
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
  /* Adding a supplier is admin only - who the shop buys from is an ownership
     decision. Reading the list is not: managers raise and receive purchase
     orders, and the Purchases screen cannot load without it (v1.48.0 fix). */
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

  requireRole_(session, ['admin']);
  var name = String(payload.name || '').trim();
  if (!name) throw statusError_(400, 'Supplier name is required');

  /* Name uniqueness is a first-committed-wins claim: the existing-name check
     and the append both happen under the lock so two parallel creates of the
     same supplier can't both pass the pre-lock snapshot. */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var existing = readRows_('Suppliers', SUPPLIER_HEADERS);
    var store = getStore_();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i].store_id) === store.id
          && String(existing[i].name).toLowerCase() === name.toLowerCase()) {
        throw statusError_(409, 'A supplier with that name already exists');
      }
    }

    var now = new Date().toISOString();
    var id = Utilities.getUuid();
    appendRows_('Suppliers', SUPPLIER_HEADERS, [{
      id: id, store_id: store.id, name: name,
      phone: String(payload.phone || '').trim(), email: String(payload.email || '').trim(),
      address: String(payload.address || '').trim(), payment_terms: String(payload.paymentTerms || '').trim(),
      active: payload.active === false ? 0 : 1, created_at: now,
    }]);
    logAudit_(session, 'supplier.create', 'supplier', id, name, payload.deviceId);
    return { id: id };
  } finally {
    lock.releaseLock();
  }
}

function round2_(n) {
  /* half-away-from-zero, sign-safe: a negative -1.005 must round to -1.01,
     never to -1.00 (the historical Math.round(+EPSILON) form was asymmetric
     and only correct for positives). */
  var x = Number(n) || 0;
  var sign = x < 0 ? -1 : 1;
  return sign * Math.round((Math.abs(x) + Number.EPSILON) * 100) / 100;
}

/* What has been received, by product. received_json is a list, and a delivery
   of some of an order's lines writes only those lines, so reading it by
   position put one line's quantity against another's. */
function receivedByProduct_(json) {
  var rows = itobjs_(json);
  var out = Object.create(null);
  for (var i = 0; i < rows.length; i++) out[String(rows[i].productId)] = rows[i];
  return out;
}

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
        var received = receivedByProduct_(po.received_json);
        var ordered = 0, got = 0;
        for (var i = 0; i < items.length; i++) {
          ordered += items[i].quantity || 1;
          var had = received[String(items[i].productId)];
          got += Math.min(num_(had ? had.quantity : 0), num_(items[i].quantity || 1));
        }
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
  var taxAmount = round2_(Math.max(0, num_(payload.taxAmount)));
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
    /* ordering what the bench is waiting for: every open need for a product on
       this order is stamped with it, so the ticket can say which order it is
       on and when it is due. It reserves nothing - the unit that arrives can
       still be sold at the counter. */
    var linkedNeeds = 0;
    if (payload.linkNeeds) {
      var repairRows = readRows_('Repairs', REPAIR_HEADERS);
      var wantIds = built.items.map(function (it) { return String(it.productId); });
      var hits = needsForProducts_(wantIds, repairRows);
      var needPatches = {};
      for (var h = 0; h < hits.length; h++) {
        var hit = hits[h];
        if (String(hit.need.poId || '')) continue;
        var pending = needPatches[String(hit.row.id)];
        var ns = itobjs_(pending ? pending.needs_json : hit.row.needs_json);
        if (!ns[hit.index]) continue;
        ns[hit.index].poId = id;
        ns[hit.index].orderedAt = now;
        needPatches[String(hit.row.id)] = { needs_json: JSON.stringify(ns), updated_at: now };
        linkedNeeds += 1;
      }
      if (linkedNeeds) applyPatches_('Repairs', REPAIR_HEADERS, 'id', needPatches);
    }

    logAudit_(session, 'po.create', 'purchase_order', id,
      poNumber + ' for ' + String(supplier.name) + ', ' + built.items.length + ' line(s), total ' + total + ' (' + status + ')'
      + (linkedNeeds ? ', ' + linkedNeeds + ' for the bench' : ''), payload.deviceId);
    return { id: id, poNumber: poNumber, status: status, total: total, linkedNeeds: linkedNeeds };
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
  var received = receivedByProduct_(po.received_json);
  var prods = readRows_('Products', PRODUCT_HEADERS);
  var onHandById = {};
  for (var p = 0; p < prods.length; p++) onHandById[String(prods[p].id)] = num_(prods[p].on_hand);

  var outItems = items.map(function (it, idx) {
    var hadRow = received[String(it.productId || '')];
    var got = Math.min(num_(hadRow ? hadRow.quantity : 0), num_(it.quantity || 1));
    return {
      productId: String(it.productId || ''), name: String(it.name || ''), sku: String(it.sku || ''),
      quantity: num_(it.quantity || 1), unitCost: num_(it.unitCost),
      netUnitCost: round2_(num_(it.unitCost) * (100 - poDiscountPct_(po)) / 100),
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

/* ------------------------------------------------------------------ *
 *  What a delivery is owed (v1.49.0)
 *
 *  An order's discount and its tax belong to the whole order, not to a line,
 *  so a part delivery carries its share of both. Both shares are worked out
 *  cumulatively - what the order owes once this delivery has arrived, less
 *  what it owed before - so however many deliveries an order arrives in, the
 *  shares add up to the order's own total and the last one carries the
 *  rounding.
 *
 *  The discount is a trade discount: it lowers what the stock actually cost,
 *  so it is inside the cost blended into the product and written on a serial.
 *  The tax is not: it is input tax the store reclaims (account 2000), never
 *  part of the cost of the goods. A store that cannot reclaim its purchase
 *  tax should leave the order's tax at zero and carry the tax in the line
 *  costs, where it belongs in the cost of the stock.
 * ------------------------------------------------------------------ */

function poDiscountPct_(po) {
  return Math.min(100, Math.max(0, num_(po.discount_pct)));
}

/* the goods in a run of deliveries worth subtotalC, after the order discount */
function poNetGoodsC_(po, subtotalC) {
  return Math.round(subtotalC * (100 - poDiscountPct_(po)) / 100);
}

/* their share of the order's tax, pro rata on the ordered cost */
function poTaxShareC_(po, subtotalC) {
  var taxC = cents_(po.tax_amount);
  var orderSubC = cents_(po.subtotal);
  if (!taxC || !(orderSubC > 0)) return 0;
  if (subtotalC >= orderSubC) return taxC;
  return Math.round(taxC * subtotalC / orderSubC);
}

function purchaseOrderReceive_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  var id = String((payload && payload.id) || '');
  var lines = Array.isArray(payload && payload.lines) ? payload.lines : [];
  if (!id || !lines.length) throw statusError_(400, 'Order id and lines are required');

  /* The whole receipt is one first-committed-wins claim: the order lookup,
     the outstanding-quantity + serial-duplicate validation, the cost blend,
     and the patches all run under the lock so two terminals receiving the
     same PO in parallel can't both pass the pre-lock snapshot and over-apply
     stock or register the same serial twice. */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
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
    var txItems = [];
    var project = {};

    /* first pass: what may be taken, and what it was ordered at */
    var taking = [];
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
      var sn = Array.isArray(ln.serialNumbers) ? ln.serialNumbers.map(function (s) { return String(s).trim(); }).filter(Boolean) : [];
      if (String(prod.is_serialized) === '1') {
        if (sn.length !== qty) throw statusError_(400, 'Serials required for serialized stock');
        for (var s2 = 0; s2 < sn.length; s2++) {
          if (serialSet[sn[s2]]) throw statusError_(409, 'Serial already registered: ' + sn[s2]);
          serialSet[sn[s2]] = true;
        }
      }
      taking.push({ pid: pid, prod: prod, ordered: ordered, qty: qty, serials: sn, grossC: cents_(qty * num_(ordered.unitCost)) });
      newReceived.push({ productId: pid, quantity: prevQty + qty, serials: sn });
    }

    /* all outstanding received? a line finished by an earlier delivery counts:
       reading its previous row as a number (it is an object) used to leave a
       fully delivered order stuck on PARTIAL. */
    var allDone = items.every(function (it) {
      var post = newReceived.find(function (r) { return String(r.productId) === String(it.productId); });
      var was = receivedById[String(it.productId)];
      return num_(post ? post.quantity : (was ? was.quantity : 0)) >= num_(it.quantity);
    });

    /* what this delivery is owed: its goods after the order's discount, plus
       its share of the order's tax, both cumulative so the shares always add
       up to the order's total (poNetGoodsC_ / poTaxShareC_). */
    var prevSubC = 0;
    for (var pi = 0; pi < items.length; pi++) {
      var wasRow = receivedById[String(items[pi].productId)];
      var wasQty = Math.min(num_(wasRow ? wasRow.quantity : 0), num_(items[pi].quantity));
      prevSubC += cents_(wasQty * num_(items[pi].unitCost));
    }
    var takenSubC = 0;
    for (var ti = 0; ti < taking.length; ti++) takenSubC += taking[ti].grossC;
    var cumSubC = allDone ? Math.max(prevSubC + takenSubC, cents_(po.subtotal)) : prevSubC + takenSubC;
    var goodsC = poNetGoodsC_(po, cumSubC) - poNetGoodsC_(po, prevSubC);
    var taxShareC = poTaxShareC_(po, cumSubC) - poTaxShareC_(po, prevSubC);
    var owedC = goodsC + taxShareC;
    var lineGoodsC = splitCents_(goodsC, taking.map(function (tk) { return tk.grossC; }));

    /* second pass: stock in, at what it cost after the discount */
    for (var ai = 0; ai < taking.length; ai++) {
      var tk = taking[ai];
      var lineC = num_(lineGoodsC[ai]);
      var netUnit = round2_(lineC / 100 / tk.qty);
      for (var sx = 0; sx < tk.serials.length; sx++) {
        serialNew.push({ id: Utilities.getUuid(), product_id: tk.pid, serial_number: tk.serials[sx], status: 'IN_STOCK',
          tx_id: '', updated_at: stamp, cost: netUnit, source: 'po' });
      }
      for (var tx = 0; tx < tk.qty; tx++) {
        txItems.push({ productId: tk.pid, name: String(tk.ordered.name || ''), quantity: 1, unitPrice: netUnit, unitCost: netUnit, taxable: !(String(tk.prod.taxable) === '0') });
      }
      if (String(tk.prod.is_serialized) !== '1') {
        var onHand = num_(tk.prod.on_hand);
        var newOnHand = onHand + tk.qty;
        var newCost = (onHand * num_(tk.prod.cost_price) + lineC / 100) / newOnHand;
        if (!(newCost > 0)) newCost = netUnit;
        patches[tk.pid] = { on_hand: newOnHand, cost_price: round2_(newCost), updated_at: stamp };
        project[tk.pid] = { onHand: newOnHand, unitCost: round2_(newCost) };
      } else {
        project[tk.pid] = { onHand: num_(tk.prod.on_hand) + tk.qty, unitCost: netUnit };
      }
    }

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
    if (owedC > 0) {
      /* tax_amount on a purchase row is the input tax inside its total, so the
         books can debit the stock and the tax separately. subtotal stays empty:
         a receipt earns nothing, and a stored subtotal would read as revenue. */
      appendRows_('Transactions', TX_HEADERS, [{
        id: Utilities.getUuid(), store_id: getStore_().id, user_id: String(session.uid || ''), device_id: 'server',
        client_tx_id: 'po-' + id.slice(0, 8) + '-' + stamp.slice(0, 10), kind: 'purchase',
        original_client_tx: '', counterparty: supplierName, grand_total: round2_(owedC / 100),
        status: 'COMPLETED', tenders_json: '[]', items_json: JSON.stringify(txItems),
        note: 'Received against ' + String(po.po_number || ''), created_at: new Date().toISOString(),
        subtotal: '', tax_amount: taxShareC ? round2_(taxShareC / 100) : '', discount_pct: '', customer_id: '',
        supplier_id: String(po.supplier_id || ''), po_id: id,
      }]);
    }
    /* which bench jobs this delivery frees: the oldest need for a part that is
       now on the shelf in the quantity it asked for. Nothing is reserved, so
       this is what could go ahead, not a promise. */
    var unblocked = [];
    var freshProds = readRows_('Products', PRODUCT_HEADERS);
    var freshById = {};
    for (var fp = 0; fp < freshProds.length; fp++) freshById[String(freshProds[fp].id)] = freshProds[fp];
    var freshSerials = serialsAvailable_();
    var available = Object.create(null);
    var receivedIds = [];
    for (var av = 0; av < taking.length; av++) {
      available[taking[av].pid] = stockOnHand_(freshById[taking[av].pid], freshSerials);
      receivedIds.push(taking[av].pid);
    }
    var waiting = needsForProducts_(receivedIds, readRows_('Repairs', REPAIR_HEADERS));
    for (var wt = 0; wt < waiting.length; wt++) {
      var nd = waiting[wt].need || {};
      var npid = String(nd.productId || '');
      var nqty = num_(nd.quantity || 1);
      if (num_(available[npid]) < nqty) continue;
      available[npid] -= nqty;
      unblocked.push({
        repairId: String(waiting[wt].row.id), ticketNo: String(waiting[wt].row.ticket_no || ''),
        customerName: String(waiting[wt].row.customer_name || ''), productId: npid,
        name: String(nd.name || ''), quantity: nqty,
      });
    }

    logAudit_(session, 'po.receive', 'purchase_order', id,
      String(po.po_number || '') + ': ' + txItems.length + ' unit(s) received, stock ' + round2_(goodsC / 100)
      + (taxShareC ? ' + tax ' + round2_(taxShareC / 100) : '') + ', owed ' + round2_(owedC / 100) + ' (' + newStatus + ')'
      + (unblocked.length ? ', frees ' + unblocked.length + ' bench job(s)' : ''), payload.deviceId);
    return {
      id: id, status: newStatus, receivedValue: round2_(owedC / 100),
      goodsValue: round2_(goodsC / 100), taxValue: round2_(taxShareC / 100), unblocked: unblocked,
      lines: newReceived.map(function (r) {
        return { productId: String(r.productId), quantity: num_(r.quantity), onHand: project[String(r.productId)] ? project[String(r.productId)].onHand : null, unitCost: project[String(r.productId)] ? project[String(r.productId)].unitCost : null };
      }),
    };
  } finally {
    lock.releaseLock();
  }
}

function purchaseOrderCancel_(session, payload) {
  /* admin only: cancelling an order destroys a commitment */
  requireRole_(session, ['admin']);
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
    /* the bench is waiting again: an order that is gone can no longer be what
     a ticket is on order with */
  var cancelRows = readRows_('Repairs', REPAIR_HEADERS);
  var cancelPatches = {};
  for (var cr = 0; cr < cancelRows.length; cr++) {
    var cneeds = itobjs_(cancelRows[cr].needs_json);
    var touched = false;
    for (var cn = 0; cn < cneeds.length; cn++) {
      if (String(cneeds[cn].poId || '') !== id) continue;
      cneeds[cn].poId = '';
      cneeds[cn].orderedAt = '';
      touched = true;
    }
    if (touched) cancelPatches[String(cancelRows[cr].id)] = { needs_json: JSON.stringify(cneeds), updated_at: new Date().toISOString() };
  }
  if (Object.keys(cancelPatches).length) applyPatches_('Repairs', REPAIR_HEADERS, 'id', cancelPatches);

  logAudit_(session, 'po.cancel', 'purchase_order', id, String(po.po_number || '') + ' cancelled (was ' + status + ')', payload.deviceId);
    return { id: id, status: 'CANCELLED' };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ *
 *  Supplier payments and accounts payable (v1.48.0)
 *
 *  Stock received against a purchase order is owed to the supplier (a
 *  'purchase' row, booked to Accounts payable). Paying them is a
 *  'supplier_payment' row: cash from the drawer, a bank transfer or a cheque,
 *  optionally against one order. What a supplier is owed is simply received
 *  less paid, and the part of it past the supplier's terms ("Net 30") is
 *  overdue, oldest delivery first.
 *
 *  A payment can be voided by an admin (entered twice, wrong supplier): the
 *  row is marked VOIDED, which takes it out of every total that reads only
 *  COMPLETED rows - the balance, the drawer, the books - while it stays on
 *  record.
 * ------------------------------------------------------------------ */

var SUPPLIER_PAY_METHODS = { cash: 'Cash', bank: 'Bank transfer', cheque: 'Cheque' };

/* "Net 30", "30 days", "net30" -> 30. Anything without a number is due on delivery. */
function termsDays_(terms) {
  var m = /(\d{1,3})/.exec(String(terms || ''));
  return m ? Math.min(365, num_(m[1])) : 0;
}

/* Which supplier and order a purchase or payment row belongs to. Rows written
   from v1.48.0 carry both; older receipts are traced through their client id
   ("po-<first 8 of the order id>-date") or, failing that, the supplier name. */
function payableLinks_(t, poById, poByPrefix, supplierByName) {
  var supplierId = String(t.supplier_id || '');
  var poId = String(t.po_id || '');
  if (!poId && String(t.kind) === 'purchase') {
    var m = /^po-([0-9a-f]{8})-/.exec(String(t.client_tx_id || ''));
    if (m && poByPrefix[m[1]]) poId = String(poByPrefix[m[1]].id);
  }
  if (!supplierId && poId && poById[poId]) supplierId = String(poById[poId].supplier_id || '');
  if (!supplierId) {
    var byName = supplierByName[String(t.counterparty || '').toLowerCase()];
    if (byName) supplierId = String(byName.id);
  }
  return { supplierId: supplierId, poId: poId };
}

/* Every supplier's account: receipts, payments, per order, and what is overdue. */
function payablesBook_() {
  var suppliers = readRows_('Suppliers', SUPPLIER_HEADERS);
  var pos = readRows_('PurchaseOrders', PO_HEADERS);
  var poById = Object.create(null), poByPrefix = Object.create(null), supplierByName = Object.create(null);
  for (var i = 0; i < pos.length; i++) { poById[String(pos[i].id)] = pos[i]; poByPrefix[String(pos[i].id).slice(0, 8)] = pos[i]; }
  for (var s = 0; s < suppliers.length; s++) supplierByName[String(suppliers[s].name || '').toLowerCase()] = suppliers[s];

  var books = Object.create(null);
  function bookOf(id) {
    return books[id] || (books[id] = { entries: [], orders: Object.create(null), receivedC: 0, paidC: 0 });
  }
  var tx = readRows_('Transactions', TX_HEADERS);
  for (var t = 0; t < tx.length; t++) {
    var row = tx[t];
    var kind = String(row.kind || '');
    if (kind !== 'purchase' && kind !== 'supplier_payment') continue;
    if (String(row.status) !== 'COMPLETED') continue;
    var links = payableLinks_(row, poById, poByPrefix, supplierByName);
    if (!links.supplierId) continue;
    var b = bookOf(links.supplierId);
    var c = cents_(row.grand_total);
    var method = '';
    if (kind === 'supplier_payment') {
      try { method = String((JSON.parse(row.tenders_json || '[]')[0] || {}).type || ''); } catch (_) {}
    }
    b.entries.push({ id: String(row.id), kind: kind, at: String(row.created_at || ''), c: c, poId: links.poId,
      poNumber: links.poId && poById[links.poId] ? String(poById[links.poId].po_number || '') : '',
      method: method, reference: String(row.external_ref || ''), note: String(row.note || ''), userId: String(row.user_id || '') });
    if (links.poId) {
      var o = b.orders[links.poId] || (b.orders[links.poId] = { receivedC: 0, paidC: 0 });
      if (kind === 'purchase') o.receivedC += c; else o.paidC += c;
    }
    if (kind === 'purchase') b.receivedC += c; else b.paidC += c;
  }
  return { suppliers: suppliers, books: books, poById: poById };
}

function supplierAccount_(supplier, book, poById, nowMs) {
  book = book || { entries: [], orders: Object.create(null), receivedC: 0, paidC: 0 };
  var days = termsDays_(supplier.payment_terms);
  var entries = book.entries.slice().sort(function (a, b) { return a.at.localeCompare(b.at); });
  /* overdue: deliveries past their due date, less every payment made, oldest first */
  var dueC = 0, oldestDue = '';
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.kind !== 'purchase') continue;
    var due = new Date(new Date(e.at).getTime() + days * 86400000);
    e.dueAt = isNaN(due.getTime()) ? '' : due.toISOString();
    if (!isNaN(due.getTime()) && due.getTime() < nowMs) { dueC += e.c; if (!oldestDue) oldestDue = e.dueAt; }
  }
  var balanceC = book.receivedC - book.paidC;
  var overdueC = Math.max(0, Math.min(balanceC, dueC - book.paidC));
  var orders = Object.keys(book.orders).map(function (poId) {
    var o = book.orders[poId], po = poById[poId] || {};
    var owedC = o.receivedC - o.paidC;
    return { poId: poId, poNumber: String(po.po_number || ''), status: String(po.status || ''), orderTotal: num_(po.total),
      received: o.receivedC / 100, paid: o.paidC / 100, owed: owedC / 100,
      payment: o.receivedC === 0 ? (o.paidC ? 'prepaid' : 'nothing_received') : owedC <= 0 ? 'paid' : o.paidC > 0 ? 'part_paid' : 'unpaid' };
  }).sort(function (a, b) { return String(b.poNumber).localeCompare(String(a.poNumber)); });
  return {
    id: String(supplier.id), name: String(supplier.name || ''), paymentTerms: String(supplier.payment_terms || ''), termsDays: days,
    received: book.receivedC / 100, paid: book.paidC / 100, balance: balanceC / 100,
    overdue: overdueC / 100, oldestDue: overdueC > 0 ? oldestDue : '',
    orders: orders, entries: entries,
  };
}

function supplierPayables_(session) {
  requireRole_(session, ['admin', 'manager']);
  var all = payablesBook_();
  var nowMs = Date.now();
  var store = getStore_();
  var list = all.suppliers.filter(function (s) { return String(s.store_id) === store.id; }).map(function (s) {
    var acc = supplierAccount_(s, all.books[String(s.id)], all.poById, nowMs);
    delete acc.entries;
    return acc;
  }).sort(function (a, b) { return b.overdue - a.overdue || b.balance - a.balance || a.name.localeCompare(b.name); });
  var owedC = 0, overdueC = 0;
  for (var i = 0; i < list.length; i++) { owedC += cents_(list[i].balance); overdueC += cents_(list[i].overdue); }
  return { suppliers: list, totalOwed: owedC / 100, totalOverdue: overdueC / 100 };
}

function supplierStatement_(session, params) {
  requireRole_(session, ['admin', 'manager']);
  var id = String((params && params.supplierId) || '');
  var all = payablesBook_();
  var supplier = null;
  for (var i = 0; i < all.suppliers.length; i++) if (String(all.suppliers[i].id) === id) { supplier = all.suppliers[i]; break; }
  if (!supplier) throw statusError_(404, 'Supplier not found');
  var acc = supplierAccount_(supplier, all.books[id], all.poById, Date.now());
  var runC = 0;
  acc.lines = acc.entries.map(function (e) {
    runC += e.kind === 'purchase' ? e.c : -e.c;
    return {
      id: e.id, kind: e.kind, at: e.at, poNumber: e.poNumber, dueAt: e.dueAt || '',
      received: e.kind === 'purchase' ? e.c / 100 : 0, paid: e.kind === 'supplier_payment' ? e.c / 100 : 0,
      balance: runC / 100, method: e.method, reference: e.reference, note: e.note, by: auditName_(e.userId),
    };
  });
  delete acc.entries;
  return acc;
}

function supplierPayment_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  payload = payload || {};
  var supplierId = String(payload.supplierId || '');
  var method = String(payload.method || '');
  var amountC = cents_(payload.amount);
  var reference = String(payload.reference || '').trim().slice(0, 60);
  var note = String(payload.note || '').trim().slice(0, 200);
  var poId = String(payload.poId || '');
  if (!Object.prototype.hasOwnProperty.call(SUPPLIER_PAY_METHODS, method)) throw statusError_(400, 'Pay by cash, bank transfer or cheque');
  if (!(amountC > 0)) throw statusError_(400, 'Enter the amount paid');
  if (method !== 'cash' && !reference) throw statusError_(400, 'A bank transfer or cheque needs its reference');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var all = payablesBook_();
    var supplier = null;
    for (var i = 0; i < all.suppliers.length; i++) if (String(all.suppliers[i].id) === supplierId) { supplier = all.suppliers[i]; break; }
    if (!supplier) throw statusError_(404, 'Supplier not found');
    var acc = supplierAccount_(supplier, all.books[supplierId], all.poById, Date.now());
    var po = null;
    if (poId) {
      po = all.poById[poId];
      if (!po || String(po.supplier_id) !== supplierId) throw statusError_(400, 'That order is not from this supplier');
      var order = acc.orders.filter(function (o) { return o.poId === poId; })[0];
      var orderOwedC = order ? cents_(order.owed) : 0;
      if (amountC > orderOwedC) throw statusError_(409, 'That is more than is owed on ' + String(po.po_number || 'the order') + ' (' + (orderOwedC / 100).toFixed(2) + ')');
    }
    /* the POS does not hold supplier credit: paying ahead of delivery is a
       conversation with the supplier, not a balance here */
    if (amountC > cents_(acc.balance)) throw statusError_(409, 'That is more than ' + String(supplier.name) + ' is owed (' + acc.balance.toFixed(2) + ')');

    var now = new Date().toISOString();
    var txId = Utilities.getUuid();
    var amount = amountC / 100;
    appendRows_('Transactions', TX_HEADERS, [{
      id: txId, store_id: getStore_().id, user_id: String(session.uid || ''), device_id: 'server',
      client_tx_id: 'spay-' + txId.slice(0, 8), kind: 'supplier_payment', original_client_tx: '',
      counterparty: String(supplier.name || ''), grand_total: amount, status: 'COMPLETED',
      tenders_json: JSON.stringify([{ type: method, amount: amount }]), items_json: '[]',
      note: note || ('Payment to ' + String(supplier.name || '') + (po ? ' for ' + String(po.po_number || '') : '')),
      created_at: now, subtotal: '', tax_amount: '', discount_pct: '', customer_id: '',
      receipt_no: '', channel: 'in_store', external_ref: reference, supplier_id: supplierId, po_id: poId,
    }]);
    logAudit_(session, 'supplier.payment', 'supplier', supplierId,
      'Paid ' + String(supplier.name || '') + ' ' + amount.toFixed(2) + ' by ' + SUPPLIER_PAY_METHODS[method]
      + (reference ? ' (' + reference + ')' : '') + (po ? ' for ' + String(po.po_number || '') : ''), payload.deviceId);
    return { transactionId: txId, supplierId: supplierId, amount: amount, method: method, balance: (cents_(acc.balance) - amountC) / 100 };
  } finally {
    lock.releaseLock();
  }
}

function supplierPaymentVoid_(session, payload) {
  requireRole_(session, ['admin']);
  payload = payload || {};
  var id = String(payload.id || '');
  var reason = String(payload.reason || '').trim().slice(0, 200);
  if (!reason) throw statusError_(400, 'Voiding a payment needs a reason');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var rows = readRows_('Transactions', TX_HEADERS);
    var row = null;
    for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === id) { row = rows[i]; break; }
    if (!row || String(row.kind) !== 'supplier_payment') throw statusError_(404, 'Supplier payment not found');
    if (String(row.status) !== 'COMPLETED') throw statusError_(409, 'That payment is already voided');
    applyPatches_('Transactions', TX_HEADERS, 'id', { [id]: { status: 'VOIDED', note: (String(row.note || '') + ' | Voided: ' + reason).slice(0, 500) } });
    logAudit_(session, 'supplier.payment_void', 'supplier', String(row.supplier_id || ''),
      'Voided payment of ' + num_(row.grand_total).toFixed(2) + ' to ' + String(row.counterparty || '') + ': ' + reason, payload.deviceId);
    return { id: id, status: 'VOIDED' };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ *
 *  Repairs
 *
 *  A ticket is an open document, like a purchase order: a status plus two
 *  JSON payloads, resolving into a ledger transaction when it closes.
 *  Parts leave stock the moment they are fitted, so on-hand always
 *  describes what is physically in the building.
 *
 *  Online-only, like purchase orders and customers. A ticket is a numbered
 *  document handed to a customer standing at the counter, and an offline
 *  terminal cannot know the next number without risking a collision.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 *  Warranty (v1.41.0)
 *
 *  A warranty belongs to a sale line: the days were captured when it was sold,
 *  and it runs from the sale. Look one up by the IMEI on the device or the
 *  receipt number on the paper. A unit refunded since has no cover.
 * ------------------------------------------------------------------ */

var DAY_MS = 86400000;

function warrantyMatches_(txRows, q) {
  var query = String(q || '').trim();
  if (!query) return [];
  var lower = query.toLowerCase();
  var sales = [];
  var refundsByOriginal = Object.create(null);
  for (var i = 0; i < txRows.length; i++) {
    var t = txRows[i];
    if (String(t.status) !== 'COMPLETED') continue;
    var kind = String(t.kind || 'sale');
    if (kind === 'refund') {
      var key = String(t.original_client_tx || '');
      (refundsByOriginal[key] = refundsByOriginal[key] || []).push(t);
    } else if (kind === 'sale') {
      sales.push(t);
    }
  }
  var out = [];
  var now = Date.now();
  for (var s = 0; s < sales.length; s++) {
    var sale = sales[s];
    var items = itobjs_(sale.items_json);
    var byReceipt = String(sale.receipt_no || '').toLowerCase() === lower;
    var bySerial = items.some(function (it) { return it.serialNumber && String(it.serialNumber).toLowerCase() === lower; });
    if (!byReceipt && !bySerial) continue;

    /* what has been refunded against this sale: serials, and quantities */
    var refundedSerials = Object.create(null);
    var refundedQty = Object.create(null);
    var rf = refundsByOriginal[String(sale.client_tx_id || '')] || [];
    for (var r = 0; r < rf.length; r++) {
      var ritems = itobjs_(rf[r].items_json);
      for (var ri = 0; ri < ritems.length; ri++) {
        if (ritems[ri].serialNumber) refundedSerials[String(ritems[ri].serialNumber)] = true;
        else refundedQty[String(ritems[ri].productId)] = (refundedQty[String(ritems[ri].productId)] || 0) + (ritems[ri].quantity || 1);
      }
    }
    var soldMs = Date.parse(String(sale.created_at));
    var lines = [];
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      var days = num_(it.warrantyDays);
      if (!(days > 0)) continue;
      if (bySerial && !byReceipt && String(it.serialNumber || '').toLowerCase() !== lower) continue;
      var expiresMs = soldMs + days * DAY_MS;
      var qty = it.quantity || 1;
      var refunded = it.serialNumber
        ? !!refundedSerials[String(it.serialNumber)]
        : (refundedQty[String(it.productId)] || 0) >= qty;
      lines.push({
        productId: String(it.productId || ''),
        name: String(it.name || ''),
        serialNumber: it.serialNumber ? String(it.serialNumber) : null,
        quantity: qty,
        warrantyDays: days,
        soldAt: String(sale.created_at),
        expiresAt: isNaN(expiresMs) ? '' : new Date(expiresMs).toISOString(),
        daysLeft: isNaN(expiresMs) ? 0 : Math.max(0, Math.ceil((expiresMs - now) / DAY_MS)),
        status: refunded ? 'refunded' : (now > expiresMs ? 'expired' : 'active'),
      });
    }
    out.push({
      receiptNo: String(sale.receipt_no || ''),
      clientTxId: String(sale.client_tx_id || ''),
      soldAt: String(sale.created_at),
      customerId: String(sale.customer_id || ''),
      lines: lines,
    });
  }
  out.sort(function (a, b) { return String(b.soldAt).localeCompare(String(a.soldAt)); });
  return out;
}

/* The cover that applies to one serial today: its most recent sale. */
function newestCover_(matches, serial) {
  var lower = String(serial || '').toLowerCase();
  for (var i = 0; i < matches.length; i++) {
    for (var j = 0; j < matches[i].lines.length; j++) {
      var l = matches[i].lines[j];
      if (l.serialNumber && l.serialNumber.toLowerCase() === lower) {
        return { status: l.status, expiresAt: l.expiresAt, receiptNo: matches[i].receiptNo, name: l.name, soldAt: l.soldAt };
      }
    }
  }
  return null;
}

function warrantyLookup_(session, params) {
  if (!session || !session.uid) throw statusError_(401, 'Sign in first');
  var q = String((params && params.q) || '').trim();
  if (q.length < 4) throw statusError_(400, 'Type at least four characters to look up a sale');
  var matches = warrantyMatches_(readRows_('Transactions', TX_HEADERS), q).slice(0, 10);
  var custs = readRows_('Customers', CUSTOMERS_HEADERS);
  var custName = Object.create(null);
  for (var i = 0; i < custs.length; i++) custName[String(custs[i].id)] = String(custs[i].name || '');
  matches.forEach(function (m) { m.customer = m.customerId ? (custName[m.customerId] || '') : ''; delete m.customerId; });
  return { query: q, matches: matches };
}

var REPAIR_ROLES_ANY = ['admin', 'manager', 'cashier'];

function repairs_(session, payload, params) {
  if (payload && Object.keys(payload).length) return repairCreate_(session, payload);
  return repairList_(session, params);
}

function repairCreate_(session, payload) {
  requireRole_(session, REPAIR_ROLES_ANY);

  var make = String(payload.deviceMake || '').trim().slice(0, 60);
  var model = String(payload.deviceModel || '').trim().slice(0, 60);
  var fault = String(payload.reportedFault || '').trim().slice(0, 500);
  if (!make && !model) throw statusError_(400, 'Which device is it? Give at least a make or a model.');
  if (!fault) throw statusError_(400, 'What is wrong with it? The reported fault is required.');

  var name = String(payload.customerName || '').trim().slice(0, 120);
  var phone = String(payload.customerPhone || '').trim().slice(0, 40);
  if (!name && !phone) throw statusError_(400, 'A name or a phone number is needed to give the device back.');

  /* a device we sold: record whether it is still under our warranty */
  var serialIn = String(payload.deviceSerial || '').trim().slice(0, 60);
  var cover = serialIn ? newestCover_(warrantyMatches_(readRows_('Transactions', TX_HEADERS), serialIn), serialIn) : null;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var now = new Date().toISOString();
    var id = Utilities.getUuid();
    var ticketNo = reserveTicketNumber_();
    appendRows_('Repairs', REPAIR_HEADERS, [{
      id: id,
      store_id: getStore_().id,
      ticket_no: ticketNo,
      customer_id: String(payload.customerId || ''),
      customer_name: name,
      customer_phone: phone,
      device_make: make,
      device_model: model,
      device_serial: String(payload.deviceSerial || '').trim().slice(0, 60),
      reported_fault: fault,
      condition_note: String(payload.conditionNote || '').trim().slice(0, 500),
      accessories: String(payload.accessories || '').trim().slice(0, 200),
      status: 'intake',
      parts_json: '[]',
      labour_json: '[]',
      estimate_total: num_(payload.estimateTotal) > 0 ? round2_(num_(payload.estimateTotal)) : 0,
      deposit_total: 0,
      final_total: 0,
      assigned_to: String(payload.assignedTo || ''),
      note: String(payload.note || '').trim().slice(0, 500),
      created_by: String(session.uid || ''),
      created_at: now,
      updated_at: now,
      promised_at: String(payload.promisedAt || '').slice(0, 10),
      closed_at: '',
      invoice_tx_id: '',
      warranty_status: cover ? cover.status : '',
      warranty_until: cover ? cover.expiresAt : '',
      warranty_receipt: cover ? cover.receiptNo : '',
    }]);
    logAudit_(session, 'repair.created', 'repair', id,
      ticketNo + ' - ' + (make + ' ' + model).trim() + ' - ' + fault.slice(0, 80), '');
    return { id: id, ticketNo: ticketNo, status: 'intake', warranty: cover };
  } finally {
    lock.releaseLock();
  }
}

/* The ledger caps at 100 a page (v1.25.0) and so does this: a bench with 400
 * open jobs still only ever ships 100 rows to a phone. */
var REPAIR_PAGE_MAX = 100;

function repairTotals_(row) {
  var parts = itobjs_(row.parts_json);
  var labour = itobjs_(row.labour_json);
  var p = 0, l = 0, i;
  for (i = 0; i < parts.length; i++) p += num_(parts[i].unitPrice) * num_(parts[i].quantity);
  for (i = 0; i < labour.length; i++) l += num_(labour[i].amount);
  return { parts: round2_(p), labour: round2_(l), total: round2_(p + l) };
}

function repairRow_(row) {
  var t = repairTotals_(row);
  return {
    id: String(row.id),
    ticketNo: String(row.ticket_no || ''),
    customerId: String(row.customer_id || ''),
    customerName: String(row.customer_name || ''),
    customerPhone: String(row.customer_phone || ''),
    device: (String(row.device_make || '') + ' ' + String(row.device_model || '')).trim(),
    deviceSerial: String(row.device_serial || ''),
    reportedFault: String(row.reported_fault || ''),
    status: String(row.status || 'intake'),
    partsTotal: t.parts,
    labourTotal: t.labour,
    total: t.total,
    estimateTotal: num_(row.estimate_total),
    depositTotal: num_(row.deposit_total),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    promisedAt: String(row.promised_at || ''),
    warrantyStatus: String(row.warranty_status || ''),
    warrantyUntil: String(row.warranty_until || ''),
    warrantyReceipt: String(row.warranty_receipt || ''),
    needsCount: itobjs_(row.needs_json).length,
  };
}

/* Everything somebody might have written on the counter: the ticket number on
 * the slip, the customer's name or number, the IMEI on the back of the box. */
function repairMatchesQuery_(row, q) {
  if (!q) return true;
  var hay = [row.ticket_no, row.customer_name, row.customer_phone, row.device_make,
    row.device_model, row.device_serial, row.reported_fault, row.note]
    .join(' ').toLowerCase();
  return hay.indexOf(q) >= 0;
}

function repairList_(session, params) {
  requireRole_(session, REPAIR_ROLES_ANY);
  var p = params || {};
  var q = String(p.q || '').trim().toLowerCase();
  var wantStatus = String(p.status || '').trim();
  var cursor = String(p.cursor || '');
  var limit = Math.min(REPAIR_PAGE_MAX, Math.max(1, num_(p.limit) || REPAIR_PAGE_MAX));

  var rows = readRows_('Repairs', REPAIR_HEADERS);
  rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });

  var out = [];
  var matched = 0;
  var more = false;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    /* A voided ticket is one that should not exist. It stays on the sheet for
       the audit trail, but it is not part of the day's work. */
    if (!wantStatus && String(r.status) === 'voided') continue;
    if (wantStatus && String(r.status) !== wantStatus) continue;
    if (!repairMatchesQuery_(r, q)) continue;
    matched++;
    if (cursor && String(r.created_at).localeCompare(cursor) >= 0) continue;
    if (out.length >= limit) { more = true; continue; }
    out.push(repairRow_(r));
  }

  return {
    repairs: out,
    matched: matched,
    nextCursor: more && out.length ? out[out.length - 1].createdAt : '',
    query: q,
    status: wantStatus,
  };
}

function repairFind_(id) {
  var rows = readRows_('Repairs', REPAIR_HEADERS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === String(id)) return rows[i];
  }
  return null;
}

function repairDetail_(session, params) {
  requireRole_(session, REPAIR_ROLES_ANY);
  var row = repairFind_(String((params || {}).id || ''));
  if (!row) throw statusError_(404, 'Repair not found');
  var dto = repairRow_(row);
  dto.conditionNote = String(row.condition_note || '');
  dto.accessories = String(row.accessories || '');
  dto.note = String(row.note || '');
  dto.assignedTo = String(row.assigned_to || '');
  dto.closedAt = String(row.closed_at || '');
  dto.invoiceTxId = String(row.invoice_tx_id || '');
  dto.depositTotal = num_(row.deposit_total);
  dto.finalTotal = num_(row.final_total);
  dto.parts = itobjs_(row.parts_json);
  dto.labour = itobjs_(row.labour_json);

  var prodRows = readRows_('Products', PRODUCT_HEADERS);
  var prodById = {};
  for (var p = 0; p < prodRows.length; p++) prodById[String(prodRows[p].id)] = prodRows[p];
  dto.needs = repairNeedsWithStock_(row, prodById, poOutstanding_(), serialsAvailable_());
  var inv = repairInvoice_(row, prodById, getStore_());
  dto.invoiceSubtotal = inv.totals.subtotal;
  dto.invoiceTax = inv.totals.tax;
  dto.invoiceTotal = inv.totals.total;
  dto.balanceDue = inv.balanceC / 100;
  dto.overpaid = inv.overpaidC / 100;
  return dto;
}

/* ------------------------------------------------------------------ *
 *  Parts a job is waiting for (v1.50.0)
 *
 *  A bench job often needs a part the shop does not have. Until now the only
 *  record of that was the ticket's *Awaiting parts* status: what it was
 *  waiting for lived in the technician's head, Purchases could not see it,
 *  and when the box arrived nobody knew which job it freed.
 *
 *  A need is a line on the ticket (`needs_json`): a product, how many, and
 *  why. It moves no stock - it is a statement of intent, not a reservation:
 *  the unit that arrives can still be sold at the counter, and the board
 *  shows what is on hand against what the bench is waiting for so that
 *  contention is visible. When the part is fitted (`/api/repairs/parts` with
 *  `needIndex`) the need goes with it.
 *
 *  Raising a purchase order with `linkNeeds` stamps every open need for a
 *  product on that order with the order, so the ticket can say *on order,
 *  PO-0003, expected Friday*; cancelling the order takes the stamp off.
 *  Receiving reports which tickets the delivery unblocks.
 * ------------------------------------------------------------------ */

/* What is still to arrive on the orders that are out, by product. */
function poOutstanding_() {
  var pos = readRows_('PurchaseOrders', PO_HEADERS);
  var out = Object.create(null);
  for (var i = 0; i < pos.length; i++) {
    var status = String(pos[i].status || '');
    if (status !== 'ORDERED' && status !== 'PARTIAL') continue;
    var items = itobjs_(pos[i].items_json);
    var had = receivedByProduct_(pos[i].received_json);
    for (var j = 0; j < items.length; j++) {
      var pid = String(items[j].productId || '');
      var ordered = num_(items[j].quantity || 1);
      var got = Math.min(num_(had[pid] ? had[pid].quantity : 0), ordered);
      if (ordered - got <= 0) continue;
      var entry = out[pid] || (out[pid] = { quantity: 0, orders: [] });
      entry.quantity += ordered - got;
      entry.orders.push({ poId: String(pos[i].id), poNumber: String(pos[i].po_number || ''),
        quantity: ordered - got, expectedDate: String(pos[i].expected_date || ''), status: status });
    }
  }
  return out;
}

/* Serialized stock is counted by its units in stock, not by on_hand. */
function serialsAvailable_() {
  var rows = readRows_('Serials', SERIAL_HEADERS);
  var out = Object.create(null);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].status) !== 'IN_STOCK') continue;
    var pid = String(rows[i].product_id);
    out[pid] = (out[pid] || 0) + 1;
  }
  return out;
}

function stockOnHand_(prod, serialCount) {
  if (!prod) return 0;
  return String(prod.is_serialized) === '1'
    ? num_(serialCount[String(prod.id)] || 0)
    : num_(prod.on_hand);
}

/* One ticket's needs, each with where the part stands right now. */
function repairNeedsWithStock_(row, prodById, onOrder, serialCount) {
  var needs = itobjs_(row.needs_json);
  var out = [];
  for (var i = 0; i < needs.length; i++) {
    var need = needs[i] || {};
    var pid = String(need.productId || '');
    var prod = prodById[pid];
    var have = stockOnHand_(prod, serialCount);
    var order = onOrder[pid] || { quantity: 0, orders: [] };
    var stamped = null;
    for (var o = 0; o < order.orders.length; o++) {
      if (String(order.orders[o].poId) === String(need.poId || '')) { stamped = order.orders[o]; break; }
    }
    out.push({
      index: i,
      productId: pid,
      name: String(need.name || (prod ? prod.name : '')),
      sku: String(need.sku || (prod ? prod.sku : '')),
      quantity: num_(need.quantity || 1),
      note: String(need.note || ''),
      addedAt: String(need.addedAt || ''),
      addedBy: auditName_(String(need.addedBy || '')),
      onHand: have,
      onOrder: num_(order.quantity),
      canFit: have >= num_(need.quantity || 1),
      poId: String(need.poId || ''),
      poNumber: stamped ? stamped.poNumber : '',
      expectedDate: stamped ? stamped.expectedDate : '',
      orderedAt: String(need.orderedAt || ''),
    });
  }
  return out;
}

/* The bench's whole list, grouped by part: what is wanted, what is here, what
 * is on its way, and how short the shop is. */
function repairNeedsBoard_(session) {
  requireRole_(session, REPAIR_ROLES_ANY);
  var store = getStore_();
  var rows = readRows_('Repairs', REPAIR_HEADERS);
  var prodRows = readRows_('Products', PRODUCT_HEADERS);
  var prodById = {};
  for (var p = 0; p < prodRows.length; p++) prodById[String(prodRows[p].id)] = prodRows[p];
  var onOrder = poOutstanding_();
  var serialCount = serialsAvailable_();

  var byProduct = Object.create(null);
  var order = [];
  var ticketCount = 0;
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (String(row.store_id) !== store.id) continue;
    if (REPAIR_TERMINAL[String(row.status)]) continue;
    var needs = itobjs_(row.needs_json);
    if (!needs.length) continue;
    ticketCount += 1;
    for (var n = 0; n < needs.length; n++) {
      var need = needs[n] || {};
      var pid = String(need.productId || '');
      var prod = prodById[pid];
      var group = byProduct[pid];
      if (!group) {
        var supply = onOrder[pid] || { quantity: 0, orders: [] };
        group = byProduct[pid] = {
          productId: pid,
          name: String(need.name || (prod ? prod.name : '')),
          sku: String(need.sku || (prod ? prod.sku : '')),
          cost: prod ? num_(prod.cost_price) : 0,
          needed: 0,
          onHand: stockOnHand_(prod, serialCount),
          onOrder: num_(supply.quantity),
          orders: supply.orders,
          tickets: [],
        };
        order.push(pid);
      }
      group.needed += num_(need.quantity || 1);
      group.tickets.push({
        repairId: String(row.id), ticketNo: String(row.ticket_no || ''),
        customerName: String(row.customer_name || ''), status: String(row.status || ''),
        quantity: num_(need.quantity || 1), note: String(need.note || ''),
        since: String(need.addedAt || row.created_at || ''),
        promisedAt: String(row.promised_at || ''),
      });
    }
  }

  var parts = [];
  var shortfallCount = 0;
  for (var k = 0; k < order.length; k++) {
    var g = byProduct[order[k]];
    g.shortfall = Math.max(0, g.needed - g.onHand - g.onOrder);
    g.ready = g.onHand >= g.needed;
    if (g.shortfall > 0) shortfallCount += 1;
    g.tickets.sort(function (a, b) { return String(a.since).localeCompare(String(b.since)); });
    parts.push(g);
  }
  /* what nobody has ordered yet first, then what is oldest */
  parts.sort(function (a, b) {
    return (b.shortfall > 0) - (a.shortfall > 0)
      || String(a.tickets[0].since).localeCompare(String(b.tickets[0].since));
  });
  return { parts: parts, ticketCount: ticketCount, partCount: parts.length, shortfallCount: shortfallCount };
}

/* Record what a job is waiting for, or drop a line. */
function repairNeeds_(session, payload, params) {
  if (!payload || !Object.keys(payload).length) return repairNeedsBoard_(session, params);
  requireRole_(session, REPAIR_ROLES_ANY);
  var id = String(payload.id || '');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var row = repairFind_(id);
    if (!row) throw statusError_(404, 'Repair not found');
    if (REPAIR_TERMINAL[String(row.status)]) throw statusError_(409, 'This ticket is closed');

    var needs = itobjs_(row.needs_json);
    var stamp = new Date().toISOString();
    var patch = { updated_at: stamp };
    var summary = '';

    if (payload.removeIndex !== undefined && payload.removeIndex !== null) {
      var idx = Math.floor(num_(payload.removeIndex));
      if (!(idx >= 0 && idx < needs.length)) throw statusError_(400, 'No such line on this ticket');
      summary = 'No longer waiting for ' + String(needs[idx].name || '') + ' on ' + String(row.ticket_no || '');
      needs.splice(idx, 1);
    } else {
      var add = Array.isArray(payload.add) ? payload.add : [];
      if (!add.length) throw statusError_(400, 'Nothing to wait for');
      var prodRows = readRows_('Products', PRODUCT_HEADERS);
      var prodById = {};
      for (var p = 0; p < prodRows.length; p++) prodById[String(prodRows[p].id)] = prodRows[p];
      var named = [];
      for (var a = 0; a < add.length; a++) {
        var ln = add[a] || {};
        var prod = prodById[String(ln.productId || '')];
        if (!prod || String(prod.active) !== '1') throw statusError_(400, 'Product is unknown or inactive');
        if (String(prod.item_type) === 'service') throw statusError_(400, 'A service is not a part to wait for');
        var qty = Math.max(1, Math.floor(num_(ln.quantity) || 1));
        for (var d = 0; d < needs.length; d++) {
          if (String(needs[d].productId) === String(prod.id)) throw statusError_(409, String(prod.name) + ' is already on this ticket\'s list');
        }
        needs.push({
          productId: String(prod.id), name: String(prod.name || ''), sku: String(prod.sku || ''),
          quantity: qty, note: String(ln.note || '').slice(0, 140),
          addedAt: stamp, addedBy: String(session.uid || ''), poId: '', orderedAt: '',
        });
        named.push(String(prod.name || '') + ' x' + qty);
      }
      summary = 'Waiting for ' + named.join(', ') + ' on ' + String(row.ticket_no || '');
      /* a job that is waiting for a part is awaiting parts: say so on the board
         rather than leaving the status to be remembered separately */
      var was = String(row.status || '');
      if (was === 'intake' || was === 'diagnosed') {
        patch.status = 'awaiting_parts';
        summary += ' (' + was + ' → awaiting_parts)';
      }
    }

    patch.needs_json = JSON.stringify(needs);
    applyPatches_('Repairs', REPAIR_HEADERS, 'id', { [id]: patch });
    logAudit_(session, 'repair.need', 'repair', id, summary, payload.deviceId);

    row.needs_json = patch.needs_json;
    if (patch.status) row.status = patch.status;
    var prodRows2 = readRows_('Products', PRODUCT_HEADERS);
    var prodById2 = {};
    for (var q = 0; q < prodRows2.length; q++) prodById2[String(prodRows2[q].id)] = prodRows2[q];
    return { id: id, status: String(row.status || ''), needs: repairNeedsWithStock_(row, prodById2, poOutstanding_(), serialsAvailable_()) };
  } finally {
    lock.releaseLock();
  }
}

/* Every open need for these products, oldest first: who is waiting. */
function needsForProducts_(productIds, repairRows) {
  var want = Object.create(null);
  for (var i = 0; i < productIds.length; i++) want[String(productIds[i])] = true;
  var out = [];
  for (var r = 0; r < repairRows.length; r++) {
    var row = repairRows[r];
    if (REPAIR_TERMINAL[String(row.status)]) continue;
    var needs = itobjs_(row.needs_json);
    for (var n = 0; n < needs.length; n++) {
      if (!want[String(needs[n].productId || '')]) continue;
      out.push({ row: row, index: n, need: needs[n] });
    }
  }
  out.sort(function (a, b) { return String(a.need.addedAt || '').localeCompare(String(b.need.addedAt || '')); });
  return out;
}

/* Fit a part, or take one back off.
 *
 * Both move real stock, under the lock, against the same rows the register
 * uses - so a screen cannot be both sold at the counter and fitted at the
 * bench. This is the whole reason the feature exists: on-hand has to keep
 * describing what is physically in the building. */
function repairParts_(session, payload) {
  requireRole_(session, REPAIR_ROLES_ANY);
  var id = String((payload || {}).id || '');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var row = repairFind_(id);
    if (!row) throw statusError_(404, 'Repair not found');
    if (REPAIR_TERMINAL[String(row.status)]) throw statusError_(409, 'This ticket is closed');

    var parts = itobjs_(row.parts_json);
    var needs = itobjs_(row.needs_json);
    var prodRows = readRows_('Products', PRODUCT_HEADERS);
    var prodById = {};
    for (var p = 0; p < prodRows.length; p++) prodById[String(prodRows[p].id)] = prodRows[p];
    var serialRows = readRows_('Serials', SERIAL_HEADERS);
    var stamp = new Date().toISOString();
    var needsChanged = false;
    var productPatches = {};
    var serialPatches = {};
    var summary = '';

    if (payload.removeIndex !== undefined && payload.removeIndex !== null) {
      var idx = Math.floor(num_(payload.removeIndex));
      if (!(idx >= 0 && idx < parts.length)) throw statusError_(400, 'No such line on this ticket');
      var gone = parts[idx];
      var back = prodById[String(gone.productId)];
      if (back && String(back.item_type) !== 'service') {
        if (gone.serialNumber) {
          for (var s = 0; s < serialRows.length; s++) {
            if (String(serialRows[s].serial_number) === String(gone.serialNumber)
              && String(serialRows[s].product_id) === String(gone.productId)) {
              serialPatches[String(serialRows[s].id)] = { status: 'IN_STOCK', tx_id: '', updated_at: stamp };
              break;
            }
          }
        }
        productPatches[String(back.id)] = { on_hand: num_(back.on_hand) + num_(gone.quantity), updated_at: stamp };
      }
      summary = 'Removed ' + String(gone.name || '') + ' from ' + String(row.ticket_no || '');
      parts.splice(idx, 1);
    } else {
      var add = Array.isArray(payload.add) ? payload.add : [];
      if (!add.length) throw statusError_(400, 'Nothing to fit');
      var added = [];
      for (var a = 0; a < add.length; a++) {
        var ln = add[a];
        var prod = prodById[String(ln.productId || '')];
        if (!prod || String(prod.active) !== '1') throw statusError_(400, 'Product is unknown or inactive');
        var qty = Math.max(1, Math.floor(num_(ln.quantity) || 1));
        var price = Math.max(0, num_(ln.unitPrice));
        var serial = String(ln.serialNumber || '').trim();
        var partCost = num_(prod.cost_price);
        var isService = String(prod.item_type) === 'service';

        if (String(prod.is_serialized) === '1') {
          if (!serial) throw statusError_(400, 'This part is tracked by serial - which one?');
          var found = null;
          for (var s2 = 0; s2 < serialRows.length; s2++) {
            if (String(serialRows[s2].serial_number) === serial
              && String(serialRows[s2].product_id) === String(prod.id)) { found = serialRows[s2]; break; }
          }
          if (!found) throw statusError_(404, 'Serial not found: ' + serial);
          if (String(found.status) !== 'IN_STOCK') throw statusError_(409, 'Already gone: ' + serial);
          if (num_(found.cost) > 0) partCost = num_(found.cost);
          serialPatches[String(found.id)] = { status: 'SOLD', tx_id: 'repair:' + id, updated_at: stamp };
          found.status = 'SOLD';
          productPatches[String(prod.id)] = { on_hand: Math.max(0, num_(prod.on_hand) - qty), updated_at: stamp };
          prod.on_hand = Math.max(0, num_(prod.on_hand) - qty);
        } else if (!isService) {
          var have = num_(prod.on_hand);
          if (qty > have) throw statusError_(409, 'Only ' + have + ' of ' + String(prod.name) + ' left');
          productPatches[String(prod.id)] = { on_hand: have - qty, updated_at: stamp };
          prod.on_hand = have - qty;
        }

        var line = {
          productId: String(prod.id), name: String(prod.name || ''), sku: String(prod.sku || ''),
          quantity: qty, unitPrice: round2_(price), unitCost: partCost,
          serialNumber: serial, fittedAt: stamp, fittedBy: String(session.uid || ''),
        };
        parts.push(line);
        added.push(line.name + (serial ? ' (' + serial + ')' : '') + ' x' + qty);
      }
      summary = 'Fitted ' + added.join(', ') + ' to ' + String(row.ticket_no || '');
      /* fitting the part the job was waiting for answers the need */
      if (payload.needIndex !== undefined && payload.needIndex !== null) {
        var ni = Math.floor(num_(payload.needIndex));
        if (!(ni >= 0 && ni < needs.length)) throw statusError_(400, 'No such line on this ticket');
        summary += ' (it was waiting for ' + String(needs[ni].name || '') + ')';
        needs.splice(ni, 1);
        needsChanged = true;
      }
    }

    var repairPatch = { parts_json: JSON.stringify(parts), updated_at: stamp };
    if (needsChanged) {
      repairPatch.needs_json = JSON.stringify(needs);
      /* nothing left to wait for: the job is on the bench again, not waiting */
      if (!needs.length && String(row.status) === 'awaiting_parts') {
        repairPatch.status = 'in_progress';
        summary += ' (awaiting_parts → in_progress)';
      }
    }
    applyPatches_('Repairs', REPAIR_HEADERS, 'id', { [id]: repairPatch });
    if (Object.keys(productPatches).length) applyPatches_('Products', PRODUCT_HEADERS, 'id', productPatches);
    if (Object.keys(serialPatches).length) applyPatches_('Serials', SERIAL_HEADERS, 'id', serialPatches);

    logAudit_(session, 'repair.part', 'repair', id, summary, '');

    row.parts_json = JSON.stringify(parts);
    if (needsChanged) row.needs_json = JSON.stringify(needs);
    if (repairPatch.status) row.status = repairPatch.status;
    var t = repairTotals_(row);
    return { id: id, parts: parts, needs: repairNeedsWithStock_(row, prodById, poOutstanding_(), serialsAvailable_()),
      partsTotal: t.parts, labourTotal: t.labour, total: t.total };
  } finally {
    lock.releaseLock();
  }
}

/* Labour on a ticket. Either a service product the shop already prices, or
 * one-off work typed at the bench. Both carry into the invoice as ordinary
 * sale lines when the job is collected. */
function repairLabour_(session, payload) {
  requireRole_(session, REPAIR_ROLES_ANY);
  var id = String((payload || {}).id || '');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var row = repairFind_(id);
    if (!row) throw statusError_(404, 'Repair not found');
    if (REPAIR_TERMINAL[String(row.status)]) throw statusError_(409, 'This ticket is closed');

    var labour = itobjs_(row.labour_json);
    var stamp = new Date().toISOString();
    var summary;

    if (payload.removeIndex !== undefined && payload.removeIndex !== null) {
      var idx = Math.floor(num_(payload.removeIndex));
      if (!(idx >= 0 && idx < labour.length)) throw statusError_(400, 'No such labour line');
      summary = 'Removed labour "' + String(labour[idx].description || '') + '" from ' + String(row.ticket_no || '');
      labour.splice(idx, 1);
    } else {
      var add = payload.add || {};
      var desc = String(add.description || '').trim().slice(0, 200);
      var amount = num_(add.amount);
      if (!desc) throw statusError_(400, 'What was the work? A description is required.');
      if (!(amount >= 0)) throw statusError_(400, 'Labour cannot be a negative amount');
      labour.push({
        description: desc,
        amount: round2_(amount),
        productId: String(add.productId || ''),
        addedAt: stamp,
        addedBy: String(session.uid || ''),
      });
      summary = 'Labour "' + desc + '" on ' + String(row.ticket_no || '');
    }

    applyPatches_('Repairs', REPAIR_HEADERS, 'id', {
      [id]: { labour_json: JSON.stringify(labour), updated_at: stamp },
    });
    logAudit_(session, 'repair.labour', 'repair', id, summary, '');

    row.labour_json = JSON.stringify(labour);
    var t = repairTotals_(row);
    return { id: id, labour: labour, partsTotal: t.parts, labourTotal: t.labour, total: t.total };
  } finally {
    lock.releaseLock();
  }
}

/* Give every fitted part back. Caller holds the lock and applies the patches,
 * so a cancel and a void can each batch their writes into one pass. */
function repairReturnParts_(row, stamp) {
  var parts = itobjs_(row.parts_json);
  var productPatches = {};
  var serialPatches = {};
  var returned = 0;
  if (!parts.length) return { productPatches: productPatches, serialPatches: serialPatches, returned: 0 };

  var prodRows = readRows_('Products', PRODUCT_HEADERS);
  var prodById = {};
  for (var p = 0; p < prodRows.length; p++) prodById[String(prodRows[p].id)] = prodRows[p];
  var serialRows = readRows_('Serials', SERIAL_HEADERS);

  for (var i = 0; i < parts.length; i++) {
    var ln = parts[i];
    var prod = prodById[String(ln.productId)];
    if (!prod || String(prod.item_type) === 'service') continue;
    var qty = num_(ln.quantity);
    if (ln.serialNumber) {
      for (var s = 0; s < serialRows.length; s++) {
        if (String(serialRows[s].serial_number) === String(ln.serialNumber)
          && String(serialRows[s].product_id) === String(ln.productId)
          && String(serialRows[s].status) === 'SOLD') {
          serialPatches[String(serialRows[s].id)] = { status: 'IN_STOCK', tx_id: '', updated_at: stamp };
          break;
        }
      }
    }
    var base = productPatches[String(prod.id)] ? num_(productPatches[String(prod.id)].on_hand) : num_(prod.on_hand);
    productPatches[String(prod.id)] = { on_hand: base + qty, updated_at: stamp };
    returned += qty;
  }
  return { productPatches: productPatches, serialPatches: serialPatches, returned: returned };
}

function repairStatus_(session, payload) {
  requireRole_(session, REPAIR_ROLES_ANY);
  var id = String((payload || {}).id || '');
  var want = String((payload || {}).status || '');
  if (REPAIR_STATUSES.indexOf(want) < 0) throw statusError_(400, 'Unknown status: ' + want);
  if (want === 'voided') throw statusError_(400, 'Voiding is its own action');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var row = repairFind_(id);
    if (!row) throw statusError_(404, 'Repair not found');
    var from = String(row.status || 'intake');
    if (REPAIR_TERMINAL[from]) throw statusError_(409, 'This ticket is closed and cannot change');
    if (want === from) throw statusError_(409, 'Already ' + want);

    /* Collection is v1.32.0's job: a repair is collected by invoicing it, which
       needs a transaction against the ticket, not a status picked from a menu. */
    if (want === 'collected' && !String(row.invoice_tx_id || '')) {
      throw statusError_(409, 'A repair is collected by invoicing it, not by setting the status');
    }

    var stamp = new Date().toISOString();
    var patch = { status: want, updated_at: stamp };
    if (payload.note !== undefined) patch.note = String(payload.note || '').trim().slice(0, 500);
    var returned = 0;

    if (want === 'cancelled' || want === 'unrepairable') {
      var back = repairReturnParts_(row, stamp);
      returned = back.returned;
      if (Object.keys(back.productPatches).length) applyPatches_('Products', PRODUCT_HEADERS, 'id', back.productPatches);
      if (Object.keys(back.serialPatches).length) applyPatches_('Serials', SERIAL_HEADERS, 'id', back.serialPatches);
      patch.parts_json = '[]';
      patch.closed_at = stamp;
    }

    applyPatches_('Repairs', REPAIR_HEADERS, 'id', { [id]: patch });
    logAudit_(session, 'repair.status', 'repair', id,
      String(row.ticket_no || '') + ': ' + from + ' -> ' + want
      + (returned ? ' (' + returned + ' part(s) returned to stock)' : ''), '');

    return { id: id, status: want, from: from, returned: returned };
  } finally {
    lock.releaseLock();
  }
}

/* A ticket entered in error. Not a cancel - a cancel is a real event with a
 * real customer who changed their mind; this is "that row should not exist".
 * Admin only, and the parts come back either way. */
function repairVoid_(session, payload) {
  requireRole_(session, ['admin']);
  var id = String((payload || {}).id || '');
  var reason = String((payload || {}).reason || '').trim().slice(0, 200);
  if (!reason) throw statusError_(400, 'Voiding a ticket needs a reason');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var row = repairFind_(id);
    if (!row) throw statusError_(404, 'Repair not found');
    if (String(row.status) === 'voided') throw statusError_(409, 'Already voided');
    if (String(row.invoice_tx_id || '')) throw statusError_(409, 'This ticket has been invoiced - refund it instead');
    if (cents_(row.deposit_total) > 0) throw statusError_(409, 'A deposit is held on this ticket - give it back before voiding');

    var stamp = new Date().toISOString();
    var back = repairReturnParts_(row, stamp);
    if (Object.keys(back.productPatches).length) applyPatches_('Products', PRODUCT_HEADERS, 'id', back.productPatches);
    if (Object.keys(back.serialPatches).length) applyPatches_('Serials', SERIAL_HEADERS, 'id', back.serialPatches);

    applyPatches_('Repairs', REPAIR_HEADERS, 'id', {
      [id]: {
        status: 'voided', parts_json: '[]', closed_at: stamp, updated_at: stamp,
        note: (String(row.note || '') + ' | Voided: ' + reason).slice(0, 500),
      },
    });
    logAudit_(session, 'repair.voided', 'repair', id,
      String(row.ticket_no || '') + ' voided: ' + reason
      + (back.returned ? ' (' + back.returned + ' part(s) returned)' : ''), '');
    return { id: id, voided: true, returned: back.returned };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ *
 *  Repair money (v1.32.0)
 *
 *  A deposit is cash in the drawer that is NOT earned revenue. So:
 *    - taking one writes a 'deposit' row: drawer cash, never sales;
 *    - collecting the job writes a real 'sale' for the full value and
 *      settles part of it with a 'deposit' tender, which is money but not
 *      drawer cash at that moment - it arrived earlier;
 *    - giving one back writes a 'deposit_refund' row: drawer cash out.
 *  Cash touches the drawer exactly once.
 *
 *  None of this goes through /api/sync/push. The sale path there takes
 *  stock off the shelf, and a repair's parts already left when they were
 *  fitted - routing collection through it would remove them twice.
 * ------------------------------------------------------------------ */

var DEPOSIT_TENDER_TYPES = { cash: 1, card: 1, transfer: 1 };

function tenderCents_(tenders) {
  var c = 0;
  for (var i = 0; i < tenders.length; i++) c += cents_(tenders[i].amount);
  return c;
}

function cleanTenders_(raw, fallbackAmount) {
  var list = Array.isArray(raw) ? raw : [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var t = list[i] || {};
    var amt = round2_(num_(t.amount));
    if (!(amt > 0)) continue;
    out.push({ type: String(t.type || 'cash'), amount: amt });
  }
  if (!out.length && fallbackAmount > 0) out.push({ type: 'cash', amount: round2_(fallbackAmount) });
  return out;
}

function repairDeposit_(session, payload) {
  requireRole_(session, REPAIR_ROLES_ANY);
  var id = String((payload || {}).id || '');
  var amount = round2_(num_((payload || {}).amount));
  if (!(amount > 0)) throw statusError_(400, 'A deposit has to be more than nothing');

  var tenders = cleanTenders_(payload.tenders, amount);
  for (var i = 0; i < tenders.length; i++) {
    if (!DEPOSIT_TENDER_TYPES[tenders[i].type]) {
      throw statusError_(400, 'A deposit is taken in cash, by card or by transfer');
    }
  }
  if (tenderCents_(tenders) !== cents_(amount)) throw statusError_(400, 'The payment does not add up to the deposit');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var row = repairFind_(id);
    if (!row) throw statusError_(404, 'Repair not found');
    if (REPAIR_TERMINAL[String(row.status)]) throw statusError_(409, 'This ticket is closed');

    var store = getStore_();
    var now = new Date().toISOString();
    var txId = Utilities.getUuid();
    appendRows_('Transactions', TX_HEADERS, [{
      id: txId, store_id: store.id, user_id: String(session.uid || ''), device_id: 'server',
      client_tx_id: 'rdep-' + txId.slice(0, 8), kind: 'deposit', original_client_tx: '',
      counterparty: String(row.ticket_no || ''), grand_total: amount, status: 'COMPLETED',
      tenders_json: JSON.stringify(tenders), items_json: '[]',
      note: 'Deposit on ' + String(row.ticket_no || ''), created_at: now,
      subtotal: '', tax_amount: '', discount_pct: '', customer_id: String(row.customer_id || ''),
      receipt_no: '', channel: 'in_store', external_ref: String(row.ticket_no || ''),
    }]);
    var held = round2_(num_(row.deposit_total) + amount);
    applyPatches_('Repairs', REPAIR_HEADERS, 'id', { [id]: { deposit_total: held, updated_at: now } });
    logAudit_(session, 'repair.deposit', 'repair', id,
      'Deposit ' + amount.toFixed(2) + ' on ' + String(row.ticket_no || '') + ' (held ' + held.toFixed(2) + ')', '');
    return { id: id, transactionId: txId, amount: amount, depositTotal: held };
  } finally {
    lock.releaseLock();
  }
}

/* Build the invoice lines from what is on the ticket. Parts carry the cost
 * captured when they were fitted, so gross profit is the profit on the job. */
function repairInvoiceItems_(row, prodById) {
  var items = [];
  var parts = itobjs_(row.parts_json);
  var labour = itobjs_(row.labour_json);
  var i;
  for (i = 0; i < parts.length; i++) {
    var p = parts[i];
    var prod = prodById[String(p.productId)];
    var it = {
      productId: String(p.productId), name: String(p.name || (prod ? prod.name : 'Part')),
      quantity: Math.max(1, num_(p.quantity) || 1), unitPrice: round2_(num_(p.unitPrice)),
      serialNumber: p.serialNumber ? String(p.serialNumber) : null,
    };
    if (prod && String(prod.taxable) === '0') it.taxable = false;
    var uc = round2_(num_(p.unitCost));
    if (uc > 0) it.unitCost = uc;
    items.push(it);
  }
  for (i = 0; i < labour.length; i++) {
    var l = labour[i];
    var lp = prodById[String(l.productId || '')];
    var li = {
      productId: lp ? String(lp.id) : 'repair-labour',
      name: String(l.description || 'Repair labour'),
      quantity: 1, unitPrice: round2_(num_(l.amount)), serialNumber: null,
      category: 'Repairs',
    };
    if (lp && String(lp.taxable) === '0') li.taxable = false;
    items.push(li);
  }
  return items;
}

/* Price a ticket exactly as collection will charge it. The detail screen and
 * repairCollect_ both call this, so the balance a cashier is shown and the
 * balance the server demands cannot drift apart - tax included. */
function repairInvoice_(row, prodById, store) {
  var items = repairInvoiceItems_(row, prodById);
  var totals = saleTotals_(items.map(function (it) {
    return { unitPrice: it.unitPrice, quantity: it.quantity, discountPct: 0, taxable: it.taxable !== false };
  }), 0, num_(store.taxRate), store.pricesIncludeTax);
  var heldC = cents_(row.deposit_total);
  return {
    items: items,
    totals: totals,
    heldC: heldC,
    balanceC: Math.max(0, totals.grandC - heldC),
    overpaidC: Math.max(0, heldC - totals.grandC),
  };
}

function repairCollect_(session, payload) {
  requireRole_(session, REPAIR_ROLES_ANY);
  var id = String((payload || {}).id || '');
  var raw = Array.isArray((payload || {}).tenders) ? payload.tenders : [];
  if (hasDepositTender_(raw)) throw statusError_(400, 'The deposit is applied automatically');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var row = repairFind_(id);
    if (!row) throw statusError_(404, 'Repair not found');
    if (REPAIR_TERMINAL[String(row.status)]) throw statusError_(409, 'This ticket is closed');

    var prodRows = readRows_('Products', PRODUCT_HEADERS);
    var prodById = {};
    for (var p = 0; p < prodRows.length; p++) prodById[String(prodRows[p].id)] = prodRows[p];

    var store = getStore_();
    var inv = repairInvoice_(row, prodById, store);
    var items = inv.items;
    if (!items.length) throw statusError_(409, 'There is nothing on this ticket to charge for');
    var totals = inv.totals;
    var heldC = inv.heldC;

    /* A deposit bigger than the job would leave the ledger holding money that
       no longer secures anything. Give the difference back first. */
    if (inv.overpaidC > 0) {
      throw statusError_(409, 'The deposit is more than the job. Refund the difference before collecting.');
    }
    var balanceC = inv.balanceC;
    var tenders = cleanTenders_(raw, 0);
    if (tenderCents_(tenders) !== balanceC) {
      throw statusError_(400, 'Payment must cover the balance of ' + (balanceC / 100).toFixed(2));
    }
    if (heldC > 0) tenders.push({ type: 'deposit', amount: heldC / 100 });

    var now = new Date().toISOString();
    var txId = Utilities.getUuid();
    var receiptNo = reserveReceiptNumbers_(1)[0];
    appendRows_('Transactions', TX_HEADERS, [{
      id: txId, store_id: store.id, user_id: String(session.uid || ''), device_id: 'server',
      client_tx_id: 'rcol-' + txId.slice(0, 8), kind: 'sale', original_client_tx: '',
      counterparty: '', grand_total: totals.total, status: 'COMPLETED',
      tenders_json: JSON.stringify(tenders), items_json: JSON.stringify(items),
      note: 'Repair ' + String(row.ticket_no || '') + ' collected', created_at: now,
      subtotal: totals.subtotal, tax_amount: totals.tax, discount_pct: 0,
      tax_inclusive: totals.inclusive ? 1 : '', tax_rate: num_(store.taxRate),
      customer_id: String(row.customer_id || ''), receipt_no: receiptNo,
      channel: 'in_store', external_ref: String(row.ticket_no || ''),
    }]);

    /* The serials were marked SOLD against the ticket when fitted. Point them at
       the invoice so a later refund of that line finds a consistent record.
       No stock moves here: it already moved at the bench. */
    var parts = itobjs_(row.parts_json);
    var serialPatches = {};
    var productPatches = {};
    if (parts.length) {
      var serialRows = readRows_('Serials', SERIAL_HEADERS);
      for (var i = 0; i < parts.length; i++) {
        var pp = parts[i];
        if (prodById[String(pp.productId)]) {
          productPatches[String(pp.productId)] = { last_sold_at: now, updated_at: now };
        }
        if (!pp.serialNumber) continue;
        for (var s = 0; s < serialRows.length; s++) {
          if (String(serialRows[s].serial_number) === String(pp.serialNumber)
            && String(serialRows[s].product_id) === String(pp.productId)
            && String(serialRows[s].tx_id) === 'repair:' + id) {
            serialPatches[String(serialRows[s].id)] = { tx_id: txId, updated_at: now };
            break;
          }
        }
      }
    }
    if (Object.keys(serialPatches).length) applyPatches_('Serials', SERIAL_HEADERS, 'id', serialPatches);
    if (Object.keys(productPatches).length) applyPatches_('Products', PRODUCT_HEADERS, 'id', productPatches);

    applyPatches_('Repairs', REPAIR_HEADERS, 'id', {
      [id]: {
        status: 'collected', final_total: totals.total, invoice_tx_id: txId,
        deposit_total: 0, closed_at: now, updated_at: now,
      },
    });
    logAudit_(session, 'repair.collected', 'repair', id,
      String(row.ticket_no || '') + ' collected on ' + receiptNo + ': ' + totals.total.toFixed(2)
      + (heldC ? ' (deposit ' + (heldC / 100).toFixed(2) + ' applied)' : ''), '');

    return {
      id: id, transactionId: txId, receiptNo: receiptNo, total: totals.total,
      depositApplied: heldC / 100, balance: balanceC / 100, tenders: tenders,
    };
  } finally {
    lock.releaseLock();
  }
}

/* A cash drawer opened without a sale is the classic till-theft move, so the
 * terminal records every manual open here: who, which till, and why. The pulse
 * itself goes from the terminal to its printer; this is the paper trail. */
function drawerOpen_(session, payload) {
  payload = payload || {};
  var approval = approvalOrRole_(session, payload, 'drawer', String(payload.ref || ''));
  var reason = String(payload.reason || '').trim().slice(0, 200);
  if (!reason) throw statusError_(400, 'Opening the drawer without a sale needs a reason');
  if (approval && !consumeApproval_(approval)) throw statusError_(409, 'That approval has already been used');
  logAudit_(session, 'drawer.open', 'drawer', '', 'No-sale drawer open: ' + reason +
    (approval ? ' (approved by ' + approval.approverName + ')' : ''),
    String(payload.deviceId || '').slice(0, 80));
  return { recorded: true, approvedBy: approval ? approval.approverName : '' };
}

/* Managers and admins act on their own authority; anyone else needs an approval
   for this action and reference. Returns the approval, or null for a manager. */
function approvalOrRole_(session, payload, action, ref) {
  if (!session || !session.uid) throw statusError_(401, 'Sign in first');
  var role = String(session.role || '');
  if (role === 'admin' || role === 'manager') return null;
  if (!payload.approval) throw statusError_(403, 'Not authorized for this action');
  var p = verifyApproval_(payload.approval, action, ref, null);
  if (!p) throw statusError_(403, 'The approval is not valid for this - ask again');
  return p;
}

function repairDepositRefund_(session, payload) {
  payload = payload || {};
  var id = String(payload.id || '');
  /* the approval's reference names the ticket, so one for another job cannot
     be spent here */
  var approval = approvalOrRole_(session, payload, 'deposit_refund', String(payload.ref || ''));
  if (approval && String(approval.r).split('|')[0] !== id) throw statusError_(403, 'The approval is not valid for this - ask again');
  var reason = String(payload.reason || '').trim().slice(0, 200);
  if (!reason) throw statusError_(400, 'Giving a deposit back needs a reason');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var row = repairFind_(id);
    if (!row) throw statusError_(404, 'Repair not found');
    if (String(row.status) === 'collected') throw statusError_(409, 'This job has been collected - refund the invoice instead');
    var heldC = cents_(row.deposit_total);
    if (heldC <= 0) throw statusError_(409, 'There is no deposit held on this ticket');

    var wantC = payload.amount === undefined || payload.amount === null || payload.amount === ''
      ? heldC : cents_(payload.amount);
    if (wantC <= 0) throw statusError_(400, 'A refund has to be more than nothing');
    if (wantC > heldC) throw statusError_(400, 'That is more than the deposit held');
    var amount = wantC / 100;
    if (approval && approval.m != null && wantC > cents_(approval.m)) throw statusError_(403, 'That is more than was approved');
    if (approval && !consumeApproval_(approval)) throw statusError_(409, 'That approval has already been used');

    var store = getStore_();
    var now = new Date().toISOString();
    var txId = Utilities.getUuid();
    appendRows_('Transactions', TX_HEADERS, [{
      id: txId, store_id: store.id, user_id: String(session.uid || ''), device_id: 'server',
      client_tx_id: 'rdrf-' + txId.slice(0, 8), kind: 'deposit_refund', original_client_tx: '',
      counterparty: String(row.ticket_no || ''), grand_total: amount, status: 'COMPLETED',
      tenders_json: JSON.stringify([{ type: 'cash', amount: amount }]), items_json: '[]',
      note: 'Deposit refund on ' + String(row.ticket_no || '') + ': ' + reason, created_at: now,
      subtotal: '', tax_amount: '', discount_pct: '', customer_id: String(row.customer_id || ''),
      receipt_no: '', channel: 'in_store', external_ref: String(row.ticket_no || ''),
      approved_by: approval ? String(approval.u) : '',
    }]);
    var left = (heldC - wantC) / 100;
    applyPatches_('Repairs', REPAIR_HEADERS, 'id', { [id]: { deposit_total: left, updated_at: now } });
    logAudit_(session, 'repair.deposit_refund', 'repair', id,
      'Refunded ' + amount.toFixed(2) + ' deposit on ' + String(row.ticket_no || '') + ': ' + reason +
      (approval ? ' (approved by ' + approval.approverName + ')' : ''), '');
    return { id: id, transactionId: txId, amount: amount, depositTotal: left };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ *
 *  Trade-ins (v1.44.0)
 *
 *  The shop buys a used device from a customer. The device joins stock under
 *  its IMEI, and its cost is exactly what was paid for it: a cost recorded on
 *  that one serial, not averaged into the product, so the margin when it is
 *  sold again is the real one. The seller is paid in cash from the drawer or
 *  in store credit, which they can spend on the spot.
 *
 *  Second-hand buying needs a record of who sold it: a customer, the kind of
 *  ID that was checked and the last few characters of it - never the whole
 *  document number. A used device is resold with at most 30 days' warranty;
 *  the one-year cover is for brand-new hardware only.
 *
 *  Online only, like repair money: the IMEI check has to see the whole shop.
 * ------------------------------------------------------------------ */

var TRADEIN_HEADERS = ['id', 'store_id', 'tradein_no', 'customer_id', 'seller_name', 'id_type', 'id_ref',
  'product_id', 'product_name', 'serial_number', 'condition', 'notes', 'amount', 'paid_by',
  'tx_id', 'user_id', 'approved_by', 'created_at'];
var TRADEIN_CONDITIONS = { like_new: 'Like new', good: 'Good', fair: 'Fair', faulty: 'Faulty' };
var TRADEIN_ID_TYPES = { driving_licence: 'Driving licence', passport: 'Passport', national_id: 'National ID', other: 'Other ID' };
var TRADEIN_PAY = { cash: 1, store_credit: 1 };
var USED_WARRANTY_MAX = 30;

function formatTradeInNo_(n) {
  var digits = String(Math.max(0, Math.floor(num_(n))));
  while (digits.length < RECEIPT_PAD) digits = '0' + digits;
  return 'Orison-T' + digits;
}

function tradeIn_(session, payload) {
  payload = payload || {};
  var serialNumber = String(payload.serialNumber || '').trim();
  /* the approval names the IMEI, so one given for another device cannot be spent here */
  var approval = approvalOrRole_(session, payload, 'tradein', String(payload.ref || ''));
  if (approval && String(approval.r).split('|')[0] !== serialNumber) throw statusError_(403, 'The approval is not valid for this - ask again');

  var productId = String(payload.productId || '');
  var customerId = String(payload.customerId || '');
  var condition = String(payload.condition || '');
  var idType = String(payload.idType || '');
  var idRef = String(payload.idRef || '').replace(/\s+/g, '').toUpperCase();
  var paidBy = String(payload.paidBy || '');
  var notes = String(payload.notes || '').trim().slice(0, 300);
  var amountC = cents_(payload.amount);

  if (!serialNumber || serialNumber.length > 40) throw statusError_(400, 'Enter the device IMEI or serial number');
  if (!Object.prototype.hasOwnProperty.call(TRADEIN_CONDITIONS, condition)) throw statusError_(400, 'Pick the device condition');
  if (!(amountC > 0)) throw statusError_(400, 'Enter what the shop is paying for it');
  if (!Object.prototype.hasOwnProperty.call(TRADEIN_PAY, paidBy)) throw statusError_(400, 'Pay in cash or store credit');
  if (!customerId) throw statusError_(400, 'A trade-in needs the seller as a customer');
  if (!Object.prototype.hasOwnProperty.call(TRADEIN_ID_TYPES, idType)) throw statusError_(400, 'Record the ID that was checked');
  if (idRef.length < 2 || idRef.length > 6) throw statusError_(400, 'Enter the last 2 to 6 characters of the ID - not the whole number');
  if (approval && approval.m != null && amountC > cents_(approval.m)) throw statusError_(403, 'That is more than was approved');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var product = null;
    var prodRows = readRows_('Products', PRODUCT_HEADERS);
    for (var i = 0; i < prodRows.length; i++) {
      if (String(prodRows[i].id) === productId) { product = prodRows[i]; break; }
    }
    if (!product || String(product.active) !== '1') throw statusError_(404, 'Product not found');
    if (String(product.is_serialized) !== '1') throw statusError_(400, 'Trade-ins go into a product tracked by IMEI or serial');

    var customer = null;
    var custRows = readRows_('Customers', CUSTOMERS_HEADERS);
    for (var c = 0; c < custRows.length; c++) {
      if (String(custRows[c].id) === customerId) { customer = custRows[c]; break; }
    }
    if (!customer) throw statusError_(404, 'Customer not found');

    var serialRows = readRows_('Serials', SERIAL_HEADERS);
    var existing = null;
    for (var s = 0; s < serialRows.length; s++) {
      if (String(serialRows[s].serial_number).toLowerCase() === serialNumber.toLowerCase()) { existing = serialRows[s]; break; }
    }
    if (existing && String(existing.status) !== 'SOLD') throw statusError_(409, 'That IMEI is already in stock here');
    if (approval && !consumeApproval_(approval)) throw statusError_(409, 'That approval has already been used');

    var store = getStore_();
    var now = new Date().toISOString();
    var k = kv_();
    var seq = num_(k.tradein_seq);
    if (!(seq >= 0)) seq = 0;
    setKv_('tradein_seq', seq + 1);
    var tradeInNo = formatTradeInNo_(seq + 1);
    var amount = amountC / 100;
    var sellerName = String(customer.name || '');

    /* a device the shop once sold keeps its one serial row: it simply comes back */
    var serialFields = { product_id: productId, status: 'IN_STOCK', tx_id: '', updated_at: now, cost: amount, source: 'tradein' };
    if (existing) {
      applyPatches_('Serials', SERIAL_HEADERS, 'id', { [String(existing.id)]: serialFields });
      serialNumber = String(existing.serial_number);
    } else {
      appendRows_('Serials', SERIAL_HEADERS, [Object.assign({ id: Utilities.getUuid(), serial_number: serialNumber }, serialFields)]);
    }
    applyPatches_('Products', PRODUCT_HEADERS, 'id', { [productId]: { updated_at: now } });

    var txId = Utilities.getUuid();
    appendRows_('Transactions', TX_HEADERS, [{
      id: txId, store_id: store.id, user_id: String(session.uid || ''), device_id: 'server',
      client_tx_id: 'tin-' + txId.slice(0, 8), kind: 'tradein', original_client_tx: '',
      counterparty: sellerName, grand_total: amount, status: 'COMPLETED',
      tenders_json: JSON.stringify([{ type: paidBy, amount: amount }]), items_json: '[]',
      note: 'Trade-in ' + tradeInNo + ': ' + String(product.name || '') + ' · ' + serialNumber, created_at: now,
      subtotal: '', tax_amount: '', discount_pct: '', customer_id: customerId,
      receipt_no: '', channel: 'in_store', external_ref: tradeInNo,
      approved_by: approval ? String(approval.u) : '',
    }]);
    var id = Utilities.getUuid();
    appendRows_('TradeIns', TRADEIN_HEADERS, [{
      id: id, store_id: store.id, tradein_no: tradeInNo, customer_id: customerId, seller_name: sellerName,
      id_type: idType, id_ref: idRef, product_id: productId, product_name: String(product.name || ''),
      serial_number: serialNumber, condition: condition, notes: notes, amount: amount, paid_by: paidBy,
      tx_id: txId, user_id: String(session.uid || ''), approved_by: approval ? String(approval.u) : '', created_at: now,
    }]);
    logAudit_(session, 'tradein.create', 'tradein', id,
      tradeInNo + ': bought ' + String(product.name || '') + ' ' + serialNumber + ' (' + TRADEIN_CONDITIONS[condition] + ') from '
      + sellerName + ' for ' + amount.toFixed(2) + (paidBy === 'cash' ? ' cash' : ' store credit')
      + (existing ? ' - a device sold here before' : '')
      + (approval ? ' (approved by ' + approval.approverName + ')' : ''), '');
    return {
      id: id, tradeInNo: tradeInNo, transactionId: txId, amount: amount, paidBy: paidBy,
      serialNumber: serialNumber, productId: productId, productName: String(product.name || ''),
      soldHereBefore: !!existing, customer: customerDto_(customer), createdAt: now,
    };
  } finally {
    lock.releaseLock();
  }
}

function tradeIns_(session, params) {
  requireRole_(session, ['admin', 'manager']);
  var q = String((params && params.q) || '').trim().toLowerCase();
  var rows = readRows_('TradeIns', TRADEIN_HEADERS);
  rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  var statusBySn = Object.create(null);
  var serialRows = readRows_('Serials', SERIAL_HEADERS);
  for (var s = 0; s < serialRows.length; s++) statusBySn[String(serialRows[s].serial_number)] = String(serialRows[s].status);
  var out = [];
  for (var i = 0; i < rows.length && out.length < 200; i++) {
    var r = rows[i];
    if (q && (String(r.tradein_no) + ' ' + String(r.seller_name) + ' ' + String(r.serial_number) + ' ' + String(r.product_name)).toLowerCase().indexOf(q) < 0) continue;
    out.push({
      id: String(r.id), tradeInNo: String(r.tradein_no), createdAt: String(r.created_at),
      sellerName: String(r.seller_name), customerId: String(r.customer_id),
      idType: String(r.id_type), idRef: String(r.id_ref),
      productId: String(r.product_id), productName: String(r.product_name), serialNumber: String(r.serial_number),
      condition: String(r.condition), notes: String(r.notes), amount: num_(r.amount), paidBy: String(r.paid_by),
      inStock: statusBySn[String(r.serial_number)] === 'IN_STOCK',
      userName: auditName_(String(r.user_id)),
    });
  }
  return { tradeIns: out };
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

/* Value a counted drawer against the store's own cash ladder. Only amounts the
 * store actually holds are counted — a quantity sent for a denomination that
 * is not in the ladder is ignored rather than trusted, so a terminal cannot
 * inflate a declared total by inventing a note. Cents throughout: 0.05 × 3
 * must not become 0.15000000000000002. */
function shiftDenomsValue_(denoms, ladder) {
  var denominations = ladder && ladder.length ? ladder : currencyDenoms_(DEFAULT_CURRENCY);
  var cents = 0;
  denoms = denoms || {};
  for (var d = 0; d < denominations.length; d++) {
    var face = denominations[d];
    var qty = num_(denoms[face]);
    if (!(qty > 0)) continue;
    cents += Math.round(face * 100) * Math.round(qty);
  }
  return cents / 100;
}

function shiftOpen_(session, payload) {
  var openingFloat = num_(payload && payload.openingFloat);
  if (!(openingFloat >= 0)) throw statusError_(400, 'opening_float_required');
  var note = String((payload && payload.note) || '').slice(0, 200);

  /* "is there already an OPEN shift for this user?" is a first-committed-wins
     claim: read the shifts + append under the lock so two parallel opens by
     the same cashier can't both pass the pre-lock check and open twice. */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
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
  } finally {
    lock.releaseLock();
  }
}

function shiftClose_(session, payload) {
  var shiftId = String((payload && payload.shiftId) || '');
  var note = String((payload && payload.note) || '').slice(0, 200);

  /* Close is a mutate-in-place on a shared row: read the shifts, compute the
     expected drawer, and write the CLOSED row all under the lock so a
     double-close can't race into two partial writes or a lost over/short. */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var shiftRows = readRows_('Shifts', SHIFTS_HEADERS);
    var shift = null;
    for (var s = 0; s < shiftRows.length; s++) {
      if (shiftId && String(shiftRows[s].id) === shiftId) { shift = shiftRows[s]; break; }
      if (String(shiftRows[s].status) === 'OPEN' && String(shiftRows[s].user_id) === String(session.uid)) shift = shiftRows[s];
    }
    if (!shift) throw statusError_(404, 'no_open_shift');
    if (String(shift.user_id) !== String(session.uid)) throw statusError_(403, 'not_your_shift');
    if (String(shift.status) !== 'OPEN') throw statusError_(409, 'shift_already_closed');

    var declared = shiftDenomsValue_(payload && payload.denoms, getStore_().denoms);
    var expected = shiftExpectedCash_(shift, readRows_('Transactions', TX_HEADERS));
    var overShort = declared - expected;
    return finishShiftClose_(session, shift, expected, declared, overShort, (payload && payload.denoms) || {}, note, '');
  } finally {
    lock.releaseLock();
  }
}

/* What the drawer should hold for a shift: the float plus the cash side of
   everything its cashier did since it opened. One definition for the
   cashier's own close and a manager's close of a forgotten shift. */
function shiftExpectedCash_(shift, allTxRows) {
    var openedAt = new Date(String(shift.opened_at)).getTime();
    var txRows = allTxRows
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
      } else if (isCashOutKind_(kind)) {
        expected -= num_(tr.grand_total);
      } else if (kind === 'refund') {
        for (var m = 0; m < tenders.length; m++) {
          if (String(tenders[m].type || '') === 'cash') expected -= num_(tenders[m].amount);
        }
      } else if (kind === 'deposit') {
        /* Repair deposit: real cash in the drawer, though not revenue. The
           'deposit' tender on the later collection sale is not cash, so the
           same money is never counted twice. */
        for (var dq = 0; dq < tenders.length; dq++) {
          if (String(tenders[dq].type || '') === 'cash') expected += num_(tenders[dq].amount);
        }
      } else if (kind === 'supplier_payment') {
        /* a supplier paid in cash from the till */
        for (var sq = 0; sq < tenders.length; sq++) {
          if (String(tenders[sq].type || '') === 'cash') expected -= num_(tenders[sq].amount);
        }
      } else if (kind === 'tradein') {
        /* the shop bought a device: cash paid out of the drawer */
        for (var tq = 0; tq < tenders.length; tq++) {
          if (String(tenders[tq].type || '') === 'cash') expected -= num_(tenders[tq].amount);
        }
      } else if (kind === 'deposit_refund') {
        for (var dr = 0; dr < tenders.length; dr++) {
          if (String(tenders[dr].type || '') === 'cash') expected -= num_(tenders[dr].amount);
        }
      } else if (kind === 'payment') {
        for (var p = 0; p < tenders.length; p++) {
          if (String(tenders[p].type || '') === 'cash') expected += num_(tenders[p].amount);
        }
      }
    }
    return expected;
}

/* Write the CLOSED row in place. `declared`/`overShort` are '' for a shift a
   manager closed without counting the drawer. Caller holds the lock. */
function finishShiftClose_(session, shift, expected, declared, overShort, denoms, note, closedBy) {
    var closedAt = new Date().toISOString();
    var tendersJson = JSON.stringify(denoms || {});
    var patch = {
      closed_at: closedAt,
      cash_expected: expected,
      cash_declared: declared,
      over_short: overShort,
      tenders_json: tendersJson,
      note: shift.note ? String(shift.note) + (note ? ' | ' + note : '') : note,
      status: 'CLOSED',
      closed_by: closedBy || '',
    };
    applyPatches_('Shifts', SHIFTS_HEADERS, 'id', { [String(shift.id)]: patch });
    return {
      shift: shift_views_(session, [Object.assign(shift, patch)])[0],
      open: false,
      msg: 'Shift closed',
    };
}

/* A manager closes a shift someone left open (v1.39.0). With a count, the
   over/short is real; without one the shift is closed as not counted, so the
   next open is not blocked and nobody's figures are invented. Always audited. */
function shiftForceClose_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  payload = payload || {};
  var shiftId = String(payload.shiftId || '');
  var reason = String(payload.reason || '').trim().slice(0, 200);
  if (!shiftId) throw statusError_(400, 'shiftId is required');
  if (!reason) throw statusError_(400, 'Closing someone else\'s shift needs a reason');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var rows = readRows_('Shifts', SHIFTS_HEADERS);
    var shift = null;
    for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === shiftId) { shift = rows[i]; break; }
    if (!shift) throw statusError_(404, 'no_open_shift');
    if (String(shift.status) !== 'OPEN') throw statusError_(409, 'shift_already_closed');
    var expected = shiftExpectedCash_(shift, readRows_('Transactions', TX_HEADERS));
    var counted = payload.denoms && typeof payload.denoms === 'object' && Object.keys(payload.denoms).length > 0;
    var declared = counted ? shiftDenomsValue_(payload.denoms, getStore_().denoms) : '';
    var overShort = counted ? declared - expected : '';
    var who = auditName_(String(session.uid));
    var note = 'Closed by ' + who + ': ' + reason + (counted ? '' : ' (drawer not counted)');
    var res = finishShiftClose_(session, shift, expected, declared, overShort, counted ? payload.denoms : {}, note, String(session.uid));
    logAudit_(session, 'shift.force_close', 'shift', shiftId,
      'Closed ' + auditName_(String(shift.user_id)) + '\'s shift: ' + reason + ' — expected ' + round2_(expected) +
      (counted ? ', counted ' + round2_(declared) + ', over/short ' + round2_(overShort) : ', not counted'), payload.deviceId);
    return res;
  } finally {
    lock.releaseLock();
  }
}

/* A shift row carries another cashier's float, expected drawer and over/short,
 * so the store-wide view is manager/admin only. A cashier sees their own rows
 * and their own open count — `params.status=all` used to let anyone opt into
 * the full roster, which leaked every till reconciliation to every till. */
function shifts_(session, params) {
  var isStore = isStoreRole_(session && session.role);
  var rows = readRows_('Shifts', SHIFTS_HEADERS)
    .filter(function (s) { return isStore || String(s.user_id) === String(session.uid); })
    .sort(function (a, b) { return String(b.opened_at).localeCompare(String(a.opened_at)); });
  var open = 0;
  if (isStore) open = shiftOpenCount_();
  else for (var i = 0; i < rows.length; i++) if (String(rows[i].status) === 'OPEN') open++;
  return { shifts: shift_views_(session, rows), open: open };
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
      closedBy: s.closed_by ? (String((byUser[String(s.closed_by)] || {}).first_name || '') + ' ' + String((byUser[String(s.closed_by)] || {}).last_name || '')).trim() : '',
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Time clock — who is on the floor, and for how long
 * ------------------------------------------------------------------ */

/* A punch is a self-service act: staff clock themselves in and out, and only
 * managers/admins can read the whole roster. Nobody can punch for somebody
 * else, so an entry is always evidence about the account that created it. */
/* A manager fixes a punch someone forgot or got wrong (v1.39.0): a missed
   clock-out, a clock-in keyed on the wrong day. A reason is required, the
   original times stay in the audit log, and nobody but an admin corrects
   their own hours. */
function timeClockCorrect_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  payload = payload || {};
  var id = String(payload.id || '');
  var reason = String(payload.reason || '').trim().slice(0, 200);
  if (!id) throw statusError_(400, 'id is required');
  if (!reason) throw statusError_(400, 'Correcting a punch needs a reason');
  var parse = function (v) {
    if (v == null || v === '') return null;
    var ms = Date.parse(String(v));
    if (isNaN(ms)) throw statusError_(400, 'Times must be valid dates');
    return ms;
  };
  var inMs = parse(payload.clockIn);
  var outMs = parse(payload.clockOut);
  if (inMs == null && outMs == null) throw statusError_(400, 'Give a clock-in or clock-out time');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var rows = readRows_('TimeClock', TIMECLOCK_HEADERS);
    var row = null;
    for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === id) { row = rows[i]; break; }
    if (!row) throw statusError_(404, 'Punch not found');
    if (String(row.user_id) === String(session.uid) && String(session.role) !== 'admin') {
      throw statusError_(403, 'Only an admin can correct their own hours');
    }
    var newIn = inMs != null ? inMs : Date.parse(String(row.clock_in));
    var newOut = outMs != null ? outMs : (row.clock_out ? Date.parse(String(row.clock_out)) : null);
    var nowMs = Date.now() + 5 * 60000;
    if (isNaN(newIn) || newIn > nowMs || (newOut != null && newOut > nowMs)) throw statusError_(400, 'A punch cannot be in the future');
    if (newOut != null && newOut <= newIn) throw statusError_(400, 'Clock-out must be after clock-in');
    if (newOut != null && newOut - newIn > 24 * 3600000) throw statusError_(400, 'A single punch cannot run past 24 hours');

    var patch = {
      clock_in: new Date(newIn).toISOString(),
      corrected_by: String(session.uid),
      note: (row.note ? String(row.note) + ' | ' : '') + 'Corrected by ' + auditName_(String(session.uid)) + ': ' + reason,
    };
    if (newOut != null) {
      patch.clock_out = new Date(newOut).toISOString();
      patch.minutes = Math.round((newOut - newIn) / 60000);
      patch.status = 'CLOSED';
    }
    applyPatches_('TimeClock', TIMECLOCK_HEADERS, 'id', { [id]: patch });
    logAudit_(session, 'timeclock.correct', 'timeclock', id,
      auditName_(String(row.user_id)) + ': in ' + String(row.clock_in || '—') + ' → ' + patch.clock_in +
      ', out ' + String(row.clock_out || '—') + ' → ' + String(patch.clock_out || row.clock_out || '—') + ' — ' + reason, payload.deviceId);
    return { entry: timeClockView_([Object.assign({}, row, patch)], timeClockNames_())[0] };
  } finally {
    lock.releaseLock();
  }
}

function timeClockView_(rows, nameById) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    out.push({
      id: String(r.id || ''),
      userId: String(r.user_id || ''),
      userName: nameById[String(r.user_id || '')] || '—',
      deviceId: String(r.device_id || ''),
      clockIn: String(r.clock_in || ''),
      clockOut: String(r.clock_out || ''),
      minutes: r.minutes === '' || r.minutes == null ? null : num_(r.minutes),
      note: String(r.note || ''),
      status: String(r.status || 'OPEN'),
      corrected: !!r.corrected_by,
    });
  }
  return out;
}

function timeClockNames_() {
  var userRows = readRows_('Users', USER_HEADERS);
  var nameById = {};
  for (var i = 0; i < userRows.length; i++) {
    nameById[String(userRows[i].id)] = (String(userRows[i].first_name || '') + ' ' + String(userRows[i].last_name || '')).trim();
  }
  return nameById;
}

function timeClock_(session, params) {
  var isStore = isStoreRole_(session && session.role);
  var wantUser = String((params && params.userId) || '');
  var limit = parseInt(params && params.limit, 10);
  if (isNaN(limit) || limit < 1) limit = 200;
  limit = Math.min(limit, 500);

  var rows = readRows_('TimeClock', TIMECLOCK_HEADERS).filter(function (r) {
    if (!isStore) return String(r.user_id) === String(session.uid);
    return !wantUser || String(r.user_id) === wantUser;
  });
  rows.sort(function (a, b) { return String(b.clock_in).localeCompare(String(a.clock_in)); });

  var mine = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].status) === 'OPEN' && String(rows[i].user_id) === String(session.uid)) { mine = rows[i]; break; }
  }
  var onFloor = 0;
  if (isStore) {
    var all = readRows_('TimeClock', TIMECLOCK_HEADERS);
    for (var j = 0; j < all.length; j++) if (String(all[j].status) === 'OPEN') onFloor++;
  } else {
    onFloor = mine ? 1 : 0;
  }

  var nameById = timeClockNames_();
  return {
    entries: timeClockView_(rows.slice(0, limit), nameById),
    onFloor: onFloor,
    me: mine ? { open: true, entryId: String(mine.id), since: String(mine.clock_in || '') } : { open: false },
  };
}

/* Punch in or out — the caller's own clock, toggled. Read + write happen under
 * the script lock so a double-tap can't open two entries or close one twice. */
function timeClockPunch_(session, payload) {
  var note = String((payload && payload.note) || '').slice(0, 200);
  /* A punch queued offline carries when it actually happened; a live punch is
     now. A shop that can sell offline must be able to clock in offline too. */
  var at = String((payload && payload.at) || '');
  var when = at && !isNaN(Date.parse(at)) ? new Date(at) : new Date();
  var deviceId = String((payload && payload.deviceId) || '');
  var want = String((payload && payload.direction) || '').toLowerCase();
  if (want && want !== 'in' && want !== 'out') throw statusError_(400, 'direction must be in or out');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var rows = readRows_('TimeClock', TIMECLOCK_HEADERS);
    var open = null;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].status) === 'OPEN' && String(rows[i].user_id) === String(session.uid)) { open = rows[i]; break; }
    }
    var nameById = timeClockNames_();
    var now = when;
    var nowIso = now.toISOString();

    if (open) {
      if (want === 'in') throw statusError_(409, 'already_clocked_in');
      var inMs = new Date(String(open.clock_in)).getTime();
      var minutes = isNaN(inMs) ? 0 : Math.max(0, Math.round((now.getTime() - inMs) / 60000));
      applyPatches_('TimeClock', TIMECLOCK_HEADERS, 'id', {
        [String(open.id)]: {
          clock_out: nowIso,
          minutes: minutes,
          note: open.note ? String(open.note) + (note ? ' | ' + note : '') : note,
          status: 'CLOSED',
        },
      });
      var closed = Object.assign({}, open, {
        clock_out: nowIso, minutes: minutes, status: 'CLOSED',
        note: open.note ? String(open.note) + (note ? ' | ' + note : '') : note,
      });
      return { punched: 'out', entry: timeClockView_([closed], nameById)[0] };
    }

    if (want === 'out') throw statusError_(409, 'not_clocked_in');
    var row = {
      id: Utilities.getUuid(),
      store_id: getStore_().id,
      user_id: String(session.uid),
      device_id: deviceId,
      clock_in: nowIso,
      clock_out: '',
      minutes: '',
      note: note,
      status: 'OPEN',
    };
    appendRows_('TimeClock', TIMECLOCK_HEADERS, [row]);
    return { punched: 'in', entry: timeClockView_([row], nameById)[0] };
  } finally {
    lock.releaseLock();
  }
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
    logAudit_(session, 'conflict.review', 'conflict', id, status, '');
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
  /* managers may reset a cashier's PIN (v1.39.0) - never another manager's or
     an admin's, which would let a manager take over a senior account */
  requireRole_(session, ['admin', 'manager']);
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
  if (String(session.role) === 'manager' && String(found.role) !== 'cashier') {
    throw statusError_(403, 'A manager can only reset a cashier\'s PIN');
  }

  var salt = Utilities.getUuid().split('-')[0];
  applyPatches_('Users', USER_HEADERS, 'id', {
    [found.id]: { pin_salt: salt, pin_hash: sha256Hex_(salt + ':' + pin) },
  });
  clearLoginFailures_(email);
  revokeTokensForUser_(found.id);
  Logger.log('[orison-pos] PIN reset for ' + email + ' by ' + session.uid);
  logAudit_(session, 'user.pin_reset', 'user', String(found.id), 'PIN reset for ' + email, '');
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
  logAudit_(session, 'user.unlock', 'user', email, 'Sign-in lockout released for ' + email, '');
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
  var newId = Utilities.getUuid();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    appendRows_('Users', USER_HEADERS, [{
      id: newId,
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
  logAudit_(session, 'user.create', 'user', newId, 'New ' + role + ' account ' + email, '');
  return { ok: true, oneTimePin: pin, email: email, id: newId };
}

/* Full staff roster for the Settings screen. Admin only. Deliberately omits
 * anything credential-shaped; the client only needs identity + role + state. */
function adminUsersList_(session) {
  /* managers see the team so they can let a locked-out cashier back in */
  requireRole_(session, ['admin', 'manager']);
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
  var self = String(session.uid) === id;
  if (self && (payload.active === false || payload.active === 0 ||
      (typeof payload.role === 'string' && payload.role !== String(found.role)))) {
    throw statusError_(400, 'You cannot deactivate or demote yourself');
  }

  var patch = {};
  if (typeof payload.active === 'boolean') {
    patch.active = payload.active ? 1 : 0;
  } else if (payload.active === 0 || payload.active === 1) {
    patch.active = payload.active;
  }
  if (typeof payload.role === 'string' && ['admin', 'manager', 'cashier'].indexOf(payload.role) >= 0
      && payload.role !== String(found.role)) {
    patch.role = payload.role;
  }
  if (typeof payload.firstName === 'string') {
    var fn = payload.firstName.trim().slice(0, 60);
    if (!fn) throw statusError_(400, 'First and last name are required');
    if (fn !== String(found.first_name)) patch.first_name = fn;
  }
  if (typeof payload.lastName === 'string') {
    var ln = payload.lastName.trim().slice(0, 60);
    if (!ln) throw statusError_(400, 'First and last name are required');
    if (ln !== String(found.last_name)) patch.last_name = ln;
  }
  if (typeof payload.email === 'string') {
    var em = payload.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw statusError_(400, 'A valid email is required');
    if (em !== String(found.email).toLowerCase()) {
      for (var j = 0; j < users.length; j++) {
        if (String(users[j].id) !== id && String(users[j].email).toLowerCase() === em) {
          throw statusError_(409, 'An account with that email already exists');
        }
      }
      patch.email = em;
    }
  }
  if (!Object.keys(patch).length) return { ok: true, changed: false };

  applyPatches_('Users', USER_HEADERS, 'id', { [id]: patch });
  AUDIT_NAMES_ = null;
  if (patch.active === 0) { revokeTokensForUser_(id); markAllDevicesRevoked_(id); }
  else if (patch.role || patch.email) { revokeTokensForUser_(id); }
  Logger.log('[orison-pos] user ' + id + ' patched ' + JSON.stringify(patch) + ' by ' + session.uid);
  logAudit_(session, 'user.patch', 'user', id, JSON.stringify(patch), '');
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
      logAudit_(session, 'session.revoke_all', 'user', uid, 'Every session and terminal revoked for ' + email, '');
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
  logAudit_(session, 'device.revoke', 'device', String(deviceId), 'Revoked terminal for ' + email, '');
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
  var warrantyDays = parseWarrantyDays_(payload.warrantyDays);
  if (warrantyDays == null) warrantyDays = itemType === 'service' ? 0 : 30;

  /* SKU/UPC uniqueness is a first-committed-wins claim, so the catalog read
     happens under the lock — two terminals creating the same SKU in parallel
     must not both pass the check against the pre-lock snapshot. */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    var existing = readRows_('Products', PRODUCT_HEADERS);
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i].sku) === sku || (upc && String(existing[i].upc) === upc)) {
        throw statusError_(409, 'A product with that SKU or UPC already exists');
      }
    }
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
      warranty_days: warrantyDays,
    }]);
    recordPriceChange_({ id: id, name: name }, 'cost_price', '', cost, 'create', null, String(session.uid || ''));
    recordPriceChange_({ id: id, name: name }, 'retail_price', '', retail, 'create', null, String(session.uid || ''));
    logAudit_(session, 'product.create', 'product', id,
      name + ' (' + sku + ') ' + itemType + (itemType === 'service' ? '' : ', on hand ' + onHand), payload.deviceId);
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

  /* Serial intake is a same-name claim too: the product lookup, the existing
     serial set, and the append must all read under the lock so two terminals
     grabbing "the same SN" can't both pass the pre-lock duplicate check. */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
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
    /* serial numbers are operator-supplied text: a null-prototype set so a
       serial reading "constructor" is not mistaken for an existing one. */
    var snSet = Object.create(null);
    for (var j = 0; j < serialRows.length; j++) snSet[String(serialRows[j].serial_number)] = true;

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
    if (added.length) {
      logAudit_(session, 'serial.add', 'product', productId,
        added.length + ' serial(s) added to ' + String(product.name) + ': ' + added.join(', '), payload.deviceId);
    }
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

  /* The serialized/service checks decide whether this write is legal at all,
     so they must read the row this call is about to overwrite — not a snapshot
     taken before the lock, which another terminal may already have replaced. */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
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
    applyPatches_('Products', PRODUCT_HEADERS, 'id', {
      [productId]: { on_hand: onHand, updated_at: new Date().toISOString() },
    });
    var was = num_(product.on_hand);
    var reason = String(payload.reason || '').trim().slice(0, 200);
    logAudit_(session, 'stock.adjust', 'product', productId,
      String(product.name) + ': ' + was + ' → ' + onHand + ' (' + (onHand - was >= 0 ? '+' : '') + (onHand - was) + ')' +
      (reason ? ' — ' + reason : ''), payload.deviceId);
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
  payload = payload || {};

  /* Every field is optional and only written when it is actually sent. This
     endpoint used to read `num_(payload.taxRate)` unconditionally, so a call
     that meant to change the time zone would silently reset the store's sales
     tax to zero — with more fields sharing the endpoint that trap gets worse,
     not better. */
  var taxUpd;
  if (payload.taxRate != null && payload.taxRate !== '') {
    taxUpd = num_(payload.taxRate);
    if (!(taxUpd >= 0) || taxUpd > 100) throw statusError_(400, 'taxRate must be between 0 and 100');
  }

  var tzMinUpd;
  if (payload.tzOffsetMin != null && payload.tzOffsetMin !== '') {
    tzMinUpd = num_(payload.tzOffsetMin);
    if (isNaN(tzMinUpd) || tzMinUpd < -720 || tzMinUpd > 840) {
      throw statusError_(400, 'tzOffsetMin must be between -720 and 840');
    }
  }

  var localeUpd;
  if (payload.locale != null && payload.locale !== '') {
    localeUpd = String(payload.locale);
    if (!isLocaleTag_(localeUpd)) throw statusError_(400, 'locale must be a BCP-47 tag such as en-NG');
  }

  var countryUpd;
  if (payload.country != null && payload.country !== '') {
    countryUpd = String(payload.country).toUpperCase();
    if (!isCountryCode_(countryUpd)) throw statusError_(400, 'country must be a two-letter ISO code');
  }

  var currencyUpd;
  if (payload.currency != null && payload.currency !== '') {
    currencyUpd = String(payload.currency).toUpperCase();
    if (!isCurrencyCode_(currencyUpd)) throw statusError_(400, 'currency must be a three-letter ISO code');
  }

  /* An explicit ladder wins; otherwise changing the currency adopts that
     currency's default notes and coins, because a ladder left over from the
     previous currency would count the drawer wrong. */
  var denomsUpd;
  if (payload.denoms != null) {
    denomsUpd = normaliseDenoms_(payload.denoms);
    if (!denomsUpd) throw statusError_(400, 'denoms must be 1-20 distinct positive amounts, at most 2 decimal places');
  } else if (currencyUpd && currencyUpd !== getStore_().currency) {
    denomsUpd = currencyDenoms_(currencyUpd);
  }

  var jurisdictionUpd, regNoUpd, inclusiveUpd;
  if (payload.taxJurisdiction != null && payload.taxJurisdiction !== '') {
    jurisdictionUpd = String(payload.taxJurisdiction).toUpperCase();
    if (!TAX_JURISDICTIONS[jurisdictionUpd]) throw statusError_(400, 'taxJurisdiction must be US, AE or NONE');
  }
  if (payload.taxRegNo != null) {
    regNoUpd = String(payload.taxRegNo).replace(/\s+/g, '');
    var effJur = jurisdictionUpd || getStore_().taxJurisdiction;
    if (regNoUpd && effJur === 'AE' && !isTrn_(regNoUpd)) throw statusError_(400, 'A UAE TRN is 15 digits');
    if (regNoUpd.length > 40) throw statusError_(400, 'That registration number is too long');
  }
  if (payload.pricesIncludeTax != null) inclusiveUpd = payload.pricesIncludeTax === true || payload.pricesIncludeTax === 1 || payload.pricesIncludeTax === '1';
  /* Choosing the UAE without saying otherwise adopts its rules: 5 % VAT, prices
     including VAT. An explicit rate or flag in the same call wins. */
  if (jurisdictionUpd && jurisdictionUpd !== getStore_().taxJurisdiction) {
    var jd = TAX_JURISDICTIONS[jurisdictionUpd];
    if (taxUpd === undefined && jd.defaultRate != null) taxUpd = jd.defaultRate;
    if (inclusiveUpd === undefined) inclusiveUpd = jd.inclusive;
  }

  var limitCashierUpd, limitManagerUpd;
  if (payload.discountLimitCashier != null && payload.discountLimitCashier !== '') {
    limitCashierUpd = num_(payload.discountLimitCashier);
    if (!(limitCashierUpd >= 0) || limitCashierUpd > 100) throw statusError_(400, 'Discount limits must be between 0 and 100');
  }
  if (payload.discountLimitManager != null && payload.discountLimitManager !== '') {
    limitManagerUpd = num_(payload.discountLimitManager);
    if (!(limitManagerUpd >= 0) || limitManagerUpd > 100) throw statusError_(400, 'Discount limits must be between 0 and 100');
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
    if (jurisdictionUpd !== undefined) setKv_('tax_jurisdiction', jurisdictionUpd);
    if (regNoUpd !== undefined) setKv_('tax_reg_no', regNoUpd);
    if (inclusiveUpd !== undefined) setKv_('prices_include_tax', inclusiveUpd ? 1 : 0);
    if (limitCashierUpd !== undefined) setKv_('discount_limit_cashier', limitCashierUpd);
    if (limitManagerUpd !== undefined) setKv_('discount_limit_manager', limitManagerUpd);
    if (taxUpd !== undefined) setKv_('store_tax_rate', taxUpd);
    if (tzMinUpd !== undefined) setKv_('store_tz_offset', tzMinUpd);
    if (localeUpd !== undefined) setKv_('store_locale', localeUpd);
    if (countryUpd !== undefined) setKv_('store_country', countryUpd);
    if (currencyUpd !== undefined) setKv_('store_currency', currencyUpd);
    if (denomsUpd !== undefined) setKv_('store_denoms', JSON.stringify(denomsUpd));
    logAudit_(session, 'store.settings', 'store', getStore_().id, 'Store settings updated: ' + Object.keys(payload).filter(function (k) { return k !== 'deviceId'; }).map(function (k) { return k + ' ' + (typeof payload[k] === 'object' ? JSON.stringify(payload[k]) : String(payload[k])); }).join(', ').slice(0, 400), payload.deviceId);
    return getStore_();
  } finally {
    lock.releaseLock();
  }
}

function adminProductsPatch_(session, payload) {
  requireRole_(session, ['admin', 'manager']);
  var productId = String(payload.productId || '').trim();
  if (!productId) throw statusError_(400, 'productId is required');

  /* The whole body reads the product to decide what is legal AND to record the
     "old value" in price history, so it runs inside the lock: a pre-lock read
     would let two concurrent edits each report the same stale old price, and
     the audit trail would then disagree with what actually happened. */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw statusError_(503, 'Storage busy, retry');
  try {
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
    var wd = parseWarrantyDays_(payload.warrantyDays);
    if (wd != null) patch.warranty_days = wd;
    var itemType = String(product.item_type || 'product');
    if (payload.reorderPoint !== undefined && payload.reorderPoint !== null) {
      if (itemType === 'service' || String(product.is_serialized) === '1') {
        throw statusError_(400, 'Reorder point only applies to non-serialized products');
      }
      patch.reorder_point = num_(payload.reorderPoint);
    }
    if (!Object.keys(patch).length) throw statusError_(400, 'Nothing to update');

    patch.updated_at = new Date().toISOString();
    applyPatches_('Products', PRODUCT_HEADERS, 'id', { [productId]: patch });
    if (patch.retail_price !== undefined && num_(product.retail_price) !== num_(patch.retail_price)) {
      recordPriceChange_(product, 'retail_price', num_(product.retail_price), num_(patch.retail_price), 'patch', null, String(session.uid || ''));
    }
    if (patch.cost_price !== undefined && num_(product.cost_price) !== num_(patch.cost_price)) {
      recordPriceChange_(product, 'cost_price', num_(product.cost_price), num_(patch.cost_price), 'patch', null, String(session.uid || ''));
    }
    var changes = [];
    var labels = { retail_price: 'retail', cost_price: 'cost', locked: 'locked', taxable: 'taxable', reorder_point: 'reorder at', warranty_days: 'warranty days' };
    for (var key in labels) {
      if (patch[key] !== undefined && String(patch[key]) !== String(product[key])) {
        changes.push(labels[key] + ' ' + String(product[key]) + ' → ' + String(patch[key]));
      }
    }
    if (changes.length) {
      logAudit_(session, 'product.update', 'product', productId, String(product.name) + ': ' + changes.join(', '), payload.deviceId);
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

  var tzExp = num_(getStore_().tzOffsetMin);
  var day = String(payload.date || params.date || localDayKey_(new Date().toISOString(), tzExp));
  var txRows = readRows_('Transactions', TX_HEADERS);
  var dayRows = txRows.filter(function (t) {
    if (String(t.status) !== 'COMPLETED') return false;
    if (localDayKey_(t.created_at, tzExp) !== day) return false;
    return isStore || String(t.user_id) === ownerId;
  });

  var userRows = readRows_('Users', USER_HEADERS);
  var nameById = {};
  for (var i = 0; i < userRows.length; i++) {
    nameById[String(userRows[i].id)] = (String(userRows[i].first_name || '') + ' ' + String(userRows[i].last_name || '')).trim();
  }

  var csv = 'created_at,id,kind,counterparty,cashier,grand_total,tax,items,tenders,note' + (isStore ? ',cost,gross_profit' : '') + '\n';
  var sales = 0, refunds = 0, payouts = 0, pickups = 0, expenses = 0, collections = 0, taxTotal = 0, costTotalDay = 0, gpDay = 0;
  var cashDrawer = 0, cardTotal = 0;
  var depositsIn = 0, depositsApplied = 0, depositsRefunded = 0, tradeIns = 0, supplierPaid = 0;
  for (var j = 0; j < dayRows.length; j++) {
    var t = dayRows[j];
    var k = String(t.kind || 'sale');
    var v = num_(t.grand_total);
    if (k === 'refund') refunds += v;
    else if (k === 'payout') payouts += v;
    else if (k === 'pickup') pickups += v;
    else if (k === 'expense') expenses += v;
    else if (k === 'payment') collections += v;
    else if (k === 'deposit') depositsIn += v;
    else if (k === 'deposit_refund') depositsRefunded += v;
    else if (k === 'tradein') tradeIns += v;
    else if (k === 'supplier_payment') supplierPaid += v;
    else if (k !== 'purchase') sales += v;

    /* What the drawer should actually hold is a TENDER question, not a kind
       question: a card sale is revenue but never cash. */
    var dayTenders = [];
    try { dayTenders = JSON.parse(t.tenders_json || '[]'); } catch (_) {}
    for (var dt = 0; dt < dayTenders.length; dt++) {
      var dty = String(dayTenders[dt].type || 'cash');
      var dta = num_(dayTenders[dt].amount);
      if (dty === 'card') cardTotal += (k === 'refund' || k === 'deposit_refund' ? -dta : dta);
      if (dty === 'deposit' && k === 'sale') depositsApplied += dta;
      if (dty !== 'cash') continue;
      if (k === 'refund' || k === 'deposit_refund' || k === 'tradein' || k === 'supplier_payment') cashDrawer -= dta;
      else if (k === 'sale' || k === 'payment' || k === 'deposit') cashDrawer += dta;
    }
    if (isCashOutKind_(k)) cashDrawer -= v;
    /* tax collected is tax on sales; the tax on a receipt is input tax */
    if ((k === 'sale' || k === 'refund') && String(t.tax_amount || '') !== '') taxTotal += num_(t.tax_amount);

    var items = [];
    try { items = JSON.parse(t.items_json || '[]'); } catch (_) {}
    var itemSummary = items
      .map(function (it) { return String(it.quantity || 1) + 'x ' + String(it.name || ''); })
      .join(' | ');
    var costTotal = 0;
    for (var itx = 0; itx < items.length; itx++) costTotal += num_(items[itx].unitCost) * (items[itx].quantity || 1);
    /* stock bought is not cost of goods sold: only what was sold is */
    if (k === 'refund') costTotalDay -= costTotal;
    else if (k !== 'purchase' && !SERVER_ONLY_KINDS[k]) costTotalDay += costTotal;
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
      else if (isCashOutKind_(k) || SERVER_ONLY_KINDS[k]) gp = 0;
      else if (saleNetExTax_(t) != null) gp = round2_(saleNetExTax_(t) - costTotal);
      if (gp != null) gpDay += gp;
      row.push(String(costTotal));
      row.push(gp == null ? '' : String(gp));
    }
    csv += row.join(',') + '\n';
  }

  /* Cash summary block appended after the detail rows so managers/admins
     can reconcile drawer cash in one glance. */
  var net = sales - refunds - payouts - pickups - expenses + collections;
  csv += '\n';
  csv += ',,SUMMARY,,,,\n';
  csv += ',,SALES,,' + String(sales) + ',\n';
  csv += ',,TAX COLLECTED,,' + String(taxTotal) + ',\n';
  csv += ',,REFUNDS,,' + String(refunds) + ',\n';
  csv += ',,PAID OUT,,' + String(payouts) + ',\n';
  csv += ',,CASH PICK-UP,,' + String(pickups) + ',\n';
  csv += ',,STAFF EXPENSE,,' + String(expenses) + ',\n';
  csv += ',,COLLECTIONS,,' + String(collections) + ',\n';
  csv += ',,DEPOSITS IN,,' + String(round2_(depositsIn)) + ',\n';
  csv += ',,DEPOSITS APPLIED,,' + String(round2_(depositsApplied)) + ',\n';
  csv += ',,DEPOSITS REFUNDED,,' + String(round2_(depositsRefunded)) + ',\n';
  csv += ',,TRADE-INS BOUGHT,,' + String(round2_(tradeIns)) + ',\n';
  csv += ',,SUPPLIERS PAID,,' + String(round2_(supplierPaid)) + ',\n';
  csv += ',,CARD,,' + String(round2_(cardTotal)) + ',\n';
  csv += ',,CASH IN DRAWER,,' + String(round2_(cashDrawer)) + ',\n';
  csv += ',,NET CASH,,' + String(net) + ',\n';
  if (isStore) {
    csv += ',,TOTAL COST,,' + String(costTotalDay) + ',\n';
    csv += ',,GROSS PROFIT,,' + String(gpDay) + ',\n';
  }
  csv += ',,TRANSACTIONS,,' + String(dayRows.length) + ',\n';

  var folder = getDriveFolder_();
  var suffix = isStore ? '' : '-' + ownerId.slice(0, 8);
  var file = folder.createFile('orison-pos-sales-' + day + suffix + '.csv', csv, MimeType.CSV);
  logAudit_(session, 'export.drive', 'export', file.getId(),
    file.getName() + ' — ' + dayRows.length + ' transaction(s), ' + (isStore ? 'whole store' : 'own rows'), payload && payload.deviceId);
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

/* What a sale earned before tax: its line subtotal, less the order discount,
   less the tax when prices included it. In cents throughout - the old inline
   form rounded the order discount to whole currency units. Null for legacy
   rows with no stored subtotal. */
function saleNetExTax_(t) {
  if (String(t.subtotal == null ? '' : t.subtotal) === '') return null;
  var subC = cents_(t.subtotal);
  var netC = subC - Math.round(subC * clampPct_(num_(t.discount_pct)) / 100);
  if (String(t.tax_inclusive) === '1') netC -= cents_(t.tax_amount);
  return netC / 100;
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
/* `inclusive`: shelf prices already contain the tax (UAE VAT). The customer
   pays the shelf price; the tax is the part of it that is tax,
   gross x rate / (100 + rate). Otherwise tax is added on top (US sales tax). */
function saleTotals_(lines, orderPct, taxRate, inclusive) {
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
  var taxC = inclusive
    ? Math.round(taxBasisC * rate / (100 + rate))
    : Math.round(taxBasisC * rate / 100);
  var grandC = inclusive ? subC - orderC : subC - orderC + taxC;
  return {
    inclusive: !!inclusive,
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