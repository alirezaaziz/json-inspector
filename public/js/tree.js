// Virtualized tree: the visible part of the document is flattened into rows and only
// the rows inside the viewport are in the DOM, so huge documents stay responsive.
import { S, on, emit, select } from './state.js';
import { keyOf, getAt } from './path.js';
import { typeOf, childEntries, esc, isContainer } from './util.js';
import { icon } from './icons.js';
import { toast } from './ui.js';

const ROW = 26;
const OVERSCAN = 16;
const CHUNK = 500;
const EXPAND_LIMIT = 50000;
const COLOR = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/deg]+\))$/i;

let vp, spacer, layer, onMenu;
let rows = [];
let indexById = new Map();
let painted = { start: -1, end: -1, version: -1 };
let version = 0;
let raf = 0;

const caret = icon('chevron');
const moreIcon = icon('more');

export function initTree(el, opts) {
  vp = el;
  onMenu = opts.onMenu;
  vp.tabIndex = 0;
  vp.setAttribute('role', 'tree');
  vp.setAttribute('aria-label', 'JSON tree');
  spacer = document.createElement('div');
  spacer.className = 'tree-spacer';
  layer = document.createElement('div');
  layer.className = 'tree-layer';
  spacer.appendChild(layer);
  vp.appendChild(spacer);

  vp.addEventListener('scroll', schedule, { passive: true });
  new ResizeObserver(schedule).observe(vp);
  vp.addEventListener('click', onClick);
  vp.addEventListener('dblclick', onDblClick);
  vp.addEventListener('contextmenu', onContext);
  vp.addEventListener('keydown', onKey);

  on('doc', rebuild);
  on('select', () => { version++; paint(); });
  on('search', rebuild);
}

function schedule() {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); });
}

export function rebuild() {
  rows = [];
  indexById = new Map();
  if (S.doc !== undefined) {
    const s = S.search;
    const filter = s.filter && s.q && !s.error ? s.visibleIds : null;
    const walk = (v, segs, k, isIdx, depth, forced) => {
      const id = keyOf(segs);
      if (filter && !forced && !filter.has(id)) return;
      const t = typeOf(v);
      const cont = t === 'object' || t === 'array';
      const open = cont && S.expanded.has(id);
      indexById.set(id, rows.length);
      const n = cont ? (t === 'array' ? v.length : Object.keys(v).length) : 0;
      rows.push({ segs, id, k, isIdx, v, t, depth, open, n });
      if (!open) return;
      const childForced = forced || (filter !== null && s.matchIds.has(id));
      const kids = childEntries(v, S.sort);
      const limit = S.limits.get(id) || CHUNK;
      let shown = 0;
      for (const [ck, cv] of kids) {
        if (shown >= limit) break;
        const before = rows.length;
        walk(cv, [...segs, ck], ck, t === 'array', depth + 1, childForced);
        if (rows.length > before) shown++;
      }
      if (kids.length > limit && shown >= limit) rows.push({ more: true, id: id + '#more', parentId: id, depth: depth + 1, remaining: kids.length - limit });
    };
    walk(S.doc, [], null, false, 0, false);
  }
  spacer.style.height = rows.length * ROW + 'px';
  version++;
  paint();
}

function paint() {
  if (!vp) return;
  const h = vp.clientHeight || 600;
  const st = vp.scrollTop;
  const start = Math.max(0, Math.floor(st / ROW) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((st + h) / ROW) + OVERSCAN);
  if (painted.start === start && painted.end === end && painted.version === version) return;
  painted = { start, end, version };
  const sel = S.selected ? keyOf(S.selected) : null;
  const cur = S.search.idx >= 0 && S.search.matches[S.search.idx] ? keyOf(S.search.matches[S.search.idx]) : null;
  let html = '';
  for (let i = start; i < end; i++) html += rowHTML(rows[i], i, sel, cur);
  layer.style.transform = `translateY(${start * ROW}px)`;
  layer.innerHTML = html;
  vp.setAttribute('aria-activedescendant', sel && indexById.has(sel) ? 'tr-' + indexById.get(sel) : '');
}

function previewOf(r) {
  if (r.t === 'array') {
    const parts = [];
    for (let i = 0; i < Math.min(r.v.length, 4); i++) {
      const x = r.v[i], t = typeOf(x);
      parts.push(t === 'object' ? '{…}' : t === 'array' ? '[…]' : t === 'string' ? JSON.stringify(x.length > 24 ? x.slice(0, 24) + '…' : x) : String(x));
    }
    return parts.join(', ') + (r.v.length > 4 ? ', …' : '');
  }
  const keys = Object.keys(r.v);
  return keys.slice(0, 5).join(', ') + (keys.length > 5 ? ', …' : '');
}

