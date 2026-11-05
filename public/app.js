import { createViewer } from './viewer.js';

import { $, el, api, store, SECTIONS, SECTION_NAMES } from './lib.js';

const state = {
  tab: 'shop', shopSub: 'design',
  generators: [], presets: [], categories: [], items: [], designs: [],
  current: null, preset: null, design: null,
  lastResult: null, pendingOverrides: null, editing: null,
};

const viewer = createViewer($('viewer'));

// ---------- output ----------
function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}
const list = (node, items) => node.replaceChildren(...items.map((t) => el('li', { textContent: t })));

function renderResult(result) {
  state.lastResult = result;
  const rows = result.parts.map((part) => el('li', {},
    el('span', { className: 'name', textContent: part.name, title: 'Show only this part', onclick: () => viewer.show([part]) }),
    el('span', { className: 'stats', textContent: `${part.stats.size.join(' x ')} mm, ${(part.stats.volumeMm3 / 1000).toFixed(1)} cm3` }),
    el('a', { href: part.url, download: part.filename, textContent: 'STL' })));
  if (result.parts.length > 1) rows.push(el('li', {}, el('span', { className: 'name', textContent: 'show all', onclick: () => viewer.show(result.parts) })));
  $('parts').replaceChildren(...rows);
  list($('warnings'), result.warnings);
  list($('notes'), result.notes);
  $('zipAll').hidden = !result.zip;
  if (result.zip) $('zipAll').href = result.zip;
}

let runToken = 0;
async function runAndShow(promise, label) {
  const token = ++runToken; // ignore results from older requests that finish late
  setStatus(`Generating ${label}...`);
  $('run').disabled = true;
  try {
    const result = await promise;
    if (token !== runToken) return null;
    renderResult(result);
    await viewer.show(result.parts);
    setStatus(`${label}: ${result.parts.length} part${result.parts.length > 1 ? 's' : ''}`);
    return result;
  } catch (err) {
    setStatus(err.message, true);
    return null;
  } finally {
    $('run').disabled = false;
  }
}

// ---------- parameter form ----------
const fieldId = (key) => `p-${key}`;
const defaultsOf = (gen) => Object.fromEntries(Object.entries(gen.params).map(([k, d]) => [k, d.default]));

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

function generatorsForTab() {
  if ($('allGenerators').checked) return state.generators;
  return state.generators.filter((g) => g.sections.includes(state.tab));
}

function fillGeneratorSelect() {
  const gens = generatorsForTab();
  $('generator').replaceChildren(...gens.map((g) => el('option', { value: g.id, textContent: g.name })));
  if (state.current && gens.some((g) => g.id === state.current.id)) $('generator').value = state.current.id;
}

/** Load a generator into the form. source = { preset } | { design } | null */
function loadGenerator(id, values = null, source = {}) {
  state.current = state.generators.find((g) => g.id === id) ?? generatorsForTab()[0];
  state.preset = source.preset ?? null;
  state.design = source.design ?? null;
  if (![...$('generator').options].some((o) => o.value === state.current.id)) {
    $('generator').append(el('option', { value: state.current.id, textContent: state.current.name }));
  }
  $('generator').value = state.current.id;
  const what = state.design ? `Saved design "${state.design.name}"` : state.preset ? state.preset.name : state.current.name;
  $('description').textContent = `${what}: ${state.preset?.description || state.current.description}`;
  buildForm(state.current, values ?? defaultsOf(state.current));
  highlightPreset();
}

function loadPreset(preset, generateNow = true) {
  const gen = state.generators.find((g) => g.id === preset.generator);
  loadGenerator(gen.id, { ...defaultsOf(gen), ...preset.params }, { preset });
  store.set(`preset:${state.tab}`, preset.id);
  if (generateNow) run();
}

function run() {
  const params = readForm(state.current);
  return runAndShow(api('POST', `/api/generate/${state.current.id}`, params), state.design?.name ?? state.preset?.name ?? state.current.name);
}

