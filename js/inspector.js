'use strict';

const TYPE_COLORS = {
  string:  '#a5d6a7',
  number:  '#ffa657',
  boolean: '#d2a8ff',
  null:    '#656d76',
  object:  '#79c0ff',
  array:   '#3fb950',
};

// ── Select node ───────────────────────────────────────────────────────────────

function selectNode(path, type, value, rowEl) {
  if (S.selectedRow) S.selectedRow.classList.remove('selected');
  S.selectedRow = rowEl;
  rowEl.classList.add('selected');
  S.selectedPath  = path;
  S.selectedValue = value;

  // Resolve parent for sibling display
  const parts = pathParts(path);
  if (parts.length > 1) {
    const parentPath = buildPathFromParts(parts.slice(0, -1));
    S.selectedParent     = getByPath(S.data, parentPath);
    S.selectedParentPath = parentPath;
  } else {
    S.selectedParent     = null;
    S.selectedParentPath = null;
  }

  E.inspEmpty.classList.add('hidden');
  E.inspContent.classList.remove('hidden');

  renderTypeBadge(type);
  renderPathFormats(path);
  renderValue(type, value);
  renderSiblings(parts);
  updateBreadcrumb(path);
}

function renderTypeBadge(type) {
  const col = TYPE_COLORS[type] || '#8b949e';
  E.inspTypeBadge.textContent = type;
  E.inspTypeBadge.style.cssText = `background:${col}20;color:${col};border:1px solid ${col}40`;
}

function renderPathFormats(path) {
  E.pathFormats.innerHTML = '';
  const formats = [
    { label: 'JSONPath', val: path },
    { label: 'Pointer',  val: pathToPointer(path) },
    { label: 'Bracket',  val: pathToBracket(path) },
  ];
  formats.forEach(f => {
    const row  = document.createElement('div');
    row.className = 'path-format-item';

    const lbl  = document.createElement('span');
    lbl.style.cssText = 'font-size:10px;color:var(--text3);width:52px;flex-shrink:0';
    lbl.textContent = f.label;

    const code = document.createElement('code');
    code.textContent = f.val;
    code.title = f.val;

    const btn  = document.createElement('button');
    btn.textContent = 'Copy';
    btn.style.cssText = 'font-size:10.5px;padding:2px 7px';
    btn.addEventListener('click', () => copyText(f.val, btn));

    row.appendChild(lbl);
    row.appendChild(code);
    row.appendChild(btn);
    E.pathFormats.appendChild(row);
  });
}

function renderValue(type, value) {
  let valueText;
  if (type === 'object' || type === 'array') valueText = JSON.stringify(value, null, 2);
  else if (type === 'string') valueText = value;
  else valueText = String(value);

  E.inspValueBox.textContent  = valueText;
  E.inspValueLabel.textContent = (type === 'object' || type === 'array') ? 'JSON' : 'Value';
  E.btnCopyValue.onclick = () => copyText(valueText, E.btnCopyValue);

  // Reset edit area
  E.inspValueRow.style.display = '';
  E.inspEditRow.style.display  = 'none';
  E.editArea.value = valueText;
}

