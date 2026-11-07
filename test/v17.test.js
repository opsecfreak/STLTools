// 1.7 (MTS): modular quad frame assembly, board holders, camera case, antenna tube holder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/core/registry.js';
import { openEdgeCount } from '../src/core/export.js';
import { listPresets, presetIssues } from '../src/core/presets.js';

const bbox = (mesh) => {
  const v = mesh.vertProperties ?? mesh.positions;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const n = mesh.numProp ?? 3;
  for (let i = 0; i < v.length; i += n) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], v[i + a]); max[a] = Math.max(max[a], v[i + a]); }
  return { min, max, size: max.map((x, a) => x - min[a]) };
};

test('modular quad: plates, 4 arms placed by copies, every joint style watertight', async () => {
  for (const joint of ['bolt', 'insert', 'dovetail']) {
    const r = await generate('quad-modular', { joint, standoffs: joint === 'insert' ? 'printed' : 'bought' });
    const names = r.parts.map((p) => p.name);
    assert.deepEqual(names.slice(0, 3), ['bottom-plate', 'top-plate', 'arm']);
    const arm = r.parts.find((p) => p.name === 'arm');
    assert.equal(arm.qty, 4);
    assert.equal(arm.copies.length, 3, 'three more arm placements');
    for (const m of [arm.assembled, ...arm.copies]) assert.equal(m.length, 16);
    // the four arm placements point in four different directions
    const dirs = [arm.assembled, ...arm.copies].map((m) => Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI));
    assert.equal(new Set(dirs).size, 4, `arm directions ${dirs}`);
    for (const p of r.parts) assert.equal(openEdgeCount(p.mesh), 0, `${joint} ${p.name} watertight`);
    if (joint === 'insert') assert.equal(r.parts.find((p) => p.name === 'standoff')?.qty, 4);
    assert.ok(bbox(arm.mesh).size[0] < 220, 'an arm fits a 220 mm bed');
    assert.equal(r.warnings.length, 0, r.warnings.join(' / '));
  }
});

test('modular quad: checks props, wheelbase and nut pocket depth', async () => {
  assert.ok((await generate('quad-modular', { wheelbase: 200, propInches: 6 })).warnings.some((w) => /Props overlap/.test(w)));
  assert.ok((await generate('quad-modular', { wheelbase: 120 })).warnings.some((w) => /too small/.test(w)));
  assert.ok((await generate('quad-modular', { bottomThickness: 2.5, armBolt: 'M4' })).warnings.some((w) => /nut pockets/.test(w)));
  const r = await generate('quad-modular', {});
  assert.ok(r.notes.some((n) => /8 x M3 screws/.test(n)) && r.notes.some((n) => /Standoffs: 4 x M3/.test(n)));
});

test('board holder: cradle, posts, bases; camera case two parts; antenna holder', async () => {
  for (const inp of [{}, { style: 'posts' }, { base: 'stack30' }, { base: 'zip' }, { base: 'tape', usbEnd: false }]) {
    const r = await generate('mcu-holder', inp);
    assert.equal(openEdgeCount(r.parts[0].mesh), 0, JSON.stringify(inp));
  }
  const st = await generate('mcu-holder', { base: 'stack30', boardLength: 21, boardWidth: 17.8 });
  assert.ok(bbox(st.parts[0].mesh).size[0] >= 30.5 + 5, 'plate grows to the stack pattern');
  assert.ok((await generate('mcu-holder', { style: 'posts', holeSpacingL: 60 })).warnings.some((w) => /larger than the board/.test(w)));
  for (const mount of ['tripod', 'tab', 'flat']) {
    const r = await generate('pi-camera-case', { mount });
    assert.deepEqual(r.parts.map((p) => p.name), ['front', 'back']);
    for (const p of r.parts) { assert.equal(openEdgeCount(p.mesh), 0); assert.equal(p.assembled.length, 16); }
  }
  assert.ok((await generate('pi-camera-case', { lensFromTop: 5, holeFromTop: 4, holeSpacingX: 4 })).warnings.some((w) => /next to the lens/.test(w)));
  for (const inp of [{}, { count: 1, mount: 'zip' }, { mount: 'screw' }, { standoffShape: 'hex' }]) {
    const r = await generate('antenna-tube-holder', inp);
    assert.equal(openEdgeCount(r.parts[0].mesh), 0, JSON.stringify(inp));
  }
});

test('presets: new frames and holders load; unknown sizes are left to measure', () => {
  assert.deepEqual(presetIssues(), []);
  const all = listPresets();
  const pick = (id) => all.find((p) => p.id === id);
  assert.ok(pick('quad-modular-5in-bolted'));
  assert.deepEqual(pick('mcu-bluepill-cradle').measure, ['boardLength', 'boardWidth', 'pcbThickness']);
  assert.ok(pick('picam-v3-tripod').measure.includes('lensFromTop'));
  assert.ok(pick('mcu-pico-posts').verify.includes('holeSpacingL'));
});
