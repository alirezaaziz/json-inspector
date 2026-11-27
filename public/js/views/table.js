import { S, on, select, emit } from '../state.js';
import { getAt, keyOf, toJSONPath } from '../path.js';
import { esc, typeOf, cmpKeys, debounce, store, isContainer } from '../util.js';
import { tableColumns, cellText, toCSV } from '../generate.js';
import { icon } from '../icons.js';
import { copy, download, toast } from '../ui.js';

const ROWH = 32;
const OVERSCAN = 10;

let el, scroller, tableEl, infoEl, pickEl, filterEl;
let dirty = true;
let model = null; // { segs, arr, cols, rows: [{i, r}], view: [...] }
let sortCol = null, sortDir = 1, filter = '';
let flatten = store.get('tableFlatten', true);
let painted = '';

export function initTable(root) {
  el = root;
  el.innerHTML = `
    <div class="view-bar">
      <label class="select-wrap" title="Array to display">${icon('table')}<select id="tablePick" aria-label="Array to display"></select></label>
      <label class="search sm">${icon('filter')}<input id="tableFilter" type="search" placeholder="Filter rows…" spellcheck="false" autocomplete="off"></label>
      <label class="check"><input type="checkbox" id="tableFlatten"${flatten ? ' checked' : ''}> Flatten nested</label>
      <span class="grow"></span>
      <span class="dim small" id="tableInfo"></span>
      <button class="btn sm" data-act="tsv" title="Copy as tab-separated values (paste into a spreadsheet)">${icon('copy')}Copy</button>
      <button class="btn sm" data-act="csv">${icon('download')}CSV</button>
    </div>
    <div class="table-scroll" tabindex="0"><table class="grid"></table></div>
    <div class="table-empty" hidden></div>`;
  scroller = el.querySelector('.table-scroll');
  tableEl = el.querySelector('table');
  infoEl = el.querySelector('#tableInfo');
  pickEl = el.querySelector('#tablePick');
  filterEl = el.querySelector('#tableFilter');

  pickEl.addEventListener('change', () => { S.tableSegs = JSON.parse(pickEl.value); sortCol = null; build(); });
  filterEl.addEventListener('input', debounce(() => { filter = filterEl.value.trim().toLowerCase(); applyView(); }, 150));
  el.querySelector('#tableFlatten').addEventListener('change', e => { flatten = e.target.checked; store.set('tableFlatten', flatten); build(); });
  scroller.addEventListener('scroll', () => requestAnimationFrame(paint), { passive: true });
  new ResizeObserver(() => paint()).observe(scroller);
  el.addEventListener('click', onClick);
  el.addEventListener('dblclick', e => {
    const tr = e.target.closest('tr[data-i]');
    if (tr && model) emit('reveal', [...model.segs, +tr.dataset.i]);
  });
  on('doc', () => { dirty = true; if (S.view === 'table') build(); });
  on('select', () => { if (S.view === 'table') { painted = ''; paint(); } });
}

export function showTable() { if (dirty || !model || keyOf(model.segs) !== keyOf(S.tableSegs || model.segs)) build(); }

/** Arrays in the document, biggest first (scan is bounded for very large docs). */
function findArrays(root) {
  const out = [];
  let budget = 200_000;
  const walk = (v, segs, depth) => {
    if (budget-- <= 0 || depth > 8) return;
    if (Array.isArray(v)) {
      if (v.length) out.push({ segs, len: v.length, objs: v.some(x => isContainer(x) && !Array.isArray(x)) });
      const n = Math.min(v.length, 50);
      for (let i = 0; i < n; i++) if (isContainer(v[i])) walk(v[i], [...segs, i], depth + 1);
    } else if (isContainer(v)) for (const k of Object.keys(v)) if (isContainer(v[k])) walk(v[k], [...segs, k], depth + 1);
  };
  walk(root, [], 0);
  return out.sort((a, b) => (b.objs - a.objs) || b.len - a.len).slice(0, 100);
}

