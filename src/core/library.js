// STL library: STL files you import (from Thingiverse, Printables, your CAD,
// an old project) stored on the server so every device can view them, add
// them to projects, estimate print time and download them again.
//
// Storage:  <data>/library.json        index (name, folder, tags, notes, stats)
//           <data>/library/<id>.stl    the file, exactly as uploaded
// Accepts binary and ASCII STL. Other formats (3MF, OBJ, STEP) are refused with
// a clear message; convert them in your slicer or CAD first.
//
// Stats (size, volume, surface area) are computed once on upload with the same
// meshStats() used for generated parts, so print estimates work the same way.

import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createJsonFile } from './jsonstore.js';
import { CatalogError } from './catalog.js';
import { meshStats } from './export.js';

export const MAX_STL_BYTES = 100 * 1024 * 1024;
const ID = /^stl-[a-f0-9]{8}$/;

/** Parse binary or ASCII STL into a triangle soup { positions: Float32Array, indices: Uint32Array }. */
export function parseStl(buf) {
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    if (84 + n * 50 === buf.length && n > 0) {
      const positions = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12; // skip the normal
        for (let j = 0; j < 9; j++) positions[i * 9 + j] = buf.readFloatLE(o + j * 4);
      }
      return soup(positions);
    }
  }
  const head = buf.subarray(0, 512).toString('latin1').trimStart();
  if (head.startsWith('solid')) {
    const text = buf.toString('latin1');
    const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
    const v = [];
    let m;
    while ((m = re.exec(text))) v.push(Number(m[1]), Number(m[2]), Number(m[3]));
    if (v.length >= 9 && v.length % 9 === 0 && v.every(Number.isFinite)) return soup(Float32Array.from(v));
  }
  throw new CatalogError('Not an STL file (binary or ASCII). Export STL from your CAD or slicer; 3MF / OBJ / STEP are not supported yet.');
}

function soup(positions) {
  const indices = new Uint32Array(positions.length / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions, indices };
}

const text = (v, field, max) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new CatalogError(`${field} is longer than ${max} characters`);
  return s;
};

export function createLibrary({ dataDir }) {
  const index = createJsonFile(join(dataDir, 'library.json'), []);
  const dir = join(dataDir, 'library');
  const path = (id) => join(dir, `${id}.stl`);

  const api = {
    async list() {
      return (await index.get()).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async get(id) {
      const e = (await index.get()).find((x) => x.id === id);
      if (!e) throw new CatalogError(`No STL ${id} in the library`, 404);
      return e;
    },
    async file(id) {
      if (!ID.test(id)) throw new CatalogError('Bad STL id', 400);
      await api.get(id);
      return readFile(path(id));
    },
    /** Store an uploaded STL. meta: { filename, name?, folder?, tags?, notes? } */
    async add(data, meta = {}) {
      if (!data?.length) throw new CatalogError('Empty file');
      if (data.length > MAX_STL_BYTES) throw new CatalogError(`File is larger than ${MAX_STL_BYTES / 1048576} MB`, 413);
      const filename = text(meta.filename, 'File name', 200).replace(/[\\/]/g, '_') || 'part.stl';
      if (!/\.stl$/i.test(filename)) throw new CatalogError('Only .stl files can be imported here');
      const mesh = parseStl(data);
      const stats = meshStats(mesh);
      if (!(stats.volumeMm3 > 0)) stats.volumeMm3 = Math.abs(stats.volumeMm3); // inside-out files still estimate
      const now = new Date().toISOString();
      const e = {
        id: `stl-${randomBytes(4).toString('hex')}`,
        name: text(meta.name, 'Name', 80) || filename.replace(/\.stl$/i, ''),
        filename,
        folder: text(meta.folder, 'Folder', 60),
        tags: (Array.isArray(meta.tags) ? meta.tags : String(meta.tags ?? '').split(',')).map((t) => text(t, 'Tag', 30).toLowerCase()).filter(Boolean).slice(0, 20),
        notes: text(meta.notes, 'Notes', 1000),
        bytes: data.length,
        stats,
        createdAt: now,
        updatedAt: now,
      };
      await mkdir(dir, { recursive: true });
      await writeFile(path(e.id), data);
      await index.set([...(await index.get()), e]);
      return e;
    },
    async update(id, raw) {
      const cur = await api.get(id);
      const next = {
        ...cur,
        name: raw.name !== undefined ? text(raw.name, 'Name', 80) || cur.name : cur.name,
        folder: raw.folder !== undefined ? text(raw.folder, 'Folder', 60) : cur.folder,
        tags: raw.tags !== undefined ? (Array.isArray(raw.tags) ? raw.tags : String(raw.tags).split(',')).map((t) => text(t, 'Tag', 30).toLowerCase()).filter(Boolean).slice(0, 20) : cur.tags,
        notes: raw.notes !== undefined ? text(raw.notes, 'Notes', 1000) : cur.notes,
        updatedAt: new Date().toISOString(),
      };
      await index.set((await index.get()).map((x) => (x.id === id ? next : x)));
      return next;
    },
    async remove(id) {
      await api.get(id);
      await index.set((await index.get()).filter((x) => x.id !== id));
      await rm(path(id), { force: true });
    },
    isId: (id) => ID.test(String(id)),
  };
  return api;
}
