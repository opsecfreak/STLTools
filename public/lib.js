// Small shared helpers for the web UI.

export const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.includes('-')) n.setAttribute(k, v);
    else n[k] = v;
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.errors ? data.errors.join('\n') : data.error || res.statusText);
  return data;
}

// Per-viewer conveniences only (last tab, view mode). Shared data lives on the server.
export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

export const SECTIONS = ['shop', 'planes', 'quads', 'accessories', 'robotics'];
export const SECTION_NAMES = { shop: 'Shop', planes: 'Planes', quads: 'Quadcopters', accessories: 'Accessories', robotics: 'Robotics' };

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function fmtDuration(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '-';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '-';
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function fmtAgo(isoOrSec) {
  const t = typeof isoOrSec === 'number' ? isoOrSec * 1000 : Date.parse(isoOrSec);
  if (!Number.isFinite(t)) return '';
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

/** Modal with buttons or a list of choices. Resolves to the chosen value, or null if cancelled. */
export function chooseDialog(title, choices, { message = '', input = null } = {}) {
  return new Promise((resolve) => {
    const dlg = el('dialog', { className: 'dialog' });
    const field = input ? el('input', { type: 'text', value: input.value ?? '', placeholder: input.placeholder ?? '', maxLength: input.maxLength ?? 80 }) : null;
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(
      el('h2', { textContent: title }),
      message ? el('p', { className: 'muted', textContent: message }) : null,
      field,
      el('div', { className: 'dialog-choices' }, ...choices.map((c) => el('button', {
        type: 'button', className: c.secondary ? 'secondary' : '', textContent: c.label,
        onclick: () => close(field ? { value: c.value, text: field.value.trim() } : c.value),
      }))),
      el('div', { className: 'row' }, el('button', { type: 'button', className: 'secondary', textContent: 'Cancel', onclick: () => close(null) })),
    );
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    document.body.append(dlg);
    dlg.showModal();
    field?.focus();
  });
}

// ---------------------------------------------------------------- v6 helpers

/** Short message at the bottom of the screen. kind: 'ok' | 'error' | 'info'. */
export function toast(message, kind = 'info', ms = 3500) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = el('div', { id: 'toasts', className: 'toasts', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const t = el('div', { className: `toast toast-${kind}`, textContent: message, role: kind === 'error' ? 'alert' : 'status' });
  t.onclick = () => t.remove();
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? ms * 2 : ms);
}

// Server-side settings (data/settings.json), cached here. See src/core/settings.js for the schema.
let settingsCache = null;
const settingsListeners = new Set();

export async function loadSettings() {
  settingsCache = await api('GET', '/api/settings');
  applyTheme(settingsCache.ui.theme);
  return settingsCache;
}

/** A length in mm, shown in the unit chosen in Settings > Appearance (mm, cm, in). */
export function fmtLen(mm, digits = 1) {
  const u = settingsCache?.ui?.units ?? 'mm';
  if (!Number.isFinite(Number(mm))) return '-';
  if (u === 'in') return `${(mm / 25.4).toFixed(digits + 2)} in`;
  if (u === 'cm') return `${(mm / 10).toFixed(digits + 1)} cm`;
  return `${Number(mm).toFixed(digits)} mm`;
}
/** Several lengths "a x b x c unit". */
export function fmtSize(arr, digits = 1) {
  const u = settingsCache?.ui?.units ?? 'mm';
  const f = u === 'in' ? 1 / 25.4 : u === 'cm' ? 0.1 : 1;
  const d = u === 'in' ? digits + 2 : u === 'cm' ? digits + 1 : digits;
  return `${arr.map((v) => (v * f).toFixed(d)).join(' x ')} ${u}`;
}

/** Current settings (call loadSettings() once at start-up). */
export const settings = () => settingsCache;

/** Save a partial change, e.g. saveSettings({ viewer: { edges: true } }). Notifies listeners. */
export async function saveSettings(patch) {
  settingsCache = await api('PUT', '/api/settings', patch);
  applyTheme(settingsCache.ui.theme);
  for (const fn of settingsListeners) fn(settingsCache, patch);
  return settingsCache;
}

// Printer features are optional (Settings > Printers > Printer features): 'on', 'off',
// or 'auto' = shown when at least one printer is saved. Elements marked
// data-needs-printers are hidden by CSS while <body data-printers="off">.
let printersOn = false;
export const printersVisible = () => printersOn;
export async function refreshPrinterVisibility() {
  const mode = settingsCache?.printers.enabled ?? 'auto';
  if (mode === 'auto') printersOn = (await api('GET', '/api/printers').catch(() => [])).length > 0;
  else printersOn = mode === 'on';
  document.body.dataset.printers = printersOn ? 'on' : 'off';
  return printersOn;
}

/** Run fn(settings, patch) after every saveSettings(). Returns an unsubscribe function. */
export function onSettings(fn) {
  settingsListeners.add(fn);
  return () => settingsListeners.delete(fn);
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  window.dispatchEvent(new Event('themechange'));
}

export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t) return t === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Card view mode: what the user last picked on this device, else the Settings default. */
export const viewMode = () => store.get('view') ?? settingsCache?.ui.view ?? 'grid';

/** Ask before deleting, unless turned off in Settings. */
export const confirmDelete = (msg) => (settingsCache?.ui.confirmDelete === false ? true : confirm(msg));

export function downloadBlob(blob, filename) {
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Upload a File as the raw request body (STL library, G-code). Returns parsed JSON. */
export async function putFile(url, file) {
  const res = await fetch(url, { method: 'PUT', body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ---------------------------------------------------------------- tooltips (1.0)
// One tooltip for the whole app. Any element with a `title` (or data-tip) gets it:
// the native title is moved to data-tip on first hover so the browser's own
// tooltip does not show twice. Settings > Tooltips and help: on/off, delay, size.
let tipEl = null;
let tipTimer = null;
export function initTooltips() {
  tipEl = el('div', { className: 'tooltip', role: 'tooltip', hidden: true });
  document.body.append(tipEl);
  const hide = () => { clearTimeout(tipTimer); tipEl.hidden = true; };
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest?.('[title], [data-tip]');
    if (!t) return;
    if (t.title) { t.dataset.tip = t.title; t.removeAttribute('title'); }
    const text = t.dataset.tip;
    const cfg = settingsCache?.tips;
    if (!text || cfg?.tooltips === false) return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      tipEl.textContent = text;
      tipEl.className = `tooltip tip-${cfg?.tooltipSize ?? 'normal'}`;
      tipEl.hidden = false;
      const r = t.getBoundingClientRect();
      const w = tipEl.offsetWidth;
      const h = tipEl.offsetHeight;
      let x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
      let y = r.bottom + 8;
      if (y + h > window.innerHeight - 8) y = r.top - h - 8;
      tipEl.style.left = `${x}px`;
      tipEl.style.top = `${Math.max(8, y)}px`;
    }, cfg?.tooltipDelay ?? 350);
  });
  document.addEventListener('mouseout', (e) => { if (e.target.closest?.('[data-tip]')) hide(); });
  document.addEventListener('mousedown', hide);
  document.addEventListener('keydown', hide);
  window.addEventListener('scroll', hide, true);
}
