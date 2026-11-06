// Main UI controller: routing, the designer (parameter form + 3D view),
// shop catalog, My Designs, and the glue between the page modules:
//   home.js      Home, search index, cards, projects     search.js  header search
//   settings.js  Settings page                           files.js   Import, STL Files, one STL
//   printers.js  Printers page (view only)               viewtools.js  3D view controls + estimate
//   viewer.js    three.js viewer and thumbnailer         lib.js     shared helpers + settings cache
// Routes (location.hash): #home #shop #planes #quads #accessories #robotics #library
//   #projects #project/<id> #stls #stl/<id> #import #printers #settings[/<section>]
import { createViewer } from './viewer.js';

import { $, el, api, store, SECTIONS, SECTION_NAMES, loadSettings, settings, saveSettings, onSettings, toast, debounce, confirmDelete, initTooltips, refreshPrinterVisibility, printersVisible } from './lib.js';
import { initHome, renderHome, renderProjects, renderProject, addToProject, starButton, stopProjectView } from './home.js';
import { renderPrinters, stopPrinters } from './printers.js';
import { initViewTools, createEstimateBox } from './viewtools.js';
import { initGlobalSearch } from './search.js';
import { initSettings, renderSettings } from './settings.js';
import { initFiles, renderImport, renderStls, renderStlPane } from './files.js';
import { initParts, renderParts, refreshParts, ownershipOf, ownBadge } from './parts.js';
import { initBrowse, renderBrowse } from './browse.js';

await loadSettings().catch(() => null);
await refreshPrinterVisibility();
initTooltips();

const state = {
  tab: 'shop', shopSub: 'design',
  generators: [], presets: [], categories: [], items: [], designs: [], library: [], parts: [], partCategories: [], collections: [],
  current: null, preset: null, design: null,
  lastResult: null, pendingOverrides: null, editing: null,
};

const viewer = createViewer($('viewer'), settings()?.viewer ?? {});
const viewTools = initViewTools(viewer, $('viewTools'));
const estimate = createEstimateBox($('estimate'), viewer, { onShowPart: (i) => state.shown?.[i] && viewer.show([state.shown[i]]).then(() => viewTools.reset()) });
onSettings((cfg, patch) => {
  if (patch.viewer) viewer.setOptions(cfg.viewer);
  if (patch.printers) refreshPrinterVisibility();
  if (patch.tips && state.current) loadGenerator(state.current.id, readForm(state.current), { preset: state.preset, design: state.design });
});

/** Geometry stats for a local STL (same fields as the server's meshStats). */
function geometryStats(g) {
  const p = g.attributes.position.array;
  g.computeBoundingBox();
  const bb = g.boundingBox;
  let vol6 = 0, area = 0, flat = 0, bottom = 0;
  for (let i = 0; i < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.subarray(i, i + 9);
    vol6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    area += len / 2;
    if (len > 0 && Math.abs(nz / len) > 0.7) { flat += len / 2; if (nz < 0 && Math.max(az, bz, cz) < bb.min.z + 0.01) bottom += len / 2; }
  }
  return { size: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z], volumeMm3: Math.abs(vol6 / 6), areaMm2: area, flatAreaMm2: flat, bedAreaMm2: bottom };
}

// ---------- output ----------
function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}
const list = (node, items) => node.replaceChildren(...items.map((t) => el('li', { textContent: t })));

