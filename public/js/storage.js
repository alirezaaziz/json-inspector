// Recent documents, kept locally in IndexedDB (metadata and bodies in separate stores
// so listing stays cheap even when documents are large).
import { fnv1a } from './util.js';

const DB = 'json-inspector', META = 'meta', BODY = 'body';
const MAX_ITEMS = 20, MAX_CHARS = 20_000_000;

let dbp;
function db() {
  if (!dbp) {
    dbp = new Promise(resolve => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore(META, { keyPath: 'id', autoIncrement: true });
          r.result.createObjectStore(BODY);
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbp;
}

const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

export async function listRecent() {
  const d = await db();
  if (!d) return [];
  const all = await req(d.transaction(META).objectStore(META).getAll());
  return all.sort((a, b) => b.ts - a.ts);
}

export async function getRecentText(id) {
  const d = await db();
  return d ? req(d.transaction(BODY).objectStore(BODY).get(id)) : null;
}

/** Saves (or refreshes) a document; returns its id, or null if it was not stored. */
export async function saveRecent({ id, name, text, format }) {
  const d = await db();
  if (!d || text.length > MAX_CHARS) return null;
  const hash = fnv1a(text);
  const items = await listRecent();
  const existing = id != null ? items.find(x => x.id === id) : items.find(x => x.hash === hash);
  const meta = { name, format, hash, size: text.length, ts: Date.now() };
  if (existing) meta.id = existing.id;
  const t = d.transaction([META, BODY], 'readwrite');
  const newId = await req(t.objectStore(META).put(meta));
  t.objectStore(BODY).put(text, newId);
  await done(t);
  const extra = (await listRecent()).slice(MAX_ITEMS);
  for (const x of extra) await deleteRecent(x.id);
  return newId;
}

export async function deleteRecent(id) {
  const d = await db();
  if (!d) return;
  const t = d.transaction([META, BODY], 'readwrite');
  t.objectStore(META).delete(id);
  t.objectStore(BODY).delete(id);
  await done(t);
}

export async function clearRecent() {
  const d = await db();
  if (!d) return;
  const t = d.transaction([META, BODY], 'readwrite');
  t.objectStore(META).clear();
  t.objectStore(BODY).clear();
  await done(t);
}
