// Home page, advanced search, grid/list cards, favorites and projects.
//
// The search index (buildIndex) covers every kind of thing in the app:
//   preset, design (My Designs), generator, project, stl (STL Files library),
//   item (shop catalog), page (Settings sections, Import, Printers...).
// search(query, opts) is used by Home, the header's global search
// (public/search.js) and the project part picker. Query syntax: see parseQuery.
import { el, api, store, debounce, fmtAgo, chooseDialog, SECTIONS, SECTION_NAMES, viewMode, toast, confirmDelete, printersVisible } from './lib.js';
import { thumbImg, thumbStl } from './thumbs.js';
import { formatDuration } from '/shared/estimate.js';
import { ownershipOf, ownBadge } from './parts.js';
import { createViewer } from './viewer.js';
import { createEstimateBox } from './viewtools.js';
import { printerChips } from './printers.js';

let ctx = null; // set by initHome: { state, openPreset, openDesign, openGenerator, openStl, openShopItem, goTab, refreshDesigns, refreshLibrary, toast }
let favs = new Set();
let projects = [];

export const favKey = (kind, id) => `${kind}:${id}`;
export const isFav = (kind, id) => favs.has(favKey(kind, id));

export async function initHome(context) {
  ctx = context;
  await Promise.all([refreshFavorites(), refreshProjects()]);
}

export async function refreshFavorites() {
  favs = new Set((await api('GET', '/api/favorites')).map((f) => favKey(f.kind, f.id)));
}

export async function refreshProjects() {
  projects = await api('GET', '/api/projects');
  return projects;
}

export async function toggleFav(kind, id) {
  const list = await api('POST', '/api/favorites/toggle', { kind, id });
  favs = new Set(list.map((f) => favKey(f.kind, f.id)));
  for (const b of document.querySelectorAll(`[data-fav="${CSS.escape(favKey(kind, id))}"]`)) setStar(b, favs.has(favKey(kind, id)));
  return favs.has(favKey(kind, id));
}

function setStar(btn, on) {
  btn.textContent = on ? '★' : '☆';
  btn.title = on ? 'Remove from favorites' : 'Add to favorites';
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
}

export function starButton(kind, id) {
  const b = el('button', { type: 'button', className: 'star', 'aria-label': 'Favorite' });
  b.dataset.fav = favKey(kind, id);
  setStar(b, isFav(kind, id));
  b.onclick = async (e) => {
    e.stopPropagation();
    try { await toggleFav(kind, id); } catch (err) { toast(err.message, 'error'); }
  };
  return b;
}

// ---------------------------------------------------------------- search index

/** Places in the app that global search can jump to. */
export const PAGES = [
  ['settings', 'Settings', 'Theme, live preview, 3D view, labels, printers, estimates, backup', ['options', 'preferences', 'config']],
  ['browse', 'Browse', 'Everything with filters: type, tab, category, generator, tags, collections, size series', ['filter', 'categories', 'facets', 'collections']],
  ['parts', 'My Parts', 'Parts you own or plan to get: ownership, sizes to measure, matching presets', ['inventory', 'components', 'owned']],
  ['settings/printers', 'Settings: Printers', 'Connect, test and save Klipper / Moonraker printers (Sovol SV07)', ['sv07', 'sovol', 'moonraker', 'mainsail', 'connect', 'api key']],
  ['settings/print', 'Settings: Print estimates', 'Printer profile, layer height, walls, infill, material, calibration', ['time', 'filament', 'estimate', 'calibrate']],
  ['settings/viewer', 'Settings: 3D view', 'Quality, shadows, edges, wireframe, bed outline, axes', ['render', 'quality', 'graphics']],
  ['settings/labels', 'Settings: Paper labels', 'Label size, code, location, color bar, text size', ['label', 'print labels']],
  ['settings/ui', 'Settings: Appearance', 'Theme, start page, live preview, card previews', ['dark mode', 'theme']],
  ['settings/data', 'Settings: Data and backup', 'Backup, data folder, preview cache', ['backup', 'export']],
  ['import', 'Import', 'Import STL files, project files and design files', ['upload', 'open']],
  ['stls', 'STL Files', 'Your imported STL library', ['library', 'models']],
  ['printers', 'Printers', 'Printer status, files, webcam, upload G-code (view only)', ['status', 'webcam', 'gcode']],
  ['lab', 'Stress Lab', 'Stress test, weak points, supports, wind tunnel, heat, sun, rain', ['stress', 'fea', 'force', 'load', 'servo horn', 'wind tunnel', 'aero', 'wing', 'lift', 'drag', 'supports', 'overhang', 'uv', 'rain', 'heat', 'materials']],
  ['projects', 'Projects', 'Builds with parts lists and one-ZIP download', ['build']],
  ['library', 'My Designs', 'Saved designs', ['saved']],
];

const defaultsOf = (gen) => Object.fromEntries(Object.entries(gen.params).map(([k, d]) => [k, d.default]));

// The index is rebuilt only when one of its source lists is replaced (refresh
// functions assign new arrays), so typing in a search box stays fast with
// thousands of presets.
let indexCache = null;
let indexSources = [];
function buildIndex() {
  const sources = [ctx.state.generators, ctx.state.presets, ctx.state.designs, ctx.state.library, ctx.state.items, ctx.state.parts, projects, ctx.state.collections];
  if (indexCache && sources.every((x, i) => x === indexSources[i])) return indexCache;
  indexSources = sources;
  indexCache = buildIndexNow();
  return indexCache;
}

