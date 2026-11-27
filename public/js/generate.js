// Type inference from sample JSON + emitters (TypeScript, Zod, JSON Schema, Go, Python) and
// format converters (YAML, CSV).
import { typeOf, flattenObject } from './util.js';

const SAMPLE = 2000;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const isNum = s => s.t === 'number' || s.t === 'integer';

// ── Inference ────────────────────────────────────────────────────────────────

export function inferShape(v) {
  const t = typeOf(v);
  if (t === 'number') return { t: Number.isInteger(v) ? 'integer' : 'number' };
  if (t === 'array') {
    let item = { t: 'never' };
    const n = Math.min(v.length, SAMPLE);
    for (let i = 0; i < n; i++) item = merge(item, inferShape(v[i]));
    return { t: 'array', item };
  }
  if (t === 'object') {
    const fields = new Map();
    for (const k of Object.keys(v)) fields.set(k, { shape: inferShape(v[k]), count: 1 });
    return { t: 'object', fields, n: 1 };
  }
  return { t };
}

function addMember(list, s) {
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (m.t === s.t || (isNum(m) && isNum(s))) { list[i] = merge(m, s); return; }
  }
  list.push(s);
}

function union(members) {
  const list = [];
  for (const m of members) (m.t === 'union' ? m.of : [m]).forEach(x => addMember(list, x));
  return list.length === 1 ? list[0] : { t: 'union', of: list };
}

export function merge(a, b) {
  if (a.t === 'never') return b;
  if (b.t === 'never') return a;
  if (a.t === 'union' || b.t === 'union') return union([a, b]);
  if (a.t === b.t) {
    if (a.t === 'object') {
      const fields = new Map();
      for (const [k, f] of a.fields) fields.set(k, { shape: f.shape, count: f.count });
      for (const [k, f] of b.fields) {
        const e = fields.get(k);
        fields.set(k, e ? { shape: merge(e.shape, f.shape), count: e.count + f.count } : { shape: f.shape, count: f.count });
      }
      return { t: 'object', fields, n: a.n + b.n };
    }
    if (a.t === 'array') return { t: 'array', item: merge(a.item, b.item) };
    return a;
  }
  if (isNum(a) && isNum(b)) return { t: 'number' };
  return union([a, b]);
}

const optional = (obj, f) => f.count < obj.n;

// ── Naming ───────────────────────────────────────────────────────────────────

export function pascal(s) {
  const p = String(s).replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, c => c.toUpperCase());
  if (!p) return 'Item';
  return /^[A-Za-z]/.test(p) ? p : 'T' + p;
}
function singular(s) {
  if (/ies$/.test(s)) return s.slice(0, -3) + 'y';
  if (/(ss|us|is)$/.test(s)) return s + 'Item';
  if (/s$/.test(s) && s.length > 1) return s.slice(0, -1);
  return s + 'Item';
}

function signature(s) {
  switch (s.t) {
    case 'object': return '{' + [...s.fields].map(([k, f]) => JSON.stringify(k) + (optional(s, f) ? '?' : '') + ':' + signature(f.shape)).join(',') + '}';
    case 'array': return signature(s.item) + '[]';
    case 'union': return s.of.map(signature).sort().join('|');
    default: return s.t;
  }
}

/** Assigns a name to every object shape. `order` lists them children-first. */
function nameTypes(root, rootName) {
  const names = new Map(), bySig = new Map(), used = new Set(), order = [];
  const visit = (s, hint) => {
    if (s.t === 'object') {
      for (const [k, f] of s.fields) visit(f.shape, pascal(k));
      const sig = signature(s);
      if (bySig.has(sig)) { names.set(s, bySig.get(sig)); return; }
      let name = hint, i = 2;
      while (used.has(name)) name = hint + i++;
      used.add(name); names.set(s, name); bySig.set(sig, name);
      order.push({ name, shape: s });
    } else if (s.t === 'array') visit(s.item, singular(hint));
    else if (s.t === 'union') s.of.forEach(m => visit(m, hint));
  };
  visit(root, rootName);
  return { names, order };
}

