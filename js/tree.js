'use strict';

const LAZY_LIMIT = 150;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sortedKeys(obj) {
  const keys = Object.keys(obj);
  if (S.sort === 'asc')  return keys.sort((a, b) => a.localeCompare(b));
  if (S.sort === 'desc') return keys.sort((a, b) => b.localeCompare(a));
  return keys;
}

// ── Node construction ─────────────────────────────────────────────────────────

function buildNode(keyLabel, value, path, depth, isIdx) {
  const type = getType(value);
  const nodeEl = document.createElement('div');
  nodeEl.className = 'n';

  const row = document.createElement('div');
  row.className = 'n-row';
  row.dataset.path = path;
  row.dataset.type = type;

  const isContainer = type === 'object' || type === 'array';

  // Expand/collapse toggle
  const tog = document.createElement('span');
  tog.className = isContainer ? 'n-toggle open' : 'n-toggle';
  tog.textContent = isContainer ? '▾' : '';
  row.appendChild(tog);

  // Key label
  if (keyLabel !== null) {
    const keyEl = document.createElement('span');
    keyEl.className = isIdx ? 'n-key idx' : 'n-key';
    keyEl.textContent = isIdx ? String(keyLabel) : '"' + String(keyLabel) + '"';
    row.appendChild(keyEl);

    const colon = document.createElement('span');
    colon.className = 'n-punct';
    colon.textContent = ':';
    row.appendChild(colon);
  }

  // Search index text (key + value combined)
  let searchText = keyLabel !== null ? String(keyLabel) : '';

  if (isContainer) {
    const keys = type === 'array' ? null : sortedKeys(value);
    const count = type === 'array' ? value.length : keys.length;
    const sumEl = document.createElement('span');
    sumEl.className = 'n-summary';
    sumEl.textContent = type === 'array' ? `[ ${count} ]` : `{ ${count} }`;
    row.appendChild(sumEl);
  } else {
    const valEl = document.createElement('span');
    valEl.className = 'n-' + type;
    let display = type === 'string' ? '"' + value + '"' : type === 'null' ? 'null' : String(value);
    if (type === 'string' && value.length > 100) display = '"' + value.slice(0, 100) + '…"';
    valEl.textContent = display;
    row.appendChild(valEl);
    searchText += ' ' + (type === 'string' ? value : String(value));
  }

  row.dataset.search = searchText.toLowerCase();
  nodeEl.appendChild(row);

  // Children container (lazy)
  if (isContainer) {
    nodeEl.classList.add('collapsible');
    const childrenEl = document.createElement('div');
    childrenEl.className = 'n-children';
    nodeEl.appendChild(childrenEl);

    nodeEl._value = value;
    nodeEl._path  = path;
    nodeEl._depth = depth;
    nodeEl.dataset.rendered = 'false';

    if (depth < 2) {
      renderChildren(nodeEl);
    } else {
      nodeEl.classList.add('collapsed');
      tog.textContent = '▸';
      tog.classList.remove('open');
    }
  }

  row.addEventListener('click', e => {
    if (e.target === tog && isContainer) toggleNode(nodeEl);
    else selectNode(path, type, value, row);
  });

  return nodeEl;
}

function renderChildren(nodeEl) {
  if (nodeEl.dataset.rendered === 'true') return;

  const { _value: value, _path: path, _depth: depth } = nodeEl;
  const childrenEl = nodeEl.querySelector('.n-children');
  const isArr = Array.isArray(value);
  const entries = isArr
    ? value.map((v, i) => [i, v])
    : sortedKeys(value).map(k => [k, value[k]]);

  entries.slice(0, LAZY_LIMIT).forEach(([k, v]) =>
    childrenEl.appendChild(buildNode(k, v, pathSeg(path, k, isArr), depth + 1, isArr))
  );

  if (entries.length > LAZY_LIMIT) {
    const rem = entries.slice(LAZY_LIMIT);
    const btn = document.createElement('button');
    btn.className = 'show-more-btn';
    btn.textContent = `Show ${rem.length} more…`;
    btn.addEventListener('click', () => {
      rem.forEach(([k, v]) =>
        childrenEl.insertBefore(buildNode(k, v, pathSeg(path, k, isArr), depth + 1, isArr), btn)
      );
      btn.remove();
    });
    childrenEl.appendChild(btn);
  }

  nodeEl.dataset.rendered = 'true';
}

// ── Collapse / expand ─────────────────────────────────────────────────────────

function toggleNode(nodeEl) {
  if (nodeEl.dataset.rendered === 'false') renderChildren(nodeEl);
  const col = nodeEl.classList.toggle('collapsed');
  const tog = nodeEl.querySelector(':scope > .n-row > .n-toggle');
  if (tog) { tog.textContent = col ? '▸' : '▾'; tog.classList.toggle('open', !col); }
}

function setAllCollapsed(col) {
  function recurse(nodeEl) {
    if (!nodeEl.classList.contains('collapsible')) return;
    if (!col && nodeEl.dataset.rendered === 'false') renderChildren(nodeEl);
    nodeEl.classList.toggle('collapsed', col);
    const tog = nodeEl.querySelector(':scope > .n-row > .n-toggle');
    if (tog) { tog.textContent = col ? '▸' : '▾'; tog.classList.toggle('open', !col); }
    nodeEl.querySelectorAll(':scope > .n-children > .n').forEach(recurse);
  }
  E.treePanel.querySelectorAll(':scope > .n').forEach(recurse);
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderTree() {
  E.treePanel.innerHTML = '';
  E.treePanel.appendChild(buildNode(null, S.data, '$', 0, false));
}