function buildIndexNow() {
  const { generators, presets, designs } = ctx.state;
  const genById = new Map(generators.map((g) => [g.id, g]));
  const items = [];
  for (const p of presets) {
    const g = genById.get(p.generator);
    items.push({
      kind: 'preset', id: p.id, title: p.name, sub: `${SECTION_NAMES[p.section]} / ${p.group}`, description: p.description,
      section: p.section, sections: [p.section], generator: p.generator, generatorName: g?.name ?? p.generator, group: p.group, tags: [...(p.tags ?? []), ...(p.component ? [p.component.toLowerCase()] : [])],
      params: { ...(g ? defaultsOf(g) : {}), ...p.params }, ref: p,
      ownership: ownershipOf(p), measure: p.measure ?? [], component: p.component ?? null, category: p.category ?? p.group, series: p.series ?? null,
    });
  }
  for (const d of designs) {
    const g = genById.get(d.generator);
    items.push({
      kind: 'design', id: d.id, title: d.name, sub: `Saved design / ${g?.name ?? d.generator}`, description: d.notes ?? '',
      section: d.section, sections: [d.section], generator: d.generator, generatorName: g?.name ?? d.generator, group: 'My Designs', tags: ['saved'],
      params: d.params, updated: d.updatedAt, ref: d,
    });
  }
  for (const g of generators) {
    items.push({
      kind: 'generator', id: g.id, title: g.name, sub: `Generator / ${g.sections.map((s) => SECTION_NAMES[s]).join(', ')}`, description: g.description,
      section: g.sections[0], sections: g.sections, generator: g.id, generatorName: g.name, group: 'Generators', tags: ['generator'],
      params: defaultsOf(g), ref: g,
    });
  }
  for (const pr of projects) {
    items.push({
      kind: 'project', id: pr.id, title: pr.name, sub: `Project / ${pr.status} / ${pr.items.length} part${pr.items.length === 1 ? '' : 's'}`, description: pr.description,
      section: null, sections: [], generator: null, group: 'Projects', tags: pr.tags, params: {}, updated: pr.updatedAt, ref: pr, status: pr.status,
    });
  }
  for (const pt of ctx.state.parts ?? []) {
    items.push({
      kind: 'part', id: pt.id, title: `${pt.id} ${pt.name}`, sub: `My part / ${pt.category} / ${pt.ownershipKey}`, description: [pt.detail, pt.printNeed && `Print: ${pt.printNeed}`].filter(Boolean).join('. '),
      section: null, sections: [], generator: null, group: pt.category, tags: [pt.ownershipKey.toLowerCase(), pt.dimsFlag], params: {}, ref: pt,
      ownership: pt.ownershipKey, measure: ['measure', 'conflict'].includes(pt.dimsFlag) ? ['size'] : [], component: pt.id, category: pt.category,
    });
  }
  for (const e of ctx.state.library ?? []) {
    items.push({
      kind: 'stl', id: e.id, title: e.name, sub: `STL file${e.folder ? ` / ${e.folder}` : ''} / ${e.stats.size.map((v) => v.toFixed(0)).join(' x ')} mm`, description: e.notes,
      section: null, sections: [], generator: null, group: e.folder || 'STL Files', tags: e.tags, params: { x: e.stats.size[0], y: e.stats.size[1], z: e.stats.size[2] }, updated: e.updatedAt, ref: e,
    });
  }
  for (const i of ctx.state.items ?? []) {
    items.push({
      kind: 'item', id: i.code, title: `${i.code} ${i.name}`, sub: `Shop item${i.location ? ` at ${i.location}` : ''}`, description: i.notes,
      section: 'shop', sections: ['shop'], generator: null, group: 'Shop catalog', tags: [i.category.toLowerCase()], params: {}, updated: i.updatedAt, ref: i,
    });
  }
  for (const [hash, title, description, tags] of PAGES) {
    items.push({ kind: 'page', id: hash, title, sub: 'Page', description, section: null, sections: [], generator: null, group: 'Pages', tags, params: {}, ref: { hash } });
  }
  const inCol = new Map();
  for (const c of ctx.state.collections ?? []) for (const i of c.items) inCol.set(`${i.kind}:${i.id}`, [...(inCol.get(`${i.kind}:${i.id}`) ?? []), c.id]);
  for (const it of items) {
    it.collections = inCol.get(`${it.kind}:${it.id}`) ?? [];
    it.text = [it.title, it.sub, it.description, it.group, it.generator, it.generatorName, it.id, ...it.tags, ...it.sections.map((s) => SECTION_NAMES[s])].join(' ').toLowerCase();
  }
  return items;
}

/**
 * Query syntax:
 *   words              all must match (name, description, tags, group, generator)
 *   "two words"        exact phrase
 *   -word              exclude
 *   tab:quads  kind:preset  gen:tube-clamp  group:hooks  tag:esc  status:active  fav:yes
 *   tubeOD:16  teeth>=20  length<30  bolt:M3     any parameter, = : > < >= <=
 */
export function parseQuery(q) {
  const out = { words: [], not: [], filters: [] };
  for (let t of q.match(/-?"[^"]*"|\S+/g) ?? []) {
    let neg = false;
    if (t.startsWith('-') && t.length > 1) { neg = true; t = t.slice(1); }
    const f = t.match(/^([a-zA-Z][\w.]*)(>=|<=|:|=|>|<)(.+)$/);
    if (f) out.filters.push({ key: f[1].toLowerCase(), op: f[2] === ':' ? '=' : f[2], value: f[3].replace(/^"|"$/g, '').toLowerCase(), neg });
    else (neg ? out.not : out.words).push(t.replace(/^"|"$/g, '').toLowerCase());
  }
  return out;
}

function compare(actual, op, value) {
  if (actual === undefined || actual === null) return false;
  const a = Number(actual);
  const v = Number(value);
  if (Number.isFinite(a) && Number.isFinite(v) && value !== '') {
    if (op === '=') return Math.abs(a - v) < 1e-9;
    if (op === '>') return a > v;
    if (op === '<') return a < v;
    if (op === '>=') return a >= v;
    if (op === '<=') return a <= v;
  }
  const s = String(actual).toLowerCase();
  return op === '=' ? s === value || s.startsWith(value) : false;
}

