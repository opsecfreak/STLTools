// v8: assemblies (gimbals, assembled matrices), per-part estimates, Simple mode
// lists, project assembly placement, and an end-to-end generation + export
// check for every generator (API STL and ZIP downloads, CLI files).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../src/server.js';
import { initKernel } from '../src/core/kernel.js';
import { generate, listGenerators } from '../src/core/registry.js';
import { openEdgeCount, stlEdgeIssues, meshStats } from '../src/core/export.js';
import { parseStl } from '../src/core/library.js';
import { listPresets } from '../src/core/presets.js';

const run = promisify(execFile);
let dir, app, base;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stltools-v8-'));
  await initKernel();
  app = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir });
  base = `http://127.0.0.1:${app.address().port}`;
});
after(async () => {
  app.close();
  await rm(dir, { recursive: true, force: true });
});
const j = (method, path, body) => fetch(base + path, { method, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));

/** Bounding box of a printed mesh moved by its assembled matrix. */
function assembledBox(part) {
  const m = part.assembled;
  const p = part.mesh.positions;
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let r = 0; r < 3; r++) {
      const v = m[r] * p[i] + m[4 + r] * p[i + 1] + m[8 + r] * p[i + 2] + m[12 + r];
      mn[r] = Math.min(mn[r], v);
      mx[r] = Math.max(mx[r], v);
    }
  }
  return { mn, mx };
}

