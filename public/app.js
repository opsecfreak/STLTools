import { createViewer } from './viewer.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.includes('-')) n.setAttribute(k, v); // aria-*, data-*
    else n[k] = v;
  }
  for (const c of children) n.append(c);
  return n;
};

// ---------- api ----------
async function api(method, url, body) {
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

// Per-viewer conveniences only. Shop data lives on the server.
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const state = {
  generators: [], presets: [], categories: [], items: [],
  current: null,       // generator
  preset: null,        // preset loaded into the form, if any
  lastResult: null,
  pendingOverrides: null, // from "Add to shop"
  editing: null,       // item code being edited
};

const viewer = createViewer($('viewer'));

// ---------- output panel ----------
function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}

function list(node, items) {
  node.replaceChildren(...items.map((t) => el('li', { textContent: t })));
}

function renderResult(result) {
  state.lastResult = result;
  const rows = result.parts.map((part) => {
    const s = part.stats;
    return el('li', { dataset: { name: part.name } },
      el('span', { className: 'name', textContent: part.name, title: 'Show only this part', onclick: () => viewer.show([part]) }),
      el('span', { className: 'stats', textContent: `${s.size.join(' x ')} mm, ${(s.volumeMm3 / 1000).toFixed(1)} cm3` }),
      el('a', { href: part.url, download: part.filename, textContent: 'Download STL' }));
  });
  if (result.parts.length > 1) {
    rows.push(el('li', {},
      el('span', { className: 'name', textContent: 'show all', onclick: () => viewer.show(result.parts) }),
      el('a', { href: '#', textContent: 'Download all', onclick: (e) => { e.preventDefault(); downloadAll(result.parts); } })));
  }
  $('parts').replaceChildren(...rows);
  list($('warnings'), result.warnings);
  list($('notes'), result.notes);
}

function downloadAll(parts) {
  parts.forEach((p, i) => setTimeout(() => el('a', { href: p.url, download: p.filename }).click(), i * 300));
}

async function runAndShow(promise, label) {
  setStatus(`Generating ${label}...`);
  $('run').disabled = true;
  try {
    const result = await promise;
    renderResult(result);
    await viewer.show(result.parts);
    setStatus('');
    return result;
  } catch (err) {
    setStatus(err.message, true);
    return null;
  } finally {
    $('run').disabled = false;
  }
}

// ---------- designs tab: form ----------
const fieldId = (key) => `p-${key}`;

function buildForm(gen, values) {
  const form = $('params');
  form.replaceChildren();
  const groups = new Map();
  for (const [key, def] of Object.entries(gen.params)) {
    const g = def.group ?? 'Parameters';
    if (!groups.has(g)) {
      const fs = el('fieldset', {}, el('legend', { textContent: g }));
      groups.set(g, fs);
      form.append(fs);
    }
    const value = values?.[key] ?? def.default;
    const wrap = el('div', { className: 'field' });
    let input;
    if (def.type === 'boolean') {
      wrap.classList.add('check');
      input = el('input', { type: 'checkbox', checked: Boolean(value) });
      wrap.append(el('label', {}, input, document.createTextNode(def.label)));
    } else {
      const label = el('label', {}, el('span', { textContent: def.label }));
      if (def.unit) label.append(el('span', { className: 'unit', textContent: def.unit }));
      if (def.type === 'select') {
        input = el('select');
        for (const o of def.options) input.append(el('option', { value: o.value ?? o, textContent: o.label ?? o }));
      } else if (def.type === 'string') {
        input = el('input', { type: 'text' });
        if (def.pattern) input.pattern = def.pattern;
        if (def.maxLength) input.maxLength = def.maxLength;
      } else {
        input = el('input', { type: 'number', step: def.type === 'integer' ? 1 : def.step ?? 'any' });
        if (def.min !== undefined) input.min = def.min;
        if (def.max !== undefined) input.max = def.max;
      }
      input.value = value;
      label.htmlFor = fieldId(key);
      wrap.append(label, input);
    }
    input.id = fieldId(key);
    input.name = key;
    if (def.help) wrap.append(el('div', { className: 'help', textContent: def.help }));
    groups.get(g).append(wrap);
  }
}

