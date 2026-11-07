// 1.4 (MTS): part splitter and plate arranger. Pieces fit the bed, stay watertight,
// get alignment holes on every cut; parts that fit keep their print orientation;
// packing uses as few plates as needed; the API returns plates with estimates.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initKernel, createScope, toPlainMesh } from '../src/core/kernel.js';
import { splitToFit, placeOnBed, arrange, bbox } from '../src/core/split.js';
import { openEdgeCount, stlEdgeIssues, toStl } from '../src/core/export.js';
import { startServer } from '../src/server.js';

const BED = { x: 220, y: 220, z: 250 };
let dir, app, base;
before(async () => {
  await initKernel();
  dir = await mkdtemp(join(tmpdir(), 'stltools-v14-'));
  app = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir });
  base = `http://127.0.0.1:${app.address().port}`;
});
after(async () => { app.close(); await rm(dir, { recursive: true, force: true }); });
const post = (p, b) => fetch(base + p, { method: 'POST', body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('splitter: a 500 mm bar becomes 3 watertight pieces with pin holes on both cuts', () => {
  const k = createScope();
  try {
    const bar = k.track(k.Manifold.cube([500, 30, 20]));
    const r = splitToFit(k, bar, { bed: BED, joint: 'pins', pinDiameter: 4, pinLength: 12, clearance: 0.2 });
    assert.equal(r.pieces.length, 3);
    assert.deepEqual(r.cuts.map((c) => c.holes), [2, 2]);
    const holeVol = Math.PI * 2.2 ** 2 * 6.6; // radius 2 + 0.2, half of 12 + 0.6 deep
    const total = r.pieces.reduce((s, p) => s + p.volume(), 0);
    assert.ok(Math.abs(500 * 30 * 20 - total - 4 * 2 * holeVol) < 50, `volume removed by 8 half-holes (${total})`);
    for (const p of r.pieces) {
      const placed = placeOnBed(k, p, BED);
      assert.ok(placed.size[0] <= 220 && placed.size[1] <= 220 && placed.size[2] <= 250);
      const m = toPlainMesh(placed.manifold);
      assert.equal(openEdgeCount(m), 0);
      assert.equal(stlEdgeIssues(m), 0);
      assert.ok(Math.abs(bbox(placed.manifold).min[2]) < 1e-6, 'on the plate');
    }
    const none = splitToFit(k, k.track(k.Manifold.cube([300, 20, 20])), { bed: BED, joint: 'none' });
    assert.equal(none.pieces.length, 2);
    assert.deepEqual(none.cuts.map((c) => c.holes), [0]);
  } finally { k.free(); }
});

test('placement keeps print orientation when it fits; arranging packs plates', () => {
  const k = createScope();
  try {
    const tall = placeOnBed(k, k.track(k.Manifold.cube([180, 20, 200])), BED);
    assert.deepEqual(tall.rot.slice(0, 2), [0, 0], 'a standing wing section stays standing');
    const tooLong = placeOnBed(k, k.track(k.Manifold.cube([230, 20, 30])), BED);
    assert.equal(Math.round(tooLong.size[2]), 230, 'turned upright only because it is longer than the bed');
    const plates = arrange(Array.from({ length: 10 }, () => ({ w: 100, d: 100 })), { bed: { x: 214, y: 214 }, spacing: 5 });
    assert.equal(plates.length, 3, '4 per plate');
    assert.ok(plates.flat().every((it) => it.x + it.w <= 214 && it.y + it.d <= 214));
    assert.throws(() => arrange([{ w: 300, d: 10 }], { bed: { x: 214, y: 214 } }), /larger than the bed/);
  } finally { k.free(); }
});

test('split API: wing sections packed standing on one plate with an estimate; a long STL is cut with pins', async () => {
  const g = (await post('/api/generate/rc-wing', { wingspan: 800, controlSurface: 'none', servoBay: false, bothSides: true })).body;
  const r = (await post('/api/split', { job: g.job })).body;
  assert.equal(r.plates.length, 1);
  assert.equal(r.plates[0].count, 4);
  assert.ok(r.plates[0].stats.size[2] > 190, 'sections stand');
  assert.ok(r.plates[0].estimate.seconds > 0);
  const k = createScope();
  const bar = toStl(toPlainMesh(k.Manifold.cube([450, 40, 25])), { name: 'bar' });
  k.free();
  const up = await (await fetch(`${base}/api/library/upload?filename=bar.stl`, { method: 'PUT', body: bar })).json();
  const s = (await post('/api/split', { library: up.id, joint: 'pins' })).body;
  assert.equal(s.pieces.filter((p) => !p.pin).length, 3);
  assert.equal(s.pins, 4);
  assert.ok(s.pieces.find((p) => p.pin).qty === 4);
  assert.match(s.readme, /4 printed pins 4 x 12 mm/);
  const plate = await fetch(base + s.plates[0].url);
  assert.equal(plate.status, 200);
  assert.equal((await post('/api/split', { job: 'nope' })).status, 404);
});
