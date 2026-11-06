// 1.1 (pi-deployment): self-hosting settings and status, LAN access PIN,
// optional printer features, background connection checks, estimates from the
// printer's own Klipper limits, live MJPEG webcam proxy with a Mainsail default
// fallback, and the desktop launcher's temp / portable / auto-stop modes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, cp, symlink, writeFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from '../src/server.js';
import { initKernel } from '../src/core/kernel.js';
import { profileFromMachine, estimateParts } from '../src/core/estimate.js';
import { getProfile } from '../src/core/profiles.js';
import { startMockMoonraker, MOCK_MACHINE } from './helpers/mock-moonraker.js';
import { guessModel, redactSecrets } from '../src/core/printers.js';

let dir, app, base, mock, mockNoCam;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stltools-v11-'));
  await initKernel();
  app = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir });
  base = `http://127.0.0.1:${app.address().port}`;
  mock = await startMockMoonraker({});
  mockNoCam = await startMockMoonraker({ webcams: 'none' });
});
after(async () => {
  app.closeAllConnections?.();
  app.close();
  for (const m of [mock, mockNoCam]) { m.server.closeAllConnections?.(); m.server.close(); }
  await rm(dir, { recursive: true, force: true });
});
const j = (method, path, body, headers = {}) => fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, headers: r.headers, body: r.status === 204 ? null : await r.json().catch(() => null) }));

test('settings: hosting section and printer options with defaults and limits', async () => {
  const s = (await j('GET', '/api/settings')).body;
  assert.deepEqual(s.hosting, { lan: false, port: 3000, autoStopHours: 0 });
  assert.equal(s.printers.enabled, 'auto');
  assert.equal(s.printers.checkMinutes, 5);
  assert.equal(s.printers.useMachine, true);
  assert.equal(s.printers.webcam, 'stream');
  assert.equal((await j('PUT', '/api/settings', { hosting: { port: 80 } })).status, 400, 'ports below 1024 need root');
  assert.equal((await j('PUT', '/api/settings', { hosting: { autoStopHours: 100 } })).status, 400);
  assert.equal((await j('PUT', '/api/settings', { printers: { enabled: 'maybe' } })).status, 400);
  assert.equal((await j('PUT', '/api/settings', { printers: { enabled: 'off' } })).body.printers.enabled, 'off');
  await j('PUT', '/api/settings', { printers: { enabled: 'auto' } });
  assert.ok((await j('GET', '/api/settings/schema')).body.hosting.fields.autoStopHours);
});

test('hosting status: mode, local-only addresses, no PIN, this machine is local', async () => {
  const h = (await j('GET', '/api/hosting')).body;
  assert.equal(h.lan, false);
  assert.deepEqual(h.addresses, [`${base}`]);
  assert.equal(h.pin, false);
  assert.equal(h.you.local, true);
  assert.equal(h.port, app.address().port);
  assert.ok(['server', 'service', 'desktop', 'portable', 'temp', 'custom'].includes(h.mode));
  assert.equal(typeof h.arch, 'string');
});

