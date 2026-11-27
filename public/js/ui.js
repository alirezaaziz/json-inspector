import { esc } from './util.js';
import { icon } from './icons.js';

// ── Toasts ───────────────────────────────────────────────────────────────────

export function toast(message, type = 'info', ms = 2800) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = icon(type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info') + `<span>${esc(message)}</span>`;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 250); }, ms);
}

// ── Clipboard / files ────────────────────────────────────────────────────────

export async function copy(text, what = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    if (!ok) { toast('Could not access the clipboard', 'error'); return false; }
  }
  toast(what, 'success', 1600);
  return true;
}

export function download(name, text, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept = '.json,.jsonl,.ndjson,.geojson,.json5,.txt,application/json') {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files[0] || null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

// ── Context menu ─────────────────────────────────────────────────────────────

let menuEl = null;
export function closeMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  document.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('blur', closeMenu);
  window.removeEventListener('resize', closeMenu);
}
function outside(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }

/** items: [{ label, icon, kbd, action, danger, disabled } | '-'] */
export function openMenu(items, x, y, { returnFocus } = {}) {
  closeMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'menu';
  menuEl.setAttribute('role', 'menu');
  const actions = [];
  menuEl.innerHTML = items.map(it => {
    if (it === '-') return '<div class="menu-sep" role="separator"></div>';
    if (it.heading) return `<div class="menu-head">${esc(it.heading)}</div>`;
    actions.push(it.action);
    return `<button role="menuitem" class="menu-item${it.danger ? ' danger' : ''}" data-i="${actions.length - 1}"${it.disabled ? ' disabled' : ''}>
      ${it.icon ? icon(it.icon) : '<span class="i"></span>'}<span class="menu-label">${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}</button>`;
  }).join('');
  document.body.appendChild(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  menuEl.style.top = (y + r.height > innerHeight - 8 ? Math.max(8, y - r.height) : y) + 'px';

  const buttons = [...menuEl.querySelectorAll('.menu-item:not([disabled])')];
  buttons[0]?.focus();
  menuEl.addEventListener('click', e => {
    const b = e.target.closest('.menu-item');
    if (!b || b.disabled) return;
    const fn = actions[+b.dataset.i];
    closeMenu();
    returnFocus?.focus();
    fn?.();
  });
  menuEl.addEventListener('keydown', e => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { buttons[(i + 1) % buttons.length]?.focus(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); e.preventDefault(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { closeMenu(); returnFocus?.focus(); e.preventDefault(); }
  });
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
  });
}

// ── Modal dialog ─────────────────────────────────────────────────────────────

/**
 * Opens a modal. `body` is HTML; `actions` are [{ label, value, primary, danger }].
 * `validate(form)` may return an error string to keep the dialog open.
 * Resolves with { value, form } or null when dismissed.
 */
export function modal({ title, body, actions = [{ label: 'Close', value: 'close', primary: true }], wide = false, validate, onOpen }) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal' + (wide ? ' wide' : '');
    dlg.innerHTML = `
      <form method="dialog" class="modal-form" novalidate>
        <header class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></header>
        <div class="modal-body">${body}</div>
        <p class="modal-err" hidden></p>
        <footer class="modal-foot">${actions.map((a, i) => `<button type="submit" value="${i}" class="btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}">${esc(a.label)}</button>`).join('')}</footer>
      </form>`;
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    const errEl = dlg.querySelector('.modal-err');
    let result = null;
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    form.addEventListener('submit', e => {
      const idx = e.submitter ? +e.submitter.value : actions.findIndex(a => a.primary);
      const action = actions[idx] || actions[0];
      if (action.primary && validate) {
        const err = validate(form);
        if (err) { e.preventDefault(); errEl.textContent = err; errEl.hidden = false; return; }
      }
      result = { value: action.value, form };
    });
    form.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(form.querySelector('.btn.primary')); }
    });
    dlg.addEventListener('close', () => { resolve(result); dlg.remove(); });
    dlg.showModal();
    onOpen?.(dlg);
    const first = dlg.querySelector('input, textarea, select');
    if (first) { first.focus(); first.select?.(); }
  });
}

export async function prompt({ title, label, value = '', placeholder = '', okLabel = 'Save', multiline = false, validate }) {
  const field = multiline
    ? `<textarea name="v" class="input code" rows="6" spellcheck="false" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input name="v" class="input" value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false" autocomplete="off">`;
  const r = await modal({
    title,
    body: `<label class="field"><span>${esc(label)}</span>${field}</label>`,
    actions: [{ label: 'Cancel', value: null }, { label: okLabel, value: 'ok', primary: true }],
    validate: validate ? f => validate(f.elements.v.value) : undefined,
  });
  return r && r.value === 'ok' ? r.form.elements.v.value : null;
}