function renderResult(result) {
  state.lastResult = result;
  // per-part sizes, time, filament and STL links are in the estimate table; this row switches views
  $('parts').replaceChildren(...(result.parts.length > 1 ? [el('li', {},
    el('span', { className: 'name', textContent: 'Show all parts', onclick: () => viewer.show(result.parts) }),
    el('span', { className: 'stats', textContent: `${result.parts.length} parts. Click a part name in the table to show it alone.` }))] : []));
  list($('warnings'), result.warnings);
  list($('notes'), result.notes);
  $('zipAll').hidden = !result.zip;
  if (result.zip) $('zipAll').href = result.zip;
  $('dlStl').hidden = result.parts.length !== 1;
  if (result.parts.length === 1) { $('dlStl').href = result.parts[0].url; $('dlStl').download = result.parts[0].filename; }
  estimate.update(result.parts);
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
    state.shown = result.parts;
    await viewer.show(result.parts, { layout: store.get('layout') ?? 'assembled' });
    viewTools.reset();
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

function buildForm(gen, values, verify = [], measure = []) {
  const form = $('params');
  form.replaceChildren();
  const groups = new Map();
  const collapse = settings()?.ui.collapseGroups;
  const openGroups = store.get(`groups:${gen.id}`) ?? null;
  for (const [key, def] of Object.entries(gen.params)) {
    const g = def.group ?? 'Parameters';
    if (!groups.has(g)) {
      const isOpen = openGroups ? openGroups.includes(g) : !collapse || groups.size === 0;
      const fs = el('details', { className: 'pgroup-box', open: isOpen }, el('summary', { textContent: g }));
      fs.dataset.group = g;
      fs.ontoggle = () => {
        if (collapse && fs.open) for (const o of form.querySelectorAll('details.pgroup-box')) if (o !== fs) o.open = false;
        store.set(`groups:${gen.id}`, [...form.querySelectorAll('details.pgroup-box')].filter((d) => d.open).map((d) => d.dataset.group));
      };
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
      input.value = measure.includes(key) ? '' : value;
      if (measure.includes(key)) { input.placeholder = 'measure'; input.required = true; }
      label.htmlFor = fieldId(key);
      wrap.append(label, input);
    }
    input.id = fieldId(key);
    input.name = key;
    const tips = settings()?.tips ?? {};
    const range = def.type === 'number' || def.type === 'integer'
      ? `${def.min ?? ''} to ${def.max ?? ''}${def.unit ? ` ${def.unit}` : ''}, default ${def.default}`
      : def.type === 'select' ? `${def.options.length} choices, default ${def.options.find((o) => (o.value ?? o) === def.default)?.label ?? def.default}`
        : def.type === 'boolean' ? `default ${def.default ? 'on' : 'off'}` : def.default ? `default "${def.default}"` : '';
    const tip = [def.label, tips.fieldHelp !== 'off' && def.help ? def.help : '', tips.fieldDetails !== false ? `${range}. Setting name: ${key}` : ''].filter(Boolean).join('\n');
    wrap.dataset.tip = tip;
    if (def.help && (tips.fieldHelp ?? 'inline') === 'inline') wrap.append(el('div', { className: 'help', textContent: def.help }));
    if (verify.includes(key) || measure.includes(key)) {
      wrap.classList.add(measure.includes(key) ? 'measure' : 'verify');
      groups.get(g).open = true;
    }
    groups.get(g).append(wrap);
  }
  applyFormMode(gen, values, verify, measure);
  const banner = $('verifyBanner');
  const lbl = (k) => gen.params[k]?.label ?? k;
  banner.hidden = !verify.length && !measure.length;
  banner.classList.toggle('needs-measure', measure.length > 0);
  banner.textContent = [
    measure.length ? `Needs measurement: ${measure.map(lbl).join(', ')}. Nobody has measured these yet, so the fields are empty. Measure your part and type the values to generate.` : '',
    verify.length ? `Check before printing: ${verify.map(lbl).join(', ')} (datasheet or assumed values, highlighted).` : '',
  ].filter(Boolean).join(' ');
}

// Simple mode: only the main settings (generator `basic` list, else the first group),
// plus anything the loaded preset changes and every field to measure or check.
// Hidden fields keep their values, so the part is the same in both modes.
const formMode = () => store.get('formMode') ?? 'simple';
function applyFormMode(gen, values, verify = [], measure = []) {
  const mode = formMode();
  for (const b of document.querySelectorAll('.mode-toggle .subtab')) b.classList.toggle('active', b.dataset.mode === mode);
  const keys = Object.keys(gen.params);
  const firstGroup = gen.params[keys[0]]?.group ?? 'Parameters';
  const changed = state.preset?.generator === gen.id ? Object.keys(state.preset.params ?? {}) : [];
  const basic = new Set([...(gen.basic?.length ? gen.basic : keys.filter((k) => (gen.params[k].group ?? 'Parameters') === firstGroup)), ...changed, ...verify, ...measure]);
  let hidden = 0;
  for (const key of keys) {
    const wrap = $(fieldId(key))?.closest('.field');
    if (!wrap) continue;
    const hide = mode === 'simple' && !basic.has(key);
    wrap.hidden = hide;
    if (hide) hidden++;
  }
  for (const box of document.querySelectorAll('#params details.pgroup-box')) {
    const any = [...box.querySelectorAll('.field')].some((f) => !f.hidden);
    box.hidden = !any;
    if (mode === 'simple' && any) box.open = true;
  }
  $('params').querySelector('.more-settings')?.remove();
  if (hidden) {
    $('params').append(el('button', { type: 'button', className: 'secondary small more-settings', textContent: `${hidden} more setting${hidden > 1 ? 's' : ''} (walls, clearances, screws...): show all`, onclick: () => setFormMode('all') }));
  }
}

function setFormMode(mode) {
  store.set('formMode', mode);
  if (state.current) applyFormMode(state.current, null, state.preset?.verify ?? [], state.preset?.measure ?? []);
}

/** Empty "measure" fields in the form (presets with sizes nobody has measured yet). */
function missingMeasurements() {
  return [...document.querySelectorAll('#params .field.measure input')].filter((i) => i.value.trim() === '');
}

// Live preview: rebuild after a pause in typing (Settings > Appearance).
let liveTimer = null;
function liveRun() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { if (settings()?.ui.autoGenerate && !$('pane-design').hidden) run({ silent: true }); }, settings()?.ui.autoGenerateDelay ?? 700);
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
  const fromPreset = state.preset?.generator === state.current.id && !state.design;
  buildForm(state.current, values ?? defaultsOf(state.current), fromPreset ? state.preset.verify ?? [] : [], fromPreset ? state.preset.measure ?? [] : []);
  highlightPreset();
  const fav = state.design ? ['design', state.design.id] : state.preset ? ['preset', state.preset.id] : ['generator', state.current.id];
  $('designStar').replaceChildren(starButton(...fav));
}