test('machine limits: read-only query, saved on the printer, estimates use them', async () => {
  const p = (await j('POST', '/api/printers', { name: 'SV07', url: `127.0.0.1:${mock.port}`, model: 'sovol-sv07' })).body;
  const before = mock.requests.length;
  const m = (await j('GET', `/api/printers/${p.id}/machine`)).body;
  assert.deepEqual(m.bed, { x: 225, y: 225, z: 253 }, 'travel from axis_minimum (negative clipped to 0) to axis_maximum');
  assert.equal(m.maxVelocity, MOCK_MACHINE.max_velocity);
  assert.equal(m.maxAccel, MOCK_MACHINE.max_accel);
  assert.equal(m.nozzle, 0.4);
  assert.equal(m.kinematics, 'cartesian');
  for (const r of mock.requests.slice(before)) assert.equal(r.method, 'GET');
  assert.deepEqual((await j('GET', '/api/printers')).body.find((x) => x.id === p.id).machine.bed, m.bed);

  await j('PUT', '/api/settings', { printers: { defaultPrinter: p.id } });
  const targets = (await j('GET', '/api/estimate-targets')).body;
  const t = targets.find((x) => x.value === `printer:${p.id}`);
  assert.match(t.label, /own limits/);
  assert.deepEqual(t.profile.bed, { x: 220, y: 220, z: 250 }, 'travel (225) never grows the profile bed (220)');
  assert.ok(t.profile.fromMachine.readAt);
  assert.ok(targets.some((x) => x.value === 'profile:sovol-sv07'), 'profiles still listed');
  // the server estimate (project ZIP README, /api/estimate) uses the same profile
  const stats = { size: [219, 219, 10], volumeMm3: 20000, areaMm2: 9000, flatAreaMm2: 6000, bedAreaMm2: 3000 };
  const est = (await j('POST', '/api/estimate', { stats: [stats] })).body;
  assert.equal(est.profile, 'sovol-sv07@printer');
  assert.equal(est.parts[0].fit.fits, true, '219 mm fits the 220 mm bed');

  await j('PUT', '/api/settings', { printers: { useMachine: false } });
  assert.equal((await j('POST', '/api/estimate', { stats: [stats] })).body.profile, 'sovol-sv07', 'turned off: profile values');
  await j('PUT', '/api/settings', { printers: { useMachine: true } });
});

test('profileFromMachine: caps speeds, keeps missing values, accel moves efficiency', () => {
  const sv07 = getProfile('sovol-sv07');
  const slow = profileFromMachine(sv07, { bed: { x: 200, y: 200, z: 180 }, maxVelocity: 100, maxAccel: 1250 }, 'Slow');
  assert.ok(Object.values(slow.speeds).every((v) => v <= 100));
  assert.deepEqual(slow.bed, { x: 200, y: 200, z: 180 });
  assert.equal(slow.nozzle, sv07.nozzle, 'not reported: profile value');
  assert.ok(slow.motionEfficiency < sv07.motionEfficiency);
  const st = [{ size: [40, 40, 20], volumeMm3: 12000, areaMm2: 6000, flatAreaMm2: 3000, bedAreaMm2: 1600 }];
  assert.ok(estimateParts(st, slow).seconds > estimateParts(st, sv07).seconds, 'a slower machine takes longer');
  assert.equal(profileFromMachine(sv07, { bed: { x: 0, y: 5, z: 1 } }).bed, sv07.bed, 'nonsense bed ignored');
  assert.equal(profileFromMachine(sv07, null), sv07);
});

test('connection checks: on demand, remembered in the printer list, offline printer reported', async () => {
  const off = (await j('POST', '/api/printers', { name: 'Gone', url: '127.0.0.1:1' })).body;
  const r = (await j('POST', '/api/printers/check')).body;
  assert.equal(Object.values(r).filter((x) => x.ok).length, 1);
  assert.equal(r[off.id].ok, false);
  assert.match(r[off.id].error, /Gone/);
  const list = (await j('GET', '/api/printers')).body;
  assert.equal(list.find((x) => x.id === off.id).lastCheck.ok, false);
  assert.equal(list.find((x) => x.name === 'SV07').lastCheck.klippy, 'ready');
  assert.equal((await j('DELETE', `/api/printers/${off.id}`)).status, 204);
});

