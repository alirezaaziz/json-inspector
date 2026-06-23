'use strict';

const MAX_RAW_LINES  = 8000;
const MAX_TABLE_ROWS = 2000;
const MAX_DIFF_LINES = 3000;

// ── Raw view ──────────────────────────────────────────────────────────────────

function syntaxHL(json) {
  return esc(json).replace(
    /("(?:\\.|[^"\\])*"(\s*:)?|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    match => {
      if (/^".*":/.test(match)) return `<span class="tok-key">${match}</span>`;
      if (/^"/.test(match))     return `<span class="tok-str">${match}</span>`;
      if (/^(true|false)$/.test(match)) return `<span class="tok-bool">${match}</span>`;
      if (/^null$/.test(match)) return `<span class="tok-null">${match}</span>`;
      return `<span class="tok-num">${match}</span>`;
    }
  );
}

function renderRaw() {
  const json  = S.rawMinified ? JSON.stringify(S.data) : JSON.stringify(S.data, null, 2);
  const lines = syntaxHL(json).split('\n');
  const shown = lines.slice(0, MAX_RAW_LINES);

  E.rawPre.innerHTML = shown.map(l => `<div class="raw-line">${l || ' '}</div>`).join('');

  if (lines.length > MAX_RAW_LINES) {
    const note = document.createElement('div');
    note.style.cssText = 'padding:8px 20px;font-size:12px;color:var(--text2)';
    note.textContent   = `Showing ${MAX_RAW_LINES.toLocaleString()} of ${lines.length.toLocaleString()} lines.`;
    E.rawPre.appendChild(note);
  }
}

// ── Table view ────────────────────────────────────────────────────────────────

function findTableArray() {
  // 1. Root is already an array
  if (Array.isArray(S.data)) return { arr: S.data, path: '$' };

  // 2. User explicitly selected an array node in the tree
  if (Array.isArray(S.selectedValue)) return { arr: S.selectedValue, path: S.selectedPath };

  // 3. Auto-detect: find all arrays among the root object's direct keys,
  //    pick the one with the most items (most likely the "data" array).
  if (S.data && typeof S.data === 'object' && !Array.isArray(S.data)) {
    const candidates = Object.entries(S.data)
      .filter(([, v]) => Array.isArray(v))
      .sort(([, a], [, b]) => b.length - a.length);
    if (candidates.length > 0) {
      const [key, arr] = candidates[0];
      return { arr, path: '$.' + key };
    }
  }

  return null;
}

