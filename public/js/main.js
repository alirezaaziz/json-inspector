import { S, on, emit, loadDoc, undo, redo, select } from './state.js';
import { keyOf, getAt } from './path.js';
import { $, $$, esc, debounce, fmtBytes, byteLength, fmtNum, relTime, stats, store, typeOf, modKey } from './util.js';
import { smartParse } from './parse.js';
import { findMatches, visibleSet } from './search.js';
import { encodeShare, decodeShare, MAX_SHARE_CHARS } from './share.js';
import { listRecent, saveRecent, getRecentText, deleteRecent, clearRecent } from './storage.js';
import { icon, hydrateIcons } from './icons.js';
import { toast, copy, download, pickFile, openMenu, modal, prompt } from './ui.js';
import { initTree, reveal, expandAll, collapseAll, focusTree, rebuild } from './tree.js';
import { initInspector } from './inspector.js';
import * as A from './actions.js';
import { initRaw, showRaw, stringifyDoc, isRawEditing } from './views/raw.js';
import { initTable, showTable } from './views/table.js';
import { initDiff, showDiff } from './views/diff.js';
import { initGenerate, showGenerate } from './views/generate.js';
import { SAMPLES } from './samples.js';

const VIEWS = ['tree', 'raw', 'table', 'diff', 'generate'];
const SHOW = { raw: showRaw, table: showTable, diff: showDiff, generate: showGenerate };
const INSPECTOR_VIEWS = new Set(['tree', 'table']);

const el = {};

// ── Theme ────────────────────────────────────────────────────────────────────

const THEMES = ['system', 'light', 'dark'];
function applyTheme(t) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  store.set('theme', t);
  const btn = $('#btnTheme');
  btn.innerHTML = icon(t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'monitor');
  btn.title = `Theme: ${t} (click to change)`;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d0d11' : '#ffffff');
}

// ── Loading documents ────────────────────────────────────────────────────────

function showLanding() {
  el.landing.hidden = false;
  el.workspace.hidden = true;
  document.body.classList.remove('in-ws');
  renderRecent();
  document.title = 'JSON Inspector — view, query & transform JSON';
}

function showWorkspace() {
  el.landing.hidden = true;
  el.workspace.hidden = false;
  document.body.classList.add('in-ws');
}

function showLandingError(err) {
  const box = el.inputErr;
  box.hidden = false;
  let html = `<div class="err-title">${icon('alert')}<span>${esc(err.message)}${err.line ? ` <span class="dim">— line ${err.line}, column ${err.col}</span>` : ''}</span></div>`;
  if (err.context) {
    html += `<pre class="err-ctx">${err.context.map(c => `<span class="ln-n">${c.n}</span>${esc(c.text)}${c.caret >= 0 ? `\n<span class="ln-n"></span>${' '.repeat(Math.max(0, c.caret))}<span class="caret">^</span>` : ''}`).join('\n')}</pre>`;
  }
  if (err.hint) html += `<p class="err-hint">${esc(err.hint)}</p>`;
  if (err.pos != null) html += `<button class="link-btn" data-goto="${err.pos}">Jump to error</button>`;
  box.innerHTML = html;
}

/** Parse text and open it. Returns true on success. */
function loadText(text, { name = 'Untitled', recentId = null, save = true } = {}) {
  const r = smartParse(text);
  if (!r.ok) {
    showLanding();
    if (text.length < 5_000_000 && el.input.value !== text) { el.input.value = text; validateInput(); }
    showLandingError(r.error);
    return false;
  }
  el.inputErr.hidden = true;
  openDoc(r.data, { name, format: r.format, recentId, save, text, warnings: r.warnings });
  return true;
}

