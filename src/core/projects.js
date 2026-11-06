// Projects and favorites.
//
// Item kinds: preset (ref = preset id), design (ref = saved design id),
// custom (own generator + params snapshot), stl (ref = STL library id).
// exportBundle() / importBundle() move a project between computers: the
// bundle carries the saved designs and library STLs it uses, so it is
// complete on its own (format "stltools-project", version 1).
//
// A project groups the parts for one build ("7 in long-range quad", "shop wall"):
// each item points at a preset or saved design, or holds its own generator +
// parameter snapshot, with a quantity, a note and a printed checkbox.
// Favorites are stars on presets, saved designs, generators and projects.
// Both are stored in the data folder (projects.json, favorites.json) so every
// device that opens the server sees the same ones.

import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createJsonFile } from './jsonstore.js';
import { getGenerator, migrateInput } from './registry.js';
import { getPreset } from './presets.js';
import { resolveParams } from './params.js';
import { CatalogError } from './catalog.js';

const STATUSES = ['idea', 'active', 'printing', 'done'];
const KINDS = ['preset', 'design', 'custom', 'stl'];
export const BUNDLE_FORMAT = 'stltools-project';
const FAV_KINDS = ['preset', 'design', 'generator', 'project', 'stl'];

const text = (v, field, max) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new CatalogError(`${field} is longer than ${max} characters`);
  return s;
};
const newId = (name) => `${(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project')}-${randomBytes(3).toString('hex')}`;