/** Form values that differ from the loaded preset (or generator defaults). */
function overridesFromForm() {
  const gen = state.current;
  const base = { ...defaultsOf(gen), ...(state.preset?.params ?? {}) };
  const now = readForm(gen);
  const out = {};
  for (const [k, def] of Object.entries(gen.params)) {
    if (['labelText', 'labelLine2', 'text', 'line2'].includes(k)) continue;
    const a = def.type === 'boolean' ? Boolean(now[k]) : String(now[k]);
    const b = def.type === 'boolean' ? Boolean(base[k]) : String(base[k]);
    if (a !== b) out[k] = def.type === 'number' || def.type === 'integer' ? Number(now[k]) : now[k];
  }
  return out;
}

// ---------- preset browser ----------
function presetsForTab() {
  return state.presets.filter((p) => p.section === state.tab);
}

function renderPresetGroups() {
  const groups = [...new Set(presetsForTab().map((p) => p.group))];
  $('presetGroup').replaceChildren(el('option', { value: '', textContent: 'All groups' }), ...groups.map((g) => el('option', { value: g, textContent: g })));
}

function renderPresets() {
  const q = $('presetSearch').value.trim().toLowerCase();
  const group = $('presetGroup').value;
  const items = presetsForTab().filter((p) => (!group || p.group === group)
    && (!q || [p.id, p.name, p.description, p.group, p.generator, ...p.tags].join(' ').toLowerCase().includes(q)));
  $('presetList').replaceChildren(...items.map((p) => el('li', { dataset: { id: p.id }, title: p.description, onclick: () => loadPreset(p) },
    el('span', { className: 'pname', textContent: p.name }), el('span', { className: 'pgroup', textContent: p.group }))));
  if (!items.length) $('presetList').append(el('li', { className: 'muted', textContent: 'No presets match.' }));
  $('presetSearch').placeholder = `Search ${presetsForTab().length} presets`;
  highlightPreset();
}

function highlightPreset() {
  for (const li of $('presetList').children) li.classList.toggle('active', li.dataset.id === state.preset?.id);
}

// ---------- tabs ----------
function showPane(name) {
  $('pane-design').hidden = name !== 'design';
  $('pane-catalog').hidden = name !== 'catalog';
  $('pane-library').hidden = name !== 'library';
}

function switchTab(tab, { keepForm = false } = {}) {
  state.tab = tab;
  store.set('tab', tab);
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === tab);
  if (tab === 'library') {
    showPane('library');
    refreshDesigns().catch((err) => setStatus(err.message, true));
    return;
  }
  $('presetSearch').value = '';
  $('shopSwitch').hidden = tab !== 'shop';
  showPane(tab === 'shop' && state.shopSub === 'catalog' ? 'catalog' : 'design');
  if (tab === 'shop' && state.shopSub === 'catalog') refreshShop().catch((err) => setStatus(err.message, true));
  fillGeneratorSelect();
  renderPresetGroups();
  renderPresets();
  if (!keepForm) {
    const last = state.presets.find((p) => p.id === store.get(`preset:${tab}`) && p.section === tab);
    const first = last ?? presetsForTab()[0];
    if (first) loadPreset(first);
    else loadGenerator(generatorsForTab()[0].id);
  }
}

function switchShopSub(sub) {
  state.shopSub = sub;
  for (const b of document.querySelectorAll('.subtab')) b.classList.toggle('active', b.dataset.sub === sub);
  showPane(sub === 'catalog' ? 'catalog' : 'design');
  if (sub === 'catalog') refreshShop().catch((err) => setStatus(err.message, true));
}

// ---------- files: params import/export, local STL viewing ----------
function downloadJson(obj, filename) {
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2) + '\n'], { type: 'application/json' })), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportParams() {
  downloadJson({ generator: state.current.id, params: readForm(state.current) }, `${state.design?.id ?? state.preset?.id ?? state.current.id}.params.json`);
}

let importTarget = 'form';
async function onParamsFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const entries = Array.isArray(data) ? data : [data];
    if (importTarget === 'library') {
      for (const d of entries) await api('POST', '/api/designs', { name: d.name ?? file.name.replace(/\.(params\.)?json$/, ''), generator: d.generator, params: d.params, section: d.section, notes: d.notes });
      await refreshDesigns();
      setStatus(`Imported ${entries.length} design(s).`);
    } else {
      const d = entries[0];
      const gen = state.generators.find((g) => g.id === d.generator);
      if (!gen) throw new Error(`Unknown generator "${d.generator}" in ${file.name}`);
      loadGenerator(gen.id, { ...defaultsOf(gen), ...d.params });
      $('description').textContent = `Imported ${file.name}`;
      run();
    }
  } catch (err) {
    setStatus(`Import failed: ${err.message}`, true);
  }
}

