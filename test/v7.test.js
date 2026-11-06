// v7: My Parts (seed mts-v1), ownership, needs-measurement presets, categories,
// no duplicate presets, size series, project ideas and assemblies, gzip.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { request } from 'node:http';
import { startServer, parseComponentRefs } from '../src/server.js';
import { initKernel } from '../src/core/kernel.js';
import { listPresets } from '../src/core/presets.js';
import { getGenerator, generate } from '../src/core/registry.js';
import { resolveParams } from '../src/core/params.js';
import { dimsFlag, ownershipKey, fromComponents } from '../src/core/parts.js';
import { openEdgeCount, stlEdgeIssues } from '../src/core/export.js';

let dir, app, base;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stltools-v7-'));
  await initKernel();
  app = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir });
  base = `http://127.0.0.1:${app.address().port}`;
});
after(async () => {
  app.close();
  await rm(dir, { recursive: true, force: true });
});
const j = (method, path, body) => fetch(base + path, { method, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));
const seedFile = async () => JSON.parse(await readFile('seed/mts-v1/components.json', 'utf8'));

test('dimension flags and ownership keys', () => {
  assert.equal(dimsFlag('MEASURE'), 'measure');
  assert.equal(dimsFlag(''), 'measure');
  assert.equal(dimsFlag('CONFLICT: 163x65x55 vs 136x42x68. MEASURE'), 'conflict');
  assert.equal(dimsFlag('Can 28 dia', 'Common drawing, UNVERIFIED'), 'unverified');
  assert.equal(dimsFlag('75x35x28 (assumed, bay 77x37x28)'), 'unverified');
  assert.equal(dimsFlag('12x21x5', 'Bearing standard'), 'standard');
  assert.equal(dimsFlag('110x60', 'Stated'), 'given');
  assert.equal(dimsFlag('N/A'), 'none');
  assert.equal(ownershipKey('Owned (15, 11); Planned (10)'), 'Owned');
  assert.equal(ownershipKey('Confirm (printing)'), 'Confirm');
  assert.equal(ownershipKey('Planned (designed)'), 'Planned');
  assert.equal(ownershipKey('???'), 'Confirm');
});

test('component reference parsing', () => {
  assert.deepEqual(parseComponentRefs('SEN01, MOT04 x2, BAT05/BAT06'), [{ id: 'SEN01', qty: 1 }, { id: 'MOT04', qty: 2 }, { id: 'BAT05', qty: 1 }, { id: 'BAT06', qty: 1 }]);
  assert.deepEqual(parseComponentRefs('PWR01-PWR03').map((x) => x.id), ['PWR01', 'PWR02', 'PWR03']);
  assert.deepEqual(parseComponentRefs('N/A'), []);
});

