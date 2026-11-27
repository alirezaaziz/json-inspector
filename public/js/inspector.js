import { S, on } from './state.js';
import { getAt, toJSONPath, toPointer, toBracket, toJS } from './path.js';
import { typeOf, esc, fmtBytes, byteLength, highlightJSON, stats, fmtNum, relTime, modKey } from './util.js';
import { smartParse } from './parse.js';
import { icon } from './icons.js';
import { copy, toast } from './ui.js';
import * as A from './actions.js';

let el;
let copies = [];
let editing = false;

export function initInspector(root) {
  el = root;
  on('select', () => { editing = false; render(); });
  on('doc', () => { editing = false; render(); });
  on('request-edit', segs => { if (S.selected && segs.join() === S.selected.join()) { editing = true; render(); } });
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  render();
}

const PREVIEW_LIMIT = 200_000;
const HUGE_NODES = 150_000;

function keyLabel(segs) {
  if (!segs.length) return 'root';
  const k = segs[segs.length - 1];
  return typeof k === 'number' ? `[${k}]` : k;
}

function detectors(v, t, segs) {
  const cards = [];
  if (t === 'string') {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) {
      const d = new Date(s);
      if (!isNaN(d)) cards.push(card('calendar', 'Date', `${esc(d.toLocaleString())}<span class="dim"> · ${esc(relTime(d.getTime()))}</span>`));
    }
    if (/^https?:\/\/[^\s]+$/i.test(s)) {
      cards.push(card('external', 'URL', `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer nofollow">${esc(s.length > 60 ? s.slice(0, 60) + '…' : s)}</a>`));
    }
    if (/^(#[0-9a-f]{3,8}|rgba?\(.+\)|hsla?\(.+\))$/i.test(s) && CSS.supports('color', s)) {
      cards.push(card('palette', 'Color', `<span class="swatch lg" style="background:${esc(s)}"></span> ${esc(s)}`));
    }
    const jwt = decodeJWT(s);
    if (jwt) {
      const exp = typeof jwt.payload.exp === 'number' ? new Date(jwt.payload.exp * 1000) : null;
      cards.push(card('key', 'JSON Web Token',
        `${exp ? `<div class="${exp < Date.now() ? 'bad' : 'good'}">${exp < Date.now() ? 'Expired' : 'Expires'} ${esc(relTime(exp.getTime()))}</div>` : ''}
         <div class="dim small">Header</div><pre class="code mini">${highlightJSON(JSON.stringify(jwt.header, null, 2))}</pre>
         <div class="dim small">Payload</div><pre class="code mini">${highlightJSON(JSON.stringify(jwt.payload, null, 2))}</pre>
         <div class="dim small">Signature is not verified.</div>`));
    }
    if (/^\s*[[{]/.test(v) && v.length < 5_000_000) {
      const r = smartParse(v);
      if (r.ok && r.data !== null && typeof r.data === 'object') {
        cards.push(card('wand', 'Embedded JSON', `This string contains JSON. <button class="link-btn" data-act="parse-embedded">Expand it into the tree</button>`));
      }
    }
  }
  if (t === 'number' && Number.isInteger(v)) {
    const ms = v > 1e9 && v < 4e9 ? v * 1000 : v > 1e12 && v < 4e12 ? v : null;
    if (ms) cards.push(card('clock', 'As Unix timestamp', `${esc(new Date(ms).toLocaleString())}<span class="dim"> · ${esc(relTime(ms))}</span>`));
  }
  return cards.join('');
}

function card(ic, title, body) {
  return `<div class="det">${icon(ic)}<div><div class="det-title">${esc(title)}</div><div class="det-body">${body}</div></div></div>`;
}

function decodeJWT(s) {
  if (!/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const dec = p => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((p.length + 3) % 4)), c => c.charCodeAt(0))));
    const [h, p] = s.split('.');
    const header = dec(h), payload = dec(p);
    return header && typeof header === 'object' && header.alg ? { header, payload } : null;
  } catch { return null; }
}

