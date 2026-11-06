// Preview thumbnails for the grid view.
//
// The browser renders a part once (it has the 3D engine), uploads a small PNG,
// and the server keeps it in <data>/thumbs/<app version>/<key>.png so every
// device and every later visit gets it instantly. The key is the same hash the
// server uses for a generation job: generator id + resolved parameters. A new
// app version starts a fresh folder, so shapes changed by an update re-render.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getGenerator, migrateInput } from './registry.js';
import { resolveParams } from './params.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const MAX_THUMB_BYTES = 300 * 1024;

/** Key of a generation job (also used by the server for STL / ZIP downloads). */
export function jobKey(id, params, extraA = '', extraB = '') {
  return createHash('sha256').update(JSON.stringify([id, params, extraA, extraB])).digest('hex').slice(0, 16);
}

export function createThumbStore({ dataDir, version }) {
  const dir = join(dataDir, 'thumbs', String(version).replace(/[^0-9a-z.-]/gi, '_'));
  const file = (key) => join(dir, `${key}.png`);
  const exists = (key) => access(file(key)).then(() => true, () => false);

  return {
    /** [{ generator, params }] -> [{ key, url | null }] (url null = not rendered yet). */
    async lookup(items) {
      const out = [];
      for (const it of items.slice(0, 500)) {
        try {
          const g = getGenerator(String(it.generator));
          const params = resolveParams(g.params, migrateInput(g, it.params ?? {}));
          const key = jobKey(g.id, params);
          out.push({ key, url: (await exists(key)) ? `/api/thumbs/${key}.png` : null });
        } catch (err) {
          out.push({ key: null, url: null, error: err.message });
        }
      }
      return out;
    },
    async put(key, png) {
      if (!/^[a-f0-9]{16}$/.test(key)) throw Object.assign(new Error('Bad thumbnail key'), { status: 400 });
      if (png.length > MAX_THUMB_BYTES) throw Object.assign(new Error('Thumbnail too large'), { status: 413 });
      if (!png.subarray(0, 8).equals(PNG_MAGIC)) throw Object.assign(new Error('Thumbnail must be a PNG'), { status: 400 });
      await mkdir(dir, { recursive: true });
      await writeFile(file(key), png);
      return { key, url: `/api/thumbs/${key}.png` };
    },
    /** True when a PNG for this key exists (library STLs use jobKey('library', id)). */
    exists: (key) => (/^[a-f0-9]{16}$/.test(key) ? exists(key) : Promise.resolve(false)),
    /** Delete every cached preview for this app version (they re-render on demand). */
    async clear() {
      await rm(dir, { recursive: true, force: true });
    },
    async get(key) {
      if (!/^[a-f0-9]{16}$/.test(key)) return null;
      return readFile(file(key)).catch(() => null);
    },
  };
}