async function onStlFiles(e) {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  try {
    const parts = [];
    for (const f of files) parts.push({ name: f.name, geometry: viewer.parse(await f.arrayBuffer()) });
    await viewer.show(parts);
    $('parts').replaceChildren(...parts.map((p) => el('li', {}, el('span', { className: 'name', textContent: p.name }), el('span', { className: 'stats', textContent: 'local file (view only)' }))));
    list($('warnings'), []);
    list($('notes'), ['Viewing local STL files. They are not uploaded.']);
    $('zipAll').hidden = true;
    setStatus(`Viewing ${files.length} file(s)`);
  } catch (err) {
    setStatus(`Could not read STL: ${err.message}`, true);
  }
}

// ---------- My Designs ----------
const sectionName = SECTION_NAMES;

async function refreshDesigns() {
  state.designs = await api('GET', '/api/designs');
  renderDesigns();
}

function renderDesigns() {
  const q = $('librarySearch').value.trim().toLowerCase();
  const items = state.designs.filter((d) => !q || [d.name, d.generator, d.section, d.notes].join(' ').toLowerCase().includes(q));
  const genName = (id) => state.generators.find((g) => g.id === id)?.name ?? id;
  const rows = items.map((d) => el('li', {},
    el('div', { className: 'info' },
      el('strong', { textContent: d.name }),
      el('div', { className: 'muted', textContent: `${genName(d.generator)} / ${sectionName[d.section] ?? d.section} / ${new Date(d.updatedAt).toLocaleString()}` })),
    el('div', { className: 'btns' },
      el('button', { type: 'button', textContent: 'Load', onclick: () => openDesign(d) }),
      el('button', { type: 'button', className: 'secondary', textContent: 'Make', onclick: () => runAndShow(api('POST', `/api/generate/${d.generator}`, d.params), d.name) }),
      el('button', { type: 'button', className: 'secondary', textContent: 'Rename', onclick: () => renameDesign(d) }),
      el('button', { type: 'button', className: 'secondary', textContent: 'Export', onclick: () => downloadJson({ name: d.name, generator: d.generator, section: d.section, params: d.params, notes: d.notes }, `${d.id}.params.json`) }),
      el('button', { type: 'button', className: 'secondary', textContent: 'Delete', onclick: () => deleteDesign(d) }))));
  if (!rows.length) rows.push(el('li', { className: 'muted empty', textContent: state.designs.length ? 'No saved designs match.' : 'No saved designs yet. Press "Save design" in any tab.' }));
  $('designList').replaceChildren(...rows);
}

function openDesign(d) {
  const tab = SECTIONS.includes(d.section) ? d.section : 'shop';
  state.shopSub = 'design';
  switchTab(tab, { keepForm: true });
  const gen = state.generators.find((g) => g.id === d.generator);
  loadGenerator(gen.id, { ...defaultsOf(gen), ...d.params }, { design: d, preset: state.presets.find((p) => p.id === d.presetId) });
  run();
}

async function saveDesign() {
  const suggested = state.design?.name ?? state.preset?.name ?? state.current.name;
  const name = prompt(state.design ? 'Save changes as (keep the name to overwrite):' : 'Name for this design:', suggested);
  if (!name) return;
  const body = { name, generator: state.current.id, params: readForm(state.current), section: state.tab, presetId: state.preset?.id ?? null };
  try {
    const saved = state.design && name === state.design.name
      ? await api('PUT', `/api/designs/${state.design.id}`, body)
      : await api('POST', '/api/designs', body);
    state.design = saved;
    setStatus(`Saved "${saved.name}" to My Designs.`);
  } catch (err) { setStatus(err.message, true); }
}

async function renameDesign(d) {
  const name = prompt('New name:', d.name);
  if (!name || name === d.name) return;
  try { await api('PUT', `/api/designs/${d.id}`, { name }); await refreshDesigns(); } catch (err) { alert(err.message); }
}

async function deleteDesign(d) {
  if (!confirm(`Delete saved design "${d.name}"? This cannot be undone.`)) return;
  try { await api('DELETE', `/api/designs/${d.id}`); await refreshDesigns(); } catch (err) { alert(err.message); }
}

