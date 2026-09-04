'use strict';

/* IndexedDB layer for Orison POS. All local store data lives here, so the
   terminal keeps working with zero network connectivity. */

const DB_NAME = 'orison-pos';
const DB_VERSION = 1;

const STORES = ['meta', 'users', 'products', 'config', 'transactions', 'outbox'];

let _dbPromise = null;

function open() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
      const products = req.transaction.objectStore('products');
      if (!products.indexNames.contains('by_upc')) products.createIndex('by_upc', 'upc');
      if (!products.indexNames.contains('by_sku')) products.createIndex('by_sku', 'sku');
      if (!products.indexNames.contains('by_category')) products.createIndex('by_category', 'category');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function storeRef(store, mode = 'readonly') {
  return open().then((db) => {
    const t = db.transaction(store, mode);
    return { store: t.objectStore(store), t };
  });
}

function reqAsPromise(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const idb = {
  get(store, key) {
    return storeRef(store).then(({ store: os }) => reqAsPromise(os.get(key)));
  },
  getAll(store) {
    return storeRef(store).then(({ store: os }) => reqAsPromise(os.getAll()));
  },
  put(store, value, key) {
    return storeRef(store, 'readwrite').then(({ store: os, t }) => {
      os.put(value, key === undefined ? undefined : key);
      return new Promise((resolve, reject) => {
        t.oncomplete = () => resolve(value);
        t.onerror = () => reject(t.error);
      });
    });
  },
  bulkPut(store, values, keyFn) {
    return storeRef(store, 'readwrite').then(({ store: os, t }) => {
      for (const v of values) {
        os.put(v, keyFn ? keyFn(v) : undefined);
      }
      return new Promise((resolve, reject) => {
        t.oncomplete = () => resolve(values.length);
        t.onerror = () => reject(t.error);
      });
    });
  },
  delete(store, key) {
    return storeRef(store, 'readwrite').then(({ store: os, t }) => {
      os.delete(key);
      return new Promise((resolve, reject) => {
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
    });
  },
  clear(store) {
    return storeRef(store, 'readwrite').then(({ store: os, t }) => {
      os.clear();
      return new Promise((resolve, reject) => {
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
    });
  },
  async allByIndex(store, indexName, value) {
    const ref = await storeRef(store);
    const idx = ref.store.index(indexName);
    return reqAsPromise(idx.getAll(value));
  },
};

export { idb, open, STORES };