function openDoc(data, { name, format = 'json', recentId = null, save = true, text, warnings = [] }) {
  clearSearch(false);
  loadDoc(data, { name, format, recentId });
  showWorkspace();
  setView('tree');
  focusTree();
  for (const w of warnings) toast(w, format === 'json' ? 'info' : 'success', 5000);
  if (save) {
    const body = format === 'json' && text && text.length < 2_000_000 ? text : JSON.stringify(data);
    saveRecent({ id: recentId, name, text: body, format }).then(id => { if (id != null && S.doc === data) S.recentId = id; }).catch(() => {});
  }
}

async function openFile() {
  const f = await pickFile();
  if (f) loadFile(f);
}

async function loadFile(f) {
  if (f.size > 300 * 1024 * 1024) { toast('That file is larger than 300 MB — too big to open in a browser tab.', 'error', 5000); return; }
  const t0 = performance.now();
  const busy = f.size > 5e6 ? toastBusy(`Opening ${f.name} (${fmtBytes(f.size)})…`) : null;
  await new Promise(r => setTimeout(r, 30));
  try {
    const text = await f.text();
    loadText(text, { name: f.name });
    if (busy) toast(`Opened in ${Math.round(performance.now() - t0)} ms`, 'success', 1800);
  } catch (e) {
    toast(`Could not read file: ${e.message}`, 'error');
  } finally { busy?.(); }
}

function toastBusy(msg) {
  const n = document.createElement('div');
  n.className = 'busy';
  n.innerHTML = `<span class="spinner"></span>${esc(msg)}`;
  document.body.appendChild(n);
  return () => n.remove();
}

async function fetchURL(url) {
  try { url = new URL(url, location.href).href; } catch { showLandingError({ message: 'That is not a valid URL', hint: '' }); return; }
  const btn = $('#btnFetch');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Fetching…';
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json, application/x-ndjson, text/plain;q=0.9, */*;q=0.8' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    const name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || new URL(url).hostname);
    loadText(text, { name });
  } catch (e) {
    showLanding();
    showLandingError({ message: `Couldn't fetch the URL: ${e.message}`, hint: 'The server must allow cross-origin requests (CORS). If it does not, download the file and open or drop it here instead.' });
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${icon('download')}Fetch`;
  }
}

// ── Landing ──────────────────────────────────────────────────────────────────

const validateInput = debounce(() => {
  const v = el.input.value;
  const status = el.inputStatus;
  el.inputErr.hidden = true;
  if (!v.trim()) { status.className = 'input-status'; status.textContent = ''; return; }
  if (v.length > 5_000_000) { status.className = 'input-status'; status.textContent = fmtBytes(byteLength(v)); return; }
  const r = smartParse(v);
  if (r.ok && r.format === 'json') { status.className = 'input-status ok'; status.innerHTML = `${icon('check')}Valid JSON · ${fmtBytes(byteLength(v))}`; }
  else if (r.ok) { status.className = 'input-status warn'; status.innerHTML = `${icon('wand')}${r.format === 'ndjson' ? 'JSON Lines' : 'Will be auto-repaired'}`; }
  else { status.className = 'input-status bad'; status.innerHTML = `${icon('alert')}${r.error.line ? `Line ${r.error.line}: ` : ''}${esc(r.error.message)}`; }
}, 250);

function inspectInput() {
  const text = el.input.value;
  if (!text.trim()) { el.input.focus(); toast('Paste some JSON first — or open a file, fetch a URL, or try a sample.', 'info'); return; }
  loadText(text, { name: 'Pasted JSON' });
}

async function renderRecent() {
  let items = [];
  try { items = await listRecent(); } catch { /* storage unavailable */ }
  const list = $('#recentList');
  $('#recentClear').hidden = !items.length;
  if (!items.length) {
    list.innerHTML = `<p class="empty-small">Documents you open show up here. They are stored only in this browser.</p>`;
    return;
  }
  list.innerHTML = items.map(x => `
    <div class="recent-item" data-id="${x.id}" role="button" tabindex="0">
      ${icon('file')}
      <div class="recent-main"><div class="recent-name">${esc(x.name)}</div>
      <div class="recent-meta">${x.format === 'ndjson' ? 'JSON Lines · ' : x.format === 'repaired' ? 'Repaired · ' : ''}${fmtBytes(x.size)} · ${esc(relTime(x.ts))}</div></div>
      <button class="icon-btn sm" data-del="${x.id}" title="Remove from recent" aria-label="Remove ${esc(x.name)} from recent">${icon('x')}</button>
    </div>`).join('');
}

