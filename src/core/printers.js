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
//
// CONTROL MODE (opt-in, per printer, off by default): the user can turn on
// control for one printer after a warning. Only then do the fixed control calls
// in control() work: pause, resume, cancel, start a file already on the printer,
// upload-and-print, G-code console, emergency stop, Klipper / firmware restart,
// restart crowsnest. Every control call (and every refusal) is logged to
// <data>/printer-control.log (one JSON line each). Connection tests, status and
// background checks never call a control endpoint.
// Moonraker API: https://moonraker.readthedocs.io (external_api/printer, file_manager,
// history, webcams). The optional API key is only stored on this server and is
// never sent to the browser.

import { join } from 'node:path';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { createJsonFile } from './jsonstore.js';
import { CatalogError } from './catalog.js';
import { getProfile, listProfiles } from './profiles.js';

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
const CONFIG_EXT = /\.(cfg|conf|txt|ini|json)$/i;

// Control actions (only reachable when the user turned control on for that printer).
const SERVICES = new Set(['crowsnest', 'klipper', 'moonraker-timelapse']);
const CONTROL = {
  pause: { path: () => '/printer/print/pause', states: ['printing'] },
  resume: { path: () => '/printer/print/resume', states: ['paused'] },
  cancel: { path: () => '/printer/print/cancel', states: ['printing', 'paused'] },
  start: {
    idleOnly: true,
    path: ({ filename }) => {
      const f = String(filename ?? '');
      if (!GCODE_EXT.test(f) || f.includes('..') || f.startsWith('/')) throw new CatalogError('start needs the path of a G-code file on the printer');
      return `/printer/print/start?filename=${encodeURIComponent(f)}`;
    },
  },
  gcode: {
    path: ({ script }) => {
      const sc = String(script ?? '').trim();
      if (!sc) throw new CatalogError('gcode needs a script, e.g. M115');
      if (sc.length > 2000) throw new CatalogError('G-code script is longer than 2000 characters');
      return `/printer/gcode/script?script=${encodeURIComponent(sc)}`;
    },
    timeout: 60000, // G28, BED_MESH_CALIBRATE etc. answer when done
  },
  estop: { path: () => '/printer/emergency_stop' },
  firmware_restart: { path: () => '/printer/firmware_restart' },
  restart: { path: () => '/printer/restart' },
  service: {
    path: ({ service }) => {
      if (!SERVICES.has(String(service))) throw new CatalogError(`service must be one of ${[...SERVICES].join(', ')}`);
      return `/machine/services/restart?service=${encodeURIComponent(service)}`;
    },
  },
};

/** Hide values of config lines that look like secrets before config text reaches a browser. */
export function redactSecrets(text) {
  return String(text)
    .replace(/^(\s*[\w.-]*(?:api[_-]?key|token|password|passwd|secret|private[_-]?key|webhook|bot_?token|access[_-]?key)[\w.-]*\s*[:=]\s*)(\S.*)$/gim, '$1<hidden by STL Tools>')
    .replace(/(\w+:\/\/)[^/\s@]+@/g, '$1<hidden>@'); // user:password@ and token@ (Apprise notifier URLs)
}

const cleanModel = (m) => (m && /^[a-z0-9][a-z0-9-]{1,40}$/.test(String(m)) ? String(m) : '');

/** Best guess of the printer profile from the Klipper host name (sovol, sv07...). Empty if unknown. */
export function guessModel(hostname) {
  const h = String(hostname ?? '').toLowerCase();
  if (!h) return '';
  // A profile can claim host names (moonraker.hostnameHints) and a priority: a personal
  // profile for the same printer (priority > 0) wins over the shipped one.
  const hit = listProfiles()
    .filter((p) => (p.moonraker?.hostnameHints ?? []).some((x) => h.includes(String(x).toLowerCase())))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
  if (hit) return hit.id;
  // Stock SV07 images name the host "mkspi" (MKS Pi host board) or after the printer.
  if (/sv0?7|mkspi|sovol/.test(h)) return 'sovol-sv07';
  return '';
}

/** Mainsail keeps its own settings (printer name, webcams) in Moonraker's database: read-only GET. */
async function mainsailItem(p, key) {
  try {
    const r = await mr(p, `/server/database/item?namespace=mainsail&key=${encodeURIComponent(key)}`, { timeout: 4000 });
    return r?.value ?? null;
  } catch { return null; }
}

