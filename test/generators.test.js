import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, listGenerators } from '../src/core/registry.js';
import { resolveParams, ParamError } from '../src/core/params.js';
import { toStl, meshStats, openEdgeCount, stlEdgeIssues } from '../src/core/export.js';
import { listPresets } from '../src/core/presets.js';
import { naca4Outline, sectionAt } from '../src/core/airfoil.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

function assertPrintable(part) {
  assert.equal(openEdgeCount(part.mesh), 0, `${part.name} has open or flipped edges`);
  assert.equal(stlEdgeIssues(part.mesh), 0, `${part.name} has non-manifold or zero-length edges after STL rounding`);
  const s = meshStats(part.mesh);
  assert.ok(s.volumeMm3 > 0, `${part.name} has non-positive volume (inside-out)`);
  near(s.min[2], 0, 0.01, `${part.name} should sit on the bed (min z)`);
  return s;
}

test('every generator runs with defaults and gives watertight parts', async () => {
  for (const g of listGenerators()) {
    const r = await generate(g.id);
    assert.ok(r.parts.length > 0, `${g.id} returned no parts`);
    for (const part of r.parts) assertPrintable(part);
  }
});

test('parts-box: outer size, lid, volume', async () => {
  const r = await generate('parts-box', { width: 100, depth: 60, height: 30, wall: 2, floor: 2, cornerRadius: 0, compartmentsX: 1, compartmentsY: 1 });
  const [box, lid] = r.parts;
  const s = assertPrintable(box);
  assert.deepEqual(s.size, [100, 60, 30]);
  // sharp-corner shell volume by hand
  near(s.volumeMm3, 100 * 60 * 30 - 96 * 56 * 28, 1, 'box volume');
  assert.equal(lid.name, 'lid');
  assertPrintable(lid);
});

test('parts-box: dividers add material, lid can be disabled', async () => {
  const plain = await generate('parts-box', { lid: false, compartmentsX: 1, compartmentsY: 1 });
  const grid = await generate('parts-box', { lid: false, compartmentsX: 4, compartmentsY: 3 });
  assert.equal(plain.parts.length, 1);
  assert.ok(meshStats(grid.parts[0].mesh).volumeMm3 > meshStats(plain.parts[0].mesh).volumeMm3);
});

test('parts-box: warns when dividers hit the lid lip', async () => {
  const r = await generate('parts-box', { height: 40, dividerHeight: 38 });
  assert.ok(r.warnings.some((w) => /lid lip/.test(w)));
});

test('rc-wing: splits into sections that fit the printer', async () => {
  const r = await generate('rc-wing', { halfSpan: 500, maxSectionHeight: 180 });
  assert.equal(r.parts.filter((pt) => pt.name.includes('section')).length, 3);
  for (const part of r.parts) {
    const s = assertPrintable(part);
    assert.ok(s.size[2] <= 180 + 1e-6, `${part.name} is ${s.size[2]} mm tall`);
  }
});

test('rc-wing: root chord and thickness match the airfoil', async () => {
  const r = await generate('rc-wing', { airfoil: '0012', rootChord: 200, tipChord: 200, halfSpan: 100, sparDiameter: 0, rearSparDiameter: 0, controlSurface: 'none', servoBay: false });
  const s = assertPrintable(r.parts[0]);
  near(s.size[0], 200, 0.5, 'chord');
  near(s.size[1], 0.12 * 200, 0.3, 'max thickness of NACA 0012');
  // constant-chord, no-hole section volume = airfoil area * span
  const outline = naca4Outline('0012', 60, 0.8 / 200);
  let area2 = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % outline.length];
    area2 += x1 * y2 - x2 * y1;
  }
  near(s.volumeMm3, (area2 / 2) * 200 * 200 * 100, 50, 'section volume');
});

test('rc-wing: spar holes remove material and mirrored side is produced', async () => {
  const solid = await generate('rc-wing', { sparDiameter: 0, rearSparDiameter: 0, halfSpan: 200, controlSurface: 'none', servoBay: false });
  const holed = await generate('rc-wing', { sparDiameter: 8, rearSparDiameter: 0, sparLength: 100, halfSpan: 200, bothSides: true, controlSurface: 'none', servoBay: false });
  const removed = meshStats(solid.parts[0].mesh).volumeMm3 - meshStats(holed.parts[0].mesh).volumeMm3;
  near(removed, Math.PI * 16 * 200, 60, 'spar hole volume');
  assert.deepEqual(holed.parts.map((p) => p.name), ['right-section1', 'left-section1']);
  assertPrintable(holed.parts[1]);
});

test('rc-wing: warns when the spar is too big for the airfoil', async () => {
  const r = await generate('rc-wing', { airfoil: '0008', tipChord: 80, sparDiameter: 10, sparLength: 100 });
  assert.ok(r.warnings.some((w) => /skin/.test(w)));
});

test('airfoil: NACA 2412 camber and thickness', () => {
  const at30 = sectionAt('2412', 0.3);
  near(at30.thickness, 0.12, 0.002, 'max thickness near 30% chord');
  near(sectionAt('2412', 0.4).camber, 0.02, 1e-9, 'max camber at 40%');
});

