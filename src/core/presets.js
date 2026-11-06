// Preset library: ready-made designs stored as JSON in /presets.
// Each preset names a generator and the parameters that differ from its defaults.
// Add or edit presets by editing the JSON files; they load at startup.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getGenerator, migrateInput, ROOT, CUSTOM_DIRS, SECTION_IDS } from './registry.js';
import { resolveParams } from './params.js';

const PRESET_DIR = join(ROOT, 'presets');
let cache = null;
let issues = [];

// Core presets must be valid (a bad one stops the app, and the tests catch it first).
// Custom presets (custom/presets/, $STLTOOLS_CUSTOM/presets/) are skipped with a
// reported issue instead, so your own files can never break the app.
function loadDir(dir, strict, presets, seen) {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()) {
    const fail = (msg) => {
      if (strict) throw new Error(msg);
      issues.push(msg);
      console.warn(`[stltools] ${msg}`);
    };
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (err) {
      fail(`Preset file ${file}: ${err.message}`);
      continue;
    }
    for (const p of data.presets ?? []) {
      try {
        if (!p.id || !p.name || !p.generator) throw new Error('needs id, name and generator');
        if (seen.has(p.id)) throw new Error(`duplicate preset id "${p.id}"`);
        const g = getGenerator(p.generator);
        const params = migrateInput(g, p.params ?? {});
        resolveParams(g.params, params);
        // "verify": parameters the user must measure before printing (shown as a banner in the UI)
        if (p.verify !== undefined && (!Array.isArray(p.verify) || p.verify.some((k) => !g.params[k]))) throw new Error('verify must list parameter names of its generator');
        // "measure": sizes nobody has measured yet. The preset leaves them out and the UI keeps
        // the fields empty and blocks Generate until you type them (never invented values).
        if (p.measure !== undefined) {
          if (!Array.isArray(p.measure) || p.measure.some((k) => !g.params[k] || !['number', 'integer'].includes(g.params[k].type))) throw new Error('measure must list number parameters of its generator');
          if (p.measure.some((k) => k in (p.params ?? {}))) throw new Error('measure fields must not have values in params');
        }
        // "component" links the preset to a part in My Parts (seed/mts-v1); "ownership" is the fallback
        if (p.ownership !== undefined && !['Owned', 'Confirm', 'Planned'].includes(p.ownership)) throw new Error('ownership must be Owned, Confirm or Planned');
        const section = p.section ?? data.section ?? (g.sections ?? ['shop'])[0];
        if (!SECTION_IDS.includes(section)) throw new Error(`unknown section "${section}"`);
        seen.add(p.id);
        presets.push({ ...p, params, group: p.group ?? data.group ?? 'My presets', section, tags: p.tags ?? [], custom: !strict });
      } catch (err) {
        fail(`Preset "${p.id ?? '?'}" in ${file}: ${err.message}`);
      }
    }
  }
}

function load() {
  issues = [];
  const presets = [];
  const seen = new Set();
  loadDir(PRESET_DIR, true, presets, seen);
  for (const dir of CUSTOM_DIRS) loadDir(join(dir, 'presets'), false, presets, seen);
  return presets;
}

/** Problems found in custom preset files (empty when all is well). */
export function presetIssues() {
  listPresets();
  return [...issues];
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
