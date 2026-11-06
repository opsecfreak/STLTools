// My Parts page (#parts, #parts/<id>): the parts you own or plan to get, by
// category, with ownership, quantity, dimensions and their measure flags, and
// the presets that fit each part. Data: /api/parts (src/core/parts.js).
//
// Ownership: Owned (you have it), Confirm (used in a design, ownership not
// stated), Planned (wanted). Dimension flags: measure, conflict, unverified,
// standard, given, none. Presets link to parts by their "component" field.
import { el, api, toast, store, debounce } from './lib.js';

let ctx = null; // { state, openPreset }
export function initParts(context) { ctx = context; }

export const OWN_CLASS = { Owned: 'own-owned', Confirm: 'own-confirm', Planned: 'own-planned' };
const FLAG_LABEL = { measure: 'Needs measurement', conflict: 'Sizes conflict: measure', unverified: 'Unverified size', standard: 'Standard size', given: 'Size given', none: 'No size needed' };

/** Ownership of a preset: its part in My Parts, else the preset's own field. */
export function ownershipOf(preset) {
  if (!preset?.component) return preset?.ownership ?? null;
  const p = ctx?.state.parts?.find((x) => x.id === preset.component);
  return p?.ownershipKey ?? preset.ownership ?? null;
}

export function ownBadge(own) {
  return own ? el('span', { className: `own-badge ${OWN_CLASS[own] ?? ''}`, textContent: own, title: `Ownership: ${own}` }) : null;
}

export async function refreshParts() {
  const d = await api('GET', '/api/parts');
  ctx.state.parts = d.items;
  ctx.state.partCategories = d.categories;
  ctx.state.partSeeds = d.seeds;
  return d;
}