test('webcam: live MJPEG stream proxied and closed upstream when the browser leaves', async () => {
  const p = (await j('GET', '/api/printers')).body.find((x) => x.name === 'SV07');
  const cams = (await j('GET', `/api/printers/${p.id}/webcams`)).body;
  assert.deepEqual(cams.map((c) => [c.name, c.stream, c.snapshot, c.guessed]), [['cam', true, true, false]]);
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/printers/${p.id}/stream?cam=0`, { signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /multipart\/x-mixed-replace/);
  const reader = res.body.getReader();
  let got = Buffer.alloc(0);
  while (got.length < 600) got = Buffer.concat([got, Buffer.from((await reader.read()).value)]);
  assert.ok(got.includes(Buffer.from('--frame')), 'MJPEG frames arrive');
  assert.ok(got.includes(Buffer.from([0xff, 0xd8])), 'JPEG data');
  ctrl.abort();
  for (let i = 0; i < 50 && mock.streams.closed < 1; i++) await new Promise((r) => setTimeout(r, 40));
  assert.equal(mock.streams.closed, mock.streams.open, 'upstream camera connection closed');
  assert.equal((await j('POST', `/api/printers/${p.id}/stream`)).status, 405, 'stream is GET only');
});

test('webcam: non-MJPEG service is refused for video, snapshots still work', async () => {
  const webrtc = await startMockMoonraker({ webcamService: 'webrtc-camerastreamer' });
  try {
    const p = (await j('POST', '/api/printers', { name: 'RTC', url: `127.0.0.1:${webrtc.port}` })).body;
    const cams = (await j('GET', `/api/printers/${p.id}/webcams`)).body;
    assert.equal(cams[0].stream, false);
    assert.equal(cams[0].service, 'webrtc-camerastreamer');
    assert.equal((await j('GET', `/api/printers/${p.id}/stream?cam=0`)).status, 415);
    assert.equal((await fetch(`${base}/api/printers/${p.id}/snapshot?cam=0`)).status, 200);
    await j('DELETE', `/api/printers/${p.id}`);
  } finally { webrtc.server.close(); }
});

test('webcam: Moonraker lists none -> Mainsail default path (SV07 profile) is tried and marked guessed', async () => {
  const p = (await j('POST', '/api/printers', { name: 'Plain SV07', url: `127.0.0.1:${mockNoCam.port}`, model: 'sovol-sv07' })).body;
  const cams = (await j('GET', `/api/printers/${p.id}/webcams`)).body;
  assert.equal(cams.length, 1);
  assert.equal(cams[0].guessed, true);
  assert.equal(cams[0].stream, true);
  assert.ok(mockNoCam.requests.some((r) => r.path === '/webcam/' && r.query === '?action=snapshot'), 'snapshot default tried');
  const d = (await j('POST', '/api/printers/diagnose', { url: `127.0.0.1:${mockNoCam.port}` })).body;
  assert.match(d.steps.find((s) => s.step === 'Webcam').detail, /Mainsail default path/);
  await j('DELETE', `/api/printers/${p.id}`);
});

test('real SV07 setup: mkspi host, Mainsail-only webcam list, camera service down, printer name', async () => {
  assert.equal(guessModel('mkspi'), 'sovol-sv07', 'stock SV07 host board name');
  const real = await startMockMoonraker({ hostname: 'mkspi', webcams: 'mainsail', webcamUp: false });
  try {
    const d = (await j('POST', '/api/printers/diagnose', { url: `127.0.0.1:${real.port}` })).body;
    assert.equal(d.model, 'sovol-sv07');
    assert.equal(d.name, 'Shop printer', 'name from Mainsail settings');
    const cam = d.steps.find((x) => x.step === 'Webcam');
    assert.equal(cam.warn, true, 'listed but not answering is a warning, not a failure');
    assert.match(cam.detail, /Mainsail's webcam settings/);
    assert.match(cam.detail, /NOT answering: HTTP 502/);
    assert.match(cam.fix, /restart crowsnest/i);
    assert.equal(d.ok, true, 'a down camera does not fail the connection test');
    const p = (await j('POST', '/api/printers', { name: 'Shop', url: `127.0.0.1:${real.port}`, model: d.model })).body;
    const cams = (await j('GET', `/api/printers/${p.id}/webcams`)).body;
    assert.deepEqual(cams.map((c) => [c.name, c.source, c.up, c.flipV, c.fps]), [['Webcam', 'mainsail', false, true, 15]]);
    assert.match(cams[0].state, /502/);
    for (const r of real.requests) assert.equal(r.method, 'GET');
    await j('DELETE', `/api/printers/${p.id}`);
  } finally { real.server.close(); }
});

test('connection test with no address explains what to do', async () => {
  const d = (await j('POST', '/api/printers/diagnose', { url: '' })).body;
  assert.equal(d.ok, false);
  assert.match(d.steps[0].detail, /No address entered/);
  assert.match(d.steps[0].fix, /Scan my network/);
});

test('config viewer and health check: read-only, secrets hidden', async () => {
  const p = (await j('GET', '/api/printers')).body.find((x) => x.name === 'SV07');
  const before = mock.requests.length;
  const files = (await j('GET', `/api/printers/${p.id}/config`)).body;
  assert.deepEqual(files.map((f) => f.path), ['printer.cfg', 'moonraker.conf'], 'printer.cfg first, hidden files skipped');
  const cfg = (await j('GET', `/api/printers/${p.id}/config?file=printer.cfg`)).body;
  assert.match(cfg.text, /max_velocity: 225/);
  const mc = (await j('GET', `/api/printers/${p.id}/config?file=moonraker.conf`)).body;
  assert.ok(!mc.text.includes('PLACEHOLDER_KEY') && !mc.text.includes('PLACEHOLDER_TOKEN'), mc.text);
  assert.match(mc.text, /api_key: <hidden by STL Tools>/);
  assert.equal((await j('GET', `/api/printers/${p.id}/config?file=../../etc/passwd`)).status, 400);
  assert.equal((await j('GET', `/api/printers/${p.id}/config?file=x.gcode`)).status, 400);
  const h = (await j('GET', `/api/printers/${p.id}/health`)).body;
  const by = (t) => h.checks.find((c) => c.title.startsWith(t));
  assert.match(by('Motion limits').detail, /max_velocity 225.*square_corner_velocity 3/);
  assert.match(by('Extruder').detail, /pressure_advance 0.04/);
  assert.equal(by('Filament sensor').level, 'warn', 'pause_on_runout false is flagged');
  assert.match(by('Input shaper').detail, /ei @ 44.2 Hz/);
  assert.match(by('MCU').detail, /v0.11.0-41.*v0.11.0-122/);
  assert.match(by('Print totals').detail, /166 jobs/);
  for (const r of mock.requests.slice(before)) assert.equal(r.method, 'GET', `${r.method} ${r.path}`);
  assert.equal((await j('POST', `/api/printers/${p.id}/config`)).status, 405, 'config is read-only');
  assert.equal(redactSecrets('url: https://user:pass@host/x'), 'url: https://<hidden>@host/x');
});

test('LAN access PIN: other devices need it, this machine never, wrong PINs limited, removable', async () => {
  // second server on the same data folder that treats every client as a LAN device
  const lan = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir, pinForLocal: true });
  const lb = `http://127.0.0.1:${lan.address().port}`;
  try {
    assert.equal((await j('PUT', '/api/hosting/pin', { pin: '12' })).status, 400, 'too short');
    const set = await j('PUT', '/api/hosting/pin', { pin: '2468' });
    assert.equal(set.status, 200);
    assert.equal(set.body.pin, true);
    assert.equal((await j('GET', '/api/hosting')).body.pin, true);
    assert.equal((await fetch(`${lb}/api/presets`)).status, 401, 'API locked for LAN clients');
    const page = await fetch(`${lb}/`);
    assert.match(await page.text(), /access PIN/);
    assert.equal((await fetch(`${lb}/api/hosting/login`, { method: 'POST', body: JSON.stringify({ pin: '0000' }) })).status, 403);
    const ok = await fetch(`${lb}/api/hosting/login`, { method: 'POST', body: JSON.stringify({ pin: '2468' }) });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie').split(';')[0];
    assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.equal((await fetch(`${lb}/api/version`, { headers: { cookie } })).status, 200, 'cookie opens it');
    assert.equal((await fetch(`${lb}/api/version`, { headers: { cookie: 'stltools_pin=forged' } })).status, 401);
    for (let i = 0; i < 5; i++) await fetch(`${lb}/api/hosting/login`, { method: 'POST', body: JSON.stringify({ pin: 'bad' }) });
    assert.equal((await fetch(`${lb}/api/hosting/login`, { method: 'POST', body: JSON.stringify({ pin: '2468' }) })).status, 429, 'locked after 5 wrong PINs');
    assert.equal((await j('GET', '/api/presets')).status, 200, 'this machine needs no PIN');
    assert.equal((await j('PUT', '/api/hosting/pin', { pin: '' })).status, 403, 'removing needs the current PIN');
    assert.equal((await j('PUT', '/api/hosting/pin', { pin: '', current: '2468' })).body.pin, false);
    assert.equal((await fetch(`${lb}/api/presets`)).status, 200, 'open again');
    assert.ok(!existsSync(join(dir, 'hosting.json')) || !JSON.stringify(await (await import('node:fs/promises')).readFile(join(dir, 'hosting.json'), 'utf8')).includes('2468'), 'PIN never stored in clear');
  } finally {
    lan.close();
  }
});

