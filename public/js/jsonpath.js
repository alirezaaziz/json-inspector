// JSONPath (RFC 9535 flavoured, with Goessner-style compatibility).
// Supports: $ @ .name ['name'] [n] [-n] [*] .* ..name ..* [a,b] [start:end:step]
//           filters ?(@.price < 10 && @.tags) with == != < <= > >= =~ /regex/ ! && || length()

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = v => v !== null && typeof v === 'object';
const NAME_STOP = /[.[\]()\s,!=<>&|~'"?]/;

class Parser {
  constructor(src) { this.s = src; this.i = 0; }
  peek(o = 0) { return this.s[this.i + o]; }
  eof() { return this.i >= this.s.length; }
  ws() { while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++; }
  err(m) { throw new SyntaxError(`${m} (at position ${this.i})`); }
  expect(c) { this.ws(); if (this.s[this.i] !== c) this.err(`Expected "${c}"`); this.i++; }
  rest() { return this.s.slice(this.i); }

  path(allowRel) {
    this.ws();
    const r = this.peek();
    if (r === '$' || (allowRel && r === '@')) this.i++;
    else this.err(allowRel ? 'Expected "@" or "$"' : 'Query must start with "$"');
    const segs = [];
    for (;;) {
      const c = this.peek();
      if (c === '.' && this.peek(1) === '.') { this.i += 2; segs.push({ desc: true, sels: this.afterDot(true) }); }
      else if (c === '.') { this.i++; segs.push({ desc: false, sels: this.afterDot(false) }); }
      else if (c === '[') segs.push({ desc: false, sels: this.bracket() });
      else break;
    }
    return { root: r, segs };
  }

  afterDot(desc) {
    const c = this.peek();
    if (c === '*') { this.i++; return [{ k: 'wild' }]; }
    if (desc && c === '[') return this.bracket();
    const st = this.i;
    while (!this.eof() && !NAME_STOP.test(this.peek())) this.i++;
    if (this.i === st) this.err('Expected a property name');
    return [{ k: 'name', name: this.s.slice(st, this.i) }];
  }

  bracket() {
    this.i++;
    const sels = [];
    for (;;) {
      this.ws();
      sels.push(this.selector());
      this.ws();
      if (this.peek() === ',') { this.i++; continue; }
      if (this.peek() === ']') { this.i++; return sels; }
      this.err('Expected "," or "]"');
    }
  }

  selector() {
    const c = this.peek();
    if (c === "'" || c === '"') return { k: 'name', name: this.string() };
    if (c === '*') { this.i++; return { k: 'wild' }; }
    if (c === '?') { this.i++; return { k: 'filter', expr: this.or() }; }
    const m = /^(-?\d+)?\s*(?::\s*(-?\d+)?\s*(?::\s*(-?\d+)?)?)?/.exec(this.rest());
    if (m && m[0].trim()) {
      this.i += m[0].length;
      if (m[0].includes(':')) return { k: 'slice', start: m[1] != null ? +m[1] : null, end: m[2] != null ? +m[2] : null, step: m[3] != null ? +m[3] : 1 };
      return { k: 'index', i: +m[1] };
    }
    this.err('Invalid selector');
  }

  string() {
    const q = this.s[this.i++];
    let out = '';
    while (!this.eof()) {
      const c = this.s[this.i++];
      if (c === q) return out;
      if (c === '\\') {
        const e = this.s[this.i++];
        if (e === 'u') { out += String.fromCharCode(parseInt(this.s.slice(this.i, this.i + 4), 16)); this.i += 4; }
        else out += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }[e] ?? e;
      } else out += c;
    }
    this.err('Unterminated string');
  }

  or() {
    let l = this.and();
    for (;;) { this.ws(); if (this.s.startsWith('||', this.i)) { this.i += 2; l = { op: '||', l, r: this.and() }; } else return l; }
  }
  and() {
    let l = this.not();
    for (;;) { this.ws(); if (this.s.startsWith('&&', this.i)) { this.i += 2; l = { op: '&&', l, r: this.not() }; } else return l; }
  }
  not() {
    this.ws();
    if (this.peek() === '!' && this.peek(1) !== '=') { this.i++; return { op: '!', e: this.not() }; }
    return this.cmp();
  }
  cmp() {
    const l = this.primary();
    this.ws();
    const m = /^(==|!=|<=|>=|=~|<|>)/.exec(this.rest());
    if (!m) return l;
    this.i += m[0].length;
    return { op: m[0], l, r: this.primary() };
  }
  primary() {
    this.ws();
    const c = this.peek();
    const rest = this.rest();
    if (c === '(') { this.i++; const e = this.or(); this.expect(')'); return e; }
    if (c === '@' || c === '$') return { op: 'path', p: this.path(true) };
    if (c === "'" || c === '"') return { op: 'lit', v: this.string() };
    if (c === '/') {
      const m = /^\/((?:\\.|[^/\\])+)\/([gimsuy]*)/.exec(rest);
      if (!m) this.err('Invalid regular expression');
      this.i += m[0].length;
      try { return { op: 'lit', v: new RegExp(m[1], m[2].replace('g', '')) }; } catch (e) { this.err(e.message); }
    }
    let m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (m) { this.i += m[0].length; return { op: 'lit', v: Number(m[0]) }; }
    m = /^(true|false|null)\b/.exec(rest);
    if (m) { this.i += m[0].length; return { op: 'lit', v: m[1] === 'null' ? null : m[1] === 'true' }; }
    m = /^(length|count)\s*\(/.exec(rest);
    if (m) { this.i += m[0].length; const arg = this.or(); this.expect(')'); return { op: 'fn', name: m[1], arg }; }
    this.err('Unexpected token in filter expression');
  }
}

export function compile(expr) {
  const p = new Parser(expr.trim());
  const ast = p.path(false);
  p.ws();
  if (!p.eof()) p.err('Unexpected characters');
  return ast;
}

function entries(v) {
  if (Array.isArray(v)) return v.map((x, i) => [i, x]);
  return Object.keys(v).map(k => [k, v[k]]);
}

function descendants(node, out) {
  out.push(node);
  if (isObj(node.v)) for (const [k, c] of entries(node.v)) descendants({ v: c, segs: [...node.segs, k] }, out);
  return out;
}

function select(node, sels, out, root, inFilter) {
  const v = node.v;
  for (const sel of sels) {
    switch (sel.k) {
      case 'name':
        if (isObj(v) && !Array.isArray(v) && hasOwn(v, sel.name)) out.push({ v: v[sel.name], segs: [...node.segs, sel.name] });
        else if (inFilter && sel.name === 'length' && (Array.isArray(v) || typeof v === 'string')) out.push({ v: v.length, segs: null });
        break;
      case 'wild':
        if (isObj(v)) for (const [k, c] of entries(v)) out.push({ v: c, segs: [...node.segs, k] });
        break;
      case 'index':
        if (Array.isArray(v)) {
          const i = sel.i < 0 ? v.length + sel.i : sel.i;
          if (i >= 0 && i < v.length) out.push({ v: v[i], segs: [...node.segs, i] });
        }
        break;
      case 'slice': {
        if (!Array.isArray(v) || sel.step === 0) break;
        const len = v.length, step = sel.step;
        const norm = (x, d) => (x == null ? d : x < 0 ? Math.max(len + x, step > 0 ? 0 : -1) : Math.min(x, step > 0 ? len : len - 1));
        if (step > 0) for (let i = norm(sel.start, 0); i < norm(sel.end, len); i += step) out.push({ v: v[i], segs: [...node.segs, i] });
        else for (let i = norm(sel.start, len - 1); i > norm(sel.end, -1); i += step) out.push({ v: v[i], segs: [...node.segs, i] });
        break;
      }
      case 'filter':
        if (isObj(v)) for (const [k, c] of entries(v)) {
          const child = { v: c, segs: [...node.segs, k] };
          if (truthy(evalExpr(sel.expr, child, root))) out.push(child);
        }
        break;
    }
  }
}

function run(start, segs, root, inFilter) {
  let nodes = [start];
  for (const seg of segs) {
    const next = [];
    for (const n of nodes) {
      const targets = seg.desc ? descendants(n, []) : [n];
      for (const t of targets) select(t, seg.sels, next, root, inFilter);
    }
    nodes = next;
    if (!nodes.length) break;
  }
  return nodes;
}

const MISSING = Symbol('missing');
function valueOf(r) {
  if (r && r.nodes) return r.nodes.length ? r.nodes[0].v : MISSING;
  return r;
}
function truthy(r) {
  if (r && r.nodes) return r.nodes.length > 0;
  return r !== MISSING && r !== false && r !== null && r !== undefined;
}
function deepEq(a, b) {
  if (a === b) return true;
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => hasOwn(b, k) && deepEq(a[k], b[k]));
}

