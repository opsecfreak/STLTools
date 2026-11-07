// Collections: your own named groups of STL files (MTS edition: STL-only). Adding a
// preset, design, generator or project through the API saves frozen STL copies in
// the STL library and adds those (server.js stlIdsFor); old collections with other
// kinds are converted on first read. Used by Browse and the "+" button on every card.
// Stored in <data>/collections.json.

import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createJsonFile } from './jsonstore.js';
import { CatalogError } from './catalog.js';

export const COLLECTION_KINDS = ['preset', 'design', 'generator', 'stl', 'project'];

const clean = (raw, prev = {}) => {
  const name = String(raw.name ?? prev.name ?? '').trim().slice(0, 60);
  if (!name) throw new CatalogError('Collection name is required');
  const color = /^#[0-9a-f]{6}$/i.test(raw.color ?? '') ? raw.color.toLowerCase() : prev.color ?? '#1f6feb';
  const items = (Array.isArray(raw.items ?? prev.items) ? raw.items ?? prev.items : [])
    .filter((i) => i && COLLECTION_KINDS.includes(i.kind) && typeof i.id === 'string' && i.id.length <= 80)
    .map((i) => ({ kind: i.kind, id: i.id }))
    .slice(0, 5000);
  return { name, color, description: String(raw.description ?? prev.description ?? '').slice(0, 500), items };
};

export function createCollections({ dataDir }) {
  const file = createJsonFile(join(dataDir, 'collections.json'), []);
  const api = {
    async list() {
      return (await file.get()).slice().sort((a, b) => a.name.localeCompare(b.name));
    },
    async get(id) {
      const c = (await file.get()).find((x) => x.id === id);
      if (!c) throw new CatalogError(`No collection ${id}`, 404);
      return c;
    },
    async add(raw) {
      const now = new Date().toISOString();
      const c = { id: `col-${randomBytes(4).toString('hex')}`, ...clean(raw), createdAt: now, updatedAt: now };
      await file.set([...(await file.get()), c]);
      return c;
    },
    async update(id, raw) {
      const cur = await api.get(id);
      const next = { ...cur, ...clean(raw, cur), updatedAt: new Date().toISOString() };
      await file.set((await file.get()).map((x) => (x.id === id ? next : x)));
      return next;
    },
    /** Add the item if it is not in the collection, else remove it. */
    async toggle(id, item) {
      const cur = await api.get(id);
      const has = cur.items.some((i) => i.kind === item.kind && i.id === item.id);
      return api.update(id, { items: has ? cur.items.filter((i) => !(i.kind === item.kind && i.id === item.id)) : [...cur.items, item] });
    },
    async remove(id) {
      await api.get(id);
      await file.set((await file.get()).filter((x) => x.id !== id));
    },
  };
  return api;
}
