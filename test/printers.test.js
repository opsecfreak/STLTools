import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMockMoonraker } from './helpers/mock-moonraker.js';
import { startServer } from '../src/server.js';
import { initKernel } from '../src/core/kernel.js';
import { isLanHost, normalizeUrl } from '../src/core/printers.js';

let dir, mock, app, base;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stltools-printers-'));
  mock = await startMockMoonraker();
  await initKernel();
  app = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir });
  base = `http://127.0.0.1:${app.address().port}`;
});
after(async () => {
  app.close();
  mock.server.close();
  await rm(dir, { recursive: true, force: true });
});

const j = (method, path, body) => fetch(base + path, { method, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));

test('only LAN addresses are accepted', () => {
  for (const h of ['192.168.1.50', '10.0.0.7', '172.20.1.1', '100.90.1.2', 'sv07.local', 'printer', 'mainsail.lan', '127.0.0.1']) assert.ok(isLanHost(h), h);
  for (const h of ['8.8.8.8', 'example.com', 'printer.example.org', '172.40.0.1']) assert.ok(!isLanHost(h), h);
  assert.equal(normalizeUrl('192.168.1.50'), 'http://192.168.1.50');
  assert.equal(normalizeUrl('http://sv07.local:7125/'), 'http://sv07.local:7125');
  assert.throws(() => normalizeUrl('https://example.com'), /not a local network/);
});

test('add, status, files, metadata, thumbnail, history, webcam, upload (view only)', async () => {
  const url = `http://127.0.0.1:${mock.port}`;
  const probe = await j('POST', '/api/printers/probe', { url, apiKey: 'secret-key' });
  assert.equal(probe.body.hostname, 'sv07-mock');
  const added = await j('POST', '/api/printers', { name: 'SV07', url, apiKey: 'secret-key' });
  assert.equal(added.status, 201);
  const p = added.body;
  assert.equal(p.hasApiKey, true);
  assert.equal(p.apiKey, undefined, 'API key never goes to the browser');
  assert.equal((await j('GET', '/api/printers')).body[0].apiKey, undefined);

  const st = (await j('GET', `/api/printers/${p.id}/status`)).body;
  assert.equal(st.state, 'printing');
  assert.equal(st.progress, 0.4);
  assert.deepEqual(st.layer, { current: 48, total: 120 });
  assert.equal(st.temps.extruder.target, 215);
  assert.equal(Math.round(st.remaining), 2700, 'remaining = slicer estimate x (1 - progress)');
  assert.match(st.thumbnail, /\.thumbs\/.*300x300\.png$/);

  const files = (await j('GET', `/api/printers/${p.id}/files`)).body;
  assert.equal(files.length, 2);
  const meta = (await j('GET', `/api/printers/${p.id}/metadata?filename=${encodeURIComponent(files[1].path)}`)).body;
  assert.equal(meta.thumbnail, 'stltools/.thumbs/esc-tray_PETG_0.2mm-300x300.png', 'thumbnail path includes the subfolder');
  const thumb = await fetch(`${base}/api/printers/${p.id}/thumb?path=${encodeURIComponent(meta.thumbnail)}`);
  assert.equal(thumb.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${base}/api/printers/${p.id}/thumb?path=printer.cfg`)).status, 400, 'only .thumbs images');

  const hist = (await j('GET', `/api/printers/${p.id}/history`)).body;
  assert.equal(hist[0].status, 'completed');
  assert.equal((await j('GET', `/api/printers/${p.id}/webcams`)).body.length, 1);
  const snap = await fetch(`${base}/api/printers/${p.id}/snapshot?cam=0`);
  assert.equal(snap.status, 200, 'relative webcam URL resolved on the printer host');

  const up = await fetch(`${base}/api/printers/${p.id}/upload?filename=test.gcode&path=stltools`, { method: 'PUT', body: Buffer.from('G28\nG1 X10\n') });
  assert.equal(up.status, 200);
  assert.deepEqual(mock.uploads[0], { ...mock.uploads[0], filename: 'test.gcode', root: 'gcodes', path: 'stltools', print: 'false' });
  const bad = await fetch(`${base}/api/printers/${p.id}/upload?filename=part.stl`, { method: 'PUT', body: Buffer.from('solid x') });
  assert.equal(bad.status, 400, 'STL files are refused: slice first');

  // Nothing STL Tools did may control the printer.
  const forbidden = /^\/printer\/(print|gcode|emergency_stop|restart|firmware_restart)|^\/machine\/|DELETE/;
  for (const r of mock.requests) {
    assert.ok(!forbidden.test(r.path) && r.method !== 'DELETE', `control request sent: ${r.method} ${r.path}`);
    assert.ok(r.method === 'GET' || r.path === '/server/files/upload', `unexpected write: ${r.method} ${r.path}`);
  }
  assert.ok(mock.requests.filter((r) => r.path !== '/webcam/').every((r) => r.apiKey === 'secret-key'), 'API key sent to Moonraker');
  assert.equal((await j('POST', `/api/printers/${p.id}/status`)).status, 405, 'printer endpoints are read only');
  assert.equal((await j('DELETE', `/api/printers/${p.id}`)).status, 204);
});

test('unreachable printer gives a clear 502, not a crash', async () => {
  const added = (await j('POST', '/api/printers', { name: 'Off', url: 'http://127.0.0.1:1' })).body;
  const r = await j('GET', `/api/printers/${added.id}/status`);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /Off/);
});
