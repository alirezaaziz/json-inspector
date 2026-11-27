import { S, on, emit } from '../state.js';
import { toJSONPath, getAt } from '../path.js';
import { esc, preview, store, modKey } from '../util.js';
import { smartParse } from '../parse.js';
import { diff } from '../diff.js';
import { icon } from '../icons.js';
import { pickFile, toast } from '../ui.js';

let el, taA, taB, resEl, sumEl;
let arrays = store.get('diffArrays', 'smart');
let last = null;
let show = { add: true, remove: true, change: true };
let initialized = false;

export function initDiff(root) {
  el = root;
  el.innerHTML = `
    <div class="diff-inputs">
      <div class="diff-pane">
        <div class="pane-head"><span class="pane-tag a">A</span><span class="pane-title">Original</span><span class="grow"></span>
          <button class="btn xs" data-act="use-current" title="Load the current document into A">${icon('braces')}Current doc</button>
          <button class="btn xs" data-act="open-a">${icon('upload')}Open</button></div>
        <textarea class="input code" id="diffA" spellcheck="false" placeholder="Paste the original JSON…"></textarea>
        <p class="pane-err" id="diffErrA" hidden></p>
      </div>
      <div class="diff-mid"><button class="icon-btn" data-act="swap" title="Swap A and B" aria-label="Swap A and B">${icon('swap')}</button></div>
      <div class="diff-pane">
        <div class="pane-head"><span class="pane-tag b">B</span><span class="pane-title">Modified</span><span class="grow"></span>
          <button class="btn xs" data-act="open-b">${icon('upload')}Open</button></div>
        <textarea class="input code" id="diffB" spellcheck="false" placeholder="Paste the JSON to compare against…"></textarea>
        <p class="pane-err" id="diffErrB" hidden></p>
      </div>
    </div>
    <div class="view-bar">
      <div class="seg" role="group" aria-label="Array comparison">
        <button class="seg-btn${arrays === 'smart' ? ' on' : ''}" data-arrays="smart" title="Detect inserted and removed items">Smart arrays</button>
        <button class="seg-btn${arrays === 'index' ? ' on' : ''}" data-arrays="index" title="Compare items position by position">By index</button>
      </div>
      <div class="diff-sum" id="diffSum"></div>
      <span class="grow"></span>
      <button class="btn sm primary" data-act="compare">${icon('diff')}Compare <kbd>${modKey}↵</kbd></button>
    </div>
    <div class="diff-results" id="diffRes"><div class="empty-note">${icon('diff')}<p>Compare two JSON documents structurally — key order and formatting are ignored.</p></div></div>`;
  taA = el.querySelector('#diffA');
  taB = el.querySelector('#diffB');
  resEl = el.querySelector('#diffRes');
  sumEl = el.querySelector('#diffSum');
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); compare(); } });
  on('load', () => { initialized = false; last = null; });
}

export function showDiff() {
  if (!initialized) {
    initialized = true;
    taA.value = JSON.stringify(S.doc, null, 2);
    if (!taB.value) setTimeout(() => taB.focus(), 0);
  }
}

export function setDiffB(text) { showDiff(); taB.value = text; compare(); }

function parseSide(ta, errId) {
  const err = el.querySelector(errId);
  const r = smartParse(ta.value);
  if (r.ok) { err.hidden = true; return r; }
  err.hidden = false;
  err.textContent = `${r.error.line ? `Line ${r.error.line}, col ${r.error.col}: ` : ''}${r.error.message}`;
  return null;
}

function compare() {
  const a = parseSide(taA, '#diffErrA');
  const b = parseSide(taB, '#diffErrB');
  if (!a || !b) return;
  const t0 = performance.now();
  const r = diff(a.data, b.data, { arrays });
  last = { ...r, aIsDoc: JSON.stringify(a.data) === JSON.stringify(S.doc), ms: performance.now() - t0 };
  renderResults();
}

function renderResults() {
  if (!last) return;
  const c = { add: 0, remove: 0, change: 0 };
  for (const x of last.changes) c[x.op]++;
  sumEl.innerHTML = last.changes.length
    ? ['add', 'remove', 'change'].map(op => `<button class="chip op-${op}${show[op] ? ' on' : ''}" data-toggle="${op}">${op === 'add' ? '+' : op === 'remove' ? '−' : '~'} ${c[op]} ${op === 'add' ? 'added' : op === 'remove' ? 'removed' : 'changed'}</button>`).join('')
    : '';
  if (!last.changes.length) {
    resEl.innerHTML = `<div class="empty-note good">${icon('check')}<p>No differences — the documents are structurally identical.</p></div>`;
    return;
  }
  const rows = last.changes.filter(x => show[x.op]);
  resEl.innerHTML = rows.slice(0, 3000).map((x, i) => {
    const sym = x.op === 'add' ? '+' : x.op === 'remove' ? '−' : '~';
    const vals = x.op === 'change'
      ? `<span class="dv old">${esc(preview(x.a, 120))}</span>${icon('arrowRight', 'arrow')}<span class="dv new">${esc(preview(x.b, 120))}</span>`
      : `<span class="dv ${x.op === 'add' ? 'new' : 'old'}">${esc(preview(x.op === 'add' ? x.b : x.a, 160))}</span>`;
    const canReveal = last.aIsDoc && x.op !== 'add' && getAt(S.doc, x.segs) !== undefined;
    return `<div class="dl op-${x.op}${canReveal ? ' link' : ''}" data-n="${last.changes.indexOf(x)}"${canReveal ? ' title="Show in tree"' : ''}><span class="op">${sym}</span><code class="dp">${esc(toJSONPath(x.segs))}</code>${vals}</div>`;
  }).join('') + (rows.length > 3000 || last.truncated ? `<div class="dim small pad">Showing the first ${Math.min(rows.length, 3000).toLocaleString()} differences.</div>` : '');
}

async function loadInto(ta) {
  const f = await pickFile();
  if (!f) return;
  ta.value = await f.text();
  if (taA.value.trim() && taB.value.trim()) compare();
}

function onClick(e) {
  const tg = e.target.closest('[data-toggle]');
  if (tg) { show[tg.dataset.toggle] = !show[tg.dataset.toggle]; renderResults(); return; }
  const ar = e.target.closest('[data-arrays]');
  if (ar) {
    arrays = ar.dataset.arrays;
    store.set('diffArrays', arrays);
    el.querySelectorAll('[data-arrays]').forEach(b => b.classList.toggle('on', b === ar));
    if (last) compare();
    return;
  }
  const row = e.target.closest('.dl.link');
  if (row) { emit('reveal', last.changes[+row.dataset.n].segs); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  switch (act) {
    case 'compare': compare(); break;
    case 'swap': [taA.value, taB.value] = [taB.value, taA.value]; if (last) compare(); break;
    case 'use-current': taA.value = JSON.stringify(S.doc, null, 2); toast('Loaded the current document into A', 'info', 1500); break;
    case 'open-a': loadInto(taA); break;
    case 'open-b': loadInto(taB); break;
  }
}