function renderSiblings(parts) {
  if (!S.selectedParent || typeof S.selectedParent !== 'object') {
    E.inspSiblingsRow.style.display = 'none';
    return;
  }
  const isArr      = Array.isArray(S.selectedParent);
  const currentKey = parts[parts.length - 1];
  const entries    = isArr
    ? S.selectedParent.map((v, i) => [i, v])
    : Object.entries(S.selectedParent);

  if (entries.length <= 1) { E.inspSiblingsRow.style.display = 'none'; return; }

  E.inspSiblingsRow.style.display = '';
  E.inspSiblings.innerHTML = '';

  entries.slice(0, 12).forEach(([k, v]) => {
    const isCurrent = isArr ? k === currentKey : String(k) === String(currentKey);
    const sibRow    = document.createElement('div');
    sibRow.className = 'sibling-row' + (isCurrent ? ' current' : '');

    const keySpan = document.createElement('span');
    keySpan.className   = 'sibling-key';
    keySpan.textContent = isArr ? `[${k}]` : k + ':';

    const valSpan = document.createElement('span');
    valSpan.className = 'sibling-val';
    const vt = getType(v);
    valSpan.textContent = vt === 'string' ? '"' + String(v).slice(0, 30) + '"'
      : vt === 'null'   ? 'null'
      : vt === 'object' ? '{…}'
      : vt === 'array'  ? '[…]'
      : String(v);

    sibRow.appendChild(keySpan);
    sibRow.appendChild(valSpan);
    sibRow.addEventListener('click', () => {
      const sibPath  = pathSeg(S.selectedParentPath, k, isArr);
      const sibRowEl = E.treePanel.querySelector(`.n-row[data-path="${CSS.escape(sibPath)}"]`);
      if (sibRowEl) {
        selectNode(sibPath, getType(v), v, sibRowEl);
        sibRowEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });

    E.inspSiblings.appendChild(sibRow);
  });

  if (entries.length > 12) {
    const more = document.createElement('div');
    more.style.cssText = 'font-size:11px;color:var(--text3);padding:2px 6px';
    more.textContent   = `+${entries.length - 12} more`;
    E.inspSiblings.appendChild(more);
  }
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────

function updateBreadcrumb(path) {
  E.breadcrumb.style.display = 'flex';
  E.breadcrumb.innerHTML     = '';
  const parts = pathParts(path);

  parts.forEach((seg, i) => {
    const segPath = buildPathFromParts(parts.slice(0, i + 1));
    const isLast  = i === parts.length - 1;

    const span = document.createElement('span');
    span.className   = 'bc-item' + (isLast ? ' last' : '');
    span.textContent = i === 0 ? '$' : typeof seg === 'number' ? `[${seg}]` : seg;

    if (!isLast) {
      span.addEventListener('click', () => {
        const v     = getByPath(S.data, segPath);
        const rowEl = E.treePanel.querySelector(`.n-row[data-path="${CSS.escape(segPath)}"]`);
        if (v !== undefined && rowEl) {
          selectNode(segPath, getType(v), v, rowEl);
          rowEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      });
    }

    E.breadcrumb.appendChild(span);

    if (!isLast) {
      const sep = document.createElement('span');
      sep.className   = 'bc-sep';
      sep.textContent = '›';
      E.breadcrumb.appendChild(sep);
    }
  });
}

// ── Edit handlers ─────────────────────────────────────────────────────────────

function bindInspectorEvents() {
  E.btnEdit.addEventListener('click', () => {
    E.inspValueRow.style.display = 'none';
    E.inspEditRow.style.display  = '';
    E.editArea.focus();
  });

  E.btnCancelEdit.addEventListener('click', () => {
    E.inspValueRow.style.display = '';
    E.inspEditRow.style.display  = 'none';
  });

  E.btnSaveEdit.addEventListener('click', () => {
    const rawEdit = E.editArea.value.trim();
    let newVal;
    const type = getType(S.selectedValue);
    if (type === 'string') {
      newVal = rawEdit;
    } else {
      try { newVal = JSON.parse(rawEdit); }
      catch(e) { alert('Invalid JSON value:\n' + e.message); return; }
    }

    setByPath(S.data, S.selectedPath, newVal);
    const savedPath = S.selectedPath;
    loadWorkspace(S.data, false);

    // Re-select the same node after re-render
    setTimeout(() => {
      const rowEl = E.treePanel.querySelector(`.n-row[data-path="${CSS.escape(savedPath)}"]`);
      if (rowEl) {
        const v = getByPath(S.data, savedPath);
        selectNode(savedPath, getType(v), v, rowEl);
      }
    }, 50);
  });
}
