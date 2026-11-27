import { keyOf, getAt } from './path.js';
import { store, isContainer, childEntries } from './util.js';

export const S = {
  doc: undefined,
  name: 'Untitled',
  format: 'json',
  recentId: null,
  undo: [],
  redo: [],
  expanded: new Set(),
  limits: new Map(),
  selected: null,
  sort: store.get('sort', 'original'),
  view: 'tree',
  tableSegs: null,
  search: { q: '', caseSensitive: false, regex: false, filter: false, matches: [], matchIds: new Set(), visibleIds: null, idx: -1, error: null, truncated: false, mode: 'text' },
};

const subs = new Map();
export function on(evt, fn) { if (!subs.has(evt)) subs.set(evt, []); subs.get(evt).push(fn); }
export function emit(evt, data) { for (const fn of subs.get(evt) || []) fn(data); }

const UNDO_MAX = 100;

export function loadDoc(doc, { name = 'Untitled', format = 'json', recentId = null } = {}) {
  S.doc = doc;
  S.name = name;
  S.format = format;
  S.recentId = recentId;
  S.undo = [];
  S.redo = [];
  S.selected = null;
  S.tableSegs = null;
  S.limits = new Map();
  S.expanded = new Set([keyOf([])]);
  // Open the first level (and the second for small documents) so there is something to look at.
  if (isContainer(doc)) {
    const kids = childEntries(doc).filter(([, v]) => isContainer(v));
    if (kids.length <= 30) for (const [k] of kids) S.expanded.add(keyOf([k]));
  }
  emit('load');
  emit('doc', { reason: 'load' });
}

export function commit(doc, label = 'Edit', { select } = {}) {
  S.undo.push({ doc: S.doc, label, selected: S.selected });
  if (S.undo.length > UNDO_MAX) S.undo.shift();
  S.redo = [];
  S.doc = doc;
  if (select !== undefined) S.selected = select;
  if (S.selected && getAt(doc, S.selected) === undefined) S.selected = null;
  emit('doc', { reason: 'edit', label });
  emit('select');
}

function travel(from, to) {
  const entry = from.pop();
  if (!entry) return null;
  to.push({ doc: S.doc, label: entry.label, selected: S.selected });
  S.doc = entry.doc;
  S.selected = entry.selected && getAt(S.doc, entry.selected) !== undefined ? entry.selected : null;
  emit('doc', { reason: 'history', label: entry.label });
  emit('select');
  return entry.label;
}
export const undo = () => travel(S.undo, S.redo);
export const redo = () => travel(S.redo, S.undo);

export function select(segs) {
  S.selected = segs;
  emit('select');
}