function valueHTML(r) {
  switch (r.t) {
    case 'string': {
      const s = r.v.length > 400 ? r.v.slice(0, 400) + '…' : r.v;
      const sw = r.v.length < 40 && COLOR.test(r.v.trim()) ? `<span class="swatch" style="background:${esc(r.v.trim())}"></span>` : '';
      return `${sw}<span class="v ts">${esc(JSON.stringify(s))}</span>`;
    }
    case 'number': return `<span class="v tn">${r.v}</span>`;
    case 'boolean': return `<span class="v tb">${r.v}</span>`;
    case 'null': return `<span class="v tz">null</span>`;
  }
  const badge = r.t === 'array' ? `[${r.n}]` : `{${r.n}}`;
  return `<span class="sum">${badge}</span>${!r.open && r.n ? `<span class="pv">${esc(previewOf(r))}</span>` : ''}`;
}

function rowHTML(r, i, sel, cur) {
  if (r.more) {
    return `<div class="row more" data-i="${i}" style="--d:${r.depth}"><span class="tw"></span><button class="more-btn" data-act="more" tabindex="-1">Show ${Math.min(CHUNK, r.remaining).toLocaleString()} more <span class="dim">(${r.remaining.toLocaleString()} remaining)</span></button></div>`;
  }
  const cont = r.t === 'object' || r.t === 'array';
  let cls = 'row';
  if (r.id === sel) cls += ' sel';
  if (S.search.matchIds.has(r.id)) cls += r.id === cur ? ' hit cur' : ' hit';
  const tw = cont ? `<span class="tw${r.open ? ' open' : ''}" data-act="toggle">${caret}</span>` : '<span class="tw"></span>';
  let key;
  if (r.k === null) key = '<span class="k root">root</span>';
  else if (r.isIdx) key = `<span class="k idx">${r.k}</span>`;
  else key = `<span class="k">${esc(r.k)}</span>`;
  return `<div class="${cls}" id="tr-${i}" data-i="${i}" style="--d:${r.depth}" role="treeitem" aria-level="${r.depth + 1}"${cont ? ` aria-expanded="${r.open}"` : ''} aria-selected="${r.id === sel}">${tw}${key}<span class="p">:</span>${valueHTML(r)}<button class="row-menu" data-act="menu" tabindex="-1" aria-label="Node actions">${moreIcon}</button></div>`;
}

// ── Expansion ────────────────────────────────────────────────────────────────

export function toggle(segs, recursive = false) {
  const id = keyOf(segs);
  if (S.expanded.has(id)) {
    if (recursive) collapseAll(segs); else S.expanded.delete(id);
  } else if (recursive) expandAll(segs);
  else S.expanded.add(id);
  rebuild();
}

export function expandAll(rootSegs = []) {
  let count = 0;
  const start = rootSegs.length ? getAt(S.doc, rootSegs) : S.doc;
  const queue = [[start, rootSegs]];
  while (queue.length && count < EXPAND_LIMIT) {
    const [v, segs] = queue.shift();
    if (!isContainer(v)) continue;
    S.expanded.add(keyOf(segs));
    count++;
    for (const [k, c] of childEntries(v)) if (isContainer(c)) queue.push([c, [...segs, k]]);
  }
  if (queue.length) toast(`Expanded the first ${EXPAND_LIMIT.toLocaleString()} containers — the document is very large.`, 'info', 4000);
  rebuild();
}

export function collapseAll(rootSegs = []) {
  const prefix = keyOf(rootSegs).slice(0, -1);
  if (!rootSegs.length) S.expanded = new Set([keyOf([])]);
  else for (const id of [...S.expanded]) if (id === keyOf(rootSegs) || id.startsWith(prefix + ',')) S.expanded.delete(id);
  rebuild();
}

/** Expand every ancestor of segs, make sure it is not hidden behind a "show more" row, select it and scroll to it. */
export function reveal(segs, { focus = false, doSelect = true } = {}) {
  for (let i = 0; i < segs.length; i++) {
    const parent = segs.slice(0, i);
    const pid = keyOf(parent);
    S.expanded.add(pid);
    const k = segs[i];
    if (typeof k === 'number' && k >= (S.limits.get(pid) || CHUNK)) S.limits.set(pid, Math.ceil((k + 1) / CHUNK) * CHUNK);
    else if (typeof k === 'string') {
      const v = getAt(S.doc, parent);
      if (v && !Array.isArray(v)) {
        const idx = childEntries(v, S.sort).findIndex(([ck]) => ck === k);
        if (idx >= (S.limits.get(pid) || CHUNK)) S.limits.set(pid, Math.ceil((idx + 1) / CHUNK) * CHUNK);
      }
    }
  }
  rebuild();
  if (doSelect) select(segs);
  scrollToId(keyOf(segs), 'center');
  if (focus) vp.focus({ preventScroll: true });
}

