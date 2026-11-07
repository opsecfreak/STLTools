// Materials for the Stress Lab: shipped datasheet entries (materials/filaments.json)
// plus the user's own materials in <data>/materials.json (custom filaments, measured
// test results, tuned physics values). Shipped entries are read-only; a user entry
// with the same id overrides it.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createJsonFile } from './jsonstore.js';
import { CatalogError } from './catalog.js';

const NUM = ['density', 'hdt045', 'hdt18', 'tg', 'vicat', 'poisson', 'uvRetainedPerYear', 'fatigueSf', 'fatigueB', 'costPerKg'];
const PAIRS = ['tensile', 'modulus', 'elongation', 'flexStrength', 'flexModulus'];

export function loadShipped(root) {
  const f = join(root, 'materials', 'filaments.json');
  if (!existsSync(f)) return [];
  return JSON.parse(readFileSync(f, 'utf8')).materials.map((m) => ({ ...m, shipped: true }));
}

function clean(input, id) {
  const m = { id, brand: String(input.brand ?? 'Custom').slice(0, 60), product: String(input.product ?? '').slice(0, 80) || 'Custom material', type: String(input.type ?? 'PLA').slice(0, 20) };
  for (const k of NUM) {
    if (input[k] === undefined || input[k] === null || input[k] === '') continue;
    const v = Number(input[k]);
    if (!Number.isFinite(v)) throw new CatalogError(`${k} must be a number`);
    m[k] = v;
  }
  for (const k of PAIRS) {
    if (!input[k]) continue;
    const out = {};
    for (const d of ['xy', 'z', 'any']) {
      const v = input[k][d];
      if (v === undefined || v === null || v === '') continue;
      const n = Number(v);
      if (!(n > 0 && n < 100000)) throw new CatalogError(`${k}.${d} must be a positive number`);
      out[d] = n;
    }
    if (Object.keys(out).length) m[k] = out;
  }
  m.notes = String(input.notes ?? '').slice(0, 2000);
  m.source = { doc: String(input.source?.doc ?? 'Entered by the user').slice(0, 200), url: String(input.source?.url ?? '').slice(0, 400) };
  return m;
}

export function createMaterials({ dataDir, root }) {
  const file = createJsonFile(join(dataDir, 'materials.json'), []);
  const shipped = loadShipped(root);
  return {
    async list() {
      const mine = await file.get();
      const ids = new Set(mine.map((m) => m.id));
      return [...shipped.filter((m) => !ids.has(m.id)), ...mine.map((m) => ({ ...m, custom: true }))];
    },
    async add(input) {
      const list = await file.get();
      const id = input.id && /^[a-z0-9-]{3,60}$/.test(input.id) ? input.id : `mat-${randomBytes(3).toString('hex')}`;
      if (list.some((m) => m.id === id)) throw new CatalogError(`${id} exists`);
      const m = clean(input, id);
      await file.set([...list, m]);
      return { ...m, custom: true };
    },
    async update(id, input) {
      const list = await file.get();
      const base = list.find((m) => m.id === id) ?? shipped.find((m) => m.id === id);
      if (!base) throw new CatalogError(`No material ${id}`, 404);
      const m = clean({ ...base, ...input }, id);
      await file.set([...list.filter((x) => x.id !== id), m]);
      return { ...m, custom: true };
    },
    async remove(id) {
      const list = await file.get();
      if (!list.some((m) => m.id === id)) throw new CatalogError(`No custom material ${id} (datasheet entries cannot be deleted)`, 404);
      await file.set(list.filter((m) => m.id !== id));
    },
  };
}
