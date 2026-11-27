export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);

export function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
export const isContainer = v => v !== null && typeof v === 'object';
export const sizeOf = v => (Array.isArray(v) ? v.length : Object.keys(v).length);

export function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
export const fmtNum = n => n.toLocaleString('en-US');
export const byteLength = s => new Blob([s]).size;

export function relTime(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(s) < 60) return rtf.format(-s, 'second');
  if (Math.abs(s) < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (Math.abs(s) < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (Math.abs(s) < 86400 * 30) return rtf.format(-Math.round(s / 86400), 'day');
  if (Math.abs(s) < 86400 * 365) return rtf.format(-Math.round(s / 86400 / 30), 'month');
  return rtf.format(-Math.round(s / 86400 / 365), 'year');
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const cmpKeys = collator.compare;

export function childEntries(v, sort = 'original') {
  if (Array.isArray(v)) return v.map((x, i) => [i, x]);
  const keys = Object.keys(v);
  if (sort === 'asc') keys.sort(cmpKeys);
  else if (sort === 'desc') keys.sort((a, b) => cmpKeys(b, a));
  return keys.map(k => [k, v[k]]);
}

export function stats(root) {
  const counts = { object: 0, array: 0, string: 0, number: 0, boolean: 0, null: 0 };
  let total = 0, depth = 0;
  const stack = [[root, 0]];
  while (stack.length) {
    const [v, d] = stack.pop();
    const t = typeOf(v);
    counts[t]++; total++;
    if (d > depth) depth = d;
    if (t === 'array') for (let i = v.length - 1; i >= 0; i--) stack.push([v[i], d + 1]);
    else if (t === 'object') for (const k in v) stack.push([v[k], d + 1]);
  }
  return { counts, total, depth };
}

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
/** Syntax-highlight JSON text (tokens are escaped individually). */
export function highlightJSON(text) {
  let out = '', last = 0, m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    out += esc(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out += m[2] !== undefined
        ? `<span class="tk">${esc(m[1])}</span>${m[2]}`
        : `<span class="ts">${esc(m[1])}</span>`;
    } else if (m[3] !== undefined) out += `<span class="tb">${m[0]}</span>`;
    else if (m[0] === 'null') out += `<span class="tz">null</span>`;
    else out += `<span class="tn">${m[0]}</span>`;
    last = TOKEN.lastIndex;
  }
  return out + esc(text.slice(last));
}

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16) + ':' + str.length;
}

export function flattenObject(v, prefix = '', out = {}) {
  for (const k of Object.keys(v)) {
    const x = v[k];
    if (x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length) flattenObject(x, prefix + k + '.', out);
    else out[prefix + k] = x;
  }
  return out;
}

export function preview(v, max = 80) {
  const t = typeOf(v);
  if (t === 'string') { const s = JSON.stringify(v.length > max ? v.slice(0, max) + '…' : v); return s; }
  if (t === 'object' || t === 'array') {
    const s = JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + '…' : s;
  }
  return String(v);
}

export const store = {
  get(k, d) { try { const v = localStorage.getItem('jip:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('jip:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';