// ---------- shop catalog ----------
const catByCode = (code) => state.categories.find((c) => c.code === code);
const presetById = (id) => state.presets.find((p) => p.id === id);

function presetOptions(select, selected) {
  select.replaceChildren();
  const groups = new Map();
  for (const p of state.presets) {
    const label = `${sectionName[p.section]}: ${p.group}`;
    if (!groups.has(label)) groups.set(label, el('optgroup', { label }));
    groups.get(label).append(el('option', { value: p.id, textContent: p.name, selected: p.id === selected }));
  }
  select.append(...groups.values());
}

function categoryOptions() {
  $('itemCategory').replaceChildren(...state.categories.map((c) => el('option', { value: c.code, textContent: `${c.code}  ${c.name}` })));
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
    const preset = presetById(item.presetId);
    return el('li', { style: `--cat:${catByCode(item.category)?.color ?? '#888'}` },
      el('input', { type: 'checkbox', className: 'pick', value: item.code, title: 'Include in paper labels' }),
      el('div', { className: 'info' },
        el('div', {}, el('strong', { textContent: item.code }), document.createTextNode(`  ${item.name}`)),
        el('div', { className: 'muted', textContent: [preset?.name ?? item.presetId, item.location && `at ${item.location}`, Object.keys(item.overrides ?? {}).length ? 'custom' : ''].filter(Boolean).join(' / ') })),
      el('div', { className: 'btns' },
        el('button', { type: 'button', textContent: 'Make', onclick: () => runAndShow(api('POST', `/api/catalog/${item.code}/generate`), item.code) }),
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

function resetItemForm() {
  state.editing = null;
  state.pendingOverrides = null;
  $('itemForm').reset();
  $('itemFormTitle').textContent = 'Add item';
  $('itemSave').textContent = 'Add item';
  $('itemCancel').hidden = true;
  $('itemCategory').disabled = false;
  presetOptions($('itemPreset'), store.get('preset:shop') ?? 'bin-s-100x150');
  showOverrides();
}

function showOverrides() {
  const o = state.pendingOverrides ?? (state.editing ? state.items.find((i) => i.code === state.editing)?.overrides : null) ?? {};
  $('itemOverrides').textContent = Object.keys(o).length ? `Custom settings on top of the design: ${Object.entries(o).map(([k, v]) => `${k}=${v}`).join(', ')}` : '';
}

function editItem(item) {
  state.editing = item.code;
  state.pendingOverrides = null;
  $('itemFormTitle').textContent = `Edit ${item.code}`;
  $('itemSave').textContent = 'Save changes';
  $('itemCancel').hidden = false;
  $('itemCategory').value = item.category;
  $('itemCategory').disabled = true;
  $('itemName').value = item.name;
  $('itemLocation').value = item.location ?? '';
  $('itemNotes').value = item.notes ?? '';
  presetOptions($('itemPreset'), item.presetId);
  showOverrides();
  $('itemForm').scrollIntoView({ behavior: 'smooth' });
}

async function deleteItem(item) {
  if (!confirm(`Delete ${item.code} ${item.name}? This cannot be undone.`)) return;
  try { await api('DELETE', `/api/catalog/${item.code}`); await refreshShop(); } catch (err) { alert(err.message); }
}

async function saveItem(e) {
  e.preventDefault();
  const body = { category: $('itemCategory').value, name: $('itemName').value, location: $('itemLocation').value, presetId: $('itemPreset').value, notes: $('itemNotes').value };
  if (state.pendingOverrides) body.overrides = state.pendingOverrides;
  else if (!state.editing) body.overrides = {};
  try {
    const item = state.editing ? await api('PUT', `/api/catalog/${state.editing}`, body) : await api('POST', '/api/catalog', body);
    resetItemForm();
    await refreshShop();
    await runAndShow(api('POST', `/api/catalog/${item.code}/generate`), item.code);
  } catch (err) { alert(err.message); }
}

function sendToShop() {
  if (!state.preset) {
    alert('Shop items are built from presets. Load the closest preset, change values, then press Add to shop.');
    return;
  }
  const preset = state.preset;
  const overrides = overridesFromForm();
  const labelGuess = $(fieldId('labelText'))?.value || $(fieldId('text'))?.value || '';
  if (state.tab !== 'shop') switchTab('shop', { keepForm: true });
  switchShopSub('catalog');
  resetItemForm();
  presetOptions($('itemPreset'), preset.id);
  state.pendingOverrides = overrides;
  showOverrides();
  $('itemName').value = labelGuess;
  $('itemName').focus();
}

function catRow(c = { code: '', name: '', color: '#6e7781' }) {
  return el('div', { className: 'cat-row' },
    el('input', { className: 'code', value: c.code, maxLength: 5, placeholder: 'CODE', 'aria-label': 'Code' }),
    el('input', { className: 'cname', value: c.name, maxLength: 40, placeholder: 'Name', 'aria-label': 'Name' }),
    el('input', { className: 'color', type: 'color', value: c.color, 'aria-label': 'Color' }),
    el('button', { type: 'button', className: 'secondary', textContent: 'x', title: 'Remove', onclick: (e) => e.target.parentElement.remove() }));
}

async function saveCategories(e) {
  e.preventDefault();
  const rows = [...$('catRows').children].map((r) => ({ code: r.querySelector('.code').value, name: r.querySelector('.cname').value, color: r.querySelector('.color').value })).filter((c) => c.code.trim());
  try { await api('PUT', '/api/categories', rows); $('catForm').hidden = true; await refreshShop(); } catch (err) { alert(err.message); }
}

// ---------- wire up ----------
$('run').onclick = run;
$('reset').onclick = () => buildForm(state.current, { ...defaultsOf(state.current), ...(state.preset?.params ?? {}), ...(state.design?.params ?? {}) });
$('saveDesign').onclick = saveDesign;
$('saveParams').onclick = exportParams;
$('openParams').onclick = () => { importTarget = 'form'; $('fileParams').click(); };
$('libraryImport').onclick = () => { importTarget = 'library'; $('fileParams').click(); };
$('fileParams').onchange = onParamsFile;
$('openStl').onclick = () => $('fileStl').click();
$('fileStl').onchange = onStlFiles;
$('toShop').onclick = sendToShop;
$('generator').onchange = () => loadGenerator($('generator').value);
$('allGenerators').onchange = fillGeneratorSelect;
$('params').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } };
$('presetSearch').oninput = renderPresets;
$('presetGroup').onchange = renderPresets;
$('librarySearch').oninput = renderDesigns;
$('shopFilter').onchange = renderItems;
$('shopSearch').oninput = renderItems;
$('itemForm').onsubmit = saveItem;
$('itemCancel').onclick = resetItemForm;
$('editCategories').onclick = () => { $('catRows').replaceChildren(...state.categories.map(catRow)); $('catForm').hidden = false; $('catForm').scrollIntoView({ behavior: 'smooth' }); };
$('catAdd').onclick = () => $('catRows').append(catRow());
$('catClose').onclick = () => { $('catForm').hidden = true; };
$('catForm').onsubmit = saveCategories;
$('printLabels').onclick = () => {
  const picked = [...document.querySelectorAll('#itemList .pick:checked')].map((c) => c.value);
  window.open(`/labels.html${picked.length ? `?codes=${encodeURIComponent(picked.join(','))}` : ''}`, '_blank');
};
for (const b of document.querySelectorAll('.tab')) b.onclick = () => switchTab(b.dataset.tab);
for (const b of document.querySelectorAll('.subtab')) b.onclick = () => switchShopSub(b.dataset.sub);

let version;
[state.generators, state.presets, version] = await Promise.all([api('GET', '/api/generators'), api('GET', '/api/presets'), api('GET', '/api/version')]);
$('appVersion').textContent = `v${version.version} / ${version.generators} generators / ${version.presets} presets`;
if (version.issues.length) {
  const badge = el('button', { type: 'button', className: 'issues small', textContent: `${version.issues.length} custom file problem${version.issues.length > 1 ? 's' : ''}`, title: 'Custom generators or presets that were skipped' });
  badge.onclick = () => { list($('warnings'), version.issues.map((i) => `Skipped: ${i}`)); };
  $('appVersion').after(badge);
}
resetItemForm();
const startTab = store.get('tab');
switchTab([...SECTIONS, 'library'].includes(startTab) ? startTab : 'shop');