function readForm(gen) {
  const out = {};
  for (const [key, def] of Object.entries(gen.params)) {
    const input = $(fieldId(key));
    out[key] = def.type === 'boolean' ? input.checked : input.value;
  }
  return out;
}

function selectGenerator(id, values = null, preset = null) {
  state.current = state.generators.find((g) => g.id === id) ?? state.generators[0];
  state.preset = preset;
  $('generator').value = state.current.id;
  $('description').textContent = preset ? `${preset.name}: ${preset.description}` : state.current.description;
  buildForm(state.current, values ?? store.get(`params:${state.current.id}`));
  store.set('generator', state.current.id);
  highlightPreset();
}

function loadPreset(preset) {
  const gen = state.generators.find((g) => g.id === preset.generator);
  const values = Object.fromEntries(Object.entries(gen.params).map(([k, d]) => [k, d.default]));
  Object.assign(values, preset.params);
  selectGenerator(gen.id, values, preset);
  store.set('preset', preset.id);
  run();
}

function run() {
  const params = readForm(state.current);
  store.set(`params:${state.current.id}`, params);
  return runAndShow(api('POST', `/api/generate/${state.current.id}`, params), state.current.name);
}

/** Form values that differ from the loaded preset (or generator defaults). */
function overridesFromForm() {
  const gen = state.current;
  const base = Object.fromEntries(Object.entries(gen.params).map(([k, d]) => [k, d.default]));
  if (state.preset) Object.assign(base, state.preset.params);
  const now = readForm(gen);
  const out = {};
  for (const [k, def] of Object.entries(gen.params)) {
    if (['labelText', 'labelLine2', 'text', 'line2'].includes(k)) continue; // the shop fills these
    const a = def.type === 'boolean' ? Boolean(now[k]) : String(now[k]);
    const b = def.type === 'boolean' ? Boolean(base[k]) : String(base[k]);
    if (a !== b) out[k] = def.type === 'number' || def.type === 'integer' ? Number(now[k]) : now[k];
  }
  return out;
}

// ---------- designs tab: preset browser ----------
function renderPresets() {
  const q = $('presetSearch').value.trim().toLowerCase();
  const group = $('presetGroup').value;
  const items = state.presets.filter((p) => (!group || p.group === group)
    && (!q || [p.id, p.name, p.description, p.group, ...p.tags].join(' ').toLowerCase().includes(q)));
  $('presetList').replaceChildren(...items.map((p) => el('li', {
    dataset: { id: p.id },
    title: p.description,
    onclick: () => loadPreset(p),
  }, el('span', { className: 'pname', textContent: p.name }), el('span', { className: 'pgroup', textContent: p.group }))));
  if (!items.length) $('presetList').append(el('li', { className: 'muted', textContent: 'No presets match.' }));
  highlightPreset();
}

function highlightPreset() {
  for (const li of $('presetList').children) li.classList.toggle('active', li.dataset.id === state.preset?.id);
}

// ---------- shop tab ----------
const catByCode = (code) => state.categories.find((c) => c.code === code);
const presetById = (id) => state.presets.find((p) => p.id === id);

function presetOptions(select, selected) {
  select.replaceChildren();
  const groups = new Map();
  for (const p of state.presets) {
    if (!groups.has(p.group)) groups.set(p.group, el('optgroup', { label: p.group }));
    groups.get(p.group).append(el('option', { value: p.id, textContent: p.name, selected: p.id === selected }));
  }
  select.append(...groups.values());
}

function categoryOptions() {
  const opts = state.categories.map((c) => el('option', { value: c.code, textContent: `${c.code}  ${c.name}` }));
  $('itemCategory').replaceChildren(...opts);
  const filter = $('shopFilter').value;
  $('shopFilter').replaceChildren(el('option', { value: '', textContent: 'All categories' }),
    ...state.categories.map((c) => el('option', { value: c.code, textContent: `${c.code}  ${c.name} (${state.items.filter((i) => i.category === c.code).length})` })));
  $('shopFilter').value = filter;
}

