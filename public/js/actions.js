// Node-level operations shared by the tree context menu, the inspector and keyboard shortcuts.
import { S, commit, emit, select } from './state.js';
import { getAt, setAt, deleteAt, renameKey, insertAt, sortKeysDeep, toJSONPath, toPointer, toJS, keyOf } from './path.js';
import { typeOf, isContainer, esc, modKey } from './util.js';
import { smartParse } from './parse.js';
import { copy, toast, modal, prompt } from './ui.js';
import { reveal, expandAll, collapseAll } from './tree.js';

const valueText = v => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const label = segs => (segs.length ? toJSONPath(segs) : 'root');

export function copyValue(segs) {
  const v = getAt(S.doc, segs);
  copy(valueText(v), typeOf(v) === 'string' ? 'Value copied' : 'JSON copied');
}

export function copyPath(segs, fmt = 'jsonpath') {
  const p = fmt === 'pointer' ? toPointer(segs) : fmt === 'js' ? toJS(segs) : toJSONPath(segs);
  copy(p, 'Path copied');
}

export function remove(segs) {
  if (!segs.length) return;
  const parentSegs = segs.slice(0, -1);
  const parent = getAt(S.doc, parentSegs);
  const key = segs[segs.length - 1];
  let next = parentSegs;
  if (Array.isArray(parent) && parent.length > 1) next = [...parentSegs, Math.min(key, parent.length - 2)];
  else if (parent && !Array.isArray(parent)) {
    const keys = Object.keys(parent);
    const i = keys.indexOf(key);
    const sib = keys[i + 1] ?? keys[i - 1];
    if (sib !== undefined) next = [...parentSegs, sib];
  }
  commit(deleteAt(S.doc, segs), `Delete ${label(segs)}`, { select: next });
  toast(`Deleted ${label(segs)} · ${modKey}+Z to undo`, 'info');
}

export async function rename(segs) {
  const parent = getAt(S.doc, segs.slice(0, -1));
  if (!segs.length || Array.isArray(parent)) return;
  const old = segs[segs.length - 1];
  const name = await prompt({
    title: 'Rename key', label: 'New key name', value: old, okLabel: 'Rename',
    validate: v => (v !== old && Object.prototype.hasOwnProperty.call(parent, v) ? `"${v}" already exists in this object` : null),
  });
  if (name === null || name === old) return;
  const nextSegs = [...segs.slice(0, -1), name];
  commit(renameKey(S.doc, segs, name), `Rename ${old} → ${name}`, { select: nextSegs });
  reveal(nextSegs);
}

function parseValueInput(text) {
  if (!text.trim()) return { ok: true, data: '' };
  const r = smartParse(text);
  return r.ok ? r : { ok: true, data: text, asString: true };
}

export async function addChild(segs) {
  const target = getAt(S.doc, segs);
  if (!isContainer(target)) return;
  const isArr = Array.isArray(target);
  const r = await modal({
    title: isArr ? `Add item to ${label(segs)}` : `Add property to ${label(segs)}`,
    body: `${isArr ? '' : '<label class="field"><span>Key</span><input name="k" class="input" spellcheck="false" autocomplete="off" placeholder="newKey"></label>'}
      <label class="field"><span>Value <em class="dim">— JSON, or plain text for a string</em></span><textarea name="v" class="input code" rows="5" spellcheck="false" placeholder='null, 42, "text", { "a": 1 }'></textarea></label>`,
    actions: [{ label: 'Cancel', value: null }, { label: 'Add', value: 'ok', primary: true }],
    validate: f => {
      if (!isArr) {
        const k = f.elements.k.value;
        if (!k) return 'Key is required';
        if (Object.prototype.hasOwnProperty.call(target, k)) return `"${k}" already exists`;
      }
      return null;
    },
  });
  if (!r || r.value !== 'ok') return;
  const raw = r.form.elements.v.value;
  const val = raw.trim() ? parseValueInput(raw).data : null;
  const key = isArr ? target.length : r.form.elements.k.value;
  const childSegs = [...segs, key];
  commit(insertAt(S.doc, segs, isArr ? null : key, val), `Add ${label(childSegs)}`, { select: childSegs });
  reveal(childSegs);
}