function filterMatch(it, f) {
  const k = f.key;
  let ok;
  if (k === 'tab' || k === 'section') ok = it.sections.some((s) => s === f.value || SECTION_NAMES[s].toLowerCase().startsWith(f.value));
  else if (k === 'kind' || k === 'type') ok = it.kind.startsWith(f.value);
  else if (k === 'gen' || k === 'generator') ok = (it.generator ?? '').includes(f.value) || it.generatorName?.toLowerCase().includes(f.value);
  else if (k === 'group') ok = it.group.toLowerCase().includes(f.value);
  else if (k === 'tag') ok = it.tags.some((t) => t.toLowerCase().startsWith(f.value));
  else if (k === 'status') ok = (it.status ?? '') === f.value;
  else if (k === 'fav' || k === 'favorite' || k === 'starred') ok = isFav(it.kind, it.id) === !['no', 'false', '0'].includes(f.value);
  else if (k === 'own' || k === 'ownership' || k === 'mine') ok = f.value === 'any' || f.value === 'yes' ? Boolean(it.ownership) : (it.ownership ?? '').toLowerCase().startsWith(f.value);
  else if (k === 'measure' || k === 'measured') ok = (it.measure?.length > 0) === !['no', 'false', '0', 'done'].includes(f.value) !== (k === 'measured');
  else if (k === 'cat' || k === 'category') ok = (it.category ?? it.group ?? '').toLowerCase().includes(f.value);
  else if (k === 'part' || k === 'component') ok = (it.component ?? '').toLowerCase() === f.value;
  else if (k === 'series') ok = (it.series ?? '').includes(f.value);
  else if (k === 'col' || k === 'collection') ok = it.collections.some((id) => (ctx.state.collections ?? []).find((c) => c.id === id)?.name.toLowerCase().includes(f.value));
  else {
    const key = Object.keys(it.params).find((p) => p.toLowerCase() === k);
    ok = key ? compare(it.params[key], f.op, f.value) : false;
  }
  return f.neg ? !ok : ok;
}

export function search(q, opts = {}) {
  const items = buildIndex();
  const pq = parseQuery(q);
  const res = [];
  for (const it of items) {
    if (opts.kinds && !opts.kinds.includes(it.kind)) continue;
    if (opts.section && !it.sections.includes(opts.section)) continue;
    if (opts.generator && it.generator !== opts.generator) continue;
    if (opts.favoritesOnly && !isFav(it.kind, it.id)) continue;
    if (opts.ownedOnly && it.ownership !== 'Owned') continue;
    if (!pq.words.every((w) => it.text.includes(w))) continue;
    if (pq.not.some((w) => it.text.includes(w))) continue;
    if (!pq.filters.every((f) => filterMatch(it, f))) continue;
    let score = 0;
    const title = it.title.toLowerCase();
    for (const w of pq.words) {
      if (title.startsWith(w)) score += 7;
      else if (title.includes(w)) score += 5;
      if (it.tags.some((t) => t.toLowerCase().includes(w))) score += 3;
      score += 1;
    }
    if (isFav(it.kind, it.id)) score += 2;
    res.push({ ...it, score });
  }
  const sort = opts.sort ?? 'relevance';
  const byTitle = (a, b) => a.title.localeCompare(b.title);
  if (sort === 'name') res.sort(byTitle);
  else if (sort === 'tab') res.sort((a, b) => (SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section)) || byTitle(a, b));
  else if (sort === 'recent') res.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? '') || byTitle(a, b));
  else res.sort((a, b) => b.score - a.score || byTitle(a, b));
  return res;
}

// ---------------------------------------------------------------- cards

export function openItem(it) {
  if (it.kind === 'preset') ctx.openPreset(it.ref);
  else if (it.kind === 'design') ctx.openDesign(it.ref);
  else if (it.kind === 'generator') ctx.openGenerator(it.ref.id);
  else if (it.kind === 'project') location.hash = `#project/${it.id}`;
  else if (it.kind === 'stl') location.hash = `#stl/${it.id}`;
  else if (it.kind === 'item') ctx.openShopItem(it.ref);
  else if (it.kind === 'page') location.hash = `#${it.ref.hash}`;
  else if (it.kind === 'part') location.hash = `#parts/${it.id}`;
}

function projectProgress(pr) {
  const total = pr.items.length;
  const done = pr.items.filter((i) => i.printed).length;
  return el('div', { className: 'progress', title: `${done} of ${total} printed` }, el('div', { className: 'bar', style: `width:${total ? (100 * done) / total : 0}%` }));
}

function itemThumb(it) {
  if (it.kind === 'stl') return thumbStl(it.ref);
  if (it.kind === 'part') return el('div', { className: 'thumb empty kind-part', textContent: it.id });
  if (it.kind === 'preset' && it.measure?.length) return el('div', { className: 'thumb empty kind-measure', textContent: 'Needs measurement' });
  if (it.kind === 'page' || it.kind === 'item') return el('div', { className: `thumb empty kind-${it.kind}`, textContent: it.kind === 'page' ? 'Go to page' : it.ref.code });
  if (it.kind === 'project') {
    const first = it.ref.items[0];
    const sel = first ? resolveItemForThumb(first) : null;
    if (sel?.stl) return thumbStl(sel.stl);
    return sel ? thumbImg(sel.generator, sel.params, it.title) : el('div', { className: 'thumb empty', textContent: 'Empty project' });
  }
  return thumbImg(it.generator, it.params, it.title);
}

function resolveItemForThumb(item) {
  if (item.kind === 'stl') {
    const e = (ctx.state.library ?? []).find((x) => x.id === item.ref);
    return e ? { stl: e } : null;
  }
  if (item.kind === 'custom') return { generator: item.generator, params: item.params };
  if (item.kind === 'preset') {
    const p = ctx.state.presets.find((x) => x.id === item.ref);
    return p ? { generator: p.generator, params: p.params } : null;
  }
  const d = ctx.state.designs.find((x) => x.id === item.ref);
  return d ? { generator: d.generator, params: d.params } : null;
}

const KIND_LABEL = { preset: 'Preset', design: 'Saved', generator: 'Generator', project: 'Project', stl: 'STL', item: 'Shop item', page: 'Page', part: 'My part' };

export function card(it, view = 'grid') {
  const actions = el('div', { className: 'card-actions' }, ['page', 'item', 'part'].includes(it.kind) ? null : starButton(it.kind, it.id));
  if (!['project', 'page', 'item', 'part'].includes(it.kind)) {
    actions.append(el('button', { type: 'button', className: 'icon', textContent: '+', title: 'Add to a project or a collection', 'aria-label': 'Add to a project or a collection', onclick: (e) => { e.stopPropagation(); addToSomething(it); } }));
  }
  const body = el('div', { className: 'card-body' },
    el('div', { className: 'card-title', textContent: it.title }),
    el('div', { className: 'card-sub', textContent: it.sub }),
    it.ownership || it.measure?.length ? el('div', { className: 'card-flags' }, ownBadge(it.ownership), it.measure?.length ? el('span', { className: 'flag flag-measure', textContent: 'Needs measurement' }) : null) : null,
    it.kind === 'project' ? projectProgress(it.ref) : null,
    view === 'list' && it.description ? el('div', { className: 'card-desc', textContent: it.description }) : null);
  const cardTip = ctx.state.cardTips?.() === false ? null : [it.title, it.sub, it.description].filter(Boolean).join('\n');
  const c = el('article', { className: `card-item kind-${it.kind} ${view}`, tabIndex: 0, title: cardTip },
    el('div', { className: 'card-thumb' }, itemThumb(it), el('span', { className: `badge kind-${it.kind}`, textContent: KIND_LABEL[it.kind] })),
    body, actions);
  c.onclick = () => openItem(it);
  c.onkeydown = (e) => { if (e.key === 'Enter') openItem(it); };
  return c;
}