function renderTable() {
  const found = findTableArray();

  if (!found) {
    E.tableInfo.textContent    = 'No array found. Load a JSON array, or select an array node in the Tree view.';
    E.tableContainer.innerHTML = '';
    return;
  }

  const arr     = found.arr;
  const arrPath = found.path;

  const objs = arr.filter(v => v && typeof v === 'object' && !Array.isArray(v));
  if (!objs.length) {
    E.tableInfo.textContent    = `${arrPath} — ${arr.length} items (no objects to display as table).`;
    E.tableContainer.innerHTML = '';
    return;
  }

  // Collect column names (union of all keys)
  const colSet = new Set();
  objs.forEach(o => Object.keys(o).forEach(k => colSet.add(k)));
  const cols = Array.from(colSet);
  E.tableInfo.textContent = `${arrPath} — ${arr.length} rows × ${cols.length} columns`;

  // Sort rows
  let rows = arr.map((v, i) => ({ i, v }));
  if (S.tableSortCol !== null) {
    rows.sort((a, b) => {
      const av = a.v && typeof a.v === 'object' ? a.v[S.tableSortCol] : undefined;
      const bv = b.v && typeof b.v === 'object' ? b.v[S.tableSortCol] : undefined;
      const cmp = (av === undefined ? 1 : 0) - (bv === undefined ? 1 : 0)
        || String(av).localeCompare(String(bv), undefined, { numeric: true });
      return S.tableSortDir === 'asc' ? cmp : -cmp;
    });
  }

  const table  = document.createElement('table');
  table.className = 'table-view';

  // Header
  const thead = document.createElement('thead');
  const hrow  = document.createElement('tr');

  const thIdx = document.createElement('th');
  thIdx.textContent = '#';
  thIdx.className   = 'table-idx';
  hrow.appendChild(thIdx);

  cols.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col;
    if (S.tableSortCol === col)
      th.className = S.tableSortDir === 'asc' ? 'sort-asc' : 'sort-desc';
    th.addEventListener('click', () => {
      S.tableSortDir = S.tableSortCol === col && S.tableSortDir === 'asc' ? 'desc' : 'asc';
      S.tableSortCol = col;
      renderTable();
    });
    hrow.appendChild(th);
  });

  thead.appendChild(hrow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  rows.slice(0, MAX_TABLE_ROWS).forEach(({ i, v }) => {
    const tr    = document.createElement('tr');
    const tdIdx = document.createElement('td');
    tdIdx.textContent = i;
    tdIdx.className   = 'table-idx t-num';
    tr.appendChild(tdIdx);

    cols.forEach(col => {
      const td = document.createElement('td');
      const cv = v && typeof v === 'object' ? v[col] : undefined;
      const ct = getType(cv);
      td.className = 't-' + ct;

      if      (cv === undefined)                  { td.textContent = ''; td.style.color = 'var(--text3)'; }
      else if (ct === 'object' || ct === 'array') { td.textContent = JSON.stringify(cv); }
      else if (ct === 'null')                     { td.textContent = 'null'; }
      else if (ct === 'string')                   { td.textContent = '"' + String(cv) + '"'; }
      else                                        { td.textContent = String(cv); }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  E.tableContainer.innerHTML = '';
  E.tableContainer.appendChild(table);

  if (rows.length > MAX_TABLE_ROWS) {
    const note = document.createElement('div');
    note.style.cssText = 'padding:8px 12px;font-size:12px;color:var(--text2)';
    note.textContent   = `Showing ${MAX_TABLE_ROWS.toLocaleString()} of ${rows.length.toLocaleString()} rows.`;
    E.tableContainer.appendChild(note);
  }
}

// ── Diff view ─────────────────────────────────────────────────────────────────

function computeDiff(a, b, prefix) {
  const lines = [];
  const ta = getType(a), tb = getType(b);

  // Primitive or type mismatch
  if (ta !== tb || ta === 'null' || ta === 'string' || ta === 'number' || ta === 'boolean') {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      lines.push({ t: 'del', key: prefix, val: JSON.stringify(a) });
      lines.push({ t: 'add', key: prefix, val: JSON.stringify(b) });
    } else {
      lines.push({ t: 'eq', key: prefix, val: JSON.stringify(a) });
    }
    return lines;
  }

  if (ta === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    keys.forEach(k => {
      const pre = (prefix ? prefix + '.' : '') + k;
      if      (!(k in a)) lines.push({ t: 'add', key: pre, val: JSON.stringify(b[k]) });
      else if (!(k in b)) lines.push({ t: 'del', key: pre, val: JSON.stringify(a[k]) });
      else                lines.push(...computeDiff(a[k], b[k], pre));
    });
  } else if (ta === 'array') {
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      const pre = (prefix || '$') + '[' + i + ']';
      if      (i >= a.length) lines.push({ t: 'add', key: pre, val: JSON.stringify(b[i]) });
      else if (i >= b.length) lines.push({ t: 'del', key: pre, val: JSON.stringify(a[i]) });
      else                    lines.push(...computeDiff(a[i], b[i], pre));
    }
  }

  return lines;
}

function runDiff(aText, bText) {
  let a, b;
  try { a = JSON.parse(aText); }
  catch(e) { E.diffResult.innerHTML = `<div class="diff-result-empty" style="color:var(--red)">Left JSON error: ${esc(e.message)}</div>`; return; }
  try { b = JSON.parse(bText); }
  catch(e) { E.diffResult.innerHTML = `<div class="diff-result-empty" style="color:var(--red)">Right JSON error: ${esc(e.message)}</div>`; return; }

  const lines   = computeDiff(a, b, '$');
  const added   = lines.filter(l => l.t === 'add').length;
  const removed = lines.filter(l => l.t === 'del').length;
  const same    = lines.filter(l => l.t === 'eq').length;

  E.diffSummary.innerHTML = `<span style="color:var(--green)">+${added} added</span> · <span style="color:var(--red)">−${removed} removed</span> · <span style="color:var(--text2)">${same} unchanged</span>`;

  E.diffResult.innerHTML = lines.slice(0, MAX_DIFF_LINES).map(l => {
    const cls = l.t === 'add' ? 'diff-add' : l.t === 'del' ? 'diff-del' : 'diff-eq';
    const sym = l.t === 'add' ? '+' : l.t === 'del' ? '−' : '=';
    return `<div class="diff-line ${cls}">${esc(sym)} <span class="diff-key">${esc(l.key)}</span>: ${esc(l.val)}</div>`;
  }).join('');

  if (lines.length > MAX_DIFF_LINES)
    E.diffResult.innerHTML += `<div style="padding:8px 12px;font-size:12px;color:var(--text2)">…${lines.length - MAX_DIFF_LINES} more lines</div>`;
}

// ── Event binding ─────────────────────────────────────────────────────────────

function bindViewsEvents() {
  E.btnRediff.addEventListener('click', () => runDiff(E.diffAWs.value, E.diffBWs.value));
}
