#!/usr/bin/env node
// Web UI + JSON API. No framework: Node's built-in http module only.
//
//   GET  /                         web UI
//   GET  /api/generators           generator list with parameter schemas
//   POST /api/generate/:id         body: JSON params -> part list + stats + download URLs
//   GET  /api/stl/:job/:part.stl   binary STL for one part of a finished job
//   GET  /api/presets              preset library
//   GET  /api/categories           shop categories      PUT  replaces the list
//   GET  /api/catalog              shop items           POST adds one
//   PUT  /api/catalog/:code        edit an item         DELETE removes it
//   POST /api/catalog/:code/generate   item STL(s) with its label text + label card
//   GET  /api/designs              saved designs        POST saves one
//   GET/PUT/DELETE /api/designs/:id
//   GET  /api/zip/:job             all parts of a job as one ZIP
//   GET/POST /api/projects, GET/PUT/DELETE /api/projects/:id
//   POST /api/projects/:id/items   add a part        POST /api/projects/:id/build  ZIP of every part
//   GET  /api/favorites            POST /api/favorites/toggle { kind, id }
//   POST /api/thumbs/lookup        PUT /api/thumbs/:key (PNG)   GET /api/thumbs/:key.png
//   Printers (Klipper / Moonraker, VIEW ONLY + G-code upload that never starts a print):
//   GET/POST /api/printers, PUT/DELETE /api/printers/:id, POST /api/printers/probe, GET /api/printers/scan
//   GET /api/printers/:id/{status,files,history,webcams}   GET /api/printers/:id/metadata?filename=
//   GET /api/printers/:id/thumb?path=   GET /api/printers/:id/snapshot?cam=0   PUT /api/printers/:id/upload?filename=
//   POST /api/printers/diagnose { url, apiKey }   step-by-step connection test (read-only)
//   v6:
//   GET/PUT /api/settings   GET /api/settings/schema   POST /api/settings/reset { section }
//   GET /api/printer-profiles          POST /api/estimate { stats: [...], profile, opts, qty }
//   GET /api/library  PUT /api/library/upload?filename=&name=&folder=&tags=  (raw STL body)
//   GET/PUT/DELETE /api/library/:id    GET /api/library/:id.stl
//   GET /api/projects/:id/export       POST /api/projects/import (bundle JSON)
//   GET /api/backup                    DELETE /api/thumbs (clear preview cache)
//   GET /shared/estimate.js            the estimator, same file the server uses
//   v7:
//   GET /api/parts   POST /api/parts (add)   PUT/DELETE /api/parts/:id   POST /api/parts/import (components.json)
//   GET /api/parts/seeds   POST /api/parts/seed { set: "example" }  (parts + project ideas + assemblies)
//   1.0:
//   GET/POST /api/collections   PUT/DELETE /api/collections/:id   POST /api/collections/:id/toggle { kind, id }
//   1.1:
//   GET /api/hosting (mode, addresses, PIN on/off)   PUT /api/hosting/pin { pin, current }   POST /api/hosting/login { pin }
//   GET /api/estimate-targets (printers with their own Klipper limits + profiles)
//   GET /api/printers/:id/stream?cam=0 (live MJPEG)   GET /api/printers/:id/machine   POST /api/printers/check
//   GET /api/printers/:id/health   GET /api/printers/:id/config[?file=printer.cfg]   (read-only, secrets hidden)
//   Control (opt-in per printer, logged): GET/PUT /api/printers/:id/control  POST /api/printers/:id/control/<action>
//   GET /api/printers/:id/control/log   PUT /api/printers/:id/upload?...&print=1&confirm=1
// Full reference with request/response shapes: docs/API.md
//
// Env: HOST (default 127.0.0.1), PORT (default 3000), STLTOOLS_DATA (default ./data),
//      STLTOOLS_MODE / STLTOOLS_STOP_AT (set by bin/stltools-app.js: desktop, portable, temp, custom)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, listGenerators } from './core/registry.js';
import { ParamError } from './core/params.js';
import { toStl, meshStats } from './core/export.js';
import { toPlainMesh } from './core/kernel.js';
import { initKernel } from './core/kernel.js';
import { listPresets, presetIssues } from './core/presets.js';
import { registryIssues } from './core/registry.js';
import { createCatalog, CatalogError } from './core/catalog.js';
import { createDesignStore } from './core/designs.js';
import { createZip } from './core/zip.js';
import { createProjects, createFavorites } from './core/projects.js';
import { createThumbStore, jobKey } from './core/thumbs.js';
import { createPrinters, scanLan, MAX_UPLOAD_BYTES } from './core/printers.js';
import { createSettings } from './core/settings.js';
import { createLibrary, MAX_STL_BYTES } from './core/library.js';
import { listProfiles, getProfile, profileIssues } from './core/profiles.js';
import { estimateParts, formatDuration, profileFromMachine } from './core/estimate.js';
import { createHosting, isLoopback, lanUrls, boardModel, loginPage, COOKIE } from './core/hosting.js';
import { createParts, readSeed, fromComponents } from './core/parts.js';
import { createCollections } from './core/collections.js';
import { createMaterials } from './core/materials.js';
import { splitToFit, placeOnBed, arrange } from './core/split.js';
import { createScope } from './core/kernel.js';
import { parseStl } from './core/library.js';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
// EDITION.json marks a personal edition (branch mts-personal); the public release has none.
const EDITION = await readFile(join(ROOT, 'EDITION.json'), 'utf8').then(JSON.parse, () => ({ edition: 'public', name: 'Public' }));
const PUBLIC_DIR = join(ROOT, 'public');
const THREE_DIR = join(ROOT, 'node_modules', 'three');
const SEED_DIR = join(ROOT, 'seed');
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3000);
const MAX_BODY = 64 * 1024;
const MAX_JOBS = 50;
const MAX_IMPORT = 300 * 1024 * 1024; // project bundles carry base64 STLs

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

// Finished jobs, oldest evicted first. key -> { id, parts: Map(name -> Buffer) }
const jobs = new Map();

function remember(key, job) {
  jobs.delete(key);
  jobs.set(key, job);
  while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
}

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  let data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  const extra = {};
  // Large JSON (the preset list is over 1 MB) goes gzipped when the browser accepts it.
  if (!isBuf && data.length > 32 * 1024 && /\bgzip\b/.test(res.req?.headers['accept-encoding'] ?? '')) {
    data = gzipSync(data);
    extra['content-encoding'] = 'gzip';
    extra.vary = 'accept-encoding';
  }
  res.writeHead(status, {
    'content-type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...extra,
    ...headers,
  });
  res.end(data);
}

async function readBody(req, max = MAX_BODY) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Body must be JSON'), { status: 400 });
  }
}

