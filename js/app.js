'use strict';

// ── Global state ──────────────────────────────────────────────────────────────
// Shared by all modules (tree.js, inspector.js, search.js, views.js).

const S = {
  data:               null,
  view:               'tree',
  sort:               'original',
  rawMinified:        false,
  selectedPath:       null,
  selectedValue:      null,
  selectedRow:        null,
  selectedParent:     null,
  selectedParentPath: null,
  searchMatches:      [],
  searchIdx:          -1,
  tableSortCol:       null,
  tableSortDir:       'asc',
  history:            [],
};

// ── Element references ────────────────────────────────────────────────────────
// Populated in initElements() at DOMContentLoaded.

const E = {};

function initElements() {
  const q = id => document.getElementById(id);
  Object.assign(E, {
    landing:           q('landing'),
    workspace:         q('workspace'),
    wsActions:         q('wsActions'),
    errorMsg:          q('errorMsg'),
    pasteArea:         q('pasteArea'),
    btnLoadPaste:      q('btnLoadPaste'),
    urlInput:          q('urlInput'),
    btnLoadUrl:        q('btnLoadUrl'),
    sampleGrid:        q('sampleGrid'),
    historyList:       q('historyList'),
    diffA:             q('diffA'),
    diffB:             q('diffB'),
    diffAWs:           q('diffAWs'),
    diffBWs:           q('diffBWs'),
    btnDiffFromLanding:q('btnDiffFromLanding'),
    statsTrack:        q('statsTrack'),
    statsItems:        q('statsItems'),
    statsSummary:      q('statsSummary'),
    searchInput:       q('searchInput'),
    searchInfo:        q('searchInfo'),
    searchPrev:        q('searchPrev'),
    searchNext:        q('searchNext'),
    searchClear:       q('searchClear'),
    sortSelect:        q('sortSelect'),
    treeView:          q('treeView'),
    treePanel:         q('treePanel'),
    rawView:           q('rawView'),
    rawPre:            q('rawPre'),
    tableView:         q('tableView'),
    tableInfo:         q('tableInfo'),
    tableContainer:    q('tableContainer'),
    diffView:          q('diffView'),
    diffResult:        q('diffResult'),
    diffSummary:       q('diffSummary'),
    btnRediff:         q('btnRediff'),
    inspEmpty:         q('inspEmpty'),
    inspContent:       q('inspContent'),
    inspTypeBadge:     q('inspTypeBadge'),
    pathFormats:       q('pathFormats'),
    inspValueLabel:    q('inspValueLabel'),
    inspValueBox:      q('inspValueBox'),
    btnCopyValue:      q('btnCopyValue'),
    btnEdit:           q('btnEdit'),
    inspValueRow:      q('inspValueRow'),
    inspEditRow:       q('inspEditRow'),
    editArea:          q('editArea'),
    btnSaveEdit:       q('btnSaveEdit'),
    btnCancelEdit:     q('btnCancelEdit'),
    inspSiblingsRow:   q('inspSiblingsRow'),
    inspSiblings:      q('inspSiblings'),
    breadcrumb:        q('breadcrumb'),
    btnExpandAll:      q('btnExpandAll'),
    btnCollapseAll:    q('btnCollapseAll'),
    btnCopyJSON:       q('btnCopyJSON'),
    btnDownload:       q('btnDownload'),
    btnMinify:         q('btnMinify'),
    btnNew:            q('btnNew'),
    btnTheme:          q('btnTheme'),
    btnShortcuts:      q('btnShortcuts'),
    viewToggle:        q('viewToggle'),
    shortcutsModal:    q('shortcutsModal'),
    btnCloseShortcuts: q('btnCloseShortcuts'),
    dropOverlay:       q('dropOverlay'),
  });
}

// ── Analysis ──────────────────────────────────────────────────────────────────

function analyze(data) {
  const c = { object: 0, array: 0, string: 0, number: 0, boolean: 0, null: 0 };
  let total = 0, maxDepth = 0;

  function walk(v, d) {
    if (d > maxDepth) maxDepth = d;
    const t = getType(v);
    c[t]++; total++;
    if (t === 'object') for (const k in v) walk(v[k], d + 1);
    else if (t === 'array') for (let i = 0; i < v.length; i++) walk(v[i], d + 1);
  }
  walk(data, 0);

  let size = 0;
  try { size = new Blob([JSON.stringify(data)]).size; }
  catch(e) { size = JSON.stringify(data).length; }

  return { c, total, maxDepth, size };
}