export async function renderParts(page, focusId = '') {
  const [d, seeds] = await Promise.all([refreshParts(), api('GET', '/api/parts/seeds').catch(() => [])]);
  const saved = store.get('partsFilter') ?? {};
  const q = el('input', { type: 'search', placeholder: `Search ${d.items.length} parts: name, id, detail, project`, value: saved.q ?? '' });
  const own = el('select', {}, ...[['', 'All ownership'], ['Owned', 'Owned'], ['Confirm', 'Confirm'], ['Planned', 'Planned']].map(([v, l]) => el('option', { value: v, textContent: l, selected: saved.own === v })));
  const flag = el('select', {}, ...[['', 'All sizes'], ['todo', 'Needs measurement or conflict'], ['measure', 'Needs measurement'], ['conflict', 'Conflict'], ['unverified', 'Unverified'], ['known', 'Size known']].map(([v, l]) => el('option', { value: v, textContent: l, selected: saved.flag === v })));
  const cat = el('select', {}, el('option', { value: '', textContent: 'All categories' }), ...d.categories.map((c) => el('option', { value: c, textContent: c, selected: saved.cat === c })));
  const list = el('div', { className: 'parts-list' });

  const presetsFor = (id) => ctx.state.presets.filter((p) => p.component === id);
  const counts = (items) => ['Owned', 'Confirm', 'Planned'].map((k) => `${items.filter((i) => i.ownershipKey === k).length} ${k.toLowerCase()}`).join(', ');

  const draw = () => {
    store.set('partsFilter', { q: q.value, own: own.value, flag: flag.value, cat: cat.value });
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const items = d.items.filter((i) => (!own.value || i.ownershipKey === own.value)
      && (!cat.value || i.category === cat.value)
      && (!flag.value || (flag.value === 'todo' ? ['measure', 'conflict'].includes(i.dimsFlag) : flag.value === 'known' ? ['standard', 'given'].includes(i.dimsFlag) : i.dimsFlag === flag.value))
      && words.every((w) => [i.id, i.name, i.detail, i.projects, i.printNeed, i.notes, i.category].join(' ').toLowerCase().includes(w)));
    const groups = d.categories.map((c) => [c, items.filter((i) => i.category === c)]).filter(([, xs]) => xs.length);
    list.replaceChildren(
      el('p', { className: 'muted', textContent: `${items.length} of ${d.items.length} parts (${counts(items)}). ${items.filter((i) => ['measure', 'conflict'].includes(i.dimsFlag)).length} need measuring.` }),
      ...groups.map(([c, xs]) => el('section', { className: 'parts-cat' },
        el('h3', { textContent: `${c} (${xs.length})` }),
        ...xs.map((i) => partRow(i, presetsFor(i.id), (next) => { Object.assign(i, next); ctx.state.parts = [...d.items]; draw(); })))));
    if (!d.items.length) list.replaceChildren(el('p', { className: 'muted empty-note', textContent: 'No parts yet. Load the starter data above, import a components.json file, or add a part.' }));
    if (focusId) {
      list.querySelector(`[data-part="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'center' });
      focusId = '';
    }
  };
  q.oninput = debounce(draw, 120);
  for (const s of [own, flag, cat]) s.onchange = draw;

  const seedBox = el('div', { className: 'seed-box' }, ...seeds.map((sd) => el('div', { className: 'card seed-card' },
    el('strong', { textContent: sd.title }),
    el('p', { className: 'muted', textContent: sd.loaded ? 'Loaded. Loading again adds new parts and project ideas only; your edits stay.' : 'Parts list with ownership and sizes, print ideas as projects, and existing assemblies.' }),
    el('button', { type: 'button', className: sd.loaded ? 'secondary' : '', textContent: sd.loaded ? 'Load again' : 'Load starter data', onclick: async (e) => {
      e.target.disabled = true;
      try {
        const r = await api('POST', '/api/parts/seed', { set: sd.set });
        toast(`${r.parts.added} parts added, ${r.parts.updated} updated, ${r.parts.kept} kept; ${r.projects.created} projects created.`, 'ok', 6000);
        renderParts(page);
      } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
    } }))));

  const importInput = el('input', { type: 'file', accept: '.json', hidden: true, onchange: async () => {
    const f = importInput.files[0];
    importInput.value = '';
    if (!f) return;
    try { const r = await api('POST', '/api/parts/import', JSON.parse(await f.text())); toast(`${r.added} added, ${r.updated} updated, ${r.kept} kept (edited).`, 'ok'); renderParts(page); } catch (err) { toast(err.message, 'error'); }
  } });

  page.replaceChildren(
    el('div', { className: 'page-head' }, el('h2', { textContent: 'My Parts' }),
      el('p', { className: 'muted', textContent: 'Parts you own or plan to get. Ownership filters presets everywhere (Home: "My parts only", or type own:owned). Sizes marked MEASURE stay empty in their presets until you measure them.' })),
    seedBox,
    el('div', { className: 'row' }, q, own, flag, cat,
      el('button', { type: 'button', className: 'secondary', textContent: 'Import components.json', onclick: () => importInput.click() }),
      el('a', { className: 'button secondary', href: '/api/backup', download: 'stltools-backup.json', textContent: 'Backup' }), importInput),
    list);
  draw();
}

function partRow(i, presets, onSaved) {
  const ownSel = el('select', { 'aria-label': `Ownership of ${i.name}` }, ...['Owned', 'Confirm', 'Planned'].map((o) => el('option', { value: o, textContent: o, selected: i.ownershipKey === o })));
  const qty = el('input', { type: 'text', value: i.qty, maxLength: 40, className: 'part-qty', 'aria-label': 'Quantity' });
  const dims = el('input', { type: 'text', value: i.dims, maxLength: 400, placeholder: 'MEASURE', className: 'part-dims', 'aria-label': 'Dimensions' });
  const notes = el('input', { type: 'text', value: i.notes ?? '', maxLength: 2000, placeholder: 'notes', 'aria-label': 'Notes' });
  const save = debounce(async () => {
    try {
      const next = await api('PUT', `/api/parts/${i.id}`, { ownership: ownSel.value === i.ownershipKey ? i.ownership : ownSel.value, qty: qty.value, dims: dims.value, dimsSource: dims.value !== i.dims ? 'Measured in STL Tools' : i.dimsSource, notes: notes.value });
      onSaved(next);
      toast(`${i.id} saved`, 'ok', 1200);
    } catch (err) { toast(err.message, 'error'); }
  }, 700);
  ownSel.onchange = save;
  for (const x of [qty, dims, notes]) x.oninput = save;
  return el('article', { className: `mypart-row ${OWN_CLASS[i.ownershipKey] ?? ''}`, dataset: { part: i.id } },
    el('div', { className: 'part-main' },
      el('div', {}, el('code', { textContent: i.id }), ' ', el('strong', { textContent: i.name }), ' ', ownBadge(i.ownershipKey),
        el('span', { className: `flag flag-${i.dimsFlag}`, textContent: FLAG_LABEL[i.dimsFlag] ?? i.dimsFlag })),
      el('div', { className: 'muted', textContent: [i.detail, i.projects && `Projects: ${i.projects}`, i.printNeed && `Print: ${i.printNeed}`].filter(Boolean).join('  |  ') }),
      el('div', { className: 'row part-edit' }, ownSel, el('label', {}, 'Qty ', qty), el('label', { className: 'grow' }, 'Size (mm) ', dims), notes),
      i.dimsSource ? el('div', { className: 'muted', textContent: `Size source: ${i.dimsSource}` }) : null),
    el('div', { className: 'part-presets' },
      presets.length ? el('span', { className: 'muted', textContent: `${presets.length} preset${presets.length > 1 ? 's' : ''}:` }) : el('span', { className: 'muted', textContent: 'No preset yet' }),
      ...presets.map((p) => el('button', { type: 'button', className: `small ${p.measure?.length ? 'secondary needs-measure' : 'secondary'}`, textContent: p.name, title: p.measure?.length ? `Needs measurement: ${p.measure.join(', ')}` : p.description, onclick: () => ctx.openPreset(p) }))));
}