test('params: coercion, limits, unknown keys', () => {
  const schema = {
    n: { type: 'number', default: 5, min: 0, max: 10 },
    i: { type: 'integer', default: 1 },
    b: { type: 'boolean', default: false },
    s: { type: 'string', default: '2412', pattern: '^\\d{4}$' },
  };
  assert.deepEqual(resolveParams(schema, { n: '7.5', b: 'yes' }), { n: 7.5, i: 1, b: true, s: '2412' });
  assert.throws(() => resolveParams(schema, { n: 11 }), ParamError);
  assert.throws(() => resolveParams(schema, { i: 1.5 }), ParamError);
  assert.throws(() => resolveParams(schema, { s: 'abcd' }), ParamError);
  assert.throws(() => resolveParams(schema, { bogus: 1 }), /unknown parameter/);
});

test('stl: binary and ascii output are well formed', async () => {
  const r = await generate('parts-box', { lid: false });
  const { mesh } = r.parts[0];
  const bin = toStl(mesh);
  const tris = mesh.indices.length / 3;
  assert.equal(bin.readUInt32LE(80), tris);
  assert.equal(bin.length, 84 + tris * 50);
  const ascii = toStl(mesh, { binary: false }).toString();
  assert.ok(ascii.startsWith('solid'));
  assert.equal(ascii.match(/facet normal/g).length, tris);
});

test('every preset generates printable parts', async () => {
  const presets = listPresets();
  assert.ok(presets.length >= 60, `expected a big preset library, got ${presets.length}`);
  for (const p of presets) {
    const r = await generate(p.generator, p.params);
    for (const part of r.parts) assertPrintable(part);
    const labelRoom = r.warnings.filter((w) => /No room/.test(w));
    assert.deepEqual(labelRoom, [], `${p.id}: ${labelRoom.join(' ')}`);
  }
});

test('stack-bin: size, foot fits inside an identical bin, label card size reported', async () => {
  const r = await generate('stack-bin', { width: 100, depth: 150, height: 70 });
  const s = assertPrintable(r.parts[0]);
  assert.equal(s.size[0], 100);
  assert.equal(s.size[2], 70);
  // foot width = W - 2 * (wall + clearance) must be < cavity width = W - 2 * wall
  const p = r.params;
  assert.ok(p.width - 2 * (p.wall + p.stackClearance) < p.width - 2 * p.wall);
  assert.deepEqual(r.meta.labelCard, { width: 72, height: 14 });
});

test('stack-bin: emboss and deboss text change the volume in the right direction', async () => {
  const base = { labelText: 'M3 SCREWS', labelLine2: 'FAS-001', openFront: false };
  const none = meshStats((await generate('stack-bin', { ...base, labelType: 'none' })).parts[0].mesh).volumeMm3;
  const up = meshStats((await generate('stack-bin', { ...base, labelType: 'emboss' })).parts[0].mesh).volumeMm3;
  const down = meshStats((await generate('stack-bin', { ...base, labelType: 'deboss', wall: 2.4 })).parts[0].mesh).volumeMm3;
  const thick = meshStats((await generate('stack-bin', { ...base, labelType: 'none', wall: 2.4 })).parts[0].mesh).volumeMm3;
  assert.ok(up > none, 'raised text adds material');
  assert.ok(down < thick, 'recessed text removes material');
});

test('hook and tool-rack: every mount type works and sits on the bed', async () => {
  for (const mount of ['pegboard', 'screw', 'adhesive']) {
    for (const style of ['j', 'straight', 'double']) assertPrintable((await generate('hook', { mount, style })).parts[0]);
    for (const holeShape of ['round', 'slot', 'slotX', 'square', 'hex']) assertPrintable((await generate('tool-rack', { mount, holeShape })).parts[0]);
  }
});

test('hook: printed on its side, so print height equals hook width', async () => {
  const r = await generate('hook', { width: 14 });
  near(meshStats(r.parts[0].mesh).size[2], 14, 0.01, 'print height');
});

test('holder-block: pocket count and outer size', async () => {
  const r = await generate('holder-block', { shape: 'round', itemSize: 10, clearance: 0, columns: 3, rows: 2, spacing: 2, border: 4, base: 2, pocketDepth: 10, chamfer: 0, cornerRadius: 0 });
  const s = assertPrintable(r.parts[0]);
  assert.deepEqual(s.size, [3 * 10 + 2 * 2 + 8, 2 * 10 + 2 + 8, 12]);
  const solid = s.size[0] * s.size[1] * 12;
  near(s.volumeMm3, solid - 6 * Math.PI * 25 * 10, 15, 'block minus 6 pockets');
});

test('label-card: raised text sits on the card', async () => {
  const r = await generate('label-card', { width: 72, height: 14, thickness: 0.8, textHeight: 0.6 });
  const s = assertPrintable(r.parts[0]);
  near(s.size[2], 1.4, 0.02, 'card + text height');
  const blank = await generate('label-card', { text: '', line2: '' });
  assert.ok(blank.warnings.some((w) => /blank/.test(w)));
});
