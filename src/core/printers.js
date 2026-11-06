// Klipper / Moonraker printers on the LAN (Sovol SV07 and other Klipper printers
// that run Mainsail or Fluidd). VIEW ONLY, by design:
//
//   allowed:  status, temperatures, progress, layer, file list + thumbnails,
//             file metadata, print history, webcam snapshots and live MJPEG video,
//             machine limits (toolhead + configfile query) for estimates,
//             uploading a G-code file with print=false (never starts a job)
//   never:    start / pause / resume / cancel, G-code commands, emergency stop,
//             restarts, deleting or moving files, changing settings
//
// There is no generic proxy: each Moonraker call below is a fixed, read-only
// endpoint, so nothing in STL Tools can control or break a print.
// Moonraker API: https://moonraker.readthedocs.io (external_api/printer, file_manager,
// history, webcams). The optional API key is only stored on this server and is
// never sent to the browser.

import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { createJsonFile } from './jsonstore.js';
import { CatalogError } from './catalog.js';
import { getProfile } from './profiles.js';

// Printer host boards (the SV07 runs Klipper on a small ARM board) can be slow
// while printing, so allow a few seconds before calling it offline.
const TIMEOUT = 6000;
const GCODE_EXT = /\.(gcode|g|gco|bgcode)$/i;
export const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;

/** Only addresses on a local network: private IPv4, Tailscale range, .local/.lan/.home names, bare hostnames. */
export function isLanHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.home') || h.endsWith('.home.arpa') || h.endsWith('.ts.net')) return true;
  return !h.includes('.') && /^[a-z0-9-]+$/.test(h);
}

export function normalizeUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) throw new CatalogError('Printer address is required, e.g. 192.168.1.50 or sv07.local');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new CatalogError(`"${input}" is not a valid address`);
  }
  if (!isLanHost(u.hostname)) throw new CatalogError(`${u.hostname} is not a local network address. Printers must be on your LAN (or Tailscale).`);
  return `${u.protocol}//${u.host}`;
}

function publicView(p) {
  const { apiKey, ...rest } = p;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

async function mr(printer, path, { method = 'GET', body, headers = {}, raw = false, timeout = TIMEOUT } = {}) {
  const h = { ...headers };
  if (printer.apiKey) h['X-Api-Key'] = printer.apiKey;
  let res;
  try {
    res = await fetch(printer.url + path, { method, body, headers: h, signal: AbortSignal.timeout(timeout) });
  } catch (err) {
    const why = err.name === 'TimeoutError' ? 'did not answer in time' : err.cause?.code ?? err.message;
    throw Object.assign(new Error(`Printer ${printer.name} (${printer.url}) ${why}`), { status: 502 });
  }
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`Printer ${printer.name} refused the request (needs an API key or trusted client setting in moonraker.conf)`), { status: 502 });
  if (!res.ok) throw Object.assign(new Error(`Printer ${printer.name} answered HTTP ${res.status} for ${path.split('?')[0]}`), { status: 502 });
  if (raw) return res;
  const data = await res.json();
  return data.result ?? data;
}

function snapshotUrl(printer, cam, key = 'snapshot_url') {
  const u = String(cam[key] ?? '');
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  // Relative webcam paths are served by the printer's web server (Mainsail /
  // nginx). If the printer was added by Moonraker's own port 7125, use the
  // default web port instead; any other port (80, 4408, ...) is the web server.
  const base = new URL(printer.url);
  const host = base.port === '7125' ? base.hostname : base.host;
  return `${base.protocol}//${host}${u.startsWith('/') ? '' : '/'}${u}`;
}

// Mainsail / Fluidd default camera paths (crowsnest or mjpg-streamer behind nginx).
// Used only when Moonraker lists no webcam; the profile's "webcam" block wins.
const DEFAULT_CAM = { stream: '/webcam/?action=stream', snapshot: '/webcam/?action=snapshot' };
// Moonraker webcam services whose stream_url is plain MJPEG (can be shown in an <img>).
const MJPEG_SERVICES = new Set(['mjpegstreamer', 'uv4l-mjpeg', '']);
const MAX_STREAMS_PER_PRINTER = 3;

