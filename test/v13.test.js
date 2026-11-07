// 1.3 (MTS): Stress Lab engines checked against textbook results, plus the materials API.
//   voxel FEA vs Euler-Bernoulli cantilever, failure across layers, weak points and
//   supports, rain pooling, panel method vs thin-airfoil theory, section extraction in
//   every orientation, ISA air, environment checks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { voxelize, idx, depthMap, meshVolume } from '../src/core/lab/voxel.js';
import { solve, failure } from '../src/core/lab/fea.js';
import { thinWalls, supports, waterPools, crossSections, overhangs } from '../src/core/lab/weak.js';
import { naca4, panel, section, air, wingPolar, bodyDrag } from '../src/core/lab/aero.js';
import { heatCheck, uvTimeline, fatigueLife, dropAccel } from '../src/core/lab/env.js';
import { naca4Outline } from '../src/core/airfoil.js';
import { startServer } from '../src/server.js';
import { initKernel } from '../src/core/kernel.js';

/** Closed box mesh from (x0,y0,z0) to (x1,y1,z1). */
function box(x0, y0, z0, x1, y1, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return f.flatMap((t) => t.flatMap((k) => v[k]));
}
const mesh = (...boxes) => new Float32Array(boxes.flat());
/** Extrude a 2D outline (x, z) along Y from 0 to 200 mm (side walls only, like a wing panel cut). */
function extrude(P2, sx = 1, sz = 1, chord = 100) {
  const tri = [];
  const P = P2.map(([x, z]) => [x * chord * sx, z * chord * sz]);
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const q = [[a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], 200, b[1]], [a[0], 200, a[1]]];
    tri.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  }
  return new Float32Array(tri.flat());
}

test('voxelizer: box volume, centered grid, open-mesh warning', () => {
  const g = voxelize(mesh(box(0, 0, 0, 40, 20, 10)), { size: 1 });
  assert.equal(g.count, 8000);
  assert.equal(g.openWarning, '');
  assert.ok(Math.abs(meshVolume(mesh(box(0, 0, 0, 40, 20, 10))) - 8000) < 1e-6);
  const auto = voxelize(mesh(box(0, 0, 0, 40, 20, 10)), { target: 4000 });
  assert.ok(auto.count > 2500 && auto.count < 6000, `auto resolution ${auto.count}`);
  const b = box(0, 0, 0, 10, 10, 10);
  const open = voxelize(new Float32Array([...b.slice(0, 18), ...b.slice(27)]), { size: 1 }); // top face triangle removed
  assert.match(open.openWarning, /holes/);
});

test('FEA: cantilever deflection and root stress within 10 % of beam theory', () => {
  const L = 100, W = 10, T = 10, E0 = 3000, F = 10, h = 2.5;
  const g = voxelize(mesh(box(0, 0, 0, L, W, T)), { size: h });
  const E = new Float32Array(g.solid.length).map((_, i) => (g.solid[i] ? E0 : 0));
  const fixed = [], tip = [];
  for (let z = 0; z < g.nz; z++) for (let y = 0; y < g.ny; y++) { fixed.push(idx(g, 0, y, z)); tip.push(idx(g, g.nx - 1, y, z)); }
  const r = solve(g, { E, nu: 0.35, fixed, loads: [{ cells: tip, force: [0, 0, -F] }] });
  const I = (W * T ** 3) / 12, Le = L - h;
  const exact = (F * Le ** 3) / (3 * E0 * I);
  assert.ok(r.converged, 'converged');
  assert.ok(Math.abs(r.maxDisp / exact - 1) < 0.1, `deflection ${r.maxDisp} vs ${exact}`);
  let root = 0;
  for (let z = 0; z < g.nz; z++) for (let y = 0; y < g.ny; y++) root = Math.max(root, Math.abs(r.stress[idx(g, 1, y, z) * 6]));
  const sExact = (F * (Le - h / 2) * (T / 2 - h / 2)) / I;
  assert.ok(Math.abs(root / sExact - 1) < 0.1, `root stress ${root} vs ${sExact}`);
  // stress scales with load, not with stiffness (linear, one material)
  const r2 = solve(g, { E: E.map((v) => v * 2), nu: 0.35, fixed, loads: [{ cells: tip, force: [0, 0, -F] }] });
  assert.ok(Math.abs(r2.maxDisp * 2 / r.maxDisp - 1) < 0.01, 'half the deflection at twice the modulus');
});

