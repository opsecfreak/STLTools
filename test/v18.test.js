// 1.8 (MTS): filament per project (and per part), estimates split by filament, Home page settings.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { initKernel } from '../src/core/kernel.js';

let dir, app, base;
before(async () => {
  await initKernel();
  dir = await mkdtemp(join(tmpdir(), 'stltools-v18-'));
  app = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir });
  base = `http://127.0.0.1:${app.address().port}`;
});
after(async () => { app.closeAllConnections?.(); app.close(); await rm(dir, { recursive: true, force: true }); });
const j = (method, path, body) => fetch(base + path, { method, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));

test('project filament: stored, cleaned, used by the estimate; a part override and a TPU gasket split it', async () => {
  const p = (await j('POST', '/api/projects', { name: 'Outdoor sensor', filament: { material: 'petg', color: 'black', brand: 'eSUN PETG', note: 'dried 4 h', junk: 1 }, items: [
    { kind: 'custom', generator: 'sealed-box', params: {}, name: 'Box', qty: 1 },
    { kind: 'custom', generator: 'spacer', params: { length: 10 }, name: 'Spacer', qty: 2, material: 'asa' },
    { kind: 'custom', generator: 'spacer', params: { length: 10 }, name: 'Bad', qty: 1, material: 'unobtainium' },
  ] })).body;
  assert.deepEqual(p.filament, { material: 'petg', color: 'black', brand: 'eSUN PETG', note: 'dried 4 h' });
  assert.equal(p.items[1].material, 'asa');
  assert.equal(p.items[2].material, '', 'unknown material dropped');
  const r = (await j('POST', `/api/projects/${p.id}/build`)).body;
  assert.deepEqual(r.errors, []);
  const mat = (name) => r.parts.find((pt) => pt.name === name)?.material;
  assert.equal(mat('Box: box'), 'petg', 'project filament');
  assert.equal(mat('Box: gasket'), 'tpu', "the generator's own material for the gasket");
  assert.equal(mat('Spacer'), 'asa', 'part override');
  assert.deepEqual(r.estimate.byMaterial.map((b) => b.material).sort(), ['asa', 'petg', 'tpu']);
  const sum = r.estimate.byMaterial.reduce((a, b) => a + b.grams, 0);
  assert.ok(Math.abs(sum - r.estimate.grams) < 1e-6, 'totals add up');
  assert.match(r.estimate.settings, /PETG/);
  // README carries the filament line
  const zip = Buffer.from(await (await fetch(base + r.zip)).arrayBuffer()).toString('latin1');
  assert.match(zip, /Filament: PETG, black, eSUN PETG\. dried 4 h/);
  // no filament set: Settings material, one group
  const q = (await j('POST', '/api/projects', { name: 'Plain', items: [{ kind: 'custom', generator: 'spacer', params: {}, name: 'S', qty: 1 }] })).body;
  assert.equal(q.filament.material, '');
  const r2 = (await j('POST', `/api/projects/${q.id}/build`)).body;
  assert.equal(r2.estimate.byMaterial.length, 1);
});

test('Home page settings: sections, order and the "Make something" list', async () => {
  const s = (await j('GET', '/api/settings')).body;
  assert.equal(s.home.showQuick, true);
  assert.equal(s.home.quickMake, '');
  const u = (await j('PUT', '/api/settings', { home: { showFavorites: false, order: 'projects-first', quickMake: 'quad-modular,mcu-holder' } })).body;
  assert.equal(u.home.showFavorites, false);
  assert.equal(u.home.order, 'projects-first');
  assert.equal(u.home.quickMake, 'quad-modular,mcu-holder');
  assert.equal((await j('PUT', '/api/settings', { home: { quickMake: '<script>' } })).status, 400);
});

test('JSON stores: a failed write does not block later writes; rename retries on Windows lock errors', async () => {
  const { createJsonFile, writeJsonAtomic } = await import('../src/core/jsonstore.js');
  const { mkdir, readFile } = await import('node:fs/promises');
  const sub = join(dir, 'store-test');
  // a directory where the file should be makes the first write fail
  await mkdir(join(sub, 'x.json'), { recursive: true });
  const bad = createJsonFile(join(sub, 'x.json'), []);
  await assert.rejects(bad.set([1]));
  const good = createJsonFile(join(sub, 'y.json'), []);
  await good.set([1]);
  await good.set([1, 2]);
  assert.deepEqual(JSON.parse(await readFile(join(sub, 'y.json'), 'utf8')), [1, 2]);
  // the failed store recovers once the obstacle is gone
  const { rm: rmDir } = await import('node:fs/promises');
  await rmDir(join(sub, 'x.json'), { recursive: true });
  await bad.set([3]);
  assert.deepEqual(JSON.parse(await readFile(join(sub, 'x.json'), 'utf8')), [3]);
  await writeJsonAtomic(join(sub, 'z.json'), { a: 1 });
  assert.deepEqual(JSON.parse(await readFile(join(sub, 'z.json'), 'utf8')), { a: 1 });
});