const cleanModel = (m) => (m && /^[a-z0-9][a-z0-9-]{1,40}$/.test(String(m)) ? String(m) : '');

/** Best guess of the printer profile from the Klipper host name (sovol, sv07...). Empty if unknown. */
export function guessModel(hostname) {
  const h = String(hostname ?? '').toLowerCase();
  if (/sv0?7/.test(h)) return 'sovol-sv07';
  return '';
}

export function createPrinters({ dataDir }) {
  const file = createJsonFile(join(dataDir, 'printers.json'), []);
  const metaCache = new Map(); // `${id}|${filename}|${modified}` -> metadata
  const checks = new Map(); // id -> { ok, at, klippy?, error? } from the last connection check
  const openStreams = new Map(); // id -> open webcam streams

  const find = async (id) => {
    const p = (await file.get()).find((x) => x.id === id);
    if (!p) throw new CatalogError(`No printer ${id}`, 404);
    return p;
  };

  const api = {
    async list() {
      return (await file.get()).map((p) => ({ ...publicView(p), lastCheck: checks.get(p.id) ?? null }));
    },

    async add({ name, url, apiKey, model }) {
      const list = await file.get();
      const clean = normalizeUrl(url);
      if (list.some((p) => p.url === clean)) throw new CatalogError(`${clean} is already added`);
      const p = {
        id: `printer-${randomBytes(3).toString('hex')}`,
        name: String(name ?? '').trim().slice(0, 60) || new URL(clean).hostname,
        url: clean,
        apiKey: apiKey ? String(apiKey).trim().slice(0, 200) : '',
        model: cleanModel(model),
        addedAt: new Date().toISOString(),
      };
      await file.set([...list, p]);
      return publicView(p);
    },

    async update(id, { name, url, apiKey, model }) {
      const list = await file.get();
      const cur = await find(id);
      const next = {
        ...cur,
        name: name !== undefined ? String(name).trim().slice(0, 60) || cur.name : cur.name,
        url: url !== undefined ? normalizeUrl(url) : cur.url,
        machine: url !== undefined && normalizeUrl(url) !== cur.url ? undefined : cur.machine,
        apiKey: apiKey === undefined ? cur.apiKey : String(apiKey).trim().slice(0, 200),
        model: model === undefined ? cur.model ?? '' : cleanModel(model),
      };
      await file.set(list.map((p) => (p.id === id ? next : p)));
      return publicView(next);
    },

    /** Saved API key, server side only (used by diagnose for a saved printer). */
    async apiKeyOf(id) {
      return (await find(id)).apiKey || undefined;
    },

    async remove(id) {
      const list = await file.get();
      await find(id);
      await file.set(list.filter((p) => p.id !== id));
    },

    /**
     * Step-by-step connection test for the Settings page. Runs only the same
     * read-only requests the Printers page uses and reports each one, so a
     * failure says exactly what to fix. Never throws for printer errors.
     */
    async diagnose(url, apiKey) {
      const steps = [];
      let p;
      try {
        p = { name: 'printer', url: normalizeUrl(url), apiKey };
        steps.push({ step: 'Address', ok: true, detail: `${p.url} is a local network address.` });
      } catch (err) {
        steps.push({ step: 'Address', ok: false, detail: err.message, fix: 'Use the IP address shown on the printer screen (Settings > Network), e.g. 192.168.1.50.' });
        return { ok: false, steps };
      }
      const run = async (step, fn, fix) => {
        try {
          const detail = await fn();
          steps.push({ step, ok: true, detail });
          return true;
        } catch (err) {
          steps.push({ step, ok: false, detail: err.message, fix });
          return false;
        }
      };
      let info = null;
      const reached = await run('Moonraker answers', async () => {
        info = await mr(p, '/server/info');
        return `Moonraker ${info.moonraker_version ?? '?'}, Klipper state "${info.klippy_state}".`;
      }, 'Open the same address in a browser. If Mainsail opens there but this fails, try port 7125 (e.g. 192.168.1.50:7125). If it says "refused", add this computer to trusted_clients in moonraker.conf or enter an API key.');
      if (!reached) return { ok: false, steps };
      let hostname = null;
      await run('Printer info', async () => {
        const pi = await mr(p, '/printer/info');
        hostname = pi.hostname ?? null;
        return `Host "${pi.hostname ?? '?'}", Klipper ${pi.software_version ?? '?'}, state "${pi.state}".`;
      }, 'Klipper may be stopped or in an error state. Check Mainsail; STL Tools never restarts it.');
      await run('Status query', async () => {
        const q = await mr(p, '/printer/objects/query?print_stats&extruder=temperature&heater_bed=temperature');
        const st = q.status ?? {};
        return `State "${st.print_stats?.state ?? '?'}", nozzle ${st.extruder?.temperature?.toFixed?.(0) ?? '?'} C, bed ${st.heater_bed?.temperature?.toFixed?.(0) ?? '?'} C.`;
      }, 'Klipper is not ready. Fix it in Mainsail (FIRMWARE_RESTART there, not here).');
      await run('File list', async () => {
        const files = await mr(p, '/server/files/list?root=gcodes');
        return `${files.length} G-code file(s) on the printer.`;
      }, 'Moonraker file manager is not available.');
      await run('Upload folder', async () => {
        const roots = await mr(p, '/server/files/roots');
        const g = (Array.isArray(roots) ? roots : []).find((r) => r.name === 'gcodes');
        if (!g) throw new Error('No "gcodes" root on this printer.');
        if (g.permissions && !String(g.permissions).includes('w')) throw new Error('The gcodes folder is read-only.');
        return 'gcodes folder is writable (uploads always use print=false).';
      }, 'Uploads need a writable gcodes folder in Moonraker.');
      let machine = null;
      await run('Printer limits (for estimates)', async () => {
        const q = await mr(p, '/printer/objects/query?toolhead&configfile=settings');
        const th = q.status?.toolhead ?? {};
        const ex = q.status?.configfile?.settings?.extruder ?? {};
        const lo = th.axis_minimum ?? [];
        const hi = th.axis_maximum ?? [];
        machine = { x: hi[0] - Math.max(0, lo[0] ?? 0), y: hi[1] - Math.max(0, lo[1] ?? 0), z: hi[2] - Math.max(0, lo[2] ?? 0) };
        return `Travel ${[machine.x, machine.y, machine.z].map((v) => (Number.isFinite(v) ? v.toFixed(0) : '?')).join(' x ')} mm, max ${th.max_velocity ?? '?'} mm/s, accel ${th.max_accel ?? '?'} mm/s2, nozzle ${ex.nozzle_diameter ?? '?'} mm.`;
      }, 'Optional. Estimates then use the printer profile only.');
      const model = guessModel(hostname, info);
      await run('Webcam', async () => {
        const cams = await api.cameras({ ...p, model });
        if (!cams.length) return 'No webcam found (optional).';
        const c = cams[0];
        const kind = c.stream_url && MJPEG_SERVICES.has(c.service ?? '') ? 'live video + snapshots' : c.snapshot_url ? 'snapshots' : 'not viewable here';
        return `${cams.length} webcam(s): ${cams.map((x) => x.name).join(', ')}. ${kind}${c.guessed ? ' (found at the Mainsail default path)' : ''}.`;
      }, 'Optional. Configure the camera in Mainsail (Settings > Webcams).');
      return { ok: steps.every((s) => s.ok), steps, url: p.url, hostname, model };
    },

    /** Test an address before saving it. */
    async probe(url, apiKey) {
      const p = { name: 'printer', url: normalizeUrl(url), apiKey };
      const info = await mr(p, '/server/info');
      let host = null;
      try { host = (await mr(p, '/printer/info')).hostname; } catch { /* klippy may be down */ }
      return { url: p.url, klippyState: info.klippy_state, moonraker: info.moonraker_version, hostname: host, model: guessModel(host) };
    },

    /** Live status, normalized for the UI. */
    async status(id) {
      const p = await find(id);
      const [server, objs] = await Promise.all([
        mr(p, '/server/info'),
        mr(p, '/printer/objects/query?print_stats&virtual_sdcard&display_status&extruder=temperature,target&heater_bed=temperature,target&webhooks').catch(() => null),
      ]);
      const st = objs?.status ?? {};
      const ps = st.print_stats ?? {};
      const progress = st.virtual_sdcard?.progress ?? st.display_status?.progress ?? 0;
      let meta = null;
      if (ps.filename) meta = await api.metadata(id, ps.filename).catch(() => null);
      const printing = ps.state === 'printing' || ps.state === 'paused';
      let remaining = null;
      if (printing && meta?.estimated_time && progress > 0) remaining = Math.max(0, meta.estimated_time * (1 - progress));
      else if (printing && progress > 0.02 && ps.print_duration) remaining = ps.print_duration / progress - ps.print_duration;
      return {
        id: p.id,
        name: p.name,
        url: p.url,
        online: true,
        klippy: server.klippy_state,
        webhooks: st.webhooks?.state ?? null,
        message: ps.message || st.webhooks?.state_message || '',
        state: ps.state ?? (server.klippy_state === 'ready' ? 'standby' : server.klippy_state),
        filename: ps.filename || null,
        progress,
        printDuration: ps.print_duration ?? 0,
        totalDuration: ps.total_duration ?? 0,
        remaining,
        filamentUsed: ps.filament_used ?? 0,
        layer: ps.info ? { current: ps.info.current_layer ?? null, total: ps.info.total_layer ?? null } : null,
        temps: {
          extruder: st.extruder ? { actual: st.extruder.temperature, target: st.extruder.target } : null,
          bed: st.heater_bed ? { actual: st.heater_bed.temperature, target: st.heater_bed.target } : null,
        },
        thumbnail: meta?.thumbnail ?? null,
        updatedAt: new Date().toISOString(),
      };
    },

    async files(id) {
      await find(id);
      const p = await find(id);
      const list = await mr(p, '/server/files/list?root=gcodes');
      return list
        .map((f) => ({ path: f.path ?? f.filename, modified: f.modified, size: f.size }))
        .filter((f) => f.path && !f.path.split('/').some((seg) => seg.startsWith('.')))
        .sort((a, b) => b.modified - a.modified)
        .slice(0, 300);
    },

    async metadata(id, filename) {
      const p = await find(id);
      const m = await mr(p, `/server/files/metadata?filename=${encodeURIComponent(filename)}`);
      const key = `${id}|${filename}|${m.modified}`;
      if (metaCache.has(key)) return metaCache.get(key);
      const dir = filename.includes('/') ? filename.slice(0, filename.lastIndexOf('/') + 1) : '';
      const thumbs = (m.thumbnails ?? []).filter((t) => t.relative_path).sort((a, b) => b.width - a.width);
      const out = {
        filename,
        modified: m.modified,
        size: m.size,
        slicer: [m.slicer, m.slicer_version].filter(Boolean).join(' '),
        estimated_time: m.estimated_time ?? null,
        filament_total: m.filament_total ?? null,
        filament_weight: m.filament_weight_total ?? null,
        layer_height: m.layer_height ?? null,
        object_height: m.object_height ?? null,
        nozzle: m.nozzle_diameter ?? null,
        thumbnail: thumbs.length ? `${dir}${thumbs[0].relative_path}` : null,
      };
      metaCache.set(key, out);
      if (metaCache.size > 2000) metaCache.delete(metaCache.keys().next().value);
      return out;
    },

    /** Thumbnail image bytes; only paths inside a .thumbs folder are allowed. */
    async thumbnail(id, path) {
      const p = await find(id);
      const clean = String(path ?? '');
      if (!/(^|\/)\.thumbs\/[^/]+\.(png|jpe?g)$/i.test(clean) || clean.includes('..')) throw new CatalogError('Not a thumbnail path');
      const res = await mr(p, `/server/files/gcodes/${clean.split('/').map(encodeURIComponent).join('/')}`, { raw: true });
      return { type: res.headers.get('content-type') ?? 'image/png', data: Buffer.from(await res.arrayBuffer()) };
    },

    async history(id, limit = 20) {
      const p = await find(id);
      const h = await mr(p, `/server/history/list?limit=${Math.min(100, Math.max(1, limit))}&order=desc`);
      return (h.jobs ?? []).map((j) => ({
        id: j.job_id,
        filename: j.filename,
        status: j.status,
        start: j.start_time,
        end: j.end_time,
        printDuration: j.print_duration,
        totalDuration: j.total_duration,
        filamentUsed: j.filament_used,
        thumbnail: (() => {
          const t = (j.metadata?.thumbnails ?? []).filter((x) => x.relative_path).sort((a, b) => b.width - a.width)[0];
          if (!t) return null;
          const dir = j.filename?.includes('/') ? j.filename.slice(0, j.filename.lastIndexOf('/') + 1) : '';
          return `${dir}${t.relative_path}`;
        })(),
      }));
    },

    /**
     * Cameras as Mainsail / Fluidd show them. Source order: Moonraker's webcam list
     * (Mainsail and Fluidd save their camera settings there), else the printer
     * profile's webcam paths, else the Mainsail defaults. A guessed camera is
     * marked guessed: true and only shown when its snapshot answers.
     *   -> [{ index, name, service, stream: bool, snapshot: bool, flipH, flipV, rotation, fps, guessed }]
     */
    async cameras(p) {
      const r = await mr(p, '/server/webcams/list').catch(() => ({ webcams: [] }));
      const listed = (r.webcams ?? []).filter((c) => c.enabled !== false && (c.snapshot_url || c.stream_url));
      if (listed.length) return listed.map((c) => ({ ...c, guessed: false }));
      const prof = getProfile(p.model)?.webcam ?? DEFAULT_CAM;
      const cam = { name: 'webcam', service: 'mjpegstreamer', stream_url: prof.stream ?? DEFAULT_CAM.stream, snapshot_url: prof.snapshot ?? DEFAULT_CAM.snapshot, guessed: true };
      try {
        const res = await fetch(snapshotUrl(p, cam), { signal: AbortSignal.timeout(3000) });
        await res.body?.cancel();
        if (res.ok && /^image\//.test(res.headers.get('content-type') ?? '')) return [cam];
      } catch { /* no camera at the default path */ }
      return [];
    },

    async webcams(id) {
      const p = await find(id);
      return (await api.cameras(p)).map((c, i) => ({
        index: i,
        name: c.name,
        service: c.service ?? '',
        stream: Boolean(c.stream_url) && MJPEG_SERVICES.has(c.service ?? ''),
        snapshot: Boolean(c.snapshot_url),
        flipH: Boolean(c.flip_horizontal),
        flipV: Boolean(c.flip_vertical),
        rotation: c.rotation ?? 0,
        fps: c.target_fps ?? null,
        guessed: c.guessed,
      }));
    },

    async snapshot(id, index = 0) {
      const p = await find(id);
      const cam = (await api.cameras(p)).filter((c) => c.snapshot_url)[index];
      if (!cam) throw new CatalogError('No webcam with a snapshot URL', 404);
      const url = snapshotUrl(p, cam);
      if (!isLanHost(new URL(url).hostname)) throw new CatalogError('Webcam is not on the local network');
      let res;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
      } catch (err) {
        throw Object.assign(new Error(`Webcam did not answer: ${err.cause?.code ?? err.message}`), { status: 502 });
      }
      if (!res.ok) throw Object.assign(new Error(`Webcam answered HTTP ${res.status}`), { status: 502 });
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > 8 * 1024 * 1024) throw Object.assign(new Error('Snapshot too large'), { status: 502 });
      return { type: res.headers.get('content-type') ?? 'image/jpeg', data };
    },

    /**
     * Live MJPEG video from the printer's camera (the stream Mainsail shows).
     * GET only, same LAN rule as snapshots. Returns { type, body, close } where body
     * is a web ReadableStream; the caller pipes it and calls close() when the
     * browser goes away. At most 3 open streams per printer (Pi-friendly).
     */
    async stream(id, index = 0) {
      const p = await find(id);
      if ((openStreams.get(id) ?? 0) >= MAX_STREAMS_PER_PRINTER) throw new CatalogError('Too many open video streams for this printer. Close a tab.', 429);
      const cam = (await api.cameras(p)).filter((c) => c.snapshot_url || c.stream_url)[index];
      if (!cam?.stream_url) throw new CatalogError('This webcam has no stream URL. Use snapshots.', 404);
      if (!MJPEG_SERVICES.has(cam.service ?? '')) throw new CatalogError(`Webcam service "${cam.service}" is not MJPEG. Use snapshots, or open Mainsail for its video.`, 415);
      const url = snapshotUrl(p, cam, 'stream_url');
      if (!isLanHost(new URL(url).hostname)) throw new CatalogError('Webcam is not on the local network');
      const ctrl = new AbortController();
      const connect = setTimeout(() => ctrl.abort(), TIMEOUT);
      let res;
      try {
        res = await fetch(url, { signal: ctrl.signal });
      } catch (err) {
        throw Object.assign(new Error(`Webcam stream did not answer: ${err.cause?.code ?? err.message}`), { status: 502 });
      } finally {
        clearTimeout(connect);
      }
      if (!res.ok || !res.body) { ctrl.abort(); throw Object.assign(new Error(`Webcam stream answered HTTP ${res.status}`), { status: 502 }); }
      openStreams.set(id, (openStreams.get(id) ?? 0) + 1);
      let closed = false;
      return {
        type: res.headers.get('content-type') ?? 'multipart/x-mixed-replace',
        body: res.body,
        close: () => {
          if (closed) return;
          closed = true;
          openStreams.set(id, Math.max(0, (openStreams.get(id) ?? 1) - 1));
          ctrl.abort();
        },
      };
    },

    /**
     * The printer's own limits from Klipper's config, for estimates: one read-only
     * query of toolhead + configfile. Saved on the printer as `machine`.
     *   -> { bed: {x,y,z}, maxVelocity, maxAccel, nozzle, filamentDiameter, kinematics, readAt }
     */
    async machine(id) {
      const p = await find(id);
      const q = await mr(p, '/printer/objects/query?toolhead&configfile=settings');
      const th = q.status?.toolhead ?? {};
      const cfg = q.status?.configfile?.settings ?? {};
      const lo = th.axis_minimum ?? [];
      const hi = th.axis_maximum ?? [];
      const span = (i) => (Number.isFinite(hi[i]) && Number.isFinite(lo[i]) ? Math.round((hi[i] - Math.max(0, lo[i])) * 10) / 10 : null);
      const pos = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
      const bed = { x: span(0), y: span(1), z: span(2) };
      const m = {
        bed: bed.x && bed.y && bed.z ? bed : null,
        maxVelocity: pos(th.max_velocity ?? cfg.printer?.max_velocity),
        maxAccel: pos(th.max_accel ?? cfg.printer?.max_accel),
        nozzle: pos(cfg.extruder?.nozzle_diameter),
        filamentDiameter: pos(cfg.extruder?.filament_diameter),
        kinematics: String(cfg.printer?.kinematics ?? '').slice(0, 20) || null,
        readAt: new Date().toISOString(),
      };
      const list = await file.get();
      await file.set(list.map((x) => (x.id === id ? { ...x, machine: m } : x)));
      return m;
    },

    /** Read-only "are you there?" for one printer; remembered for the UI. */
    async check(id) {
      const p = await find(id);
      const at = new Date().toISOString();
      try {
        const info = await mr(p, '/server/info', { timeout: 4000 });
        const result = { ok: true, at, klippy: info.klippy_state ?? null };
        checks.set(id, result);
        if (!p.machine) await api.machine(id).catch(() => null);
        return result;
      } catch (err) {
        const result = { ok: false, at, error: err.message };
        checks.set(id, result);
        return result;
      }
    },

    async checkAll() {
      const list = await file.get();
      return Object.fromEntries(await Promise.all(list.map(async (p) => [p.id, await api.check(p.id)])));
    },

    /** Upload a G-code file to the printer's gcodes folder. Never starts a print (print=false). */
    async upload(id, filename, data, subdir = '') {
      const p = await find(id);
      const name = String(filename ?? '').split(/[\\/]/).pop();
      if (!GCODE_EXT.test(name)) throw new CatalogError('Only G-code files (.gcode, .g, .gco, .bgcode) can be uploaded to a printer. Slice the STL first.');
      if (data.length > MAX_UPLOAD_BYTES) throw new CatalogError('File is larger than 256 MB');
      const folder = String(subdir ?? '').replace(/[^A-Za-z0-9_\- /]/g, '').replace(/^\/+|\/+$/g, '').slice(0, 80);
      const form = new FormData();
      form.append('root', 'gcodes');
      if (folder) form.append('path', folder);
      form.append('print', 'false');
      form.append('file', new Blob([data]), name);
      const r = await mr(p, '/server/files/upload', { method: 'POST', body: form, timeout: 120000 });
      if (r.print_started) throw new Error('Printer reported print_started after upload. This should never happen; check moonraker settings.');
      return { path: r.item?.path ?? name, size: r.item?.size ?? data.length };
    },
  };
  return api;
}