function scrollToId(id, mode = 'nearest') {
  const i = indexById.get(id);
  if (i === undefined) return;
  const h = vp.clientHeight, top = i * ROW;
  if (mode === 'center') { if (top < vp.scrollTop || top + ROW > vp.scrollTop + h) vp.scrollTop = Math.max(0, top - h / 2 + ROW); }
  else if (top < vp.scrollTop) vp.scrollTop = top;
  else if (top + ROW > vp.scrollTop + h) vp.scrollTop = top + ROW - h;
  paint();
}

export const focusTree = () => vp?.focus();

// ── Events ───────────────────────────────────────────────────────────────────

function rowAt(e) {
  const el = e.target.closest('.row');
  return el ? rows[+el.dataset.i] : null;
}

function showMore(r) {
  S.limits.set(r.parentId, (S.limits.get(r.parentId) || CHUNK) + CHUNK);
  rebuild();
}

function onClick(e) {
  const r = rowAt(e);
  if (!r) return;
  if (r.more) { showMore(r); return; }
  const actEl = e.target.closest('[data-act]');
  const act = actEl?.dataset.act;
  if (act === 'toggle') { toggle(r.segs, e.altKey); return; }
  if (act === 'menu') {
    const b = actEl.getBoundingClientRect();
    select(r.segs);
    onMenu(r.segs, b.right - 4, b.bottom + 4);
    return;
  }
  select(r.segs);
}

function onDblClick(e) {
  const r = rowAt(e);
  if (!r || r.more || e.target.closest('[data-act]')) return;
  if (r.t === 'object' || r.t === 'array') toggle(r.segs);
  else emit('request-edit', r.segs);
}

function onContext(e) {
  const r = rowAt(e);
  if (!r || r.more) return;
  e.preventDefault();
  select(r.segs);
  onMenu(r.segs, e.clientX, e.clientY);
}

function go(i) {
  if (!rows.length) return;
  i = Math.max(0, Math.min(rows.length - 1, i));
  if (rows[i].more) i += i > 0 && rows[i - 1] ? 0 : 1;
  const r = rows[i];
  if (!r || r.more) return;
  select(r.segs);
  scrollToId(r.id);
}

function onKey(e) {
  if (!rows.length || e.target !== vp) return;
  const cur = S.selected ? indexById.get(keyOf(S.selected)) : undefined;
  const i = cur ?? -1;
  const r = rows[i];
  const page = Math.max(1, Math.floor(vp.clientHeight / ROW) - 1);
  const cont = r && (r.t === 'object' || r.t === 'array');
  switch (e.key) {
    case 'ArrowDown': go(rows[i + 1]?.more ? i + 2 : i + 1); break;
    case 'ArrowUp': go(i - 1 >= 0 && rows[i - 1]?.more ? i - 2 : i - 1); break;
    case 'ArrowRight':
      if (cont && !r.open && r.n) toggle(r.segs);
      else if (cont && r.open) go(i + 1);
      break;
    case 'ArrowLeft':
      if (cont && r.open) toggle(r.segs);
      else if (r && r.segs.length) { const p = r.segs.slice(0, -1); select(p); scrollToId(keyOf(p)); }
      break;
    case 'Home': go(0); break;
    case 'End': go(rows.length - 1); break;
    case 'PageDown': go(i + page); break;
    case 'PageUp': go(i - page); break;
    case 'Enter': case ' ':
      if (!r) { go(0); break; }
      if (cont) toggle(r.segs, e.altKey); else emit('request-edit', r.segs);
      break;
    case '*': if (r && cont) expandAll(r.segs); break;
    case 'Delete': case 'Backspace': if (r && r.segs.length) emit('request-delete', r.segs); break;
    case 'F2': if (r) emit('request-edit', r.segs); break;
    case 'ContextMenu': if (r) { const el = layer.querySelector(`[data-i="${i}"]`); const b = el?.getBoundingClientRect(); onMenu(r.segs, b ? b.left + 40 : 100, b ? b.bottom : 100); } break;
    case 'c': case 'C':
      if ((e.metaKey || e.ctrlKey) && r && !window.getSelection()?.toString()) { emit('request-copy', r.segs); break; }
      return;
    default: return;
  }
  e.preventDefault();
}

export function isVisibleRow(segs) { return indexById.has(keyOf(segs)); }