const nonNull = s => (s.t === 'union' ? s.of.filter(m => m.t !== 'null') : [s]);
const hasNull = s => s.t === 'null' || (s.t === 'union' && s.of.some(m => m.t === 'null'));

// ── TypeScript ───────────────────────────────────────────────────────────────

function tsType(s, names) {
  switch (s.t) {
    case 'string': return 'string';
    case 'number': case 'integer': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    case 'never': return 'unknown';
    case 'object': return names.get(s);
    case 'array': { const it = tsType(s.item, names); return (s.item.t === 'union' ? `(${it})` : it) + '[]'; }
    case 'union': return s.of.map(m => tsType(m, names)).join(' | ');
  }
  return 'unknown';
}

export function toTypeScript(value, rootName = 'Root') {
  const shape = inferShape(value);
  const { names, order } = nameTypes(shape, rootName);
  const blocks = [];
  if (shape.t !== 'object') blocks.push(`export type ${rootName} = ${tsType(shape, names)};`);
  for (const { name, shape: s } of [...order].reverse()) {
    if (!s.fields.size) { blocks.push(`export type ${name} = Record<string, unknown>;`); continue; }
    const lines = [...s.fields].map(([k, f]) => `  ${IDENT.test(k) ? k : JSON.stringify(k)}${optional(s, f) ? '?' : ''}: ${tsType(f.shape, names)};`);
    blocks.push(`export interface ${name} {\n${lines.join('\n')}\n}`);
  }
  return blocks.join('\n\n') + '\n';
}

// ── Zod ──────────────────────────────────────────────────────────────────────

function zodType(s, names) {
  switch (s.t) {
    case 'string': return 'z.string()';
    case 'number': return 'z.number()';
    case 'integer': return 'z.number().int()';
    case 'boolean': return 'z.boolean()';
    case 'null': return 'z.null()';
    case 'never': return 'z.unknown()';
    case 'object': return names.get(s) + 'Schema';
    case 'array': return `z.array(${zodType(s.item, names)})`;
    case 'union': {
      const rest = nonNull(s);
      if (hasNull(s) && rest.length === 1) return zodType(rest[0], names) + '.nullable()';
      return `z.union([${s.of.map(m => zodType(m, names)).join(', ')}])`;
    }
  }
  return 'z.unknown()';
}

export function toZod(value, rootName = 'Root') {
  const shape = inferShape(value);
  const { names, order } = nameTypes(shape, rootName);
  const blocks = ['import { z } from "zod";'];
  for (const { name, shape: s } of order) {
    const lines = [...s.fields].map(([k, f]) => `  ${IDENT.test(k) ? k : JSON.stringify(k)}: ${zodType(f.shape, names)}${optional(s, f) ? '.optional()' : ''},`);
    blocks.push(`export const ${name}Schema = z.object({\n${lines.join('\n')}\n});\nexport type ${name} = z.infer<typeof ${name}Schema>;`);
  }
  if (shape.t !== 'object') blocks.push(`export const ${rootName}Schema = ${zodType(shape, names)};\nexport type ${rootName} = z.infer<typeof ${rootName}Schema>;`);
  return blocks.join('\n\n') + '\n';
}

// ── JSON Schema ──────────────────────────────────────────────────────────────

function schemaOf(s) {
  switch (s.t) {
    case 'never': return {};
    case 'object': {
      const properties = {}, required = [];
      for (const [k, f] of s.fields) { properties[k] = schemaOf(f.shape); if (!optional(s, f)) required.push(k); }
      const o = { type: 'object', properties };
      if (required.length) o.required = required;
      return o;
    }
    case 'array': return s.item.t === 'never' ? { type: 'array' } : { type: 'array', items: schemaOf(s.item) };
    case 'union':
      if (s.of.every(m => !['object', 'array'].includes(m.t))) return { type: s.of.map(m => m.t) };
      return { anyOf: s.of.map(schemaOf) };
    default: return { type: s.t };
  }
}

