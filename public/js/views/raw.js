import { S, on, commit } from '../state.js';
import { highlightJSON, esc, debounce, store, fmtBytes, byteLength, modKey } from '../util.js';
import { smartParse } from '../parse.js';
import { icon } from '../icons.js';
import { copy, toast } from '../ui.js';

const MAX_HL_LINES = 40_000;
const MAX_HL_CHARS = 4_000_000;

let el, body, statusEl, dirty = true, editing = false;
let indent = store.get('indent', '2');
let wrap = store.get('wrap', false);

const indentValue = () => (indent === 'tab' ? '\t' : indent === '0' ? undefined : Number(indent));
export const stringifyDoc = (v = S.doc) => JSON.stringify(v, null, indentValue());

export function initRaw(root) {
  el = root;
  el.innerHTML = `
    <div class="view-bar">
      <div class="seg" role="group" aria-label="Indentation">
        ${[['2', '2 spaces'], ['4', '4 spaces'], ['tab', 'Tabs'], ['0', 'Minified']].map(([v, l]) => `<button class="seg-btn${v === indent ? ' on' : ''}" data-indent="${v}">${l}</button>`).join('')}
      </div>
      <label class="check"><input type="checkbox" id="rawWrap"${wrap ? ' checked' : ''}> Wrap lines</label>
      <span class="grow"></span>
      <span class="raw-status dim small" id="rawStatus"></span>
      <button class="btn sm" data-act="copy">${icon('copy')}Copy</button>
      <button class="btn sm primary" data-act="edit">${icon('pencil')}Edit</button>
    </div>
    <div class="raw-body"></div>`;
  body = el.querySelector('.raw-body');
  statusEl = el.querySelector('#rawStatus');
  el.addEventListener('click', onClick);
  el.querySelector('#rawWrap').addEventListener('change', e => { wrap = e.target.checked; store.set('wrap', wrap); body.classList.toggle('wrap', wrap); });
  body.classList.toggle('wrap', wrap);
  on('doc', () => { if (!editing) { dirty = true; if (S.view === 'raw') render(); } });
  on('load', () => { editing = false; dirty = true; });
}

export function showRaw() { if (dirty && !editing) render(); }

function render() {
  dirty = false;
  const text = stringifyDoc();
  const lines = text.split('\n');
  statusEl.textContent = `${lines.length.toLocaleString()} lines · ${fmtBytes(byteLength(text))}`;
  if (text.length > MAX_HL_CHARS || lines.length > MAX_HL_LINES) {
    body.innerHTML = '<pre class="code raw plain"></pre>';
    body.firstChild.textContent = text;
    return;
  }
  body.innerHTML = `<pre class="code raw" style="--gutter:${String(lines.length).length + 1}ch">${lines.map(l => `<span class="ln">${highlightJSON(l) || ' '}</span>`).join('')}</pre>`;
}

function setIndent(v) {
  indent = v;
  store.set('indent', v);
  el.querySelectorAll('[data-indent]').forEach(b => b.classList.toggle('on', b.dataset.indent === v));
  if (editing) {
    const ta = body.querySelector('textarea');
    const r = smartParse(ta.value);
    if (r.ok) ta.value = stringifyDoc(r.data);
    else toast('Fix the JSON errors before reformatting', 'error');
  } else render();
}

function startEdit() {
  editing = true;
  const text = stringifyDoc();
  body.innerHTML = `
    <textarea class="code raw-edit" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Edit JSON"></textarea>
    <div class="raw-edit-bar">
      <span class="raw-valid" id="rawValid"></span>
      <span class="grow"></span>
      <button class="btn sm" data-act="cancel">Cancel</button>
      <button class="btn sm primary" data-act="apply">${icon('check')}Apply <kbd>${modKey}↵</kbd></button>
    </div>`;
  el.querySelector('[data-act="edit"]').hidden = true;
  const ta = body.querySelector('textarea');
  ta.value = text;
  ta.focus();
  ta.setSelectionRange(0, 0);
  ta.scrollTop = 0;
  const validate = debounce(() => {
    const v = el.querySelector('#rawValid');
    if (!v) return;
    if (ta.value.length > 8_000_000) { v.textContent = ''; return; }
    const r = smartParse(ta.value);
    if (r.ok && r.format === 'json') { v.className = 'raw-valid ok'; v.innerHTML = `${icon('check')}Valid JSON`; }
    else if (r.ok) { v.className = 'raw-valid warn'; v.innerHTML = `${icon('wand')}${esc(r.warnings[0] || 'Will be repaired on apply')}`; }
    else {
      v.className = 'raw-valid bad';
      v.innerHTML = `${icon('alert')}<button class="link-btn" data-goto="${r.error.pos ?? ''}">${r.error.line ? `Line ${r.error.line}, col ${r.error.col}: ` : ''}${esc(r.error.message)}</button>`;
    }
  }, 250);
  ta.addEventListener('input', validate);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); apply(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopEdit(); }
    else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertText', false, indent === 'tab' ? '\t' : ' '.repeat(Number(indent) || 2));
    }
  });
  validate();
}

function stopEdit() {
  editing = false;
  el.querySelector('[data-act="edit"]').hidden = false;
  render();
}

function apply() {
  const ta = body.querySelector('textarea');
  const r = smartParse(ta.value);
  if (!r.ok) { toast(`Can't apply: ${r.error.message}`, 'error', 4000); return; }
  editing = false;
  el.querySelector('[data-act="edit"]').hidden = false;
  commit(r.data, 'Edit raw JSON');
  dirty = true;
  render();
  toast(r.format === 'json' ? 'Changes applied' : r.warnings[0], 'success');
}

function onClick(e) {
  const ind = e.target.closest('[data-indent]');
  if (ind) { setIndent(ind.dataset.indent); return; }
  const g = e.target.closest('[data-goto]');
  if (g && g.dataset.goto !== '') {
    const ta = body.querySelector('textarea');
    const pos = +g.dataset.goto;
    ta.focus();
    ta.setSelectionRange(pos, Math.min(pos + 1, ta.value.length));
    const line = ta.value.slice(0, pos).split('\n').length;
    ta.scrollTop = Math.max(0, (line - 5) * parseFloat(getComputedStyle(ta).lineHeight));
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'copy') copy(editing ? body.querySelector('textarea').value : stringifyDoc(), 'JSON copied');
  else if (act === 'edit') startEdit();
  else if (act === 'cancel') stopEdit();
  else if (act === 'apply') apply();
}

export const isRawEditing = () => editing;