test('seed mts-v1: 98 parts in 14 categories, 25 projects, repeat load adds nothing', async () => {
  assert.deepEqual((await j('GET', '/api/parts/seeds')).body, [{ set: 'mts-v1', title: 'MTS starter data (v1)', loaded: false }]);
  const r = (await j('POST', '/api/parts/seed', { set: 'mts-v1' })).body;
  assert.equal(r.parts.added, 98);
  assert.equal(r.projects.created, 25);
  const parts = (await j('GET', '/api/parts')).body;
  assert.equal(parts.categories.length, 14, 'category list from the handoff');
  assert.equal(parts.items.length, 98);
  const raw = await seedFile();
  for (const c of raw.items) {
    const p = parts.items.find((x) => x.id === c.id);
    assert.equal(p.dims, c.dims_mm, `${c.id}: dims copied as given`);
    assert.equal(p.dimsSource, c.dims_source, `${c.id}: dims source copied`);
    assert.equal(p.ownership, c.ownership, `${c.id}: ownership copied`);
  }
  assert.equal(parts.items.find((x) => x.id === 'BAT01').dimsFlag, 'conflict', 'Tattu size conflict stays flagged');
  assert.equal(parts.items.find((x) => x.id === 'SEN01').dimsFlag, 'unverified');
  const counts = Object.fromEntries(['Owned', 'Confirm', 'Planned'].map((k) => [k, parts.items.filter((x) => x.ownershipKey === k).length]));
  assert.ok(counts.Owned > 50 && counts.Confirm > 5 && counts.Planned > 5, JSON.stringify(counts));

  // edit a part, load again: the edit survives, nothing is duplicated
  await j('PUT', '/api/parts/BAT01', { dims: '163x65x55', dimsSource: 'Measured' });
  const again = (await j('POST', '/api/parts/seed', { set: 'mts-v1' })).body;
  assert.equal(again.parts.added, 0);
  assert.equal(again.parts.kept, 1);
  assert.equal(again.projects.created, 0);
  const bat = (await j('GET', '/api/parts/BAT01')).body;
  assert.equal(bat.dims, '163x65x55');
  assert.equal(bat.dimsFlag, 'given');
  assert.equal((await j('GET', '/api/projects')).body.length, 25);
  assert.equal((await j('GET', '/api/parts/seeds')).body[0].loaded, true);
  assert.equal((await j('POST', '/api/parts/seed', { set: '../etc' })).status, 400);
  assert.equal((await j('POST', '/api/parts/seed', { set: 'nope' })).status, 404);
});

test('seeded projects: ideas with priority and parts; assemblies with spec and missing files', async () => {
  const ps = (await j('GET', '/api/projects')).body;
  const ptz = ps.find((p) => p.source === 'seed:mts-v1:PR01');
  assert.match(ptz.name, /PTZ/);
  assert.equal(ptz.status, 'active');
  assert.equal(ptz.priority, 'high');
  assert.deepEqual(ptz.filesMissing, ['ptz_v5.zip', 'ptz_v4.zip', 'ptz_v1.zip']);
  assert.ok(ptz.components.some((c) => c.id === 'MOT04' && c.qty === 2));
  assert.match(ptz.description, /Inserts \(v5\)/, 'assembly spec kept as notes');
  assert.ok(ptz.tags.includes('assembly'));
  const tattu = ps.find((p) => p.source === 'seed:mts-v1:PR04');
  assert.equal(tattu.filesMissing.length, 1);
  const idea = ps.find((p) => p.source === 'seed:mts-v1:PR05');
  assert.equal(idea.status, 'idea');
  assert.equal(idea.priority, 'high');
  assert.ok(idea.tags.includes('print idea'));
  assert.equal(ps.filter((p) => p.status === 'idea').length + ps.filter((p) => p.status === 'active').length, 25);
});

test('parts API: add, import components.json, validation, delete', async () => {
  const add = await j('POST', '/api/parts', { id: 'TST01', name: 'Test part', category: 'Bench, fabrication and stock', ownership: 'Planned', dims: 'MEASURE' });
  assert.equal(add.status, 201);
  assert.equal(add.body.ownershipKey, 'Planned');
  assert.equal((await j('POST', '/api/parts', { id: 'bad id', name: 'x' })).status, 400);
  const imp = await j('POST', '/api/parts/import', { categories: ['New category'], items: [{ id: 'NEW01', category: 'New category', name: 'Imported', ownership: 'Owned', dims_mm: '10x10', dims_source: 'Stated' }] });
  assert.deepEqual(imp.body, { added: 1, updated: 0, kept: 0, total: 100 });
  assert.ok((await j('GET', '/api/parts')).body.categories.includes('New category'));
  assert.equal((await j('DELETE', '/api/parts/TST01')).status, 204);
  assert.deepEqual(fromComponents(await seedFile()).items.length, 98);
});

