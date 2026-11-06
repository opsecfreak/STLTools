// v6: settings, printer profiles, print estimates, STL library, project
// export / import, printer connection test (diagnose), mesh area stats.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { initKernel, createScope, toPlainMesh } from '../src/core/kernel.js';
import { meshStats, toStl } from '../src/core/export.js';
import { estimatePart, estimateParts, fitsBed } from '../src/core/estimate.js';
import { listProfiles, getProfile, validateProfile } from '../src/core/profiles.js';
import { parseStl } from '../src/core/library.js';
import { listPresets } from '../src/core/presets.js';
import { getGenerator } from '../src/core/registry.js';
import { startMockMoonraker } from './helpers/mock-moonraker.js';

let dir, app, base, mock;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stltools-v6-'));
  await initKernel();
  app = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir });
  base = `http://127.0.0.1:${app.address().port}`;
  mock = await startMockMoonraker({});
});
after(async () => {
  app.close();
  mock.server.close();
  await rm(dir, { recursive: true, force: true });
});
const j = (method, path, body) => fetch(base + path, { method, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));

function cubeMesh(s = 10) {
  const k = createScope();
  try { return toPlainMesh(k.cuboid([s, s, s], [0, 0, s / 2])); } finally { k.free(); }
}

test('meshStats reports surface, flat and bed area', () => {
  const st = meshStats(cubeMesh(10));
  assert.ok(Math.abs(st.areaMm2 - 600) < 0.5, `area ${st.areaMm2}`);
  assert.ok(Math.abs(st.flatAreaMm2 - 200) < 0.5, `flat ${st.flatAreaMm2}`);
  assert.ok(Math.abs(st.bedAreaMm2 - 100) < 0.5, `bed ${st.bedAreaMm2}`);
});

test('printer profiles: SV07 ships, generic last, validation rejects bad files', () => {
  const sv07 = getProfile('sovol-sv07');
  assert.deepEqual(sv07.bed, { x: 220, y: 220, z: 250 });
  assert.equal(sv07.nozzle, 0.4);
  assert.equal(listProfiles()[0].id, 'sovol-sv07', 'named printers first');
  assert.throws(() => validateProfile({ id: 'X bad', name: 'x', bed: { x: 1, y: 1, z: 1 } }), /id must/);
  assert.throws(() => validateProfile({ id: 'ok-id', name: 'x', bed: { x: 220, y: 220 } }), /bed.z/);
  assert.throws(() => validateProfile({ id: 'ok-id', name: 'x', bed: { x: 220, y: 220, z: 250 }, speeds: { infill: 0 } }), /speeds.infill/);
});

test('estimates: plausible for a 20 mm cube on the SV07, monotonic, bed fit', () => {
  const st = meshStats(cubeMesh(20));
  const p = getProfile('sovol-sv07');
  const e = estimatePart(st, p, { layerHeight: 0.2, infill: 15, walls: 3, shellLayers: 4, material: 'pla' });
  assert.ok(e.seconds > 4 * 60 && e.seconds < 45 * 60, `20 mm cube ${Math.round(e.seconds / 60)} min`);
  assert.ok(e.grams > 2 && e.grams < 10, `grams ${e.grams}`);
  assert.equal(e.layers, 100);
  const more = estimatePart(st, p, { infill: 80 });
  assert.ok(more.seconds > e.seconds && more.grams > e.grams, 'more infill takes longer and uses more');
  const fine = estimatePart(st, p, { layerHeight: 0.12 });
  assert.ok(fine.seconds > e.seconds, 'thinner layers take longer');
  const slow = estimatePart(st, getProfile('generic-standard'), {});
  assert.ok(slow.seconds > e.seconds, 'slow printer takes longer');
  const cal = estimatePart(st, p, { timeFactor: 1.5 });
  assert.ok(Math.abs(cal.seconds - 1.5 * estimatePart(st, p, {}).seconds) < 1);
  assert.equal(estimatePart(st, p, { filamentCostPerKg: 20 }).cost.toFixed(4), ((estimatePart(st, p, {}).grams / 1000) * 20).toFixed(4));
  const two = estimateParts([st, st], p, {}, [1, 2]);
  assert.ok(Math.abs(two.seconds - (3 * estimatePart(st, p, {}).seconds + p.heatUpSeconds)) < 1, 'quantities and heat-up once');
  assert.deepEqual(fitsBed([200, 210, 50], p.bed), { fits: true, rotated: false });
  assert.equal(fitsBed([230, 100, 50], p.bed).fits, false);
  assert.equal(fitsBed([100, 100, 260], p.bed).fits, false);
});

