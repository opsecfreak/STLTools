// Layer viewer: one window for two sources.
//   - Layer preview of a part (POST /api/layers, src/core/layers.js): walls, skin, infill per layer.
//   - G-code viewer (gcode-parse.js): a file from the printer or from this computer.
// Views: one layer from above (2D, the layer below in gray), or the stack up to that
// layer in 3D. Feature colors can be switched off; travel is optional. A bar chart
// shows the time of every layer; click it to jump.
import { el, api, fmtDuration, store, toast, settings } from './lib.js';
import { parseGcode, FEATURE_TYPES } from './gcode-parse.js';

const COLORS = { outer: '#ff7a1a', inner: '#f5c518', skin: '#a05cf0', infill: '#d64545', bridge: '#3b82f6', support: '#22b573', skirt: '#17a2b8', other: '#8a8f98', travel: '#4a90e2' };
const LABELS = { outer: 'Outer wall', inner: 'Inner walls', skin: 'Solid skin (top / bottom)', infill: 'Infill', bridge: 'Bridge', support: 'Support', skirt: 'Skirt / brim', other: 'Other', travel: 'Travel' };

/** Server layer preview -> viewer data (closed outlines become segments). */
export function fromPreview(r) {
  const ring = (flat) => {
    const out = [];
    for (let i = 0; i < flat.length; i += 2) {
      const j = (i + 2) % flat.length;
      out.push(flat[i], flat[i + 1], flat[j], flat[j + 1]);
    }
    return out;
  };
  return {
    layers: r.layers.map((L) => ({
      z: L.z, seconds: L.seconds,
      types: { outer: Float32Array.from(L.outer.flatMap(ring)), inner: Float32Array.from(L.inner.flatMap(ring)), skin: Float32Array.from(L.skin), infill: Float32Array.from(L.infill) },
      travel: new Float32Array(0), mm: L.mm,
    })),
    bounds: { min: r.bounds.min, max: r.bounds.max },
    totals: r.totals, lineWidth: r.lineWidth, layerHeight: r.layerHeight, note: r.note,
  };
}

/**
 * Open the viewer.
 * opts: { title, subtitle?, load: async (params) => data, options?: [{ key, label, value, step, min, max }], parts?: [names], part? }
 */
