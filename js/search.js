'use strict';

// ── State reset ───────────────────────────────────────────────────────────────

function clearSearch() {
  E.treePanel.querySelectorAll('.n-row.match, .n-row.match-active')
    .forEach(r => r.classList.remove('match', 'match-active'));
  S.searchMatches = [];
  S.searchIdx     = -1;
  E.searchInfo.style.display = 'none';
}

// ── Tree helpers ──────────────────────────────────────────────────────────────

function expandToPath(path) {
  const parts = pathParts(path);
  for (let i = 1; i < parts.length; i++) {
    const p      = buildPathFromParts(parts.slice(0, i + 1));
    const row    = E.treePanel.querySelector(`.n-row[data-path="${CSS.escape(p)}"]`);
    const nodeEl = row?.closest('.n');
    if (nodeEl?.classList.contains('collapsed')) toggleNode(nodeEl);
  }
}

function expandAncestors(row) {
  let el = row.closest('.n')?.parentElement?.closest('.n');
  while (el) {
    if (el.classList.contains('collapsed')) toggleNode(el);
    el = el.parentElement?.closest('.n');
  }
}

// ── Match navigation ──────────────────────────────────────────────────────────

function focusMatch() {
  S.searchMatches.forEach(m => m.classList.remove('match-active'));
  const m = S.searchMatches[S.searchIdx];
  if (!m) return;
  m.classList.add('match-active');
  m.scrollIntoView({ block: 'center', behavior: 'smooth' });
  E.searchInfo.textContent  = `${S.searchIdx + 1}/${S.searchMatches.length}`;
  E.searchInfo.style.display = '';
}

function searchFwd() {
  if (!S.searchMatches.length) return;
  S.searchIdx = (S.searchIdx + 1) % S.searchMatches.length;
  focusMatch();
}

function searchPrev() {
  if (!S.searchMatches.length) return;
  S.searchIdx = (S.searchIdx - 1 + S.searchMatches.length) % S.searchMatches.length;
  focusMatch();
}

// ── Run search ────────────────────────────────────────────────────────────────

function runSearch() {
  clearSearch();
  const q = E.searchInput.value.trim();
  if (!q) return;

  // JSONPath mode: expression starting with $
  if (q.startsWith('$')) {
    const results = evalJSONPath(S.data, q);
    if (!results || !results.length) {
      E.searchInfo.textContent  = '0 results';
      E.searchInfo.style.display = '';
      return;
    }
    results.forEach(r => expandToPath(r.path));
    // Collect matching rows after expansion tick
    setTimeout(() => {
      results.forEach(r => {
        const row = E.treePanel.querySelector(`.n-row[data-path="${CSS.escape(r.path)}"]`);
        if (row) { row.classList.add('match'); S.searchMatches.push(row); }
      });
      if (S.searchMatches.length) { S.searchIdx = 0; focusMatch(); }
      E.searchInfo.style.display = '';
    }, 50);
    return;
  }

  // Text search: key + value
  const ql = q.toLowerCase();
  E.treePanel.querySelectorAll('.n-row').forEach(row => {
    if (row.dataset.search?.includes(ql)) {
      row.classList.add('match');
      S.searchMatches.push(row);
      expandAncestors(row);
    }
  });

  if (S.searchMatches.length) { S.searchIdx = 0; focusMatch(); }
  E.searchInfo.textContent  = S.searchMatches.length
    ? `${S.searchIdx + 1}/${S.searchMatches.length}`
    : '0 results';
  E.searchInfo.style.display = '';
}

// ── Event binding ─────────────────────────────────────────────────────────────

function bindSearchEvents() {
  E.searchInput.addEventListener('input', debounce(runSearch, 180));

  E.searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) searchPrev(); else searchFwd();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      E.searchInput.value = '';
      clearSearch();
    }
  });

  E.searchNext.addEventListener('click', searchFwd);
  E.searchPrev.addEventListener('click', searchPrev);
  E.searchClear.addEventListener('click', () => { E.searchInput.value = ''; clearSearch(); });
}
