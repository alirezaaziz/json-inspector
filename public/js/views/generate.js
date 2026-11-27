import { S, on } from '../state.js';
import { getAt, toJSONPath } from '../path.js';
import { esc, store, highlightJSON, fmtBytes, byteLength } from '../util.js';
import { GENERATORS, pascal } from '../generate.js';
import { icon } from '../icons.js';
import { copy, download, toast } from '../ui.js';

let el, outEl, infoEl, nameEl;
let fmt = store.get('genFormat', 'typescript');
let source = 'doc';
let dirty = true;
let output = '';

export function initGenerate(root) {
  el = root;
  el.innerHTML = `
    <div class="view-bar">
      <div class="seg wrap" role="tablist" aria-label="Output format">
        ${Object.entries(GENERATORS).map(([k, g]) => `<button class="seg-btn${k === fmt ? ' on' : ''}" data-fmt="${k}" role="tab" aria-selected="${k === fmt}">${g.label}</button>`).join('')}
      </div>
      <span class="grow"></span>
      <label class="select-wrap sm">From <select id="genSource"><option value="doc">Whole document</option><option value="sel">Selected node</option></select></label>
      <label class="name-field sm" title="Name of the root type">Root <input id="genName" class="input sm" value="Root" spellcheck="false" autocomplete="off"></label>
    </div>
    <div class="gen-out">
      <div class="gen-toolbar"><span class="dim small" id="genInfo"></span><span class="grow"></span>
        <button class="btn sm" data-act="copy">${icon('copy')}Copy</button>
        <button class="btn sm" data-act="download">${icon('download')}Download</button></div>
      <pre class="code gen-code" id="genOut"></pre>
    </div>`;
  outEl = el.querySelector('#genOut');
  infoEl = el.querySelector('#genInfo');
  nameEl = el.querySelector('#genName');
  el.querySelector('#genSource').addEventListener('change', e => { source = e.target.value; render(); });
  nameEl.addEventListener('input', () => render());
  el.addEventListener('click', onClick);
  on('doc', () => { dirty = true; if (S.view === 'generate') render(); });
  on('select', () => { if (S.view === 'generate' && source === 'sel') render(); else if (source === 'sel') dirty = true; });
}

export function showGenerate() { if (dirty) render(); }

function render() {
  dirty = false;
  const segs = source === 'sel' && S.selected ? S.selected : [];
  const value = segs.length ? getAt(S.doc, segs) : S.doc;
  const name = pascal(nameEl.value.trim() || 'Root');
  const g = GENERATORS[fmt];
  try {
    output = g.run(value, name);
    outEl.innerHTML = fmt === 'schema' ? highlightJSON(output) : esc(output);
    outEl.classList.remove('err');
    infoEl.textContent = `${g.label} · from ${segs.length ? toJSONPath(segs) : 'the whole document'} · ${output.split('\n').length - 1} lines · ${fmtBytes(byteLength(output))}`;
  } catch (e) {
    output = '';
    outEl.textContent = e.message;
    outEl.classList.add('err');
    infoEl.textContent = '';
  }
}

function onClick(e) {
  const f = e.target.closest('[data-fmt]');
  if (f) {
    fmt = f.dataset.fmt;
    store.set('genFormat', fmt);
    el.querySelectorAll('[data-fmt]').forEach(b => { b.classList.toggle('on', b === f); b.setAttribute('aria-selected', b === f); });
    render();
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!output) return;
  if (act === 'copy') copy(output, `${GENERATORS[fmt].label} copied`);
  else if (act === 'download') {
    const base = (S.name || 'data').replace(/\.[^.]+$/, '');
    download(`${base}.${GENERATORS[fmt].ext}`, output, GENERATORS[fmt].mime);
    toast('Downloaded', 'success', 1500);
  }
}
