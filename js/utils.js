'use strict';

// ── Type helpers ──────────────────────────────────────────────────────────────

function getType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function copyText(text, btn) {
  const orig = btn.textContent;
  const done = ok => {
    btn.textContent = ok ? '✓ Copied' : '✗ Failed';
    btn.classList.toggle('copy-success', ok);
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copy-success'); }, 1200);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => done(true)).catch(() => done(false));
  } else {
    try {
      const t = document.createElement('textarea');
      t.value = text;
      t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
      done(true);
    } catch(e) { done(false); }
  }
}

// ── Path utilities ────────────────────────────────────────────────────────────

function pathSeg(parent, key, isArr) {
  if (isArr) return parent + '[' + key + ']';
  if (/^[A-Za-z_$][\w$]*$/.test(String(key))) return parent + '.' + key;
  return parent + '["' + String(key).replace(/"/g, '\\"') + '"]';
}

function pathToPointer(p) {
  return p
    .replace(/^\$/, '')
    .replace(/\./g, '/')
    .replace(/\[(\d+)\]/g, '/$1')
    .replace(/\["([^"]+)"\]/g, '/$1');
}

function pathToBracket(p) {
  return p.replace(/\.([A-Za-z_$][\w$]*)/g, '["$1"]');
}

function pathParts(p) {
  const parts = ['$'];
  const s = p.slice(1);
  const re = /\.([A-Za-z_$][\w$]*|\*)|\[(\d+)\]|\["([^"]+)"\]/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[1] !== undefined) parts.push(m[1]);
    else if (m[2] !== undefined) parts.push(parseInt(m[2]));
    else if (m[3] !== undefined) parts.push(m[3]);
  }
  return parts;
}

function buildPathFromParts(parts) {
  let p = '$';
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    if (typeof seg === 'number') p += '[' + seg + ']';
    else if (/^[A-Za-z_$][\w$]*$/.test(String(seg))) p += '.' + seg;
    else p += '["' + String(seg) + '"]';
  }
  return p;
}

function getByPath(root, p) {
  try {
    const parts = pathParts(p);
    let cur = root;
    for (let i = 1; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  } catch(e) { return undefined; }
}

function setByPath(root, p, value) {
  const parts = pathParts(p);
  let cur = root;
  for (let i = 1; i < parts.length - 1; i++) {
    if (cur == null) return;
    cur = cur[parts[i]];
  }
  if (cur != null && parts.length > 1) cur[parts[parts.length - 1]] = value;
}
