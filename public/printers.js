// Printers page: Klipper / Moonraker printers (Sovol SV07, Mainsail, Fluidd) on the LAN.
// View only by default: status, temperatures, progress, files, history, webcam, and
// G-code upload that never starts a print. Control (pause, resume, cancel, start,
// console, e-stop, restarts) appears only after the user turns it on for that
// printer and accepts the warning; each action asks for confirmation and is logged
// on the server (core/printers.js control()).
import { el, api, fmtDuration, fmtBytes, fmtAgo, store, settings, confirmDelete, printersVisible, toast } from './lib.js';
import { openGcode, pickGcodeFile } from './layerview.js';

let timer = null;
let alive = 0; // render generation; stops polling when the page changes
let liveImg = null; // the <img> showing a live MJPEG stream; cleared to close the connection
let liveSrc = null; // EventSource for live status / console lines of the selected printer

// A 1x1 GIF: pointing the <img> at it aborts the MJPEG load at once (removing src does not always).
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
function stopLive() {
  if (liveImg) { liveImg.onerror = null; liveImg.onload = null; liveImg.src = BLANK; liveImg = null; }
}

export function stopPrinters() {
  alive++;
  clearTimeout(timer);
  stopLive();
  if (liveSrc) { liveSrc.close(); liveSrc = null; }
}

const STATE_LABEL = { printing: 'Printing', paused: 'Paused', complete: 'Complete', cancelled: 'Cancelled', error: 'Error', standby: 'Idle', ready: 'Idle', startup: 'Starting', shutdown: 'Shutdown', offline: 'Offline' };
const temp = (t) => (t ? `${t.actual.toFixed(0)} / ${t.target.toFixed(0)} C` : '-');

