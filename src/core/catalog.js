// Shop catalog: categories + items (one item = one bin / holder / rack in the shop).
//
// Each item gets a code like PRP-003 (category code + number). The code and the
// item name go on the label. Data is stored as JSON in the data directory
// (STLTOOLS_DATA env, default ./data). Back it up or keep it in Git.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPreset } from './presets.js';
import { getGenerator, generate, migrateInput } from './registry.js';
import { resolveParams } from './params.js';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const DEFAULT_CATEGORIES = [
  { code: 'PRP', name: 'Props', color: '#2f81f7' },
  { code: 'MOT', name: 'Motors', color: '#d29922' },
  { code: 'ESC', name: 'ESCs and flight controllers', color: '#8957e5' },
  { code: 'BAT', name: 'Batteries and charging', color: '#cf222e' },
  { code: 'CON', name: 'Connectors and wire', color: '#bf8700' },
  { code: 'FAS', name: 'Fasteners', color: '#57606a' },
  { code: 'FRM', name: 'Frames and arms', color: '#1a7f37' },
  { code: 'CAM', name: 'Cameras and VTX', color: '#0969da' },
  { code: 'RAD', name: 'Radios, receivers, antennas', color: '#bc4c00' },
  { code: 'GPS', name: 'GPS and sensors', color: '#1b7c83' },
  { code: 'GMB', name: 'Gimbal and camera repair', color: '#a40e26' },
  { code: 'ELE', name: 'Electronic components', color: '#6639ba' },
  { code: 'TLS', name: 'Tools', color: '#424a53' },
  { code: 'CHM', name: 'Glue, tape, chemicals', color: '#9a6700' },
  { code: 'MSC', name: 'Misc', color: '#6e7781' },
];

const CODE_RE = /^[A-Z0-9]{2,5}$/;

export class CatalogError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function createCatalog({ dataDir = process.env.STLTOOLS_DATA ?? join(ROOT, 'data') } = {}) {
  const files = { categories: join(dataDir, 'categories.json'), items: join(dataDir, 'catalog.json') };
  let state = null;
  let writing = Promise.resolve();

