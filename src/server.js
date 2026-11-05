#!/usr/bin/env node
// Web UI + JSON API. No framework: Node's built-in http module only.
//
//   GET  /                         web UI
//   GET  /api/generators           generator list with parameter schemas
//   POST /api/generate/:id         body: JSON params -> part list + stats + download URLs
//   GET  /api/stl/:job/:part.stl   binary STL for one part of a finished job
//
// Env: HOST (default 127.0.0.1), PORT (default 3000)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, listGenerators } from './core/registry.js';
import { ParamError } from './core/params.js';
import { toStl, meshStats } from './core/export.js';
import { initKernel } from './core/kernel.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
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

async function handleGenerate(req, res, id) {
  const input = await readBody(req);
  const result = await generate(id, input);
  const key = createHash('sha256').update(JSON.stringify([id, result.params])).digest('hex').slice(0, 16);
  const files = new Map();
  const parts = result.parts.map(({ name, mesh }) => {
    files.set(name, toStl(mesh, { name: `${id}-${name}` }));
    return {
      name,
      url: `/api/stl/${key}/${encodeURIComponent(name)}.stl`,
      filename: `${id}-${name}.stl`,
      stats: meshStats(mesh),
    };
  });
  remember(key, { id, files });
  send(res, 200, { id, job: key, params: result.params, parts, warnings: result.warnings, notes: result.notes });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);

  if (req.method === 'GET' && path === '/api/generators') return send(res, 200, listGenerators());

  let m = path.match(/^\/api\/generate\/([a-z0-9-]+)$/);
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
      'content-disposition': `attachment; filename="${job.id}-${m[2]}.stl"`,
    });
  }

  if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
  // three.js modules for the browser preview, served from node_modules
  if (path.startsWith('/vendor/three/')) return serveStatic(res, THREE_DIR, path.slice('/vendor/three/'.length));
  return serveStatic(res, PUBLIC_DIR, path === '/' ? 'index.html' : path.slice(1));
}

export function startServer({ host = HOST, port = PORT } = {}) {
  const server = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      if (err instanceof ParamError) return send(res, 400, { error: err.message, errors: err.errors });
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