function renderItems() {
  const cat = $('shopFilter').value;
  const q = $('shopSearch').value.trim().toLowerCase();
  const items = state.items
    .filter((i) => (!cat || i.category === cat) && (!q || [i.code, i.name, i.location, i.notes].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => a.code.localeCompare(b.code));
  const rows = items.map((item) => {
    const c = catByCode(item.category);
    const preset = presetById(item.presetId);
    return el('li', { style: `--cat:${c?.color ?? '#888'}` },
      el('input', { type: 'checkbox', className: 'pick', value: item.code, title: 'Include in paper labels' }),
      el('div', { className: 'info' },
        el('div', {}, el('strong', { textContent: item.code }), document.createTextNode(`  ${item.name}`)),
        el('div', { className: 'muted', textContent: [preset?.name ?? item.presetId, item.location && `at ${item.location}`, Object.keys(item.overrides ?? {}).length ? 'custom' : ''].filter(Boolean).join(' / ') })),
      el('div', { className: 'btns' },
        el('button', { type: 'button', textContent: 'Make', onclick: () => makeItem(item) }),
        el('button', { type: 'button', className: 'secondary', textContent: 'Edit', onclick: () => editItem(item) }),
        el('button', { type: 'button', className: 'secondary', textContent: 'Delete', onclick: () => deleteItem(item) })));
  });
  if (!rows.length) rows.push(el('li', { className: 'muted empty', textContent: state.items.length ? 'No items match.' : 'No items yet. Add your first bin below.' }));
  $('itemList').replaceChildren(...rows);
}

async function refreshShop() {
  [state.categories, state.items] = await Promise.all([api('GET', '/api/categories'), api('GET', '/api/catalog')]);
  categoryOptions();
  renderItems();
}

function makeItem(item) {
  return runAndShow(api('POST', `/api/catalog/${item.code}/generate`), item.code);
}

function resetItemForm() {
  state.editing = null;
  state.pendingOverrides = null;
  $('itemForm').reset();
  $('itemFormTitle').textContent = 'Add item';
  $('itemSave').textContent = 'Add item';
  $('itemCancel').hidden = true;
  $('itemCategory').disabled = false;
  presetOptions($('itemPreset'), store.get('preset') ?? 'bin-s-100x150');
  showOverrides();
}

function showOverrides() {
  const o = state.pendingOverrides ?? (state.editing ? state.items.find((i) => i.code === state.editing)?.overrides : null) ?? {};
  const n = Object.keys(o).length;
  $('itemOverrides').textContent = n ? `Custom settings on top of the design: ${Object.entries(o).map(([k, v]) => `${k}=${v}`).join(', ')}` : '';
}

function editItem(item) {
  state.editing = item.code;
  state.pendingOverrides = null;
  $('itemFormTitle').textContent = `Edit ${item.code}`;
  $('itemSave').textContent = 'Save changes';
  $('itemCancel').hidden = false;
  $('itemCategory').value = item.category;
  $('itemCategory').disabled = true; // the code depends on the category
  $('itemName').value = item.name;
  $('itemLocation').value = item.location ?? '';
  $('itemNotes').value = item.notes ?? '';
  presetOptions($('itemPreset'), item.presetId);
  showOverrides();
  $('itemForm').scrollIntoView({ behavior: 'smooth' });
}

async function deleteItem(item) {
  if (!confirm(`Delete ${item.code} ${item.name}? This cannot be undone.`)) return;
  try {
    await api('DELETE', `/api/catalog/${item.code}`);
    await refreshShop();
  } catch (err) { alert(err.message); }
}

async function saveItem(e) {
  e.preventDefault();
  const body = {
    category: $('itemCategory').value,
    name: $('itemName').value,
    location: $('itemLocation').value,
    presetId: $('itemPreset').value,
    notes: $('itemNotes').value,
  };
  if (state.pendingOverrides) body.overrides = state.pendingOverrides;
  else if (!state.editing) body.overrides = {};
  try {
    const item = state.editing
      ? await api('PUT', `/api/catalog/${state.editing}`, body)
      : await api('POST', '/api/catalog', body);
    resetItemForm();
    await refreshShop();
    await makeItem(item);
  } catch (err) { alert(err.message); }
}

function sendToShop() {
  const preset = state.preset;
  if (!preset) {
    alert('Load a preset first (shop items are built from presets). Pick the closest preset, change values, then press Add to shop.');
    return;
  }
  switchTab('shop');
  resetItemForm();
  presetOptions($('itemPreset'), preset.id);
  state.pendingOverrides = overridesFromForm();
  showOverrides();
  const labelGuess = $(fieldId('labelText'))?.value || $(fieldId('text'))?.value || '';
  $('itemName').value = labelGuess;
  $('itemName').focus();
}

// categories editor
function catRow(c = { code: '', name: '', color: '#6e7781' }) {
  return el('div', { className: 'cat-row' },
    el('input', { className: 'code', value: c.code, maxLength: 5, placeholder: 'CODE', 'aria-label': 'Code' }),
    el('input', { className: 'cname', value: c.name, maxLength: 40, placeholder: 'Name', 'aria-label': 'Name' }),
    el('input', { className: 'color', type: 'color', value: c.color, 'aria-label': 'Color' }),
    el('button', { type: 'button', className: 'secondary', textContent: 'x', title: 'Remove', onclick: (e) => e.target.parentElement.remove() }));
}

function openCategories() {
  $('catRows').replaceChildren(...state.categories.map(catRow));
  $('catForm').hidden = false;
  $('catForm').scrollIntoView({ behavior: 'smooth' });
}

async function saveCategories(e) {
  e.preventDefault();
  const list = [...$('catRows').children].map((r) => ({
    code: r.querySelector('.code').value, name: r.querySelector('.cname').value, color: r.querySelector('.color').value,
  })).filter((c) => c.code.trim());
  try {
    await api('PUT', '/api/categories', list);
    $('catForm').hidden = true;
    await refreshShop();
  } catch (err) { alert(err.message); }
}

function printLabels() {
  const picked = [...document.querySelectorAll('#itemList .pick:checked')].map((c) => c.value);
  window.open(`/labels.html${picked.length ? `?codes=${encodeURIComponent(picked.join(','))}` : ''}`, '_blank');
}

// ---------- tabs ----------
function switchTab(name) {
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === name);
  $('tab-designs').hidden = name !== 'designs';
  $('tab-shop').hidden = name !== 'shop';
  store.set('tab', name);
  if (name === 'shop') refreshShop().catch((err) => setStatus(err.message, true));
}

