// Paths are arrays of segments: strings for object keys, numbers for array indices.
// Every structural edit is copy-on-write so undo/redo can keep old roots around cheaply.

const IDENT = /^[A-Za-z_$][\w$]*$/;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export const keyOf = segs => JSON.stringify(segs);

export function toJSONPath(segs) {
  let p = '$';
  for (const s of segs) {
    if (typeof s === 'number') p += `[${s}]`;
    else if (IDENT.test(s)) p += '.' + s;
    else p += `['${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`;
  }
  return p;
}

export function toPointer(segs) {
  return segs.map(s => '/' + String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('');
}

export function toBracket(segs) {
  return '$' + segs.map(s => (typeof s === 'number' ? `[${s}]` : `[${JSON.stringify(s)}]`)).join('');
}

export function toJS(segs, root = 'data') {
  let p = root;
  for (const s of segs) {
    if (typeof s === 'number') p += `[${s}]`;
    else if (IDENT.test(s)) p += '.' + s;
    else p += `[${JSON.stringify(s)}]`;
  }
  return p;
}

export function fromPointer(ptr) {
  if (ptr === '' || ptr === '/') return [];
  return ptr.replace(/^\//, '').split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function getAt(root, segs) {
  let cur = root;
  for (const s of segs) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      if (typeof s !== 'number' || s < 0 || s >= cur.length) return undefined;
    } else if (!hasOwn(cur, s)) return undefined;
    cur = cur[s];
  }
  return cur;
}

export const isPrefix = (a, b) => a.length <= b.length && a.every((s, i) => s === b[i]);

function put(obj, k, v) {
  if (k === '__proto__') Object.defineProperty(obj, k, { value: v, writable: true, enumerable: true, configurable: true });
  else obj[k] = v;
}

function shallow(v) {
  if (Array.isArray(v)) return v.slice();
  const o = {};
  for (const k of Object.keys(v)) put(o, k, v[k]);
  return o;
}

/** Returns a new root where the value at `segs` is replaced by fn(oldValue). */
export function updateAt(root, segs, fn) {
  if (!segs.length) return fn(root);
  const [h, ...rest] = segs;
  if (root === null || typeof root !== 'object') throw new Error('Path does not exist');
  const copy = shallow(root);
  put(copy, h, updateAt(root[h], rest, fn));
  return copy;
}

export const setAt = (root, segs, value) => updateAt(root, segs, () => value);

export function deleteAt(root, segs) {
  if (!segs.length) throw new Error('Cannot delete the root');
  const key = segs[segs.length - 1];
  return updateAt(root, segs.slice(0, -1), parent => {
    if (Array.isArray(parent)) { const c = parent.slice(); c.splice(key, 1); return c; }
    const o = {};
    for (const k of Object.keys(parent)) if (k !== key) put(o, k, parent[k]);
    return o;
  });
}

export function renameKey(root, segs, newKey) {
  const oldKey = segs[segs.length - 1];
  return updateAt(root, segs.slice(0, -1), parent => {
    if (Array.isArray(parent)) throw new Error('Array items have no key to rename');
    if (newKey !== oldKey && hasOwn(parent, newKey)) throw new Error(`Key "${newKey}" already exists`);
    const o = {};
    for (const k of Object.keys(parent)) put(o, k === oldKey ? newKey : k, parent[k]);
    return o;
  });
}

/** Insert into a container. For arrays `key` is an index (default: append); for objects it must be new. */
export function insertAt(root, parentSegs, key, value, afterKey) {
  return updateAt(root, parentSegs, parent => {
    if (Array.isArray(parent)) {
      const c = parent.slice();
      c.splice(key == null ? c.length : key, 0, value);
      return c;
    }
    if (parent === null || typeof parent !== 'object') throw new Error('Can only add children to objects or arrays');
    if (hasOwn(parent, key)) throw new Error(`Key "${key}" already exists`);
    const o = {};
    const keys = Object.keys(parent);
    if (afterKey === undefined) { for (const k of keys) put(o, k, parent[k]); put(o, key, value); }
    else for (const k of keys) { put(o, k, parent[k]); if (k === afterKey) put(o, key, value); }
    return o;
  });
}

export function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v === null || typeof v !== 'object') return v;
  const o = {};
  for (const k of Object.keys(v).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) put(o, k, sortKeysDeep(v[k]));
  return o;
}
