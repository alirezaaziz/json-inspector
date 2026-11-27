import { query } from './jsonpath.js';
import { childEntries, typeOf } from './util.js';
import { keyOf } from './path.js';

export const MAX_MATCHES = 10000;

/**
 * Find nodes matching a text query (keys and primitive values) or a JSONPath expression (starting with "$").
 * → { matches: segs[], truncated, error, mode }
 */
export function findMatches(root, q, { caseSensitive = false, regex = false, scope = 'all', sort = 'original' } = {}) {
  q = q.trim();
  if (!q) return { matches: [], truncated: false, error: null, mode: 'text' };

  if (q.startsWith('$')) {
    try {
      const res = query(root, q);
      return { matches: res.slice(0, MAX_MATCHES).map(r => r.segs), truncated: res.length > MAX_MATCHES, error: null, mode: 'jsonpath' };
    } catch (e) {
      return { matches: [], truncated: false, error: e.message, mode: 'jsonpath' };
    }
  }

  let test;
  if (regex) {
    let re;
    try { re = new RegExp(q, caseSensitive ? '' : 'i'); } catch (e) { return { matches: [], truncated: false, error: e.message, mode: 'regex' }; }
    test = s => re.test(s);
  } else if (caseSensitive) test = s => s.includes(q);
  else { const ql = q.toLowerCase(); test = s => s.toLowerCase().includes(ql); }

  const matches = [];
  let truncated = false;
  const walk = (v, segs, key) => {
    if (matches.length >= MAX_MATCHES) { truncated = true; return; }
    const t = typeOf(v);
    let hit = false;
    if (scope !== 'values' && typeof key === 'string' && test(key)) hit = true;
    if (!hit && scope !== 'keys' && t !== 'object' && t !== 'array') hit = test(t === 'string' ? v : String(v));
    if (hit) matches.push(segs);
    if (t === 'object' || t === 'array') for (const [k, c] of childEntries(v, sort)) walk(c, [...segs, k], k);
  };
  walk(root, [], null);
  return { matches, truncated, error: null, mode: regex ? 'regex' : 'text' };
}

/** Ids of every match and each of its ancestors — used by filter mode. */
export function visibleSet(matches) {
  const ids = new Set();
  for (const segs of matches) for (let i = 0; i <= segs.length; i++) ids.add(keyOf(segs.slice(0, i)));
  return ids;
}