export function duplicate(segs) {
  if (!segs.length) return;
  const parentSegs = segs.slice(0, -1);
  const parent = getAt(S.doc, parentSegs);
  const key = segs[segs.length - 1];
  const val = structuredClone(getAt(S.doc, segs));
  let newSegs;
  if (Array.isArray(parent)) {
    newSegs = [...parentSegs, key + 1];
    commit(insertAt(S.doc, parentSegs, key + 1, val), `Duplicate ${label(segs)}`, { select: newSegs });
  } else {
    let k = key + '_copy', i = 2;
    while (Object.prototype.hasOwnProperty.call(parent, k)) k = `${key}_copy${i++}`;
    newSegs = [...parentSegs, k];
    commit(insertAt(S.doc, parentSegs, k, val, key), `Duplicate ${label(segs)}`, { select: newSegs });
  }
  reveal(newSegs);
}

export function setValue(segs, value, what) {
  commit(setAt(S.doc, segs, value), what || `Edit ${label(segs)}`, { select: segs });
}

export function sortKeys(segs) {
  setValue(segs, sortKeysDeep(getAt(S.doc, segs)), `Sort keys in ${label(segs)}`);
  toast('Keys sorted A → Z (recursively)', 'success');
}

export function parseEmbedded(segs) {
  const v = getAt(S.doc, segs);
  const r = smartParse(v);
  if (!r.ok || !isContainer(r.data)) { toast('This string does not contain a JSON object or array', 'error'); return; }
  setValue(segs, r.data, `Parse embedded JSON at ${label(segs)}`);
  S.expanded.add(keyOf(segs));
  reveal(segs);
}

export function stringify(segs) {
  setValue(segs, JSON.stringify(getAt(S.doc, segs)), `Stringify ${label(segs)}`);
}

export function filterBy(segs) { emit('set-search', toJSONPath(segs)); }

export function openTable(segs) { S.tableSegs = segs; emit('set-view', 'table'); }

export function nodeMenu(segs) {
  const v = getAt(S.doc, segs);
  const t = typeOf(v);
  const parent = segs.length ? getAt(S.doc, segs.slice(0, -1)) : null;
  const cont = t === 'object' || t === 'array';
  const looksJSON = t === 'string' && /^\s*[[{]/.test(v);
  return [
    { label: 'Copy value', icon: 'copy', kbd: `${modKey}C`, action: () => copyValue(segs) },
    { label: 'Copy path', icon: 'link', action: () => copyPath(segs) },
    { label: 'Copy JSON Pointer', icon: 'link', action: () => copyPath(segs, 'pointer') },
    '-',
    { label: 'Edit value', icon: 'pencil', kbd: 'F2', action: () => { select(segs); emit('request-edit', segs); } },
    ...(parent && !Array.isArray(parent) ? [{ label: 'Rename key', icon: 'pencil', action: () => rename(segs) }] : []),
    ...(cont ? [{ label: t === 'array' ? 'Add item' : 'Add property', icon: 'plus', action: () => addChild(segs) }] : []),
    ...(segs.length ? [{ label: 'Duplicate', icon: 'layers', action: () => duplicate(segs) }] : []),
    ...(looksJSON ? [{ label: 'Parse embedded JSON', icon: 'wand', action: () => parseEmbedded(segs) }] : []),
    ...(cont ? [{ label: 'Convert to JSON string', icon: 'code', action: () => stringify(segs) }] : []),
    ...(t === 'object' ? [{ label: 'Sort keys A → Z', icon: 'sort', action: () => sortKeys(segs) }] : []),
    ...(cont ? ['-',
      { label: 'Expand all children', icon: 'expand', kbd: '*', action: () => expandAll(segs) },
      { label: 'Collapse all children', icon: 'collapse', action: () => collapseAll(segs) }] : []),
    ...(t === 'array' ? [{ label: 'Open in table', icon: 'table', action: () => openTable(segs) }] : []),
    { label: 'Filter to this path', icon: 'filter', action: () => filterBy(segs) },
    ...(segs.length ? ['-', { label: 'Delete', icon: 'trash', kbd: 'Del', danger: true, action: () => remove(segs) }] : []),
  ];
}

export { valueText, esc };