async function openRecent(id) {
  const items = await listRecent();
  const meta = items.find(x => x.id === id);
  const text = await getRecentText(id);
  if (!meta || text == null) { toast('That document is no longer available', 'error'); renderRecent(); return; }
  loadText(text, { name: meta.name, recentId: id });
}

function renderSamples() {
  $('#sampleList').innerHTML = SAMPLES.map((s, i) => `
    <button class="sample" data-sample="${i}">${icon(s.icon)}<span><strong>${esc(s.name)}</strong><span>${esc(s.desc)}</span></span></button>`).join('');
}

function bindLanding() {
  el.input.addEventListener('input', validateInput);
  el.input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); inspectInput(); } });
  $('#btnInspect').addEventListener('click', inspectInput);
  $('#btnOpen').addEventListener('click', openFile);
  $('#btnUrl').addEventListener('click', () => {
    const row = $('#urlRow');
    row.hidden = !row.hidden;
    if (!row.hidden) $('#urlInput').focus();
  });
  $('#btnFetch').addEventListener('click', () => fetchURL($('#urlInput').value.trim()));
  $('#urlInput').addEventListener('keydown', e => { if (e.key === 'Enter') fetchURL(e.target.value.trim()); });
  $('#btnFormat').addEventListener('click', () => {
    const r = smartParse(el.input.value);
    if (r.ok) { el.input.value = JSON.stringify(r.data, null, 2); validateInput(); }
    else showLandingError(r.error);
  });
  $('#btnClearInput').addEventListener('click', () => { el.input.value = ''; validateInput(); el.input.focus(); });
  $('#btnCompare').addEventListener('click', () => {
    const r = el.input.value.trim() ? smartParse(el.input.value) : { ok: true, data: {}, format: 'json' };
    if (!r.ok) { showLandingError(r.error); return; }
    openDoc(r.data, { name: el.input.value.trim() ? 'Pasted JSON' : 'Untitled', format: r.format, save: !!el.input.value.trim(), text: el.input.value });
    setView('diff');
  });
  el.inputErr.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]');
    if (!g) return;
    const pos = +g.dataset.goto;
    el.input.focus();
    el.input.setSelectionRange(pos, pos + 1);
    const line = el.input.value.slice(0, pos).split('\n').length;
    el.input.scrollTop = Math.max(0, (line - 4) * parseFloat(getComputedStyle(el.input).lineHeight));
  });
  $('#recentList').addEventListener('click', async e => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); await deleteRecent(+del.dataset.del); renderRecent(); return; }
    const item = e.target.closest('.recent-item');
    if (item) openRecent(+item.dataset.id);
  });
  $('#recentList').addEventListener('keydown', e => {
    const item = e.target.closest('.recent-item');
    if (item && (e.key === 'Enter' || e.key === ' ') && e.target === item) { e.preventDefault(); openRecent(+item.dataset.id); }
  });
  $('#recentClear').addEventListener('click', async () => {
    const r = await modal({ title: 'Clear recent documents?', body: '<p>This removes every saved document from this browser. It cannot be undone.</p>', actions: [{ label: 'Cancel', value: null }, { label: 'Clear all', value: 'ok', primary: true, danger: true }] });
    if (r?.value === 'ok') { await clearRecent(); renderRecent(); }
  });
  $('#sampleList').addEventListener('click', e => {
    const b = e.target.closest('[data-sample]');
    if (!b) return;
    const s = SAMPLES[+b.dataset.sample];
    openDoc(structuredClone(s.data), { name: s.name, save: false });
  });
}