function render() {
  if (!el || S.doc === undefined) return;
  copies = [];
  const segs = S.selected;
  if (!segs) {
    el.innerHTML = `<div class="insp-empty">${icon('tree')}<p>Select a node to inspect its value, paths and type.</p>
      <p class="dim small">Use <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>→</kbd> <kbd>←</kbd> to expand and collapse, and right-click for actions.</p></div>`;
    return;
  }
  const v = getAt(S.doc, segs);
  if (v === undefined) { el.innerHTML = ''; return; }
  const t = typeOf(v);
  const cont = t === 'object' || t === 'array';
  const parent = segs.length ? getAt(S.doc, segs.slice(0, -1)) : null;

  let sub = '';
  let pretty = '';
  let huge = false;
  if (cont) {
    const st = stats(v);
    huge = st.total > HUGE_NODES;
    const count = `${fmtNum(t === 'array' ? v.length : Object.keys(v).length)} ${t === 'array' ? 'items' : 'keys'} · ${fmtNum(st.total - 1)} descendants · depth ${st.depth}`;
    if (huge) sub = count;
    else { pretty = JSON.stringify(v, null, 2); sub = `${count} · ${fmtBytes(byteLength(pretty))}`; }
  } else if (t === 'string') sub = `${fmtNum(v.length)} characters`;

  const paths = [
    ['JSONPath', toJSONPath(segs)],
    ['Pointer', toPointer(segs) || '/'],
    ['Bracket', toBracket(segs)],
    ['JavaScript', toJS(segs)],
  ];
  const valueTxt = cont ? pretty : t === 'string' ? v : String(v);
  const copyId = txt => { copies.push(txt); return copies.length - 1; };

  const valueBlock = huge
    ? `<p class="dim small">This value is large — the preview is hidden to keep things fast. Use Copy, or the Raw view.</p>`
    : cont
    ? `<pre class="code insp-value">${pretty.length > PREVIEW_LIMIT ? esc(pretty.slice(0, PREVIEW_LIMIT)) + '\n…' : highlightJSON(pretty)}</pre>`
    : `<pre class="code insp-value v-${t}">${esc(valueTxt)}</pre>`;

  el.innerHTML = `
    <div class="insp-head">
      <div class="insp-title"><span class="insp-key" title="${esc(keyLabel(segs))}">${esc(keyLabel(segs))}</span><span class="badge t-${t}">${t}</span></div>
      ${sub ? `<div class="insp-sub">${sub}</div>` : ''}
    </div>
    <section class="insp-sec">
      <h3>Path</h3>
      <div class="paths">${paths.map(([l, p]) => `<div class="path-row"><span class="path-l">${l}</span><code title="${esc(p)}">${esc(p)}</code><button class="icon-btn sm" data-copy="${copyId(p)}" title="Copy ${l}" aria-label="Copy ${l}">${icon('copy')}</button></div>`).join('')}</div>
    </section>
    <section class="insp-sec">
      <h3>${cont ? 'JSON' : 'Value'}
        <span class="sec-actions">
          <button class="btn xs" data-act="copy-value">${icon('copy')}Copy</button>
          <button class="btn xs" data-act="edit"${editing ? ' hidden' : ''}>${icon('pencil')}Edit</button>
        </span>
      </h3>
      ${editing ? (huge ? '<p class="dim small">Too large to edit inline — use the Raw view editor.</p>' : editorHTML(v, t)) : valueBlock}
      ${editing ? '' : detectors(v, t, segs)}
    </section>
    <section class="insp-sec">
      <h3>Actions</h3>
      <div class="insp-actions">
        ${cont ? `<button class="btn sm" data-act="add">${icon('plus')}${t === 'array' ? 'Add item' : 'Add property'}</button>` : ''}
        ${parent && !Array.isArray(parent) ? `<button class="btn sm" data-act="rename">${icon('pencil')}Rename</button>` : ''}
        ${segs.length ? `<button class="btn sm" data-act="duplicate">${icon('layers')}Duplicate</button>` : ''}
        ${t === 'array' ? `<button class="btn sm" data-act="table">${icon('table')}Table</button>` : ''}
        ${segs.length ? `<button class="btn sm danger-ghost" data-act="delete">${icon('trash')}Delete</button>` : ''}
      </div>
    </section>`;

  if (editing) {
    const ta = el.querySelector('.edit-input');
    ta?.focus();
  }
}

