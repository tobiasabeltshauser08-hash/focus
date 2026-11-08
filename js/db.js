// Speicher im Browser (IndexedDB): Sessions und ihre Videostücke bzw. Zeitraffer-Bilder
const NAME = "focus", VERSION = 1;
let dbp = null;

function open() {
  return dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("sessions", { keyPath: "id" });
      d.createObjectStore("chunks", { keyPath: ["sid", "n"] });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function tx(store, mode, fn) {
  return open().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const range = sid => IDBKeyRange.bound([sid, 0], [sid, Number.MAX_SAFE_INTEGER]);

export const put = (store, value) => tx(store, "readwrite", s => s.put(value));
export const get = (store, key) => tx(store, "readonly", s => s.get(key));
export const all = store => tx(store, "readonly", s => s.getAll());
export const del = (store, key) => tx(store, "readwrite", s => s.delete(key));
export const chunks = sid => tx("chunks", "readonly", s => s.getAll(range(sid)));
export const delChunks = sid => tx("chunks", "readwrite", s => s.delete(range(sid)));
