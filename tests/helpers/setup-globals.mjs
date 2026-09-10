'use strict';

/* Browser-global shim for client-side tests.  Loaded via --import before any
   test module so that public/js/*.mjs (which reference window, navigator,
   indexedDB, etc.) can be imported in plain Node. */

import 'fake-indexeddb/auto';

/* ---- window / globalThis bridge ---- */
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;

/* ---- navigator stubs ---- */
if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = { onLine: true, userAgent: 'node-test' };
} else if (typeof globalThis.navigator.onLine === 'undefined') {
  globalThis.navigator.onLine = true;
}

/* ---- document stub (minimal) ---- */
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    getElementById() { return null; },
    createElement(tag) {
      return {
        tagName: tag,
        className: '',
        textContent: '',
        innerHTML: '',
        style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        appendChild() {},
        remove() {},
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        play() { return Promise.resolve(); },
      };
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

/* ---- crypto.randomUUID (Node 20+ has it, but guard for older) ---- */
if (typeof globalThis.crypto === 'undefined') globalThis.crypto = {};
if (typeof globalThis.crypto.randomUUID !== 'function') {
  let _counter = 0;
  globalThis.crypto.randomUUID = () => `test-uuid-${++_counter}`;
}

/* ---- CustomEvent polyfill ---- */
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, opts = {}) {
      super(type);
      this.detail = opts.detail;
    }
  };
}

/* ---- window.dispatchEvent — record dispatched events so tests can assert
   on the orison:sync / sync-interval CustomEvents. ---- */
globalThis.__recordedEvents = [];
globalThis.dispatchEvent = (event) => {
  globalThis.__recordedEvents.push({
    type: event && event.type,
    detail: event && event.detail,
  });
  return true;
};

export function recordedEvents() {
  return globalThis.__recordedEvents;
}

export function clearRecordedEvents() {
  globalThis.__recordedEvents = [];
}

/* ---- AudioContext stub (no-op) ---- */
if (typeof globalThis.AudioContext === 'undefined') {
  globalThis.AudioContext = class AudioContext {
    get state() { return 'running'; }
    resume() {}
    createOscillator() {
      return {
        connect() {},
        start() {},
        stop() {},
        type: '',
        frequency: { setValueAtTime() {} },
      };
    }
    createGain() {
      return {
        connect() {},
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
      };
    }
  };
}

/* ---- requestAnimationFrame stub ---- */
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

/* ---- Helper: create a fresh in-memory IndexedDB and wire up the idb module
   for tests that need a clean database.  Returns the idb object from db.js
   after resetting its cached connection. ---- */
export async function freshDB() {
  // Dynamically import db.js — it will use the globalThis.indexedDB we set up
  // via fake-indexeddb/auto above.
  const db = await import('../../public/js/db.js');
  return db;
}

/* ---- Helper: mock fetch for api.js tests ---- */
let _fetchHandler = null;

export function mockFetch(handler) {
  _fetchHandler = handler;
  globalThis.fetch = async (url, opts) => {
    if (_fetchHandler) return _fetchHandler(url, opts);
    return jsonResponse({});
  };
}

export function clearFetchMock() {
  _fetchHandler = null;
}

/* Browser-fetch-shaped response so api.js (which reads res.headers). */
export function jsonResponse(data, init = {}) {
  return {
    ok: init.status == null || init.status < 400,
    status: init.status || 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

/* Parse the api.js envelope out of a fetch call so mocks can branch on
   env.action (/api/sync/push) and env.payload. */
export function readEnvelope(opts) {
  return JSON.parse(opts.body || '{}');
}

/* ---- Helper: reset navigator.onLine ---- */
export function setOnline(v) {
  globalThis.navigator.onLine = v;
}