export function toJSONSchema(value, rootName = 'Root') {
  const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', title: rootName, ...schemaOf(inferShape(value)) };
  return JSON.stringify(schema, null, 2) + '\n';
}

// ── Go ───────────────────────────────────────────────────────────────────────

const GO_INITIALISMS = new Set(['Id', 'Url', 'Uri', 'Api', 'Http', 'Https', 'Json', 'Html', 'Ip', 'Uuid', 'Sql', 'Css', 'Xml', 'Utc', 'Tls', 'Ssl', 'Cpu', 'Ram']);
function goName(k) {
  return pascal(k).replace(/[A-Z][a-z]+/g, w => (GO_INITIALISMS.has(w) ? w.toUpperCase() : w));
}

function goType(s, names) {
  switch (s.t) {
    case 'string': return 'string';
    case 'integer': return 'int64';
    case 'number': return 'float64';
    case 'boolean': return 'bool';
    case 'null': case 'never': return 'any';
    case 'object': return names.get(s);
    case 'array': return '[]' + goType(s.item, names);
    case 'union': {
      const rest = nonNull(s);
      if (rest.length === 1) {
        const inner = goType(rest[0], names);
        return rest[0].t === 'array' || inner === 'any' ? inner : '*' + inner;
      }
      return 'any';
    }
  }
  return 'any';
}

export function toGo(value, rootName = 'Root') {
  const shape = inferShape(value);
  const { names, order } = nameTypes(shape, rootName);
  const blocks = [];
  if (shape.t !== 'object') blocks.push(`type ${rootName} ${goType(shape, names)}`);
  for (const { name, shape: s } of [...order].reverse()) {
    const used = new Set();
    const rows = [...s.fields].map(([k, f]) => {
      let field = goName(k), i = 2;
      while (used.has(field)) field = goName(k) + i++;
      used.add(field);
      return [field, goType(f.shape, names), `\`json:"${k.replace(/"/g, '')}${optional(s, f) ? ',omitempty' : ''}"\``];
    });
    const w0 = Math.max(0, ...rows.map(r => r[0].length)), w1 = Math.max(0, ...rows.map(r => r[1].length));
    blocks.push(`type ${name} struct {\n${rows.map(r => `\t${r[0].padEnd(w0)} ${r[1].padEnd(w1)} ${r[2]}`).join('\n')}\n}`);
  }
  return blocks.join('\n\n') + '\n';
}

// ── Python (TypedDict) ───────────────────────────────────────────────────────

const PY_KEYWORDS = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
function pyType(s, names) {
  switch (s.t) {
    case 'string': return 'str';
    case 'integer': return 'int';
    case 'number': return 'float';
    case 'boolean': return 'bool';
    case 'null': return 'None';
    case 'never': return 'Any';
    case 'object': return names.get(s);
    case 'array': return `list[${pyType(s.item, names)}]`;
    case 'union': return s.of.map(m => pyType(m, names)).join(' | ');
  }
  return 'Any';
}