export function createProjects({ dataDir, designs, library = null }) {
  const file = createJsonFile(join(dataDir, 'projects.json'), []);

  function cleanItem(raw) {
    const kind = KINDS.includes(raw.kind) ? raw.kind : null;
    if (!kind) throw new CatalogError(`Item kind must be one of ${KINDS.join(', ')}`);
    const item = {
      uid: raw.uid && /^[a-z0-9]{6,16}$/.test(raw.uid) ? raw.uid : randomBytes(4).toString('hex'),
      kind,
      ref: raw.ref ? String(raw.ref) : null,
      name: text(raw.name, 'Item name', 80),
      qty: Math.max(1, Math.min(999, Math.round(Number(raw.qty ?? 1)) || 1)),
      note: text(raw.note, 'Note', 300),
      printed: Boolean(raw.printed),
    };
    if (kind === 'custom') {
      let g;
      try {
        g = getGenerator(String(raw.generator ?? ''));
        item.params = resolveParams(g.params, migrateInput(g, raw.params ?? {}));
      } catch (err) {
        throw new CatalogError(err.message);
      }
      item.generator = g.id;
      if (!item.name) item.name = g.name;
    } else if (!item.ref) {
      throw new CatalogError(`A ${kind} item needs ref (the ${kind} id)`);
    } else if (kind === 'stl') {
      if (!/^stl-[a-f0-9]{8}$/.test(item.ref)) throw new CatalogError(`"${item.ref}" is not an STL library id`);
    } else if (kind === 'preset') {
      try {
        const p = getPreset(item.ref);
        if (!item.name) item.name = p.name;
      } catch (err) {
        throw new CatalogError(err.message);
      }
    }
    if (!item.name) item.name = item.ref ?? 'Part';
    return item;
  }

  function clean(raw, prev = {}) {
    const name = text(raw.name ?? prev.name, 'Name', 80);
    if (!name) throw new CatalogError('Project name is required');
    const status = STATUSES.includes(raw.status ?? prev.status) ? raw.status ?? prev.status : 'active';
    const tags = (Array.isArray(raw.tags ?? prev.tags) ? raw.tags ?? prev.tags : []).map((t) => text(t, 'Tag', 30).toLowerCase()).filter(Boolean).slice(0, 20);
    const items = (Array.isArray(raw.items ?? prev.items) ? raw.items ?? prev.items : []).slice(0, 500).map(cleanItem);
    return { name, description: text(raw.description ?? prev.description, 'Description', 2000), status, tags, items };
  }

  /** Fill in a missing part name from the saved design or library STL it points at. */
  async function withName(raw) {
    if (!raw || String(raw.name ?? '').trim()) return raw;
    try {
      if (raw.kind === 'design') return { ...raw, name: (await designs.get(raw.ref)).name };
      if (raw.kind === 'stl' && library) return { ...raw, name: (await library.get(raw.ref)).name };
    } catch { /* unknown ref: cleanItem reports it */ }
    return raw;
  }

  const api = {
    async list() {
      return (await file.get()).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async get(id) {
      const p = (await file.get()).find((x) => x.id === id);
      if (!p) throw new CatalogError(`No project ${id}`, 404);
      return p;
    },
    async add(raw) {
      const list = await file.get();
      const now = new Date().toISOString();
      const p = { id: newId(String(raw.name ?? '')), ...clean(raw), createdAt: now, updatedAt: now };
      await file.set([...list, p]);
      return p;
    },
    async update(id, raw) {
      const list = await file.get();
      const cur = await api.get(id);
      const next = { ...cur, ...clean(raw, cur), updatedAt: new Date().toISOString() };
      await file.set(list.map((x) => (x.id === id ? next : x)));
      return next;
    },
    async addItem(id, rawItem) {
      const cur = await api.get(id);
      rawItem = await withName(rawItem);
      return api.update(id, { items: [...cur.items, rawItem] });
    },
    async remove(id) {
      const list = await file.get();
      await api.get(id);
      await file.set(list.filter((x) => x.id !== id));
    },
    /** Generator + params for an item (presets and designs are read live, so edits flow through). */
    async resolveItem(item) {
      if (item.kind === 'custom') return { generator: item.generator, params: item.params };
      if (item.kind === 'preset') {
        const p = getPreset(item.ref);
        return { generator: p.generator, params: p.params };
      }
      if (item.kind === 'stl') {
        if (!library) throw new CatalogError('STL library is not available');
        return { stl: await library.file(item.ref), entry: await library.get(item.ref) };
      }
      const d = await designs.get(item.ref);
      return { generator: d.generator, params: d.params };
    },

    /** Everything needed to rebuild this project on another computer. */
    async exportBundle(id, { appVersion = '', includeStl = true } = {}) {
      const p = await api.get(id);
      const out = {
        format: BUNDLE_FORMAT, version: 1, app: appVersion, exportedAt: new Date().toISOString(),
        project: { name: p.name, description: p.description, status: p.status, tags: p.tags, items: p.items },
        designs: [], stls: [],
      };
      for (const it of p.items) {
        if (it.kind === 'design' && !out.designs.some((d) => d.id === it.ref)) {
          try { const d = await designs.get(it.ref); out.designs.push({ id: d.id, name: d.name, generator: d.generator, section: d.section, params: d.params, notes: d.notes }); } catch { /* deleted design: item stays, import reports it */ }
        }
        if (it.kind === 'stl' && includeStl && library && !out.stls.some((x) => x.id === it.ref)) {
          try {
            const e = await library.get(it.ref);
            out.stls.push({ id: e.id, name: e.name, filename: e.filename, folder: e.folder, tags: e.tags, notes: e.notes, data: (await library.file(it.ref)).toString('base64') });
          } catch { /* missing file */ }
        }
      }
      return out;
    },

    /**
     * Create a new project from a bundle (or a plain project object). Saved designs
     * and STLs in the bundle are added as new entries; items are re-pointed at them.
     * Returns { project, warnings }.
     */
    async importBundle(bundle) {
      if (!bundle || typeof bundle !== 'object') throw new CatalogError('Not a project file');
      if (bundle.format && bundle.format !== BUNDLE_FORMAT) throw new CatalogError(`Unknown file format "${bundle.format}"`);
      if (bundle.version && bundle.version > 1) throw new CatalogError('This project file is from a newer STL Tools. Update the app first.');
      const src = bundle.project ?? bundle;
      if (!Array.isArray(src.items)) throw new CatalogError('Project file has no items list');
      const warnings = [];
      const designMap = new Map();
      for (const d of bundle.designs ?? []) {
        try { designMap.set(d.id, (await designs.add({ name: d.name, generator: d.generator, section: d.section, params: d.params, notes: d.notes })).id); } catch (err) { warnings.push(`Design "${d.name}": ${err.message}`); }
      }
      const stlMap = new Map();
      for (const x of bundle.stls ?? []) {
        if (!library) break;
        try { stlMap.set(x.id, (await library.add(Buffer.from(String(x.data ?? ''), 'base64'), x)).id); } catch (err) { warnings.push(`STL "${x.name}": ${err.message}`); }
      }
      const items = [];
      for (const raw of src.items.slice(0, 500)) {
        const it = { ...raw };
        if (it.kind === 'design') {
          if (designMap.has(it.ref)) it.ref = designMap.get(it.ref);
          else if (!(await designs.get(it.ref).then(() => true, () => false))) { warnings.push(`Part "${it.name}": its saved design is not in the file. Skipped.`); continue; }
        }
        if (it.kind === 'stl') {
          if (stlMap.has(it.ref)) it.ref = stlMap.get(it.ref);
          else if (!library || !(await library.get(it.ref).then(() => true, () => false))) { warnings.push(`Part "${it.name}": its STL is not in the file. Skipped.`); continue; }
        }
        try { items.push(cleanItem(await withName(it))); } catch (err) { warnings.push(`Part "${it.name ?? '?'}": ${err.message}. Skipped.`); }
      }
      const project = await api.add({ name: src.name || 'Imported project', description: src.description, status: src.status, tags: src.tags, items });
      return { project, warnings };
    },
  };
  return api;
}

export function createFavorites({ dataDir }) {
  const file = createJsonFile(join(dataDir, 'favorites.json'), []);
  return {
    async list() {
      return file.get();
    },
    /** Toggle a star. Returns the new list. */
    async toggle({ kind, id }) {
      if (!FAV_KINDS.includes(kind)) throw new CatalogError(`Favorite kind must be one of ${FAV_KINDS.join(', ')}`);
      const ref = String(id ?? '').slice(0, 120);
      if (!ref) throw new CatalogError('Favorite needs an id');
      const list = await file.get();
      const has = list.some((f) => f.kind === kind && f.id === ref);
      const next = has ? list.filter((f) => !(f.kind === kind && f.id === ref)) : [...list, { kind, id: ref, addedAt: new Date().toISOString() }];
      if (next.length > 2000) throw new CatalogError('Too many favorites');
      return file.set(next);
    },
  };
}