export async function renderPrinters(page, focusId = null) {
  stopPrinters();
  const gen = alive;
  let printers = await api('GET', '/api/printers');
  const cards = el('div', { className: 'printer-grid' });
  const detail = el('div', { className: 'printer-detail' });
  let selected = focusId ?? store.get('printer') ?? printers[0]?.id ?? null;
  if (selected && !printers.some((p) => p.id === selected)) selected = printers[0]?.id ?? null;
  const statusById = new Map();
  const consoleById = new Map(); // printer id -> [{ line, at }] (newest last)
  let liveFor = null, liveMode = null; // printer id with an open event stream; 'websocket' | 'polling' | null
  const checklistDone = new Map(); // "printer|file" -> true once a checklist was saved this session

  // ---- add printer form ----
  const name = el('input', { type: 'text', placeholder: 'Name, e.g. SV07', maxLength: 60 });
  const addr = el('input', { type: 'text', placeholder: 'Address, e.g. 192.168.1.50 or sv07.local' });
  const key = el('input', { type: 'password', placeholder: 'API key (only if Moonraker asks for one)', autocomplete: 'off' });
  const formMsg = el('p', { className: 'muted' });
  const scanOut = el('div', { className: 'scan-out' });
  const addForm = el('form', { className: 'card add-printer', onsubmit: async (e) => {
    e.preventDefault();
    formMsg.textContent = 'Checking the printer...';
    try {
      const probe = await api('POST', '/api/printers/probe', { url: addr.value, apiKey: key.value || undefined });
      const p = await api('POST', '/api/printers', { name: name.value || probe.hostname || '', url: probe.url, apiKey: key.value || undefined });
      formMsg.textContent = `Added ${p.name}: Moonraker ${probe.moonraker}, Klipper ${probe.klippyState}.`;
      selected = p.id;
      name.value = addr.value = key.value = '';
      renderPrinters(page, p.id);
    } catch (err) {
      formMsg.textContent = err.message;
    }
  } },
  el('h3', { textContent: 'Add a printer' }),
  el('p', { className: 'muted', textContent: 'Klipper printers with Mainsail or Fluidd (Sovol SV07 and others). Use the address you open Mainsail with. If that fails, try port 7125, e.g. 192.168.1.50:7125.' }),
  el('div', { className: 'row' }, name, addr), key,
  el('div', { className: 'row' }, el('button', { type: 'submit', textContent: 'Add printer' }),
    el('button', { type: 'button', className: 'secondary', textContent: 'Scan my network', onclick: async (e) => {
      e.target.disabled = true;
      scanOut.replaceChildren(el('p', { className: 'muted', textContent: 'Scanning the local network for Moonraker (about 10 seconds)...' }));
      try {
        const r = await api('GET', '/api/printers/scan');
        scanOut.replaceChildren(el('p', { className: 'muted', textContent: `Scanned ${r.networks.join(', ') || 'no local network found'}: ${r.printers.length} printer(s).` }),
          ...r.printers.map((f) => el('div', { className: 'pick-row' }, el('span', { textContent: `${f.hostname ?? 'Klipper printer'} at ${f.url} (${f.klippyState})` }),
            el('button', { type: 'button', className: 'small', textContent: 'Use', onclick: () => { addr.value = f.url; name.value = f.hostname ?? ''; } }))));
      } catch (err) {
        scanOut.replaceChildren(el('p', { className: 'error', textContent: err.message }));
      } finally { e.target.disabled = false; }
    } })),
  formMsg, scanOut);

  page.replaceChildren(
    el('div', { className: 'page-head' }, el('h2', { textContent: 'Printers' }),
      el('p', { className: 'muted', textContent: 'View only: status, temperatures, progress, files, history and webcam. Uploading G-code never starts a print. Start, pause and cancel stay in Mainsail or on the printer screen.' }),
      el('div', { className: 'row' }, el('a', { className: 'button secondary', href: '#settings/printers', textContent: 'Add, test or edit printers (Settings)' }))),
    ...[cards, detail, printers.length ? null : addForm].filter(Boolean));

  function drawCards() {
    if (!printers.length) {
      cards.replaceChildren(el('p', { className: 'muted empty-note', textContent: 'No printers yet. Add one below.' }));
      return;
    }
    cards.replaceChildren(...printers.map((p) => {
      const s = statusById.get(p.id);
      const state = s?.error ? 'offline' : s?.state ?? 'loading';
      return el('button', { type: 'button', className: `printer-card ${p.id === selected ? 'active' : ''} state-${state}`, onclick: () => { selected = p.id; store.set('printer', p.id); drawCards(); drawDetail(); } },
        el('div', { className: 'pc-head' }, el('strong', { textContent: p.name }), el('span', { className: `state-pill state-${state}`, textContent: STATE_LABEL[state] ?? state })),
        s?.thumbnail && !s.error ? el('img', { className: 'pc-thumb', src: `/api/printers/${p.id}/thumb?path=${encodeURIComponent(s.thumbnail)}`, alt: '' }) : null,
        el('div', { className: 'pc-file muted', textContent: s?.error ? s.error : s?.filename ?? 'No active print' }),
        s && !s.error && (s.state === 'printing' || s.state === 'paused') ? el('div', { className: 'progress' }, el('div', { className: 'bar', style: `width:${(s.progress * 100).toFixed(1)}%` })) : null,
        s && !s.error ? el('div', { className: 'pc-temps muted', textContent: `Nozzle ${temp(s.temps.extruder)}  Bed ${temp(s.temps.bed)}` }) : null);
    }));
  }

  let lastFilesFor = null;
  async function drawDetail(force = false) {
    const p = printers.find((x) => x.id === selected);
    if (!p) { detail.replaceChildren(); return; }
    const s = statusById.get(p.id);
    const statusBox = el('div', { className: 'card status-box' });
    if (!s) statusBox.append(el('p', { className: 'muted', textContent: 'Loading...' }));
    else if (s.error) statusBox.append(el('p', { className: 'error', textContent: s.error }), el('p', { className: 'muted', textContent: 'Check that the printer is on, on the same network, and that the address opens Mainsail in a browser.' }));
    else {
      const active = s.state === 'printing' || s.state === 'paused';
      statusBox.append(...[
        el('div', { className: 'row' }, el('span', { className: `state-pill state-${s.state}`, textContent: STATE_LABEL[s.state] ?? s.state }), el('strong', { textContent: s.filename ?? 'No active print' }),
          el('span', { className: `live-dot ${liveFor === p.id && liveMode ? 'on' : ''}`, title: liveFor === p.id && liveMode === 'websocket' ? 'Live from the Moonraker websocket (read-only)' : liveFor === p.id && liveMode === 'polling' ? 'Live: this Node version has no websocket, STL Tools asks every second' : 'Refreshes every few seconds', textContent: liveFor === p.id && liveMode ? 'Live' : `Every ${settings()?.printers.pollSeconds ?? 3} s` })),
        active ? el('div', { className: 'progress big' }, el('div', { className: 'bar', style: `width:${(s.progress * 100).toFixed(1)}%` })) : null,
        el('dl', { className: 'facts' },
          ...[
            ['Progress', active ? `${(s.progress * 100).toFixed(1)} %` : '-'],
            ['Layer', s.layer?.current ? `${s.layer.current} / ${s.layer.total ?? '?'}` : '-'],
            ['Printing for', active ? fmtDuration(s.printDuration) : '-'],
            ['Time left (estimate)', active ? fmtDuration(s.remaining) : '-'],
            ['Filament used', active ? `${(s.filamentUsed / 1000).toFixed(2)} m` : '-'],
            ['Nozzle', temp(s.temps.extruder)],
            ['Bed', temp(s.temps.bed)],
            ['Klipper', s.klippy],
          ].flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })])),
        s.message ? el('p', { className: 'muted', textContent: s.message }) : null,
        p.machine ? el('p', { className: 'muted', title: `Read from Klipper ${new Date(p.machine.readAt).toLocaleString()}`, textContent: `Printer limits from Klipper (used for estimates): ${p.machine.bed ? `${p.machine.bed.x} x ${p.machine.bed.y} x ${p.machine.bed.z} mm` : 'bed size not reported'}, max ${p.machine.maxVelocity ?? '?'} mm/s, accel ${p.machine.maxAccel ?? '?'} mm/s2, nozzle ${p.machine.nozzle ?? '?'} mm.` }) : null,
        el('a', { href: p.url, target: '_blank', rel: 'noopener', textContent: 'Open Mainsail / Fluidd' })].filter(Boolean));
    }
    const cam = el('div', { className: 'card cam-box' });
    const files = el('div', { className: 'card files-box' }, el('h3', { textContent: 'Files on the printer' }), el('p', { className: 'muted', textContent: 'Loading...' }));
    const history = el('div', { className: 'card history-box' }, el('h3', { textContent: 'Print history' }));
    const upload = uploadBox(p, () => { lastFilesFor = null; drawDetail(true); });
    const remove = el('button', { type: 'button', className: 'secondary small', textContent: 'Remove printer', onclick: async () => {
      if (!confirmDelete(`Remove ${p.name} from STL Tools? Nothing on the printer changes.`)) return;
      await api('DELETE', `/api/printers/${p.id}`);
      renderPrinters(page);
    } });
    if (!force && detail.dataset.printer === p.id && detail.firstChild) {
      detail.querySelector('.status-box')?.replaceWith(statusBox);
      return; // keep files / history / camera in place on status refresh
    }
    detail.dataset.printer = p.id;
    detail.replaceChildren(el('div', { className: 'detail-grid' }, statusBox, cam, upload, files, history), checklistBox(p), consoleBox(p), controlBox(p), insightsBox(p), el('div', { className: 'row' }, remove));
    openLive(p);
    // webcam: live MJPEG (the stream Mainsail shows) or snapshots, per Settings > Printers
    stopLive();
    const camMode = settings()?.printers.webcam ?? 'stream';
    if (camMode === 'off') cam.replaceChildren(el('h3', { textContent: 'Webcam' }), el('p', { className: 'muted', textContent: 'Webcam is off (Settings > Printers).' }));
    else api('GET', `/api/printers/${p.id}/webcams`).then((cams) => {
      if (!cams.length) { cam.replaceChildren(el('h3', { textContent: 'Webcam' }), el('p', { className: 'muted', textContent: 'No webcam found. Set one up in Mainsail (Settings > Webcams); STL Tools shows the same camera.' })); return; }
      let index = 0;
      const img = el('img', { className: 'cam', alt: 'Printer webcam' });
      const note = el('p', { className: 'muted' });
      const pick = cams.length > 1 ? el('select', { 'aria-label': 'Camera', onchange: () => { index = Number(pick.value); start(); } }, ...cams.map((c) => el('option', { value: c.index, textContent: c.name }))) : null;
      const here = () => gen === alive && detail.dataset.printer === p.id;
      const snapEvery = (settings()?.printers.snapshotSeconds ?? 3) * 1000;
      let snapTimer = null;
      const snapshots = (why = '') => {
        stopLive();
        clearTimeout(snapTimer);
        const refresh = () => { if (here() && img.isConnected) img.src = `/api/printers/${p.id}/snapshot?cam=${index}&t=${Date.now()}`; };
        img.onload = () => { snapTimer = setTimeout(refresh, snapEvery); };
        img.onerror = () => { snapTimer = setTimeout(refresh, Math.max(10000, snapEvery)); };
        note.textContent = `Snapshot every ${snapEvery / 1000} s.${why ? ` ${why}` : ''}`;
        refresh();
      };
      const start = () => {
        const c = cams[index];
        if (c.up === false) {
          // listed in Mainsail but its service is not running (crowsnest / ustreamer stopped): say so, check again slowly
          stopLive();
          clearTimeout(snapTimer);
          img.removeAttribute('src');
          img.hidden = true;
          note.replaceChildren(el('strong', { textContent: 'Camera unavailable. ' }), `"${c.name}" is set up in Mainsail but does not answer (${c.state}). Its service (crowsnest / ustreamer) is probably stopped: restart it on the printer from Mainsail. STL Tools never restarts printer services. Checking again every 30 s.`);
          snapTimer = setTimeout(async () => {
            if (!here()) return;
            const again = await api('GET', `/api/printers/${p.id}/webcams`).catch(() => null);
            if (again?.[index]) { cams[index] = again[index]; start(); }
          }, 30000);
          return;
        }
        img.hidden = false;
        img.style.transform = `${c.flipH ? 'scaleX(-1) ' : ''}${c.flipV ? 'scaleY(-1) ' : ''}rotate(${c.rotation}deg)`;
        if (camMode === 'stream' && c.stream) {
          clearTimeout(snapTimer);
          img.onload = null;
          img.onerror = () => { if (here()) snapshots('Live video did not load, showing snapshots.'); };
          stopLive();
          liveImg = img;
          img.src = `/api/printers/${p.id}/stream?cam=${index}&t=${Date.now()}`;
          note.textContent = `Live video${c.fps ? ` (${c.fps} fps)` : ''}${c.guessed ? ', found at the Mainsail default path' : ''}.`;
        } else if (c.snapshot) snapshots(camMode === 'stream' ? `This camera (${c.service || 'unknown'}) has no MJPEG stream; open Mainsail for its video.` : '');
        else note.textContent = 'This camera has no snapshot or MJPEG stream. Open Mainsail to watch it.';
      };
      cam.replaceChildren(el('div', { className: 'row' }, el('h3', { textContent: 'Webcam' }), pick), img, note, el('a', { href: p.url, target: '_blank', rel: 'noopener', className: 'muted', textContent: 'Open in Mainsail / Fluidd' }));
      start();
    }).catch((err) => cam.replaceChildren(el('h3', { textContent: 'Webcam' }), el('p', { className: 'error', textContent: err.message })));
    // files
    if (lastFilesFor !== p.id) {
      lastFilesFor = p.id;
      api('GET', `/api/printers/${p.id}/files`).then((list) => {
        const grid = el('div', { className: 'file-grid' });
        files.replaceChildren(el('h3', { textContent: `Files on the printer (${list.length})` }), grid);
        for (const f of list.slice(0, 60)) {
          const tile = el('div', { className: 'file-tile' }, el('div', { className: 'file-thumb' }), el('div', { className: 'file-name', textContent: f.path }), el('div', { className: 'muted', textContent: `${fmtBytes(f.size)}, ${fmtAgo(f.modified)}` }));
          tile.append(el('button', { type: 'button', className: 'small secondary', textContent: 'View', title: 'Open in the G-code viewer (layers, features, time per layer)', onclick: () => openGcode({ printerId: p.id, file: f.path, title: `G-code: ${f.path} on ${p.name}` }) }));
          if (p.control?.enabled) tile.append(el('button', { type: 'button', className: 'small', textContent: 'Print', title: 'Start this file on the printer (control mode)', onclick: () => doControl(p, 'start', { filename: f.path }, `Start printing ${f.path} on ${p.name}? Check the bed is clear and the right filament is loaded.${checklistDone.get(`${p.id}|${f.path}`) ? '' : '\n\nThe pre-print checklist for this file is NOT saved yet (Pre-print checklist box).'}`) }));
          grid.append(tile);
          api('GET', `/api/printers/${p.id}/metadata?filename=${encodeURIComponent(f.path)}`).then((m) => {
            if (m.thumbnail) tile.firstChild.append(el('img', { src: `/api/printers/${p.id}/thumb?path=${encodeURIComponent(m.thumbnail)}`, alt: '' }));
            tile.append(el('div', { className: 'muted', textContent: [m.estimated_time && fmtDuration(m.estimated_time), m.filament_total && `${(m.filament_total / 1000).toFixed(1)} m`, m.layer_height && `${m.layer_height} mm layers`, m.slicer].filter(Boolean).join(', ') }));
          }).catch(() => {});
        }
        if (!list.length) grid.append(el('p', { className: 'muted', textContent: 'No G-code files.' }));
      }).catch((err) => files.replaceChildren(el('h3', { textContent: 'Files on the printer' }), el('p', { className: 'error', textContent: err.message })));
      api('GET', `/api/printers/${p.id}/history?limit=15`).then((jobs) => {
        history.replaceChildren(el('h3', { textContent: 'Print history' }), ...(jobs.length ? jobs.map((j) => el('div', { className: `hist-row hist-${j.status}` },
          el('span', { className: `state-pill state-${j.status === 'completed' ? 'complete' : j.status}`, textContent: j.status }),
          el('span', { className: 'file-name', textContent: j.filename }),
          el('span', { className: 'muted', textContent: `${fmtDuration(j.printDuration)}, ${fmtAgo(j.end ?? j.start)}` }))) : [el('p', { className: 'muted', textContent: 'No history yet.' })]));
      }).catch((err) => history.append(el('p', { className: 'error', textContent: err.message })));
    }
  }

  /** Run one control action after a confirm dialog; shows the result. */
  async function doControl(p, action, args = {}, question = '') {
    if (question && !confirm(question)) return null;
    try {
      const r = await api('POST', `/api/printers/${p.id}/control/${action}`, args);
      toast(`${p.name}: ${action} sent`, 'ok');
      detail.querySelector('.control-box')?.refreshLog?.();
      lastFilesFor = null;
      setTimeout(() => poll(), 800);
      return r;
    } catch (err) { toast(err.message, 'error', 8000); detail.querySelector('.control-box')?.refreshLog?.(); return null; }
  }

  /** Control panel: off by default; turning it on shows a warning that must be accepted. */
  function controlBox(p) {
    const box = el('div', { className: `card control-box ${p.control?.enabled ? 'on' : ''}` });
    const logBox = el('div', { className: 'control-log' });
    box.refreshLog = () => showLog();
    const showLog = async () => {
      const entries = await api('GET', `/api/printers/${p.id}/control/log?limit=30`).catch(() => []);
      logBox.replaceChildren(el('h4', { textContent: 'Control log (this printer, newest first)' }), entries.length
        ? el('ul', {}, ...entries.map((e) => el('li', { className: e.ok ? 'ok' : 'fail', textContent: `${new Date(e.at).toLocaleString()}  ${e.action}${e.args?.filename ? ` ${e.args.filename}` : ''}${e.args?.script ? ` "${e.args.script}"` : ''}${e.args?.service ? ` ${e.args.service}` : ''}: ${e.ok ? 'OK' : 'refused / failed'} ${e.result ?? ''}` })))
        : el('p', { className: 'muted', textContent: 'No control actions yet.' }));
    };
    if (!p.control?.enabled) {
      box.append(el('h3', { textContent: 'Control: off' }),
        el('p', { className: 'muted', textContent: 'STL Tools only watches this printer. Turn on control to pause, resume, cancel and start prints, send console commands, emergency stop, and restart Klipper or the webcam service from here.' }),
        el('button', { type: 'button', className: 'secondary', textContent: 'Turn on control...', onclick: async () => {
          const ok = confirm([
            `WARNING: turn on control for ${p.name}?`,
            '',
            'STL Tools will be able to START, PAUSE, CANCEL and EMERGENCY-STOP prints, send G-code (it can move the printer and heat the nozzle and bed), and restart Klipper, firmware and the webcam service on this printer.',
            '',
            '- Anyone who can open STL Tools can then do this: set an access PIN (Settings > Self-hosting) if others use your network.',
            '- A start or a G-code command can crash the nozzle into a part left on the bed or heat an empty printer. Check the printer before every action.',
            '- Every action asks first and is logged.',
            '',
            'Press OK to turn control on for this printer only.',
          ].join('\n'));
          if (!ok) return;
          try { await api('PUT', `/api/printers/${p.id}/control`, { enabled: true, acknowledge: true }); toast(`Control on for ${p.name}`, 'ok'); renderPrinters(page, p.id); } catch (err) { toast(err.message, 'error'); }
        } }), logBox);
      showLog();
      return box;
    }
    const btn = (label, action, question, cls = 'secondary') => el('button', { type: 'button', className: cls, textContent: label, onclick: () => doControl(p, action, {}, question) });
    const script = el('input', { type: 'text', placeholder: 'G-code or macro, e.g. M115, G28, BED_MESH_PROFILE LOAD=default', maxLength: 2000, 'aria-label': 'G-code command' });
    const send = async () => {
      const sc = script.value.trim();
      if (!sc) return;
      if (/SAVE_CONFIG/i.test(sc) && !confirm('SAVE_CONFIG restarts Klipper and clears the live Z-tilt and loaded mesh. Send it?')) return;
      if (await doControl(p, 'gcode', { script: sc }, `Send to ${p.name}:\n\n${sc}`)) { script.value = ''; showLog(); }
    };
    script.onkeydown = (e) => { if (e.key === 'Enter') send(); };
    box.append(
      el('div', { className: 'row' }, el('h3', { textContent: 'Control: on' }),
        el('button', { type: 'button', className: 'secondary small', textContent: 'Turn off control', onclick: async () => { await api('PUT', `/api/printers/${p.id}/control`, { enabled: false }); toast('Control off', 'ok'); renderPrinters(page, p.id); } })),
      el('div', { className: 'row control-buttons' },
        btn('Pause', 'pause', `Pause the print on ${p.name}?`),
        btn('Resume', 'resume', `Resume the print on ${p.name}? Check the part and nozzle first.`),
        btn('Cancel print', 'cancel', `CANCEL the print on ${p.name}? This cannot be undone.`),
        btn('Emergency stop', 'estop', `EMERGENCY STOP ${p.name}? Heaters and motors stop at once; Klipper then needs a firmware restart.`, 'danger')),
      el('div', { className: 'row control-buttons' },
        btn('Firmware restart', 'firmware_restart', `Firmware restart ${p.name}? Any print stops.`),
        btn('Restart Klipper', 'restart', `Restart Klipper on ${p.name}? Any print stops.`),
        el('button', { type: 'button', className: 'secondary', textContent: 'Restart webcam service', title: 'Restart crowsnest (webcam) on the printer host', onclick: () => doControl(p, 'service', { service: 'crowsnest' }, `Restart the crowsnest webcam service on ${p.name}? Printing is not affected.`) })),
      el('div', { className: 'row' }, script, el('button', { type: 'button', textContent: 'Send', onclick: send })),
      el('p', { className: 'muted', textContent: 'Each action asks first and is logged. Start a file with its Print button under "Files on the printer". Replies show in the Console box (live updates on) and in Mainsail.' }),
      logBox);
    showLog();
    return box;
  }

  /** Read-only look inside the printer: health check of its Klipper setup and its config files. */
  function insightsBox(p) {
    const out = el('div', { className: 'insights-out' });
    const tabs = el('div', { className: 'row' });
    const show = async (which) => {
      for (const b of tabs.children) b.classList.toggle('active', b.dataset.k === which);
      out.replaceChildren(el('p', { className: 'muted', textContent: 'Reading from the printer (read-only)...' }));
      try {
        if (which === 'mesh') {
          const m = await api('GET', `/api/printers/${p.id}/mesh`);
          const names = Object.keys(m.profiles);
          if (!names.length) { out.replaceChildren(el('p', { className: 'muted', textContent: 'No saved bed mesh on this printer.' })); return; }
          const pick = el('select', {}, ...names.map((n) => el('option', { value: n, textContent: `${n}${n === m.loaded ? ' (loaded)' : ''}`, selected: n === (m.loaded || 'default') })));
          const cv = el('canvas', { width: 520, height: 420, className: 'lab-canvas' });
          const info = el('p', {});
          const draw = () => {
            const pr = m.profiles[pick.value];
            const pts = pr.points;
            const rows = pts.length, cols = pts[0]?.length ?? 0;
            const flat = pts.flat();
            const lo = Math.min(...flat), hi = Math.max(...flat), span = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
            const c = cv.getContext('2d');
            c.clearRect(0, 0, cv.width, cv.height);
            const cw = (cv.width - 40) / cols, ch = (cv.height - 40) / rows;
            // outliers: a point more than 0.2 mm off the mean of its neighbours
            const out = [];
            for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
              const nb = [[r - 1, k], [r + 1, k], [r, k - 1], [r, k + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < rows && b < cols).map(([a, b]) => pts[a][b]);
              const mean = nb.reduce((x, y) => x + y, 0) / nb.length;
              if (Math.abs(pts[r][k] - mean) > 0.2) out.push([r, k]);
              const v = pts[r][k] / span; // -1..1
              const col = v >= 0 ? [255, Math.round(255 * (1 - v)), Math.round(255 * (1 - v))] : [Math.round(255 * (1 + v)), Math.round(255 * (1 + v)), 255];
              c.fillStyle = `rgb(${col.join(',')})`;
              const x = 20 + k * cw, y = cv.height - 20 - (r + 1) * ch; // row 0 = front (min Y) at the bottom
              c.fillRect(x, y, cw - 2, ch - 2);
              c.fillStyle = '#222'; c.font = '12px sans-serif'; c.textAlign = 'center';
              c.fillText(pts[r][k].toFixed(3), x + cw / 2, y + ch / 2 + 4);
              if (out.some(([a, b]) => a === r && b === k)) { c.strokeStyle = '#d00'; c.lineWidth = 3; c.strokeRect(x + 1, y + 1, cw - 4, ch - 4); }
            }
            info.replaceChildren(el('strong', { textContent: `Range ${(hi - lo).toFixed(3)} mm (${lo.toFixed(3)} to ${hi.toFixed(3)}), ${cols} x ${rows} points` }),
              pr.params.min_x !== undefined ? ` over X ${pr.params.min_x}-${pr.params.max_x}, Y ${pr.params.min_y}-${pr.params.max_y} mm.` : '.',
              out.length ? el('span', { className: 'error', textContent: ` ${out.length} point(s) more than 0.2 mm off their neighbours (red box): re-probe before saving this mesh.` }) : ' No point is more than 0.2 mm off its neighbours.');
          };
          pick.onchange = draw;
          out.replaceChildren(el('div', { className: 'row' }, el('span', { textContent: 'Profile ' }), pick), cv, info,
            el('p', { className: 'muted', textContent: 'Seen from above, front of the bed at the bottom. Red = high, blue = low. Read-only: probe and save meshes in Mainsail.' }));
          draw();
          return;
        }
        if (which === 'logs') {
          const files = await api('GET', `/api/printers/${p.id}/logs`);
          if (!files.length) { out.replaceChildren(el('p', { className: 'muted', textContent: 'No log files listed by Moonraker.' })); return; }
          const pick = el('select', {}, ...files.map((f) => el('option', { value: f.path, textContent: `${f.path} (${(f.size / 1024).toFixed(0)} KB, ${fmtAgo(f.modified)})` })));
          const find = el('input', { type: 'search', placeholder: 'Find (e.g. error, shutdown, MCU, crowsnest)' });
          const pre = el('pre', { className: 'cfg-view' });
          let text = '';
          const render = () => {
            const q = find.value.trim().toLowerCase();
            const lines = text.split('\n');
            pre.replaceChildren(...lines.map((l) => el('div', { className: q && l.toLowerCase().includes(q) ? 'hit' : /error|shutdown|exception|refused/i.test(l) ? 'sec' : undefined, textContent: l })));
            (pre.querySelector('.hit') ?? pre.lastElementChild)?.scrollIntoView({ block: 'center' });
          };
          const load = async () => { pre.textContent = 'Loading...'; const f = await api('GET', `/api/printers/${p.id}/logs?file=${encodeURIComponent(pick.value)}`); text = f.text; render(); };
          pick.onchange = () => load().catch((err) => { pre.textContent = err.message; });
          find.oninput = render;
          out.replaceChildren(el('div', { className: 'row' }, pick, find), pre, el('p', { className: 'muted', textContent: 'Last 400 KB of the file, newest at the bottom. Errors and shutdowns are highlighted; key and token lines are hidden.' }));
          await load();
          return;
        }
        if (which === 'health') {
          const h = await api('GET', `/api/printers/${p.id}/health`);
          out.replaceChildren(el('ul', { className: 'health' }, ...h.checks.map((c) => el('li', { className: `lvl-${c.level}` },
            el('strong', { textContent: `${c.level === 'warn' ? 'WARN' : c.level === 'ok' ? 'OK' : 'INFO'}  ${c.title}: ` }), document.createTextNode(c.detail)))),
          el('p', { className: 'muted', textContent: 'Values are the effective Klipper settings (configfile.settings, defaults included). Change them in Mainsail; STL Tools never edits printer config.' }));
        } else {
          const files = await api('GET', `/api/printers/${p.id}/config`);
          const pick = el('select', { 'aria-label': 'Config file' }, ...files.map((f) => el('option', { value: f.path, textContent: `${f.path} (${(f.size / 1024).toFixed(1)} KB)` })));
          const find = el('input', { type: 'search', placeholder: 'Find in file (e.g. pause_on_runout, max_accel, [extruder])' });
          const pre = el('pre', { className: 'cfg-view' });
          let text = '';
          const render = () => {
            const q = find.value.trim().toLowerCase();
            const lines = text.split('\n');
            pre.replaceChildren(...lines.map((l, i) => {
              const hit = q && l.toLowerCase().includes(q);
              const sec = /^\s*\[/.test(l);
              return el('div', { className: `${hit ? 'hit' : ''} ${sec ? 'sec' : ''} ${/^\s*#/.test(l) ? 'cmt' : ''}`.trim() || undefined }, el('span', { className: 'ln', textContent: String(i + 1).padStart(4) }), ` ${l}`);
            }));
            pre.querySelector('.hit')?.scrollIntoView({ block: 'center' });
          };
          const load = async () => {
            pre.textContent = 'Loading...';
            const f = await api('GET', `/api/printers/${p.id}/config?file=${encodeURIComponent(pick.value)}`);
            text = f.text;
            render();
          };
          pick.onchange = () => load().catch((err) => { pre.textContent = err.message; });
          find.oninput = render;
          out.replaceChildren(el('div', { className: 'row' }, pick, find), pre,
            el('p', { className: 'muted', textContent: 'Read-only copy. Lines that look like keys, tokens or passwords are hidden. Edit config in Mainsail (Machine tab).' }));
          if (files.length) await load(); else pre.textContent = 'No config files.';
        }
      } catch (err) { out.replaceChildren(el('p', { className: 'error', textContent: err.message })); }
    };
    tabs.append(
      el('button', { type: 'button', className: 'secondary small', dataset: { k: 'health' }, textContent: 'Health check', onclick: () => show('health') }),
      el('button', { type: 'button', className: 'secondary small', dataset: { k: 'config' }, textContent: 'Config files (printer.cfg)', onclick: () => show('config') }),
      el('button', { type: 'button', className: 'secondary small', dataset: { k: 'mesh' }, textContent: 'Bed mesh', onclick: () => show('mesh') }),
      el('button', { type: 'button', className: 'secondary small', dataset: { k: 'logs' }, textContent: 'Logs', onclick: () => show('logs') }),
      el('a', { className: 'button secondary small', href: p.url, target: '_blank', rel: 'noopener', textContent: 'Open Mainsail' }));
    return el('div', { className: 'card insights-box' }, el('h3', { textContent: 'Printer details (read-only)' }),
      el('p', { className: 'muted', textContent: 'Health check reads the live Klipper setup: motion limits, pressure advance, input shaper, bed mesh, filament sensor, MCU firmware, host system and print totals. Config files shows printer.cfg and the rest.' }), tabs, out);
  }

  /** Live status and console lines over server-sent events (read-only). Falls back to polling when off or unsupported. */
  function openLive(p) {
    if (liveFor === p.id && liveSrc) return;
    if (liveSrc) { liveSrc.close(); liveSrc = null; }
    liveFor = null; liveMode = null;
    if (settings()?.printers.live === false || typeof EventSource !== 'function') return;
    const es = new EventSource(`/api/printers/${p.id}/events`);
    liveSrc = es; liveFor = p.id;
    let drawQueued = false;
    const redraw = () => {
      if (drawQueued) return;
      drawQueued = true;
      setTimeout(() => { drawQueued = false; if (gen !== alive || liveSrc !== es) return; drawCards(); drawDetail(); }, 500);
    };
    es.addEventListener('mode', (e) => { liveMode = JSON.parse(e.data).live ? 'websocket' : 'polling'; redraw(); });
    es.addEventListener('status', (e) => {
      const st = JSON.parse(e.data).status ?? {};
      if (st.error) { statusById.set(p.id, { error: st.error }); redraw(); return; }
      const old = statusById.get(p.id);
      const merged = { ...(old && !old.error ? old : {}) };
      for (const [k, v] of Object.entries(st)) if (v !== null && v !== undefined && k !== 'temps') merged[k] = v;
      merged.temps = { extruder: st.temps?.extruder ?? old?.temps?.extruder ?? null, bed: st.temps?.bed ?? old?.temps?.bed ?? null };
      if (!st.filename) merged.filename = null;
      merged.klippy ??= 'ready';
      statusById.set(p.id, merged);
      redraw();
    });
    es.addEventListener('console', (e) => {
      const ev = JSON.parse(e.data);
      const list = consoleById.get(p.id) ?? [];
      list.push(ev);
      if (list.length > 300) list.splice(0, list.length - 300);
      consoleById.set(p.id, list);
      detail.querySelector('.console-box')?.refresh?.();
    });
    es.onerror = () => { if (liveSrc === es) { liveMode = null; redraw(); } };
  }

  /** Printer console replies (notify_gcode_response), read-only. */
  function consoleBox(p) {
    const pre = el('pre', { className: 'console-view' });
    const box = el('div', { className: 'card console-box' }, el('h3', { textContent: 'Console (read-only)' }), pre,
      el('p', { className: 'muted', textContent: settings()?.printers.live === false ? 'Live updates are off (Settings > Printers), so no console lines arrive.' : 'Replies and messages from Klipper since this page opened (M117, RESPOND, errors, macro output). Sending commands needs control mode.' }));
    box.refresh = () => {
      const lines = consoleById.get(p.id) ?? [];
      pre.replaceChildren(...(lines.length ? lines.map((l) => el('div', { className: /^!!|error/i.test(l.line) ? 'sec' : undefined, textContent: `${new Date(l.at).toLocaleTimeString()}  ${l.line}` })) : [el('div', { className: 'muted', textContent: 'No console lines yet.' })]));
      pre.scrollTop = pre.scrollHeight;
    };
    box.refresh();
    return box;
  }

  /** Pre-print checklist: template items, automatic G-code header check, notes, saved to the print log. */
  function checklistBox(p) {
    const box = el('div', { className: 'card checklist-box' }, el('h3', { textContent: 'Pre-print checklist' }), el('p', { className: 'muted', textContent: 'Loading...' }));
    Promise.all([api('GET', '/api/checklists'), api('GET', `/api/printers/${p.id}/files`).catch(() => []), api('GET', `/api/printers/${p.id}/checklists`).catch(() => [])]).then(([tpls, files, log]) => {
      if (!tpls.length) { box.replaceChildren(el('h3', { textContent: 'Pre-print checklist' }), el('p', { className: 'muted', textContent: 'No checklist templates found (checklists folder).' })); return; }
      const def = tpls.find((t) => (t.printerModels ?? []).includes(p.model)) ?? tpls.find((t) => t.id === 'generic') ?? tpls[0];
      const tplPick = el('select', { 'aria-label': 'Checklist' }, ...tpls.map((t) => el('option', { value: t.id, textContent: t.name, selected: t.id === def.id })));
      const filePick = el('select', { 'aria-label': 'G-code file' }, el('option', { value: '', textContent: files.length ? 'Pick the G-code file' : 'No G-code files on the printer' }),
        ...[...files].sort((a, b) => b.modified - a.modified).slice(0, 200).map((f) => el('option', { value: f.path, textContent: f.path })));
      const items = el('ul', { className: 'checklist' });
      const checkOut = el('div', { className: 'header-check' });
      const notes = el('textarea', { rows: 2, maxLength: 4000, placeholder: 'Notes: spool, dryer time, anything odd' });
      const msg = el('p', { className: 'muted' });
      const hist = el('div', { className: 'print-log' });
      let headerOk = null;
      const tpl = () => tpls.find((t) => t.id === tplPick.value);
      const drawItems = () => {
        items.replaceChildren(...tpl().items.map((it, i) => el('li', {}, el('label', { className: 'check-inline' }, el('input', { type: 'checkbox', dataset: { i } }), ` ${it}`))));
        const t = tpl();
        if (t.source) items.append(el('li', { className: 'muted', textContent: `From: ${t.source}` }));
      };
      const drawHist = (entries) => {
        hist.replaceChildren(el('h4', { textContent: 'Print log (this printer, newest first)' }), entries.length
          ? el('ul', {}, ...entries.slice(0, 15).map((e) => el('li', { className: e.headerOk === false ? 'fail' : 'ok', textContent: `${new Date(e.at).toLocaleString()}  ${e.file || '(no file)'}: ${e.done.length} item(s) ticked${e.headerOk === true ? ', header OK' : e.headerOk === false ? ', header FAILED' : ''}${e.notes ? `. ${e.notes}` : ''}` })))
          : el('p', { className: 'muted', textContent: 'Nothing logged yet.' }));
      };
      const runCheck = async () => {
        headerOk = null;
        if (!filePick.value) { checkOut.replaceChildren(el('p', { className: 'muted', textContent: 'Pick a file first.' })); return; }
        checkOut.replaceChildren(el('p', { className: 'muted', textContent: 'Reading the start and end of the file from the printer (read-only)...' }));
        try {
          const r = await api('GET', `/api/printers/${p.id}/gcodecheck?file=${encodeURIComponent(filePick.value)}&checklist=${encodeURIComponent(tplPick.value)}`);
          headerOk = r.checks.every((c) => c.ok !== false);
          checkOut.replaceChildren(el('ul', { className: 'health' }, ...r.checks.map((c) => el('li', { className: `lvl-${c.ok === false ? 'warn' : c.ok ? 'ok' : 'info'}` },
            el('strong', { textContent: `${c.ok === false ? 'FAIL' : c.ok ? 'OK' : 'INFO'}  ${c.title}: ` }), document.createTextNode(c.detail ?? '')))),
          el('p', { className: headerOk ? 'muted' : 'error', textContent: headerOk ? 'Header check passed.' : 'Header check found problems: re-slice before printing.' }));
        } catch (err) { checkOut.replaceChildren(el('p', { className: 'error', textContent: err.message })); }
      };
      tplPick.onchange = () => { drawItems(); if (filePick.value) runCheck(); };
      filePick.onchange = runCheck;
      const save = el('button', { type: 'button', textContent: 'Save to print log', onclick: async () => {
        const done = [...items.querySelectorAll('input[type=checkbox]:checked')].map((c) => tpl().items[Number(c.dataset.i)]);
        const missing = tpl().items.length - done.length;
        if (missing && !confirm(`${missing} item(s) not ticked. Save anyway?`)) return;
        try {
          await api('POST', `/api/printers/${p.id}/checklists`, { file: filePick.value, checklist: tplPick.value, done, notes: notes.value, headerOk });
          if (filePick.value && !missing && headerOk !== false) checklistDone.set(`${p.id}|${filePick.value}`, true);
          msg.textContent = 'Saved.';
          notes.value = '';
          drawHist(await api('GET', `/api/printers/${p.id}/checklists`));
        } catch (err) { msg.textContent = err.message; }
      } });
      box.replaceChildren(el('h3', { textContent: 'Pre-print checklist' }),
        el('div', { className: 'row' }, tplPick, filePick, el('button', { type: 'button', className: 'secondary', textContent: 'Check G-code header', onclick: runCheck })),
        checkOut, items, notes, el('div', { className: 'row' }, save), msg, hist,
        el('p', { className: 'muted', textContent: 'The header check reads the file on the printer (read-only): heat-before-start order, speed caps, temperatures and max flow against the checklist rules. Templates: checklists folder.' }));
      drawItems();
      drawHist(log);
    }).catch((err) => box.replaceChildren(el('h3', { textContent: 'Pre-print checklist' }), el('p', { className: 'error', textContent: err.message })));
    return box;
  }

  function uploadBox(p, done) {
    const input = el('input', { type: 'file', accept: '.gcode,.g,.gco,.bgcode', multiple: true });
    const folder = el('input', { type: 'text', value: settings()?.printers.uploadFolder ?? 'stltools', placeholder: 'folder on the printer (optional)', maxLength: 80 });
    const andPrint = el('input', { type: 'checkbox' });
    const msg = el('p', { className: 'muted', textContent: p.control?.enabled ? 'Uploads never start a print unless you tick "Start printing after upload" (control mode).' : 'Upload only. Never starts a print. Slice your STL first (OrcaSlicer with the Sovol profile, or your own preset).' });
    const send = async (files) => {
      for (const f of files) {
        msg.textContent = `Uploading ${f.name} (${fmtBytes(f.size)})...`;
        try {
          const print = andPrint.checked && files.length === 1;
          if (print && !confirm(`Upload ${f.name} and START PRINTING it on ${p.name} right away? Check the bed is clear first.`)) { msg.textContent = 'Not uploaded.'; return; }
          const res = await fetch(`/api/printers/${p.id}/upload?filename=${encodeURIComponent(f.name)}&path=${encodeURIComponent(folder.value)}${print ? '&print=1&confirm=1' : ''}`, { method: 'PUT', body: f });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          msg.textContent = data.printStarted ? `Uploaded ${data.path} and started printing.` : `Uploaded ${data.path}. ${p.control?.enabled ? 'Press Print on the file to start it.' : 'Start it from Mainsail or the printer screen when you are ready.'}`;
        } catch (err) {
          msg.textContent = `Upload failed: ${err.message}`;
          return;
        }
      }
      done();
    };
    input.onchange = () => send([...input.files]);
    const box = el('div', { className: 'card upload-box' }, el('h3', { textContent: 'Upload G-code' }),
      el('div', { className: 'dropzone', textContent: 'Drop G-code here, or ', onclick: () => input.click() }, el('u', { textContent: 'choose files' })),
      el('label', {}, 'Folder ', folder), el('button', { type: 'button', className: 'secondary small', textContent: 'View a G-code file first', onclick: () => pickGcodeFile() }), p.control?.enabled ? el('label', { className: 'check-inline' }, andPrint, ' Start printing after upload (one file, asks first)') : null, msg);
    box.ondragover = (e) => { e.preventDefault(); box.classList.add('drag'); };
    box.ondragleave = () => box.classList.remove('drag');
    box.ondrop = (e) => { e.preventDefault(); box.classList.remove('drag'); send([...e.dataTransfer.files]); };
    return box;
  }

  async function poll() {
    if (gen !== alive) return;
    await Promise.all(printers.map(async (p) => {
      try { statusById.set(p.id, await api('GET', `/api/printers/${p.id}/status`)); } catch (err) { statusById.set(p.id, { error: err.message }); }
    }));
    if (gen !== alive) return;
    drawCards();
    drawDetail();
    const every = (settings()?.printers.pollSeconds ?? 3) * 1000;
    // with a live stream the selected printer updates by itself; the poll only fills in time left and thumbnails
    timer = setTimeout(poll, document.hidden || (liveSrc && liveMode) ? Math.max(15000, every) : every);
  }
  drawCards();
  drawDetail(true);
  if (printers.length) poll();
}

/** Small status chips for the home page. */
export async function printerChips() {
  if (!printersVisible()) return null;
  const printers = await api('GET', '/api/printers').catch(() => []);
  if (!printers.length) return null;
  const wrap = el('div', { className: 'chips' });
  for (const p of printers) {
    const chip = el('a', { href: '#printers', className: 'chip', textContent: `${p.name}: ...` });
    wrap.append(chip);
    api('GET', `/api/printers/${p.id}/status`).then((s) => {
      chip.textContent = `${p.name}: ${STATE_LABEL[s.state] ?? s.state}${s.state === 'printing' ? ` ${(s.progress * 100).toFixed(0)}%` : ''}`;
      chip.classList.add(`state-${s.state}`);
    }).catch(() => { chip.textContent = `${p.name}: offline`; chip.classList.add('state-offline'); });
  }
  return wrap;
}