test('failure check: tension across layers meets the weaker Z strength', () => {
  // a column pulled along its layers (Z) vs across (X): same stress, Z fails first
  const g = voxelize(mesh(box(0, 0, 0, 10, 10, 40)), { size: 2 });
  const E = new Float32Array(g.solid.length).map((_, i) => (g.solid[i] ? 3000 : 0));
  const bottom = [], top = [];
  for (let y = 0; y < g.ny; y++) for (let x = 0; x < g.nx; x++) { bottom.push(idx(g, x, y, 0)); top.push(idx(g, x, y, g.nz - 1)); }
  const r = solve(g, { E, fixed: bottom, loads: [{ cells: top, force: [0, 0, 1000] }] });
  const fz = failure(g, r, { strengthXY: 70, strengthZ: 36, axis: 2 });
  const fx = failure(g, r, { strengthXY: 70, strengthZ: 36, axis: 0 });
  const mid = idx(g, 2, 2, 10);
  assert.ok(Math.abs(r.stress[mid * 6 + 2] - 10) < 1.5, `axial stress ${r.stress[mid * 6 + 2]} ~ 1000 N / 100 mm2`);
  assert.ok(fz.sf[mid] < fx.sf[mid] * 0.6, 'printed upright (layers across the pull) is much weaker');
});

test('weak points: thin walls, supports, narrowest layer, overhangs', () => {
  // T shape: thick post with a thin cap overhanging both sides
  const T = mesh(box(15, 0, 0, 25, 10, 20), box(0, 0, 20, 40, 10, 21));
  const g = voxelize(T, { size: 0.5 });
  const depth = depthMap(g);
  const thin = thinWalls(g, depth, 1.5);
  assert.ok(thin.length > 0, 'the 1 mm cap is thin');
  const post = voxelize(mesh(box(0, 0, 0, 10, 10, 20)), { size: 0.5 });
  assert.equal(thinWalls(post, depthMap(post), 1.5).length, 0, 'edges of a thick block are not thin');
  const sup = supports(g, 2);
  assert.ok(sup.columns.length > 0 && sup.columns.every((c) => c.toPlate), 'cap wings need support to the plate');
  assert.ok(Math.abs(sup.volumeMm3 - 30 * 10 * 20) < 30 * 10 * 20 * 0.1, `support volume ${sup.volumeMm3}`);
  const cs = crossSections(voxelize(mesh(box(0, 0, 0, 20, 20, 5), box(8, 8, 5, 12, 12, 10), box(0, 0, 10, 20, 20, 15)), { size: 0.5 }), 2);
  assert.ok(cs.narrowest.heightMm > 5 && cs.narrowest.heightMm < 10, 'the waist is the narrowest layer');
  assert.ok(cs.narrowest.ratioToLargest < 0.1);
  assert.ok(overhangs(T, 2, 45).areaMm2 > 0, 'cap underside overhangs');
  assert.equal(overhangs(mesh(box(0, 0, 0, 10, 10, 10)), 2, 45).areaMm2, 0, 'a cube on the plate has none');
});

test('rain: a cup holds water, a plate and an upside-down cup do not', () => {
  const cup = mesh(box(0, 0, 0, 30, 30, 2), box(0, 0, 2, 2, 30, 15), box(28, 0, 2, 30, 30, 15), box(2, 0, 2, 28, 2, 15), box(2, 28, 2, 28, 30, 15));
  const g = voxelize(cup, { size: 1 });
  const w = waterPools(g, 2, 1);
  assert.ok(w.volumeMm3 > 26 * 26 * 12, `cup holds ${w.volumeMm3} mm3`);
  assert.equal(waterPools(voxelize(mesh(box(0, 0, 0, 30, 30, 2)), { size: 1 }), 2, 1).volumeMm3, 0);
  assert.equal(waterPools(g, 2, -1).volumeMm3, 0, 'upside down: drains');
});

test('panel method: NACA 0012 and 2412 against thin-airfoil theory', () => {
  const sym = naca4(0, 0.4, 0.12, 60);
  assert.ok(Math.abs(panel(sym, 0).cl) < 1e-6, 'symmetric section: no lift at 0 deg');
  const cl5 = panel(sym, 5).cl;
  assert.ok(cl5 > 0.55 && cl5 < 0.65, `NACA 0012 at 5 deg: ${cl5}`);
  const p0 = panel(naca4(0.02, 0.4, 0.12, 60), 0);
  const p4 = panel(naca4(0.02, 0.4, 0.12, 60), 4);
  const a0 = (p4.cl - p0.cl) / ((4 * Math.PI) / 180);
  const alpha0 = (-p0.cl / a0) * (180 / Math.PI);
  assert.ok(Math.abs(alpha0 - -2.08) < 0.3, `zero-lift angle ${alpha0} (theory -2.08)`);
  assert.ok(Math.abs(p0.cm - -0.053) < 0.01, `Cm ${p0.cm} (theory -0.053)`);
  assert.ok(Math.abs(p0.cl - p0.clCirculation) < 0.02, 'pressure and circulation lift agree');
});

