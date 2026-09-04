'use strict';

/* API client + auth token handling for Orison POS.
   Everything here treats the network as optional: callers decide whether the
   request is a hard requirement (login, admin) or best-effort (sync). */

import { idb } from './db.js';

async function getBaseUrl() {
  const meta = await idb.get('meta', 'config');
  if (meta && meta.serverUrl) return meta.serverUrl;
  return '';
}

async function getToken() {
  const meta = await idb.get('meta', 'config');
  return meta && meta.token ? meta.token : null;
}

async function setToken(token) {
  const meta = (await idb.get('meta', 'config')) || {};
  meta.token = token;
  await idb.put('meta', meta, 'config');
}

async function clearToken() {
  const meta = (await idb.get('meta', 'config')) || {};
  delete meta.token;
  delete meta.user;
  await idb.put('meta', meta, 'config');
}

async function request(path, { method = 'GET', body, timeout = 12000 } = {}) {
  const base = await getBaseUrl();
  const token = await getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await res.json() : await res.text();
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('Request timed out (offline?)');
      e.offline = true;
      throw e;
    }
    if (err && err.name === 'TypeError') {
      const e = new Error('Network unreachable (offline)');
      e.offline = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const api = {
  get: (p, o) => request(p, { ...o, method: 'GET' }),
  post: (p, b, o) => request(p, { ...o, method: 'POST', body: b }),
  getBaseUrl,
  getToken,
  setToken,
  clearToken,
};

export { api };