function renderStats(stats) {
  const segClass = t => ({
    object: 't-obj', array: 't-arr', string: 't-str',
    number: 't-num', boolean: 't-bool', null: 't-null',
  }[t]);
  const label = t => ({ object: 'Obj', array: 'Arr', string: 'Str', number: 'Num', boolean: 'Bool', null: 'Null' }[t]);
  const dotVar = t => ({ 't-obj': 'obj', 't-arr': 'arr', 't-str': 'str', 't-num': 'num', 't-bool': 'bool', 't-null': 'null' }[segClass(t)]);

  const active = ['object', 'array', 'string', 'number', 'boolean', 'null'].filter(t => stats.c[t] > 0);

  E.statsTrack.innerHTML = active.map(t =>
    `<div class="stats-seg ${segClass(t)}" style="width:${(stats.c[t] / stats.total * 100).toFixed(1)}%" title="${t}: ${stats.c[t]}"></div>`
  ).join('');

  E.statsItems.innerHTML = active.map(t =>
    `<div class="stat-item"><div class="stat-dot" style="background:var(--seg-${dotVar(t)})"></div>${label(t)} <strong class="stat-val">${stats.c[t]}</strong></div>`
  ).join('');

  const rootType = getType(S.data);
  const topInfo  = rootType === 'array'  ? `Array · ${S.data.length} items`
    : rootType === 'object' ? `Object · ${Object.keys(S.data).length} keys`
    : rootType;

  E.statsSummary.innerHTML = `<strong>${topInfo}</strong> · ${stats.total} nodes · depth ${stats.maxDepth} · ${fmtBytes(stats.size)}`;
}

// ── View management ───────────────────────────────────────────────────────────

function setView(view) {
  S.view = view;
  E.treeView.classList.toggle('hidden', view !== 'tree');
  E.rawView.classList.toggle('hidden',  view !== 'raw');
  E.tableView.classList.toggle('hidden',view !== 'table');
  E.diffView.classList.toggle('hidden', view !== 'diff');
  E.viewToggle.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view)
  );
  E.btnMinify.style.display = view === 'raw' ? '' : 'none';
  if (view === 'raw')   renderRaw();
  if (view === 'table') renderTable();
}

// ── History ───────────────────────────────────────────────────────────────────

const HISTORY_KEY = 'jip-history-v1';
const HISTORY_MAX = 8;

function loadHistory() {
  try { S.history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch(e) { S.history = []; }
}

function saveHistory(label, data) {
  S.history = S.history.filter(h => h.label !== label).slice(0, HISTORY_MAX - 1);
  S.history.unshift({ label, data, ts: Date.now() });
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(S.history)); } catch(e) {}
  renderHistoryList();
}

function renderHistoryList() {
  if (!S.history.length) {
    E.historyList.innerHTML = '<div class="inspector-empty">No history yet — load some JSON first.</div>';
    return;
  }
  E.historyList.innerHTML = '';
  S.history.forEach(h => {
    const item = document.createElement('div');
    item.className = 'history-item';

    const lbl  = document.createElement('div');
    lbl.className   = 'history-item-label';
    lbl.textContent = h.label;

    const meta = document.createElement('div');
    meta.className   = 'history-item-meta';
    meta.textContent = new Date(h.ts).toLocaleTimeString();

    item.appendChild(lbl);
    item.appendChild(meta);
    item.addEventListener('click', () => loadWorkspace(h.data, false));
    E.historyList.appendChild(item);
  });
}

// ── Sample datasets ───────────────────────────────────────────────────────────