// ── Views ────────────────────────────────────────────────────────────────────

function setView(v) {
  if (!VIEWS.includes(v)) return;
  S.view = v;
  for (const sec of $$('.view')) sec.hidden = sec.dataset.view !== v;
  for (const b of $$('#viewTabs [data-view]')) { const on = b.dataset.view === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }
  el.treeBar.hidden = v !== 'tree';
  el.body.classList.toggle('no-insp-view', !INSPECTOR_VIEWS.has(v));
  SHOW[v]?.();
  if (v === 'tree') requestAnimationFrame(() => rebuild());
}

// ── Search ───────────────────────────────────────────────────────────────────

const ANCESTOR_EXPAND = 500;

function runSearch() {
  const q = el.q.value;
  const s = S.search;
  s.q = q.trim();
  const isPath = s.q.startsWith('$');
  el.qWrap.classList.toggle('path-mode', isPath);
  $('#qRegex').disabled = isPath;
  $('#qCase').disabled = isPath;
  if (!s.q || S.doc === undefined) { clearSearch(); return; }
  const r = findMatches(S.doc, s.q, { caseSensitive: s.caseSensitive, regex: s.regex, sort: S.sort });
  s.matches = r.matches;
  s.error = r.error;
  s.truncated = r.truncated;
  s.mode = r.mode;
  s.matchIds = new Set(r.matches.map(keyOf));
  s.visibleIds = s.filter ? visibleSet(r.matches) : null;
  const expandFor = s.filter ? r.matches : r.matches.slice(0, ANCESTOR_EXPAND);
  for (const segs of expandFor) for (let i = 0; i < segs.length; i++) S.expanded.add(keyOf(segs.slice(0, i)));
  s.idx = r.matches.length ? 0 : -1;
  emit('search');
  updateSearchInfo();
  if (s.idx >= 0) reveal(s.matches[0], { doSelect: false });
}

function updateSearchInfo() {
  const s = S.search;
  const info = el.qInfo;
  el.qWrap.classList.toggle('has-error', !!s.error);
  if (!s.q) { info.textContent = ''; info.title = ''; return; }
  if (s.error) { info.textContent = 'Invalid'; info.title = s.error; return; }
  info.title = '';
  info.textContent = s.matches.length ? `${s.idx + 1} / ${fmtNum(s.matches.length)}${s.truncated ? '+' : ''}` : 'No matches';
}

function stepSearch(d) {
  const s = S.search;
  if (!s.matches.length) return;
  s.idx = (s.idx + d + s.matches.length) % s.matches.length;
  updateSearchInfo();
  reveal(s.matches[s.idx]);
}

function clearSearch(doEmit = true) {
  const s = S.search;
  Object.assign(s, { q: '', matches: [], matchIds: new Set(), visibleIds: null, idx: -1, error: null, truncated: false });
  if (el.q) { el.q.value = ''; el.qWrap.classList.remove('path-mode', 'has-error'); el.qInfo.textContent = ''; $('#qRegex').disabled = false; $('#qCase').disabled = false; }
  if (doEmit) emit('search');
}

function bindSearch() {
  const debounced = debounce(runSearch, 160);
  el.q.addEventListener('input', debounced);
  el.q.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); debounced.cancel(); if (S.search.q !== el.q.value.trim()) runSearch(); else stepSearch(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); if (el.q.value) clearSearch(); else focusTree(); }
    else if (e.key === 'ArrowDown' && !S.search.matches.length) { e.preventDefault(); focusTree(); }
  });
  $('#qPrev').addEventListener('click', () => stepSearch(-1));
  $('#qNext').addEventListener('click', () => stepSearch(1));
  for (const [id, key] of [['#qCase', 'caseSensitive'], ['#qRegex', 'regex'], ['#qFilter', 'filter']]) {
    const b = $(id);
    b.addEventListener('click', () => {
      S.search[key] = !S.search[key];
      b.classList.toggle('on', S.search[key]);
      b.setAttribute('aria-pressed', S.search[key]);
      if (S.search.q) runSearch(); else emit('search');
    });
  }
  on('set-search', q => { setView('tree'); el.q.value = q; runSearch(); el.q.focus(); });
  on('doc', ({ reason }) => { if (reason !== 'load' && S.search.q) debounced(); });
}