export function cardList(items, view, empty = 'Nothing here yet.') {
  if (!items.length) return el('p', { className: 'muted empty-note', textContent: empty });
  return el('div', { className: view === 'list' ? 'card-list' : 'card-grid' }, ...items.map((it) => card(it, view)));
}

function viewToggle(onChange) {
  const view = viewMode();
  const mk = (v, label) => el('button', { type: 'button', className: `subtab ${view === v ? 'active' : ''}`, textContent: label, onclick: () => { store.set('view', v); onChange(); } });
  return el('div', { className: 'subtabs view-toggle', 'aria-label': 'View' }, mk('grid', 'Grid'), mk('list', 'List'));
}

// ---------------------------------------------------------------- projects

function selectionFromItem(it) {
  if (it.kind === 'stl') return { kind: 'stl', ref: it.id, name: it.title };
  if (it.kind === 'preset') return { kind: 'preset', ref: it.id, name: it.title };
  if (it.kind === 'design') return { kind: 'design', ref: it.id, name: it.title };
  return { kind: 'custom', generator: it.generator, params: it.params, name: it.title };
}

/** "+" on a card: add to a project, or put it in a collection (toggle). */
export async function addToSomething(it) {
  await refreshProjects();
  const cols = ctx.state.collections ?? [];
  const canCollect = ['preset', 'design', 'generator', 'stl', 'project'].includes(it.kind);
  const choices = [
    ...(it.kind === 'project' ? [] : projects.map((p) => ({ label: `Project: ${p.name} (${p.items.length})`, value: `p:${p.id}` }))),
    ...(canCollect ? cols.map((c) => ({ label: `${c.items.some((i) => i.kind === it.kind && i.id === it.id) ? 'Remove from' : 'Collection:'} ${c.name} (${c.items.length})`, value: `c:${c.id}` })) : []),
    ...(it.kind === 'project' ? [] : [{ label: 'New project...', value: 'p:__new__', secondary: true }]),
    ...(canCollect ? [{ label: 'New collection...', value: 'c:__new__', secondary: true }] : []),
  ];
  const pick = await chooseDialog('Add to...', choices, { message: it.title });
  if (!pick) return;
  try {
    if (pick.startsWith('c:')) {
      let id = pick.slice(2);
      if (id === '__new__') {
        const r = await chooseDialog('New collection', [{ label: 'Create and add', value: 'ok' }], { input: { placeholder: 'Collection name, e.g. Bench tools, Long-range quad, Gifts' } });
        if (!r?.text) return;
        id = (await api('POST', '/api/collections', { name: r.text })).id;
      }
      ctx.toast?.(it.kind === 'stl' ? 'Updating the collection...' : 'Saving an STL copy for the collection...');
      const c = await api('POST', `/api/collections/${id}/toggle`, { kind: it.kind, id: it.id });
      await Promise.all([ctx.refreshCollections?.(), ctx.refreshLibrary?.()]);
      const added = it.kind === 'stl' ? c.items.some((i) => i.id === it.id) : (c.added?.length ?? 0) > 0;
      ctx.toast?.(`${added ? (it.kind === 'stl' ? 'Added to' : `Saved ${c.added.length} STL cop${c.added.length > 1 ? 'ies' : 'y'} (STL Files > Collections) in`) : 'Removed from'} "${c.name}".`);
      return;
    }
    const target = pick.slice(2);
    if (target === '__new__') return addToProject(selectionFromItem(it), true);
    const p = await api('POST', `/api/projects/${target}/items`, { ...selectionFromItem(it), qty: 1 });
    await refreshProjects();
    ctx.toast?.(`Added to "${p.name}".`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** Add a part to a project. sel = { kind: preset|design|custom, ref?, generator?, params?, name } */
export async function addToProject(sel, newOnly = false) {
  await refreshProjects();
  const choices = projects.map((p) => ({ label: `${p.name} (${p.items.length})`, value: p.id }));
  choices.push({ label: 'New project...', value: '__new__', secondary: true });
  let target = newOnly ? '__new__' : await chooseDialog('Add to project', choices, { message: `Part: ${sel.name}` });
  if (!target) return;
  try {
    if (target === '__new__') {
      const r = await chooseDialog('New project', [{ label: 'Create and add', value: 'ok' }], { input: { placeholder: 'Project name, e.g. 7in long-range quad' } });
      if (!r?.text) return;
      target = (await api('POST', '/api/projects', { name: r.text })).id;
    }
    const p = await api('POST', `/api/projects/${target}/items`, { ...sel, qty: 1 });
    await refreshProjects();
    ctx.toast?.(`Added to "${p.name}".`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

export async function renderProjects(page) {
  await refreshProjects();
  const name = el('input', { type: 'text', placeholder: 'New project name', maxLength: 80 });
  const filter = el('select', {}, el('option', { value: '', textContent: 'All statuses' }), ...['idea', 'active', 'printing', 'done'].map((s) => el('option', { value: s, textContent: s })));
  const grid = el('div');
  const draw = () => {
    const view = viewMode();
    const items = search('', { kinds: ['project'], sort: 'recent' }).filter((it) => !filter.value || it.status === filter.value);
    grid.replaceChildren(cardList(items, view, 'No projects yet. Create one above, or press + on any part.'));
  };
  page.replaceChildren(
    el('div', { className: 'page-head' },
      el('h2', { textContent: 'Projects' }),
      el('p', { className: 'muted', textContent: 'A project collects the parts for one build: quantities, notes, what is printed, and one ZIP with every STL.' })),
    el('form', { className: 'row', onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return;
      try { const p = await api('POST', '/api/projects', { name: name.value }); location.hash = `#project/${p.id}`; } catch (err) { toast(err.message, 'error'); }
    } }, name, el('button', { type: 'submit', textContent: 'Create project' }), filter, viewToggle(draw)),
    grid);
  filter.onchange = draw;
  draw();
}

export async function renderProject(page, id) {
  let p;
  try {
    p = await api('GET', `/api/projects/${id}`);
  } catch (err) {
    page.replaceChildren(el('p', { className: 'error', textContent: err.message }), el('a', { href: '#projects', textContent: 'Back to projects' }));
    return;
  }
  const save = async (patch) => {
    try { p = await api('PUT', `/api/projects/${p.id}`, { ...p, ...patch }); await refreshProjects(); drawStats(); } catch (err) { toast(err.message, 'error'); }
  };
  const saveSoon = debounce(save, 500);

  const nameIn = el('input', { type: 'text', value: p.name, maxLength: 80, className: 'title-input', 'aria-label': 'Project name', oninput: () => saveSoon({ name: nameIn.value }) });
  const status = el('select', { onchange: () => save({ status: status.value }) }, ...['idea', 'active', 'printing', 'done'].map((s) => el('option', { value: s, textContent: s, selected: p.status === s })));
  const priority = el('select', { 'aria-label': 'Priority', onchange: () => save({ priority: priority.value }) }, ...[['', 'No priority'], ['high', 'High priority'], ['medium', 'Medium priority'], ['low', 'Low priority']].map(([v, l]) => el('option', { value: v, textContent: l, selected: (p.priority ?? '') === v })));
  const partName = (id) => (ctx.state.parts ?? []).find((x) => x.id === id);
  const comps = (p.components ?? []).length ? el('div', { className: 'chips' }, el('span', { className: 'muted', textContent: 'Parts: ' }), ...p.components.map((c) => {
    const pt = partName(c.id);
    return el('a', { href: `#parts/${c.id}`, className: `chip ${pt ? `own-${pt.ownershipKey.toLowerCase()}` : ''}`, textContent: `${c.id}${pt ? ` ${pt.name}` : ''}${c.qty > 1 ? ` x${c.qty}` : ''}`, title: pt ? `${pt.ownershipKey}: ${pt.detail}` : 'Load My Parts to see this part' });
  })) : null;
  const missing = (p.filesMissing ?? []).length ? el('div', { className: 'files-missing' }, el('strong', { textContent: 'Files to attach (not in STL Tools yet): ' }), el('ul', {}, ...p.filesMissing.map((f) => el('li', { textContent: f }))),
    el('span', { className: 'muted' }, 'Import the STL files on ', el('a', { href: '#import', textContent: 'Import' }), ', then add them to this project.')) : null;
  const tags = el('input', { type: 'text', value: p.tags.join(', '), placeholder: 'tags, comma separated', oninput: () => saveSoon({ tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean) }) });
  const desc = el('textarea', { rows: Math.min(18, Math.max(2, (p.description.match(/\n/g) ?? []).length + 1)), value: p.description, placeholder: 'Notes: frame size, motors, what this build is for...', oninput: () => saveSoon({ description: desc.value }) });
  const stats = el('div', { className: 'muted' });
  const drawStats = () => {
    const qty = p.items.reduce((n, i) => n + i.qty, 0);
    const done = p.items.filter((i) => i.printed).length;
    stats.replaceChildren(document.createTextNode(`${p.items.length} parts, ${qty} pieces to print, ${done} of ${p.items.length} printed. Updated ${fmtAgo(p.updatedAt)}.`), projectProgress(p));
  };
  drawStats();

  const zipBtn = (label, unprinted) => el('button', { type: 'button', className: unprinted ? 'secondary' : '', textContent: label, onclick: async (e) => {
    const b = e.target;
    b.disabled = true;
    const old = b.textContent;
    b.textContent = 'Building...';
    try {
      const r = await api('POST', `/api/projects/${p.id}/build${unprinted ? '?unprinted=1' : ''}`);
      if (r.errors.length) alert(`Some parts could not be built:\n${r.errors.join('\n')}`);
      showEstimate(r.estimate);
      if (r.files) el('a', { href: r.zip, download: `${p.name}.zip` }).click();
      else toast('Nothing to build.');
    } catch (err) { toast(err.message, 'error'); } finally { b.disabled = false; b.textContent = old; }
  } });

  const items = el('div', { className: 'card-grid' });
  const drawItems = () => {
    items.replaceChildren(...p.items.map((it, idx) => {
      const sel = resolveItemForThumb(it);
      const qty = el('input', { type: 'number', min: 1, max: 999, value: it.qty, className: 'qty', 'aria-label': 'Quantity', onclick: (e) => e.stopPropagation(), oninput: () => { it.qty = Math.max(1, Number(qty.value) || 1); saveSoon({ items: p.items }); } });
      const printed = el('input', { type: 'checkbox', checked: it.printed, 'aria-label': 'Printed', onchange: () => { it.printed = printed.checked; save({ items: p.items }); } });
      const note = el('input', { type: 'text', value: it.note, placeholder: 'note (material, color...)', maxLength: 300, oninput: () => { it.note = note.value; saveSoon({ items: p.items }); } });
      const move = (d) => { const j = idx + d; if (j < 0 || j >= p.items.length) return; [p.items[idx], p.items[j]] = [p.items[j], p.items[idx]]; save({ items: p.items }).then(drawItems); };
      return el('article', { className: `card-item project-part ${it.printed ? 'printed' : ''}` },
        el('div', { className: 'card-thumb' }, sel?.stl ? thumbStl(sel.stl) : sel ? thumbImg(sel.generator, sel.params, it.name) : el('div', { className: 'thumb empty', textContent: 'Missing' }), el('span', { className: 'badge', textContent: it.kind === 'custom' ? 'Custom' : KIND_LABEL[it.kind] })),
        el('div', { className: 'card-body' },
          el('div', { className: 'card-title', textContent: it.name }),
          el('div', { className: 'part-row' }, el('label', {}, 'Qty ', qty), el('label', {}, printed, ' printed')),
          note),
        el('div', { className: 'card-actions vertical' },
          el('button', { type: 'button', className: 'icon', textContent: 'Open', onclick: () => openProjectItem(it) }),
          el('button', { type: 'button', className: 'icon', textContent: '↑', title: 'Move up', onclick: () => move(-1) }),
          el('button', { type: 'button', className: 'icon', textContent: '↓', title: 'Move down', onclick: () => move(1) }),
          el('button', { type: 'button', className: 'icon', textContent: 'x', title: 'Remove from project', onclick: () => { p.items.splice(idx, 1); save({ items: p.items }).then(drawItems); } })));
    }));
    if (!p.items.length) items.replaceChildren(el('p', { className: 'muted empty-note', textContent: 'No parts yet. Search below, or press + on any card or "Add to project" in a designer tab.' }));
  };
  drawItems();

  // inline picker
  const pickQ = el('input', { type: 'search', placeholder: 'Find parts to add: e.g. esc 16, clamp tubeOD:16, gear teeth>30' });
  const pickRes = el('div', { className: 'picker-results' });
  pickQ.oninput = debounce(() => {
    const q = pickQ.value.trim();
    if (!q) { pickRes.replaceChildren(); return; }
    const res = search(q, { kinds: ['preset', 'design', 'generator', 'stl'] }).slice(0, 12);
    pickRes.replaceChildren(...res.map((r) => el('div', { className: 'pick-row' },
      el('span', {}, el('strong', { textContent: r.title }), el('span', { className: 'muted', textContent: `  ${r.sub}` })),
      el('button', { type: 'button', className: 'small', textContent: 'Add', onclick: async () => {
        try { p = await api('POST', `/api/projects/${p.id}/items`, { ...selectionFromItem(r), qty: 1 }); drawItems(); drawStats(); await refreshProjects(); } catch (err) { toast(err.message, 'error'); }
      } }))));
    if (!res.length) pickRes.replaceChildren(el('p', { className: 'muted', textContent: 'No matches.' }));
  }, 150);

  const estLine = el('p', { className: 'est-line' });
  const showEstimate = (e) => {
    estLine.textContent = e ? `Estimate on ${e.profile}: about ${formatDuration(e.seconds)} printing, ${e.grams.toFixed(0)} g filament (${(e.filamentMm / 1000).toFixed(1)} m)${e.cost !== null ? `, cost ${e.cost.toFixed(2)}` : ''}. ${e.settings}. Your slicer gives the real time.` : '';
  };
  const estBtn = el('button', { type: 'button', className: 'secondary', textContent: 'Estimate print time', onclick: async (e) => {
    e.target.disabled = true;
    estLine.textContent = 'Building every part to estimate...';
    try { showEstimate((await api('POST', `/api/projects/${p.id}/build?unprinted=1`)).estimate); } catch (err) { estLine.textContent = err.message; } finally { e.target.disabled = false; }
  } });
  const exportBtn = el('a', { className: 'button secondary', href: `/api/projects/${p.id}/export`, download: '', textContent: 'Export project file', title: 'One file with the parts list, saved designs and imported STLs. Import it on another computer.' });
  // ---- parts table with print time / filament per part, and the 3D assembly view
  const asm = el('div');
  const asmBtn = el('button', { type: 'button', textContent: 'Show parts, print times and 3D assembly', onclick: () => drawAssembly() });
  async function drawAssembly() {
    asmBtn.disabled = true;
    asm.replaceChildren(el('p', { className: 'muted', textContent: 'Building every part...' }));
    let r;
    try { r = await api('POST', `/api/projects/${p.id}/build`); } catch (err) { asm.replaceChildren(el('p', { className: 'error', textContent: err.message })); asmBtn.disabled = false; return; }
    asmBtn.disabled = false;
    showEstimate(r.estimate);
    if (!r.parts.length) { asm.replaceChildren(el('p', { className: 'muted', textContent: 'No parts to build.' })); return; }
    stopProjectView();
    const view = el('div', { className: 'asm-view' });
    const tableBox = el('div', { className: 'estimate' });
    const placeBox = el('div');
    const layoutSel = el('select', {}, el('option', { value: 'assembled', textContent: 'Assembled (placed)' }), el('option', { value: 'plate', textContent: 'Print plate (side by side)' }));
    asm.replaceChildren(el('div', { className: 'asm-box' }, view, el('div', { className: 'asm-side' }, el('label', {}, '3D layout ', layoutSel), placeBox)), tableBox,
      el('p', { className: 'muted', textContent: 'Assembly generators (gimbals) bring their own part positions. Move whole items with X / Y / Z (mm) and turn them (degrees); positions are saved with the project. The ZIP has every STL in print orientation.' }));
    asmViewer = createViewer(view, settingsViewer());
    const est = createEstimateBox(tableBox, asmViewer, { onShowPart: (i) => asmViewer.show([partsWithPlace()[i]], { layout: 'plate' }) });
    est.update(r.parts.map((pt) => ({ name: pt.name, stats: pt.stats, url: pt.url, filename: pt.filename, qty: pt.qty })));
    // default places: items without one go side by side along X
    // one place per item (kept here: `p` is replaced after every save)
    let cursor = 0;
    const span = (idx) => Math.max(20, ...r.parts.filter((pt) => pt.item === idx).map((pt) => Math.max(...pt.stats.size)));
    const places = p.items.map((it, idx) => {
      if (it.place) return { ...it.place };
      const w = span(idx);
      const pl = { x: cursor + w / 2, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
      cursor += w + 15;
      return pl;
    });
    const partsWithPlace = () => r.parts.map((pt) => ({ ...pt, assembled: mul(placeMatrix(places[pt.item]), pt.assembled ?? IDENTITY) }));
    const redraw = () => asmViewer.show(partsWithPlace(), { layout: layoutSel.value });
    const saveSoonPlaces = debounce(() => save({ items: p.items.map((x, i) => ({ ...x, place: places[i] })) }), 600);
    const fields = ['x', 'y', 'z', 'rx', 'ry', 'rz'];
    placeBox.replaceChildren(el('table', { className: 'place-table' },
      el('thead', {}, el('tr', {}, el('th', { textContent: 'Item' }), ...fields.map((f) => el('th', { textContent: f.toUpperCase() })))),
      el('tbody', {}, ...p.items.map((it, idx) => el('tr', {}, el('td', { textContent: it.name }), ...fields.map((f) => el('td', {}, el('input', { type: 'number', step: f.startsWith('r') ? 15 : 1, value: Math.round(places[idx][f] * 100) / 100, 'aria-label': `${it.name} ${f}`,
        oninput: (e) => { places[idx][f] = Number(e.target.value) || 0; redraw(); saveSoonPlaces(); } }))))))));
    layoutSel.onchange = redraw;
    redraw();
  }

  page.replaceChildren(
    el('div', { className: 'page-head' },
      el('a', { href: '#projects', className: 'back', textContent: '< Projects' }),
      el('div', { className: 'row' }, nameIn, starButton('project', p.id), status, priority),
      tags, comps, missing, desc, stats,
      el('div', { className: 'row' }, zipBtn('Download all parts (ZIP)', false), zipBtn('Only unprinted (ZIP)', true), estBtn, exportBtn,
        el('button', { type: 'button', className: 'secondary', textContent: 'Delete project', onclick: async () => {
          if (!confirmDelete(`Delete project "${p.name}"? Parts and saved designs are not deleted.`)) return;
          try { await api('DELETE', `/api/projects/${p.id}`); await refreshProjects(); location.hash = '#projects'; } catch (err) { toast(err.message, 'error'); }
        } })), estLine),
    el('h3', { textContent: 'Parts' }), items,
    el('h3', { textContent: 'Print times and assembly' }), el('div', { className: 'row' }, asmBtn), asm,
    el('h3', { textContent: 'Add parts' }), pickQ, pickRes);
}

function openProjectItem(it) {
  if (it.kind === 'stl') {
    location.hash = `#stl/${it.ref}`;
  } else if (it.kind === 'preset') {
    const p = ctx.state.presets.find((x) => x.id === it.ref);
    if (p) ctx.openPreset(p);
  } else if (it.kind === 'design') {
    const d = ctx.state.designs.find((x) => x.id === it.ref);
    if (d) ctx.openDesign(d);
    else alert('That saved design was deleted.');
  } else {
    ctx.openGenerator(it.generator, it.params);
  }
}

// ---------------------------------------------------------------- home + search

const SEARCH_HELP = 'Words must all match. "exact phrase", -exclude. Filters: tab:quads kind:preset gen:tube-clamp group:hooks tag:esc fav:yes status:active own:owned own:planned measure:yes cat:sensors part:SEN02 series:gears. Any setting: tubeOD:16 teeth>=30 length<20 bolt:M3';

export async function renderHome(page) {
  await Promise.all([refreshFavorites(), refreshProjects(), ctx.refreshDesigns().catch(() => null), ctx.refreshLibrary?.().catch(() => null)]);
  const saved = store.get('homeSearch') ?? {};
  const q = el('input', { type: 'search', className: 'big-search', placeholder: `Search ${ctx.state.presets.length} presets, ${ctx.state.generators.length} generators, your designs and projects`, value: saved.q ?? '', 'aria-label': 'Search' });
  const KINDS = ['preset', 'design', 'generator', 'project', 'stl', 'item', 'page', 'part'];
  const kinds = KINDS.map((k) => el('input', { type: 'checkbox', value: k, checked: !(saved.kinds && !saved.kinds.includes(k)) }));
  const tab = el('select', {}, el('option', { value: '', textContent: 'All tabs' }), ...SECTIONS.map((s) => el('option', { value: s, textContent: SECTION_NAMES[s], selected: saved.section === s })));
  const gen = el('select', {}, el('option', { value: '', textContent: 'All generators' }), ...ctx.state.generators.map((g) => el('option', { value: g.id, textContent: g.name, selected: saved.generator === g.id })));
  const favOnly = el('input', { type: 'checkbox', checked: Boolean(saved.favoritesOnly) });
  const ownedOnly = el('input', { type: 'checkbox', checked: Boolean(saved.ownedOnly) });
  const sort = el('select', {}, ...[['relevance', 'Best match'], ['name', 'Name'], ['tab', 'Tab'], ['recent', 'Recently changed']].map(([v, l]) => el('option', { value: v, textContent: l, selected: saved.sort === v })));
  const adv = el('details', { className: 'advanced', open: Boolean(saved.open) },
    el('summary', { textContent: 'Advanced search' }),
    el('div', { className: 'adv-grid' },
      el('div', { className: 'adv-kinds' }, ...kinds.map((k) => el('label', { className: 'check-inline' }, k, ` ${({ preset: 'Presets', design: 'Saved designs', generator: 'Generators', project: 'Projects', stl: 'STL files', item: 'Shop items', page: 'Pages', part: 'My parts' })[k.value]}`))),
      el('label', {}, 'Tab ', tab), el('label', {}, 'Generator ', gen), el('label', { className: 'check-inline' }, favOnly, ' Favorites only'), el('label', { className: 'check-inline', title: 'Presets for parts marked Owned in My Parts' }, ownedOnly, ' My parts only (owned)'), el('label', {}, 'Sort ', sort)),
    el('p', { className: 'muted', textContent: SEARCH_HELP }));
  const results = el('div', { className: 'home-results' });
  const dash = el('div', { className: 'home-dash' });

  const state = () => ({ q: q.value, kinds: kinds.filter((k) => k.checked).map((k) => k.value), section: tab.value, generator: gen.value, favoritesOnly: favOnly.checked, ownedOnly: ownedOnly.checked, sort: sort.value, open: adv.open });
  const active = (s) => s.q.trim() || s.section || s.generator || s.favoritesOnly || s.ownedOnly || s.kinds.length < KINDS.length;
  const draw = () => {
    const s = state();
    store.set('homeSearch', s);
    const view = viewMode();
    if (active(s)) {
      const res = search(s.q, { kinds: s.kinds, section: s.section || null, generator: s.generator || null, favoritesOnly: s.favoritesOnly, ownedOnly: s.ownedOnly, sort: s.sort });
      dash.hidden = true;
      results.hidden = false;
      results.replaceChildren(
        el('div', { className: 'row results-head' }, el('strong', { textContent: `${res.length} result${res.length === 1 ? '' : 's'}` }), viewToggle(draw),
          el('button', { type: 'button', className: 'secondary small', textContent: 'Clear', onclick: () => { q.value = ''; tab.value = ''; gen.value = ''; favOnly.checked = false; ownedOnly.checked = false; kinds.forEach((k) => { k.checked = true; }); draw(); } })),
        cardList(res.slice(0, 300), view, 'No matches. Try fewer words, or check the filters.'));
    } else {
      results.hidden = true;
      dash.hidden = false;
      drawDashboard(dash, draw);
    }
  };
  q.oninput = debounce(draw, 150);
  for (const c of [...kinds, tab, gen, favOnly, ownedOnly, sort]) c.onchange = draw;
  adv.ontoggle = () => store.set('homeSearch', state());
  page.replaceChildren(el('div', { className: 'home-search' }, q, adv), results, dash);
  draw();
}

function drawDashboard(dash, redraw) {
  const { presets, generators, designs } = ctx.state;
  const view = viewMode();
  const tiles = SECTIONS.map((s) => el('button', { type: 'button', className: `tile tile-${s}`, onclick: () => ctx.goTab(s) },
    el('strong', { textContent: SECTION_NAMES[s] }),
    el('span', { textContent: `${presets.filter((p) => p.section === s).length} presets / ${generators.filter((g) => g.sections.includes(s)).length} generators` })));
  const favItems = search('', { favoritesOnly: true, sort: 'tab' });
  const projItems = search('', { kinds: ['project'], sort: 'recent' }).slice(0, 6);
  const designItems = search('', { kinds: ['design'], sort: 'recent' }).slice(0, 8);
  const chips = el('div');
  printerChips().then((c) => { if (c) chips.replaceChildren(c); }).catch(() => {});
  const lib = ctx.state.library ?? [];
  const tile = (hash, title, text, cls) => el('button', { type: 'button', className: `tile ${cls}`, onclick: () => { location.hash = `#${hash}`; } }, el('strong', { textContent: title }), el('span', { textContent: text }));
  const fresh = !designs.length && !projects.length && !lib.length;
  const start = fresh ? el('section', { className: 'card getting-started' },
    el('h3', { textContent: 'Getting started' }),
    el('ol', {},
      el('li', {}, 'Pick a tab (Shop, Quadcopters, Robotics...) and click a preset. The part shows in 3D with a print time for your printer.'),
      el('li', {}, 'Change any value. With Live preview on, the part rebuilds as you type. Press Download STL.'),
      el('li', {}, 'Press Save design to keep your settings, or Add to project to collect the parts for a build.'),
      el('li', {}, 'Connect your Sovol SV07 in Settings > Printers to see its status and upload G-code (view only).'),
      el('li', {}, 'Import STL files you already have in Import. Press / anywhere to search everything.'))) : null;
  const QUICK = [
    ['stack-bin', 'Bin', 'stacking parts bin'], ['parts-box', 'Box with lid', 'compartments'], ['tube-clamp', 'Tube clamp', 'any tube size'],
    ['component-mount', 'Mount for a part', 'ESC, RX, battery, board'], ['sbc-case', 'Pi case', 'Pi 5 / 4 / 3'], ['sensor-bracket', 'Sensor bracket', 'TF-Luna, XIAO, modules'],
    ['spacer', 'Spacer / washer', 'any bolt'], ['gear', 'Gear', 'spur, helical, rack'], ['enclosure', 'Enclosure', 'box + lid'],
    ['servo-gimbal', 'Pan-tilt gimbal', 'assembly, 3 parts'], ['brushless-gimbal', 'Brushless gimbal', 'assembly, 3 parts'], ['fit-test', 'Fit test', 'inserts, holes'],
  ].filter(([id]) => generators.some((g) => g.id === id));
  const quick = el('section', {}, el('div', { className: 'row section-head' }, el('h3', { textContent: 'Make something' }),
    el('span', { className: 'muted', textContent: 'Opens in Simple mode: a few sizes, then Download. Switch to "All settings" for full control, or combine parts in a project for big builds.' })),
  el('div', { className: 'quick-make' }, ...QUICK.map(([id, title, sub]) => el('button', { type: 'button', onclick: () => { store.set('formMode', 'simple'); ctx.openGenerator(id); } }, title, el('span', { textContent: sub })))));
  dash.replaceChildren(...[
    chips,
    start,
    quick,
    el('section', {}, el('div', { className: 'tiles' }, ...tiles,
      tile('stls', 'STL Files', `${lib.length} imported STL file${lib.length === 1 ? '' : 's'}`, 'tile-stls'),
      tile('import', 'Import', 'STL files, project files, design files', 'tile-import'),
      printersVisible() ? tile('printers', 'Printers', 'Status, live webcam, files, upload (view only)', 'tile-printers') : null,
      tile('browse', 'Browse', `${ctx.state.presets.length.toLocaleString()} presets by category, tag and collection`, 'tile-browse'),
      tile('parts', 'My Parts', `${(ctx.state.parts ?? []).length} parts, ${(ctx.state.parts ?? []).filter((x) => x.ownershipKey === 'Owned').length} owned`, 'tile-parts'),
      tile('settings', 'Settings', 'Printers, 3D view, labels, estimates', 'tile-settings'))),
    el('section', {}, el('div', { className: 'row section-head' }, el('h3', { textContent: `Favorites (${favItems.length})` }), viewToggle(redraw)),
      cardList(favItems, view, 'Star presets, designs, generators or projects to pin them here.')),
    el('section', {}, el('div', { className: 'row section-head' }, el('h3', { textContent: 'Projects' }), el('a', { href: '#projects', textContent: 'All projects' })),
      cardList(projItems, view, 'No projects yet. Open Projects to create one.')),
    el('section', {}, el('div', { className: 'row section-head' }, el('h3', { textContent: 'Recent saved designs' }), el('a', { href: '#library', textContent: 'My Designs' })),
      cardList(designItems, view, designs.length ? '' : 'Press "Save design" in any tab to keep your settings.'))].filter(Boolean));
}

// ---------------------------------------------------------------- project 3D view helpers

let asmViewer = null;
/** Free the project page's 3D view (called when the page changes). */
export function stopProjectView() {
  asmViewer?.dispose();
  asmViewer = null;
}
const settingsViewer = () => ({ ...(ctx.state.viewerSettings?.() ?? {}), dimensions: true });
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** 4x4 column-major: translate(x, y, z) * Rz * Ry * Rx (degrees). */
function placeMatrix(pl) {
  const [a, b, c] = [pl.rx, pl.ry, pl.rz].map((d) => (d * Math.PI) / 180);
  const [cx, cy, cz] = [Math.cos(a), Math.cos(b), Math.cos(c)];
  const [sx, sy, sz] = [Math.sin(a), Math.sin(b), Math.sin(c)];
  const R = [[cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx], [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx], [-sy, cy * sx, cy * cx]];
  return [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, pl.x, pl.y, pl.z, 1];
}
function mul(A, B) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k];
  return out;
}

export { selectionFromItem };