/** What "Add to project" stores: the preset or saved design if unchanged, else a snapshot of the settings. */
function currentSelection() {
  const gen = state.current;
  const now = readForm(gen);
  const norm = (d, v) => (d.type === 'boolean' ? String(Boolean(v)) : String(v));
  const same = (base) => Object.entries(gen.params).every(([k, d]) => norm(d, now[k]) === norm(d, base[k]));
  if (state.design && same({ ...defaultsOf(gen), ...state.design.params })) return { kind: 'design', ref: state.design.id, name: state.design.name };
  if (state.preset && state.preset.generator === gen.id && same({ ...defaultsOf(gen), ...state.preset.params })) return { kind: 'preset', ref: state.preset.id, name: state.preset.name };
  return { kind: 'custom', generator: gen.id, params: now, name: `${state.design?.name ?? state.preset?.name ?? gen.name} (custom)` };
}

function loadPreset(preset, generateNow = true) {
  const gen = state.generators.find((g) => g.id === preset.generator);
  loadGenerator(gen.id, { ...defaultsOf(gen), ...preset.params }, { preset });
  store.set(`preset:${state.tab}`, preset.id);
  if (preset.measure?.length) {
    // nothing to show until the sizes are typed: clear the last part and its downloads
    viewer.show([]);
    for (const id of ['parts', 'warnings', 'notes']) $(id).replaceChildren();
    $('zipAll').hidden = true;
    $('dlStl').hidden = true;
    estimate.update([]);
    setStatus(`${preset.name}: type the measured sizes, then press Generate.`);
    missingMeasurements()[0]?.focus();
    return;
  }
  if (generateNow) run();
}