// ── Header actions ───────────────────────────────────────────────────────────

function doUndo() { const l = undo(); toast(l ? `Undid: ${l}` : 'Nothing to undo', 'info', 1600); }
function doRedo() { const l = redo(); toast(l ? `Redid: ${l}` : 'Nothing to redo', 'info', 1600); }

function updateUndoButtons() {
  $('#btnUndo').disabled = !S.undo.length;
  $('#btnRedo').disabled = !S.redo.length;
  $('#btnUndo').title = S.undo.length ? `Undo: ${S.undo[S.undo.length - 1].label} (${modKey}+Z)` : 'Undo';
  $('#btnRedo').title = S.redo.length ? `Redo: ${S.redo[S.redo.length - 1].label} (${modKey}+Shift+Z)` : 'Redo';
}

const baseName = () => (S.name || 'data').replace(/\.(json5?|jsonl|ndjson|geojson|txt)$/i, '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'data';

function downloadDoc(minified = false) {
  download(`${baseName()}.json`, minified ? JSON.stringify(S.doc) : stringifyDoc() + '\n');
  toast('Download started', 'success', 1500);
}

async function share() {
  const text = JSON.stringify(S.doc);
  let enc;
  try { enc = await encodeShare(text); } catch { toast('Sharing is not supported in this browser', 'error'); return; }
  if (enc.length > MAX_SHARE_CHARS) { toast(`This document is too large for a share link (${fmtBytes(enc.length)} compressed; the limit is ${fmtBytes(MAX_SHARE_CHARS)}).`, 'error', 5000); return; }
  const url = `${location.origin}${location.pathname}#z=${enc}`;
  const r = await modal({
    title: 'Share link',
    body: `<p>The document is compressed into the link itself — nothing is uploaded to a server. Anyone with the link can open it.</p>
      <input class="input code" readonly value="${esc(url)}" aria-label="Share link">
      <p class="dim small">${fmtBytes(text.length)} → ${fmtNum(url.length)} characters</p>`,
    actions: [{ label: 'Close', value: null }, { label: 'Copy link', value: 'copy', primary: true }],
  });
  if (r?.value === 'copy') copy(url, 'Link copied');
}

function downloadMenu(x, y, btn) {
  openMenu([
    { label: 'Download JSON', icon: 'download', kbd: `${modKey}S`, action: () => downloadDoc(false) },
    { label: 'Download minified', icon: 'download', action: () => downloadDoc(true) },
    '-',
    { label: 'Copy formatted JSON', icon: 'copy', action: () => copy(stringifyDoc(), 'JSON copied') },
    { label: 'Copy minified JSON', icon: 'copy', action: () => copy(JSON.stringify(S.doc), 'Minified JSON copied') },
    '-',
    { label: 'Generate types…', icon: 'sparkles', action: () => setView('generate') },
  ], x, y, { returnFocus: btn });
}

function showShortcuts() {
  const row = (k, d) => `<div class="sc-row"><span>${d}</span><span>${k.split(' ').map(x => `<kbd>${esc(x)}</kbd>`).join(' ')}</span></div>`;
  modal({
    title: 'Keyboard shortcuts',
    wide: true,
    body: `<div class="sc-grid">
      <section><h4>General</h4>
        ${row(`${modKey} O`, 'Open file')}${row(`${modKey} S`, 'Download JSON')}${row(`${modKey} Z`, 'Undo')}${row(`${modKey} ⇧ Z`, 'Redo')}
        ${row('1 – 5', 'Switch view')}${row('?', 'Show shortcuts')}${row(`${modKey} ↵`, 'Inspect / apply / compare')}</section>
      <section><h4>Search</h4>
        ${row('/', 'Focus search')}${row(`${modKey} F`, 'Focus search')}${row('↵', 'Next match')}${row('⇧ ↵', 'Previous match')}${row('Esc', 'Clear search')}</section>
      <section><h4>Tree</h4>
        ${row('↑ ↓', 'Move selection')}${row('→ ←', 'Expand / collapse')}${row('↵', 'Toggle or edit')}${row('*', 'Expand subtree')}
        ${row('E', 'Expand all')}${row('C', 'Collapse all')}${row('F2', 'Edit value')}${row('Del', 'Delete node')}${row(`${modKey} C`, 'Copy value')}${row('⌥ click', 'Toggle recursively')}</section>
      <section><h4>JSONPath examples</h4>
        <div class="jp-ex">${['$.store.book[*].author', '$..price', '$..book[?(@.price < 10)]', "$..*[?(@.email =~ /example/)]", '$.items[-1]', '$.items[0:5]'].map(x => `<code>${esc(x)}</code>`).join('')}</div></section>
    </div>`,
  });
}

// ── Status bar ───────────────────────────────────────────────────────────────

function renderCrumbs() {
  const c = el.crumbs;
  const segs = S.selected;
  if (!segs) { c.innerHTML = '<span class="dim">No selection</span>'; return; }
  const parts = [`<button class="crumb" data-n="0">root</button>`];
  segs.forEach((s, i) => parts.push(`${icon('chevron', 'crumb-sep')}<button class="crumb${i === segs.length - 1 ? ' last' : ''}" data-n="${i + 1}">${esc(typeof s === 'number' ? `[${s}]` : s)}</button>`));
  c.innerHTML = parts.join('');
  c.scrollLeft = c.scrollWidth;
}

const TYPE_ORDER = ['object', 'array', 'string', 'number', 'boolean', 'null'];
const renderStats = debounce(() => {
  if (S.doc === undefined) return;
  const st = stats(S.doc);
  const bar = TYPE_ORDER.filter(t => st.counts[t]).map(t => `<span class="seg-${t}" style="flex:${st.counts[t]}" title="${t}: ${fmtNum(st.counts[t])}"></span>`).join('');
  const size = st.total < 2_000_000 ? ` · ${fmtBytes(byteLength(JSON.stringify(S.doc)))}` : '';
  el.stats.innerHTML = `<span class="type-bar" aria-hidden="true">${bar}</span><span>${fmtNum(st.total)} nodes · depth ${st.depth}${size}</span>`;
  el.stats.title = TYPE_ORDER.map(t => `${t}: ${fmtNum(st.counts[t])}`).join('\n');
}, 200);

function renderDocName() {
  $('#docName').textContent = S.name;
  const badge = $('#docBadge');
  badge.hidden = S.format === 'json';
  badge.textContent = S.format === 'ndjson' ? 'JSON Lines' : 'Repaired';
  document.title = `${S.name} — JSON Inspector`;
}

// ── Layout: inspector resize/toggle ──────────────────────────────────────────

function bindLayout() {
  let w = store.get('inspW', 360);
  let open = store.get('inspOpen', true);
  const apply = () => {
    el.body.style.setProperty('--insp-w', w + 'px');
    el.body.classList.toggle('no-insp', !open);
    $('#btnInspector').classList.toggle('on', open);
    $('#btnInspector').setAttribute('aria-pressed', open);
  };
  apply();
  $('#btnInspector').addEventListener('click', () => { open = !open; store.set('inspOpen', open); apply(); });
  const rz = $('#resizer');
  rz.addEventListener('pointerdown', e => {
    e.preventDefault();
    rz.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    const right = el.body.getBoundingClientRect().right;
    const move = ev => { w = Math.round(Math.max(260, Math.min(Math.min(760, innerWidth * 0.6), right - ev.clientX))); el.body.style.setProperty('--insp-w', w + 'px'); };
    const up = () => { rz.removeEventListener('pointermove', move); document.body.classList.remove('resizing'); store.set('inspW', w); };
    rz.addEventListener('pointermove', move);
    rz.addEventListener('pointerup', up, { once: true });
    rz.addEventListener('pointercancel', up, { once: true });
  });
  rz.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      w = Math.max(260, Math.min(760, w + (e.key === 'ArrowLeft' ? 24 : -24)));
      store.set('inspW', w);
      apply();
    }
  });
}