export function createPrinters({ dataDir }) {
  const file = createJsonFile(join(dataDir, 'printers.json'), []);
  /** One JSON line per control call or refusal: time, printer, action, arguments, ok, result. */
  const log = async (p, action, args, ok, result) => {
    const safeArgs = Object.fromEntries(Object.entries(args ?? {}).filter(([k]) => ['filename', 'script', 'service', 'path'].includes(k)).map(([k, v]) => [k, String(v).slice(0, 500)]));
    const line = JSON.stringify({ at: new Date().toISOString(), printer: p.id, name: p.name, action, args: safeArgs, ok, result: String(result ?? '').slice(0, 500) });
    try { await mkdir(dataDir, { recursive: true }); await appendFile(join(dataDir, 'printer-control.log'), line + '\n'); } catch { /* logging must not break the call */ }
  };
  const metaCache = new Map(); // `${id}|${filename}|${modified}` -> metadata
  const checks = new Map(); // id -> { ok, at, klippy?, error? } from the last connection check
  const hubs = new Map(); // id -> live update hub (see subscribe)
  const emit = (hub, ev) => { for (const fn of hub.listeners) { try { fn(ev); } catch { /* listener gone */ } } };
  const liveStatus = (raw) => {
    const ps = raw.print_stats ?? {};
    const progress = raw.virtual_sdcard?.progress ?? raw.display_status?.progress ?? 0;
    return {
      state: ps.state ?? null, filename: ps.filename || null, progress, printDuration: ps.print_duration ?? null, filamentUsed: ps.filament_used ?? null,
      layer: ps.info ? { current: ps.info.current_layer ?? null, total: ps.info.total_layer ?? null } : null,
      message: ps.message || raw.webhooks?.state_message || '',
      temps: { extruder: raw.extruder ? { actual: raw.extruder.temperature, target: raw.extruder.target } : null, bed: raw.heater_bed ? { actual: raw.heater_bed.temperature, target: raw.heater_bed.target } : null },
      live: true, updatedAt: new Date().toISOString(),
    };
  };
  const merge = (dst, src) => { for (const [k, v] of Object.entries(src ?? {})) dst[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(dst[k] ?? {}, v) : v; return dst; };
  const startPolling = (id, hub) => {
    hub.mode = 'polling';
    emit(hub, { type: 'mode', live: false });
    const tick = async () => { try { emit(hub, { type: 'status', status: { ...(await api.status(id)), live: false } }); } catch (err) { emit(hub, { type: 'status', status: { error: err.message } }); } };
    tick();
    hub.timer = setInterval(tick, 1000);
  };
  const startHub = async (id, hub) => {
    const p = await find(id).catch(() => null);
    if (!p) return;
    if (typeof globalThis.WebSocket !== 'function') return startPolling(id, hub);
    const u = new URL(p.url);
    const ws = new globalThis.WebSocket(`${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}/websocket`);
    hub.ws = ws;
    let opened = false;
    const fallback = setTimeout(() => { if (!opened) { try { ws.close(); } catch { /* closed */ } if (hubs.get(id) === hub && !hub.timer) startPolling(id, hub); } }, 5000);
    const send = (method, params, rid) => ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id: rid }));
    ws.onopen = () => {
      opened = true;
      clearTimeout(fallback);
      hub.mode = 'websocket';
      emit(hub, { type: 'mode', live: true });
      send('server.connection.identify', { client_name: 'STL Tools', version: '1', type: 'other', url: 'https://github.com/opsecfreak/STLTools', ...(p.apiKey ? { api_key: p.apiKey } : {}) }, 1);
      send('printer.objects.subscribe', { objects: { print_stats: null, virtual_sdcard: ['progress'], display_status: ['progress'], extruder: ['temperature', 'target'], heater_bed: ['temperature', 'target'], webhooks: ['state', 'state_message'] } }, 2);
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString()); } catch { return; }
      if (msg.id === 2 && msg.result?.status) { merge(hub.raw, msg.result.status); emit(hub, { type: 'status', status: liveStatus(hub.raw) }); }
      else if (msg.method === 'notify_status_update') { merge(hub.raw, msg.params?.[0]); emit(hub, { type: 'status', status: liveStatus(hub.raw) }); }
      else if (msg.method === 'notify_gcode_response') emit(hub, { type: 'console', line: String(msg.params?.[0] ?? ''), at: new Date().toISOString() });
    };
    ws.onerror = () => {};
    ws.onclose = () => { clearTimeout(fallback); if (hubs.get(id) === hub && hub.listeners.size && !hub.timer) startPolling(id, hub); };
  };
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
        // a new address may be a different printer: control has to be turned on again
        control: url !== undefined && normalizeUrl(url) !== cur.url ? { enabled: false } : cur.control,
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
      if (!String(url ?? '').trim()) {
        steps.push({ step: 'Address', ok: false, detail: 'No address entered yet.', fix: 'Type the printer address (the one you open Mainsail with, e.g. 192.168.1.121), or press "Scan my network" and then "Use" on the printer it finds.' });
        return { ok: false, steps };
      }
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
          if (detail && typeof detail === 'object') steps.push({ step, ok: true, ...detail, fix: detail.warn ? fix : undefined });
          else steps.push({ step, ok: true, detail });
          return true;
        } catch (err) {
          steps.push({ step, ok: false, detail: err.message, fix });
          return false;
        }
      };
      let info = null;
      const reachFix = 'Open the same address in a browser. If Mainsail opens there but this fails, try port 7125 (e.g. 192.168.1.50:7125). If it says "refused", add this computer to trusted_clients in moonraker.conf or enter an API key.';
      let reached = await run('Moonraker answers', async () => {
        info = await mr(p, '/server/info');
        return `Moonraker ${info.moonraker_version ?? '?'}, Klipper state "${info.klippy_state}".`;
      }, reachFix);
      if (!reached && !new URL(p.url).port) {
        // Mainsail's web server did not forward the API: try Moonraker's own port once.
        const alt = { ...p, url: `${p.url}:7125` };
        try {
          info = await mr(alt, '/server/info');
          steps.pop();
          p = alt;
          steps.push({ step: 'Moonraker answers', ok: true, detail: `Moonraker ${info.moonraker_version ?? '?'} on port 7125 (the address without a port did not forward the API). STL Tools will use ${alt.url}.` });
          reached = true;
        } catch { /* keep the first failure */ }
      }
      if (!reached) return { ok: false, steps };
      const mainsailName = await mainsailItem(p, 'general');
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
        const where = c.source === 'mainsail' ? ' (from Mainsail\'s webcam settings)' : c.guessed ? ' (found at the Mainsail default path)' : '';
        const st = await api.cameraState(p, c);
        const text = `${cams.length} webcam(s): ${cams.map((x) => x.name).join(', ')}, ${c.service || 'unknown service'}, ${c.stream_url || c.snapshot_url}${where}. ${st.up ? `Answers: ${kind}.` : `Listed but NOT answering: ${st.detail}.`}`;
        return st.up ? text : { detail: text, warn: true };
      }, 'Optional. The camera is set up in Mainsail but its service is not running. On the printer, restart crowsnest (Mainsail > Machine > crowsnest > Restart, or sudo systemctl restart crowsnest). STL Tools never restarts printer services.');
      return { ok: steps.every((s) => s.ok), steps, url: p.url, hostname, model, name: mainsailName?.printername ?? null };
    },

    /** Test an address before saving it. */
    async probe(url, apiKey) {
      const p = { name: 'printer', url: normalizeUrl(url), apiKey };
      const info = await mr(p, '/server/info');
      let host = null;
      try { host = (await mr(p, '/printer/info')).hostname; } catch { /* klippy may be down */ }
      const general = await mainsailItem(p, 'general');
      return { url: p.url, klippyState: info.klippy_state, moonraker: info.moonraker_version, hostname: host, model: guessModel(host), name: general?.printername ?? null };
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
      if (listed.length) return listed.map((c) => ({ ...c, guessed: false, source: 'moonraker' }));
      // Older Moonraker / Mainsail 2.x: Mainsail's own webcam list (Settings > Webcams), as in its backup file:
      // { "<uuid>": { name, service, urlStream, urlSnapshot, rotate, flipX, flipY, targetFps } }
      const ms = await mainsailItem(p, 'webcams');
      const fromMainsail = Object.values(ms && typeof ms === 'object' ? ms : {})
        .filter((c) => c && (c.urlStream || c.urlSnapshot) && c.enabled !== false)
        .map((c) => ({ name: c.name ?? 'Webcam', service: c.service ?? '', stream_url: c.urlStream ?? '', snapshot_url: c.urlSnapshot ?? '', rotation: c.rotate ?? 0, flip_horizontal: Boolean(c.flipX), flip_vertical: Boolean(c.flipY), target_fps: c.targetFps ?? null, guessed: false, source: 'mainsail' }));
      if (fromMainsail.length) return fromMainsail;
      const prof = getProfile(p.model)?.webcam ?? DEFAULT_CAM;
      const cam = { name: 'webcam', service: 'mjpegstreamer', stream_url: prof.stream ?? DEFAULT_CAM.stream, snapshot_url: prof.snapshot ?? DEFAULT_CAM.snapshot, guessed: true, source: 'default' };
      try {
        const res = await fetch(snapshotUrl(p, cam), { signal: AbortSignal.timeout(3000) });
        await res.body?.cancel();
        if (res.ok && /^image\//.test(res.headers.get('content-type') ?? '')) return [cam];
      } catch { /* no camera at the default path */ }
      return [];
    },

    /** Does the camera answer right now? { up, detail } (one snapshot, 4 s). A listed camera can be down (crowsnest stopped). */
    async cameraState(p, cam) {
      const url = cam?.snapshot_url ? snapshotUrl(p, cam) : null;
      if (!url) return { up: false, detail: 'no snapshot URL' };
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        await res.body?.cancel();
        if (res.ok && /^image\//.test(res.headers.get('content-type') ?? '')) return { up: true, detail: 'answers' };
        return { up: false, detail: `HTTP ${res.status} from ${new URL(url).pathname}${res.status === 502 || res.status === 503 ? ' (the web server is up, the camera service behind it is not)' : ''}` };
      } catch (err) {
        return { up: false, detail: err.name === 'TimeoutError' ? 'no answer in 4 s' : err.cause?.code ?? err.message };
      }
    },

    async webcams(id) {
      const p = await find(id);
      const cams = await api.cameras(p);
      const states = await Promise.all(cams.map((c) => api.cameraState(p, c)));
      return cams.map((c, i) => ({
        up: states[i].up,
        state: states[i].detail,
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
        source: c.source,
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

    /** Config files on the printer (read-only list of Moonraker's "config" root). */
    async configFiles(id) {
      const p = await find(id);
      const list = await mr(p, '/server/files/list?root=config');
      return list.map((f) => ({ path: f.path ?? f.filename, size: f.size, modified: f.modified }))
        .filter((f) => f.path && CONFIG_EXT.test(f.path) && !f.path.split('/').some((x) => x.startsWith('.')))
        .sort((a, b) => (a.path === 'printer.cfg' ? -1 : b.path === 'printer.cfg' ? 1 : a.path.localeCompare(b.path)));
    },

    /**
     * Text of one config file (printer.cfg, moonraker.conf, crowsnest.conf, macros...).
     * Read-only GET. Lines that look like secrets (api keys, tokens, passwords) are
     * hidden before the text leaves the server.
     */
    async configFile(id, path) {
      const p = await find(id);
      const clean = String(path ?? '');
      if (!CONFIG_EXT.test(clean) || clean.includes('..') || clean.startsWith('/')) throw new CatalogError('Not a config file path');
      const res = await mr(p, `/server/files/config/${clean.split('/').map(encodeURIComponent).join('/')}`, { raw: true });
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 2 * 1024 * 1024) throw new CatalogError('Config file is larger than 2 MB');
      return { path: clean, text: redactSecrets(buf.toString('utf8')), bytes: buf.length };
    },

    /**
     * Health check of the printer's Klipper setup, from read-only queries:
     * effective config (configfile.settings, includes Klipper defaults), MCU and host
     * versions, filament sensor, bed mesh, input shaper, pending SAVE_CONFIG,
     * Klipper's own config warnings, host system and print totals.
     *   -> { checks: [{ level: ok|info|warn, title, detail }], facts: {...} }
     */
    async health(id) {
      const p = await find(id);
      const objects = (await mr(p, '/printer/objects/list').catch(() => ({ objects: [] }))).objects ?? [];
      const want = ['configfile', 'toolhead', 'bed_mesh', 'print_stats', ...objects.filter((o) => /^mcu( |$)|^filament_(switch|motion)_sensor /.test(o))];
      const q = await mr(p, `/printer/objects/query?${want.map(encodeURIComponent).join('&')}`);
      const st = q.status ?? {};
      const cfg = st.configfile?.settings ?? {};
      const [pinfo, sys, totals] = await Promise.all([
        mr(p, '/printer/info').catch(() => null),
        mr(p, '/machine/system_info').catch(() => null),
        mr(p, '/server/history/totals').catch(() => null),
      ]);
      const checks = [];
      const add = (level, title, detail) => checks.push({ level, title, detail });
      const pr = cfg.printer ?? {};
      add('info', 'Motion limits', `max_velocity ${pr.max_velocity ?? '?'} mm/s, max_accel ${pr.max_accel ?? '?'}, max_accel_to_decel ${pr.max_accel_to_decel ?? '?'}, square_corner_velocity ${pr.square_corner_velocity ?? '?'}, kinematics ${pr.kinematics ?? '?'}.`);
      const ex = cfg.extruder ?? {};
      add('info', 'Extruder', `nozzle ${ex.nozzle_diameter ?? '?'} mm, filament ${ex.filament_diameter ?? '?'} mm, pressure_advance ${ex.pressure_advance ?? '?'} (smooth ${ex.pressure_advance_smooth_time ?? '?'}), rotation_distance ${ex.rotation_distance ?? '?'}, max_extrude_cross_section ${ex.max_extrude_cross_section ?? 'default'}.`);
      const probe = cfg.probe ?? cfg.bltouch ?? cfg.smart_effector ?? null;
      if (probe) add('info', 'Probe', `z_offset ${probe.z_offset ?? '?'}.`);
      const sh = cfg.input_shaper;
      add(sh ? 'ok' : 'info', 'Input shaper', sh ? `X ${sh.shaper_type_x ?? sh.shaper_type ?? '?'} @ ${sh.shaper_freq_x ?? '?'} Hz, Y ${sh.shaper_type_y ?? sh.shaper_type ?? '?'} @ ${sh.shaper_freq_y ?? '?'} Hz.` : 'No [input_shaper] section: ringing is not compensated.');
      const mesh = st.bed_mesh;
      if (mesh) {
        const names = Object.keys(mesh.profiles ?? {});
        add(names.length ? 'ok' : 'warn', 'Bed mesh', `${names.length} saved profile(s): ${names.join(', ') || 'none'}. Loaded now: ${mesh.profile_name || 'none (normal at idle if START_PRINT loads one)'}.`);
        const prof = mesh.profiles?.default?.points;
        if (Array.isArray(prof) && prof.length) {
          const flat = prof.flat();
          const range = Math.max(...flat) - Math.min(...flat);
          add(range > 0.3 ? 'warn' : 'ok', 'Bed flatness (default mesh)', `range ${range.toFixed(3)} mm (${Math.min(...flat).toFixed(3)} to ${Math.max(...flat).toFixed(3)}).${range > 0.3 ? ' Over 0.3 mm: check the bed and re-probe.' : ''}`);
        }
      }
      for (const [name, sensor] of Object.entries(st).filter(([k]) => /^filament_(switch|motion)_sensor /.test(k))) {
        const c = cfg[name] ?? {};
        const pause = c.pause_on_runout;
        add(pause === false ? 'warn' : 'ok', `Filament sensor "${name.split(' ').slice(1).join(' ')}"`, `${sensor.enabled === false ? 'DISABLED' : 'enabled'}, filament ${sensor.filament_detected ? 'detected' : 'NOT detected'}, pause_on_runout ${pause === undefined ? 'not reported' : pause} (effective value, Klipper default is true).${pause === false ? ' A runout or snapped filament will not pause the print.' : ''}`);
      }
      const mcus = Object.entries(st).filter(([k]) => /^mcu( |$)/.test(k));
      const host = pinfo?.software_version ?? null;
      for (const [name, m] of mcus) {
        const v = m.mcu_version ?? '?';
        const skew = host && v !== '?' && v.split('-')[0] === host.split('-')[0] && v !== host;
        add(skew ? 'info' : 'ok', `MCU "${name}"`, `firmware ${v}, host Klipper ${host ?? '?'}${skew ? ' (same release, different build: works, flash the MCU at your next firmware update)' : ''}.`);
      }
      if (st.configfile?.save_config_pending) add('warn', 'Unsaved calibration', 'SAVE_CONFIG is pending (a calibration result is not saved yet). Save or discard it in Mainsail.');
      for (const w of st.configfile?.warnings ?? []) add('warn', 'Klipper config warning', `${w.message ?? JSON.stringify(w)}`);
      if (sys?.system_info) {
        const si = sys.system_info;
        add('info', 'Host computer', `${si.distribution?.name ?? '?'} ${si.distribution?.version ?? ''}, ${si.cpu_info?.processor ?? si.cpu_info?.cpu_desc ?? 'CPU ?'}, ${si.cpu_info?.cpu_count ?? '?'} cores, ${si.cpu_info?.total_memory ? `${Math.round(si.cpu_info.total_memory / 1024)} MB` : 'memory ?'}, Python ${si.python?.version_string?.split(' ')[0] ?? '?'}.`);
        const services = si.available_services ?? [];
        if (services.length) add(services.includes('crowsnest') || services.some((x) => /webcam|ustreamer|mjpg/.test(x)) ? 'info' : 'info', 'Host services', services.join(', '));
      }
      if (totals?.job_totals) {
        const t = totals.job_totals;
        add('info', 'Print totals', `${t.total_jobs ?? '?'} jobs, ${((t.total_print_time ?? 0) / 3600).toFixed(1)} h printing, ${((t.total_filament_used ?? 0) / 1000).toFixed(1)} m filament, longest ${((t.longest_print ?? 0) / 3600).toFixed(1)} h.`);
      }
      return { checks, facts: { klipper: host, objects: objects.length, state: pinfo?.state ?? null } };
    },

    /** Saved bed mesh profiles and the loaded mesh (read-only bed_mesh query). */
    async mesh(id) {
      const p = await find(id);
      const q = await mr(p, '/printer/objects/query?bed_mesh');
      const bm = q.status?.bed_mesh ?? {};
      const profiles = Object.fromEntries(Object.entries(bm.profiles ?? {}).map(([name, pr]) => [name, { points: pr.points ?? [], params: pr.mesh_params ?? {} }]));
      return { loaded: bm.profile_name || '', min: bm.mesh_min ?? null, max: bm.mesh_max ?? null, probed: bm.probed_matrix ?? [], profiles };
    },

    /** Log files (klippy.log, moonraker.log, crowsnest.log ...), read-only. */
    async logFiles(id) {
      const p = await find(id);
      const list = await mr(p, '/server/files/list?root=logs').catch(() => []);
      return list.map((f) => ({ path: f.path ?? f.filename, size: f.size, modified: f.modified }))
        .filter((f) => f.path && /\.(log|txt)(\.\d+)?$/i.test(f.path) && !f.path.includes('..'))
        .sort((a, b) => b.modified - a.modified);
    },

    /** The last part of one log file (up to 400 KB), secrets hidden. */
    async logFile(id, path) {
      const p = await find(id);
      const clean = String(path ?? '');
      if (!/\.(log|txt)(\.\d+)?$/i.test(clean) || clean.includes('..') || clean.startsWith('/')) throw new CatalogError('Not a log file path');
      const res = await mr(p, `/server/files/logs/${clean.split('/').map(encodeURIComponent).join('/')}`, { raw: true, timeout: 20000 });
      const buf = Buffer.from(await res.arrayBuffer());
      const max = 400 * 1024;
      const tail = buf.length > max ? buf.subarray(buf.length - max) : buf;
      return { path: clean, bytes: buf.length, truncated: buf.length > max, text: redactSecrets(tail.toString('utf8')) };
    },

    /**
     * Read the start and end of a G-code file on the printer (Range requests, read-only)
     * and check it against a checklist's header rules: heat before the start macro, job
     * motion caps, caps restored at the end, temperatures, max volumetric speed.
     * -> { file, checks: [{ ok, title, detail }], found: {...} }
     */
    /** Whole G-code file from the printer, for the G-code viewer (read-only; up to 80 MB). -> { path, size, stream } */
    async gcodeFile(id, filename) {
      const p = await find(id);
      const f = String(filename ?? '');
      if (!GCODE_EXT.test(f) || f.includes('..') || f.startsWith('/')) throw new CatalogError('Not a G-code file path');
      const r = await mr(p, `/server/files/gcodes/${f.split('/').map(encodeURIComponent).join('/')}`, { raw: true });
      const size = Number(r.headers.get('content-length') ?? 0);
      if (size > 80 * 1024 * 1024) { r.body?.cancel?.(); throw new CatalogError(`${f} is ${(size / 1048576).toFixed(0)} MB: the viewer opens files up to 80 MB`, 413); }
      return { path: f, size, body: r.body };
    },

    async gcodeCheck(id, filename, rules = {}) {
      const p = await find(id);
      const f = String(filename ?? '');
      if (!GCODE_EXT.test(f) || f.includes('..') || f.startsWith('/')) throw new CatalogError('Not a G-code file path');
      const path = `/server/files/gcodes/${f.split('/').map(encodeURIComponent).join('/')}`;
      const head = (await (await mr(p, path, { raw: true, headers: { Range: 'bytes=0-131071' } })).text()).slice(0, 131072);
      const tail = (await (await mr(p, path, { raw: true, headers: { Range: 'bytes=-98304' } })).text()).slice(-98304);
      const lines = head.split(/\r?\n/);
      const firstMove = lines.findIndex((l) => /^;\s*(LAYER_CHANGE|LAYER:|layer num\/total_layer_count)|^G1 [^;]*E\d/.test(l));
      const start = lines.slice(0, firstMove > 0 ? firstMove : 400);
      const idx = (re) => start.findIndex((l) => re.test(l.split(';')[0]));
      const startAt = idx(new RegExp(`^\\s*${rules.startMacro ?? 'START_PRINT'}\\b`, 'i'));
      const heatSet = Math.min(...[idx(/^M140\s/i), idx(/^M104\s/i)].filter((i) => i >= 0), Infinity);
      const heatWait = Math.min(...[idx(/^M190\s/i), idx(/^M109\s/i)].filter((i) => i >= 0), Infinity);
      const sv = (l) => { const m = l.match(/SET_VELOCITY_LIMIT\b(.*)/i); if (!m) return null; const g = (k) => Number((m[1].match(new RegExp(`${k}=([\\d.]+)`, 'i')) ?? [])[1]); return { velocity: g('VELOCITY'), accel: g('ACCEL'), accelToDecel: g('ACCEL_TO_DECEL'), scv: g('SQUARE_CORNER_VELOCITY') }; };
      const caps = start.map(sv).find(Boolean) ?? null;
      const tailLines = tail.split(/\r?\n/);
      const restore = [...tailLines].reverse().map(sv).find(Boolean) ?? null;
      const sval = (re) => { for (const l of start) { const m = l.split(';')[0].match(re); if (m) return Number(m[1]); } return null; };
      const conf = {};
      for (const l of tailLines) { const m = l.match(/^;\s*([a-z_]+)\s*=\s*(.+)$/i); if (m) conf[m[1]] = m[2].trim(); }
      const confNum = (...keys) => { for (const k of keys) if (conf[k] !== undefined) { const v = Number(String(conf[k]).split(',')[0]); if (Number.isFinite(v)) return v; } return null; };
      const found = {
        startMacroLine: startAt, heatSetLine: Number.isFinite(heatSet) ? heatSet : -1, heatWaitLine: Number.isFinite(heatWait) ? heatWait : -1,
        caps, restore,
        firstNozzle: sval(/^M10[49]\s+[^;]*S([\d.]+)/i), firstBed: sval(/^M1[49]0\s+[^;]*S([\d.]+)/i),
        nozzle: confNum('temperature', 'nozzle_temperature'), bed: confNum('bed_temperature', 'hot_plate_temp'),
        maxVolumetric: confNum('max_volumetric_speed', 'filament_max_volumetric_speed'),
      };
      const checks = [];
      const add = (ok, title, detail) => checks.push({ ok, title, detail });
      if (rules.heatFirst) {
        const ok = startAt >= 0 && found.heatSetLine >= 0 && found.heatSetLine < startAt && (found.heatWaitLine < 0 || found.heatWaitLine < startAt);
        add(ok, 'Heat before the start macro', startAt < 0 ? `${rules.startMacro ?? 'START_PRINT'} not found in the start G-code` : ok ? `Heater commands (line ${found.heatSetLine + 1}) come before ${rules.startMacro ?? 'START_PRINT'} (line ${startAt + 1}).` : `${rules.startMacro ?? 'START_PRINT'} (line ${startAt + 1}) runs before the heaters are set: the purge would run cold.`);
      }
      const capText = (c) => (c ? `${c.velocity} / ${c.accel} / ${c.accelToDecel} / SCV ${c.scv}` : 'none');
      const same = (a, b) => a && b && ['velocity', 'accel', 'accelToDecel', 'scv'].every((k) => b[k] === undefined || a[k] === b[k]);
      if (rules.jobCaps) add(same(caps, rules.jobCaps), 'Job motion caps at the start', `found ${capText(caps)}, expected ${capText(rules.jobCaps)}`);
      if (rules.restoreCaps) add(same(restore, rules.restoreCaps), 'Live caps restored at the end', `found ${capText(restore)}, expected ${capText(rules.restoreCaps)}`);
      for (const [k, label] of [['firstNozzle', 'First-layer nozzle'], ['firstBed', 'First-layer bed'], ['nozzle', 'Nozzle (other layers)'], ['bed', 'Bed (other layers)'], ['maxVolumetric', 'Max volumetric speed']]) {
        if (rules[k] === undefined) continue;
        add(found[k] === rules[k], label, `found ${found[k] ?? 'not in the file'}, expected ${rules[k]}`);
      }
      return { file: f, checks, found };
    },

    // ---------------------------------------------------------------- live updates

    /**
     * Live status and console lines for one printer. Uses Moonraker's websocket
     * (printer.objects.subscribe, notify_status_update, notify_gcode_response) when this
     * Node has WebSocket (22+, the release packages), else polls status every second.
     * Read-only: only subscribe / identify calls are sent. Returns an unsubscribe function.
     *   fn({ type: 'status', status }) | fn({ type: 'console', line, at }) | fn({ type: 'mode', live })
     */
    subscribe(id, fn) {
      let hub = hubs.get(id);
      if (!hub) {
        hub = { listeners: new Set(), raw: {}, ws: null, timer: null };
        hubs.set(id, hub);
        startHub(id, hub);
      }
      hub.listeners.add(fn);
      if (hub.mode) fn({ type: 'mode', live: hub.mode === 'websocket' });
      return () => {
        hub.listeners.delete(fn);
        if (!hub.listeners.size) {
          clearInterval(hub.timer);
          try { hub.ws?.close(); } catch { /* closed */ }
          hubs.delete(id);
        }
      };
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

    // ---------------------------------------------------------------- control mode (opt-in)

    /** Turn control on or off for one printer. Turning it on needs acknowledge: true (the user saw the warning). */
    async setControl(id, { enabled, acknowledge } = {}) {
      const list = await file.get();
      const cur = await find(id);
      if (enabled && acknowledge !== true) throw new CatalogError('Read the warning and confirm it to turn on control (acknowledge: true).');
      const control = enabled ? { enabled: true, enabledAt: new Date().toISOString() } : { enabled: false, disabledAt: new Date().toISOString() };
      await file.set(list.map((x) => (x.id === id ? { ...x, control } : x)));
      await log(cur, enabled ? 'enable-control' : 'disable-control', {}, true, enabled ? 'control turned on after the warning' : 'control turned off');
      return publicView({ ...cur, control });
    },

    /** Last control log entries for one printer (newest first). */
    async controlLog(id, limit = 100) {
      await find(id);
      let text = '';
      try { text = await readFile(join(dataDir, 'printer-control.log'), 'utf8'); } catch { return []; }
      return text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter((e) => e && e.printer === id).reverse().slice(0, Math.min(500, limit));
    },

    /**
     * Run one control action. Refused (403) unless control is on for this printer.
     *   pause | resume | cancel | estop | firmware_restart | restart
     *   start          { filename }  a G-code file already on the printer (idle printer only)
     *   gcode          { script }    console command(s), max 2000 characters
     *   service        { service }   crowsnest | klipper | moonraker-timelapse (host service restart)
     */
    async control(id, action, args = {}) {
      const p = await find(id);
      if (!p.control?.enabled) {
        await log(p, action, args, false, 'refused: control is off for this printer');
        throw new CatalogError('Control is off for this printer. Turn it on in the Printers tab (Control) first.', 403);
      }
      const spec = CONTROL[action];
      if (!spec) throw new CatalogError(`Unknown control action "${action}"`, 404);
      let path;
      try {
        if (spec.idleOnly || spec.states) {
          const q = await mr(p, '/printer/objects/query?print_stats');
          const state = q.status?.print_stats?.state ?? 'unknown';
          if (spec.idleOnly && ['printing', 'paused'].includes(state)) throw new CatalogError(`The printer is ${state}. Start only works when it is idle.`, 409);
          if (spec.states && !spec.states.includes(state)) throw new CatalogError(`Cannot ${action} while the printer is ${state}.`, 409);
        }
        path = spec.path(args);
        const r = await mr(p, path, { method: 'POST', timeout: spec.timeout ?? TIMEOUT });
        await log(p, action, args, true, typeof r === 'string' ? r : 'ok');
        return { ok: true, action, result: r };
      } catch (err) {
        await log(p, action, args, false, err.message);
        throw err;
      }
    },

    /** Upload a G-code file and start it at once (print=true). Needs control on and confirm: true. */
    async uploadAndPrint(id, filename, data, subdir = '', confirm = false) {
      const p = await find(id);
      if (!p.control?.enabled) {
        await log(p, 'upload-and-print', { filename }, false, 'refused: control is off for this printer');
        throw new CatalogError('Control is off for this printer.', 403);
      }
      if (!confirm) throw new CatalogError('Upload and print needs confirm=1 (the user confirmed starting the print).');
      const q = await mr(p, '/printer/objects/query?print_stats');
      const state = q.status?.print_stats?.state ?? 'unknown';
      if (['printing', 'paused'].includes(state)) throw new CatalogError(`The printer is ${state}. Upload without printing, or wait.`, 409);
      const name = String(filename ?? '').split(/[\\/]/).pop();
      if (!GCODE_EXT.test(name)) throw new CatalogError('Only G-code files can be printed. Slice the STL first.');
      const folder = String(subdir ?? '').replace(/[^A-Za-z0-9_\- /]/g, '').replace(/^\/+|\/+$/g, '').slice(0, 80);
      const form = new FormData();
      form.append('root', 'gcodes');
      if (folder) form.append('path', folder);
      form.append('print', 'true');
      form.append('file', new Blob([data]), name);
      try {
        const r = await mr(p, '/server/files/upload', { method: 'POST', body: form, timeout: 120000 });
        await log(p, 'upload-and-print', { filename: name, path: folder }, true, r.print_started ? 'uploaded, print started' : 'uploaded, printer did not start it');
        return { path: r.item?.path ?? name, size: r.item?.size ?? data.length, printStarted: Boolean(r.print_started) };
      } catch (err) {
        await log(p, 'upload-and-print', { filename: name }, false, err.message);
        throw err;
      }
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