function run({ silent = false } = {}) {
  const missing = missingMeasurements();
  if (missing.length) {
    if (!silent) {
      setStatus(`Needs measurement: ${missing.map((i) => state.current.params[i.name]?.label ?? i.name).join(', ')}. Type the sizes first.`, true);
      missing[0].focus();
    }
    return null;
  }
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

const MAX_LIST = 300; // the list is a scroll box; search narrows thousands of presets
function ownFilter(p, f) {
  if (!f) return true;
  if (f === 'measure') return Boolean(p.measure?.length);
  if (f === 'sized') return !p.measure?.length;
  const own = ownershipOf(p);
  return f === 'mine' ? Boolean(own) : own === f;
}

function renderPresets() {
  const words = $('presetSearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const group = $('presetGroup').value;
  const own = $('presetOwn').value;
  store.set('presetOwn', own);
  const items = presetsForTab().filter((p) => (!group || p.group === group) && ownFilter(p, own)
    && words.every((w) => [p.id, p.name, p.description, p.group, p.generator, p.component ?? '', ...p.tags].join(' ').toLowerCase().includes(w)));
  $('presetList').replaceChildren(...items.slice(0, MAX_LIST).map((p) => el('li', { dataset: { id: p.id }, title: p.description, onclick: () => loadPreset(p) },
    el('span', { className: 'pname' }, p.name, p.measure?.length ? el('span', { className: 'flag flag-measure', textContent: 'measure' }) : null),
    el('span', { className: 'pgroup' }, ownBadge(ownershipOf(p)), p.group))));
  if (items.length > MAX_LIST) $('presetList').append(el('li', { className: 'muted', textContent: `Showing ${MAX_LIST} of ${items.length}. Type to narrow (e.g. "clamp 16", "m1 20").` }));
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
  $('pane-stl').hidden = name !== 'stl';
}

// ---------- routing: #home #shop ... #projects #project/<id> #printers #library ----------
const PAGES = ['home', 'projects', 'printers', 'settings', 'import', 'stls', 'parts', 'browse'];

function markTab(tab) {
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === tab);
}

async function showPage(name, arg) {
  stopPrinters();
  stopProjectView();
  markTab(name === 'project' ? 'projects' : name);
  window.scrollTo(0, 0);
  document.querySelector('main').classList.add('full');
  const page = $('page');
  page.hidden = false;
  page.replaceChildren(el('p', { className: 'muted', textContent: 'Loading...' }));
  try {
    if (name === 'home') await renderHome(page);
    else if (name === 'projects') await renderProjects(page);
    else if (name === 'project') await renderProject(page, arg);
    else if (name === 'printers') await renderPrinters(page);
    else if (name === 'settings') await renderSettings(page, arg);
    else if (name === 'import') renderImport(page);
    else if (name === 'stls') { await refreshLibrary(); renderStls(page); }
    else if (name === 'parts') await renderParts(page, arg);
    else if (name === 'browse') { await Promise.all([refreshCollections(), refreshLibrary()]); renderBrowse(page, arg ?? ''); }
  } catch (err) {
    page.replaceChildren(el('p', { className: 'error', textContent: err.message }));
  }
}

/** Show a tab and put it in the address bar (so Back works and links can be shared). */
function go(hash, opts) {
  if (location.hash !== `#${hash}`) history.pushState(null, '', `#${hash}`);
  route(hash, opts);
}

function route(hash = location.hash.slice(1), opts = {}) {
  const [name, arg] = hash.split('/');
  store.set('tab', name || 'home');
  if (!name || name === 'home') return showPage('home');
  if (PAGES.includes(name)) return showPage(name, arg ? decodeURIComponent(arg) : undefined);
  if (name === 'project' && arg) return showPage('project', decodeURIComponent(arg));
  if (name === 'stl' && arg) return showStl(decodeURIComponent(arg));
  if ([...SECTIONS, 'library'].includes(name)) return showTab(name, opts);
  return showPage('home');
}

/** One library STL: info pane on the left, the STL in the 3D view, estimate below. */
async function showStl(id) {
  stopPrinters();
  document.querySelector('main').classList.remove('full');
  $('page').hidden = true;
  markTab('stls');
  showPane('stl');
  try {
    const e = await api('GET', `/api/library/${id}`);
    renderStlPane($('pane-stl'), e, {
      onChange: (next) => { const i = state.library.findIndex((x) => x.id === next.id); if (i >= 0) state.library[i] = { ...state.library[i], ...next }; },
      onDelete: async () => { await refreshLibrary(); go('stls'); toast('Deleted', 'ok'); },
    });
    setStatus(`Loading ${e.name}...`);
    await viewer.show([{ url: `/api/library/${e.id}.stl` }]);
    $('parts').replaceChildren(el('li', {}, el('span', { className: 'name', textContent: e.name }), el('span', { className: 'stats', textContent: `${e.stats.size.join(' x ')} mm, ${(e.stats.volumeMm3 / 1000).toFixed(1)} cm3` }), el('a', { href: `/api/library/${e.id}.stl`, download: e.filename, textContent: 'STL' })));
    list($('warnings'), []);
    list($('notes'), e.notes ? [e.notes] : []);
    $('zipAll').hidden = true;
    $('dlStl').hidden = false;
    $('dlStl').href = `/api/library/${e.id}.stl`;
    $('dlStl').download = e.filename;
    estimate.update([{ name: e.name, stats: e.stats, url: `/api/library/${e.id}.stl`, filename: e.filename }]);
    viewTools.reset();
    setStatus(e.name);
  } catch (err) {
    $('pane-stl').replaceChildren(el('p', { className: 'error', textContent: err.message }), el('a', { href: '#stls', textContent: 'Back to STL Files' }));
  }
}

async function refreshCollections() {
  state.collections = await api('GET', '/api/collections');
  return state.collections;
}

async function refreshLibrary() {
  state.library = await api('GET', '/api/library');
  return state.library;
}

function showTab(tab, { keepForm = false } = {}) {
  stopPrinters();
  stopProjectView();
  document.querySelector('main').classList.remove('full');
  $('page').hidden = true;
  state.tab = tab;
  markTab(tab);
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
    else { loadGenerator(generatorsForTab()[0].id); run({ silent: true }); }
  }
}