test('gimbal assemblies: watertight parts, valid matrices, parts land where they belong', async () => {
  for (const id of ['servo-gimbal', 'brushless-gimbal']) {
    const g = listGenerators().find((x) => x.id === id);
    assert.equal(g.assembly, true);
    for (const opts of [{}, { camera: 'plate' }, { camera: 'none' }]) {
      if (id === 'brushless-gimbal' && opts.camera) continue;
      const r = await generate(id, opts);
      assert.equal(r.parts.length, 3);
      for (const pt of r.parts) {
        assert.equal(openEdgeCount(pt.mesh), 0, `${id}/${pt.name} open edges`);
        assert.equal(stlEdgeIssues(pt.mesh), 0, `${id}/${pt.name} STL edges`);
        assert.equal(meshStats(pt.mesh).min[2], 0, `${id}/${pt.name} on the bed`);
        const m = pt.assembled;
        assert.equal(m.length, 16);
        // rotation part is orthonormal
        const col = (c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
        for (const c of [0, 1, 2]) assert.ok(Math.abs(Math.hypot(...col(c)) - 1) < 1e-5);
        assert.ok(Math.abs(col(0).reduce((s, v, i) => s + v * col(1)[i], 0)) < 1e-5);
      }
    }
  }
  // servo gimbal defaults: base top = 3 + 15.5; pan horn face = 3 + 22.5 + 4.5; camera arm starts at the tilt horn
  const r = await generate('servo-gimbal', {});
  const [b, pb, cam] = r.parts.map(assembledBox);
  assert.ok(Math.abs(b.mn[2]) < 0.01 && Math.abs(b.mx[2] - 18.5) < 0.01, `base z ${b.mn[2]}..${b.mx[2]}`);
  assert.ok(Math.abs(pb.mn[2] - 30) < 0.01, `pan bracket starts at the horn face: ${pb.mn[2]}`);
  assert.ok(Math.abs(cam.mn[1] - 15.75) < 0.01, `camera arm starts at the tilt horn: ${cam.mn[1]}`);
  assert.ok(pb.mn[2] >= b.mx[2], 'pan bracket above the base');
});

test('generator list: Simple-mode lists name real settings', () => {
  for (const g of listGenerators()) {
    for (const k of g.basic) assert.ok(g.params[k], `${g.id}: basic ${k}`);
  }
  const clamp = listGenerators().find((g) => g.id === 'tube-clamp');
  assert.deepEqual(clamp.basic, ['type', 'tubeOD', 'tubeOD2', 'length', 'bolt']);
});

test('assembly presets: linked to parts, unmeasured sizes left empty', () => {
  const ps = listPresets().filter((p) => p.generator === 'servo-gimbal' || p.generator === 'brushless-gimbal');
  assert.ok(ps.length >= 6);
  const mg = ps.find((p) => p.id === 'gimbal-servo-mg996r');
  assert.equal(mg.component, 'MOT05');
  assert.equal(mg.params.servoLength, 40.7);
  assert.deepEqual(mg.measure, ['servoHeight', 'earZ', 'hornClear']);
  for (const k of mg.measure) assert.ok(!(k in mg.params));
  assert.equal(ps.find((p) => p.id === 'gimbal-brushless-gopro').component, 'FC04');
});

test('generation and export end to end: every generator, every STL and ZIP download parses', async () => {
  const gens = listGenerators();
  assert.ok(gens.length >= 48, `${gens.length} generators`);
  for (const g of gens) {
    const r = await j('POST', `/api/generate/${g.id}`, {});
    assert.equal(r.status, 200, `${g.id}: ${r.body?.error}`);
    for (const pt of r.body.parts) {
      const res = await fetch(base + pt.url);
      assert.equal(res.status, 200, `${g.id}/${pt.name} download`);
      assert.match(res.headers.get('content-disposition'), /\.stl"/);
      const buf = Buffer.from(await res.arrayBuffer());
      const mesh = parseStl(buf);
      assert.equal(mesh.positions.length / 9, pt.stats.triangles, `${g.id}/${pt.name}: triangle count in the file`);
      const s = meshStats(mesh);
      assert.ok(Math.abs(s.volumeMm3 - pt.stats.volumeMm3) <= Math.max(1, pt.stats.volumeMm3 * 1e-4), `${g.id}/${pt.name}: volume in the file`);
      assert.ok(pt.stats.areaMm2 > 0 && pt.stats.size.every((v) => v > 0));
    }
    if (r.body.parts.length > 1) {
      const zip = Buffer.from(await (await fetch(base + r.body.zip)).arrayBuffer());
      assert.equal(zip.readUInt32LE(0), 0x04034b50, `${g.id}: ZIP header`);
      for (const pt of r.body.parts) assert.ok(zip.includes(Buffer.from(pt.filename)), `${g.id}: ${pt.filename} in the ZIP`);
    }
    if (g.assembly) assert.ok(r.body.parts.every((pt) => pt.assembled?.length === 16), `${g.id}: assembled matrices in the API`);
  }
});

test('CLI export: gen writes STL files and a params file that loads again', async () => {
  const out = join(dir, 'cli');
  await run(process.execPath, ['bin/stltools.js', 'gen', 'servo-gimbal', '-o', out, '--camera', 'plate']);
  const files = (await readdir(out)).sort();
  assert.deepEqual(files, ['servo-gimbal-base.stl', 'servo-gimbal-camera-arm.stl', 'servo-gimbal-pan-bracket.stl', 'servo-gimbal.params.json']);
  for (const f of files.filter((x) => x.endsWith('.stl'))) assert.ok(parseStl(await readFile(join(out, f))).positions.length > 0);
  const params = JSON.parse(await readFile(join(out, 'servo-gimbal.params.json'), 'utf8'));
  assert.equal(params.params.camera, 'plate');
  const again = join(dir, 'cli2');
  await run(process.execPath, ['bin/stltools.js', 'gen', 'servo-gimbal', '-o', again, '--params', join(out, 'servo-gimbal.params.json')]);
  assert.equal((await readdir(again)).length, 4);
  // a preset with unmeasured sizes refuses until they are given
  await assert.rejects(run(process.execPath, ['bin/stltools.js', 'preset', 'gimbal-servo-mg996r', '-o', join(dir, 'cli3')]), /Needs measurement/);
  await run(process.execPath, ['bin/stltools.js', 'preset', 'gimbal-servo-mg996r', '-o', join(dir, 'cli3'), '--servoHeight', '37', '--earZ', '27', '--hornClear', '5']);
  assert.equal((await readdir(join(dir, 'cli3'))).filter((f) => f.endsWith('.stl')).length, 3);
});

test('project build: per-part list with STL links, estimates, assembled matrices; places saved', async () => {
  const p = (await j('POST', '/api/projects', { name: 'Gimbal build', items: [
    { kind: 'preset', ref: 'gimbal-servo-9g-fpv', qty: 1, place: { x: 10, y: 0, z: 0, rx: 0, ry: 0, rz: 90 } },
    { kind: 'custom', generator: 'spacer', params: { length: 12 }, name: 'Standoff', qty: 4, place: { x: 99999, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } },
  ] })).body;
  assert.deepEqual(p.items[0].place, { x: 10, y: 0, z: 0, rx: 0, ry: 0, rz: 90 });
  assert.equal(p.items[1].place.x, 2000, 'place clamped');
  const r = (await j('POST', `/api/projects/${p.id}/build`)).body;
  assert.deepEqual(r.errors, []);
  assert.equal(r.parts.length, 4, '3 gimbal parts + 1 spacer');
  assert.equal(r.parts.filter((pt) => pt.assembled).length, 3);
  assert.equal(r.parts[3].qty, 4);
  for (const pt of r.parts) {
    assert.ok(pt.estimate.seconds > 0 && pt.estimate.grams > 0, `${pt.name} estimate`);
    const res = await fetch(base + pt.url);
    assert.equal(res.status, 200);
    assert.equal(parseStl(Buffer.from(await res.arrayBuffer())).positions.length / 9, pt.stats.triangles);
  }
  const total = r.parts.reduce((s, pt) => s + pt.estimate.seconds * pt.qty, 0);
  assert.ok(Math.abs(r.estimate.seconds - total - r.estimate.heatUp) < 1, 'total = parts x qty + heat-up');
  const zip = Buffer.from(await (await fetch(base + r.zip)).arrayBuffer()).toString('latin1');
  assert.match(zip, /Per STL file/);
  assert.match(zip, /02-standoff-x4-spacer\.stl  x4: /);
});
