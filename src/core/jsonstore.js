// Small JSON file store used for projects and favorites (designs and the shop
// catalog have their own, older stores with the same behavior).
// Writes go to a temp file and are renamed into place, one at a time, so a
// crash or two quick saves never leave a half-written file.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function createJsonFile(file, fallback) {
  let value;
  let loaded = false;
  let writing = Promise.resolve();
  return {
    async get() {
      if (!loaded) {
        try {
          value = JSON.parse(await readFile(file, 'utf8'));
        } catch (err) {
          if (err.code !== 'ENOENT') throw new Error(`Cannot read ${file}: ${err.message}`);
          value = structuredCloneSafe(fallback);
        }
        loaded = true;
      }
      return value;
    },
    async set(next) {
      value = next;
      loaded = true;
      // a failed write must not block every later one: chain on the settled promise
      writing = writing.catch(() => {}).then(() => writeJsonAtomic(file, value));
      await writing;
      return value;
    },
  };
}

/**
 * Write JSON to a temp file and rename it into place. On Windows the rename can fail for a
 * moment (EPERM / EACCES / EBUSY) while an indexer, antivirus or another reader holds the
 * file: retry a few times before giving up.
 */
export async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
  for (let i = 0; ; i++) {
    try { await rename(tmp, file); return; } catch (err) {
      if (i >= 6 || !['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) throw err;
      await new Promise((ok) => setTimeout(ok, 40 * 2 ** i));
    }
  }
}

function structuredCloneSafe(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}
