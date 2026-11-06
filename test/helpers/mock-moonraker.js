// Minimal fake Moonraker (Klipper API) for tests and UI demos.
// Answers the read-only endpoints STL Tools uses with the documented shapes,
// accepts uploads, and records every request so tests can prove that no
// control endpoint is ever called.

import { createServer } from 'node:http';

const PNG_1PX = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360f8cfc0f01f0005000201f5a3f8f50000000049454e44ae426082', 'hex');

// Klipper values for the toolhead / configfile query (SV07-like; not Sovol's real config).
export const MOCK_MACHINE = { axis_minimum: [-2, -3, 0, -9999], axis_maximum: [222, 222, 250, 9999], max_velocity: 500, max_accel: 8000, nozzle: 0.4, filament: 1.75 };

// One small JPEG frame (1x1) for the fake MJPEG stream.
const JPEG_1PX = Buffer.from('ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbfcffd9', 'hex');

export function startMockMoonraker({ port = 0, state = 'printing', webcams = 'listed', webcamService = 'mjpegstreamer' } = {}) {
  const requests = [];
  const streams = { open: 0, closed: 0 };
  const uploads = [];
  const files = [
    { path: 'clamp-mount-16_PLA_0.2mm.gcode', modified: 1762370000, size: 482113, permissions: 'rw' },
    { path: 'stltools/esc-tray_PETG_0.2mm.gcode', modified: 1762360000, size: 911002, permissions: 'rw' },
  ];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    requests.push({ method: req.method, path: url.pathname, query: url.search, apiKey: req.headers['x-api-key'] ?? null });
    const json = (result, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify({ result })); };
    const p = url.pathname;
    if (p === '/server/info') return json({ klippy_connected: true, klippy_state: 'ready', moonraker_version: 'v0.9.3-mock' });
    if (p === '/printer/info') return json({ state: 'ready', state_message: 'Printer is ready', hostname: 'sv07-mock', software_version: 'v0.12.0-mock' });
    if (p === '/printer/objects/query' && url.searchParams.has('toolhead')) {
      return json({ eventtime: 1, status: {
        toolhead: { axis_minimum: MOCK_MACHINE.axis_minimum, axis_maximum: MOCK_MACHINE.axis_maximum, max_velocity: MOCK_MACHINE.max_velocity, max_accel: MOCK_MACHINE.max_accel },
        configfile: { settings: { printer: { kinematics: 'cartesian', max_velocity: MOCK_MACHINE.max_velocity, max_accel: MOCK_MACHINE.max_accel }, extruder: { nozzle_diameter: MOCK_MACHINE.nozzle, filament_diameter: MOCK_MACHINE.filament } } },
      } });
    }
    if (p === '/printer/objects/query') {
      return json({ eventtime: 1, status: {
        print_stats: { filename: state === 'standby' ? '' : files[0].path, state, print_duration: 1800, total_duration: 1900, filament_used: 2400.5, message: '', info: { total_layer: 120, current_layer: 48 } },
        virtual_sdcard: { progress: state === 'standby' ? 0 : 0.4, is_active: state === 'printing' },
        display_status: { progress: state === 'standby' ? 0 : 0.4, message: null },
        extruder: { temperature: 214.8, target: 215 },
        heater_bed: { temperature: 59.9, target: 60 },
        webhooks: { state: 'ready', state_message: 'Printer is ready' },
      } });
    }
    if (p === '/server/files/list') return json(files);
    if (p === '/server/files/roots') return json([{ name: 'config', path: '/home/sovol/printer_data/config', permissions: 'rw' }, { name: 'gcodes', path: '/home/sovol/printer_data/gcodes', permissions: 'rw' }]);
    if (p === '/server/files/metadata') {
      const f = files.find((x) => x.path === url.searchParams.get('filename'));
      if (!f) return json(null, 404);
      return json({ ...f, filename: f.path, slicer: 'OrcaSlicer', slicer_version: '2.2.0', estimated_time: 4500, filament_total: 6000, layer_height: 0.2, object_height: 24, nozzle_diameter: 0.4,
        thumbnails: [{ width: 32, height: 32, size: 100, relative_path: `.thumbs/${f.path.split('/').pop().replace('.gcode', '')}-32x32.png` }, { width: 300, height: 300, size: 2000, relative_path: `.thumbs/${f.path.split('/').pop().replace('.gcode', '')}-300x300.png` }] });
    }
    if (p.startsWith('/server/files/gcodes/') && p.includes('/.thumbs/')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG_1PX); }
    if (p === '/server/history/list') return json({ count: 1, jobs: [{ job_id: '000042', filename: files[1].path, status: 'completed', start_time: 1762350000, end_time: 1762355000, print_duration: 4800, total_duration: 5000, filament_used: 5800, metadata: { thumbnails: [{ width: 300, height: 300, relative_path: '.thumbs/esc-tray_PETG_0.2mm-300x300.png' }] } }] });
    if (p === '/server/webcams/list') return json({ webcams: webcams === 'listed' ? [{ name: 'cam', enabled: true, service: webcamService, snapshot_url: '/webcam/?action=snapshot', stream_url: '/webcam/?action=stream' }] : [] });
    if (p === '/webcam/' && url.searchParams.get('action') === 'stream') {
      // MJPEG: a frame every 100 ms until the client goes away
      streams.open++;
      res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame' });
      const frame = () => res.write(Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${JPEG_1PX.length}\r\n\r\n`), JPEG_1PX, Buffer.from('\r\n')]));
      frame();
      const t = setInterval(frame, 100);
      res.on('close', () => { clearInterval(t); streams.closed++; });
      return;
    }
    if (p === '/webcam/') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG_1PX); }
    if (p === '/server/files/upload' && req.method === 'POST') {
      const text = body.toString('latin1');
      const field = (name) => (text.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`)) ?? [])[1] ?? null;
      const filename = (text.match(/name="file"; filename="([^"]+)"/) ?? [])[1];
      uploads.push({ filename, root: field('root'), path: field('path'), print: field('print'), bytes: body.length });
      files.unshift({ path: `${field('path') ? `${field('path')}/` : ''}${filename}`, modified: Date.now() / 1000, size: 10, permissions: 'rw' });
      res.writeHead(201, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ result: { item: { path: filename, root: 'gcodes', size: 10 }, print_started: false, print_queued: false, action: 'create_file' } }));
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 404, message: 'Not found' } }));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, requests, uploads, streams })));
}