export function openLayerView(opts) {
  document.querySelector('.layer-overlay')?.remove();
  const hidden = new Set(store.get('layerHidden') ?? ['travel']);
  let data = null, index = 0, mode = store.get('layerMode') ?? '2d';
  let zoom = 1, panX = 0, panY = 0, playing = null;
  const info = el('p', { className: 'muted', textContent: 'Loading...' });
  const facts = el('div', { className: 'layer-facts' });
  const slider = el('input', { type: 'range', min: 1, max: 1, value: 1, className: 'layer-slider', 'aria-label': 'Layer' });
  const layerNo = el('strong', { textContent: '-' });
  const canvas = el('canvas', { className: 'layer-canvas', width: 900, height: 640 });
  const chart = el('canvas', { className: 'layer-chart', width: 900, height: 70, title: 'Time per layer: click to jump' });
  const glWrap = el('div', { className: 'layer-gl', hidden: true });
  const legend = el('div', { className: 'layer-legend' });
  const optBox = el('div', { className: 'row layer-opts' });
  const optInputs = {};
  for (const o of opts.options ?? []) {
    optInputs[o.key] = el('input', { type: 'number', className: 'num', value: o.value, step: o.step ?? 'any', min: o.min, max: o.max });
    optBox.append(el('label', {}, `${o.label} `, optInputs[o.key]));
  }
  let partPick = null;
  if (opts.parts?.length > 1) {
    partPick = el('select', { 'aria-label': 'Part' }, ...opts.parts.map((n) => el('option', { value: n, textContent: n, selected: n === opts.part })));
    optBox.prepend(el('label', {}, 'Part ', partPick));
  }
  if (opts.options?.length || partPick) optBox.append(el('button', { type: 'button', textContent: 'Update', onclick: () => load() }));

  const modeBtn = (m, label) => el('button', { type: 'button', className: `secondary small ${mode === m ? 'active' : ''}`, dataset: { m }, textContent: label, onclick: () => setMode(m) });
  const modes = el('div', { className: 'row' }, modeBtn('2d', 'Layer (top view)'), modeBtn('3d', 'Stack (3D)'));
  const step = (d) => setLayer(index + d);
  const play = el('button', { type: 'button', className: 'secondary small', textContent: 'Play', onclick: () => {
    if (playing) { clearInterval(playing); playing = null; play.textContent = 'Play'; return; }
    if (index >= data.layers.length - 1) setLayer(0);
    play.textContent = 'Stop';
    playing = setInterval(() => { if (index >= data.layers.length - 1 || !box.isConnected) { clearInterval(playing); playing = null; play.textContent = 'Play'; return; } setLayer(index + 1); }, 120);
  } });
  const close = () => { clearInterval(playing); gl?.dispose(); box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  };
  document.addEventListener('keydown', onKey);
  const box = el('div', { className: 'split-overlay layer-overlay' }, el('div', { className: 'card split-box layer-box' },
    el('div', { className: 'row' }, el('h3', { textContent: opts.title }), el('button', { type: 'button', className: 'secondary small', textContent: 'Close', onclick: close })),
    opts.subtitle ? el('p', { className: 'muted', textContent: opts.subtitle }) : null,
    optBox, info,
    el('div', { className: 'row layer-nav' }, modes, el('button', { type: 'button', className: 'secondary small', textContent: '-', 'aria-label': 'Layer down', onclick: () => step(-1) }), slider,
      el('button', { type: 'button', className: 'secondary small', textContent: '+', 'aria-label': 'Layer up', onclick: () => step(1) }), layerNo, play),
    el('div', { className: 'layer-stage' }, canvas, glWrap), chart, facts, legend,
    el('p', { className: 'muted', textContent: 'Arrow keys change the layer. 2D: wheel zooms, drag pans, double-click resets.' })));
  document.body.append(box);
  slider.oninput = () => setLayer(Number(slider.value) - 1);

  // ---- 2D view
  const view = () => {
    const b = data.bounds;
    const w = Math.max(1, b.max[0] - b.min[0]), h = Math.max(1, b.max[1] - b.min[1]);
    const s = Math.min((canvas.width - 40) / w, (canvas.height - 40) / h) * zoom;
    const ox = canvas.width / 2 - ((b.min[0] + b.max[0]) / 2) * s + panX;
    const oy = canvas.height / 2 + ((b.min[1] + b.max[1]) / 2) * s + panY;
    return { s, X: (x) => ox + x * s, Y: (y) => oy - y * s };
  };
  const draw2d = () => {
    const c = canvas.getContext('2d');
    const dark = document.documentElement.dataset.theme === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches;
    c.fillStyle = dark ? '#15181d' : '#f4f6f9';
    c.fillRect(0, 0, canvas.width, canvas.height);
    if (!data?.layers.length) return;
    const v = view();
    const lw = Math.max(1, (data.lineWidth ?? 0.45) * v.s * 0.9);
    const strokeSegs = (arr, color, width) => {
      if (!arr?.length) return;
      c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round';
      c.beginPath();
      for (let i = 0; i < arr.length; i += 4) { c.moveTo(v.X(arr[i]), v.Y(arr[i + 1])); c.lineTo(v.X(arr[i + 2]), v.Y(arr[i + 3])); }
      c.stroke();
    };
    const below = data.layers[index - 1];
    if (below) for (const t of Object.keys(below.types)) if (!hidden.has(t)) strokeSegs(below.types[t], dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)', lw);
    const L = data.layers[index];
    for (const t of FEATURE_TYPES) if (!hidden.has(t)) strokeSegs(L.types[t], COLORS[t], lw);
    if (!hidden.has('travel')) { c.setLineDash([4, 4]); strokeSegs(L.travel, COLORS.travel, 1); c.setLineDash([]); }
    // scale bar: 10 mm
    const bar = 10 * v.s;
    c.fillStyle = dark ? '#ddd' : '#333'; c.fillRect(20, canvas.height - 18, bar, 3);
    c.font = '12px sans-serif'; c.fillText('10 mm', 20, canvas.height - 24);
  };
  let drag = null;
  canvas.onwheel = (e) => { e.preventDefault(); const f = e.deltaY < 0 ? 1.2 : 1 / 1.2; zoom = Math.min(80, Math.max(0.3, zoom * f)); panX *= f; panY *= f; draw2d(); };
  canvas.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, px: panX, py: panY }; canvas.setPointerCapture(e.pointerId); };
  canvas.onpointermove = (e) => { if (!drag) return; const k = canvas.width / canvas.clientWidth; panX = drag.px + (e.clientX - drag.x) * k; panY = drag.py + (e.clientY - drag.y) * k; draw2d(); };
  canvas.onpointerup = () => { drag = null; };
  canvas.ondblclick = () => { zoom = 1; panX = panY = 0; draw2d(); };

  // ---- time chart
  const drawChart = () => {
    const c = chart.getContext('2d');
    c.clearRect(0, 0, chart.width, chart.height);
    if (!data?.layers.length) return;
    const n = data.layers.length, max = Math.max(...data.layers.map((l) => l.seconds), 0.1);
    const bw = chart.width / n;
    for (let i = 0; i < n; i++) {
      const h = (data.layers[i].seconds / max) * (chart.height - 6);
      c.fillStyle = i === index ? '#ff7a1a' : i < index ? '#8fa3bf' : '#c9d3e0';
      c.fillRect(i * bw, chart.height - h, Math.max(1, bw - (bw > 3 ? 1 : 0)), h);
    }
  };
  chart.onclick = (e) => { const r = chart.getBoundingClientRect(); setLayer(Math.floor(((e.clientX - r.left) / r.width) * data.layers.length)); };

  // ---- 3D stack (three.js, loaded on first use)
  let gl = null;
  const draw3d = async () => {
    if (!gl) {
      try { gl = await makeStack(glWrap, data, hidden); } catch (err) { glWrap.replaceChildren(el('p', { className: 'error', textContent: `3D view unavailable: ${err.message}` })); return; }
    }
    gl.show(index);
  };

  const drawLegend = () => {
    const sum = {};
    for (const L of data.layers) for (const [t, a] of Object.entries(L.types)) { let len = 0; for (let i = 0; i < a.length; i += 4) len += Math.hypot(a[i + 2] - a[i], a[i + 3] - a[i + 1]); sum[t] = (sum[t] ?? 0) + len; }
    const types = [...FEATURE_TYPES.filter((t) => sum[t] > 0), ...(data.layers.some((l) => l.travel.length) ? ['travel'] : [])];
    legend.replaceChildren(...types.map((t) => {
      const cb = el('input', { type: 'checkbox', checked: !hidden.has(t), onchange: () => { if (cb.checked) hidden.delete(t); else hidden.add(t); store.set('layerHidden', [...hidden]); gl?.dispose(); gl = null; redraw(); } });
      return el('label', { className: 'check-inline' }, cb, el('span', { className: 'swatch', style: `background:${COLORS[t]}` }), ` ${LABELS[t]}${sum[t] ? ` (${(sum[t] / 1000).toFixed(1)} m)` : ''}`);
    }));
  };
  const drawFacts = () => {
    const L = data.layers[index];
    const done = data.layers.slice(0, index + 1).reduce((a, l) => a + l.seconds, 0);
    let ext = 0;
    for (const a of Object.values(L.types)) for (let i = 0; i < a.length; i += 4) ext += Math.hypot(a[i + 2] - a[i], a[i + 3] - a[i + 1]);
    facts.replaceChildren(el('dl', { className: 'facts' }, ...[
      ['Layer', `${index + 1} of ${data.layers.length}`],
      ['Height (Z)', `${L.z.toFixed(2)} mm`],
      ['This layer', L.seconds < 120 ? `${L.seconds.toFixed(L.seconds < 10 ? 1 : 0)} s` : fmtDuration(L.seconds)],
      ['Printed up to here', `${fmtDuration(done)} of ${fmtDuration(data.totals.seconds)}`],
      ['Lines this layer', `${(ext / 1000).toFixed(2)} m`],
    ].flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })])));
  };
  function setLayer(i) {
    if (!data?.layers.length) return;
    index = Math.max(0, Math.min(data.layers.length - 1, i));
    slider.value = String(index + 1);
    layerNo.textContent = `${index + 1} / ${data.layers.length}`;
    redraw();
  }
  function redraw() {
    if (!data) return;
    canvas.hidden = mode !== '2d';
    glWrap.hidden = mode !== '3d';
    if (mode === '2d') draw2d(); else draw3d();
    drawChart();
    drawFacts();
  }
  function setMode(m) {
    mode = m;
    store.set('layerMode', m);
    for (const b of modes.children) b.classList.toggle('active', b.dataset.m === m);
    redraw();
  }
  async function load() {
    info.textContent = 'Loading...';
    clearInterval(playing); playing = null; play.textContent = 'Play';
    try {
      const params = { part: partPick?.value ?? opts.part };
      for (const [k, i] of Object.entries(optInputs)) if (i.value !== '') params[k] = Number(i.value);
      data = await opts.load(params, (msg) => { info.textContent = msg; });
      gl?.dispose(); gl = null;
      if (!data.layers.length) { info.textContent = 'No layers: nothing is extruded.'; return; }
      slider.max = String(data.layers.length);
      const t = data.totals;
      info.textContent = [
        `${data.layers.length} layers`,
        data.layerHeight ? `${data.layerHeight} mm` : null,
        `about ${fmtDuration(t.seconds)}${data.meta?.estimatedSeconds ? ` (no acceleration; slicer says ${fmtDuration(data.meta.estimatedSeconds)})` : ''}`,
        t.filamentMm ? `${(t.filamentMm / 1000).toFixed(2)} m filament` : null,
        data.meta?.slicer ? `from ${data.meta.slicer}` : null,
        data.note ?? null,
      ].filter(Boolean).join(', ');
      drawLegend();
      setLayer(Math.min(index || data.layers.length - 1, data.layers.length - 1));
    } catch (err) { info.textContent = ''; info.append(el('span', { className: 'error', textContent: err.message })); }
  }
  load();
  return { close };
}