async function readRaw(req, max) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'part';

/** Generate every part of a project into one downloadable ZIP job. */
async function buildProject(project, { onlyUnprinted = false } = {}) {
  const files = new Map();
  const lines = [`Project: ${project.name}`, project.description ? `\n${project.description}\n` : '', 'Parts (number, name, quantity to print):'];
  const errors = [];
  const allStats = [];
  const allQty = [];
  const partList = []; // one entry per STL: for the project's parts table and 3D assembly view
  let n = 0;
  for (const item of project.items) {
    n++;
    if (onlyUnprinted && item.printed) continue;
    const base = `${String(n).padStart(2, '0')}-${slug(item.name)}${item.qty > 1 ? `-x${item.qty}` : ''}`;
    try {
      const resolved = await projects.resolveItem(item);
      if (resolved.stl) {
        files.set(base, resolved.stl);
        allStats.push(resolved.entry.stats);
        allQty.push(item.qty);
        partList.push({ item: n - 1, uid: item.uid, name: item.name, file: base, stats: resolved.entry.stats, qty: item.qty });
      } else {
        const r = await generate(resolved.generator, resolved.params);
        for (const pt of r.parts) {
          const file = `${base}-${pt.name}`;
          const stats = meshStats(pt.mesh);
          files.set(file, toStl(pt.mesh, { name: file }));
          allStats.push(stats);
          allQty.push(item.qty * (pt.qty ?? 1));
          partList.push({ item: n - 1, uid: item.uid, name: r.parts.length > 1 ? `${item.name}: ${pt.name}` : item.name, file, stats, qty: item.qty * (pt.qty ?? 1), ...(pt.assembled ? { assembled: pt.assembled } : {}) });
        }
      }
      lines.push(`${n}. ${item.name}  x${item.qty}${item.printed ? '  (printed)' : ''}${item.note ? `  - ${item.note}` : ''}`);
    } catch (err) {
      errors.push(`${item.name}: ${err.message}`);
      lines.push(`${n}. ${item.name}  NOT BUILT: ${err.message}`);
    }
  }
  const est = await projectEstimate(allStats, allQty);
  if (est) {
    lines.push('', `Estimate on ${est.profile} (${est.settings}): about ${formatDuration(est.seconds)} printing, ${est.grams.toFixed(0)} g filament (${(est.filamentMm / 1000).toFixed(1)} m). Your slicer gives the real time.`, '', 'Per STL file (each, then x quantity):');
    partList.forEach((pt, i) => {
      const e = est.perPart[i];
      pt.estimate = e;
      lines.push(`  ${pt.file}.stl  x${pt.qty}: ${formatDuration(e.seconds)}, ${e.grams.toFixed(1)} g each; ${pt.stats.size.map((v) => v.toFixed(1)).join(' x ')} mm${e.fits ? '' : '  DOES NOT FIT THE BED'}`);
    });
  }
  const key = randomBytes(8).toString('hex');
  remember(key, { prefix: slug(project.name), files, extra: [{ name: 'README.txt', data: Buffer.from(lines.join('\n') + '\n') }] });
  const parts = partList.map((pt) => ({ ...pt, url: `/api/stl/${key}/${encodeURIComponent(pt.file)}.stl`, filename: `${slug(project.name)}-${pt.file}.stl` }));
  return { zip: `/api/zip/${key}`, files: files.size, errors, estimate: est, parts };
}

// ---------------------------------------------------------------- seed sets (v7)

// A seed's assemblies/<file>.md spec belongs to the print candidate whose `assembly`
// field names that file; specs without a candidate become their own projects.

/** "SEN01, MOT04 x2, PWR01-PWR06, BAT05/BAT06" -> [{ id, qty }] */
export function parseComponentRefs(s) {
  const out = [];
  for (const raw of String(s ?? '').split(',')) {
    const t = raw.trim();
    const qty = Number((t.match(/x\s*(\d+)/i) ?? [])[1] ?? 1);
    const range = t.match(/^([A-Z]{2,4})(\d{2})\s*-\s*\1?(\d{2})/);
    if (range) {
      for (let n = Number(range[2]); n <= Number(range[3]); n++) out.push({ id: `${range[1]}${String(n).padStart(2, '0')}`, qty });
      continue;
    }
    for (const id of t.match(/[A-Z]{2,4}\d{2,3}/g) ?? []) out.push({ id, qty });
  }
  return out;
}

/**
 * Load a seed set: parts into My Parts, print candidates as projects
 * (status idea / active, priority, linked parts), assembly specs as the notes
 * of their project with the source files listed as missing. Safe to repeat.
 */
