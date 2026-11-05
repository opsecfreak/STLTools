// Home page, advanced search, grid/list cards, favorites and projects.
import { $, el, api, store, debounce, fmtAgo, chooseDialog, SECTIONS, SECTION_NAMES } from './lib.js';
import { thumbImg } from './thumbs.js';

let ctx = null; // set by initHome: { state, openPreset, openDesign, openGenerator, goTab, refreshDesigns }
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
    try { await toggleFav(kind, id); } catch (err) { alert(err.message); }
  };
  return b;
}

// ---------------------------------------------------------------- search index

const defaultsOf = (gen) => Object.fromEntries(Object.entries(gen.params).map(([k, d]) => [k, d.default]));

function buildIndex() {
  const { generators, presets, designs } = ctx.state;
  const genById = new Map(generators.map((g) => [g.id, g]));
  const items = [];
  for (const p of presets) {
    const g = genById.get(p.generator);
    items.push({
      kind: 'preset', id: p.id, title: p.name, sub: `${SECTION_NAMES[p.section]} / ${p.group}`, description: p.description,
      section: p.section, sections: [p.section], generator: p.generator, generatorName: g?.name ?? p.generator, group: p.group, tags: p.tags ?? [],
      params: { ...(g ? defaultsOf(g) : {}), ...p.params }, ref: p,
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
  for (const it of items) {
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

function openItem(it) {
  if (it.kind === 'preset') ctx.openPreset(it.ref);
  else if (it.kind === 'design') ctx.openDesign(it.ref);
  else if (it.kind === 'generator') ctx.openGenerator(it.ref.id);
  else if (it.kind === 'project') location.hash = `#project/${it.id}`;
}

function projectProgress(pr) {
  const total = pr.items.length;
  const done = pr.items.filter((i) => i.printed).length;
  return el('div', { className: 'progress', title: `${done} of ${total} printed` }, el('div', { className: 'bar', style: `width:${total ? (100 * done) / total : 0}%` }));
}

function itemThumb(it) {
  if (it.kind === 'project') {
    const first = it.ref.items[0];
    const sel = first ? resolveItemForThumb(first) : null;
    return sel ? thumbImg(sel.generator, sel.params, it.title) : el('div', { className: 'thumb empty', textContent: 'Empty project' });
  }
  return thumbImg(it.generator, it.params, it.title);
}

function resolveItemForThumb(item) {
  if (item.kind === 'custom') return { generator: item.generator, params: item.params };
  if (item.kind === 'preset') {
    const p = ctx.state.presets.find((x) => x.id === item.ref);
    return p ? { generator: p.generator, params: p.params } : null;
  }
  const d = ctx.state.designs.find((x) => x.id === item.ref);
  return d ? { generator: d.generator, params: d.params } : null;
}

const KIND_LABEL = { preset: 'Preset', design: 'Saved', generator: 'Generator', project: 'Project' };

export function card(it, view = 'grid') {
  const actions = el('div', { className: 'card-actions' }, starButton(it.kind, it.id));
  if (it.kind !== 'project') {
    actions.append(el('button', { type: 'button', className: 'icon', textContent: '+', title: 'Add to a project', 'aria-label': 'Add to a project', onclick: (e) => { e.stopPropagation(); addToProject(selectionFromItem(it)); } }));
  }
  const body = el('div', { className: 'card-body' },
    el('div', { className: 'card-title', textContent: it.title }),
    el('div', { className: 'card-sub', textContent: it.sub }),
    it.kind === 'project' ? projectProgress(it.ref) : null,
    view === 'list' && it.description ? el('div', { className: 'card-desc', textContent: it.description }) : null);
  const c = el('article', { className: `card-item kind-${it.kind} ${view}`, tabIndex: 0, title: it.description || it.title },
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
  const view = store.get('view') ?? 'grid';
  const mk = (v, label) => el('button', { type: 'button', className: `subtab ${view === v ? 'active' : ''}`, textContent: label, onclick: () => { store.set('view', v); onChange(); } });
  return el('div', { className: 'subtabs view-toggle', 'aria-label': 'View' }, mk('grid', 'Grid'), mk('list', 'List'));
}

// ---------------------------------------------------------------- projects

function selectionFromItem(it) {
  if (it.kind === 'preset') return { kind: 'preset', ref: it.id, name: it.title };
  if (it.kind === 'design') return { kind: 'design', ref: it.id, name: it.title };
  return { kind: 'custom', generator: it.generator, params: it.params, name: it.title };
}

/** Add a part to a project. sel = { kind: preset|design|custom, ref?, generator?, params?, name } */
export async function addToProject(sel) {
  await refreshProjects();
  const choices = projects.map((p) => ({ label: `${p.name} (${p.items.length})`, value: p.id }));
  choices.push({ label: 'New project...', value: '__new__', secondary: true });
  let target = await chooseDialog('Add to project', choices, { message: `Part: ${sel.name}` });
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
    alert(err.message);
  }
}

export async function renderProjects(page) {
  await refreshProjects();
  const name = el('input', { type: 'text', placeholder: 'New project name', maxLength: 80 });
  const filter = el('select', {}, el('option', { value: '', textContent: 'All statuses' }), ...['idea', 'active', 'printing', 'done'].map((s) => el('option', { value: s, textContent: s })));
  const grid = el('div');
  const draw = () => {
    const view = store.get('view') ?? 'grid';
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
      try { const p = await api('POST', '/api/projects', { name: name.value }); location.hash = `#project/${p.id}`; } catch (err) { alert(err.message); }
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
    try { p = await api('PUT', `/api/projects/${p.id}`, { ...p, ...patch }); await refreshProjects(); drawStats(); } catch (err) { alert(err.message); }
  };
  const saveSoon = debounce(save, 500);

  const nameIn = el('input', { type: 'text', value: p.name, maxLength: 80, className: 'title-input', 'aria-label': 'Project name', oninput: () => saveSoon({ name: nameIn.value }) });
  const status = el('select', { onchange: () => save({ status: status.value }) }, ...['idea', 'active', 'printing', 'done'].map((s) => el('option', { value: s, textContent: s, selected: p.status === s })));
  const tags = el('input', { type: 'text', value: p.tags.join(', '), placeholder: 'tags, comma separated', oninput: () => saveSoon({ tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean) }) });
  const desc = el('textarea', { rows: 2, value: p.description, placeholder: 'Notes: frame size, motors, what this build is for...', oninput: () => saveSoon({ description: desc.value }) });
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
      if (r.files) el('a', { href: r.zip, download: `${p.name}.zip` }).click();
      else alert('Nothing to build.');
    } catch (err) { alert(err.message); } finally { b.disabled = false; b.textContent = old; }
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
        el('div', { className: 'card-thumb' }, sel ? thumbImg(sel.generator, sel.params, it.name) : el('div', { className: 'thumb empty', textContent: 'Missing' }), el('span', { className: 'badge', textContent: it.kind === 'custom' ? 'Custom' : KIND_LABEL[it.kind] })),
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
    const res = search(q, { kinds: ['preset', 'design', 'generator'] }).slice(0, 12);
    pickRes.replaceChildren(...res.map((r) => el('div', { className: 'pick-row' },
      el('span', {}, el('strong', { textContent: r.title }), el('span', { className: 'muted', textContent: `  ${r.sub}` })),
      el('button', { type: 'button', className: 'small', textContent: 'Add', onclick: async () => {
        try { p = await api('POST', `/api/projects/${p.id}/items`, { ...selectionFromItem(r), qty: 1 }); drawItems(); drawStats(); await refreshProjects(); } catch (err) { alert(err.message); }
      } }))));
    if (!res.length) pickRes.replaceChildren(el('p', { className: 'muted', textContent: 'No matches.' }));
  }, 150);

  page.replaceChildren(
    el('div', { className: 'page-head' },
      el('a', { href: '#projects', className: 'back', textContent: '< Projects' }),
      el('div', { className: 'row' }, nameIn, starButton('project', p.id), status),
      tags, desc, stats,
      el('div', { className: 'row' }, zipBtn('Download all parts (ZIP)', false), zipBtn('Only unprinted (ZIP)', true),
        el('button', { type: 'button', className: 'secondary', textContent: 'Delete project', onclick: async () => {
          if (!confirm(`Delete project "${p.name}"? Parts and saved designs are not deleted.`)) return;
          try { await api('DELETE', `/api/projects/${p.id}`); await refreshProjects(); location.hash = '#projects'; } catch (err) { alert(err.message); }
        } }))),
    el('h3', { textContent: 'Parts' }), items,
    el('h3', { textContent: 'Add parts' }), pickQ, pickRes);
}

function openProjectItem(it) {
  if (it.kind === 'preset') {
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

const SEARCH_HELP = 'Words must all match. "exact phrase", -exclude. Filters: tab:quads kind:preset gen:tube-clamp group:hooks tag:esc fav:yes status:active. Any setting: tubeOD:16 teeth>=30 length<20 bolt:M3';

export async function renderHome(page) {
  await Promise.all([refreshFavorites(), refreshProjects(), ctx.refreshDesigns().catch(() => null)]);
  const saved = store.get('homeSearch') ?? {};
  const q = el('input', { type: 'search', className: 'big-search', placeholder: `Search ${ctx.state.presets.length} presets, ${ctx.state.generators.length} generators, your designs and projects`, value: saved.q ?? '', 'aria-label': 'Search' });
  const kinds = ['preset', 'design', 'generator', 'project'].map((k) => el('input', { type: 'checkbox', value: k, checked: !(saved.kinds && !saved.kinds.includes(k)) }));
  const tab = el('select', {}, el('option', { value: '', textContent: 'All tabs' }), ...SECTIONS.map((s) => el('option', { value: s, textContent: SECTION_NAMES[s], selected: saved.section === s })));
  const gen = el('select', {}, el('option', { value: '', textContent: 'All generators' }), ...ctx.state.generators.map((g) => el('option', { value: g.id, textContent: g.name, selected: saved.generator === g.id })));
  const favOnly = el('input', { type: 'checkbox', checked: Boolean(saved.favoritesOnly) });
  const sort = el('select', {}, ...[['relevance', 'Best match'], ['name', 'Name'], ['tab', 'Tab'], ['recent', 'Recently changed']].map(([v, l]) => el('option', { value: v, textContent: l, selected: saved.sort === v })));
  const adv = el('details', { className: 'advanced', open: Boolean(saved.open) },
    el('summary', { textContent: 'Advanced search' }),
    el('div', { className: 'adv-grid' },
      el('div', { className: 'adv-kinds' }, ...kinds.map((k) => el('label', { className: 'check-inline' }, k, ` ${({ preset: 'Presets', design: 'Saved designs', generator: 'Generators', project: 'Projects' })[k.value]}`))),
      el('label', {}, 'Tab ', tab), el('label', {}, 'Generator ', gen), el('label', { className: 'check-inline' }, favOnly, ' Favorites only'), el('label', {}, 'Sort ', sort)),
    el('p', { className: 'muted', textContent: SEARCH_HELP }));
  const results = el('div', { className: 'home-results' });
  const dash = el('div', { className: 'home-dash' });

  const state = () => ({ q: q.value, kinds: kinds.filter((k) => k.checked).map((k) => k.value), section: tab.value, generator: gen.value, favoritesOnly: favOnly.checked, sort: sort.value, open: adv.open });
  const active = (s) => s.q.trim() || s.section || s.generator || s.favoritesOnly || s.kinds.length < 4;
  const draw = () => {
    const s = state();
    store.set('homeSearch', s);
    const view = store.get('view') ?? 'grid';
    if (active(s)) {
      const res = search(s.q, { kinds: s.kinds, section: s.section || null, generator: s.generator || null, favoritesOnly: s.favoritesOnly, sort: s.sort });
      dash.hidden = true;
      results.hidden = false;
      results.replaceChildren(
        el('div', { className: 'row results-head' }, el('strong', { textContent: `${res.length} result${res.length === 1 ? '' : 's'}` }), viewToggle(draw),
          el('button', { type: 'button', className: 'secondary small', textContent: 'Clear', onclick: () => { q.value = ''; tab.value = ''; gen.value = ''; favOnly.checked = false; kinds.forEach((k) => { k.checked = true; }); draw(); } })),
        cardList(res.slice(0, 300), view, 'No matches. Try fewer words, or check the filters.'));
    } else {
      results.hidden = true;
      dash.hidden = false;
      drawDashboard(dash, draw);
    }
  };
  q.oninput = debounce(draw, 150);
  for (const c of [...kinds, tab, gen, favOnly, sort]) c.onchange = draw;
  adv.ontoggle = () => store.set('homeSearch', state());
  page.replaceChildren(el('div', { className: 'home-search' }, q, adv), results, dash);
  draw();
}

function drawDashboard(dash, redraw) {
  const { presets, generators, designs } = ctx.state;
  const view = store.get('view') ?? 'grid';
  const tiles = SECTIONS.map((s) => el('button', { type: 'button', className: `tile tile-${s}`, onclick: () => ctx.goTab(s) },
    el('strong', { textContent: SECTION_NAMES[s] }),
    el('span', { textContent: `${presets.filter((p) => p.section === s).length} presets / ${generators.filter((g) => g.sections.includes(s)).length} generators` })));
  const favItems = search('', { favoritesOnly: true, sort: 'tab' });
  const projItems = search('', { kinds: ['project'], sort: 'recent' }).slice(0, 6);
  const designItems = search('', { kinds: ['design'], sort: 'recent' }).slice(0, 8);
  dash.replaceChildren(
    el('section', {}, el('div', { className: 'tiles' }, ...tiles,
      el('button', { type: 'button', className: 'tile tile-printers', onclick: () => { location.hash = '#printers'; } }, el('strong', { textContent: 'Printers' }), el('span', { textContent: 'Status, files, upload (view only)' })))),
    el('section', {}, el('div', { className: 'row section-head' }, el('h3', { textContent: `Favorites (${favItems.length})` }), viewToggle(redraw)),
      cardList(favItems, view, 'Star presets, designs, generators or projects to pin them here.')),
    el('section', {}, el('div', { className: 'row section-head' }, el('h3', { textContent: 'Projects' }), el('a', { href: '#projects', textContent: 'All projects' })),
      cardList(projItems, view, 'No projects yet. Open Projects to create one.')),
    el('section', {}, el('div', { className: 'row section-head' }, el('h3', { textContent: 'Recent saved designs' }), el('a', { href: '#library', textContent: 'My Designs' })),
      cardList(designItems, view, designs.length ? '' : 'Press "Save design" in any tab to keep your settings.')));
}