const TYPES = ['string', 'number', 'boolean', 'null', 'json'];

function editorHTML(v, t) {
  const kind = t === 'object' || t === 'array' ? 'json' : t;
  const text = kind === 'json' ? JSON.stringify(v, null, 2) : kind === 'string' ? v : String(v);
  return `<div class="editor" data-kind="${kind}">
    <div class="seg" role="radiogroup" aria-label="Value type">${TYPES.map(k => `<button type="button" role="radio" class="seg-btn${k === kind ? ' on' : ''}" aria-checked="${k === kind}" data-kind="${k}">${k === 'json' ? 'JSON' : k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
    <textarea class="input code edit-input" spellcheck="false" rows="${Math.min(14, Math.max(3, text.split('\n').length + 1))}"${kind === 'null' ? ' disabled' : ''}>${esc(kind === 'null' ? 'null' : text)}</textarea>
    <p class="edit-err" hidden></p>
    <div class="edit-btns"><button class="btn primary sm" data-act="save">Save <kbd>${modKey}↵</kbd></button><button class="btn sm" data-act="cancel">Cancel</button></div>
  </div>`;
}

function readEditor() {
  const ed = el.querySelector('.editor');
  const kind = ed.dataset.kind;
  const raw = ed.querySelector('.edit-input').value;
  switch (kind) {
    case 'string': return { ok: true, value: raw };
    case 'null': return { ok: true, value: null };
    case 'boolean': {
      const s = raw.trim().toLowerCase();
      if (s === 'true' || s === 'false') return { ok: true, value: s === 'true' };
      return { ok: false, error: 'Enter true or false' };
    }
    case 'number': {
      const s = raw.trim();
      const n = Number(s);
      if (s === '' || !Number.isFinite(n)) return { ok: false, error: 'Not a valid number' };
      return { ok: true, value: n };
    }
    default: {
      const r = smartParse(raw);
      if (!r.ok) return { ok: false, error: `${r.error.message}${r.error.line ? ` (line ${r.error.line}, col ${r.error.col})` : ''}` };
      return { ok: true, value: r.data };
    }
  }
}

function save() {
  const r = readEditor();
  if (!r.ok) {
    const e = el.querySelector('.edit-err');
    e.textContent = r.error;
    e.hidden = false;
    return;
  }
  editing = false;
  A.setValue(S.selected, r.value);
  toast('Saved', 'success', 1200);
}

function onClick(e) {
  const c = e.target.closest('[data-copy]');
  if (c) { copy(copies[+c.dataset.copy]); return; }
  const kindBtn = e.target.closest('.seg-btn');
  if (kindBtn) {
    const ed = el.querySelector('.editor');
    const ta = ed.querySelector('.edit-input');
    const from = ed.dataset.kind, to = kindBtn.dataset.kind;
    ed.dataset.kind = to;
    ed.querySelectorAll('.seg-btn').forEach(b => { b.classList.toggle('on', b === kindBtn); b.setAttribute('aria-checked', b === kindBtn); });
    ta.disabled = to === 'null';
    if (to === 'null') ta.value = 'null';
    else if (from === 'null') ta.value = to === 'boolean' ? 'true' : to === 'number' ? '0' : to === 'json' ? '{}' : '';
    else if (to === 'boolean' && !/^(true|false)$/i.test(ta.value.trim())) ta.value = 'true';
    if (!ta.disabled) ta.focus();
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  const segs = S.selected;
  if (!act || !segs) return;
  switch (act) {
    case 'copy-value': A.copyValue(segs); break;
    case 'edit': editing = true; render(); break;
    case 'cancel': editing = false; render(); break;
    case 'save': save(); break;
    case 'add': A.addChild(segs); break;
    case 'rename': A.rename(segs); break;
    case 'duplicate': A.duplicate(segs); break;
    case 'delete': A.remove(segs); break;
    case 'table': A.openTable(segs); break;
    case 'parse-embedded': A.parseEmbedded(segs); break;
  }
}

function onKey(e) {
  if (!editing) return;
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = false; render(); }
}
