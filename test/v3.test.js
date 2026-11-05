import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, listGenerators } from '../src/core/registry.js';
import { meshStats, openEdgeCount, stlEdgeIssues } from '../src/core/export.js';
import { listPresets } from '../src/core/presets.js';
import { createDesignStore } from '../src/core/designs.js';
import { createZip, crc32 } from '../src/core/zip.js';
import { startServer } from '../src/server.js';
import { initKernel } from '../src/core/kernel.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const clean = (label, part) => {
  assert.equal(openEdgeCount(part.mesh), 0, `${label}/${part.name}: open edges`);
  assert.equal(stlEdgeIssues(part.mesh), 0, `${label}/${part.name}: STL edge issues`);
  const s = meshStats(part.mesh);
  assert.ok(s.volumeMm3 > 0, `${label}/${part.name}: volume`);
  near(s.min[2], 0, 0.01, `${label}/${part.name}: on the bed`);
  return s;
};

let dir;
before(async () => { dir = await mkdtemp(join(tmpdir(), 'stltools-v3-')); });
after(async () => { await rm(dir, { recursive: true, force: true }); });

test('every generator has sections and every select option builds a clean part', async () => {
  const gens = listGenerators();
  assert.ok(gens.length >= 35, `expected 35+ generators, got ${gens.length}`);
  for (const g of gens) {
    assert.ok(g.sections.length > 0, `${g.id} has no sections`);
    for (const [key, def] of Object.entries(g.params)) {
      if (def.type !== 'select') continue;
      for (const o of def.options) {
        const r = await generate(g.id, { [key]: o.value });
        for (const part of r.parts) clean(`${g.id} ${key}=${o.value}`, part);
      }
    }
  }
});

test('presets cover every tab', () => {
  const by = {};
  for (const p of listPresets()) by[p.section] = (by[p.section] ?? 0) + 1;
  for (const s of ['shop', 'planes', 'quads', 'accessories', 'robotics']) assert.ok(by[s] >= 15, `${s} has ${by[s] ?? 0} presets`);
  assert.ok(listPresets().length >= 200);
});

test('rc-wing: wingspan, aileron cut with gap, servo pocket, halfSpan migration', async () => {
  const base = { wingspan: 600, maxSectionHeight: 400, servoBay: false };
  const plain = await generate('rc-wing', { ...base, controlSurface: 'none' });
  const cut = await generate('rc-wing', { ...base, surfaceStart: 100, surfaceLength: 150 });
  assert.deepEqual(cut.parts.map((p) => p.name), ['right-section1', 'right-surface1']);
  const vPlain = meshStats(plain.parts[0].mesh).volumeMm3;
  const vWing = meshStats(cut.parts[0].mesh).volumeMm3;
  const vSurf = meshStats(cut.parts[1].mesh).volumeMm3;
  assert.ok(vWing + vSurf < vPlain, 'gap and bevel remove material');
  assert.ok(vWing + vSurf > vPlain * 0.95, 'nothing else is lost');
  near(meshStats(cut.parts[1].mesh).size[2], 150 - 2 * 0.8, 0.05, 'surface length minus end gaps');
  const pocket = await generate('rc-wing', { ...base, controlSurface: 'none', servoBay: true, servoPosition: 120 });
  assert.ok(meshStats(pocket.parts[0].mesh).volumeMm3 < vPlain - 23.5 * 12.5 * 8, 'servo pocket removed');
  const old = await generate('rc-wing', { halfSpan: 300, controlSurface: 'none', servoBay: false, maxSectionHeight: 400 });
  assert.equal(old.params.wingspan, 600);
  near(meshStats(old.parts[0].mesh).volumeMm3, vPlain, 1, 'halfSpan converts to wingspan');
});