test('POST /api/estimate and the shared estimator file', async () => {
  const gen = (await j('POST', '/api/generate/spacer', {})).body;
  const r = await j('POST', '/api/estimate', { stats: gen.parts.map((p) => p.stats), profile: 'sovol-sv07' });
  assert.equal(r.status, 200);
  assert.equal(r.body.profile, 'sovol-sv07');
  assert.ok(r.body.seconds > 0 && r.body.grams > 0);
  assert.equal((await j('POST', '/api/estimate', { stats: [], profile: 'sovol-sv07' })).status, 400);
  assert.equal((await j('POST', '/api/estimate', { stats: [{}], profile: 'nope' })).status, 404);
  const js = await fetch(`${base}/shared/estimate.js`);
  assert.equal(js.status, 200);
  assert.match(await js.text(), /export function estimatePart/);
  assert.ok(gen.parts[0].stats.areaMm2 > 0, 'generate results carry area stats');
});

test('settings: defaults, partial update, validation, unknown keys ignored, reset', async () => {
  const d = (await j('GET', '/api/settings')).body;
  assert.equal(d.print.profile, 'sovol-sv07');
  assert.equal(d.viewer.quality, 'high');
  assert.equal(d.ui.autoGenerate, true);
  let r = await j('PUT', '/api/settings', { viewer: { shading: 'edges', color: '#FF0000', bogus: 1 }, nope: { a: 1 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.viewer.shading, 'edges');
  assert.equal(r.body.viewer.color, '#ff0000');
  assert.equal(r.body.viewer.bogus, undefined);
  assert.equal(r.body.nope, undefined);
  assert.equal(r.body.ui.theme, 'auto', 'other sections untouched');
  assert.equal((await j('PUT', '/api/settings', { print: { infill: 150 } })).status, 400);
  assert.equal((await j('PUT', '/api/settings', { ui: { theme: 'purple' } })).status, 400);
  assert.equal((await j('PUT', '/api/settings', { printers: { uploadFolder: '../../etc' } })).status, 200, 'dots and slashes allowed; the printer validates paths');
  assert.equal((await j('PUT', '/api/settings', { print: { filamentCostPerKg: null } })).body.print.filamentCostPerKg, null);
  r = await j('POST', '/api/settings/reset', { section: 'viewer' });
  assert.equal(r.body.viewer.shading, 'shaded');
  const schema = (await j('GET', '/api/settings/schema')).body;
  assert.ok(schema.viewer.fields.quality.options.length >= 4);
});

async function stlBuffer(gen = 'spacer', params = {}) {
  const r = (await j('POST', `/api/generate/${gen}`, params)).body;
  return Buffer.from(await (await fetch(base + r.parts[0].url)).arrayBuffer());
}

test('STL parser: binary and ASCII, rejects other files', () => {
  const mesh = cubeMesh(10);
  const bin = toStl(mesh, { name: 'cube' });
  const a = parseStl(bin);
  assert.equal(a.positions.length / 9, mesh.indices.length / 3);
  const tris = [];
  for (let t = 0; t < mesh.indices.length; t += 3) tris.push([0, 1, 2].map((i) => [0, 1, 2].map((c) => mesh.positions[mesh.indices[t + i] * 3 + c]).join(' ')));
  const ascii = `solid cube\n${tris.map((v) => `facet normal 0 0 0\n outer loop\n${v.map((x) => `  vertex ${x}`).join('\n')}\n endloop\nendfacet`).join('\n')}\nendsolid cube\n`;
  const b = parseStl(Buffer.from(ascii));
  assert.equal(b.positions.length, a.positions.length);
  assert.ok(Math.abs(meshStats(b).volumeMm3 - 1000) < 1);
  assert.throws(() => parseStl(Buffer.from('PK\u0003\u0004 not an stl')), /Not an STL/);
});

test('STL library: upload, list with thumb key, download same bytes, edit, delete', async () => {
  const data = await stlBuffer('spacer', { length: 20 });
  const up = await fetch(`${base}/api/library/upload?filename=standoff.stl&folder=Bench&tags=m3,spacer`, { method: 'PUT', body: data });
  assert.equal(up.status, 201);
  const e = await up.json();
  assert.match(e.id, /^stl-[a-f0-9]{8}$/);
  assert.equal(e.name, 'standoff');
  assert.deepEqual(e.tags, ['m3', 'spacer']);
  assert.ok(Math.abs(e.stats.size[2] - 20) < 0.01);
  const list = (await j('GET', '/api/library')).body;
  assert.equal(list[0].id, e.id);
  assert.match(list[0].thumbKey, /^[a-f0-9]{16}$/);
  assert.equal(list[0].thumb, null);
  const dl = await fetch(`${base}/api/library/${e.id}.stl`);
  assert.match(dl.headers.get('content-disposition'), /standoff\.stl/);
  assert.ok(Buffer.from(await dl.arrayBuffer()).equals(data));
  assert.equal((await j('PUT', `/api/library/${e.id}`, { name: 'M3 standoff 20', folder: 'Hardware' })).body.folder, 'Hardware');
  const bad = await fetch(`${base}/api/library/upload?filename=x.stl`, { method: 'PUT', body: 'hello' });
  assert.equal(bad.status, 400);
  const notStl = await fetch(`${base}/api/library/upload?filename=x.3mf`, { method: 'PUT', body: data });
  assert.equal(notStl.status, 400);
  assert.equal((await j('DELETE', `/api/library/${e.id}`)).status, 204);
  assert.equal((await j('GET', `/api/library/${e.id}`)).status, 404);
});

test('projects: STL items, export bundle, import on another server', async () => {
  const data = await stlBuffer('tube-cap');
  const e = await (await fetch(`${base}/api/library/upload?filename=cap.stl`, { method: 'PUT', body: data })).json();
  const design = (await j('POST', '/api/designs', { name: 'Clamp 12', generator: 'tube-clamp', params: { tubeOD: 12 } })).body;
  const p = (await j('POST', '/api/projects', { name: 'ZD550 sensors' })).body;
  await j('POST', `/api/projects/${p.id}/items`, { kind: 'stl', ref: e.id, qty: 2 });
  await j('POST', `/api/projects/${p.id}/items`, { kind: 'design', ref: design.id });
  await j('POST', `/api/projects/${p.id}/items`, { kind: 'preset', ref: 'tfluna-plate' });
  assert.equal((await j('POST', `/api/projects/${p.id}/items`, { kind: 'stl', ref: 'bad' })).status, 400);

  const build = (await j('POST', `/api/projects/${p.id}/build`)).body;
  assert.deepEqual(build.errors, []);
  assert.ok(build.files >= 3);
  assert.ok(build.estimate.seconds > 0 && build.estimate.profile === 'Sovol SV07');
  const zip = Buffer.from(await (await fetch(base + build.zip)).arrayBuffer());
  assert.ok(zip.includes(data.subarray(84, 84 + 50)), 'library STL bytes are in the ZIP');
  assert.match(zip.toString('latin1'), /Estimate on Sovol SV07/);

  const ex = await fetch(`${base}/api/projects/${p.id}/export`);
  assert.match(ex.headers.get('content-disposition'), /zd550-sensors\.stltools-project\.json/);
  const bundle = await ex.json();
  assert.equal(bundle.format, 'stltools-project');
  assert.equal(bundle.designs.length, 1);
  assert.equal(bundle.stls.length, 1);

  // import on a second, empty server
  const dir2 = await mkdtemp(join(tmpdir(), 'stltools-v6b-'));
  const app2 = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir2 });
  try {
    const b2 = `http://127.0.0.1:${app2.address().port}`;
    const r = await fetch(`${b2}/api/projects/import`, { method: 'POST', body: JSON.stringify(bundle) });
    assert.equal(r.status, 201);
    const { project, warnings } = await r.json();
    assert.deepEqual(warnings, []);
    assert.equal(project.name, 'ZD550 sensors');
    assert.equal(project.items.length, 3);
    const lib2 = await (await fetch(`${b2}/api/library`)).json();
    const des2 = await (await fetch(`${b2}/api/designs`)).json();
    assert.equal(project.items[0].ref, lib2[0].id, 'STL item points at the new library entry');
    assert.equal(project.items[1].ref, des2[0].id, 'design item points at the new design');
    const build2 = await (await fetch(`${b2}/api/projects/${project.id}/build`, { method: 'POST' })).json();
    assert.deepEqual(build2.errors, []);
    // a bundle missing its STL skips that part with a warning
    const partial = await (await fetch(`${b2}/api/projects/import`, { method: 'POST', body: JSON.stringify({ ...bundle, stls: [] }) })).json();
    assert.equal(partial.project.items.length, 2);
    assert.match(partial.warnings.join(' '), /STL is not in the file/);
    assert.equal((await fetch(`${b2}/api/projects/import`, { method: 'POST', body: JSON.stringify({ format: 'other' }) })).status, 400);
  } finally {
    app2.close();
    await rm(dir2, { recursive: true, force: true });
  }
});