// ── Global input: keyboard, drag & drop, paste ───────────────────────────────

function bindKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || document.querySelector('dialog[open]') || document.querySelector('.menu')) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    const inWs = !el.workspace.hidden;
    if (mod && k === 'o') { e.preventDefault(); openFile(); return; }
    if (!inWs) return;
    if (mod && k === 's') { e.preventDefault(); downloadDoc(); return; }
    if (mod && k === 'f' && !(S.view === 'raw' && isRawEditing())) { e.preventDefault(); setView('tree'); el.q.focus(); el.q.select(); return; }
    if (typing) return;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && k === 'y') { e.preventDefault(); doRedo(); return; }
    if (mod || e.altKey) return;
    if (/^[1-5]$/.test(e.key)) { setView(VIEWS[+e.key - 1]); return; }
    switch (e.key) {
      case '/': e.preventDefault(); setView('tree'); el.q.focus(); break;
      case '?': showShortcuts(); break;
      case 'e': if (S.view === 'tree') expandAll(); break;
      case 'c': if (S.view === 'tree') collapseAll(); break;
      case 'Escape': if (S.search.q) clearSearch(); break;
    }
  });
}

function bindDrop() {
  let depth = 0;
  const drop = $('#drop');
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; drop.classList.add('on'); });
  document.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; drop.classList.remove('on'); } });
  document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    drop.classList.remove('on');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (S.view === 'diff' && !el.workspace.hidden) { f.text().then(t => import('./views/diff.js').then(m => m.setDiffB(t))); return; }
    loadFile(f);
  });
}

