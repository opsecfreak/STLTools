// 1.5 (MTS): printer depth. Profile import from slicer files, pre-print checklists with an
// automatic G-code header check, print log, and live updates over server-sent events
// (Moonraker websocket where Node has WebSocket, 1 s polling otherwise). All read-only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { startServer } from '../src/server.js';
import { initKernel } from '../src/core/kernel.js';
import { startMockMoonraker } from './helpers/mock-moonraker.js';

let dir, app, base, mock, pr;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stltools-v15-'));
  await initKernel();
  app = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir });
  base = `http://127.0.0.1:${app.address().port}`;
  mock = await startMockMoonraker({ state: 'printing' });
  pr = await (await fetch(`${base}/api/printers`, { method: 'POST', body: JSON.stringify({ name: 'SV07', url: `127.0.0.1:${mock.port}`, model: 'sovol-sv07-mts-v3' }) })).json();
});
after(async () => {
  app.closeAllConnections?.();
  app.close();
  mock.server.closeAllConnections?.();
  mock.server.close();
  await rm(dir, { recursive: true, force: true });
});
const j = (method, path, body) => fetch(base + path, { method, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));

const INI = `bed_shape = 0x0,220x0,220x220,0x220
max_print_height = 250
nozzle_diameter = 0.4
external_perimeter_speed = 50
perimeter_speed = 80
infill_speed = 80
top_solid_infill_speed = 80
first_layer_speed = 50%
travel_speed = 200
default_acceleration = 2000
max_volumetric_speed = 20
`;

test('profile import: PrusaSlicer .ini and Orca JSON become printer profiles; delete imported only', async () => {
  const r = await j('POST', '/api/printer-profiles/import', { format: 'ini', text: INI, name: 'Shop SV07 v3', id: 'shop-sv07-v3' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.profile.bed, { x: 220, y: 220, z: 250 });
  assert.equal(r.body.profile.speeds.innerWall, 80);
  assert.equal(r.body.profile.maxVolumetricFlow, 20);
  assert.ok(r.body.skipped.some((x) => x.startsWith('first_layer_speed')), 'percent speeds skipped, not guessed');
  assert.ok((await j('GET', '/api/printer-profiles')).body.some((p) => p.id === 'shop-sv07-v3' && p.imported));
  const orca = { printable_area: ['0x0', '256x0', '256x256', '0x256'], printable_height: '256', outer_wall_speed: ['120'], inner_wall_speed: ['200'], filament_max_volumetric_speed: ['18'] };
  const o = await j('POST', '/api/printer-profiles/import', { format: 'orca', text: JSON.stringify(orca), name: 'Orca test' });
  assert.equal(o.body.profile.bed.x, 256);
  assert.equal(o.body.profile.speeds.outerWall, 120);
  assert.equal((await j('POST', '/api/printer-profiles/import', { format: 'ini', text: INI, id: 'sovol-sv07' })).status, 400, 'shipped ids are protected');
  assert.equal((await j('DELETE', '/api/printer-profiles/sovol-sv07')).status, 404);
  assert.equal((await j('DELETE', `/api/printer-profiles/${o.body.profile.id}`)).status, 204);
  const saved = JSON.parse(await readFile(join(dir, 'printer-profiles.json'), 'utf8'));
  assert.deepEqual(saved.map((p) => p.id), ['shop-sv07-v3'], 'stored in the data folder');
});

test('pre-print checklist: template for the SV07, header check passes on a v3-style file and flags a bad one', async () => {
  const lists = (await j('GET', '/api/checklists')).body;
  assert.ok(lists.some((c) => c.id === 'sv07-mts' && c.items.length >= 6));
  const ok = (await j('GET', `/api/printers/${pr.id}/gcodecheck?file=${encodeURIComponent('clamp-mount-16_PLA_0.2mm.gcode')}`)).body;
  assert.equal(ok.checklist, 'sv07-mts', 'picked by the printer model');
  assert.ok(ok.checks.length >= 7);
  assert.ok(ok.checks.every((c) => c.ok), JSON.stringify(ok.checks.filter((c) => !c.ok)));
  assert.equal(ok.found.firstNozzle, 220);
  assert.equal(ok.found.maxVolumetric, 20);
  assert.ok(mock.requests.some((r) => r.path.endsWith('.gcode')), 'file read with ranged GETs');
  const generic = (await j('GET', `/api/printers/${pr.id}/gcodecheck?checklist=generic&file=${encodeURIComponent('clamp-mount-16_PLA_0.2mm.gcode')}`)).body;
  assert.equal(generic.checks.length, 1, 'generic list checks only heat order');
  assert.equal((await j('GET', `/api/printers/${pr.id}/gcodecheck?file=../x.gcode`)).status, 400);
  const e = (await j('POST', `/api/printers/${pr.id}/checklists`, { file: 'a.gcode', checklist: 'sv07-mts', done: ['Filament bend test done'], notes: 'spool 7', headerOk: true })).body;
  assert.ok(e.id);
  assert.equal((await j('GET', `/api/printers/${pr.id}/checklists`)).body[0].notes, 'spool 7');
  for (const r of mock.requests) assert.equal(r.method, 'GET');
});

/** Read server-sent events until `want` returns true (or time out). */
function events(path, want, ms = 8000) {
  return new Promise((resolve, reject) => {
    const got = [];
    const req = request(base + path, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let k;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, k); buf = buf.slice(k + 2);
          const data = block.split('\n').find((l) => l.startsWith('data: '));
          if (data) got.push(JSON.parse(data.slice(6)));
          if (want(got)) { req.destroy(); resolve(got); return; }
        }
      });
    });
    req.on('error', () => {});
    req.end();
    setTimeout(() => { req.destroy(); reject(new Error(`timed out with ${JSON.stringify(got).slice(0, 300)}`)); }, ms);
  });
}

test('live updates: status events (websocket when available, else polling), console lines, nothing written', async () => {
  const hasWs = typeof globalThis.WebSocket === 'function';
  const temps = new Set();
  const got = await events(`/api/printers/${pr.id}/events`, (g) => {
    for (const e of g) if (e.type === 'status' && e.status.temps?.extruder) temps.add(e.status.temps.extruder.actual);
    if (hasWs && g.some((e) => e.type === 'mode' && e.live) && !g.consoleSent) { g.consoleSent = true; setTimeout(() => mock.sim.console('// Klipper state: Ready'), 100); }
    return temps.size >= 2 && (!hasWs || g.some((e) => e.type === 'console'));
  });
  assert.ok(temps.size >= 2, 'temperatures change live');
  assert.equal(got.find((e) => e.type === 'mode').live, hasWs, hasWs ? 'websocket' : 'polling');
  if (hasWs) {
    assert.equal(got.find((e) => e.type === 'console').line, '// Klipper state: Ready');
    assert.deepEqual([...new Set(mock.sim.wsMethods)].sort(), ['printer.objects.subscribe', 'server.connection.identify'], 'only read-only websocket calls');
  }
  for (const r of mock.requests) assert.equal(r.method, 'GET');
});