function build() {
  dirty = false;
  painted = '';
  const candidates = findArrays(S.doc);
  let segs = S.tableSegs;
  if (!segs || !Array.isArray(getAt(S.doc, segs))) {
    const sel = S.selected && Array.isArray(getAt(S.doc, S.selected)) ? S.selected : null;
    segs = sel || candidates[0]?.segs || null;
  }
  const empty = el.querySelector('.table-empty');
  if (!segs) {
    model = null;
    scroller.hidden = true;
    empty.hidden = false;
    empty.innerHTML = `${icon('table')}<p>No arrays in this document.</p><p class="dim small">Table view shows arrays — for example a list of records.</p>`;
    pickEl.innerHTML = '';
    infoEl.textContent = '';
    return;
  }
  S.tableSegs = segs;
  scroller.hidden = false;
  empty.hidden = true;
  if (!candidates.some(c => keyOf(c.segs) === keyOf(segs))) candidates.unshift({ segs, len: getAt(S.doc, segs).length });
  pickEl.innerHTML = candidates.map(c => `<option value="${esc(JSON.stringify(c.segs))}"${keyOf(c.segs) === keyOf(segs) ? ' selected' : ''}>${esc(toJSONPath(c.segs))} (${c.len.toLocaleString()})</option>`).join('');

  const arr = getAt(S.doc, segs);
  const { cols, rows } = tableColumns(arr, flatten);
  model = { segs, arr, cols, rows: rows.map((r, i) => ({ i, r })), view: [] };
  if (sortCol && !cols.includes(sortCol)) sortCol = null;

  const widths = cols.map(c => {
    let w = c.length;
    for (let i = 0; i < Math.min(rows.length, 200); i++) w = Math.max(w, Math.min(48, cellText(rows[i][c]).length));
    return Math.max(70, Math.min(380, w * 7.6 + 30));
  });
  const idxW = Math.max(48, String(arr.length).length * 8 + 26);
  tableEl.style.width = idxW + widths.reduce((a, b) => a + b, 0) + 'px';
  tableEl.innerHTML = `<colgroup><col style="width:${idxW}px">${widths.map(w => `<col style="width:${w}px">`).join('')}</colgroup>
    <thead><tr><th class="idx">#</th>${cols.map((c, i) => `<th data-col="${i}" title="${esc(c)} — click to sort"><span>${esc(c)}</span></th>`).join('')}</tr></thead><tbody></tbody>`;
  applyView();
}

function applyView() {
  if (!model) return;
  let view = model.rows;
  if (filter) view = view.filter(({ r }) => model.cols.some(c => cellText(r[c]).toLowerCase().includes(filter)));
  if (sortCol) {
    view = view.slice().sort((a, b) => {
      const x = a.r[sortCol], y = b.r[sortCol];
      if (x === undefined && y !== undefined) return 1;
      if (y === undefined && x !== undefined) return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sortDir;
      return cmpKeys(cellText(x), cellText(y)) * sortDir;
    });
  }
  model.view = view;
  tableEl.querySelectorAll('th[data-col]').forEach(th => {
    const c = model.cols[+th.dataset.col];
    th.classList.toggle('asc', c === sortCol && sortDir === 1);
    th.classList.toggle('desc', c === sortCol && sortDir === -1);
  });
  infoEl.textContent = `${view.length.toLocaleString()}${view.length !== model.rows.length ? ' of ' + model.rows.length.toLocaleString() : ''} rows × ${model.cols.length} columns`;
  painted = '';
  scroller.scrollTop = 0;
  paint();
}

function cellHTML(v) {
  const t = typeOf(v);
  if (v === undefined) return '<td class="u"></td>';
  const txt = cellText(v);
  const shown = txt.length > 200 ? txt.slice(0, 200) + '…' : txt;
  return `<td class="c-${t}" title="${esc(txt.length > 500 ? txt.slice(0, 500) + '…' : txt)}">${esc(shown)}</td>`;
}

function paint() {
  if (!model || scroller.hidden) return;
  const head = tableEl.tHead?.offsetHeight || ROWH;
  const st = Math.max(0, scroller.scrollTop - head);
  const h = scroller.clientHeight;
  const total = model.view.length;
  const start = Math.max(0, Math.floor(st / ROWH) - OVERSCAN);
  const end = Math.min(total, Math.ceil((st + h) / ROWH) + OVERSCAN);
  const selIdx = S.selected && S.selected.length === model.segs.length + 1 && keyOf(S.selected.slice(0, -1)) === keyOf(model.segs) ? S.selected[S.selected.length - 1] : null;
  const sig = `${start}:${end}:${total}:${selIdx}`;
  if (sig === painted) return;
  painted = sig;
  const span = model.cols.length + 1;
  let html = start ? `<tr class="pad" style="height:${start * ROWH}px"><td colspan="${span}"></td></tr>` : '';
  for (let k = start; k < end; k++) {
    const { i, r } = model.view[k];
    html += `<tr data-i="${i}"${i === selIdx ? ' class="sel"' : ''}><td class="idx">${i}</td>${model.cols.map(c => cellHTML(r[c])).join('')}</tr>`;
  }
  if (end < total) html += `<tr class="pad" style="height:${(total - end) * ROWH}px"><td colspan="${span}"></td></tr>`;
  tableEl.tBodies[0].innerHTML = html;
}

function exportRows() { return model.view.map(({ i }) => model.arr[i]); }

function onClick(e) {
  const th = e.target.closest('th[data-col]');
  if (th) {
    const c = model.cols[+th.dataset.col];
    if (sortCol === c) { if (sortDir === 1) sortDir = -1; else sortCol = null; }
    else { sortCol = c; sortDir = 1; }
    applyView();
    return;
  }
  const tr = e.target.closest('tr[data-i]');
  if (tr && model) { select([...model.segs, +tr.dataset.i]); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!model || !act) return;
  if (act === 'csv') {
    download(`${(S.name || 'data').replace(/\.[^.]+$/, '')}.csv`, toCSV(exportRows(), { flatten }), 'text/csv');
    toast('CSV downloaded', 'success');
  } else if (act === 'tsv') copy(toCSV(exportRows(), { flatten, sep: '\t' }), 'Rows copied — paste into a spreadsheet');
}
