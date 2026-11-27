// Parsing: strict JSON first (fast native path), then JSON Lines, then a tolerant
// parser that repairs JSON5-ish input (comments, trailing commas, quotes, …).

export class ParseError extends Error {
  constructor(message, pos) { super(message); this.pos = pos; }
}

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function put(obj, k, v) {
  if (k === '__proto__') Object.defineProperty(obj, k, { value: v, writable: true, enumerable: true, configurable: true });
  else obj[k] = v;
}

const NUM_STRICT = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const NUM_LOOSE = /[+-]?(?:0[xX][0-9a-fA-F]+|Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/y;
const IDENT = /[A-Za-z_$][\w$]*/y;
const KEY_LOOSE = /[^\s:,{}[\]"']+/y;
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/** Recursive-descent parser. strict=true follows RFC 8259 and reports precise error positions. */
export function parseText(text, strict = false) {
  let i = 0;
  const n = text.length;
  const fixes = new Set();
  const fail = (msg, at = i) => { throw new ParseError(msg, at); };

  function ws() {
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 10 || c === 13 || c === 9) { i++; continue; }
      if (!strict) {
        if (c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029) { i++; continue; }
        if (c === 47 && text[i + 1] === '/') { fixes.add('comments'); while (i < n && text[i] !== '\n') i++; continue; }
        if (c === 47 && text[i + 1] === '*') {
          fixes.add('comments');
          const e = text.indexOf('*/', i + 2);
          if (e < 0) fail('Unterminated block comment');
          i = e + 2; continue;
        }
        if (c === 35) { fixes.add('comments'); while (i < n && text[i] !== '\n') i++; continue; }
      }
      return;
    }
  }

  function string(q) {
    const open = i;
    let out = '';
    i++;
    let start = i;
    for (;;) {
      if (i >= n) fail('Unterminated string', open);
      const c = text[i];
      if (c === q) { out += text.slice(start, i); i++; return out; }
      if (c === '\\') {
        out += text.slice(start, i);
        const e = text[i + 1];
        if (e === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid \\u escape sequence');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else if (e in ESCAPES) { out += ESCAPES[e]; i += 2; }
        else {
          if (strict) fail(`Invalid escape sequence "\\${e ?? ''}"`);
          fixes.add('invalid escapes');
          if (e === '\n') { i += 2; } else if (e === '\r') { i += text[i + 2] === '\n' ? 3 : 2; } else { out += e ?? ''; i += 2; }
        }
        start = i;
        continue;
      }
      if (text.charCodeAt(i) < 32) {
        if (strict) fail('Unescaped control character in string (newlines and tabs must be escaped)');
        fixes.add('raw control characters');
      }
      i++;
    }
  }

  function number() {
    const re = strict ? NUM_STRICT : NUM_LOOSE;
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) fail('Invalid number');
    const s = m[0];
    i += s.length;
    if (strict) return Number(s);
    NUM_STRICT.lastIndex = 0;
    const exact = NUM_STRICT.exec(s);
    if (!exact || exact[0] !== s) fixes.add('non-standard numbers');
    if (/^[+-]?0[xX]/.test(s)) return (s[0] === '-' ? -1 : 1) * parseInt(s.replace(/^[+-]/, ''), 16);
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  }

  function value() {
    ws();
    if (i >= n) fail('Unexpected end of input');
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string('"');
    if (c === "'" && !strict) { fixes.add('single quotes'); return string("'"); }
    if (c === '-' || (c >= '0' && c <= '9') || (!strict && (c === '+' || c === '.'))) return number();
    IDENT.lastIndex = i;
    const m = IDENT.exec(text);
    if (m) {
      const id = m[0];
      if (id === 'true') { i += 4; return true; }
      if (id === 'false') { i += 5; return false; }
      if (id === 'null') { i += 4; return null; }
      if (!strict) {
        const lit = { True: true, False: false, None: null, undefined: null, NaN: null, Infinity: null };
        if (hasOwn(lit, id)) { fixes.add('non-JSON literals'); i += id.length; return lit[id]; }
      }
      fail(`Unexpected token "${id}"`);
    }
    if (c === "'") fail('Strings must use double quotes');
    fail(`Unexpected character ${JSON.stringify(c)}`);
  }

  function object() {
    const obj = {};
    i++;
    ws();
    if (text[i] === '}') { i++; return obj; }
    for (;;) {
      ws();
      let key;
      const c = text[i];
      if (c === '"') key = string('"');
      else if (!strict && c === "'") { fixes.add('single quotes'); key = string("'"); }
      else if (!strict && i < n && c !== '}' && c !== ',') {
        KEY_LOOSE.lastIndex = i;
        const m = KEY_LOOSE.exec(text);
        if (!m) fail('Expected a property name');
        key = m[0]; i += key.length; fixes.add('unquoted keys');
      } else if (c === "'") fail('Property names must use double quotes');
      else if (c === '}') fail('Trailing comma before "}" is not allowed');
      else if (i >= n) fail('Unexpected end of input — missing "}"');
      else fail('Expected a double-quoted property name');
      ws();
      if (text[i] !== ':') fail(`Expected ":" after property name "${key}"`);
      i++;
      put(obj, key, value());
      ws();
      const d = text[i];
      if (d === ',') {
        i++; ws();
        if (text[i] === '}') {
          if (strict) fail('Trailing comma before "}" is not allowed');
          fixes.add('trailing commas'); i++; return obj;
        }
        continue;
      }
      if (d === '}') { i++; return obj; }
      if (!strict && i < n && /["'A-Za-z_$]/.test(d)) { fixes.add('missing commas'); continue; }
      if (i >= n) fail('Unexpected end of input — missing "}"');
      fail('Expected "," or "}" after property value');
    }
  }

  function array() {
    const arr = [];
    i++;
    ws();
    if (text[i] === ']') { i++; return arr; }
    for (;;) {
      arr.push(value());
      ws();
      const d = text[i];
      if (d === ',') {
        i++; ws();
        if (text[i] === ']') {
          if (strict) fail('Trailing comma before "]" is not allowed');
          fixes.add('trailing commas'); i++; return arr;
        }
        continue;
      }
      if (d === ']') { i++; return arr; }
      if (!strict && i < n && /[{["'\d\-tfnTFN]/.test(d)) { fixes.add('missing commas'); continue; }
      if (i >= n) fail('Unexpected end of input — missing "]"');
      fail('Expected "," or "]" after array item');
    }
  }

  const v = value();
  ws();
  if (i < n) fail('Unexpected content after the end of the JSON value');
  return { value: v, fixes };
}

function lossyIntegers(src) {
  if (!/\d{16,}/.test(src)) return 0;
  let lossy = 0;
  try {
    JSON.parse(src, function (k, v, ctx) {
      if (typeof v === 'number' && ctx && typeof ctx.source === 'string' && /^-?\d+$/.test(ctx.source) && !Number.isSafeInteger(v)) lossy++;
      return v;
    });
  } catch { /* ignore */ }
  return lossy;
}

function tryNDJSON(src) {
  if (src.indexOf('\n') < 0) return null;
  const out = [];
  for (const line of src.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { return null; }
  }
  return out.length > 1 ? out : null;
}

export function lineCol(text, pos) {
  let line = 1, last = -1;
  for (let i = 0; i < pos && i < text.length; i++) if (text.charCodeAt(i) === 10) { line++; last = i; }
  return { line, col: pos - last };
}

function hintFor(msg) {
  if (/Trailing comma/.test(msg)) return 'Remove the comma after the last item, or press "Repair" to fix it automatically.';
  if (/double quotes|double-quoted/.test(msg)) return 'JSON requires double quotes ("…") around strings and property names.';
  if (/control character/.test(msg)) return 'Line breaks and tabs inside strings must be written as \\n and \\t.';
  if (/Expected "," or/.test(msg)) return 'Often caused by a missing comma, or an unescaped " inside a string (write it as \\").';
  if (/end of input/.test(msg)) return 'The JSON looks truncated or has unclosed brackets.';
  if (/Unexpected token "(undefined|NaN|Infinity|True|False|None)"/.test(msg)) return 'That literal is not valid JSON — use null, true or false.';
  return '';
}

export function describeError(text, err) {
  const pos = err && typeof err.pos === 'number' ? err.pos : null;
  const message = err ? err.message : 'Invalid JSON';
  if (pos === null) return { message, hint: hintFor(message) };
  const { line, col } = lineCol(text, pos);
  const lines = text.split('\n');
  const ctx = [];
  for (let l = Math.max(1, line - 2); l <= line; l++) {
    const raw = (lines[l - 1] ?? '').replace(/\t/g, ' ').replace(/\r$/, '');
    const start = l === line ? Math.max(0, col - 60) : 0;
    ctx.push({ n: l, text: (start ? '…' : '') + raw.slice(start, start + 110), caret: l === line ? col - 1 - start + (start ? 1 : 0) : -1 });
  }
  return { message, line, col, pos, context: ctx, hint: hintFor(message) };
}

/**
 * Parse arbitrary user input.
 * → { ok: true, data, format: 'json' | 'ndjson' | 'repaired', warnings: string[] }
 * → { ok: false, error: { message, line?, col?, context?, hint } }
 */
export function smartParse(text) {
  let src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!src.trim()) return { ok: false, error: { message: 'Input is empty', hint: '' } };
  try {
    const data = JSON.parse(src);
    const lossy = lossyIntegers(src);
    return { ok: true, data, format: 'json', warnings: lossy ? [`${lossy} large integer${lossy > 1 ? 's' : ''} exceed JavaScript's safe range and may have lost precision.`] : [] };
  } catch { /* fall through */ }

  const nd = tryNDJSON(src);
  if (nd) return { ok: true, data: nd, format: 'ndjson', warnings: [`Parsed ${nd.length} lines as JSON Lines.`] };

  let strictErr = null;
  try { parseText(src, true); } catch (e) { strictErr = e; }

  const attempts = [src];
  const jsonp = /^\s*[\w$.]+\s*\(([\s\S]*)\)\s*;?\s*$/.exec(src);
  if (jsonp) attempts.unshift(jsonp[1]);
  const assign = /^\s*(?:(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=|module\.exports\s*=|export\s+default)\s*([\s\S]*?);?\s*$/.exec(src);
  if (assign) attempts.unshift(assign[1]);

  for (const attempt of attempts) {
    try {
      const { value, fixes } = parseText(attempt, false);
      if (attempt !== src) fixes.add(jsonp && attempt === jsonp[1] ? 'JSONP wrapper' : 'JavaScript assignment');
      return { ok: true, data: value, format: 'repaired', warnings: [`Input wasn't strict JSON — repaired: ${[...fixes].join(', ') || 'formatting'}.`] };
    } catch { /* try next */ }
  }
  return { ok: false, error: describeError(src, strictErr) };
}