/** Look for Moonraker on this machine's own /24 networks (GET /server/info only). */
export async function scanLan({ ports = [7125, 80], timeout = 700, concurrency = 48 } = {}) {
  const bases = new Set();
  for (const i of Object.values(networkInterfaces()).flat()) {
    if (i && i.family === 'IPv4' && !i.internal && isLanHost(i.address)) bases.add(i.address.split('.').slice(0, 3).join('.'));
  }
  const targets = [];
  for (const b of [...bases].slice(0, 4)) for (let n = 1; n < 255; n++) for (const port of ports) targets.push(`http://${b}.${n}${port === 80 ? '' : `:${port}`}`);
  const found = [];
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const url = targets[next++];
      try {
        const res = await fetch(`${url}/server/info`, { signal: AbortSignal.timeout(timeout) });
        if (!res.ok) continue;
        const info = (await res.json()).result;
        if (!info?.klippy_state) continue;
        let hostname = null;
        try { hostname = (await (await fetch(`${url}/printer/info`, { signal: AbortSignal.timeout(timeout) })).json()).result?.hostname; } catch { /* ignore */ }
        found.push({ url, klippyState: info.klippy_state, hostname });
      } catch { /* not a printer */ }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  // Same printer on :80 and :7125: keep the port-80 (Mainsail) address.
  const byHost = new Map();
  for (const f of found) {
    const host = new URL(f.url).hostname;
    if (!byHost.has(host) || !new URL(f.url).port) byHost.set(host, f);
  }
  return { networks: [...bases].map((b) => `${b}.0/24`), printers: [...byHost.values()] };
}