/** 3D stack of layer lines with three.js; draw range follows the chosen layer. */
async function makeStack(wrap, data, hidden) {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const w = wrap.clientWidth || 860, h = 560;
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const scene = new THREE.Scene();
  const dark = document.documentElement.dataset.theme === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches;
  scene.background = new THREE.Color(dark ? 0x15181d : 0xf4f6f9);
  const b = data.bounds;
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, top = Math.max(...data.layers.map((l) => l.z));
  const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], top, 10);
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, size * 20);
  camera.up.set(0, 0, 1);
  camera.position.set(cx + size * 1.2, cy - size * 1.4, top + size * 1.0);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(cx, cy, top / 2);
  controls.update();
  const groups = [];
  for (const t of [...FEATURE_TYPES, 'travel']) {
    if (hidden.has(t)) continue;
    const pos = [], ends = [];
    for (const L of data.layers) {
      const a = t === 'travel' ? L.travel : L.types[t];
      if (a) for (let i = 0; i < a.length; i += 4) pos.push(a[i], a[i + 1], L.z, a[i + 2], a[i + 3], L.z);
      ends.push(pos.length / 3);
    }
    if (!pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: COLORS[t], transparent: t === 'travel', opacity: t === 'travel' ? 0.4 : 1 }));
    scene.add(line);
    groups.push({ g, ends });
  }
  const grid = new THREE.GridHelper(Math.ceil(size / 10) * 20, Math.ceil(size / 10) * 2, 0x888888, dark ? 0x333333 : 0xcccccc);
  grid.rotation.x = Math.PI / 2; grid.position.set(cx, cy, 0);
  scene.add(grid);
  wrap.replaceChildren(renderer.domElement);
  let raf = 0;
  const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
  loop();
  return {
    show(index) { for (const { g, ends } of groups) g.setDrawRange(0, ends[index] ?? 0); },
    dispose() { cancelAnimationFrame(raf); controls.dispose(); for (const { g } of groups) g.dispose(); renderer.dispose(); renderer.domElement.remove(); },
  };
}

