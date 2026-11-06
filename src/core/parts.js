// My Parts: the parts you own or plan to buy (flight controllers, sensors,
// boards, motors...), with ownership, quantity and measured dimensions.
//
// Stored in <data>/parts.json as { categories: [...], items: [...] }.
// Starter data ships in seed/<set>/ (seed/example is a small example list) and is
// loaded with loadSeed(). Loading again never overwrites a part you edited.
//
// Dimension flags (dimsFlag): from the "dims" text, so the UI can show what
// still needs a caliper:
//   measure     "MEASURE" or empty: nobody measured it
//   conflict    "CONFLICT": two sources disagree
//   unverified  "UNVERIFIED" / "assumed" in the dims or source
//   standard    a published standard (bearing, Pi, 18650, XIAO...)
//   given       a size from a spec sheet or a stated value
//   none        "N/A" (nothing to measure)
//
// Presets point at a part with "component": "<part id>" (presets/22-mts-parts.json).

import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { createJsonFile } from './jsonstore.js';
import { CatalogError } from './catalog.js';

export const OWNERSHIP = ['Owned', 'Confirm', 'Planned'];

export function dimsFlag(dims = '', source = '') {
  const d = String(dims).trim();
  const both = `${d} ${source}`;
  if (/CONFLICT/i.test(d)) return 'conflict';
  if (!d || /MEASURE/i.test(d)) return 'measure';
  if (/^N\/A$/i.test(d)) return 'none';
  if (/UNVERIFIED|assumed/i.test(both)) return 'unverified';
  if (/standard/i.test(both)) return 'standard';
  return 'given';
}

/** "Owned (15, 11); Planned (10)" -> "Owned"; anything unknown -> "Confirm". */
export function ownershipKey(s) {
  const m = String(s ?? '').match(/Owned|Confirm|Planned/i);
  return m ? m[0][0].toUpperCase() + m[0].slice(1).toLowerCase() : 'Confirm';
}

const text = (v, field, max) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new CatalogError(`${field} is longer than ${max} characters`);
  return s;
};

function clean(raw, prev = {}) {
  const id = String(raw.id ?? prev.id ?? '').trim();
  if (!/^[A-Z]{2,4}\d{2,3}$/.test(id)) throw new CatalogError(`Part id "${id}" must look like SEN02`);
  const pick = (k, max, field = k) => text(raw[k] !== undefined ? raw[k] : prev[k], field, max);
  const ownership = pick('ownership', 80);
  const dims = pick('dims', 400, 'Dimensions');
  const dimsSource = pick('dimsSource', 200, 'Dimension source');
  return {
    id,
    category: pick('category', 80) || 'Other',
    name: pick('name', 120) || id,
    detail: pick('detail', 400),
    qty: pick('qty', 40, 'Quantity'),
    ownership: ownership || 'Confirm',
    ownershipKey: ownershipKey(ownership),
    projects: pick('projects', 300),
    dims,
    dimsSource,
    dimsFlag: dimsFlag(dims, dimsSource),
    printNeed: pick('printNeed', 400, 'Print need'),
    notes: pick('notes', 2000),
    // presets that fit this part (preset ids); My Parts lists them and the ownership filter follows them
    presets: (Array.isArray(raw.presets ?? prev.presets) ? raw.presets ?? prev.presets : []).map(String).filter((x) => /^[a-z0-9][a-z0-9-]{1,80}$/.test(x)).slice(0, 50),
  };
}

/** components.json (handoff format, snake_case) -> part objects. */
export function fromComponents(json) {
  const items = Array.isArray(json) ? json : json?.items;
  if (!Array.isArray(items)) throw new CatalogError('Not a components file (no items list)');
  return {
    categories: Array.isArray(json.categories) ? json.categories.map(String) : [...new Set(items.map((i) => i.category))],
    items: items.map((i) => ({ id: i.id, category: i.category, name: i.name, detail: i.detail, qty: i.qty, ownership: i.ownership, projects: i.projects, dims: i.dims_mm ?? i.dims, dimsSource: i.dims_source ?? i.dimsSource, printNeed: i.print_need ?? i.printNeed, notes: i.notes, presets: i.presets })),
  };
}