const SAMPLES = [
  {
    name: 'Users API',
    desc: 'Array of user objects',
    data: { users: [
      { id: 1, name: 'Alice Chen',   email: 'alice@example.com', role: 'admin',  active: true,  score: 98.5 },
      { id: 2, name: 'Bob Smith',    email: 'bob@example.com',   role: 'editor', active: false, score: 72.1 },
      { id: 3, name: 'Carol White',  email: 'carol@example.com', role: 'viewer', active: true,  score: 85.0 },
    ], total: 3, page: 1 },
  },
  {
    name: 'GitHub Repo',
    desc: 'Repository metadata',
    data: { id: 441990730, name: 'inspector', full_name: 'user/inspector', private: false,
      description: 'A JSON inspector tool', fork: false, created_at: '2022-01-15T10:30:00Z',
      stargazers_count: 142, forks_count: 18, language: 'JavaScript',
      topics: ['json', 'developer-tools', 'browser'], license: { name: 'MIT' } },
  },
  {
    name: 'E-commerce',
    desc: 'Product catalog',
    data: { store: 'Tech Store', products: [
      { id: 'P001', name: 'Laptop Pro',     price: 1299.99, in_stock: true,  specs: { ram: '16GB', storage: '512GB SSD', cpu: 'M3 Pro' }, tags: ['sale', 'featured'] },
      { id: 'P002', name: 'Wireless Mouse', price: 49.99,   in_stock: false, specs: { dpi: 1600, buttons: 6, wireless: true }, tags: ['accessories'] },
    ] },
  },
  {
    name: 'Config',
    desc: 'Application configuration',
    data: { version: '2.1.0', env: 'production',
      server: { host: '0.0.0.0', port: 8080, tls: { enabled: true, cert: '/etc/ssl/cert.pem' } },
      database: { url: 'postgres://localhost/db', pool: { min: 2, max: 20 }, timeout_ms: 5000 },
      features: { dark_mode: true, beta_users: null, rate_limit: 100 },
      logging: { level: 'info', destinations: ['stdout', 'file'] } },
  },
  {
    name: 'Geography',
    desc: 'Nested location data',
    data: { continent: 'Asia', countries: [
      { name: 'Japan',       capital: 'Tokyo', population: 125700000, languages: ['Japanese'], cities: [{ name: 'Tokyo', population: 13960000 }, { name: 'Osaka', population: 2691000 }] },
      { name: 'South Korea', capital: 'Seoul', population: 51700000,  languages: ['Korean'],   cities: [{ name: 'Seoul', population: 9776000  }] },
    ] },
  },
  {
    name: 'Timeline',
    desc: 'Sequence of events',
    data: { title: 'Project Alpha', start: '2024-01-01', events: [
      { date: '2024-01-15', type: 'milestone', name: 'Kickoff',       completed: true,  notes: 'Team assembled' },
      { date: '2024-03-01', type: 'release',   name: 'v0.1 Beta',     completed: true,  notes: 'Internal testing' },
      { date: '2024-06-15', type: 'milestone', name: 'Public Launch', completed: false, notes: null },
    ] },
  },
];

function renderSamples() {
  E.sampleGrid.innerHTML = '';
  SAMPLES.forEach(s => {
    const card = document.createElement('div');
    card.className = 'sample-card';
    card.innerHTML = `<h4>${esc(s.name)}</h4><p>${esc(s.desc)}</p>`;
    card.addEventListener('click', () => loadWorkspace(deepClone(s.data), true, s.name));
    E.sampleGrid.appendChild(card);
  });
}

// ── Parse helpers ─────────────────────────────────────────────────────────────

function tryParse(text) {
  try { return { ok: true, data: JSON.parse(text) }; }
  catch(e) { return { ok: false, err: e }; }
}

