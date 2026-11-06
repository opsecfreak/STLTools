// Printers page: Klipper / Moonraker printers (Sovol SV07, Mainsail, Fluidd) on the LAN.
// VIEW ONLY: status, temperatures, progress, files, history, webcam, and G-code
// upload that never starts a print. There are no control buttons anywhere.
import { el, api, fmtDuration, fmtBytes, fmtAgo, store, settings, confirmDelete } from './lib.js';

let timer = null;
let alive = 0; // render generation; stops polling when the page changes

export function stopPrinters() {
  alive++;
  clearTimeout(timer);
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
      statusBox.append(
        el('div', { className: 'row' }, el('span', { className: `state-pill state-${s.state}`, textContent: STATE_LABEL[s.state] ?? s.state }), el('strong', { textContent: s.filename ?? 'No active print' })),
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
        el('a', { href: p.url, target: '_blank', rel: 'noopener', textContent: 'Open Mainsail / Fluidd' }));
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
    detail.replaceChildren(el('div', { className: 'detail-grid' }, statusBox, cam, upload, files, history), el('div', { className: 'row' }, remove));
    // webcam
    api('GET', `/api/printers/${p.id}/webcams`).then((cams) => {
      if (!cams.length) { cam.replaceChildren(el('h3', { textContent: 'Webcam' }), el('p', { className: 'muted', textContent: 'No webcam configured in Mainsail.' })); return; }
      const img = el('img', { className: 'cam', alt: 'Webcam snapshot' });
      const c = cams[0];
      img.style.transform = `${c.flipH ? 'scaleX(-1) ' : ''}${c.flipV ? 'scaleY(-1) ' : ''}rotate(${c.rotation}deg)`;
      const refresh = () => { if (gen === alive && detail.dataset.printer === p.id) img.src = `/api/printers/${p.id}/snapshot?cam=0&t=${Date.now()}`; };
      img.onload = () => setTimeout(refresh, 5000);
      img.onerror = () => setTimeout(refresh, 10000);
      cam.replaceChildren(el('h3', { textContent: `Webcam: ${c.name}` }), img, el('p', { className: 'muted', textContent: 'Snapshot every 5 seconds.' }));
      refresh();
    }).catch((err) => cam.replaceChildren(el('h3', { textContent: 'Webcam' }), el('p', { className: 'error', textContent: err.message })));
    // files
    if (lastFilesFor !== p.id) {
      lastFilesFor = p.id;
      api('GET', `/api/printers/${p.id}/files`).then((list) => {
        const grid = el('div', { className: 'file-grid' });
        files.replaceChildren(el('h3', { textContent: `Files on the printer (${list.length})` }), grid);
        for (const f of list.slice(0, 60)) {
          const tile = el('div', { className: 'file-tile' }, el('div', { className: 'file-thumb' }), el('div', { className: 'file-name', textContent: f.path }), el('div', { className: 'muted', textContent: `${fmtBytes(f.size)}, ${fmtAgo(f.modified)}` }));
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

  function uploadBox(p, done) {
    const input = el('input', { type: 'file', accept: '.gcode,.g,.gco,.bgcode', multiple: true });
    const folder = el('input', { type: 'text', value: settings()?.printers.uploadFolder ?? 'stltools', placeholder: 'folder on the printer (optional)', maxLength: 80 });
    const msg = el('p', { className: 'muted', textContent: 'Upload only. Never starts a print. Slice your STL first (Orca, Prusa, Cura, Sovol slicer).' });
    const send = async (files) => {
      for (const f of files) {
        msg.textContent = `Uploading ${f.name} (${fmtBytes(f.size)})...`;
        try {
          const res = await fetch(`/api/printers/${p.id}/upload?filename=${encodeURIComponent(f.name)}&path=${encodeURIComponent(folder.value)}`, { method: 'PUT', body: f });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          msg.textContent = `Uploaded ${data.path}. Start it from Mainsail or the printer screen when you are ready.`;
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
      el('label', {}, 'Folder ', folder), msg);
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
    timer = setTimeout(poll, document.hidden ? Math.max(15000, every) : every);
  }
  drawCards();
  drawDetail(true);
  if (printers.length) poll();
}

/** Small status chips for the home page. */
export async function printerChips() {
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