test('tube clamp and joint sizes', async () => {
  const c = await generate('tube-clamp', { type: 'split', tubeOD: 16, length: 20 });
  near(clean('split', c.parts[0]).size[2], 20, 0.01, 'clamp length is the print height');
  const pair = await generate('tube-clamp', { type: 'parallel' });
  assert.equal(pair.parts.length, 2);
  const j = await generate('tube-joint', { type: 'tee', tubeOD: 10, clearance: 0.2, wall: 2.4 });
  near(clean('tee', j.parts[0]).size[2], 2 * (5.2 + 2.4), 0.01, 'flat joint height = socket outer diameter');
});

test('gear outside diameter = m x (z + 2)', async () => {
  const r = await generate('gear', { module: 2, teeth: 30, bore: 0 });
  near(meshStats(r.parts[0].mesh).size[0], 2 * 32, 0.1, 'outside diameter');
});

test('saved designs: add, update, list, validate, delete', async () => {
  const d = createDesignStore({ dataDir: join(dir, 'designs') });
  const a = await d.add({ name: 'Arm clamp 16', generator: 'tube-clamp', params: { tubeOD: 16 }, section: 'accessories' });
  assert.match(a.id, /^arm-clamp-16-[0-9a-f]{6}$/);
  assert.equal(a.params.tubeOD, 16);
  assert.equal(a.params.length, 16, 'defaults are filled in');
  const b = await d.update(a.id, { params: { ...a.params, length: 30 } });
  assert.equal(b.params.length, 30);
  assert.equal((await createDesignStore({ dataDir: join(dir, 'designs') }).list()).length, 1, 'persisted');
  await assert.rejects(d.add({ name: 'x', generator: 'nope', params: {} }), /Unknown generator/);
  await assert.rejects(d.add({ name: 'x', generator: 'tube-clamp', params: { tubeOD: -1 } }), /tubeOD/);
  await assert.rejects(d.add({ name: '', generator: 'tube-clamp' }), /Name/);
  const w = await d.add({ name: 'Old wing', generator: 'rc-wing', params: { halfSpan: 250 } });
  assert.equal(w.params.wingspan, 500, 'old wing files convert');
  await d.remove(a.id);
  assert.equal((await d.list()).length, 1);
});

test('zip: valid structure and CRCs', () => {
  const files = [{ name: 'a.stl', data: Buffer.from('hello') }, { name: 'b.stl', data: Buffer.alloc(1000, 7) }];
  const zip = createZip(files);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 10), 2);
  let off = zip.readUInt32LE(end + 16);
  for (const f of files) {
    assert.equal(zip.readUInt32LE(off), 0x02014b50);
    assert.equal(zip.readUInt32LE(off + 16), crc32(f.data));
    const local = zip.readUInt32LE(off + 42);
    const nameLen = zip.readUInt16LE(local + 26);
    assert.equal(zip.subarray(local + 30 + nameLen, local + 30 + nameLen + f.data.length).toString('hex'), f.data.toString('hex'));
    off += 46 + zip.readUInt16LE(off + 28);
  }
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926, 'standard CRC-32 check value');
});

test('designs and zip over HTTP', async () => {
  await initKernel();
  const server = await startServer({ host: '127.0.0.1', port: 0, dataDir: join(dir, 'http') });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const add = await fetch(`${base}/api/designs`, { method: 'POST', body: JSON.stringify({ name: 'GPS', generator: 'gps-mast', params: {} }) });
    assert.equal(add.status, 201);
    const d = await add.json();
    assert.equal(d.section, 'accessories');
    assert.equal((await (await fetch(`${base}/api/designs`)).json()).length, 1);
    const gen = await (await fetch(`${base}/api/generate/gps-mast`, { method: 'POST', body: '{}' })).json();
    assert.ok(gen.zip, 'multi-part result links a zip');
    const zip = await fetch(base + gen.zip);
    assert.equal(zip.status, 200);
    assert.equal(zip.headers.get('content-type'), 'application/zip');
    const buf = Buffer.from(await zip.arrayBuffer());
    assert.equal(buf.readUInt16LE(buf.length - 22 + 10), 2, 'base + top');
    assert.equal((await fetch(`${base}/api/designs/${d.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${base}/api/designs/${d.id}`)).status, 404);
  } finally {
    server.close();
  }
});
