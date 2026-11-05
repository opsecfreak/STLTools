// Klipper / Moonraker printers on the LAN (Sovol SV07 and other Klipper printers
// that run Mainsail or Fluidd). VIEW ONLY, by design:
//
//   allowed:  status, temperatures, progress, layer, file list + thumbnails,
//             file metadata, print history, webcam snapshots,
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

const TIMEOUT = 4000;
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

function snapshotUrl(printer, cam) {
  const u = String(cam.snapshot_url ?? '');
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  // Relative webcam paths are served by the web server on the printer host
  // (normally port 80), not by Moonraker's port 7125.
  const base = new URL(printer.url);
  return `${base.protocol}//${base.hostname}${u.startsWith('/') ? '' : '/'}${u}`;
}

export function createPrinters({ dataDir }) {
  const file = createJsonFile(join(dataDir, 'printers.json'), []);
  const metaCache = new Map(); // `${id}|${filename}|${modified}` -> metadata

  const find = async (id) => {
    const p = (await file.get()).find((x) => x.id === id);
    if (!p) throw new CatalogError(`No printer ${id}`, 404);
    return p;
  };

  const api = {
    async list() {
      return (await file.get()).map(publicView);
    },

    async add({ name, url, apiKey }) {
      const list = await file.get();
      const clean = normalizeUrl(url);
      if (list.some((p) => p.url === clean)) throw new CatalogError(`${clean} is already added`);
      const p = {
        id: `printer-${randomBytes(3).toString('hex')}`,
        name: String(name ?? '').trim().slice(0, 60) || new URL(clean).hostname,
        url: clean,
        apiKey: apiKey ? String(apiKey).trim().slice(0, 200) : '',
        addedAt: new Date().toISOString(),
      };
      await file.set([...list, p]);
      return publicView(p);
    },

    async update(id, { name, url, apiKey }) {
      const list = await file.get();
      const cur = await find(id);
      const next = {
        ...cur,
        name: name !== undefined ? String(name).trim().slice(0, 60) || cur.name : cur.name,
        url: url !== undefined ? normalizeUrl(url) : cur.url,
        apiKey: apiKey === undefined ? cur.apiKey : String(apiKey).trim().slice(0, 200),
      };
      await file.set(list.map((p) => (p.id === id ? next : p)));
      return publicView(next);
    },

    async remove(id) {
      const list = await file.get();
      await find(id);
      await file.set(list.filter((p) => p.id !== id));
    },

    /** Test an address before saving it. */
    async probe(url, apiKey) {
      const p = { name: 'printer', url: normalizeUrl(url), apiKey };
      const info = await mr(p, '/server/info');
      let host = null;
      try { host = (await mr(p, '/printer/info')).hostname; } catch { /* klippy may be down */ }
      return { url: p.url, klippyState: info.klippy_state, moonraker: info.moonraker_version, hostname: host };
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

    async webcams(id) {
      const p = await find(id);
      const r = await mr(p, '/server/webcams/list').catch(() => ({ webcams: [] }));
      return (r.webcams ?? []).filter((c) => c.enabled !== false && c.snapshot_url).map((c, i) => ({ index: i, name: c.name, flipH: Boolean(c.flip_horizontal), flipV: Boolean(c.flip_vertical), rotation: c.rotation ?? 0 }));
    },

    async snapshot(id, index = 0) {
      const p = await find(id);
      const r = await mr(p, '/server/webcams/list');
      const cams = (r.webcams ?? []).filter((c) => c.enabled !== false && c.snapshot_url);
      const cam = cams[index];
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