test('presets: thousands, no duplicate ids, no duplicate parameter sets', () => {
  const ps = listPresets();
  assert.ok(ps.length >= 3000, `expected thousands of presets, got ${ps.length}`);
  const ids = ps.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate preset id');
  const seen = new Map();
  for (const p of ps) {
    if (p.measure?.length) continue; // empty-size presets share defaults until measured
    const key = `${p.generator}|${JSON.stringify(resolveParams(getGenerator(p.generator).params, p.params))}`;
    assert.ok(!seen.has(key), `${p.id} has the same parameters as ${seen.get(key)}`);
    seen.set(key, p.id);
  }
});

test('part presets: linked to real parts, ownership and category set, measure fields empty', async () => {
  const raw = await seedFile();
  const ids = new Set(raw.items.map((c) => c.id));
  const mts = listPresets().filter((p) => p.component);
  assert.ok(mts.length >= 100, `${mts.length} part presets`);
  const covered = new Set(mts.map((p) => p.component));
  assert.ok(covered.size >= 90, `${covered.size} parts have presets`);
  for (const p of mts) {
    assert.ok(ids.has(p.component), `${p.id}: unknown part ${p.component}`);
    assert.ok(['Owned', 'Confirm', 'Planned'].includes(p.ownership), `${p.id}: ownership`);
    assert.ok(raw.categories.includes(p.category), `${p.id}: category ${p.category}`);
    for (const k of p.measure ?? []) assert.ok(!(k in p.params), `${p.id}: ${k} must stay empty`);
  }
  // a part marked MEASURE never gets invented sizes: its holder preset leaves them empty
  const pix = mts.find((p) => p.id === 'mts-fc01-tray');
  assert.deepEqual(pix.measure, ['itemWidth', 'itemLength', 'itemHeight']);
  // sizes given in the list are copied, and flagged when unverified
  const servo = mts.find((p) => p.id === 'mts-mot05-tray');
  assert.equal(servo.params.servoLength, 40.7);
  assert.ok(servo.verify.includes('earSpacing'));
  // the ownership filter used by the UI: owned presets exist, planned ones are separate
  const owned = mts.filter((p) => p.ownership === 'Owned');
  const planned = mts.filter((p) => p.ownership === 'Planned');
  assert.ok(owned.length > 50 && planned.length > 5);
  assert.ok(!owned.some((p) => planned.includes(p)));
  const bad = await j('GET', '/api/presets');
  assert.equal(bad.body.length, listPresets().length);
});

test('size series cover the main generators and mark where they came from', () => {
  const series = listPresets().filter((p) => p.series);
  const kinds = new Set(series.map((p) => p.series));
  for (const k of ['tube-clamps', 'spacers', 'gears', 'pulleys', 'bearing-blocks', 'bins', 'fit-tests']) assert.ok(kinds.has(k), `series ${k}`);
  assert.ok(series.filter((p) => p.series === 'tube-clamps').length >= 100);
  assert.ok(series.some((p) => p.id === 'gear-m1-20-s' || p.id === 'gear-m1-20'));
});

test('fit-test coupons and new bearings build clean', async () => {
  for (const params of [{ mode: 'insert', nominal: 4, depth: 6.5 }, { mode: 'hole', nominal: 16.2 }, { mode: 'peg', nominal: 5, step: 0.05, count: 7 }]) {
    const r = await generate('fit-test', params);
    for (const pt of r.parts) {
      assert.equal(openEdgeCount(pt.mesh), 0);
      assert.equal(stlEdgeIssues(pt.mesh), 0);
    }
  }
  const r = await generate('bearing-block', { bearing: '6806' });
  assert.match(r.notes.join(' '), /42\.\d+ x 7 mm for 6806/);
});

test('large JSON is gzipped when the client accepts it', async () => {
  const res = await new Promise((resolve, reject) => {
    request(`${base}/api/presets`, { headers: { 'accept-encoding': 'gzip' } }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ headers: r.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject).end();
  });
  assert.equal(res.headers['content-encoding'], 'gzip');
  const list = JSON.parse(gunzipSync(res.body).toString());
  assert.equal(list.length, listPresets().length);
  assert.ok(res.body.length < 400 * 1024, `gzipped size ${res.body.length}`);
});
