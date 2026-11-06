// v7: My Parts (seed: example), ownership, needs-measurement presets, categories,
// no duplicate presets, size series, project ideas and assemblies, gzip.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
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
const seedFile = async () => JSON.parse(await readFile('seed/example/components.json', 'utf8'));
// The personal edition (branch mts-personal, EDITION.json) ships its own parts list
// and part-linked presets instead of the public example list and hw-* presets.
const EDITION = existsSync('EDITION.json') ? JSON.parse(readFileSync('EDITION.json', 'utf8')) : { edition: 'public' };
const PUBLIC = EDITION.edition === 'public';
const HAS_EXAMPLE = existsSync('seed/example/components.json');

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

test('seed example: parts in their categories, project ideas, repeat load adds nothing', { skip: !HAS_EXAMPLE && 'no example list in this edition' }, async () => {
  assert.deepEqual((await j('GET', '/api/parts/seeds')).body, [{ set: 'example', title: 'Example parts list', loaded: false }]);
  const raw = await seedFile();
  const r = (await j('POST', '/api/parts/seed', { set: 'example' })).body;
  assert.equal(r.parts.added, raw.items.length);
  assert.equal(r.projects.created, 3);
  const parts = (await j('GET', '/api/parts')).body;
  assert.deepEqual(parts.categories, raw.categories, 'category list from the seed');
  for (const c of raw.items) {
    const p = parts.items.find((x) => x.id === c.id);
    assert.equal(p.dims, c.dims_mm, `${c.id}: dims copied as given`);
    assert.equal(p.ownership, c.ownership, `${c.id}: ownership copied`);
  }
  assert.equal(parts.items.find((x) => x.id === 'SEN01').dimsFlag, 'unverified');
  assert.equal(parts.items.find((x) => x.id === 'FC02').dimsFlag, 'measure');
  assert.equal(parts.items.find((x) => x.id === 'MEC01').dimsFlag, 'standard');
  // edit a part, load again: the edit survives, nothing is duplicated
  await j('PUT', '/api/parts/FC02', { dims: '81.5x50x15.5', dimsSource: 'Measured' });
  const again = (await j('POST', '/api/parts/seed', { set: 'example' })).body;
  assert.equal(again.parts.added, 0);
  assert.equal(again.parts.kept, 1);
  assert.equal(again.projects.created, 0);
  assert.equal((await j('GET', '/api/parts/FC02')).body.dimsFlag, 'given');
  assert.equal((await j('GET', '/api/projects')).body.length, 3);
  assert.equal((await j('GET', '/api/parts/seeds')).body[0].loaded, true);
  assert.equal((await j('POST', '/api/parts/seed', { set: '../etc' })).status, 400);
  assert.equal((await j('POST', '/api/parts/seed', { set: 'nope' })).status, 404);
});

test('seeded projects: ideas with priority and linked parts; assembly specs attach to their candidate', { skip: !HAS_EXAMPLE && 'no example list in this edition' }, async () => {
  const ps = (await j('GET', '/api/projects')).body;
  const pan = ps.find((p) => p.source === 'seed:example:PR02');
  assert.equal(pan.status, 'idea');
  assert.equal(pan.priority, 'medium');
  assert.deepEqual(pan.components, [{ id: 'MOT01', qty: 2 }, { id: 'VID01', qty: 1 }]);
  assert.ok(pan.tags.includes('print idea'));
});

test('parts API: add, import components.json, validation, delete', { skip: !HAS_EXAMPLE && 'no example list in this edition' }, async () => {
  const add = await j('POST', '/api/parts', { id: 'TST01', name: 'Test part', category: 'Bench, fabrication and stock', ownership: 'Planned', dims: 'MEASURE' });
  assert.equal(add.status, 201);
  assert.equal(add.body.ownershipKey, 'Planned');
  assert.equal((await j('POST', '/api/parts', { id: 'bad id', name: 'x' })).status, 400);
  const imp = await j('POST', '/api/parts/import', { categories: ['New category'], items: [{ id: 'NEW01', category: 'New category', name: 'Imported', ownership: 'Owned', dims_mm: '10x10', dims_source: 'Stated' }] });
  assert.deepEqual(imp.body, { added: 1, updated: 0, kept: 0, total: (await seedFile()).items.length + 2 });
  assert.ok((await j('GET', '/api/parts')).body.categories.includes('New category'));
  assert.equal((await j('DELETE', '/api/parts/TST01')).status, 204);
  assert.deepEqual(fromComponents(await seedFile()).items.length, (await seedFile()).items.length);
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

test('personal edition: part presets link to real parts in its seed', { skip: PUBLIC && 'public edition' }, async () => {
  const seed = JSON.parse(await readFile(`seed/${EDITION.seed}/components.json`, 'utf8'));
  const ids = new Set(seed.items.map((c) => c.id));
  const linked = listPresets().filter((p) => p.component);
  assert.ok(linked.length >= 100, `${linked.length} part presets`);
  for (const p of linked) {
    assert.ok(ids.has(p.component), `${p.id}: unknown part ${p.component}`);
    assert.ok(['Owned', 'Confirm', 'Planned'].includes(p.ownership), `${p.id}: ownership`);
    for (const k of p.measure ?? []) assert.ok(!(k in p.params), `${p.id}: ${k} must stay empty`);
  }
});

test('hardware presets: categories set, measure fields empty, no personal part links in shipped presets', { skip: !PUBLIC && 'personal edition' }, () => {
  const hw = listPresets().filter((p) => p.id.startsWith('hw-'));
  assert.ok(hw.length >= 100, `${hw.length} hardware presets`);
  for (const p of hw) {
    assert.ok(p.category, `${p.id}: category`);
    for (const k of p.measure ?? []) assert.ok(!(k in p.params), `${p.id}: ${k} must stay empty`);
  }
  for (const p of listPresets()) assert.ok(!p.component && !p.ownership, `${p.id}: shipped presets carry no personal part links`);
  // a part nobody measured never gets invented sizes: its holder leaves them empty
  assert.deepEqual(hw.find((p) => p.id === 'hw-pixhawk-v5-tray-on-a-damper-plate').measure, ['itemWidth', 'itemLength', 'itemHeight']);
  const servo = hw.find((p) => p.id === 'hw-mg996r-servo-tray');
  assert.equal(servo.params.servoLength, 40.7);
  assert.ok(servo.verify.includes('earSpacing'));
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
