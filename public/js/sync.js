'use strict';

/* Sync engine: push the local outbox (offline-safe), pull catalog/config from
   the server, and notify the UI on state changes. Mirrors the "append-only
   sync_outbox" pattern from the architecture doc. */

import { idb } from './db.js';
import { api } from './api.js';
import { toast, beep } from './ui.js';

export const SYNC_EVENT = 'orison:sync';

function emit(detail) {
  window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail }));
}

function meta() {
  return (idb.get('meta', 'config') || Promise.resolve(null)).then((m) => m || {});
}

async function getDeviceId() {
  const m = await meta();
  if (!m.deviceId) {
    m.deviceId = (crypto.randomUUID ? crypto.randomUUID() : 'dev-' + Math.random().toString(36).slice(2));
    await idb.put('meta', m, 'config');
  }
  return m.deviceId;
}

export async function setServerUrl(url) {
  const m = await meta();
  m.serverUrl = url || '';
  await idb.put('meta', m, 'config');
}

export async function setAppToken(token) {
  const m = await meta();
  m.appToken = token || '';
  await idb.put('meta', m, 'config');
}

export async function setSyncInterval(minutes) {
  const m = await meta();
  m.syncIntervalMin = Math.max(1, Number(minutes) || 30);
  await idb.put('meta', m, 'config');
  window.dispatchEvent(new CustomEvent('orison:sync-interval'));
}

export async function getSyncState() {
  const m = await meta();
  const outbox = await idb.getAll('outbox');
  const pending = outbox.filter((o) => o.status === 'PENDING').length;
  return {
    deviceId: m.deviceId || null,
    lastSyncAt: m.lastSyncAt || null,
    pending,
    online: navigator.onLine,
  };
}

export async function pull() {
  const data = await api.get('/api/sync/pull');
  if (!data || !data.products) throw new Error('Empty sync response');

  await idb.bulkPut('products', data.products, (p) => p.id);
  await idb.bulkPut('users', data.users, (u) => u.id);
  await idb.put('meta', {
    ...(await meta()),
    store: data.store,
    watermark: data.watermark || new Date().toISOString(),
    lastSyncAt: new Date().toISOString(),
  }, 'config');

  emit({ kind: 'pull', products: data.products.length });
  return data;
}

export async function mergeProductLocal(product) {
  await idb.put('products', product, product.id);
  emit({ kind: 'product', product });
}

export async function push() {
  const deviceId = await getDeviceId();
  const outbox = await idb.getAll('outbox');
  const pending = outbox
    .filter((o) => o.status === 'PENDING' && (o.attempts || 0) < 6)
    .map((o) => o.payload);

  if (!pending.length) {
    await touchMeta();
    return { pushed: 0, voided: 0 };
  }

  let res;
  try {
    res = await api.post('/api/sync/push', { deviceId, batch: pending });
  } catch (err) {
    if (err && err.offline) {
      emit({ kind: 'offline', pending: pending.length });
      return { pushed: 0, voided: 0, offline: true };
    }
    throw err;
  }

  let voided = 0;
  let flagged = 0;
  const results = res.results || [];
  const byClientTxId = {};
  for (const r of results) byClientTxId[r.clientTxId] = r;

  for (const entry of outbox.filter((o) => o.status === 'PENDING')) {
    const r = byClientTxId[entry.payload.clientTxId];
    if (!r) continue;
    if (r.accepted) {
      const flags = (r.conflicts || [])
        .map((c) => c.conflictId ? c.reason : null)
        .filter(Boolean);
      if (flags.length) flagged += 1;
      await idb.put('outbox', { ...entry, status: 'SYNCED', serverId: r.transactionId, flags }, entry.clientTxId);
      await markTransaction(entry.clientTxId, { status: 'SYNCED', serverId: r.transactionId, flags });
    } else {
      voided += 1;
      await restoreLocalStock(entry.payload);
      await idb.put('outbox', {
        ...entry,
        status: 'VOIDED',
        voidedAt: new Date().toISOString(),
        reason: (r.conflicts || []).map((c) => `${c.serialNumber || ''} ${c.reason}`.trim()).join(', ') || r.reason || 'rejected',
      }, entry.clientTxId);
      await markTransaction(entry.clientTxId, { status: 'VOIDED', voidReason: 'Server rejected sale' });
    }
  }

  await touchMeta();
  if (flagged > 0) emit({ kind: 'conflict', flagged });
  emit({ kind: 'push', pushed: results.filter((r) => r.accepted).length, voided });
  return { pushed: results.filter((r) => r.accepted).length, voided, flagged };
}

async function touchMeta() {
  const m = await meta();
  m.lastSyncAt = new Date().toISOString();
  await idb.put('meta', m, 'config');
}

async function markTransaction(clientTxId, patch) {
  const t = await idb.get('transactions', clientTxId);
  if (t) await idb.put('transactions', { ...t, ...patch }, clientTxId);
}

async function restoreLocalStock(payload) {
  for (const item of payload.items || []) {
    const prod = await idb.get('products', item.productId);
    if (!prod) continue;
    if (prod.isSerialized) {
      if (item.serialNumber && !prod.serials.includes(item.serialNumber)) {
        prod.serials.push(item.serialNumber);
      }
    } else {
      prod.onHand = (prod.onHand || 0) + (item.quantity || 1);
    }
    await idb.put('products', prod, prod.id);
  }
  emit({ kind: 'stock-restored' });
}

export async function enqueueTransaction(tx) {
  const clientTxId = crypto.randomUUID ? crypto.randomUUID() : 'tx-' + Date.now();
  const payload = {
    clientTxId,
    userId: tx.userId,
    deviceId: await getDeviceId(),
    grandTotal: tx.grandTotal,
    tenders: tx.tenders,
    note: tx.note || '',
    createdAt: tx.createdAt || new Date().toISOString(),
    items: tx.items,
  };
  await idb.put('outbox', {
    clientTxId,
    payload,
    status: 'PENDING',
    attempts: 0,
    createdAt: payload.createdAt,
  }, clientTxId);
  await idb.put('transactions', {
    id: clientTxId,
    status: 'PENDING',
    items: tx.items,
    tenders: tx.tenders,
    total: tx.grandTotal,
    cashier: tx.cashier,
    userId: tx.userId,
    createdAt: payload.createdAt,
  }, clientTxId);
  emit({ kind: 'queued', clientTxId });
  return clientTxId;
}

export async function outboxStats() {
  const outbox = await idb.getAll('outbox');
  return {
    pending: outbox.filter((o) => o.status === 'PENDING').length,
    synced: outbox.filter((o) => o.status === 'SYNCED').length,
    voided: outbox.filter((o) => o.status === 'VOIDED').length,
  };
}

/* Push the local outbox right now, but only when connected. Prefer this over
   syncNow() at sale completion: no pull round-trip, no toast, just ship the
   just-completed sale. Offline devices skip it and catch up via the online
   event + the periodic window. */
export async function pushImmediate() {
  if (!navigator.onLine) return { pushed: 0, voided: 0, offline: true };
  return push();
}

export async function syncNow() {
  let pulled = false;
  try {
    if (navigator.onLine) {
      await pull();
      pulled = true;
    }
  } catch (err) { /* offline or server down */ }

  try {
    const res = await push();
    if (!pulled && res && res.pushed) pulled = true;
  } catch (err) {
    emit({ kind: 'offline', pending: (await outboxStats()).pending });
    return { offline: true };
  }

  if (pulled) {
    const stats = await outboxStats();
    if (stats.pending === 0) {
      toast('Synced', 'ok', 1800);
      beep('ok');
    }
    return stats;
  }
  return null;
}