function parseErrMsg(text, err) {
  const msg = err.message;
  let line, col;

  const lc  = msg.match(/line (\d+) col(?:umn)? (\d+)/i);
  const pos = msg.match(/position (\d+)/);

  if (lc) {
    line = +lc[1]; col = +lc[2];
  } else if (pos) {
    const p    = +pos[1];
    const upto = text.slice(0, p);
    const ls   = upto.split('\n');
    line = ls.length;
    col  = ls[ls.length - 1].length + 1;
  }

  // Show the offending line with a caret
  let context = '';
  if (line) {
    const lines       = text.split('\n');
    const problemLine = lines[line - 1];
    if (problemLine) {
      const truncated = problemLine.slice(0, 120);
      context = '\n\n' + truncated + (problemLine.length > 120 ? '…' : '');
      if (col) context += '\n' + ' '.repeat(Math.min(col - 1, 120)) + '^';
    }
  }

  // Contextual hints
  let hint = '';
  if (msg.includes("Expected ',' or '}'") || msg.includes("Expected ',' or ']'")) {
    hint = '\n\nHint: The most common cause is an unescaped " inside a string value.\nInside JSON strings, double quotes must be written as \\".';
  } else if (msg.includes('Unexpected token')) {
    hint = '\n\nHint: Common causes: trailing commas, single-quoted strings, or comments — none are valid JSON.';
  } else if (msg.includes('Unexpected end')) {
    hint = '\n\nHint: The JSON appears to be truncated or has unclosed brackets/braces.';
  }

  return `Invalid JSON${line ? ` (line ${line}, col ${col})` : ''}:\n${msg}${context}${hint}`;
}

function showError(msg)  { E.errorMsg.textContent = msg; E.errorMsg.classList.remove('hidden'); }
function clearError()    { E.errorMsg.classList.add('hidden'); }

// ── Load workspace ────────────────────────────────────────────────────────────

function loadWorkspace(data, doSaveHistory, label) {
  S.data         = data;
  S.selectedRow  = null;
  S.selectedPath = null;
  S.selectedValue= null;
  S.searchMatches= [];
  S.searchIdx    = -1;
  S.tableSortCol = null;

  E.landing.classList.add('hidden');
  E.workspace.classList.remove('hidden');
  E.wsActions.style.display = 'flex';

  renderTree();
  renderStats(analyze(data));

  E.inspEmpty.classList.remove('hidden');
  E.inspContent.classList.add('hidden');
  E.breadcrumb.style.display = 'none';
  E.searchInput.value        = '';
  clearSearch();

  if (doSaveHistory) {
    const lbl = label
      || (Array.isArray(data)              ? `Array[${data.length}]`
      :   data && typeof data === 'object' ? `Object{${Object.keys(data).length}}`
      :   String(data));
    saveHistory(lbl, deepClone(data));
  }

  setView('tree');
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  E.btnTheme.textContent = t === 'dark' ? '☀' : '◐';
  try { localStorage.setItem('jip-theme', t); } catch(e) {}
}

// ── Event bindings ────────────────────────────────────────────────────────────

function bindLandingEvents() {
  // Tab switcher
  document.querySelectorAll('.input-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.input-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(p =>
        p.classList.toggle('active', p.dataset.ipane === tab.dataset.itab)
      );
      clearError();
    });
  });

  E.btnLoadPaste.addEventListener('click', () => {
    clearError();
    const text = E.pasteArea.value.trim();
    if (!text) { showError('Please paste some JSON first.'); return; }
    const r = tryParse(text);
    if (r.ok) loadWorkspace(r.data, true);
    else showError(parseErrMsg(text, r.err));
  });
  E.pasteArea.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') E.btnLoadPaste.click();
  });

  E.btnLoadUrl.addEventListener('click', async () => {
    clearError();
    const url = E.urlInput.value.trim();
    if (!url) { showError('Enter a URL.'); return; }
    E.btnLoadUrl.disabled    = true;
    E.btnLoadUrl.textContent = 'Fetching…';
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      const r    = tryParse(text);
      if (r.ok) loadWorkspace(r.data, true, url);
      else showError(parseErrMsg(text, r.err));
    } catch(e) {
      showError(`Fetch failed: ${e.message}\n\nThe URL may block cross-origin requests (CORS).`);
    } finally {
      E.btnLoadUrl.disabled    = false;
      E.btnLoadUrl.textContent = 'Fetch & Inspect ▶';
    }
  });
  E.urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') E.btnLoadUrl.click(); });

  E.btnDiffFromLanding.addEventListener('click', () => {
    const at = E.diffA.value.trim(), bt = E.diffB.value.trim();
    if (!at || !bt) { showError('Paste JSON in both fields.'); return; }
    loadWorkspace({}, false);
    E.diffAWs.value = at;
    E.diffBWs.value = bt;
    setView('diff');
    runDiff(at, bt);
  });
}

