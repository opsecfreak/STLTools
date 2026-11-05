import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCatalog, DEFAULT_CATEGORIES } from '../src/core/catalog.js';
import { startServer } from '../src/server.js';
import { initKernel } from '../src/core/kernel.js';

let dir;
before(async () => { dir = await mkdtemp(join(tmpdir(), 'stltools-')); });
after(async () => { await rm(dir, { recursive: true, force: true }); });

test('catalog: codes count up per category and persist to disk', async () => {
  const c = createCatalog({ dataDir: join(dir, 'a') });
  assert.equal((await c.categories()).length, DEFAULT_CATEGORIES.length);
  const a = await c.add({ category: 'PRP', name: 'PROPS 5IN', presetId: 'drone-props-5in' });
  const b = await c.add({ category: 'PRP', name: 'PROPS 3IN', presetId: 'drone-props-3in', location: 'A2' });
  const m = await c.add({ category: 'MOT', name: 'MOTORS', presetId: 'drone-motors' });
  assert.deepEqual([a.code, b.code, m.code], ['PRP-001', 'PRP-002', 'MOT-001']);
  const saved = JSON.parse(await readFile(join(dir, 'a', 'catalog.json'), 'utf8'));
  assert.equal(saved.length, 3);
  // a fresh instance reads the same data
  assert.equal((await createCatalog({ dataDir: join(dir, 'a') }).items()).length, 3);
});

test('catalog: label text comes from the item, overrides are validated', async () => {
  const c = createCatalog({ dataDir: join(dir, 'b') });
  const item = await c.add({ category: 'FAS', name: 'M3 SCREWS', location: 'B4', presetId: 'drone-screws', overrides: { height: 45 } });
  const { generator, params } = await c.resolve(item);
  assert.equal(generator, 'stack-bin');
  assert.equal(params.labelText, 'M3 SCREWS');
  assert.equal(params.labelLine2, 'FAS-001 / B4');
  assert.equal(params.height, 45);
  await assert.rejects(c.add({ category: 'FAS', name: 'X', presetId: 'drone-screws', overrides: { height: -5 } }), /height/);
  await assert.rejects(c.add({ category: 'NOPE', name: 'X', presetId: 'drone-screws' }), /Unknown category/);
  await assert.rejects(c.add({ category: 'FAS', name: 'X', presetId: 'nope' }), /Unknown preset/);
});

test('catalog: generate returns the bin plus a matching label card', async () => {
  const c = createCatalog({ dataDir: join(dir, 'c') });
  const item = await c.add({ category: 'CON', name: 'XT60', presetId: 'bin-s-100x150' });
  const r = await c.generate(item.code);
  assert.deepEqual(r.parts.map((p) => p.name), ['bin', 'label-card']);
  assert.deepEqual((await c.get(item.code)).labelCard, { width: 72, height: 14 });
});

test('catalog: categories in use cannot be removed', async () => {
  const c = createCatalog({ dataDir: join(dir, 'd') });
  await c.add({ category: 'TLS', name: 'DRIVERS', presetId: 'rack-screwdrivers-8' });
  await assert.rejects(c.setCategories([{ code: 'PRP', name: 'Props' }]), /TLS still has items/);
  const next = await c.setCategories([...(await c.categories()), { code: 'yun', name: 'Yuneec parts', color: '#123456' }]);
  assert.ok(next.some((x) => x.code === 'YUN'));
});

test('catalog API over HTTP', async () => {
  await initKernel();
  const server = await startServer({ host: '127.0.0.1', port: 0, dataDir: join(dir, 'http') });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const add = await fetch(`${base}/api/catalog`, { method: 'POST', body: JSON.stringify({ category: 'GPS', name: 'GPS UNITS', presetId: 'drone-gps-rx' }) });
    assert.equal(add.status, 201);
    const item = await add.json();
    const gen = await (await fetch(`${base}/api/catalog/${item.code}/generate`, { method: 'POST' })).json();
    assert.equal(gen.parts[0].filename, 'GPS-001-bin.stl');
    assert.equal((await fetch(base + gen.parts[1].url)).status, 200);
    const upd = await (await fetch(`${base}/api/catalog/${item.code}`, { method: 'PUT', body: JSON.stringify({ location: 'C1' }) })).json();
    assert.equal(upd.location, 'C1');
    assert.equal((await fetch(`${base}/api/catalog/${item.code}`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${base}/api/catalog/${item.code}`)).status, 404);
    assert.ok((await (await fetch(`${base}/api/presets`)).json()).length >= 60);
  } finally {
    server.close();
  }
});