/** Layer preview of a generated part or a library STL, with the print settings to tune. */
export function openPartLayers({ job, parts, part, library, title, profile }) {
  const print = settings()?.print ?? {};
  return openLayerView({
    title: title ?? 'Layer preview',
    subtitle: `Cross-sections of the part on ${profile?.name ?? 'the selected printer'}: walls, solid skin and infill, per layer, with the time of each layer. A preview, not G-code.`,
    parts, part,
    options: [
      { key: 'layerHeight', label: 'Layer', value: print.layerHeight ?? 0.2, step: 0.04, min: 0.05, max: 1 },
      { key: 'walls', label: 'Walls', value: print.walls ?? 3, step: 1, min: 1, max: 10 },
      { key: 'shellLayers', label: 'Top / bottom layers', value: print.shellLayers ?? 4, step: 1, min: 0, max: 20 },
      { key: 'infill', label: 'Infill %', value: print.infill ?? 15, step: 5, min: 0, max: 100 },
    ],
    load: async (params) => fromPreview(await api('POST', '/api/layers', { job, library, profile: profile?.id?.replace(/@printer$/, ''), ...params })),
  });
}

/** G-code viewer for text (a local file) or a file on a printer. */
export function openGcode({ title, text = null, printerId = null, file = null }) {
  return openLayerView({
    title: title ?? `G-code: ${file ?? 'file'}`,
    subtitle: 'Moves read from the file: feature colors come from the slicer comments (;TYPE: / ; FEATURE:). Times ignore acceleration.',
    load: async (_p, say) => {
      let src = text;
      if (src === null) {
        say(`Downloading ${file} from the printer (read-only)...`);
        const res = await fetch(`/api/printers/${printerId}/gcode?file=${encodeURIComponent(file)}`);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        src = await res.text();
      }
      say(`Reading ${(src.length / 1048576).toFixed(1)} MB of G-code...`);
      await new Promise((r) => setTimeout(r, 30));
      const g = parseGcode(src);
      g.lineWidth = 0.45;
      g.layerHeight = g.meta.layerHeight;
      if (!g.layers.length) toast('No extruding moves found in this file', 'error');
      return g;
    },
  });
}

/** File picker for a local G-code file. */
export function pickGcodeFile() {
  const input = el('input', { type: 'file', accept: '.gcode,.g,.gco' });
  input.onchange = async () => { const f = input.files[0]; if (f) openGcode({ title: `G-code: ${f.name}`, text: await f.text() }); };
  input.click();
}
