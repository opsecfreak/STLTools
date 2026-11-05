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
//
// Env: HOST (default 127.0.0.1), PORT (default 3000), STLTOOLS_DATA (default ./data)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, listGenerators } from './core/registry.js';
import { ParamError } from './core/params.js';
import { toStl, meshStats } from './core/export.js';
import { initKernel } from './core/kernel.js';
import { listPresets, presetIssues } from './core/presets.js';
import { registryIssues } from './core/registry.js';
import { createCatalog, CatalogError } from './core/catalog.js';
import { createDesignStore } from './core/designs.js';
import { createZip } from './core/zip.js';
import { createProjects, createFavorites } from './core/projects.js';
import { createThumbStore, jobKey } from './core/thumbs.js';
import { randomBytes } from 'node:crypto';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const PUBLIC_DIR = join(ROOT, 'public');
const THREE_DIR = join(ROOT, 'node_modules', 'three');
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3000);
const MAX_BODY = 64 * 1024;
const MAX_JOBS = 50;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
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
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request body too large'), { status: 413 });
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
  let n = 0;
  for (const item of project.items) {
    n++;
    if (onlyUnprinted && item.printed) continue;
    const base = `${String(n).padStart(2, '0')}-${slug(item.name)}${item.qty > 1 ? `-x${item.qty}` : ''}`;
    try {
      const { generator, params } = await projects.resolveItem(item);
      const r = await generate(generator, params);
      for (const pt of r.parts) files.set(`${base}-${pt.name}`, toStl(pt.mesh, { name: `${base}-${pt.name}` }));
      lines.push(`${n}. ${item.name}  x${item.qty}${item.printed ? '  (printed)' : ''}${item.note ? `  - ${item.note}` : ''}`);
    } catch (err) {
      errors.push(`${item.name}: ${err.message}`);
      lines.push(`${n}. ${item.name}  NOT BUILT: ${err.message}`);
    }
  }
  const key = randomBytes(8).toString('hex');
  remember(key, { prefix: slug(project.name), files, extra: [{ name: 'README.txt', data: Buffer.from(lines.join('\n') + '\n') }] });
  return { zip: `/api/zip/${key}`, files: files.size, errors };
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
  const parts = result.parts.map(({ name, mesh }) => {
    files.set(name, toStl(mesh, { name: `${prefix}-${name}` }));
    return {
      name,
      url: `/api/stl/${key}/${encodeURIComponent(name)}.stl`,
      filename: `${prefix}-${name}.stl`,
      stats: meshStats(mesh),
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
      name: 'stltools', version: PKG.version, node: process.versions.node,
      generators: listGenerators().length, presets: listPresets().length,
      dataDir: catalog.dataDir, issues: [...registryIssues(), ...presetIssues()],
    });
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
  if (path === '/api/projects') {
    if (req.method === 'GET') return send(res, 200, await projects.list());
    if (req.method === 'POST') return send(res, 201, await projects.add(await readBody(req)));
    return send(res, 405, 'Method not allowed');
  }
  m = path.match(/^\/api\/projects\/([a-z0-9-]{3,60})(\/items|\/build)?$/);
  if (m) {
    const [, id, sub] = m;
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
  return serveStatic(res, PUBLIC_DIR, path === '/' ? 'index.html' : path.slice(1));
}

let catalog = createCatalog();
let designs = createDesignStore();
let projects = createProjects({ dataDir: catalog.dataDir, designs });
let favorites = createFavorites({ dataDir: catalog.dataDir });
let thumbs = createThumbStore({ dataDir: catalog.dataDir, version: PKG.version });

export function startServer({ host = HOST, port = PORT, dataDir } = {}) {
  if (dataDir) {
    catalog = createCatalog({ dataDir });
    designs = createDesignStore({ dataDir });
    projects = createProjects({ dataDir, designs });
    favorites = createFavorites({ dataDir });
    thumbs = createThumbStore({ dataDir, version: PKG.version });
  }
  const server = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      if (err instanceof ParamError) return send(res, 400, { error: err.message, errors: err.errors });
      if (err instanceof CatalogError) return send(res, err.status, { error: err.message });
      const status = err.status ?? (/Unknown generator/.test(err.message) ? 404 : 422);
      if (status >= 500 || status === 422) console.error(`[${req.method} ${req.url}]`, err.message);
      send(res, status, { error: err.message });
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await initKernel();
  const server = await startServer();
  const { address, port } = server.address();
  console.log(`stltools web UI on http://${address}:${port}`);
}