  async function readJson(file, fallback) {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw new Error(`Cannot read ${file}: ${err.message}`);
    }
  }

  async function load() {
    if (!state) {
      state = {
        categories: await readJson(files.categories, DEFAULT_CATEGORIES),
        items: await readJson(files.items, []),
      };
    }
    return state;
  }

  // Write to a temp file, then rename, so a crash never leaves half a file.
  function save(which) {
    writing = writing.then(async () => {
      await mkdir(dataDir, { recursive: true });
      const tmp = `${files[which]}.tmp`;
      await writeFile(tmp, JSON.stringify(state[which], null, 2) + '\n');
      await rename(tmp, files[which]);
    });
    return writing;
  }

  function cleanText(v, field, max) {
    const s = String(v ?? '').trim();
    if (s.length > max) throw new CatalogError(`${field} is longer than ${max} characters`);
    return s;
  }

  function checkPreset(presetId) {
    try {
      return getPreset(presetId);
    } catch (err) {
      throw new CatalogError(err.message);
    }
  }

  return {
    dataDir,

    async categories() {
      return (await load()).categories;
    },

    async setCategories(list) {
      const s = await load();
      if (!Array.isArray(list) || !list.length) throw new CatalogError('Categories must be a non-empty list');
      const seen = new Set();
      const clean = list.map((c) => {
        const code = String(c.code ?? '').trim().toUpperCase();
        if (!CODE_RE.test(code)) throw new CatalogError(`Category code "${code}" must be 2-5 letters or digits`);
        if (seen.has(code)) throw new CatalogError(`Duplicate category code ${code}`);
        seen.add(code);
        const color = /^#[0-9a-fA-F]{6}$/.test(c.color ?? '') ? c.color : '#6e7781';
        return { code, name: cleanText(c.name, 'Category name', 40) || code, color };
      });
      const used = new Set(s.items.map((i) => i.category));
      for (const code of used) {
        if (!seen.has(code)) throw new CatalogError(`Category ${code} still has items. Move or delete them first.`);
      }
      s.categories = clean;
      await save('categories');
      return clean;
    },

    async items() {
      return (await load()).items;
    },

    async get(code) {
      const item = (await load()).items.find((i) => i.code === code);
      if (!item) throw new CatalogError(`No catalog item ${code}`, 404);
      return item;
    },

    async add(input) {
      const s = await load();
      const category = String(input.category ?? '').toUpperCase();
      if (!s.categories.some((c) => c.code === category)) throw new CatalogError(`Unknown category "${category}"`);
      const name = cleanText(input.name, 'Name', 40);
      if (!name) throw new CatalogError('Name is required');
      checkPreset(input.presetId);
      const used = s.items.filter((i) => i.category === category).map((i) => Number(i.code.split('-').pop()));
      const next = (used.length ? Math.max(...used) : 0) + 1;
      const now = new Date().toISOString();
      const item = {
        code: `${category}-${String(next).padStart(3, '0')}`,
        category,
        name,
        location: cleanText(input.location, 'Location', 24),
        presetId: input.presetId,
        overrides: input.overrides && typeof input.overrides === 'object' ? input.overrides : {},
        notes: cleanText(input.notes, 'Notes', 500),
        createdAt: now,
        updatedAt: now,
      };
      await this.resolve(item); // validates overrides against the generator
      s.items.push(item);
      await save('items');
      return item;
    },

    async update(code, patch) {
      const s = await load();
      const item = await this.get(code);
      const next = { ...item };
      if ('name' in patch) next.name = cleanText(patch.name, 'Name', 40);
      if (!next.name) throw new CatalogError('Name is required');
      if ('location' in patch) next.location = cleanText(patch.location, 'Location', 24);
      if ('notes' in patch) next.notes = cleanText(patch.notes, 'Notes', 500);
      if ('presetId' in patch) { checkPreset(patch.presetId); next.presetId = patch.presetId; }
      if ('overrides' in patch) next.overrides = patch.overrides && typeof patch.overrides === 'object' ? patch.overrides : {};
      if ('presetId' in patch || 'overrides' in patch) delete next.labelCard; // size may change; refreshed on next generate
      next.updatedAt = new Date().toISOString();
      await this.resolve(next);
      s.items[s.items.indexOf(item)] = next;
      await save('items');
      return next;
    },

    async remove(code) {
      const s = await load();
      const item = await this.get(code);
      s.items.splice(s.items.indexOf(item), 1);
      await save('items');
    },

    /** Label lines for an item: name, then code and location. */
    labelLines(item) {
      return [item.name, item.location ? `${item.code} / ${item.location}` : item.code];
    },

    /** Generator id + params for an item: preset params, then overrides, then label text. */
    async resolve(item) {
      const preset = checkPreset(item.presetId);
      const g = getGenerator(preset.generator);
      const params = migrateInput(g, { ...preset.params, ...item.overrides });
      const [line1, line2] = this.labelLines(item);
      if ('labelText' in g.params) { params.labelText = line1; params.labelLine2 = line2; }
      if (g.id === 'label-card') { params.text = line1; params.line2 = line2; }
      try {
        resolveParams(g.params, params);
      } catch (err) {
        throw new CatalogError(err.message);
      }
      return { generator: g.id, params };
    },

    /** Generate the item's part(s), plus a matching label card when it has a card slot. */
    async generate(code) {
      const item = await this.get(code);
      const { generator, params } = await this.resolve(item);
      let result;
      try {
        result = await generate(generator, params);
      } catch (err) {
        throw new CatalogError(err.message, 422);
      }
      const card = result.meta?.labelCard;
      if (card) {
        // Remember the card size so paper labels print at the slot size.
        if (item.labelCard?.width !== card.width || item.labelCard?.height !== card.height) {
          item.labelCard = card;
          await save('items');
        }
        const [line1, line2] = this.labelLines(item);
        const cardResult = await generate('label-card', { width: card.width, height: card.height, text: line1, line2 });
        result.parts.push(...cardResult.parts.map((p) => ({ ...p, name: 'label-card' })));
        result.notes.push(...cardResult.notes);
      }
      return { ...result, item };
    },
  };
}
