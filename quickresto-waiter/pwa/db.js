// Мини-обёртка над IndexedDB (без зависимостей).
// Хранилища: kv (кэш меню/столов) и orders (очередь заказов, ключ — idempotencyKey).
const IDB = (() => {
  const DB = 'waiter-poc';
  const VER = 1;
  let dbp;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('orders')) db.createObjectStore('orders', { keyPath: 'idempotencyKey' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }

  function tx(store, mode) {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }
  const p = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

  return {
    async kvGet(k) { return p((await tx('kv', 'readonly')).get(k)); },
    async kvSet(k, v) { return p((await tx('kv', 'readwrite')).put(v, k)); },
    async ordPut(o) { return p((await tx('orders', 'readwrite')).put(o)); },
    async ordAll() { return p((await tx('orders', 'readonly')).getAll()); },
  };
})();