function evalExpr(e, cur, root) {
  switch (e.op) {
    case 'lit': return e.v;
    case 'path': return { nodes: run(e.p.root === '@' ? { v: cur.v, segs: [] } : { v: root, segs: [] }, e.p.segs, root, true) };
    case 'fn': {
      const v = valueOf(evalExpr(e.arg, cur, root));
      if (e.name === 'count') { const r = evalExpr(e.arg, cur, root); return r && r.nodes ? r.nodes.length : 0; }
      if (typeof v === 'string' || Array.isArray(v)) return v.length;
      if (isObj(v)) return Object.keys(v).length;
      return MISSING;
    }
    case '!': return !truthy(evalExpr(e.e, cur, root));
    case '&&': return truthy(evalExpr(e.l, cur, root)) && truthy(evalExpr(e.r, cur, root));
    case '||': return truthy(evalExpr(e.l, cur, root)) || truthy(evalExpr(e.r, cur, root));
    default: {
      const a = valueOf(evalExpr(e.l, cur, root));
      const b = valueOf(evalExpr(e.r, cur, root));
      switch (e.op) {
        case '==': return a === MISSING || b === MISSING ? a === b : deepEq(a, b);
        case '!=': return a === MISSING || b === MISSING ? a !== b : !deepEq(a, b);
        case '=~': {
          if (typeof a !== 'string') return false;
          const re = b instanceof RegExp ? b : typeof b === 'string' ? safeRegex(b) : null;
          return re ? re.test(a) : false;
        }
        default: {
          const comparable = (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string');
          if (!comparable) return false;
          return e.op === '<' ? a < b : e.op === '<=' ? a <= b : e.op === '>' ? a > b : a >= b;
        }
      }
    }
  }
}
function safeRegex(s) { try { return new RegExp(s); } catch { return null; } }

/** Evaluate a JSONPath query. Returns [{ segs, value }]; throws SyntaxError on invalid queries. */
export function query(root, expr) {
  const ast = compile(expr);
  return run({ v: root, segs: [] }, ast.segs, root, false)
    .filter(n => n.segs)
    .map(n => ({ segs: n.segs, value: n.v }));
}
