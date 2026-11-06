// Printer profiles: bed size and speeds used for print time estimates and the
// build plate outline in the 3D view.
//
// Where they come from (first id wins, later duplicates are skipped):
//   printer-profiles/*.json             shipped with the app (strict: a bad file fails the tests)
//   custom/printer-profiles/*.json      your own, next to the app
//   $STLTOOLS_CUSTOM/printer-profiles/  your own, in the per-user data folder (desktop app)
// Custom files are lenient: a bad one is skipped and listed in /api/version issues.
//
// Add a profile: copy printer-profiles/generic-klipper-fast.json, change id/name/bed/speeds.
// To share it with everyone, open a pull request: docs/PRINTER-PROFILES.md.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, CUSTOM_DIRS } from './registry.js';

const SPEED_KEYS = ['outerWall', 'innerWall', 'infill', 'topBottom', 'firstLayer', 'travel'];
let cache = null;
let issues = [];

const between = (v, lo, hi, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${name} must be a number from ${lo} to ${hi}`);
  return v;
};

/** Check one profile object. Throws with a readable message. Returns the cleaned profile. */
export function validateProfile(p) {
  if (!p || typeof p !== 'object') throw new Error('profile must be an object');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(p.id ?? '')) throw new Error('id must be 2-41 lowercase letters, digits or dashes');
  if (!p.name || typeof p.name !== 'string') throw new Error('name is required');
  const bed = p.bed ?? {};
  between(bed.x, 20, 2000, 'bed.x');
  between(bed.y, 20, 2000, 'bed.y');
  between(bed.z, 10, 2000, 'bed.z');
  between(p.nozzle ?? 0.4, 0.1, 2, 'nozzle');
  between(p.filamentDiameter ?? 1.75, 1, 3.5, 'filamentDiameter');
  for (const k of SPEED_KEYS) if (p.speeds?.[k] !== undefined) between(p.speeds[k], 1, 2000, `speeds.${k}`);
  if (p.maxVolumetricFlow !== undefined) between(p.maxVolumetricFlow, 1, 100, 'maxVolumetricFlow');
  if (p.motionEfficiency !== undefined) between(p.motionEfficiency, 0.2, 1, 'motionEfficiency');
  if (p.layerOverheadSeconds !== undefined) between(p.layerOverheadSeconds, 0, 60, 'layerOverheadSeconds');
  if (p.heatUpSeconds !== undefined) between(p.heatUpSeconds, 0, 3600, 'heatUpSeconds');
  return { firmware: 'klipper', verified: false, notes: '', sources: [], ...p, bed: { x: bed.x, y: bed.y, z: bed.z } };
}

function loadDir(dir, strict, out, seen) {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      for (const p of Array.isArray(raw) ? raw : [raw]) {
        const clean = validateProfile(p);
        if (seen.has(clean.id)) throw new Error(`duplicate profile id "${clean.id}"`);
        seen.add(clean.id);
        out.push({ ...clean, custom: !strict });
      }
    } catch (err) {
      const msg = `Printer profile ${file}: ${err.message}`;
      if (strict) throw new Error(msg);
      issues.push(msg);
      console.warn(`[stltools] ${msg}`);
    }
  }
}

export function listProfiles() {
  if (!cache) {
    issues = [];
    const out = [];
    const seen = new Set();
    loadDir(join(ROOT, 'printer-profiles'), true, out, seen);
    for (const dir of CUSTOM_DIRS) loadDir(join(dir, 'printer-profiles'), false, out, seen);
    // named printers first (Sovol SV07...), generic starting points last
    cache = out.sort((a, b) => (a.maker === 'Generic') - (b.maker === 'Generic') || a.name.localeCompare(b.name));
  }
  return cache;
}

export function getProfile(id) {
  return listProfiles().find((p) => p.id === id) ?? null;
}

export function profileIssues() {
  listProfiles();
  return [...issues];
}
