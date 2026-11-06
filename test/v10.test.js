// 1.0: collections, tooltip settings, new generators (cells, shaft supports,
// drawer unit, spool arm, quad arm, drill guide), and release hygiene: license,
// example seed, no personal or client data in shipped files.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { initKernel } from '../src/core/kernel.js';
import { generate, listGenerators } from '../src/core/registry.js';
import { listPresets } from '../src/core/presets.js';
import { openEdgeCount, stlEdgeIssues } from '../src/core/export.js';

let dir, app, base;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stltools-v10-'));
  await initKernel();
  app = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir });
  base = `http://127.0.0.1:${app.address().port}`;
});
after(async () => {
  app.close();
  await rm(dir, { recursive: true, force: true });
});
const j = (method, path, body) => fetch(base + path, { method, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));

test('collections: create, toggle items in and out, rename, delete, in backup', async () => {
  const c = (await j('POST', '/api/collections', { name: 'Bench tools', color: '#ff8800' })).body;
  assert.match(c.id, /^col-[a-f0-9]{8}$/);
  let r = (await j('POST', `/api/collections/${c.id}/toggle`, { kind: 'preset', id: 'clamp-split-16' })).body;
  assert.deepEqual(r.items, [{ kind: 'preset', id: 'clamp-split-16' }]);
  r = (await j('POST', `/api/collections/${c.id}/toggle`, { kind: 'stl', id: 'stl-12345678' })).body;
  assert.equal(r.items.length, 2);
  r = (await j('POST', `/api/collections/${c.id}/toggle`, { kind: 'preset', id: 'clamp-split-16' })).body;
  assert.deepEqual(r.items, [{ kind: 'stl', id: 'stl-12345678' }], 'second toggle removes');
  assert.equal((await j('POST', `/api/collections/${c.id}/toggle`, { kind: 'bogus', id: 'x' })).body.items.length, 1, 'unknown kinds ignored');
  assert.equal((await j('PUT', `/api/collections/${c.id}`, { name: 'Shop tools' })).body.name, 'Shop tools');
  assert.equal((await j('POST', '/api/collections', { name: '' })).status, 400);
  const backup = await (await fetch(`${base}/api/backup`)).json();
  assert.equal(backup.collections.length, 1);
  assert.equal((await j('DELETE', `/api/collections/${c.id}`)).status, 204);
  assert.deepEqual((await j('GET', '/api/collections')).body, []);
});

test('tooltip settings: defaults, validation, section in the schema', async () => {
  const s = (await j('GET', '/api/settings')).body;
  assert.deepEqual(s.tips, { tooltips: true, tooltipDelay: 350, tooltipSize: 'normal', fieldHelp: 'inline', fieldDetails: true, cardDetails: true });
  assert.equal((await j('PUT', '/api/settings', { tips: { fieldHelp: 'tooltip', tooltipDelay: 800 } })).body.tips.fieldHelp, 'tooltip');
  assert.equal((await j('PUT', '/api/settings', { tips: { tooltipDelay: 99999 } })).status, 400);
  assert.equal((await j('PUT', '/api/settings', { tips: { tooltipSize: 'huge' } })).status, 400);
  assert.ok((await j('GET', '/api/settings/schema')).body.tips.fields.fieldDetails);
});

test('new generators: every option builds clean, drawer unit is an assembly with a quantity', async () => {
  const ids = ['cell-holder', 'shaft-support', 'drawer-unit', 'spool-holder', 'drone-arm', 'drill-guide'];
  const gens = listGenerators();
  for (const id of ids) {
    const g = gens.find((x) => x.id === id);
    assert.ok(g, id);
    assert.ok(g.basic.length > 0, `${id}: Simple-mode settings`);
  }
  const r = await generate('drawer-unit', { drawers: 4 });
  assert.equal(r.parts.length, 2);
  assert.equal(r.parts[1].qty, 4);
  assert.ok(r.parts.every((p) => p.assembled?.length === 16));
  for (const [id, params] of [['cell-holder', { cell: '21700', columns: 4, rows: 2, ears: true }], ['shaft-support', { rod: 12, centerHeight: 28, width: 60 }], ['drone-arm', { length: 70, motorPatternA: 12, motorPatternB: 12, padDiameter: 20, motorBolt: 'M2' }], ['drill-guide', { smallest: 1, largest: 5, step: 0.5 }]]) {
    const out = await generate(id, params);
    for (const p of out.parts) {
      assert.equal(openEdgeCount(p.mesh), 0, `${id} open edges`);
      assert.equal(stlEdgeIssues(p.mesh), 0, `${id} STL edges`);
    }
  }
  const ps = listPresets();
  for (const s of ['cell-holders', 'shaft-supports', 'drawer-units', 'spool-holders', 'quad-arms', 'drill-guides']) assert.ok(ps.some((p) => p.series === s), `series ${s}`);
  assert.ok(ps.length >= 3600, `${ps.length} presets`);
});

async function filesUnder(d) {
  const out = [];
  for (const e of await readdir(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'data', 'screenshots'].includes(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) out.push(...await filesUnder(p));
    else if (/\.(js|mjs|json|md|html|css|txt|sh|ps1|bat)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('release hygiene: Apache-2.0, example seed only, no personal or client data in shipped files', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.license, 'Apache-2.0');
  assert.match(await readFile('LICENSE', 'utf8'), /Apache License\s+Version 2\.0, January 2004/);
  assert.deepEqual((await readdir('seed')).sort(), ['example']);
  const shipped = [...await filesUnder('src'), ...await filesUnder('public'), ...await filesUnder('presets'), ...await filesUnder('seed'), ...await filesUnder('printer-profiles')];
  for (const f of shipped) {
    const text = await readFile(f, 'utf8');
    for (const word of ['Bubbleology', 'Alex', 'Duell', 'mts-v1', 'MobileTechSpecialists', '@gmail']) assert.ok(!text.includes(word), `${f} contains "${word}"`);
  }
});

test('example parts list: every linked preset exists', async () => {
  const ids = new Set(listPresets().map((p) => p.id));
  const seed = JSON.parse(await readFile('seed/example/components.json', 'utf8'));
  for (const it of seed.items) for (const p of it.presets ?? []) assert.ok(ids.has(p), `${it.id}: preset ${p}`);
  assert.ok(seed.items.filter((i) => i.presets?.length).length >= 12);
  const res = await fetch(`${base}/api/parts/seed`, { method: 'POST', body: JSON.stringify({ set: 'example' }) });
  assert.equal(res.status, 200);
  const parts = await (await fetch(`${base}/api/parts`)).json();
  assert.deepEqual(parts.items.find((x) => x.id === 'SEN01').presets, ['tfluna-plate', 'tfluna-tape']);
});