// ---------------------------------------------------------------- launcher

function launch(args, { cwd, env = {} } = {}) {
  const e = { ...process.env, ...env };
  for (const k of ['STLTOOLS_DATA', 'STLTOOLS_HOME', 'STLTOOLS_CUSTOM', 'HOST', 'PORT']) delete e[k];
  const child = spawn(process.execPath, args, { cwd, env: e, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`launcher did not start:\n${out}`)), 30000);
    child.stdout.on('data', () => { if (/Close this window/.test(out)) { clearTimeout(t); res(); } });
    child.on('exit', (code) => { clearTimeout(t); if (!/Close this window/.test(out)) rej(new Error(`launcher exited ${code}:\n${out}`)); });
  });
  const exited = new Promise((res) => child.on('exit', (code) => res(code)));
  return { child, ready, exited, out: () => out };
}
const freePort = () => 40000 + Math.floor(Math.random() * 20000);
const dataLine = (out) => (out.match(/Your data:\s+(.+)/) ?? [])[1]?.trim();

test('launcher --temp --hours: one-time session in a temp folder, stops itself, folder removed', { timeout: 60000 }, async () => {
  const port = freePort();
  const l = launch(['bin/stltools-app.js', '--temp', '--no-browser', '--port', String(port), '--hours', '0.0015']);
  try {
  await l.ready;
  const data = dataLine(l.out());
  assert.ok(data.startsWith(tmpdir()) || data.startsWith(await realpath(tmpdir())), data);
  assert.match(l.out(), /Temporary/);
  assert.match(l.out(), /Auto-stop/);
  const h = await (await fetch(`http://127.0.0.1:${port}/api/hosting`)).json();
  assert.equal(h.mode, 'temp');
  assert.ok(h.stopAt);
  assert.equal(await l.exited, 0, 'stopped by itself');
  assert.ok(!existsSync(data), 'temp data deleted');
  } finally {
    l.child.kill('SIGTERM'); // never leave a launcher running if an assertion failed
  }
});