test('printers: SV07 connection test step by step, model guess, saved model, read-only', async () => {
  const before = mock.requests.length;
  const d = (await j('POST', '/api/printers/diagnose', { url: `127.0.0.1:${mock.port}` })).body;
  assert.equal(d.ok, true, JSON.stringify(d.steps));
  assert.deepEqual(d.steps.map((s) => s.step), ['Address', 'Moonraker answers', 'Printer info', 'Status query', 'File list', 'Upload folder', 'Printer limits (for estimates)', 'Webcam']);
  assert.match(d.model, /^sovol-sv07/, 'hostname sv07-* suggests an SV07 profile');
  for (const r of mock.requests.slice(before)) assert.equal(r.method, 'GET', `diagnose sent ${r.method} ${r.path}`);

  const bad = (await j('POST', '/api/printers/diagnose', { url: '8.8.8.8' })).body;
  assert.equal(bad.ok, false);
  assert.equal(bad.steps[0].step, 'Address');
  assert.ok(bad.steps[0].fix);
  const down = (await j('POST', '/api/printers/diagnose', { url: '127.0.0.1:1' })).body;
  assert.equal(down.ok, false);
  assert.equal(down.steps[1].ok, false);
  assert.match(down.steps[1].fix, /port 7125/);

  const p = (await j('POST', '/api/printers', { name: 'SV07', url: `127.0.0.1:${mock.port}`, model: 'sovol-sv07', apiKey: 'PLACEHOLDER_KEY' })).body;
  assert.equal(p.model, 'sovol-sv07');
  assert.equal(p.apiKey, undefined, 'key never returned');
  const again = (await j('POST', '/api/printers/diagnose', { id: p.id, url: p.url })).body;
  assert.equal(again.ok, true);
  assert.equal(mock.requests.filter((r) => !r.path.startsWith('/webcam')).at(-1).apiKey, 'PLACEHOLDER_KEY', 'saved key used server side');
  assert.equal((await j('PUT', `/api/printers/${p.id}`, { model: 'Bad Model!' })).body.model, '');
  // estimates follow the default printer's model
  await j('PUT', '/api/printers/' + p.id, { model: 'generic-standard' });
  await j('PUT', '/api/settings', { printers: { defaultPrinter: p.id } });
  const pr = (await j('POST', '/api/projects', { name: 'one', items: [{ kind: 'preset', ref: 'tfluna-plate' }] })).body;
  assert.match((await j('POST', `/api/projects/${pr.id}/build`)).body.estimate.profile, /Generic standard/);
});

test('presets: verify lists only real parameters; new module presets exist', () => {
  const ps = listPresets();
  for (const p of ps.filter((x) => x.verify)) {
    const g = getGenerator(p.generator);
    for (const k of p.verify) assert.ok(g.params[k], `${p.id} verify ${k}`);
  }
  for (const id of ['pi5-case-vents', 'pi4-case-vents', 'xiao-c6-clip-plate', 'tfluna-plate', 'tfmini-s-plate', 'lidar-puck-plate', 'typhoon-h-repair-cradle', 'ext-2020-corner', 'motor-n20-clamp']) assert.ok(ps.some((p) => p.id === id), id);
  const ids = ps.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate preset ids');
});

test('backup has no API keys; version lists profiles and platform', async () => {
  const b = await fetch(`${base}/api/backup`);
  const text = await b.text();
  assert.ok(!text.includes('PLACEHOLDER_KEY'));
  assert.equal(JSON.parse(text).format, 'stltools-backup');
  const v = (await j('GET', '/api/version')).body;
  assert.ok(v.profiles >= 3);
  assert.ok(v.platform);
});