function bindWorkspaceEvents() {
  E.btnExpandAll.addEventListener('click', () => setAllCollapsed(false));
  E.btnCollapseAll.addEventListener('click', () => setAllCollapsed(true));

  E.btnCopyJSON.addEventListener('click', () =>
    copyText(JSON.stringify(S.data, null, 2), E.btnCopyJSON)
  );

  E.btnDownload.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S.data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'data.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });

  E.btnMinify.addEventListener('click', () => {
    S.rawMinified = !S.rawMinified;
    E.btnMinify.textContent = S.rawMinified ? 'Prettify' : 'Minify';
    E.btnMinify.classList.toggle('active', S.rawMinified);
    renderRaw();
  });

  E.btnNew.addEventListener('click', () => {
    E.workspace.classList.add('hidden');
    E.wsActions.style.display = 'none';
    E.landing.classList.remove('hidden');
    clearError();
  });

  E.sortSelect.addEventListener('change', () => {
    S.sort = E.sortSelect.value;
    if (S.data) renderTree();
  });

  E.viewToggle.addEventListener('click', e => {
    if (e.target.dataset.view) setView(e.target.dataset.view);
  });
}

function bindThemeAndModal() {
  E.btnTheme.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  E.btnShortcuts.addEventListener('click', () =>
    E.shortcutsModal.classList.remove('hidden')
  );
  E.btnCloseShortcuts.addEventListener('click', () =>
    E.shortcutsModal.classList.add('hidden')
  );
  E.shortcutsModal.addEventListener('click', e => {
    if (e.target === E.shortcutsModal) E.shortcutsModal.classList.add('hidden');
  });
}

function bindKeyboard() {
  document.addEventListener('keydown', e => {
    const inInput   = ['TEXTAREA', 'INPUT', 'SELECT'].includes(e.target.tagName);
    const modalOpen = !E.shortcutsModal.classList.contains('hidden');
    const wsVisible = !E.workspace.classList.contains('hidden');

    if (modalOpen) { if (e.key === 'Escape') E.shortcutsModal.classList.add('hidden'); return; }
    if (inInput) return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && wsVisible) {
      e.preventDefault(); E.searchInput.focus(); return;
    }

    switch (e.key) {
      case '?': E.btnShortcuts.click(); break;
      case '/': case 'f': if (wsVisible) { e.preventDefault(); E.searchInput.focus(); } break;
      case 'Escape': if (wsVisible) { E.searchInput.value = ''; clearSearch(); } break;
      case 'e': if (wsVisible) setAllCollapsed(false); break;
      case 'c': if (wsVisible) setAllCollapsed(true);  break;
      case 'm': if (wsVisible && S.view === 'raw') E.btnMinify.click(); break;
      case '1': if (wsVisible) setView('tree');  break;
      case '2': if (wsVisible) setView('raw');   break;
      case '3': if (wsVisible) setView('table'); break;
      case '4': if (wsVisible) setView('diff');  break;
    }
  });
}

function bindDragDrop() {
  let dragCnt = 0;

  document.addEventListener('dragenter', e => {
    e.preventDefault();
    dragCnt++;
    E.dropOverlay.classList.add('active');
  });
  document.addEventListener('dragleave', () => {
    if (--dragCnt <= 0) { dragCnt = 0; E.dropOverlay.classList.remove('active'); }
  });
  document.addEventListener('dragover',  e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    dragCnt = 0;
    E.dropOverlay.classList.remove('active');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      clearError();
      const r = tryParse(ev.target.result);
      if (r.ok) {
        loadWorkspace(r.data, true, file.name);
      } else {
        E.landing.classList.remove('hidden');
        E.workspace.classList.add('hidden');
        showError(parseErrMsg(ev.target.result, r.err));
      }
    };
    reader.readAsText(file);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  initElements();

  // Restore saved theme
  try { const t = localStorage.getItem('jip-theme'); if (t) applyTheme(t); } catch(e) {}

  loadHistory();
  renderHistoryList();
  renderSamples();

  bindLandingEvents();
  bindWorkspaceEvents();
  bindThemeAndModal();
  bindInspectorEvents();
  bindSearchEvents();
  bindViewsEvents();
  bindKeyboard();
  bindDragDrop();

  E.btnMinify.style.display = 'none';
}

document.addEventListener('DOMContentLoaded', init);
