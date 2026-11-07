// Browse page (#browse): every preset, saved design, generator, STL file,
// project and part with facet filters and counts:
//   type, tab, category (group), generator, tags, collection, origin
//   (hand-made / size series), measuring, ownership.
// Counts show how many results each choice leaves. Collections (your own
// named groups) are created and managed here and from the "+" on any card.
// Uses the shared search index from home.js, so the query syntax works too.
import { el, api, store, debounce, viewMode, toast, confirmDelete, SECTIONS, SECTION_NAMES } from './lib.js';
import { search, cardList } from './home.js';

let ctx = null; // { state, refreshCollections }
export function initBrowse(context) { ctx = context; }

const KINDS = [['preset', 'Presets'], ['design', 'Saved designs'], ['generator', 'Generators'], ['stl', 'STL files'], ['project', 'Projects'], ['part', 'My parts']];
const PAGE = 60;

export function renderBrowse(page, focus = '') {
  const st = { q: '', kinds: [], tab: '', group: '', generator: '', tags: [], collection: '', origin: '', measure: '', own: '', sort: 'name', ...(store.get('browse') ?? {}) };
  if (focus.startsWith('col-')) Object.assign(st, { collection: focus, kinds: [], tab: '', group: '', tags: [] });
  let shown = PAGE;
  const q = el('input', { type: 'search', className: 'big-search', placeholder: 'Filter by words or the search syntax (tubeOD:16, teeth>=30, tag:esc)', value: st.q });
  const side = el('aside', { className: 'browse-side' });
  const head = el('div', { className: 'row results-head' });
  const grid = el('div');
  const more = el('div');

  const save = () => store.set('browse', st);
  const set = (patch) => { Object.assign(st, patch); shown = PAGE; save(); draw(); };
  const facet = (title, rows, current, onPick, { max = 12, allLabel = 'All' } = {}) => {
    const box = el('section', { className: 'facet' }, el('h4', { textContent: title }));
    const all = el('button', { type: 'button', className: `facet-row ${!current ? 'active' : ''}`, onclick: () => onPick('') }, el('span', { textContent: allLabel }));
    box.append(all);
    const list = rows.filter(([, , n]) => n > 0 || current === rows[0]);
    const showAll = el('details', { className: 'facet-more' }, el('summary', { textContent: `${Math.max(0, list.length - max)} more` }));
    list.forEach(([value, label, n], i) => {
      const row = el('button', { type: 'button', className: `facet-row ${current === value ? 'active' : ''}`, onclick: () => onPick(current === value ? '' : value) }, el('span', { textContent: label }), el('span', { className: 'facet-n', textContent: String(n) }));
      (i < max || current === value ? box : showAll).append(row);
    });
    if (list.length > max) box.append(showAll);
    return box;
  };
  const count = (items, keyFn) => {
    const m = new Map();
    for (const it of items) for (const k of [].concat(keyFn(it)).filter(Boolean)) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };

  function filtered() {
    let res = search(st.q, { sort: st.sort });
    if (st.kinds.length) res = res.filter((it) => st.kinds.includes(it.kind));
    if (st.tab) res = res.filter((it) => it.sections.includes(st.tab));
    if (st.group) res = res.filter((it) => it.group === st.group);
    if (st.generator) res = res.filter((it) => it.generator === st.generator);
    for (const t of st.tags) res = res.filter((it) => it.tags.some((x) => x.toLowerCase() === t));
    if (st.collection) res = res.filter((it) => it.collections.includes(st.collection));
    if (st.origin) res = res.filter((it) => (st.origin === 'series' ? it.series : st.origin === 'hand' ? it.kind === 'preset' && !it.series : it.series === st.origin));
    if (st.measure) res = res.filter((it) => (st.measure === 'yes' ? it.measure?.length : !it.measure?.length));
    if (st.own) res = res.filter((it) => it.ownership === st.own);
    return res.filter((it) => !['page', 'item'].includes(it.kind));
  }

  function drawSide(res) {
    const gens = ctx.state.generators;
    const cols = ctx.state.collections ?? [];
    const kinds = count(res, (it) => it.kind);
    const tabs = count(res, (it) => it.sections);
    const groups = count(res, (it) => it.group);
    const genC = count(res, (it) => it.generator);
    const tagC = count(res, (it) => it.tags.map((t) => t.toLowerCase()));
    const colC = count(res, (it) => it.collections);
    const seriesC = count(res, (it) => it.series);
    const ownC = count(res, (it) => it.ownership);
    const byN = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
    side.replaceChildren(...[
      el('section', { className: 'facet' }, el('h4', { textContent: 'Type' }),
        ...KINDS.map(([k, label]) => el('label', { className: 'check-inline facet-check' }, el('input', { type: 'checkbox', checked: st.kinds.includes(k), onchange: (e) => set({ kinds: e.target.checked ? [...st.kinds, k] : st.kinds.filter((x) => x !== k) }) }), ` ${label}`, el('span', { className: 'facet-n', textContent: String(kinds.get(k) ?? 0) })))),
      facet('Tab', SECTIONS.map((s) => [s, SECTION_NAMES[s], tabs.get(s) ?? 0]), st.tab, (v) => set({ tab: v })),
      facet('Category', byN(groups).map(([g, n]) => [g, g, n]), st.group, (v) => set({ group: v }), { max: 10 }),
      facet('Generator', byN(genC).map(([g, n]) => [g, gens.find((x) => x.id === g)?.name ?? g, n]), st.generator, (v) => set({ generator: v }), { max: 8 }),
      el('section', { className: 'facet' }, el('h4', { textContent: 'Tags' }),
        el('div', { className: 'tag-cloud' }, ...byN(tagC).filter(([t]) => t.length > 1).slice(0, 40).map(([t, n]) => el('button', { type: 'button', className: `tag-chip ${st.tags.includes(t) ? 'active' : ''}`, textContent: `${t} ${n}`, onclick: () => set({ tags: st.tags.includes(t) ? st.tags.filter((x) => x !== t) : [...st.tags, t] }) })))),
      collectionsFacet(cols, colC),
      facet('Origin', [['hand', 'Hand-made presets', (kinds.get('preset') ?? 0) - [...seriesC.values()].reduce((a, b) => a + b, 0)], ['series', 'Size series (all)', [...seriesC.values()].reduce((a, b) => a + b, 0)], ...byN(seriesC).map(([sv, n]) => [sv, `Series: ${sv}`, n])], st.origin, (v) => set({ origin: v }), { max: 4 }),
      facet('Measuring', [['yes', 'Needs measurement', res.filter((it) => it.measure?.length).length], ['no', 'Ready to print', res.filter((it) => !it.measure?.length).length]], st.measure, (v) => set({ measure: v })),
      ownC.size ? facet('Ownership (My Parts)', ['Owned', 'Confirm', 'Planned'].map((o) => [o, o, ownC.get(o) ?? 0]), st.own, (v) => set({ own: v })) : null].filter(Boolean));
  }

  function collectionsFacet(cols, colC) {
    const box = el('section', { className: 'facet' }, el('h4', { textContent: 'Collections' }));
    box.append(el('button', { type: 'button', className: `facet-row ${!st.collection ? 'active' : ''}`, onclick: () => set({ collection: '' }) }, el('span', { textContent: 'All' })));
    for (const c of cols) {
      box.append(el('div', { className: 'facet-col' },
        el('button', { type: 'button', className: `facet-row ${st.collection === c.id ? 'active' : ''}`, style: `--col:${c.color}`, onclick: () => set({ collection: st.collection === c.id ? '' : c.id }) },
          el('span', { className: 'col-dot' }), el('span', { textContent: c.name }), el('span', { className: 'facet-n', textContent: String(colC.get(c.id) ?? 0) })),
        el('button', { type: 'button', className: 'icon small', textContent: '...', title: 'Rename, recolor or delete', onclick: () => editCollection(c) })));
    }
    box.append(el('button', { type: 'button', className: 'secondary small', textContent: 'New collection', onclick: async () => {
      const name = prompt('Collection name (e.g. Bench tools, Long-range quad):');
      if (!name) return;
      try { const c = await api('POST', '/api/collections', { name }); await ctx.refreshCollections(); set({ collection: c.id }); } catch (err) { toast(err.message, 'error'); }
    } }));
    if (!cols.length) box.append(el('p', { className: 'muted', textContent: 'Group anything: press + on a card > New collection.' }));
    return box;
  }

  async function editCollection(c) {
    const name = prompt(`Rename "${c.name}" (leave empty to delete it):`, c.name);
    if (name === null) return;
    try {
      if (!name.trim()) {
        if (!confirmDelete(`Delete the collection "${c.name}"? The items themselves stay.`)) return;
        await api('DELETE', `/api/collections/${c.id}`);
        if (st.collection === c.id) st.collection = '';
      } else {
        const color = prompt('Color (#rrggbb):', c.color) ?? c.color;
        await api('PUT', `/api/collections/${c.id}`, { name, color });
      }
      await ctx.refreshCollections();
      draw();
    } catch (err) { toast(err.message, 'error'); }
  }

  // Families: results nested by generator, then by the setting that sorts them best (tube size,
  // screw size, teeth...), then by the next one when a branch is still long.
  const fmtVal = (def, v) => {
    if (def?.type === 'select') return (def.options.find((o) => (o.value ?? o) === v)?.label ?? String(v));
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    return `${v}${def?.unit ? ` ${def.unit}` : ''}`;
  };
  const splitKey = (gen, items, skip = []) => {
    const keys = [...(gen?.basic ?? []), ...Object.keys(gen?.params ?? {})].filter((k, i, a) => a.indexOf(k) === i && !skip.includes(k));
    let best = null;
    for (const k of keys) {
      const vals = new Set(items.map((it) => JSON.stringify(it.params?.[k])));
      if (vals.size < 2 || vals.size > 40) continue;
      const score = (gen.basic?.includes(k) ? 100 : 0) - Math.abs(vals.size - 8); // prefer main settings with a handful of values
      if (!best || score > best.score) best = { k, score };
    }
    return best?.k ?? null;
  };
  const familyTree = (items, gen, depth, skip, openKey) => {
    const k = depth < 2 && items.length > 12 ? splitKey(gen, items, skip) : null;
    if (!k) return cardList(items.slice(0, 120), viewMode(), '');
    const def = gen.params[k];
    const groups = new Map();
    for (const it of items) { const v = it.params?.[k]; const key = JSON.stringify(v); if (!groups.has(key)) groups.set(key, { v, items: [] }); groups.get(key).items.push(it); }
    const sorted = [...groups.values()].sort((a, b) => (typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v))));
    return el('div', { className: 'family-level' }, ...sorted.map((g) => {
      const id = `${openKey}|${k}=${JSON.stringify(g.v)}`;
      const d = el('details', { className: 'family', open: openFams.has(id) }, el('summary', {}, el('span', { textContent: `${def?.label ?? k}: ${g.v === undefined || g.v === null ? 'blank' : fmtVal(def, g.v)}` }), el('span', { className: 'facet-n', textContent: String(g.items.length) })));
      d.ontoggle = () => { if (d.open) { openFams.add(id); if (d.children.length === 1) d.append(familyTree(g.items, gen, depth + 1, [...skip, k], id)); } else openFams.delete(id); store.set('browseOpen', [...openFams].slice(-200)); };
      if (d.open) d.append(familyTree(g.items, gen, depth + 1, [...skip, k], id));
      return d;
    }));
  };
  const openFams = new Set(store.get('browseOpen') ?? []);
  function drawFamilies(res) {
    const gens = ctx.state.generators;
    const byGen = new Map();
    const loose = [];
    for (const it of res) {
      if ((it.kind === 'preset' || it.kind === 'design') && it.generator) { if (!byGen.has(it.generator)) byGen.set(it.generator, []); byGen.get(it.generator).push(it); } else loose.push(it);
    }
    const blocks = [...byGen.entries()].sort((a, b) => b[1].length - a[1].length).map(([gid, items]) => {
      const gen = gens.find((g) => g.id === gid);
      const id = `g:${gid}`;
      const d = el('details', { className: 'family family-top', open: openFams.has(id) }, el('summary', {}, el('strong', { textContent: gen?.name ?? gid }), el('span', { className: 'facet-n', textContent: String(items.length) })));
      d.ontoggle = () => { if (d.open) { openFams.add(id); if (d.children.length === 1) d.append(familyTree(items, gen, 0, [], id)); } else openFams.delete(id); store.set('browseOpen', [...openFams].slice(-200)); };
      if (d.open) d.append(familyTree(items, gen, 0, [], id));
      return d;
    });
    return el('div', { className: 'families' }, ...blocks, loose.length ? el('details', { className: 'family family-top' }, el('summary', {}, el('strong', { textContent: 'Other (generators, projects, STL files, parts)' }), el('span', { className: 'facet-n', textContent: String(loose.length) })), cardList(loose.slice(0, 200), viewMode(), '')) : null);
  }

  function draw() {
    const res = filtered();
    drawSide(res);
    const sort = el('select', { 'aria-label': 'Sort', onchange: (e) => set({ sort: e.target.value }) }, ...[['name', 'Name'], ['relevance', 'Best match'], ['tab', 'Tab'], ['recent', 'Recently changed']].map(([v, l]) => el('option', { value: v, textContent: l, selected: st.sort === v })));
    const active = [st.q, st.tab, st.group, st.generator, st.collection, st.origin, st.measure, st.own, ...st.tags, ...st.kinds].filter(Boolean).length;
    head.replaceChildren(...[el('strong', { textContent: `${res.length.toLocaleString()} result${res.length === 1 ? '' : 's'}` }), sort,
      el('button', { type: 'button', className: 'secondary small', textContent: viewMode() === 'grid' ? 'List view' : 'Grid view', onclick: () => { store.set('view', viewMode() === 'grid' ? 'list' : 'grid'); draw(); } }),
      el('button', { type: 'button', className: `secondary small ${st.families ? 'active' : ''}`, textContent: st.families ? 'Flat list' : 'Families', title: 'Nest results by part, then by size (tube size, screw, teeth...)', onclick: () => set({ families: !st.families }) }),
      active ? el('button', { type: 'button', className: 'secondary small', textContent: `Clear ${active} filter${active > 1 ? 's' : ''}`, onclick: () => { q.value = ''; set({ q: '', kinds: [], tab: '', group: '', generator: '', tags: [], collection: '', origin: '', measure: '', own: '' }); } }) : null].filter(Boolean));
    if (st.families) { grid.replaceChildren(res.length ? drawFamilies(res) : el('p', { className: 'muted', textContent: 'Nothing matches these filters.' })); more.replaceChildren(); return; }
    grid.replaceChildren(cardList(res.slice(0, shown), viewMode(), 'Nothing matches these filters.'));
    more.replaceChildren(...(res.length > shown ? [el('button', { type: 'button', className: 'secondary', textContent: `Show ${Math.min(PAGE, res.length - shown)} more of ${(res.length - shown).toLocaleString()}`, onclick: () => { shown += PAGE; draw(); } })] : []));
  }

  q.oninput = debounce(() => set({ q: q.value }), 150);
  page.replaceChildren(
    el('div', { className: 'page-head' }, el('h2', { textContent: 'Browse' }),
      el('p', { className: 'muted', textContent: 'Everything in one place. Narrow it down with the filters; the numbers show how many results each choice leaves. Make your own groups with Collections.' })),
    q,
    el('div', { className: 'browse-layout' }, side, el('div', { className: 'browse-main' }, head, grid, more)));
  draw();
}
