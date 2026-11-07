// Controls inside the 3D view and the print estimate under it.
//
// initViewTools(viewer, toolbarEl)   view buttons (Iso / Top / Front / Right / Fit),
//                                    display mode, layer cut slider, screenshot, and a
//                                    settings panel with every 3D view setting. Changes
//                                    apply at once and are saved to Settings > 3D view.
// createEstimateBox(el, viewer)      "Print on" printer / profile picker, layer height,
//                                    infill, material, and the time / filament estimate
//                                    for what the viewer shows. Uses /shared/estimate.js
//                                    (the same code the server uses for project ZIPs).
import { el, api, settings, saveSettings, debounce, toast, downloadBlob, store, fmtSize } from './lib.js';
import { estimateParts, formatDuration, MATERIALS } from '/shared/estimate.js';

const SHADING = [['shaded', 'Shaded'], ['edges', 'Edges'], ['wireframe', 'Wire'], ['xray', 'X-ray']];
const QUALITY = [['ultra', 'Ultra'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low (Pi)']];

export function initViewTools(viewer, bar) {
  const save = debounce((patch) => saveSettings({ viewer: patch }).catch((e) => toast(e.message, 'error')), 400);
  const set = (patch) => { viewer.setOptions(patch); save(patch); drawPanel(); };
  const btn = (label, title, fn) => el('button', { type: 'button', className: 'vt', textContent: label, title, onclick: fn });

  // layer cut slider
  const cut = el('input', { type: 'range', min: 0, max: 1000, value: 1000, className: 'vt-cut', 'aria-label': 'Cut height' });
  const cutLabel = el('span', { className: 'vt-cut-label' });
  const cutBox = el('div', { className: 'vt-cutbox', hidden: true }, cut, cutLabel);
  const updateCut = () => {
    const h = viewer.bounds()?.size[2] ?? 0;
    const z = (h * Number(cut.value)) / 1000;
    const lh = settings()?.print.layerHeight ?? 0.2;
    if (Number(cut.value) >= 1000) { viewer.setClip(null); cutLabel.textContent = `Full height ${h.toFixed(1)} mm`; return; }
    viewer.setClip(z);
    cutLabel.textContent = `z ${z.toFixed(2)} mm, layer ${Math.max(1, Math.round(z / lh))} of ${Math.ceil(h / lh)}`;
  };
  cut.oninput = updateCut;

  const layoutBtn = el('button', { type: 'button', className: 'vt vt-layout', hidden: true, title: 'Show the parts put together, or laid out as printed', onclick: async () => {
    const next = viewer.layout() === 'assembled' ? 'plate' : 'assembled';
    store.set('layout', next);
    await viewer.setLayout(next);
    syncLayout();
  } });
  const syncLayout = () => {
    layoutBtn.hidden = !viewer.canAssemble();
    layoutBtn.textContent = viewer.layout() === 'assembled' ? 'Print plate' : 'Assembled';
  };
  const shadingSel = el('select', { className: 'vt-select', title: 'Display', 'aria-label': 'Display', onchange: () => set({ shading: shadingSel.value }) },
    ...SHADING.map(([v, l]) => el('option', { value: v, textContent: l })));
  const panel = el('div', { className: 'vt-panel', hidden: true });

  function drawPanel() {
    const o = viewer.options();
    shadingSel.value = o.shading;
    const check = (key, label) => el('label', { className: 'check-inline' }, el('input', { type: 'checkbox', checked: Boolean(o[key]), onchange: (e) => set({ [key]: e.target.checked }) }), ` ${label}`);
    panel.replaceChildren(
      el('div', { className: 'vt-panel-head' }, el('strong', { textContent: '3D view settings' }), el('button', { type: 'button', className: 'vt', textContent: 'x', title: 'Close', onclick: () => { panel.hidden = true; } })),
      el('label', {}, 'Quality ', el('select', { onchange: (e) => set({ quality: e.target.value }) }, ...QUALITY.map(([v, l]) => el('option', { value: v, textContent: l, selected: o.quality === v })))),
      el('label', {}, 'Display ', el('select', { onchange: (e) => set({ shading: e.target.value }) }, ...SHADING.map(([v, l]) => el('option', { value: v, textContent: l, selected: o.shading === v })))),
      el('label', {}, 'Color ', el('input', { type: 'color', value: o.color, oninput: (e) => { viewer.setOptions({ color: e.target.value }); save({ color: e.target.value }); } })),
      check('shadows', 'Shadows'), check('grid', 'Grid'), check('bed', 'Printer bed'), check('axes', 'Axes'),
      check('dimensions', 'Size label'), check('ortho', 'Orthographic'), check('autoRotate', 'Turn slowly'),
      el('p', { className: 'muted', textContent: 'Saved for every device in Settings > 3D view. Ultra uses full screen resolution and soft shadows: best on a desktop GPU.' }));
  }

  bar.replaceChildren(
    el('div', { className: 'vt-row' },
      btn('Iso', 'Isometric view', () => viewer.setView('iso')),
      btn('Top', 'Top view', () => viewer.setView('top')),
      btn('Front', 'Front view', () => viewer.setView('front')),
      btn('Right', 'Right view', () => viewer.setView('right')),
      btn('Fit', 'Fit to the model', () => viewer.setView('fit')),
      layoutBtn,
      shadingSel,
      btn('Cut', 'Layer preview: cut the model at a height', () => { cutBox.hidden = !cutBox.hidden; if (cutBox.hidden) { cut.value = 1000; } updateCut(); }),
      btn('PNG', 'Save a picture of this view', async () => downloadBlob(await viewer.screenshot(), 'stltools-view.png')),
      btn('⚙', '3D view settings', () => { panel.hidden = !panel.hidden; drawPanel(); })),
    cutBox, panel);
  drawPanel();
  return { reset: () => { cut.value = 1000; updateCut(); syncLayout(); } };
}

// ---------------------------------------------------------------- estimate

let profilesP = null;
const profiles = () => (profilesP ??= api('GET', '/api/printer-profiles').catch(() => []));

/**
 * Printers and profiles to estimate for: [{ value, label, profile }]. The server
 * builds the printer entries with each printer's own Klipper limits (bed, speed,
 * acceleration, nozzle) when Settings > Printers allows it.
 */
async function targets() {
  const t = await api('GET', '/api/estimate-targets').catch(() => null);
  if (t) return t;
  return (await profiles()).map((p) => ({ value: `profile:${p.id}`, label: p.name, profile: p }));
}

export function createEstimateBox(box, viewer, { onShowPart } = {}) {
  // rows: [{ name?, stats, url?, filename?, qty? }] (plain stats objects are accepted too)
  let rows = [];
  let opts = [];
  const pick = el('select', { 'aria-label': 'Print on' });
  const lh = el('input', { type: 'number', min: 0.04, max: 1, step: 0.02, className: 'est-num', title: 'Layer height (mm)' });
  const infill = el('input', { type: 'number', min: 0, max: 100, step: 5, className: 'est-num', title: 'Infill (%)' });
  const mat = el('select', { title: 'Material' }, ...Object.entries(MATERIALS).map(([k, m]) => el('option', { value: k, textContent: m.name })));
  // quality presets: Orca-style starting points, plus the shop's proven SV07 preset (sv07-alex-v3)
  const QUALITY = {
    draft: { label: '0.28 Draft', layerHeight: 0.28, walls: 2, shellLayers: 3, infill: 10 },
    standard: { label: '0.20 Standard', layerHeight: 0.2, walls: 3, shellLayers: 4, infill: 15 },
    fine: { label: '0.12 Fine', layerHeight: 0.12, walls: 3, shellLayers: 5, infill: 15 },
    strong: { label: 'Strong (4 walls, 25 %)', layerHeight: 0.2, walls: 4, shellLayers: 5, infill: 25 },
    'mts-v3': { label: 'MTS SV07 v3 (0.20, 3 walls, 15 %)', layerHeight: 0.2, walls: 3, shellLayers: 4, infill: 15 },
  };
  const quality = el('select', { title: 'Quality preset: sets layer height, walls, top/bottom layers and infill' }, el('option', { value: '', textContent: 'Quality...' }), ...Object.entries(QUALITY).map(([k, q]) => el('option', { value: k, textContent: q.label })));
  quality.onchange = () => {
    const q = QUALITY[quality.value];
    if (!q) return;
    const patch = { layerHeight: q.layerHeight, walls: q.walls, shellLayers: q.shellLayers, infill: q.infill };
    Object.assign(settings().print, patch);
    lh.value = q.layerHeight; infill.value = q.infill;
    store.set('estimateQuality', quality.value);
    draw();
    saveSoon(patch);
  };
  const out = el('div', { className: 'est-out' });
  const saveSoon = debounce((patch) => saveSettings({ print: patch }).catch((e) => toast(e.message, 'error')), 500);

  const current = () => opts.find((o) => o.value === pick.value) ?? opts[0];
  const g = (x) => `${x.toFixed(x < 10 ? 1 : 0)} g`;

  function draw() {
    const t = current();
    const cfg = settings()?.print;
    if (!t || !cfg) { out.replaceChildren(el('span', { className: 'muted', textContent: 'No printer profile.' })); return; }
    viewer.setBed(t.profile.bed);
    if (!rows.length) { out.replaceChildren(el('span', { className: 'muted', textContent: 'Generate or open a part to see its print time and filament.' })); return; }
    const qty = rows.map((r) => r.qty ?? 1);
    const costPerKg = settings()?.filament?.[cfg.material] ?? cfg.filamentCostPerKg;
    const e = estimateParts(rows.map((r) => r.stats), t.profile, { ...cfg, filamentCostPerKg: costPerKg }, qty);
    const pieces = qty.reduce((a, b) => a + b, 0);
    const misfit = e.parts.filter((p) => !p.fit.fits).length;
    const table = el('table', { className: 'est-table' },
      el('thead', {}, el('tr', {}, ...['Part', 'Size', 'Qty', 'Time', 'Filament', 'Layers', 'Bed', ''].map((h) => el('th', { textContent: h })))),
      el('tbody', {}, ...rows.map((r, i) => {
        const p = e.parts[i];
        const n = qty[i];
        return el('tr', { className: p.fit.fits ? '' : 'misfit' },
          el('td', {}, onShowPart && rows.length > 1 ? el('a', { href: '#', textContent: r.name ?? `Part ${i + 1}`, title: 'Show only this part', onclick: (ev) => { ev.preventDefault(); onShowPart(i); } }) : document.createTextNode(r.name ?? `Part ${i + 1}`)),
          el('td', { textContent: fmtSize(r.stats.size.map(Number)) }),
          el('td', { textContent: String(n) }),
          el('td', { textContent: formatDuration(p.seconds * n) + (n > 1 ? ` (${formatDuration(p.seconds)} each)` : '') }),
          el('td', { textContent: `${g(p.grams * n)}, ${((p.filamentMm * n) / 1000).toFixed(2)} m` }),
          el('td', { textContent: String(p.layers) }),
          el('td', { className: p.fit.fits ? 'ok' : 'bad', textContent: p.fit.fits ? (p.fit.rotated ? 'fits, turned 90' : 'fits') : 'too big', title: p.fit.reason ?? '' }),
          el('td', {}, r.url ? el('a', { href: r.url, download: r.filename ?? '', textContent: 'STL' }) : null));
      })),
      rows.length > 1 || pieces > 1 ? el('tfoot', {}, el('tr', {},
        el('td', { textContent: `Total (${pieces} piece${pieces > 1 ? 's' : ''})` }), el('td'), el('td', { textContent: String(pieces) }),
        el('td', { textContent: `${formatDuration(e.seconds)}` }), el('td', { textContent: `${g(e.grams)}, ${(e.filamentMm / 1000).toFixed(2)} m` }), el('td'), el('td'), el('td'))) : null);
    out.replaceChildren(...[
      el('div', { className: 'est-main' },
        el('strong', { textContent: `About ${formatDuration(e.seconds)}` }),
        el('span', { textContent: `${g(e.grams)} ${MATERIALS[cfg.material]?.name ?? ''}, ${(e.filamentMm / 1000).toFixed(2)} m` }),
        e.cost !== null ? el('span', { textContent: `filament cost ${e.cost.toFixed(2)} (${costPerKg}/kg)` }) : el('span', { className: 'muted', textContent: 'cost: set a price per kg in Settings > Filament prices' }),
        el('span', { className: 'muted', textContent: `incl. ${formatDuration(e.heatUp)} heat-up` })),
      misfit ? el('div', { className: 'est-warn', textContent: `${misfit} part${misfit > 1 ? 's do' : ' does'} not fit the ${t.profile.name} bed.` }) : null,
      table,
      el('details', { className: 'est-detail' }, el('summary', { textContent: 'How this is calculated' }),
        el('ul', {}, ...e.parts.map((p, i) => el('li', { textContent: `${rows[i].name ?? `Part ${i + 1}`}: walls ${formatDuration(p.breakdown.walls / p.breakdown.efficiency)}, top/bottom ${formatDuration(p.breakdown.topBottom / p.breakdown.efficiency)}, infill ${formatDuration(p.breakdown.infill / p.breakdown.efficiency)}, layer moves ${formatDuration(p.breakdown.overhead)}` })),
          el('li', { textContent: `Heat-up ${formatDuration(e.heatUp)} once per plate. ${cfg.walls} walls, ${cfg.shellLayers} top/bottom layers, ${cfg.infill}% infill. Calibration x${cfg.timeFactor}.` })),
        el('p', { className: 'muted', textContent: `Estimate from the part's geometry and the ${t.profile.name} profile${t.profile.fromMachine ? `: bed ${t.profile.bed.x} x ${t.profile.bed.y} x ${t.profile.bed.z} mm, max ${t.profile.fromMachine.maxVelocity ?? '?'} mm/s and accel ${t.profile.fromMachine.maxAccel ?? '?'} read from the printer` : ''}${t.profile.verified ? '' : ' (speeds not verified)'}: expect about +/- 25 %. Your slicer gives the real time. Calibrate in Settings > Print estimates.` }))].filter(Boolean));
  }

  async function refreshTargets() {
    opts = await targets();
    const s = settings();
    const saved = store.get('estimateTarget');
    const def = s?.printers.defaultPrinter ? `printer:${s.printers.defaultPrinter}` : `profile:${s?.print.profile}`;
    pick.replaceChildren(...opts.map((o) => el('option', { value: o.value, textContent: o.label })));
    pick.value = opts.some((o) => o.value === saved) ? saved : opts.some((o) => o.value === def) ? def : opts[0]?.value ?? '';
    const cfg = s?.print;
    if (cfg) { lh.value = cfg.layerHeight; infill.value = cfg.infill; mat.value = cfg.material; quality.value = store.get('estimateQuality') ?? ''; }
    draw();
  }

  pick.onchange = () => { store.set('estimateTarget', pick.value); draw(); };
  const change = (key, v) => { settings().print[key] = v; draw(); saveSoon({ [key]: v }); };
  lh.oninput = () => { const v = Number(lh.value); if (v >= 0.04 && v <= 1) { quality.value = ''; change('layerHeight', v); } };
  infill.oninput = () => { const v = Number(infill.value); if (v >= 0 && v <= 100) { quality.value = ''; change('infill', v); } };
  mat.onchange = () => change('material', mat.value);

  box.replaceChildren(
    el('div', { className: 'est-head' },
      el('strong', { textContent: 'Print estimate' }),
      el('label', {}, 'on ', pick),
      el('label', {}, 'layer ', lh, ' mm'),
      el('label', {}, 'infill ', infill, ' %'),
      mat, quality),
    out);
  refreshTargets();
  return {
    /** parts on screen: [{ name, stats, url, filename, qty }] or plain stats objects */
    update(next) { rows = (next ?? []).filter(Boolean).map((r) => (r.stats ? r : { stats: r })); draw(); },
    refresh: refreshTargets,
    profile: () => current()?.profile ?? null,
  };
}