test('launcher portable: portable.txt next to app/ keeps data on the drive', { timeout: 60000 }, async () => {
  // realpath: on macOS /var is a link to /private/var and the launcher reports real paths
  const usb = await realpath(await mkdtemp(join(tmpdir(), 'stltools-usb-')));
  let l = null;
  try {
    const appDir = join(usb, 'app');
    await mkdir(appDir);
    for (const d of ['bin', 'src', 'public', 'presets', 'printer-profiles', 'seed', 'custom', 'package.json']) if (existsSync(d)) await cp(d, join(appDir, d), { recursive: true });
    await symlink(resolve('node_modules'), join(appDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(join(usb, 'portable.txt'), 'STL Tools keeps its data next to this file.\n');
    const port = freePort();
    l = launch([join(appDir, 'bin', 'stltools-app.js'), '--no-browser', '--port', String(port)], { cwd: usb });
    await l.ready;
    assert.equal(dataLine(l.out()), join(usb, 'stltools-data', 'data'));
    assert.match(l.out(), /Portable/);
    const h = await (await fetch(`http://127.0.0.1:${port}/api/hosting`)).json();
    assert.equal(h.mode, 'portable');
    assert.equal(h.dataDir, join(usb, 'stltools-data', 'data'));
    l.child.kill('SIGTERM');
    await l.exited;
    assert.ok(existsSync(join(usb, 'stltools-data', 'custom', 'package.json')), 'data stays on the drive after stop');
  } finally {
    l?.child.kill('SIGTERM');
    await rm(usb, { recursive: true, force: true });
  }
});
