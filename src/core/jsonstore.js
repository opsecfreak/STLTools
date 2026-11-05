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
      writing = writing.then(async () => {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n');
        await rename(`${file}.tmp`, file);
      });
      await writing;
      return value;
    },
  };
}

function structuredCloneSafe(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}