test('section from a printed wing: any orientation, blunt trailing edge, close to the reference', () => {
  const ref = panel(naca4(0.02, 0.4, 0.12, 60), 0).cl;
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const s = section(extrude(naca4Outline('2412', 60, 0.004), sx, sz), { flowAxis: 0, spanAxis: 1, liftAxis: 2, at: 100.3 });
    assert.ok(s.ok);
    assert.ok(Math.abs(s.chordMm - 100) < 1, `chord ${s.chordMm}`);
    assert.ok(Math.abs(s.thickness - 0.12) < 0.01, `t/c ${s.thickness}`);
    assert.equal(s.mirrored, sx < 0, 'leading edge found by shape');
    assert.equal(s.liftFlipped, sz < 0, 'cambered side found');
    const cl = panel(s.nodes, 0).cl;
    assert.ok(Math.abs(cl / ref - 1) < 0.15, `cl ${cl} vs ${ref}`);
  }
});

test('wing polar, ISA air, body drag', () => {
  const a = air(0);
  assert.ok(Math.abs(a.rho - 1.225) < 0.001);
  assert.ok(Math.abs(a.nu - 1.46e-5) < 0.05e-5);
  assert.ok(air(1000).rho < a.rho);
  const w = wingPolar(naca4(0.02, 0.4, 0.12, 60), { spanMm: 1000, areaMm2: 200000, chordMm: 200, thickness: 0.12 }, { speed: 15, e: 0.9, alphas: [0, 4, 8], clMax: 1.0 });
  assert.equal(w.AR, 5);
  const [r0, r4] = w.rows;
  assert.ok(r4.CL > r0.CL && r4.CL < r4.cl2d, 'finite wing lifts less than the section');
  assert.ok(Math.abs(r4.CDi - (r4.CL ** 2) / (Math.PI * 0.9 * 5)) < 1e-9, 'induced drag CL^2 / (pi e AR)');
  assert.ok(Math.abs(r4.liftN - w.q * w.S * r4.CL) < 1e-9);
  assert.ok(w.rows.every((r) => Math.abs(r.CL) <= 1.0 + 1e-9), 'CL max respected');
  assert.ok(Math.abs(bodyDrag(10000, 10, 1.05) - 0.5 * 1.225 * 100 * 0.01 * 1.05) < 1e-3);
});

test('environment: heat against HDT, UV time-lapse, fatigue, drop', () => {
  const pla = { product: 'PLA+', hdt045: 53.78 };
  assert.equal(heatCheck(pla, 30, 0.2).level, 'ok');
  assert.equal(heatCheck(pla, 48, 0.2).level, 'caution');
  assert.equal(heatCheck(pla, 60, 0.2).level, 'fail');
  assert.match(heatCheck({ hdt045: 78, hdt18: 75 }, 70, 5).basis, /1.8 MPa/);
  assert.equal(heatCheck({ product: 'x' }, 30).level, 'nodata');
  assert.equal(uvTimeline('', 5), null, 'no rate: no time-lapse (nothing invented)');
  const tl = uvTimeline(0.8, 2, 2);
  assert.ok(Math.abs(tl.at(-1).retained - 0.64) < 1e-9);
  assert.equal(fatigueLife(10, '', -0.1), null);
  assert.ok(Math.abs(fatigueLife(50, 100, -0.1) - 0.5 * 2 ** 10) < 1e-6);
  assert.equal(dropAccel(1, 2), 501);
});

let dir, app, base;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stltools-v13-'));
  await initKernel();
  app = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir });
  base = `http://127.0.0.1:${app.address().port}`;
});
after(async () => {
  app.close();
  await rm(dir, { recursive: true, force: true });
});
const j = (method, path, body) => fetch(base + path, { method, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));

test('materials API: datasheet list, custom material add / edit / delete, lab modules served', async () => {
  const list = (await j('GET', '/api/materials')).body;
  assert.ok(list.some((m) => m.id === 'esun-pla-plus' && m.shipped));
  const add = await j('POST', '/api/materials', { brand: 'MTS test', product: 'Spool 7 bend-tested', type: 'PLA', tensile: { xy: 48, z: 22 }, modulus: { xy: 2900 }, hdt045: 52, source: { doc: 'Shop tensile bar 2026-11' } });
  assert.equal(add.status, 201);
  assert.equal(add.body.custom, true);
  assert.equal((await j('POST', '/api/materials', { tensile: { xy: -5 } })).status, 400);
  const ed = (await j('PUT', `/api/materials/${add.body.id}`, { uvRetainedPerYear: 0.7 })).body;
  assert.equal(ed.uvRetainedPerYear, 0.7);
  assert.equal(ed.tensile.z, 22, 'other values kept');
  assert.equal((await j('DELETE', '/api/materials/esun-pla-plus')).status, 404, 'datasheet entries cannot be deleted');
  assert.equal((await j('DELETE', `/api/materials/${add.body.id}`)).status, 204);
  for (const f of ['voxel', 'fea', 'weak', 'aero', 'env']) {
    const r = await fetch(`${base}/shared/lab/${f}.js`);
    assert.equal(r.status, 200, f);
    assert.ok(!(await r.text()).includes('node:'), `${f}.js has no Node imports`);
  }
  assert.equal((await fetch(`${base}/shared/lab/../server.js`)).status, 404);
});