export function createParts({ dataDir, seedDir }) {
  const file = createJsonFile(join(dataDir, 'parts.json'), { categories: [], items: [], seeds: [] });

  const api = {
    async list() {
      const d = await file.get();
      return { categories: d.categories, items: d.items, seeds: d.seeds ?? [] };
    },
    async get(id) {
      const p = (await file.get()).items.find((x) => x.id === id);
      if (!p) throw new CatalogError(`No part ${id}`, 404);
      return p;
    },
    /** Edit one part (ownership, qty, dims, notes...). Marks it as edited so seeds never overwrite it. */
    async update(id, raw) {
      const d = await file.get();
      const cur = await api.get(id);
      const next = { ...clean({ ...raw, id }, cur), edited: true, updatedAt: new Date().toISOString() };
      await file.set({ ...d, items: d.items.map((x) => (x.id === id ? next : x)) });
      return next;
    },
    async add(raw) {
      const d = await file.get();
      const p = clean(raw);
      if (d.items.some((x) => x.id === p.id)) throw new CatalogError(`Part ${p.id} already exists`);
      const next = { ...p, edited: true, updatedAt: new Date().toISOString() };
      await file.set({ ...d, categories: d.categories.includes(p.category) ? d.categories : [...d.categories, p.category], items: [...d.items, next] });
      return next;
    },
    async remove(id) {
      const d = await file.get();
      await api.get(id);
      await file.set({ ...d, items: d.items.filter((x) => x.id !== id) });
    },
    /**
     * Merge a parts list. New ids are added; existing ids are updated only if
     * you never edited them in the app (or overwrite is true). Returns counts.
     */
    async merge({ categories = [], items = [] }, { overwrite = false } = {}) {
      const d = await file.get();
      const byId = new Map(d.items.map((x) => [x.id, x]));
      let added = 0, updated = 0, kept = 0;
      for (const raw of items) {
        const p = clean(raw);
        const cur = byId.get(p.id);
        if (!cur) { byId.set(p.id, { ...p, updatedAt: new Date().toISOString() }); added++; }
        else if (cur.edited && !overwrite) kept++;
        else { byId.set(p.id, { ...cur, ...p, edited: false, updatedAt: new Date().toISOString() }); updated++; }
      }
      const cats = [...d.categories];
      for (const c of [...categories, ...[...byId.values()].map((x) => x.category)]) if (!cats.includes(c)) cats.push(c);
      await file.set({ ...d, categories: cats, items: [...byId.values()] });
      return { added, updated, kept, total: byId.size };
    },
    /** Seed sets shipped in seed/: [{ set, title, loaded }] */
    async seeds() {
      const d = await file.get();
      const out = [];
      for (const set of await readdir(seedDir).catch(() => [])) {
        const readme = await readFile(join(seedDir, set, 'README.md'), 'utf8').catch(() => '');
        out.push({ set, title: (readme.match(/^# (.+)$/m) ?? [])[1] ?? set, loaded: (d.seeds ?? []).includes(set) });
      }
      return out;
    },
    async markSeed(set) {
      const d = await file.get();
      await file.set({ ...d, seeds: [...new Set([...(d.seeds ?? []), set])] });
    },
  };
  return api;
}

/** Read a seed set from disk: { components, candidates, assemblies: [{ file, text }] } */
export async function readSeed(seedDir, set) {
  if (!/^[a-z0-9-]{2,40}$/.test(set)) throw new CatalogError('Bad seed name');
  const dir = join(seedDir, set);
  const json = async (f) => JSON.parse(await readFile(join(dir, f), 'utf8'));
  let components;
  try { components = await json('components.json'); } catch { throw new CatalogError(`No seed set "${set}"`, 404); }
  const candidates = await json('print_candidates.json').catch(() => ({ items: [] }));
  const assemblies = [];
  for (const f of (await readdir(join(dir, 'assemblies')).catch(() => [])).filter((x) => x.endsWith('.md')).sort()) {
    assemblies.push({ file: f, text: await readFile(join(dir, 'assemblies', f), 'utf8') });
  }
  return { components, candidates, assemblies };
}
