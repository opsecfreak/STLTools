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

// Profiles imported in the app (<data>/printer-profiles.json), set by the server at start-up.
let userProfiles = [];
export function setUserProfiles(list) {
  userProfiles = [];
  for (const p of list ?? []) {
    try { userProfiles.push({ ...validateProfile(p), custom: true, imported: true }); } catch (err) { issues.push(`Imported profile ${p?.id}: ${err.message}`); }
  }
  cache = null;
}

export function listProfiles() {
  if (!cache) {
    issues = [];
    const out = [];
    const seen = new Set();
    loadDir(join(ROOT, 'printer-profiles'), true, out, seen);
    for (const dir of CUSTOM_DIRS) loadDir(join(dir, 'printer-profiles'), false, out, seen);
    for (const p of userProfiles) if (!seen.has(p.id)) { seen.add(p.id); out.push(p); }
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

/**
 * Build a printer profile from slicer settings you already use:
 *   format 'ini'  PrusaSlicer / SuperSlicer export (key = value lines, e.g. sv07-alex-v3.ini)
 *   format 'orca' OrcaSlicer JSON (machine, process or filament file; several can be merged by
 *                 importing one after another into the same id)
 * Only the values the file contains are taken; speeds given as % are skipped.
 * -> { profile, used: [key...], skipped: [key...] }
 */
export function profileFromSlicer({ format, text, id, name, base }) {
  const used = [], skipped = [];
  let kv = {};
  if (format === 'ini') {
    for (const line of String(text).split(/\r?\n/)) {
      const m = line.match(/^\s*([a-z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (m) kv[m[1]] = m[2];
    }
  } else if (format === 'orca') {
    const j = JSON.parse(text);
    for (const [k, v] of Object.entries(j)) kv[k] = Array.isArray(v) ? v[0] : v;
  } else throw new Error('format must be ini or orca');
  const num = (k) => {
    if (kv[k] === undefined) return undefined;
    const sv = String(kv[k]);
    if (sv.includes('%')) { skipped.push(`${k} (${sv}: percent)`); return undefined; }
    const v = Number(sv);
    if (!Number.isFinite(v) || v <= 0) { skipped.push(`${k} (${sv})`); return undefined; }
    used.push(k);
    return v;
  };
  const p = JSON.parse(JSON.stringify(base ?? { bed: {}, speeds: {} }));
  p.id = id; p.name = name; p.maker = p.maker ?? 'Imported'; p.speeds = { ...(p.speeds ?? {}) }; p.bed = { ...(p.bed ?? {}) };
  // bed: ini bed_shape "0x0,220x0,220x220,0x220", orca printable_area ["0x0","220x0",...]
  const shape = format === 'ini' ? kv.bed_shape : (() => { try { return JSON.parse(text).printable_area?.join(','); } catch { return undefined; } })();
  if (shape) {
    const pts = String(shape).split(',').map((xy) => xy.split('x').map(Number));
    if (pts.every((q) => q.length === 2 && q.every(Number.isFinite))) {
      p.bed.x = Math.max(...pts.map((q) => q[0])) - Math.min(...pts.map((q) => q[0]));
      p.bed.y = Math.max(...pts.map((q) => q[1])) - Math.min(...pts.map((q) => q[1]));
      used.push(format === 'ini' ? 'bed_shape' : 'printable_area');
    }
  }
  const map = format === 'ini'
    ? { z: 'max_print_height', nozzle: 'nozzle_diameter', filamentDiameter: 'filament_diameter', outerWall: 'external_perimeter_speed', innerWall: 'perimeter_speed', infill: 'infill_speed', topBottom: 'top_solid_infill_speed', firstLayer: 'first_layer_speed', travel: 'travel_speed', acceleration: 'default_acceleration', maxVolumetricFlow: 'max_volumetric_speed' }
    : { z: 'printable_height', nozzle: 'nozzle_diameter', filamentDiameter: 'filament_diameter', outerWall: 'outer_wall_speed', innerWall: 'inner_wall_speed', infill: 'sparse_infill_speed', topBottom: 'top_surface_speed', firstLayer: 'initial_layer_speed', travel: 'travel_speed', acceleration: 'default_acceleration', maxVolumetricFlow: 'filament_max_volumetric_speed' };
  for (const [field, key] of Object.entries(map)) {
    const v = num(key);
    if (v === undefined) continue;
    if (field === 'z') p.bed.z = v;
    else if (['outerWall', 'innerWall', 'infill', 'topBottom', 'firstLayer', 'travel'].includes(field)) p.speeds[field] = v;
    else p[field] = v;
  }
  p.verified = false;
  p.notes = `Imported from a ${format === 'ini' ? 'PrusaSlicer .ini' : 'OrcaSlicer JSON'} file: ${used.length} values taken. Motion efficiency and layer overhead are not in slicer files: calibrate with the time factor.`;
  p.sources = [`Imported ${new Date().toISOString().slice(0, 10)}: ${used.join(', ')}`];
  return { profile: validateProfile(p), used, skipped };
}