function switchShopSub(sub) {
  state.shopSub = sub;
  for (const b of document.querySelectorAll('.subtab[data-sub]')) b.classList.toggle('active', b.dataset.sub === sub);
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
    list($('notes'), ['Viewing local STL files. They are not uploaded. Use Import to keep them in STL Files.']);
    $('zipAll').hidden = true;
    $('dlStl').hidden = true;
    state.shown = parts;
    estimate.update(parts.map((p) => ({ name: p.name, stats: geometryStats(p.geometry) })));
    viewTools.reset();
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
  go(tab, { keepForm: true });
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
    toast(`Saved "${saved.name}" to My Designs`, 'ok');
  } catch (err) { setStatus(err.message, true); }
}

async function renameDesign(d) {
  const name = prompt('New name:', d.name);
  if (!name || name === d.name) return;
  try { await api('PUT', `/api/designs/${d.id}`, { name }); await refreshDesigns(); } catch (err) { toast(err.message, 'error'); }
}

async function deleteDesign(d) {
  if (!confirmDelete(`Delete saved design "${d.name}"? This cannot be undone.`)) return;
  try { await api('DELETE', `/api/designs/${d.id}`); await refreshDesigns(); } catch (err) { toast(err.message, 'error'); }
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
  if (!confirmDelete(`Delete ${item.code} ${item.name}? This cannot be undone.`)) return;
  try { await api('DELETE', `/api/catalog/${item.code}`); await refreshShop(); } catch (err) { toast(err.message, 'error'); }
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
  } catch (err) { toast(err.message, 'error'); }
}

function sendToShop() {
  if (!state.preset) {
    alert('Shop items are built from presets. Load the closest preset, change values, then press Add to shop.');
    return;
  }
  const preset = state.preset;
  const overrides = overridesFromForm();
  const labelGuess = $(fieldId('labelText'))?.value || $(fieldId('text'))?.value || '';
  if (state.tab !== 'shop') go('shop', { keepForm: true });
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
  try { await api('PUT', '/api/categories', rows); $('catForm').hidden = true; await refreshShop(); } catch (err) { toast(err.message, 'error'); }
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
$('generator').onchange = () => {
  // switching generator shows its default part at once (no need to touch a setting first)
  loadGenerator($('generator').value);
  store.set(`preset:${state.tab}`, '');
  run({ silent: true });
};
$('allGenerators').onchange = fillGeneratorSelect;
$('params').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } };
$('params').oninput = () => liveRun();
$('params').onchange = () => liveRun();
$('liveToggle').checked = settings()?.ui.autoGenerate ?? true;
for (const b of document.querySelectorAll('.mode-toggle .subtab')) b.onclick = () => setFormMode(b.dataset.mode);
$('liveToggle').onchange = () => saveSettings({ ui: { autoGenerate: $('liveToggle').checked } }).catch((e) => toast(e.message, 'error'));
$('expandAll').onclick = () => { for (const d of document.querySelectorAll('#params details')) d.open = true; };
$('collapseAll').onclick = () => { for (const d of document.querySelectorAll('#params details')) d.open = false; };
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !$('pane-design').hidden && !document.querySelector('main').classList.contains('full')) { e.preventDefault(); run(); }
});
for (const b of document.querySelectorAll('.more-items button')) b.addEventListener('click', () => { b.closest('details').open = false; });
$('presetSearch').oninput = renderPresets;
$('presetGroup').onchange = renderPresets;
$('presetOwn').value = store.get('presetOwn') ?? '';
$('presetOwn').onchange = renderPresets;
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
for (const b of document.querySelectorAll('.tab')) b.onclick = () => go(b.dataset.tab);
window.addEventListener('popstate', () => route());
window.addEventListener('hashchange', () => route());
$('toProject').onclick = () => addToProject(currentSelection());
for (const b of document.querySelectorAll('.subtab[data-sub]')) b.onclick = () => switchShopSub(b.dataset.sub);

