import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';
import { initKernel } from '../src/core/kernel.js';

let server;
let base;

before(async () => {
  await initKernel();
  server = await startServer({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('lists generators', async () => {
  const res = await fetch(`${base}/api/generators`);
  const list = await res.json();
  assert.ok(list.some((g) => g.id === 'parts-box'));
  assert.ok(list.some((g) => g.id === 'rc-wing'));
});

test('generates and serves an STL', async () => {
  const res = await fetch(`${base}/api/generate/parts-box`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ width: 60, depth: 40, height: 20 }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.parts.length, 2);
  const stl = await fetch(base + data.parts[0].url);
  assert.equal(stl.status, 200);
  const buf = Buffer.from(await stl.arrayBuffer());
  assert.equal(buf.readUInt32LE(80), data.parts[0].stats.triangles);
});

test('rejects bad params with 400', async () => {
  const res = await fetch(`${base}/api/generate/parts-box`, { method: 'POST', body: JSON.stringify({ width: -1 }) });
  assert.equal(res.status, 400);
  assert.match((await res.json()).errors[0], /width/);
});

test('unknown generator is 404, path traversal is blocked', async () => {
  assert.equal((await fetch(`${base}/api/generate/nope`, { method: 'POST' })).status, 404);
  assert.notEqual((await fetch(`${base}/vendor/three/..%2f..%2fpackage.json`)).status, 200);
  assert.notEqual((await fetch(`${base}/..%2fpackage.json`)).status, 200);
});

test('serves the UI and three.js', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/vendor/three/build/three.module.js`)).status, 200);
});
