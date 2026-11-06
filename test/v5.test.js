import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { initKernel } from '../src/core/kernel.js';

let dir, app, base;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stltools-v5-'));
  await initKernel();
  app = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir });
  base = `http://127.0.0.1:${app.address().port}`;
});
after(async () => {
  app.close();
  await rm(dir, { recursive: true, force: true });
});
const j = (method, path, body) => fetch(base + path, { method, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));

test('favorites toggle on and off and persist', async () => {
  let r = await j('POST', '/api/favorites/toggle', { kind: 'preset', id: 'clamp-mount-16' });
  assert.deepEqual(r.body.map((f) => f.id), ['clamp-mount-16']);
  await j('POST', '/api/favorites/toggle', { kind: 'generator', id: 'gear' });
  r = await j('POST', '/api/favorites/toggle', { kind: 'preset', id: 'clamp-mount-16' });
  assert.deepEqual(r.body.map((f) => `${f.kind}:${f.id}`), ['generator:gear']);
  assert.equal((await j('GET', '/api/favorites')).body.length, 1);
  assert.equal((await j('POST', '/api/favorites/toggle', { kind: 'nope', id: 'x' })).status, 400);
});

test('projects: create, add preset / design / custom parts, update, build ZIP', async () => {
  const design = (await j('POST', '/api/designs', { name: 'My clamp', generator: 'tube-clamp', params: { tubeOD: 12 } })).body;
  const p = (await j('POST', '/api/projects', { name: '7in long range', tags: ['Quad', 'LR'] })).body;
  assert.match(p.id, /^7in-long-range-[0-9a-f]{6}$/);
  assert.deepEqual(p.tags, ['quad', 'lr']);
  await j('POST', `/api/projects/${p.id}/items`, { kind: 'preset', ref: 'esc-on-arm-16', qty: 4 });
  await j('POST', `/api/projects/${p.id}/items`, { kind: 'design', ref: design.id });
  const withCustom = (await j('POST', `/api/projects/${p.id}/items`, { kind: 'custom', generator: 'spacer', params: { length: 12 }, name: 'Standoff 12' })).body;
  assert.equal(withCustom.items.length, 3);
  assert.equal(withCustom.items[0].name, 'ESC tray on a 16 mm arm', 'preset name filled in');
  assert.equal(withCustom.items[2].params.length, 12);
  assert.equal(withCustom.items[2].params.outerDiameter, 6, 'custom params resolved with defaults');
  assert.equal((await j('POST', `/api/projects/${p.id}/items`, { kind: 'preset', ref: 'nope' })).status, 400);
  assert.equal((await j('POST', `/api/projects/${p.id}/items`, { kind: 'custom', generator: 'spacer', params: { length: -1 } })).status, 400);

  const items = withCustom.items.map((it, i) => ({ ...it, printed: i === 0 }));
  const upd = (await j('PUT', `/api/projects/${p.id}`, { ...withCustom, items, status: 'printing' })).body;
  assert.equal(upd.status, 'printing');
  assert.equal(upd.items[0].printed, true);

  const all = (await j('POST', `/api/projects/${p.id}/build`)).body;
  assert.deepEqual(all.errors, []);
  const zip = Buffer.from(await (await fetch(base + all.zip)).arrayBuffer());
  const names = zip.toString('latin1').match(/7in-long-range-[\w.-]+\.stl|README\.txt/g);
  assert.ok(names.some((n) => n.includes('01-esc-tray-on-a-16-mm-arm-x4-holder')), names.join(' '));
  assert.ok(names.includes('README.txt'));
  const unprinted = (await j('POST', `/api/projects/${p.id}/build?unprinted=1`)).body;
  assert.ok(unprinted.files < all.files, 'printed parts skipped');

  await j('DELETE', `/api/designs/${design.id}`);
  const broken = (await j('POST', `/api/projects/${p.id}/build`)).body;
  assert.equal(broken.errors.length, 1, 'a deleted design is reported, the rest still builds');
  assert.equal((await j('DELETE', `/api/projects/${p.id}`)).status, 204);
  assert.equal((await j('GET', `/api/projects/${p.id}`)).status, 404);
});

test('thumbnails: lookup key matches the generation job, PNG upload, cache', async () => {
  const look = (await j('POST', '/api/thumbs/lookup', [{ generator: 'spacer', params: { length: 7 } }, { generator: 'nope' }])).body;
  assert.match(look[0].key, /^[0-9a-f]{16}$/);
  assert.equal(look[0].url, null);
  assert.ok(look[1].error);
  const gen = (await j('POST', '/api/generate/spacer', { length: 7 })).body;
  assert.equal(gen.job, look[0].key, 'browser can upload under the generation job key');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201f5a3f8f50000000049454e44ae426082', 'hex');
  assert.equal((await fetch(`${base}/api/thumbs/${gen.job}`, { method: 'PUT', body: Buffer.from('not a png') })).status, 400);
  assert.equal((await fetch(`${base}/api/thumbs/${gen.job}`, { method: 'PUT', body: png })).status, 200);
  assert.equal((await j('POST', '/api/thumbs/lookup', [{ generator: 'spacer', params: { length: 7 } }])).body[0].url, `/api/thumbs/${gen.job}.png`);
  const got = await fetch(`${base}/api/thumbs/${gen.job}.png`);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${base}/api/thumbs/0000000000000000.png`)).status, 404);
});