// ---------- init ----------
$('run').onclick = run;
$('reset').onclick = () => buildForm(state.current, state.preset ? { ...state.preset.params } : null);
$('saveParams').onclick = () => {
  const body = JSON.stringify({ generator: state.current.id, params: readForm(state.current) }, null, 2);
  const a = el('a', { href: URL.createObjectURL(new Blob([body + '\n'], { type: 'application/json' })), download: `${state.preset?.id ?? state.current.id}.params.json` });
  a.click();
  URL.revokeObjectURL(a.href);
};
$('toShop').onclick = sendToShop;
$('generator').onchange = () => selectGenerator($('generator').value);
$('params').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } };
$('presetSearch').oninput = renderPresets;
$('presetGroup').onchange = renderPresets;
$('shopFilter').onchange = renderItems;
$('shopSearch').oninput = renderItems;
$('itemForm').onsubmit = saveItem;
$('itemCancel').onclick = resetItemForm;
$('editCategories').onclick = openCategories;
$('catAdd').onclick = () => $('catRows').append(catRow());
$('catClose').onclick = () => { $('catForm').hidden = true; };
$('catForm').onsubmit = saveCategories;
$('printLabels').onclick = printLabels;
for (const b of document.querySelectorAll('.tab')) b.onclick = () => switchTab(b.dataset.tab);

[state.generators, state.presets] = await Promise.all([api('GET', '/api/generators'), api('GET', '/api/presets')]);
$('generator').append(...state.generators.map((g) => el('option', { value: g.id, textContent: g.name })));
$('presetGroup').append(...[...new Set(state.presets.map((p) => p.group))].map((g) => el('option', { value: g, textContent: g })));
renderPresets();
resetItemForm();

const lastPreset = state.presets.find((p) => p.id === store.get('preset'));
if (lastPreset) loadPreset(lastPreset);
else loadPreset(state.presets[0]);
if (store.get('tab') === 'shop') switchTab('shop');