function bindPaste() {
  document.addEventListener('paste', e => {
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable || el.landing.hidden) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text?.trim()) return;
    e.preventDefault();
    el.input.value = text;
    validateInput();
    loadText(text, { name: 'Pasted JSON' });
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  hydrateIcons();
  Object.assign(el, {
    landing: $('#landing'), workspace: $('#workspace'), input: $('#input'), inputErr: $('#inputErr'), inputStatus: $('#inputStatus'),
    body: $('#wsBody'), treeBar: $('#treeBar'), q: $('#q'), qWrap: $('#qWrap'), qInfo: $('#qInfo'), crumbs: $('#crumbs'), stats: $('#stats'),
  });
  $('#kbdHint').textContent = `${modKey}↵`;

  applyTheme(store.get('theme', 'system'));
  $('#btnTheme').addEventListener('click', () => applyTheme(THEMES[(THEMES.indexOf(store.get('theme', 'system')) + 1) % THEMES.length]));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(store.get('theme', 'system')));

  initTree($('#tree'), { onMenu: (segs, x, y) => openMenu(A.nodeMenu(segs), x, y, { returnFocus: $('#tree') }) });
  initInspector($('#inspector'));
  initRaw($('.view[data-view="raw"]'));
  initTable($('.view[data-view="table"]'));
  initDiff($('.view[data-view="diff"]'));
  initGenerate($('.view[data-view="generate"]'));

  on('select', renderCrumbs);
  on('doc', () => { updateUndoButtons(); renderStats(); });
  on('load', () => { renderDocName(); renderCrumbs(); });
  on('set-view', setView);
  on('reveal', segs => { setView('tree'); reveal(segs, { focus: true }); });
  on('request-delete', segs => A.remove(segs));
  on('request-copy', segs => A.copyValue(segs));
  on('request-edit', segs => {
    if (!store.get('inspOpen', true)) $('#btnInspector').click();
    if (S.view !== 'tree' && S.view !== 'table') setView('tree');
  });

  // Persist edits into the recent list so work survives a reload.
  const autosave = debounce(() => {
    if (S.doc === undefined) return;
    const text = JSON.stringify(S.doc);
    saveRecent({ id: S.recentId, name: S.name, text, format: S.format }).then(id => { if (id != null) S.recentId = id; }).catch(() => {});
  }, 1500);
  on('doc', ({ reason }) => { if (reason === 'edit' || reason === 'history') autosave(); });

  $('#viewTabs').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
  $('#viewTabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = VIEWS.indexOf(S.view) + (e.key === 'ArrowRight' ? 1 : -1);
    setView(VIEWS[(i + VIEWS.length) % VIEWS.length]);
    $(`#viewTabs [data-view="${S.view}"]`).focus();
  });
  $('#btnUndo').addEventListener('click', doUndo);
  $('#btnRedo').addEventListener('click', doRedo);
  $('#btnShare').addEventListener('click', share);
  $('#btnDownload').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); downloadMenu(r.right - 220, r.bottom + 6, e.currentTarget); });
  $('#btnShortcuts').addEventListener('click', showShortcuts);
  $('#btnNew').addEventListener('click', () => { showLanding(); el.input.focus(); });
  $('#brand').addEventListener('click', e => { e.preventDefault(); if (S.doc !== undefined && el.landing.hidden) showLanding(); });
  $('#docName').addEventListener('click', async () => {
    const n = await prompt({ title: 'Rename document', label: 'Name (used for downloads)', value: S.name, okLabel: 'Rename' });
    if (n?.trim()) { S.name = n.trim(); renderDocName(); autosave(); }
  });
  $('#btnExpand').addEventListener('click', () => expandAll());
  $('#btnCollapse').addEventListener('click', () => collapseAll());
  const sortSel = $('#sortSel');
  sortSel.value = S.sort;
  sortSel.addEventListener('change', () => { S.sort = sortSel.value; store.set('sort', S.sort); if (S.search.q) runSearch(); emit('doc', { reason: 'sort' }); });
  el.crumbs.addEventListener('click', e => {
    const b = e.target.closest('.crumb');
    if (b && S.selected) { setView('tree'); reveal(S.selected.slice(0, +b.dataset.n), { focus: true }); }
  });

  bindLanding();
  bindSearch();
  bindLayout();
  bindKeyboard();
  bindDrop();
  bindPaste();
  renderSamples();

  // Entry points: share link, ?url=, PWA file handler.
  const params = new URLSearchParams(location.search);
  if (location.hash.startsWith('#z=')) {
    try {
      const text = await decodeShare(location.hash.slice(3));
      history.replaceState(null, '', location.pathname + location.search);
      loadText(text, { name: 'Shared document' });
    } catch {
      showLanding();
      toast('This share link is damaged or incomplete', 'error', 5000);
    }
  } else if (params.get('url')) {
    showLanding();
    $('#urlRow').hidden = false;
    $('#urlInput').value = params.get('url');
    fetchURL(params.get('url'));
  } else {
    showLanding();
    if (params.has('sample')) openDoc(structuredClone(SAMPLES[+params.get('sample') || 0].data), { name: SAMPLES[+params.get('sample') || 0].name, save: false });
  }

  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async p => { if (p.files?.length) loadFile(await p.files[0].getFile()); });
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  document.documentElement.classList.add('ready');
}

boot();

// Exposed for debugging in the console.
window.jsonInspector = { get doc() { return S.doc; }, S, getAt, typeOf, select };
