// Preset library: ready-made designs stored as JSON in /presets.
// Each preset names a generator and the parameters that differ from its defaults.
// Add or edit presets by editing the JSON files; they load at startup.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGenerator, migrateInput } from './registry.js';
import { resolveParams } from './params.js';

const PRESET_DIR = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'presets');

let cache = null;

function load() {
  const presets = [];
  const seen = new Set();
  const files = readdirSync(PRESET_DIR).filter((f) => f.endsWith('.json')).sort();
  for (const file of files) {
    const data = JSON.parse(readFileSync(join(PRESET_DIR, file), 'utf8'));
    for (const p of data.presets) {
      if (seen.has(p.id)) throw new Error(`Duplicate preset id "${p.id}" in ${file}`);
      seen.add(p.id);
      const g = getGenerator(p.generator);
      try {
        p.params = migrateInput(g, p.params);
        resolveParams(g.params, p.params);
      } catch (err) {
        throw new Error(`Preset "${p.id}" in ${file}: ${err.message}`);
      }
      presets.push({ ...p, group: data.group, section: p.section ?? data.section ?? 'shop', tags: p.tags ?? [] });
    }
  }
  return presets;
}

export function listPresets() {
  if (!cache) cache = load();
  return cache;
}

export function getPreset(id) {
  const p = listPresets().find((x) => x.id === id);
  if (!p) throw new Error(`Unknown preset "${id}". Run "stltools presets" to list them.`);
  return p;
}

/** Reload from disk (after editing preset files while the server runs). */
export function reloadPresets() {
  cache = null;
  return listPresets();
}
