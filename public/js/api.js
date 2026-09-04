'use strict';

/* API client + auth token handling for Orison POS.
   Talks to the Google Apps Script Web App backend. Every request is a POST
   carrying { action, method, params, payload, appToken, session }. The
   response is an envelope { ok, data } or { ok:false, status, error }.

   Everything here treats the network as optional: callers decide whether the
   request is a hard requirement (login, admin) or best-effort (sync). */

import { idb } from './db.js';

async function getConfig() {
  return (await idb.get('meta', 'config')) || {};
}

async function getBaseUrl() {
  const m = await getConfig();
  return m.serverUrl || '';
}

async function getToken() {
  const m = await getConfig();
  return m.token || null;
}

async function getAppToken() {
  const m = await getConfig();
  return m.appToken || '';
}

async function setToken(token) {
  const m = await getConfig();
  m.token = token;
  await idb.put('meta', m, 'config');
}

async function clearToken() {
  const m = await getConfig();
  delete m.token;
  delete m.user;
  await idb.put('meta', m, 'config');
}

async function request(path, { method = 'GET', body, timeout = 15000 } = {}) {
  const base = await getBaseUrl();
  const token = await getToken();
  const appToken = await getAppToken();

  const [action, query = ''] = path.split('?');
  const params = {};
  for (const [k, v] of new URLSearchParams(query)) params[k] = v;

  const envelope = {
    action,
    method,
    params,
    payload: body || null,
    appToken,
    session: token,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(envelope),
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
    if (data && data.ok === false) {
      const err = new Error(data.error || 'Request failed');
      err.status = data.status || 400;
      err.data = data;
      throw err;
    }
    return data ? data.data : data;
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
  getAppToken,
};

export { api };