// Projects and favorites.
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
const KINDS = ['preset', 'design', 'custom'];
const FAV_KINDS = ['preset', 'design', 'generator', 'project'];

const text = (v, field, max) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new CatalogError(`${field} is longer than ${max} characters`);
  return s;
};
const newId = (name) => `${(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project')}-${randomBytes(3).toString('hex')}`;

export function createProjects({ dataDir, designs }) {
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
      const d = await designs.get(item.ref);
      return { generator: d.generator, params: d.params };
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
