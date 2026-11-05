// Generator registry with auto-discovery.
//
// Every .js file in src/generators/ is loaded at startup; every exported object
// that has { id, params, generate } is a generator. Your own generators go in
// custom/generators/ (or $STLTOOLS_CUSTOM/generators/) and load the same way.
// A broken custom file is skipped and reported (GET /api/version), so it can
// never take the app down. Core files must load cleanly (tests enforce it).

import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveParams } from './params.js';
import { initKernel, createScope, toPlainMesh, teardrop, regularPolygon } from './kernel.js';
import * as hardware from './hardware.js';
import * as labels from './labels.js';
import * as mounts from './mounts.js';

/**
 * Helpers passed to every generate() as the third argument, so custom
 * generators (which may live outside the app folder) can use them without
 * import paths: generate(p, k, lib) => lib.hardware.bolt('M3'), lib.teardrop(...)
 */
export const LIB = Object.freeze({ hardware, labels, mounts, teardrop, regularPolygon });

export const SECTION_IDS = ['shop', 'planes', 'quads', 'accessories', 'robotics'];
export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const CUSTOM_DIRS = [join(ROOT, 'custom'), process.env.STLTOOLS_CUSTOM].filter(Boolean);

const loadIssues = [];
const isGenerator = (v) => v && typeof v === 'object' && typeof v.id === 'string' && typeof v.generate === 'function' && v.params && typeof v.params === 'object';

async function loadDir(dir, strict) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const file of readdirSync(dir).filter((f) => (f.endsWith('.js') || f.endsWith('.mjs')) && !f.startsWith('_')).sort()) {
    try {
      const mod = await import(pathToFileURL(join(dir, file)).href);
      for (const v of Object.values(mod)) if (isGenerator(v)) found.push({ g: v, file: join(dir, file) });
    } catch (err) {
      if (strict) throw new Error(`Generator file ${file} failed to load: ${err.message}`);
      loadIssues.push(`${join(dir, file)}: ${err.message}`);
      console.warn(`[stltools] skipped generator file ${file}: ${err.message}`);
    }
  }
  return found;
}

const byId = new Map();
const add = ({ g, file }, strict) => {
  if (byId.has(g.id)) {
    if (byId.get(g.id) === g) return;
    const msg = `duplicate generator id "${g.id}" in ${file}`;
    if (strict) throw new Error(msg);
    loadIssues.push(msg);
    return;
  }
  byId.set(g.id, g);
};
for (const item of await loadDir(join(ROOT, 'src', 'generators'), true)) add(item, true);
for (const dir of CUSTOM_DIRS) for (const item of await loadDir(join(dir, 'generators'), false)) add(item, false);

// Tab order first, then the order files were found in.
const GENERATORS = [...byId.values()].sort((a, b) => SECTION_IDS.indexOf((a.sections ?? ['shop'])[0]) - SECTION_IDS.indexOf((b.sections ?? ['shop'])[0]));

/** Problems found while loading custom generators (empty when all is well). */
export function registryIssues() {
  return [...loadIssues];
}

export function listGenerators() {
  return GENERATORS.map(({ id, name, description, params, sections }) => ({ id, name, description, params, sections: sections ?? ['shop'] }));
}

export function getGenerator(id) {
  const g = byId.get(id);
  if (!g) throw new Error(`Unknown generator "${id}". Available: ${[...byId.keys()].join(', ')}`);
  return g;
}

/** Convert parameter names from older versions (saved files, presets, catalog). */
export function migrateInput(g, input = {}) {
  return typeof g.migrate === 'function' ? g.migrate(input) : input;
}

/**
 * Validate input and run a generator.
 * Each part comes back as a plain mesh { positions, indices }, ready for toStl().
 * @returns {Promise<{ id, params, parts: Array<{name, mesh}>, warnings: string[], notes: string[] }>}
 */
export async function generate(id, input = {}) {
  const g = getGenerator(id);
  const params = resolveParams(g.params, migrateInput(g, input));
  await initKernel();
  const k = createScope();
  try {
    const result = g.generate(params, k, LIB);
    const parts = result.parts.map(({ name, manifold }) => ({ name, mesh: toPlainMesh(manifold) }));
    return { id, params, parts, warnings: result.warnings ?? [], notes: result.notes ?? [], meta: result.meta ?? {} };
  } finally {
    k.free();
  }
}