let version;
[state.generators, state.presets, version] = await Promise.all([api('GET', '/api/generators'), api('GET', '/api/presets'), api('GET', '/api/version')]);
$('appVersion').textContent = `v${version.version}${version.edition?.edition && version.edition.edition !== 'public' ? ` (${version.edition.name})` : ''} / ${version.generators} generators / ${version.presets} presets`;
if (version.issues.length) {
  const badge = el('button', { type: 'button', className: 'issues small', textContent: `${version.issues.length} custom file problem${version.issues.length > 1 ? 's' : ''}`, title: 'Custom generators or presets that were skipped' });
  badge.onclick = () => { list($('warnings'), version.issues.map((i) => `Skipped: ${i}`)); };
  $('appVersion').after(badge);
}
resetItemForm();
await Promise.all([refreshDesigns().catch(() => {}), refreshLibrary().catch(() => {}), api('GET', '/api/catalog').then((i) => { state.items = i; }).catch(() => {})]);
initFiles({ state, refreshLibrary, refreshDesigns });
initBrowse({ state, refreshCollections });
await refreshCollections().catch(() => {});
initParts({ state, openPreset: (p) => { state.shopSub = 'design'; go(p.section, { keepForm: true }); loadPreset(p); } });
await refreshParts().catch(() => {});
initSettings({
  openCategories: async () => { state.shopSub = 'catalog'; go('shop', { keepForm: true }); switchShopSub('catalog'); await refreshShop(); $('editCategories').click(); },
  refreshEstimate: () => estimate.refresh(),
});
initGlobalSearch();
headerPrinterChip();
state.viewerSettings = () => settings()?.viewer ?? {};
state.cardTips = () => settings()?.tips?.cardDetails;
await initHome({
  state,
  openPreset: (p) => { state.shopSub = 'design'; go(p.section, { keepForm: true }); loadPreset(p); },
  openDesign,
  openGenerator: (id, params) => {
    const g = state.generators.find((x) => x.id === id);
    state.shopSub = 'design';
    go(g.sections[0], { keepForm: true });
    loadGenerator(id, params ? { ...defaultsOf(g), ...params } : null);
    run();
  },
  goTab: (t) => go(t),
  refreshDesigns,
  refreshLibrary,
  refreshCollections,
  openStl: (id) => go(`stl/${id}`),
  openShopItem: async (item) => { state.shopSub = 'catalog'; go('shop', { keepForm: true }); switchShopSub('catalog'); await refreshShop(); editItem(state.items.find((i) => i.code === item.code) ?? item); },
  toast: (msg) => setStatus(msg),
});
route(location.hash.slice(1) || settings()?.ui.startPage || 'home');

/** Small status chip for the default printer in the header (view only). */
function headerPrinterChip() {
  const chip = $('printerChip');
  const tick = async () => {
    const id = settings()?.printers.defaultPrinter;
    if (!id || !printersVisible()) { chip.hidden = true; return; }
    try {
      const printers = await api('GET', '/api/printers');
      const p = printers.find((x) => x.id === id);
      if (!p) { chip.hidden = true; return; }
      const st = await api('GET', `/api/printers/${id}/status`).catch(() => null);
      chip.hidden = false;
      chip.className = `chip header-chip state-${st ? st.state : 'offline'}`;
      chip.textContent = st ? `${p.name}: ${st.state === 'printing' ? `printing ${(st.progress * 100).toFixed(0)}%` : st.state === 'standby' ? 'idle' : st.state}` : `${p.name}: offline`;
    } catch { chip.hidden = true; }
  };
  tick();
  setInterval(() => { if (!document.hidden) tick(); }, 30000);
  onSettings((c, patch) => { if (patch.printers) tick(); });
}
