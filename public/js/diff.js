import { typeOf } from './util.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const DIFF_LIMIT = 5000;
const LCS_CELLS = 4e6;

/**
 * Structural diff. Returns { changes: [{ op: 'add'|'remove'|'change', segs, a, b }], truncated }.
 * arrays: 'smart' aligns array items with LCS so insertions don't cascade; 'index' compares by position.
 */
export function diff(a, b, { arrays = 'smart' } = {}) {
  const out = [];
  walk(a, b, [], out, arrays);
  return { changes: out.slice(0, DIFF_LIMIT), truncated: out.length > DIFF_LIMIT };
}

function walk(a, b, segs, out, mode) {
  if (out.length > DIFF_LIMIT) return;
  const ta = typeOf(a), tb = typeOf(b);
  if (ta !== tb) { out.push({ op: 'change', segs, a, b }); return; }
  if (ta === 'object') {
    for (const k of Object.keys(a)) {
      if (!hasOwn(b, k)) out.push({ op: 'remove', segs: [...segs, k], a: a[k] });
      else walk(a[k], b[k], [...segs, k], out, mode);
    }
    for (const k of Object.keys(b)) if (!hasOwn(a, k)) out.push({ op: 'add', segs: [...segs, k], b: b[k] });
  } else if (ta === 'array') {
    if (mode === 'smart') smartArray(a, b, segs, out, mode);
    else indexArray(a, b, 0, a.length, 0, b.length, segs, out, mode);
  } else if (a !== b) out.push({ op: 'change', segs, a, b });
}

function indexArray(a, b, sa, ea, sb, eb, segs, out, mode) {
  const n = Math.max(ea - sa, eb - sb);
  for (let k = 0; k < n; k++) {
    const i = sa + k, j = sb + k;
    if (i >= ea) out.push({ op: 'add', segs: [...segs, j], b: b[j] });
    else if (j >= eb) out.push({ op: 'remove', segs: [...segs, i], a: a[i] });
    else walk(a[i], b[j], [...segs, i], out, mode);
  }
}

function smartArray(a, b, segs, out, mode) {
  const ha = a.map(x => JSON.stringify(x));
  const hb = b.map(x => JSON.stringify(x));
  let s = 0;
  while (s < a.length && s < b.length && ha[s] === hb[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && ha[ea - 1] === hb[eb - 1]) { ea--; eb--; }
  const m = ea - s, n = eb - s;
  if (!m && !n) return;
  if (m * n > LCS_CELLS) { indexArray(a, b, s, ea, s, eb, segs, out, mode); return; }

  const W = n + 1;
  const dp = new Uint32Array((m + 1) * W);
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i * W + j] = ha[s + i] === hb[s + j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);

  let dels = [], adds = [];
  const flush = () => {
    const k = Math.min(dels.length, adds.length);
    for (let x = 0; x < k; x++) walk(a[dels[x]], b[adds[x]], [...segs, dels[x]], out, mode);
    for (let x = k; x < dels.length; x++) out.push({ op: 'remove', segs: [...segs, dels[x]], a: a[dels[x]] });
    for (let x = k; x < adds.length; x++) out.push({ op: 'add', segs: [...segs, adds[x]], b: b[adds[x]] });
    dels = []; adds = [];
  };
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && ha[s + i] === hb[s + j]) { flush(); i++; j++; }
    else if (j >= n || (i < m && dp[(i + 1) * W + j] >= dp[i * W + j + 1])) { dels.push(s + i); i++; }
    else { adds.push(s + j); j++; }
  }
  flush();
}
