// Saved designs ("My Designs"): a named generator + parameter set you can load,
// tweak and regenerate. Stored as JSON in the data directory next to the shop
// catalog (designs.json). Back the data folder up.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getGenerator, migrateInput } from './registry.js';
import { resolveParams } from './params.js';
import { CatalogError } from './catalog.js';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SECTIONS = ['shop', 'planes', 'quads', 'accessories', 'robotics'];

export function createDesignStore({ dataDir = process.env.STLTOOLS_DATA ?? join(ROOT, 'data') } = {}) {
  const file = join(dataDir, 'designs.json');
  let items = null;
  let writing = Promise.resolve();

  async function load() {
    if (!items) {
      try {
        items = JSON.parse(await readFile(file, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') throw new Error(`Cannot read ${file}: ${err.message}`);
        items = [];
      }
    }
    return items;
  }

  function save() {
    writing = writing.then(async () => {
      await mkdir(dataDir, { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(items, null, 2) + '\n');
      await rename(`${file}.tmp`, file);
    });
    return writing;
  }

  function validate(input) {
    let g;
    try {
      g = getGenerator(String(input.generator ?? ''));
    } catch (err) {
      throw new CatalogError(err.message);
    }
    let params;
    try {
      params = resolveParams(g.params, migrateInput(g, input.params ?? {}));
    } catch (err) {
      throw new CatalogError(err.message);
    }
    const name = String(input.name ?? '').trim();
    if (!name) throw new CatalogError('Name is required');
    if (name.length > 80) throw new CatalogError('Name is longer than 80 characters');
    const sections = g.sections ?? ['shop'];
    const section = SECTIONS.includes(input.section) ? input.section : sections[0];
    return { name, generator: g.id, params, section, presetId: input.presetId ? String(input.presetId) : null, notes: String(input.notes ?? '').slice(0, 1000) };
  }

  return {
    async list() {
      return (await load()).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async get(id) {
      const d = (await load()).find((x) => x.id === id);
      if (!d) throw new CatalogError(`No saved design ${id}`, 404);
      return d;
    },
    async add(input) {
      const list = await load();
      const v = validate(input);
      const slug = v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'design';
      const now = new Date().toISOString();
      const d = { id: `${slug}-${randomBytes(3).toString('hex')}`, ...v, createdAt: now, updatedAt: now };
      list.push(d);
      await save();
      return d;
    },
    async update(id, patch) {
      const list = await load();
      const cur = await this.get(id);
      const v = validate({ ...cur, ...patch });
      const next = { ...cur, ...v, updatedAt: new Date().toISOString() };
      list[list.indexOf(cur)] = next;
      await save();
      return next;
    },
    async remove(id) {
      const list = await load();
      list.splice(list.indexOf(await this.get(id)), 1);
      await save();
    },
  };
}