async function loadSeed(set) {
  const { components, candidates, assemblies } = await readSeed(SEED_DIR, set);
  const partsResult = await parts.merge(fromComponents(components));
  const existing = new Set((await projects.list()).map((p) => p.source).filter(Boolean));
  const specs = new Map();
  const loose = [];
  for (const a of assemblies) {
    const owner = (candidates.items ?? []).find((c) => c.assembly === a.file);
    if (owner) specs.set(owner.id, a);
    else loose.push(a);
  }
  // Files named in the spec's "Source files" section. A line that names a .zip lists what is
  // inside it, so only the zip counts there. No file names: keep the sentence as the item.
  const missingFiles = (md) => {
    const sec = md.split(/^## /m).find((x) => /^Source files/i.test(x)) ?? '';
    const out = [];
    const anyNames = /`[^`]+\.(?:zip|stl|json|py|md|step|csv|pdf)`/i.test(sec);
    for (const line of sec.split('\n').slice(1)) {
      const names = [...line.matchAll(/`([^`]+\.(?:zip|stl|json|py|md|step|csv|pdf))`/gi)].map((x) => x[1]);
      const zips = names.filter((n) => /\.zip$/i.test(n));
      out.push(...(zips.length ? zips : names));
      if (!anyNames && /STEP|STL|zip/i.test(line) && line.trim().length > 10) out.push(line.replace(/^[-*\s]+/, '').trim().slice(0, 200));
    }
    return [...new Set(out)];
  };
  let created = 0, skipped = 0;
  for (const c of candidates.items ?? []) {
    const source = `seed:${set}:${c.id}`;
    if (existing.has(source)) { skipped++; continue; }
    const spec = specs.get(c.id);
    const info = [`What to print: ${c.what_to_print}`, c.notes ? `Notes: ${c.notes}` : '', `Status in the handoff: ${c.status}. Parts: ${c.components}.`].filter(Boolean).join('\n');
    await projects.add({
      name: spec ? (spec.text.match(/^# (.+)$/m) ?? [])[1] ?? c.title : c.title,
      description: spec ? `${spec.text.trim()}\n\n---\n${info}` : info,
      status: /^Exists/i.test(c.status) ? 'active' : 'idea',
      priority: (String(c.priority).toLowerCase().match(/high|medium|low/) ?? [''])[0],
      tags: ['mts', ...(spec ? ['assembly'] : ['print idea'])],
      components: parseComponentRefs(c.components),
      filesMissing: spec ? missingFiles(spec.text) : [],
      source,
    });
    created++;
  }
  for (const a of loose) {
    const source = `seed:${set}:assembly:${a.file}`;
    if (existing.has(source)) { skipped++; continue; }
    await projects.add({ name: (a.text.match(/^# (.+)$/m) ?? [])[1] ?? a.file, description: a.text.trim(), status: 'active', tags: ['mts', 'assembly'], filesMissing: missingFiles(a.text), source });
    created++;
  }
  await parts.markSeed(set);
  return { set, parts: partsResult, projects: { created, skipped } };
}

/** Profile for a saved printer: its model's profile, with the printer's own Klipper limits when known and allowed. */
function printerProfile(pr, cfg) {
  const base = getProfile(pr.model) ?? (pr.machine ? getProfile('generic-klipper-fast') ?? getProfile(cfg.print.profile) : null);
  if (!base) return null;
  return cfg.printers.useMachine && pr.machine ? profileFromMachine(base, pr.machine, pr.name) : base;
}

/** The printer profile estimates use: the default printer (with its own limits), else Settings > Print estimates. */
async function activeProfile(cfg) {
  const list = await printers.list().catch(() => []);
  const def = list.find((p) => p.id === cfg.printers.defaultPrinter) ?? null;
  return (def && printerProfile(def, cfg)) ?? getProfile(cfg.print.profile) ?? listProfiles()[0] ?? null;
}

/** What the estimate box can pick: saved printers first (own limits), then every profile. */
async function estimateTargets() {
  const cfg = await settings.get();
  const out = [];
  for (const pr of await printers.list().catch(() => [])) {
    const profile = printerProfile(pr, cfg);
    if (profile) out.push({ value: `printer:${pr.id}`, label: profile.fromMachine ? `${pr.name} (own limits)` : `${pr.name} (${profile.name})`, printerId: pr.id, profile });
  }
  for (const p of listProfiles()) out.push({ value: `profile:${p.id}`, label: p.name, profile: p });
  return out;
}

const RUN = { mode: process.env.STLTOOLS_MODE || (process.env.INVOCATION_ID ? 'service' : 'server'), stopAt: process.env.STLTOOLS_STOP_AT || null, host: HOST, port: PORT };

async function hostingStatus(req) {
  const port = req.socket.localPort ?? RUN.port;
  const lan = !['127.0.0.1', '::1', 'localhost'].includes(RUN.host);
  return {
    mode: RUN.mode,
    service: Boolean(process.env.INVOCATION_ID),
    host: RUN.host,
    port,
    lan,
    addresses: lan ? lanUrls(port) : [`http://127.0.0.1:${port}`],
    stopAt: RUN.stopAt,
    pin: await hosting.hasPin(),
    you: { local: isLoopback(req.socket.remoteAddress) },
    board: boardModel(),
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    dataDir: catalog.dataDir,
  };
}

const pinCookie = (token) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`;

async function projectEstimate(statsList, qty) {
  if (!statsList.length) return null;
  const cfg = await settings.get();
  const profile = await activeProfile(cfg);
  if (!profile) return null;
  const e = estimateParts(statsList, profile, { ...cfg.print, filamentCostPerKg: cfg.filament?.[cfg.print.material] ?? cfg.print.filamentCostPerKg }, qty);
  const perPart = e.parts.map((p) => ({ seconds: p.seconds, grams: p.grams, filamentMm: p.filamentMm, layers: p.layers, fits: p.fit.fits }));
  return { ...e, parts: undefined, perPart, profile: profile.name, settings: `${cfg.print.layerHeight} mm layers, ${cfg.print.walls} walls, ${cfg.print.infill}% infill, ${cfg.print.material.toUpperCase()}` };
}

/**
 * Split the parts of a generated job (or a library STL) to fit the printer, then pack
 * every piece (and the alignment pins) onto as few plates as possible.
 * -> { zip, pieces: [...], plates: [{ name, url, filename, count, estimate }], cuts, pins, bed, profile }
 */
async function splitAndArrange(b) {
  const cfg = await settings.get();
  const profile = b.profile ? getProfile(b.profile) : await activeProfile(cfg);
  if (!profile) throw new CatalogError('No printer profile');
  const bed = profile.bed;
  const margin = Math.max(0, Number(b.margin ?? 3));
  const spacing = Math.max(0, Number(b.spacing ?? 5));
  const joint = ['pins', 'filament', 'none'].includes(b.joint) ? b.joint : 'pins';
  const pinDiameter = Math.min(10, Math.max(2, Number(b.pinDiameter ?? 4)));
  const pinLength = Math.min(40, Math.max(4, Number(b.pinLength ?? 12)));
  const clearance = Math.min(1, Math.max(0, Number(b.clearance ?? 0.2)));
  const sources = [];
  if (b.library) {
    const e = await library.get(b.library);
    sources.push({ name: e.name, buf: await library.file(b.library), qty: 1 });
  } else {
    const job = jobs.get(String(b.job ?? ''));
    if (!job) throw new CatalogError('Generate the part again (the job expired)', 404);
    const want = Array.isArray(b.parts) && b.parts.length ? new Set(b.parts) : null;
    for (const [name, buf] of job.files) if (!want || want.has(name)) sources.push({ name, buf, qty: Math.max(1, Math.min(50, Number(b.qty?.[name] ?? 1))) });
  }
  if (!sources.length) throw new CatalogError('Nothing to split');
  const k = createScope();
  try {
    const usable = { x: bed.x - 2 * margin, y: bed.y - 2 * margin, z: bed.z - margin };
    const pieces = [];
    const cuts = [];
    let holes = 0;
    for (const src of sources) {
      const soup = parseStl(src.buf);
      const solid = k.fromTriangles(soup.positions, soup.indices);
      const r = splitToFit(k, solid, { bed, margin, joint, pinDiameter, pinLength, clearance });
      cuts.push(...r.cuts.map((c) => ({ ...c, part: src.name })));
      holes += r.cuts.reduce((n, c) => n + c.holes, 0) * src.qty;
      r.pieces.forEach((pc, i) => {
        const placed = placeOnBed(k, pc, usable);
        pieces.push({ name: r.pieces.length > 1 ? `${src.name}-piece${i + 1}of${r.pieces.length}` : src.name, placed, qty: src.qty });
      });
    }
    if (joint === 'pins' && holes) {
      const pin = k.track(k.Manifold.cylinder(pinLength, pinDiameter / 2, pinDiameter / 2, 32));
      pieces.push({ name: `alignment-pin-${pinDiameter}x${pinLength}mm`, placed: { manifold: pin, size: [pinDiameter, pinDiameter, pinLength] }, qty: holes, pin: true });
    }
    // one entry per copy for packing
    const copies = pieces.flatMap((p, i) => Array.from({ length: p.qty }, () => ({ piece: i, w: p.placed.size[0], d: p.placed.size[1] })));
    const plates = arrange(copies, { bed: { x: usable.x, y: usable.y }, spacing });
    const files = new Map();
    const pieceOut = pieces.map((p) => {
      const mesh = toPlainMesh(p.placed.manifold);
      files.set(p.name, toStl(mesh, { name: p.name }));
      return { name: p.name, qty: p.qty, stats: meshStats(mesh), pin: Boolean(p.pin) };
    });
    const plateOut = plates.map((plate, n) => {
      let all = null;
      for (const it of plate) {
        const src = pieces[copies[it.index].piece].placed.manifold;
        const turned = it.rotated ? k.track(src.rotate([0, 0, 90]).translate([pieces[copies[it.index].piece].placed.size[1], 0, 0])) : src;
        const moved = k.track(turned.translate([margin + it.x, margin + it.y, 0]));
        all = all ? k.track(Manifold_add(k, all, moved)) : moved;
      }
      const name = `plate${n + 1}`;
      const mesh = toPlainMesh(all);
      files.set(name, toStl(mesh, { name }));
      return { name, count: plate.length, stats: meshStats(mesh), items: plate.map((it) => pieces[copies[it.index].piece].name) };
    });
    // estimates per plate on the chosen printer
    const opts = { ...cfg.print, filamentCostPerKg: cfg.filament?.[cfg.print.material] ?? cfg.print.filamentCostPerKg };
    for (const pl of plateOut) {
      const counts = new Map();
      for (const nm of pl.items) counts.set(nm, (counts.get(nm) ?? 0) + 1);
      const list = [...counts.keys()];
      const e = estimateParts(list.map((nm) => pieceOut.find((p) => p.name === nm).stats), profile, opts, list.map((nm) => counts.get(nm)));
      pl.estimate = { seconds: e.seconds, grams: e.grams, filamentMm: e.filamentMm, cost: e.cost, text: `${formatDuration(e.seconds)}, ${e.grams.toFixed(0)} g` };
    }
    const lines = [`Split for ${profile.name} (bed ${bed.x} x ${bed.y} x ${bed.z} mm, ${margin} mm margin)`, '',
      ...cuts.map((c) => `${c.part}: cut across ${'XYZ'[c.axis]} at ${c.at.toFixed(1)} mm, ${c.holes} alignment hole(s)`), '',
      joint === 'pins' ? `Alignment: ${holes} printed pins ${pinDiameter} x ${pinLength} mm (holes ${(pinDiameter + 2 * clearance).toFixed(2)} mm). Glue the pieces with the pins in place.` : joint === 'filament' ? `Alignment: ${holes} pieces of 1.75 mm filament, 10 mm long (holes ${(1.75 + 2 * clearance).toFixed(2)} mm).` : 'No alignment holes: glue the pieces face to face.', '',
      ...plateOut.map((p) => `${p.name}: ${p.count} piece(s), about ${p.estimate.text}: ${p.items.join(', ')}`)];
    const key = randomBytes(8).toString('hex');
    remember(key, { prefix: 'split', files, extra: [{ name: 'README.txt', data: Buffer.from(lines.join('\n') + '\n') }] });
    const link = (name) => ({ url: `/api/stl/${key}/${encodeURIComponent(name)}.stl`, filename: `split-${name}.stl` });
    return {
      zip: `/api/zip/${key}`, profile: profile.name, bed, cuts, pins: joint === 'pins' ? holes : 0, joint,
      pieces: pieceOut.map((p) => ({ ...p, ...link(p.name) })),
      plates: plateOut.map((p) => ({ ...p, ...link(p.name) })),
      readme: lines.join('\n'),
    };
  } finally {
    k.free?.();
  }
}
const Manifold_add = (k, a, b) => a.add(b);

/**
 * Collections hold STL files only (owner's choice, option B): a preset, saved design,
 * generator or project put in a collection is generated once and saved as frozen STL
 * copies in the STL library (folder "Collections"); the collection lists those STLs.
 * A copy is reused when the same item is added again (marked in the entry's notes).
 */
async function stlIdsFor(item) {
  const marker = `src:${item.kind}:${item.id}`;
  const lib = await library.list();
  const existing = lib.filter((e) => (e.notes ?? '').includes(marker)).map((e) => e.id);
  if (existing.length) return existing;
  const save = async (name, mesh, label) => (await library.add(toStl(mesh, { name }), { filename: `${slug(name)}.stl`, name: name.slice(0, 120), folder: 'Collections', tags: ['collection', item.kind], notes: `Frozen copy of ${label}. ${marker}` })).id;
  if (item.kind === 'preset' || item.kind === 'design' || item.kind === 'generator') {
    let generator, params, name;
    if (item.kind === 'preset') { const pr = listPresets().find((x) => x.id === item.id); if (!pr) throw new CatalogError(`No preset ${item.id}`, 404); if (pr.measure?.length) throw new CatalogError(`${pr.name} needs measured sizes first: open it, type them, save it as a design, then add the design.`); ({ generator, params, name } = pr); }
    else if (item.kind === 'design') { const d = await designs.get(item.id); ({ generator, params, name } = d); }
    else { generator = item.id; params = {}; name = listGenerators().find((g) => g.id === item.id)?.name ?? item.id; }
    const r = await generate(generator, params ?? {});
    const ids = [];
    for (const pt of r.parts) ids.push(await save(r.parts.length > 1 ? `${name} - ${pt.name}` : name, pt.mesh, `${item.kind} "${name}"`));
    return ids;
  }
  if (item.kind === 'project') {
    const pj = await projects.get(item.id);
    const built = await buildProject(pj);
    const job = jobs.get(built.zip.split('/').pop());
    const ids = [];
    for (const [file, buf] of job.files) ids.push((await library.add(buf, { filename: `${slug(file)}.stl`, name: `${pj.name} - ${file}`.slice(0, 120), folder: 'Collections', tags: ['collection', 'project'], notes: `Frozen copy from project "${pj.name}". ${marker}` })).id);
    return ids;
  }
  if (item.kind === 'stl') return [item.id];
  throw new CatalogError(`Unknown item kind "${item.kind}"`);
}

/** Turn every non-STL item of every collection into STL items (runs once after an upgrade, then only for new items). */
async function convertCollections() {
  const report = [];
  for (const c of await collections.list()) {
    if (c.items.every((i) => i.kind === 'stl')) continue;
    const items = [];
    for (const it of c.items) {
      if (it.kind === 'stl') { if (!items.some((x) => x.id === it.id)) items.push(it); continue; }
      try { for (const id of await stlIdsFor(it)) if (!items.some((x) => x.id === id)) items.push({ kind: 'stl', id }); report.push(`${c.name}: ${it.kind} ${it.id} -> STL`); }
      catch (err) { items.push(it); report.push(`${c.name}: ${it.kind} ${it.id} kept (${err.message})`); }
    }
    await collections.update(c.id, { items });
  }
  return report;
}

/** Serve a file from baseDir without allowing ../ escapes. */
async function serveStatic(res, baseDir, relPath) {
  const full = normalize(join(baseDir, relPath));
  if (full !== baseDir && !full.startsWith(baseDir + sep)) return send(res, 403, 'Forbidden');
  try {
    const data = await readFile(full);
    res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    send(res, 404, 'Not found');
  }
}

/** Cache a generation result for download and build the JSON reply. */
function publish(id, result, extra = {}) {
  const key = jobKey(id, result.params, extra.item?.code ?? '', extra.item?.updatedAt ?? '');
  const files = new Map();
  const prefix = extra.item ? extra.item.code : id;
  const parts = result.parts.map(({ name, mesh, assembled, qty }) => {
    files.set(name, toStl(mesh, { name: `${prefix}-${name}` }));
    return {
      name,
      url: `/api/stl/${key}/${encodeURIComponent(name)}.stl`,
      filename: `${prefix}-${name}.stl`,
      stats: meshStats(mesh),
      ...(assembled ? { assembled } : {}),
      ...(qty ? { qty } : {}),
    };
  });
  remember(key, { prefix, files });
  return { id, job: key, zip: parts.length > 1 ? `/api/zip/${key}` : null, params: result.params, parts, warnings: result.warnings, notes: result.notes, ...extra };
}

async function handleGenerate(req, res, id) {
  const input = await readBody(req);
  const result = await generate(id, input);
  send(res, 200, publish(id, result));
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);
  let m;

  if (req.method === 'GET' && path === '/api/generators') return send(res, 200, listGenerators());
  if (req.method === 'GET' && path === '/api/presets') return send(res, 200, listPresets());
  if (req.method === 'GET' && path === '/api/version') {
    return send(res, 200, {
      name: 'stltools', version: PKG.version, edition: EDITION, node: process.versions.node,
      generators: listGenerators().length, presets: listPresets().length, profiles: listProfiles().length,
      platform: process.platform, arch: process.arch,
      dataDir: catalog.dataDir, issues: [...registryIssues(), ...presetIssues(), ...profileIssues()],
    });
  }

  // ---- self-hosting (1.1) ----
  if (path === '/api/hosting' && req.method === 'GET') return send(res, 200, await hostingStatus(req));
  if (path === '/api/hosting/login' && req.method === 'POST') {
    const token = await hosting.login((await readBody(req)).pin, req.socket.remoteAddress);
    return send(res, 200, { ok: true }, token ? { 'set-cookie': pinCookie(token) } : {});
  }
  if (path === '/api/hosting/logout' && req.method === 'POST') return send(res, 200, { ok: true }, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0` });
  if (path === '/api/hosting/pin' && req.method === 'PUT') {
    const b = await readBody(req);
    const r = await hosting.setPin(b.pin, b.current);
    return send(res, 200, { pin: r.pin }, r.token ? { 'set-cookie': pinCookie(r.token) } : {});
  }
  if (path === '/api/estimate-targets' && req.method === 'GET') return send(res, 200, await estimateTargets());
  if (path === '/api/split' && req.method === 'POST') return send(res, 200, await splitAndArrange(await readBody(req)));

  // ---- settings, printer profiles, estimates (v6) ----
  if (path === '/api/settings') {
    if (req.method === 'GET') return send(res, 200, await settings.get());
    if (req.method === 'PUT') return send(res, 200, await settings.update(await readBody(req)));
    return send(res, 405, 'Method not allowed');
  }
  if (path === '/api/settings/schema' && req.method === 'GET') return send(res, 200, settings.schema());
  if (path === '/api/settings/reset' && req.method === 'POST') return send(res, 200, await settings.reset((await readBody(req)).section));
  if (path === '/api/printer-profiles' && req.method === 'GET') return send(res, 200, listProfiles());
  if (path === '/api/estimate' && req.method === 'POST') {
    const b = await readBody(req);
    const cfg = await settings.get();
    const profile = b.profile ? getProfile(b.profile) : await activeProfile(cfg);
    if (!profile) return send(res, 404, { error: `Unknown printer profile "${b.profile}"` });
    if (!Array.isArray(b.stats) || !b.stats.length) return send(res, 400, { error: 'stats must be a list of part stats (from a generate result)' });
    return send(res, 200, { profile: profile.id, ...estimateParts(b.stats.slice(0, 500), profile, { ...cfg.print, ...(b.opts ?? {}) }, b.qty) });
  }
  if (path === '/api/backup' && req.method === 'GET') {
    const [cfg, ds, ps, items, cats, favs, prs, lib, pts, cols] = await Promise.all([settings.get(), designs.list(), projects.list(), catalog.items(), catalog.categories(), favorites.list(), printers.list(), library.list(), parts.list(), collections.list()]);
    return send(res, 200, { format: 'stltools-backup', version: 1, app: PKG.version, exportedAt: new Date().toISOString(), note: 'API keys and STL files are not included. Copy the data folder for a full backup.', settings: cfg, designs: ds, projects: ps, catalog: items, categories: cats, favorites: favs, printers: prs, library: lib, parts: pts, collections: cols }, { 'content-disposition': 'attachment; filename="stltools-backup.json"' });
  }
  if (path === '/api/thumbs' && req.method === 'DELETE') { await thumbs.clear(); return send(res, 204, ''); }

  // ---- materials for the Stress Lab (1.3-mts) ----
  if (path === '/api/materials') {
    if (req.method === 'GET') return send(res, 200, await materials.list());
    if (req.method === 'POST') return send(res, 201, await materials.add(await readBody(req)));
    return send(res, 405, 'Method not allowed');
  }
  m = path.match(/^\/api\/materials\/([a-z0-9-]{3,60})$/);
  if (m) {
    if (req.method === 'PUT') return send(res, 200, await materials.update(m[1], await readBody(req)));
    if (req.method === 'DELETE') { await materials.remove(m[1]); return send(res, 204, ''); }
    return send(res, 405, 'Method not allowed');
  }

  // ---- collections (1.0) ----
  if (path === '/api/collections/convert' && req.method === 'POST') return send(res, 200, { report: await convertCollections() });
  if (path === '/api/collections') {
    if (req.method === 'GET') {
      const list = await collections.list();
      if (list.some((c) => c.items.some((i) => i.kind !== 'stl'))) await convertCollections();
      return send(res, 200, await collections.list());
    }
    if (req.method === 'POST') return send(res, 201, await collections.add(await readBody(req)));
    return send(res, 405, 'Method not allowed');
  }
  m = path.match(/^\/api\/collections\/(col-[a-f0-9]{8})(\/toggle)?$/);
  if (m) {
    if (m[2]) {
      if (req.method !== 'POST') return send(res, 405, 'Use POST');
      const item = await readBody(req);
      if (item.kind && item.kind !== 'stl') {
        // STL-only collections: add (or remove) the frozen STL copies of this item
        const ids = await stlIdsFor({ kind: String(item.kind), id: String(item.id ?? '') });
        const c = await collections.get(m[1]);
        const all = ids.every((id) => c.items.some((i) => i.kind === 'stl' && i.id === id));
        const items = all ? c.items.filter((i) => !(i.kind === 'stl' && ids.includes(i.id))) : [...c.items, ...ids.filter((id) => !c.items.some((i) => i.id === id)).map((id) => ({ kind: 'stl', id }))];
        return send(res, 200, { ...(await collections.update(m[1], { items })), added: all ? [] : ids, removed: all ? ids : [] });
      }
      return send(res, 200, await collections.toggle(m[1], item));
    }
    if (req.method === 'GET') return send(res, 200, await collections.get(m[1]));
    if (req.method === 'PUT') return send(res, 200, await collections.update(m[1], await readBody(req)));
    if (req.method === 'DELETE') { await collections.remove(m[1]); return send(res, 204, ''); }
    return send(res, 405, 'Method not allowed');
  }

  // ---- My Parts (v7) ----
  if (path === '/api/parts') {
    if (req.method === 'GET') return send(res, 200, await parts.list());
    if (req.method === 'POST') return send(res, 201, await parts.add(await readBody(req)));
    return send(res, 405, 'Method not allowed');
  }
  if (path === '/api/parts/import' && req.method === 'POST') {
    const body = await readBody(req, 2 * 1024 * 1024);
    return send(res, 200, await parts.merge(fromComponents(body), { overwrite: url.searchParams.get('overwrite') === '1' }));
  }
  if (path === '/api/parts/seeds' && req.method === 'GET') return send(res, 200, await parts.seeds());
  if (path === '/api/parts/seed' && req.method === 'POST') return send(res, 200, await loadSeed(String((await readBody(req)).set ?? '')));
  m = path.match(/^\/api\/parts\/([A-Z]{2,4}\d{2,3})$/);
  if (m) {
    if (req.method === 'GET') return send(res, 200, await parts.get(m[1]));
    if (req.method === 'PUT') return send(res, 200, await parts.update(m[1], await readBody(req)));
    if (req.method === 'DELETE') { await parts.remove(m[1]); return send(res, 204, ''); }
    return send(res, 405, 'Method not allowed');
  }

  // ---- STL library ----
  if (path === '/api/library' && req.method === 'GET') {
    const list = await library.list();
    return send(res, 200, await Promise.all(list.map(async (e) => {
      const thumbKey = jobKey('library', e.id);
      return { ...e, thumbKey, thumb: (await thumbs.exists(thumbKey)) ? `/api/thumbs/${thumbKey}.png` : null };
    })));
  }
  if (path === '/api/library/upload') {
    if (req.method !== 'PUT') return send(res, 405, 'Use PUT with the STL file as the body');
    const data = await readRaw(req, MAX_STL_BYTES + 1);
    const q = url.searchParams;
    return send(res, 201, await library.add(data, { filename: q.get('filename'), name: q.get('name'), folder: q.get('folder'), tags: q.get('tags') ?? '' }));
  }
  m = path.match(/^\/api\/library\/(stl-[a-f0-9]{8})(\.stl)?$/);
  if (m) {
    if (m[2]) {
      if (req.method !== 'GET') return send(res, 405, 'Use GET');
      const e = await library.get(m[1]);
      return send(res, 200, await library.file(m[1]), { 'content-type': 'model/stl', 'content-disposition': `attachment; filename="${e.filename.replace(/"/g, '')}"` });
    }
    if (req.method === 'GET') return send(res, 200, await library.get(m[1]));
    if (req.method === 'PUT') return send(res, 200, await library.update(m[1], await readBody(req)));
    if (req.method === 'DELETE') { await library.remove(m[1]); return send(res, 204, ''); }
    return send(res, 405, 'Method not allowed');
  }

  if (path === '/api/categories') {
    if (req.method === 'GET') return send(res, 200, await catalog.categories());
    if (req.method === 'PUT') return send(res, 200, await catalog.setCategories(await readBody(req)));
    return send(res, 405, 'Method not allowed');
  }
  if (path === '/api/catalog') {
    if (req.method === 'GET') return send(res, 200, await catalog.items());
    if (req.method === 'POST') return send(res, 201, await catalog.add(await readBody(req)));
    return send(res, 405, 'Method not allowed');
  }
  m = path.match(/^\/api\/catalog\/([A-Z0-9]{2,5}-\d{3,})(\/generate)?$/);
  if (m) {
    const [, code, gen] = m;
    if (gen) {
      if (req.method !== 'POST') return send(res, 405, 'Use POST');
      const result = await catalog.generate(code);
      return send(res, 200, publish(result.id, result, { item: result.item }));
    }
    if (req.method === 'GET') return send(res, 200, await catalog.get(code));
    if (req.method === 'PUT') return send(res, 200, await catalog.update(code, await readBody(req)));
    if (req.method === 'DELETE') { await catalog.remove(code); return send(res, 204, ''); }
    return send(res, 405, 'Method not allowed');
  }

  if (path === '/api/designs') {
    if (req.method === 'GET') return send(res, 200, await designs.list());
    if (req.method === 'POST') return send(res, 201, await designs.add(await readBody(req)));
    return send(res, 405, 'Method not allowed');
  }
  m = path.match(/^\/api\/designs\/([a-z0-9-]{3,60})$/);
  if (m) {
    if (req.method === 'GET') return send(res, 200, await designs.get(m[1]));
    if (req.method === 'PUT') return send(res, 200, await designs.update(m[1], await readBody(req)));
    if (req.method === 'DELETE') { await designs.remove(m[1]); return send(res, 204, ''); }
    return send(res, 405, 'Method not allowed');
  }

  // ---- projects ----
  if (path === '/api/projects/import') {
    if (req.method !== 'POST') return send(res, 405, 'Use POST');
    return send(res, 201, await projects.importBundle(await readBody(req, MAX_IMPORT)));
  }
  if (path === '/api/projects') {
    if (req.method === 'GET') return send(res, 200, await projects.list());
    if (req.method === 'POST') return send(res, 201, await projects.add(await readBody(req)));
    return send(res, 405, 'Method not allowed');
  }
  m = path.match(/^\/api\/projects\/([a-z0-9-]{3,60})(\/items|\/build|\/export)?$/);
  if (m) {
    const [, id, sub] = m;
    if (sub === '/export') {
      if (req.method !== 'GET') return send(res, 405, 'Use GET');
      const bundle = await projects.exportBundle(id, { appVersion: PKG.version, includeStl: url.searchParams.get('stl') !== '0' });
      return send(res, 200, bundle, { 'content-disposition': `attachment; filename="${slug(bundle.project.name)}.stltools-project.json"` });
    }
    if (sub === '/items') {
      if (req.method !== 'POST') return send(res, 405, 'Use POST');
      return send(res, 200, await projects.addItem(id, await readBody(req)));
    }
    if (sub === '/build') {
      if (req.method !== 'POST') return send(res, 405, 'Use POST');
      return send(res, 200, await buildProject(await projects.get(id), { onlyUnprinted: url.searchParams.get('unprinted') === '1' }));
    }
    if (req.method === 'GET') return send(res, 200, await projects.get(id));
    if (req.method === 'PUT') return send(res, 200, await projects.update(id, await readBody(req)));
    if (req.method === 'DELETE') { await projects.remove(id); return send(res, 204, ''); }
    return send(res, 405, 'Method not allowed');
  }

  // ---- favorites ----
  if (path === '/api/favorites' && req.method === 'GET') return send(res, 200, await favorites.list());
  if (path === '/api/favorites/toggle' && req.method === 'POST') return send(res, 200, await favorites.toggle(await readBody(req)));

  // ---- printers (view only) ----
  if (path === '/api/printers') {
    if (req.method === 'GET') return send(res, 200, await printers.list());
    if (req.method === 'POST') return send(res, 201, await printers.add(await readBody(req)));
    return send(res, 405, 'Method not allowed');
  }
  if (path === '/api/printers/probe' && req.method === 'POST') {
    const b = await readBody(req);
    return send(res, 200, await printers.probe(b.url, b.apiKey));
  }
  if (path === '/api/printers/scan' && req.method === 'GET') return send(res, 200, await scanLan());
  if (path === '/api/printers/check' && req.method === 'POST') return send(res, 200, await printers.checkAll());
  if (path === '/api/printers/diagnose' && req.method === 'POST') {
    const b = await readBody(req);
    let key = b.apiKey;
    if (!key && b.id) key = await printers.apiKeyOf(b.id); // re-test a saved printer without sending its key to the browser
    return send(res, 200, await printers.diagnose(b.url, key));
  }
  // ---- printer control (opt-in per printer, logged; see core/printers.js) ----
  m = path.match(/^\/api\/printers\/(printer-[a-f0-9]{6})\/control(?:\/([a-z_]+))?$/);
  if (m) {
    const [, id, action] = m;
    if (!action) {
      if (req.method === 'GET') return send(res, 200, { enabled: Boolean((await printers.list()).find((x) => x.id === id)?.control?.enabled), actions: ['pause', 'resume', 'cancel', 'start', 'gcode', 'estop', 'firmware_restart', 'restart', 'service'] });
      if (req.method === 'PUT') return send(res, 200, await printers.setControl(id, await readBody(req)));
      return send(res, 405, 'Use GET or PUT');
    }
    if (action === 'log') {
      if (req.method !== 'GET') return send(res, 405, 'Use GET');
      return send(res, 200, await printers.controlLog(id, Number(url.searchParams.get('limit') ?? 100)));
    }
    if (req.method !== 'POST') return send(res, 405, 'Use POST');
    return send(res, 200, await printers.control(id, action, await readBody(req)));
  }
  m = path.match(/^\/api\/printers\/(printer-[a-f0-9]{6})(?:\/([a-z]+))?$/);
  if (m) {
    const [, id, sub] = m;
    if (!sub) {
      if (req.method === 'PUT') return send(res, 200, await printers.update(id, await readBody(req)));
      if (req.method === 'DELETE') { await printers.remove(id); return send(res, 204, ''); }
      return send(res, 405, 'Method not allowed');
    }
    if (sub === 'upload') {
      if (req.method !== 'PUT') return send(res, 405, 'Use PUT');
      const data = await readRaw(req, MAX_UPLOAD_BYTES + 1);
      if (url.searchParams.get('print') === '1') return send(res, 200, await printers.uploadAndPrint(id, url.searchParams.get('filename'), data, url.searchParams.get('path') ?? '', url.searchParams.get('confirm') === '1'));
      return send(res, 200, await printers.upload(id, url.searchParams.get('filename'), data, url.searchParams.get('path') ?? ''));
    }
    if (req.method !== 'GET') return send(res, 405, 'Read-only: use GET');
    if (sub === 'status') return send(res, 200, await printers.status(id));
    if (sub === 'files') return send(res, 200, await printers.files(id));
    if (sub === 'history') return send(res, 200, await printers.history(id, Number(url.searchParams.get('limit') ?? 20)));
    if (sub === 'webcams') return send(res, 200, await printers.webcams(id));
    if (sub === 'machine') return send(res, 200, await printers.machine(id));
    if (sub === 'health') return send(res, 200, await printers.health(id));
    if (sub === 'mesh') return send(res, 200, await printers.mesh(id));
    if (sub === 'logs') {
      const file = url.searchParams.get('file');
      return send(res, 200, file ? await printers.logFile(id, file) : await printers.logFiles(id));
    }
    if (sub === 'config') {
      const file = url.searchParams.get('file');
      return send(res, 200, file ? await printers.configFile(id, file) : await printers.configFiles(id));
    }
    if (sub === 'stream') {
      const st = await printers.stream(id, Number(url.searchParams.get('cam') ?? 0));
      res.writeHead(200, { 'content-type': st.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      const reader = st.body.getReader();
      res.on('close', () => { st.close(); reader.cancel().catch(() => {}); });
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || res.destroyed) break;
          if (!res.write(value)) await new Promise((r) => res.once('drain', r));
        }
      } catch { /* camera or browser went away */ }
      st.close();
      return res.end();
    }
    if (sub === 'metadata') return send(res, 200, await printers.metadata(id, url.searchParams.get('filename') ?? ''));
    if (sub === 'thumb' || sub === 'snapshot') {
      const img = sub === 'thumb' ? await printers.thumbnail(id, url.searchParams.get('path')) : await printers.snapshot(id, Number(url.searchParams.get('cam') ?? 0));
      return send(res, 200, img.data, { 'content-type': img.type, 'cache-control': sub === 'thumb' ? 'public, max-age=3600' : 'no-store' });
    }
    return send(res, 404, 'Unknown printer endpoint');
  }

  // ---- thumbnails ----
  if (path === '/api/thumbs/lookup' && req.method === 'POST') {
    const body = await readBody(req);
    return send(res, 200, await thumbs.lookup(Array.isArray(body) ? body : []));
  }
  m = path.match(/^\/api\/thumbs\/([a-f0-9]{16})(\.png)?$/);
  if (m) {
    if (req.method === 'PUT') return send(res, 200, await thumbs.put(m[1], await readRaw(req, 300 * 1024 + 1)));
    if (req.method === 'GET') {
      const png = await thumbs.get(m[1]);
      if (!png) return send(res, 404, 'No thumbnail yet');
      return send(res, 200, png, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
    }
    return send(res, 405, 'Method not allowed');
  }

  m = path.match(/^\/api\/zip\/([a-f0-9]{16})$/);
  if (m && req.method === 'GET') {
    const job = jobs.get(m[1]);
    if (!job) return send(res, 404, 'Expired or unknown. Generate again.');
    const zip = createZip([...[...job.files].map(([name, data]) => ({ name: `${job.prefix}-${name}.stl`, data })), ...(job.extra ?? [])]);
    return send(res, 200, zip, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${job.prefix}.zip"` });
  }

  m = path.match(/^\/api\/generate\/([a-z0-9-]+)$/);
  if (m) {
    if (req.method !== 'POST') return send(res, 405, 'Use POST');
    return handleGenerate(req, res, m[1]);
  }

  m = path.match(/^\/api\/stl\/([a-f0-9]{16})\/([^/]+)\.stl$/);
  if (m && req.method === 'GET') {
    const job = jobs.get(m[1]);
    const file = job?.files.get(m[2]);
    if (!file) return send(res, 404, 'Expired or unknown. Generate again.');
    return send(res, 200, file, {
      'content-type': 'model/stl',
      'content-disposition': `attachment; filename="${job.prefix}-${m[2]}.stl"`,
    });
  }

  if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
  // three.js modules for the browser preview, served from node_modules
  if (path.startsWith('/vendor/three/')) return serveStatic(res, THREE_DIR, path.slice('/vendor/three/'.length));
  // browser-safe core modules shared with the UI (no Node imports inside)
  if (path === '/shared/estimate.js') return serveStatic(res, join(ROOT, 'src', 'core'), 'estimate.js');
  // Stress Lab engines (voxel FEA, weak points, aero, environment): the same files Node tests use
  m = path.match(/^\/shared\/lab\/([a-z]+\.js)$/);
  if (m) return serveStatic(res, join(ROOT, 'src', 'core', 'lab'), m[1]);
  return serveStatic(res, PUBLIC_DIR, path === '/' ? 'index.html' : path.slice(1));
}

let catalog = createCatalog();
let designs = createDesignStore();
let projects = createProjects({ dataDir: catalog.dataDir, designs });
let favorites = createFavorites({ dataDir: catalog.dataDir });
let thumbs = createThumbStore({ dataDir: catalog.dataDir, version: PKG.version });
let printers = createPrinters({ dataDir: catalog.dataDir });
let settings = createSettings({ dataDir: catalog.dataDir });
let library = createLibrary({ dataDir: catalog.dataDir });
let parts = createParts({ dataDir: catalog.dataDir, seedDir: SEED_DIR });
let collections = createCollections({ dataDir: catalog.dataDir });
let hosting = createHosting({ dataDir: catalog.dataDir });
let materials = createMaterials({ dataDir: catalog.dataDir, root: ROOT });
projects = createProjects({ dataDir: catalog.dataDir, designs, library });

/** Background read-only connection checks (Settings > Printers > Background connection check). */
function startPrinterChecks() {
  let last = 0;
  const timer = setInterval(async () => {
    try {
      const cfg = await settings.get();
      const every = cfg.printers.checkMinutes * 60e3;
      if (cfg.printers.enabled === 'off' || !every || Date.now() - last < every) return;
      last = Date.now();
      await printers.checkAll();
    } catch { /* next round */ }
  }, 15e3);
  timer.unref();
  return timer;
}

export function startServer({ host = HOST, port = PORT, dataDir, pinForLocal = false } = {}) {
  RUN.host = host;
  const trustLoopback = !pinForLocal; // pinForLocal: tests only, treat this machine like a LAN device
  if (dataDir) {
    catalog = createCatalog({ dataDir });
    designs = createDesignStore({ dataDir });
    library = createLibrary({ dataDir });
    projects = createProjects({ dataDir, designs, library });
    favorites = createFavorites({ dataDir });
    thumbs = createThumbStore({ dataDir, version: PKG.version });
    printers = createPrinters({ dataDir });
    settings = createSettings({ dataDir });
    parts = createParts({ dataDir, seedDir: SEED_DIR });
    collections = createCollections({ dataDir });
    hosting = createHosting({ dataDir });
    materials = createMaterials({ dataDir, root: ROOT });
  }
  const server = createServer(async (req, res) => {
    try {
      if (!(await hosting.allowed(req, { trustLoopback }))) {
        const p = new URL(req.url, 'http://localhost').pathname;
        if (p === '/api/hosting/login' && req.method === 'POST') return await route(req, res);
        if (p.startsWith('/api/')) return send(res, 401, { error: 'This STL Tools server needs its access PIN. Open the main page to enter it.' });
        return send(res, 200, loginPage(), { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      }
      await route(req, res);
    } catch (err) {
      if (err instanceof ParamError) return send(res, 400, { error: err.message, errors: err.errors });
      if (err instanceof CatalogError) return send(res, err.status, { error: err.message });
      const status = err.status ?? (/Unknown generator/.test(err.message) ? 404 : 422);
      if (status >= 500 || status === 422) console.error(`[${req.method} ${req.url}]`, err.message);
      send(res, status, { error: err.message });
    }
  });
  const checks = startPrinterChecks();
  server.on('close', () => clearInterval(checks));
  return new Promise((resolve) => server.listen(port, host, () => { RUN.port = server.address().port; resolve(server); }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await initKernel();
  const server = await startServer();
  const { address, port } = server.address();
  console.log(`stltools web UI on http://${address}:${port}`);
}