export function toPython(value, rootName = 'Root') {
  const shape = inferShape(value);
  const { names, order } = nameTypes(shape, rootName);
  const blocks = [];
  for (const { name, shape: s } of order) {
    const fields = [...s.fields].map(([k, f]) => [k, optional(s, f) ? `NotRequired[${pyType(f.shape, names)}]` : pyType(f.shape, names)]);
    const functional = fields.some(([k]) => !/^[A-Za-z_]\w*$/.test(k) || PY_KEYWORDS.has(k));
    if (functional) blocks.push(`${name} = TypedDict("${name}", {\n${fields.map(([k, t]) => `    ${JSON.stringify(k)}: ${t},`).join('\n')}\n})`);
    else blocks.push(`class ${name}(TypedDict):\n${fields.length ? fields.map(([k, t]) => `    ${k}: ${t}`).join('\n') : '    pass'}`);
  }
  if (shape.t !== 'object') blocks.push(`${rootName} = ${pyType(shape, names)}`);
  const body = blocks.join('\n\n\n');
  const imports = ['TypedDict'];
  if (/\bAny\b/.test(body)) imports.unshift('Any');
  if (/NotRequired\[/.test(body)) imports.push('NotRequired');
  return `from typing import ${imports.join(', ')}\n\n\n${body}\n`;
}

// ── YAML ─────────────────────────────────────────────────────────────────────

function yamlString(s) {
  if (s === '' || /^[\s]|[\s]$/.test(s) || /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) || /[:#]\s|\s#|:$/.test(s) ||
      /^(true|false|yes|no|on|off|null|~|y|n)$/i.test(s) || /^[-+]?(\.\d+|\d[\d_]*(\.\d*)?)([eE][-+]?\d+)?$/.test(s) ||
      /^0x|^0o/i.test(s) || /[\u0000-\u001f\u2028\u2029]/.test(s)) return JSON.stringify(s);
  return s;
}
function yamlScalar(v) {
  if (v === null) return 'null';
  if (typeof v === 'string') return yamlString(v);
  if (Array.isArray(v)) return '[]';
  if (typeof v === 'object') return '{}';
  return String(v);
}
const nonEmpty = v => v && typeof v === 'object' && (Array.isArray(v) ? v.length : Object.keys(v).length);

function yamlBlock(v, pad) {
  const sp = ' '.repeat(pad);
  if (Array.isArray(v)) {
    return v.map(x => (nonEmpty(x) ? sp + '- ' + yamlBlock(x, pad + 2).slice(pad + 2) : sp + '- ' + yamlScalar(x))).join('\n');
  }
  return Object.keys(v).map(k => {
    const x = v[k], key = yamlString(k);
    return nonEmpty(x) ? `${sp}${key}:\n${yamlBlock(x, pad + 2)}` : `${sp}${key}: ${yamlScalar(x)}`;
  }).join('\n');
}

export function toYAML(value) {
  return (nonEmpty(value) ? yamlBlock(value, 0) : yamlScalar(value)) + '\n';
}

// ── CSV ──────────────────────────────────────────────────────────────────────

export function tableColumns(arr, flatten) {
  const cols = new Set();
  let hasPrim = false;
  const rows = arr.map(v => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const r = flatten ? flattenObject(v) : v;
      for (const k of Object.keys(r)) cols.add(k);
      return r;
    }
    hasPrim = true;
    return { '(value)': v };
  });
  const list = [...cols];
  if (hasPrim) list.unshift('(value)');
  return { cols: list, rows };
}

export function cellText(v) {
  if (v === undefined) return '';
  if (v === null) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function toCSV(arr, { flatten = true, sep = ',' } = {}) {
  if (!Array.isArray(arr)) throw new Error('CSV export needs an array — select an array node or use Table view.');
  const { cols, rows } = tableColumns(arr, flatten);
  const q = s => (/[",\n\r\t]/.test(s) || s.includes(sep) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  const lines = [cols.map(q).join(sep)];
  for (const r of rows) lines.push(cols.map(c => q(cellText(r[c]))).join(sep));
  return lines.join('\r\n') + '\r\n';
}

export const GENERATORS = {
  typescript: { label: 'TypeScript', ext: 'ts', mime: 'text/plain', run: toTypeScript },
  zod: { label: 'Zod', ext: 'ts', mime: 'text/plain', run: toZod },
  schema: { label: 'JSON Schema', ext: 'schema.json', mime: 'application/json', run: toJSONSchema },
  go: { label: 'Go', ext: 'go', mime: 'text/plain', run: toGo },
  python: { label: 'Python', ext: 'py', mime: 'text/plain', run: toPython },
  yaml: { label: 'YAML', ext: 'yaml', mime: 'text/yaml', run: v => toYAML(v) },
  csv: { label: 'CSV', ext: 'csv', mime: 'text/csv', run: v => toCSV(v) },
};
