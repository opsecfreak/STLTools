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
