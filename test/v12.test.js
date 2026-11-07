// 1.2 (MTS): opt-in printer control. Off by default; refused (and logged) until the
// user turns it on with the warning acknowledged; every call logged; state guards;
// connection tests and status never send a control request; upload-and-print only
// with control on and confirm=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { initKernel } from '../src/core/kernel.js';
import { startMockMoonraker } from './helpers/mock-moonraker.js';

const CONTROL_PATH = /^\/printer\/(print|gcode|emergency_stop|restart|firmware_restart)|^\/machine\/services/;
let dir, app, base, mock, pr;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stltools-v12-'));
  await initKernel();
  app = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir });
  base = `http://127.0.0.1:${app.address().port}`;
  mock = await startMockMoonraker({ state: 'standby' });
});
after(async () => {
  app.closeAllConnections?.();
  app.close();
  mock.server.closeAllConnections?.();
  mock.server.close();
  await rm(dir, { recursive: true, force: true });
});
const j = (method, path, body) => fetch(base + path, { method, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));
const controlCalls = () => mock.requests.filter((r) => CONTROL_PATH.test(r.path));

test('control is off by default: every action refused and logged, nothing reaches the printer', async () => {
  pr = (await j('POST', '/api/printers', { name: 'SV07', url: `127.0.0.1:${mock.port}`, model: 'sovol-sv07' })).body;
  assert.equal((await j('GET', `/api/printers/${pr.id}/control`)).body.enabled, false);
  for (const a of ['pause', 'resume', 'cancel', 'estop', 'firmware_restart', 'restart']) assert.equal((await j('POST', `/api/printers/${pr.id}/control/${a}`)).status, 403, a);
  assert.equal((await j('POST', `/api/printers/${pr.id}/control/gcode`, { script: 'G28' })).status, 403);
  const up = await fetch(`${base}/api/printers/${pr.id}/upload?filename=a.gcode&print=1&confirm=1`, { method: 'PUT', body: 'G1 X1' });
  assert.equal(up.status, 403);
  assert.deepEqual(controlCalls(), [], 'no control request sent');
  assert.equal(mock.uploads.length, 0);
  const log = (await j('GET', `/api/printers/${pr.id}/control/log`)).body;
  assert.ok(log.length >= 8 && log.every((e) => e.ok === false && /control is off/.test(e.result)), 'refusals logged');
});

test('turning control on needs the warning acknowledged', async () => {
  assert.equal((await j('PUT', `/api/printers/${pr.id}/control`, { enabled: true })).status, 400);
  const on = (await j('PUT', `/api/printers/${pr.id}/control`, { enabled: true, acknowledge: true })).body;
  assert.equal(on.control.enabled, true);
  assert.equal(on.apiKey, undefined);
  assert.equal((await j('GET', '/api/printers')).body[0].control.enabled, true);
});

test('control actions reach Moonraker with state guards, and are logged', async () => {
  const c = (a, body) => j('POST', `/api/printers/${pr.id}/control/${a}`, body);
  assert.equal((await c('pause')).status, 409, 'cannot pause an idle printer');
  assert.equal((await c('start', { filename: '../x.gcode' })).status, 400);
  assert.equal((await c('start', { filename: 'part.stl' })).status, 400);
  assert.equal((await c('start', { filename: 'stltools/esc-tray_PETG_0.2mm.gcode' })).status, 200);
  assert.equal(mock.sim.state, 'printing');
  assert.equal((await c('start', { filename: 'stltools/esc-tray_PETG_0.2mm.gcode' })).status, 409, 'no second start while printing');
  assert.equal((await c('pause')).status, 200);
  assert.equal(mock.sim.state, 'paused');
  assert.equal((await c('resume')).status, 200);
  assert.equal((await c('cancel')).status, 200);
  assert.equal(mock.sim.state, 'cancelled');
  assert.equal((await c('gcode', { script: 'M115' })).status, 200);
  assert.deepEqual(mock.sim.gcode, ['M115']);
  assert.equal((await c('gcode', { script: '' })).status, 400);
  assert.equal((await c('gcode', { script: 'X'.repeat(2001) })).status, 400);
  assert.equal((await c('service', { service: 'crowsnest' })).status, 200);
  assert.equal((await c('service', { service: 'sshd' })).status, 400, 'only listed services');
  assert.equal((await c('firmware_restart')).status, 200);
  assert.equal((await c('estop')).status, 200);
  assert.equal((await c('bogus')).status, 404);
  for (const r of controlCalls()) assert.equal(r.method, 'POST');
  const log = (await j('GET', `/api/printers/${pr.id}/control/log`)).body;
  for (const a of ['start', 'pause', 'resume', 'cancel', 'gcode', 'service', 'firmware_restart', 'estop']) assert.ok(log.some((e) => e.action === a && e.ok), `${a} logged ok`);
  assert.ok(log.some((e) => e.action === 'start' && !e.ok && /idle/.test(e.result)), 'refused start logged');
  const raw = await readFile(join(dir, 'printer-control.log'), 'utf8');
  assert.ok(raw.trim().split('\n').every((l) => JSON.parse(l).at), 'one JSON line per call');
});

test('upload and print: control on plus confirm=1 only, G-code only', async () => {
  mock.sim.state = 'standby';
  const put = (q) => fetch(`${base}/api/printers/${pr.id}/upload?${q}`, { method: 'PUT', body: 'G1 X1\n' });
  assert.equal((await put('filename=a.gcode&print=1')).status, 400, 'confirm needed');
  assert.equal((await put('filename=a.stl&print=1&confirm=1')).status, 400);
  const ok = await (await put('filename=a.gcode&path=stltools&print=1&confirm=1')).json();
  assert.equal(ok.printStarted, true);
  assert.equal(mock.uploads.at(-1).print, 'true');
  assert.equal((await put('filename=b.gcode&print=1&confirm=1')).status, 409, 'not while printing');
  const plain = await (await put('filename=c.gcode')).json();
  assert.equal(mock.uploads.at(-1).print, 'false', 'plain upload never prints');
  assert.equal(plain.path, 'c.gcode');
});

test('connection test and status send no control request; control off again blocks; new address resets control', async () => {
  const before = mock.requests.length;
  await j('POST', '/api/printers/diagnose', { id: pr.id, url: pr.url });
  await j('GET', `/api/printers/${pr.id}/status`);
  await j('GET', `/api/printers/${pr.id}/health`);
  await j('POST', '/api/printers/check');
  assert.ok(mock.requests.slice(before).every((r) => !CONTROL_PATH.test(r.path) && r.method === 'GET'));
  assert.equal((await j('PUT', `/api/printers/${pr.id}/control`, { enabled: false })).body.control.enabled, false);
  assert.equal((await j('POST', `/api/printers/${pr.id}/control/pause`)).status, 403);
  await j('PUT', `/api/printers/${pr.id}/control`, { enabled: true, acknowledge: true });
  const moved = (await j('PUT', `/api/printers/${pr.id}`, { url: `localhost:${mock.port}` })).body;
  assert.equal(moved.control.enabled, false, 'another address may be another printer');
});

test('materials data: every entry sourced from a maker datasheet, no Bambu Lab, units sane', async () => {
  const doc = JSON.parse(await readFile('materials/filaments.json', 'utf8'));
  const ids = doc.materials.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  for (const m of doc.materials) {
    assert.match(m.source?.url ?? '', /^https:\/\//, `${m.id}: source URL`);
    assert.ok(m.source.doc, `${m.id}: source document`);
    assert.ok(!/bambu/i.test(`${m.brand} ${m.product}`), `${m.id}: no Bambu Lab (owner's choice)`);
    for (const k of ['tensile', 'modulus', 'flexModulus']) for (const v of Object.values(m[k] ?? {})) assert.ok(v > 0 && v < 10000, `${m.id} ${k} ${v}`);
    if (m.tensile?.z && m.tensile?.xy) assert.ok(m.tensile.z <= m.tensile.xy, `${m.id}: layers are not stronger than the plane`);
  }
  assert.ok(doc.materials.some((m) => m.brand === 'eSUN' && m.tensile?.z), 'eSUN with Z-direction data');
});
