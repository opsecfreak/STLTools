// Stress Lab page (#lab): see how and where a printed part could fail before printing it.
//
// One 3D view, five modes:
//   Stress test   click the part to add anchors and loads (force, torque, pressure, g-load),
//                 solve (voxel FEA in a Web Worker), color by safety factor / stress /
//                 across-layer stress / displacement, deformed shape, worst spots, load ramp,
//                 cut plane, probe, material comparison
//   Weak points   thin walls, overhangs, support columns and volume, narrowest layer, islands
//   Wind tunnel   wing: section panel method (Cp, streamlines), polar, 3D pressure colors,
//                 flow particles, lift and drag arrows, "apply lift to the stress test";
//                 body: drag from frontal area and a reference Cd
//   Environment   heat (HDT), sunlight time-lapse (user's UV rate), rain pooling, water
//                 uptake, fatigue (user's S-N data), drop impact as a g-load
//   Materials     datasheet library with sources, your own materials, physics settings
// Engines: src/core/lab/*.js (served at /shared/lab/), the same code the Node tests run.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { el, api, store, toast } from './lib.js';
import { webglAvailable } from './viewer.js';

let ctx = null; // { currentParts(): [{ name, url }] | null, openGenerator(id) }
export function initLab(context) { ctx = context; }

let lab = null; // live page state, disposed by stopLab()
export function stopLab() {
  if (!lab) return;
  lab.alive = false;
  lab.worker?.terminate();
  cancelAnimationFrame(lab.raf);
  lab.ro?.disconnect();
  lab.renderer?.dispose();
  lab.renderer?.forceContextLoss?.();
  lab = null;
}

const MODES = [['stress', 'Stress test'], ['weak', 'Weak points & supports'], ['wind', 'Wind tunnel'], ['env', 'Environment'], ['materials', 'Materials & physics']];
const RES = [['3000', 'Draft (3k cells)'], ['8000', 'Normal (8k)'], ['16000', 'Fine (16k)'], ['30000', 'Very fine (30k, slow)']];
const AX = ['X', 'Y', 'Z'];
const PHYS_DEFAULT = { poisson: 0.35, infillExponent: 1, tol: 1e-6, maxIter: 3000, lineWidth: 0.45 };
const physics = () => ({ ...PHYS_DEFAULT, ...(store.get('labPhysics') ?? {}) });

// ---------------------------------------------------------------- colors

function ramp(t) {
  // blue -> cyan -> green -> yellow -> red
  const s = Math.min(1, Math.max(0, t));
  const stops = [[0.2, 0.3, 1], [0, 0.8, 1], [0.1, 0.8, 0.2], [1, 0.85, 0], [0.9, 0.1, 0.1]];
  const k = s * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(k)), f = k - i;
  return stops[i].map((a, j) => a + (stops[i + 1][j] - a) * f);
}
function sfColor(sf) {
  if (!Number.isFinite(sf)) return [0.25, 0.55, 0.95];
  if (sf < 1) return [0.85, 0.05, 0.05];
  if (sf < 1.5) return [1, 0.45, 0];
  if (sf < 2) return [1, 0.8, 0];
  if (sf < 3) return [0.55, 0.85, 0.2];
  return [0.15, 0.65, 0.3];
}

// ---------------------------------------------------------------- material helpers

function matStiffness(m) {
  const v = m.modulus?.xy ?? m.modulus?.any ?? m.flexModulus?.xy ?? m.flexModulus?.any;
  return { E: v ?? null, basis: m.modulus ? 'tensile modulus' : v ? 'flexural modulus (no tensile modulus on the datasheet)' : '' };
}
function matStrength(m) {
  const xy = m.tensile?.xy ?? m.tensile?.any ?? m.tensileYield?.xy ?? null;
  const z = m.tensile?.z ?? m.interlayerAdhesion ?? null;
  return { xy, z, zNote: z ? (m.tensile?.z ? 'datasheet Z tensile' : 'datasheet interlayer adhesion') : 'no Z value on the datasheet: X-Y used, real layer strength is LOWER' };
}

// ---------------------------------------------------------------- page

export async function renderLab(page, arg = '') {
  stopLab();
  const materials = await api('GET', '/api/materials');
  const library = await api('GET', '/api/library').catch(() => []);
  lab = { alive: true, materials, mode: store.get('labMode') ?? 'stress', groups: [], result: null, grid: null, pos: null };
  const L = lab;

  // ---- layout
  const side = el('div', { className: 'lab-side' });
  const view = el('div', { className: 'lab-view' });
  const legend = el('div', { className: 'lab-legend' });
  const tip = el('div', { className: 'lab-tip', hidden: true });
  const labels = el('div', { className: 'lab-labels' });
  const status = el('p', { className: 'muted lab-status', textContent: 'Pick a part to start.' });
  const modeBar = el('div', { className: 'subtabs lab-modes' }, ...MODES.map(([k, l]) => el('button', { type: 'button', className: `subtab ${L.mode === k ? 'active' : ''}`, dataset: { mode: k }, textContent: l, onclick: () => setMode(k) })));
  const srcSel = el('select', { 'aria-label': 'Part to test' },
    el('option', { value: 'designer', textContent: 'Part in the designer (last generated)' }),
    ...library.map((e) => el('option', { value: `stl:${e.id}`, textContent: `STL file: ${e.name}` })),
    el('option', { value: 'upload', textContent: 'Open an STL file from this computer...' }));
  const fileIn = el('input', { type: 'file', accept: '.stl', hidden: true });
  const resSel = el('select', { 'aria-label': 'Resolution' }, ...RES.map(([v, l]) => el('option', { value: v, textContent: l, selected: (store.get('labRes') ?? '8000') === v })));
  const axisSel = el('select', { 'aria-label': 'Build direction' }, ...AX.map((a, i) => el('option', { value: i, textContent: `Layers stack along ${a}${i === 2 ? ' (as printed)' : ''}`, selected: i === 2 })));
  const matSel = el('select', { 'aria-label': 'Material' }, ...materials.map((m) => el('option', { value: m.id, textContent: `${m.brand} ${m.product}${m.custom ? ' (yours)' : ''}`, selected: m.id === (store.get('labMaterial') ?? 'esun-pla-plus') })));
  const walls = el('input', { type: 'number', min: 1, max: 10, step: 1, value: store.get('labWalls') ?? 3, className: 'num' });
  const infill = el('input', { type: 'number', min: 0, max: 100, step: 5, value: store.get('labInfill') ?? 15, className: 'num' });
  const panel = el('div', { className: 'lab-panel' });

  page.replaceChildren(
    el('div', { className: 'page-head' }, el('h2', { textContent: 'Stress Lab' }),
      el('p', { className: 'muted', textContent: 'Find weak points before you print: load the part the way it is used, see stress, supports, airflow and the environment on the 3D model. Engineering estimates from voxel FEA and textbook aero models: use them to compare designs and find weak spots, then confirm with a test print.' })),
    modeBar,
    el('div', { className: 'lab-layout' },
      el('div', { className: 'lab-left' },
        el('div', { className: 'card' },
          el('label', { className: 'set-field' }, el('span', { textContent: 'Part' }), srcSel), fileIn,
          el('div', { className: 'row' }, el('label', {}, 'Detail ', resSel), el('button', { type: 'button', className: 'secondary small', textContent: 'Reload', onclick: () => loadSource() })),
          el('label', { className: 'set-field' }, el('span', { textContent: 'Material' }), matSel),
          el('div', { className: 'row' }, el('label', {}, 'Walls ', walls), el('label', {}, 'Infill % ', infill)),
          el('label', { className: 'set-field' }, el('span', { textContent: 'Print orientation' }), axisSel)),
        side, status),
      el('div', { className: 'lab-right' }, view, legend, labels, tip, panel)));

  // ---- 3D view
  if (!webglAvailable()) {
    view.append(el('p', { className: 'error', textContent: 'The Stress Lab needs WebGL (3D) in this browser. Results tables still work.' }));
  }
  const renderer = webglAvailable() ? new THREE.WebGLRenderer({ antialias: true }) : null;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(document.documentElement.dataset.theme === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches ? 0x15181d : 0xeef1f5);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50000);
  camera.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, -1.5, 2);
  scene.add(sun);
  const world = new THREE.Group();
  scene.add(world);
  let controls = null;
  if (renderer) {
    view.append(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    L.renderer = renderer;
    const resize = () => {
      const w = view.clientWidth || 600, h = view.clientHeight || 480;
      renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    L.ro = new ResizeObserver(resize);
    L.ro.observe(view);
    resize();
    const loop = () => {
      if (!L.alive) return;
      L.raf = requestAnimationFrame(loop);
      controls.update();
      L.onFrame?.();
      renderer.render(scene, camera);
      drawLabels();
    };
    loop();
  }

  // voxel instances
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const voxMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05 });
  let vox = null; // InstancedMesh
  let visible = []; // cell index per instance
  let partMesh = null;
  const overlay = new THREE.Group(); // arrows, markers, flow, supports
  world.add(overlay);
  const cut = { axis: 2, at: 1 }; // fraction 0..1 along axis (1 = no cut)
  let deform = 0; // exaggeration factor
  let colorOf = () => [0.7, 0.72, 0.75];
  let tintOf = null; // optional per-cell override (anchors, loads, selections)

  function frame(size) {
    const r = Math.max(...size) || 50;
    const dir = new THREE.Vector3(1, -1.4, 1).normalize();
    camera.position.copy(dir.multiplyScalar(r * 2.2));
    camera.position.z += size[2] / 2;
    camera.near = r / 100; camera.far = r * 100;
    camera.updateProjectionMatrix();
    controls?.target.set(0, 0, size[2] / 2);
  }

  const cellCenter = (i) => {
    const g = L.grid;
    const x = i % g.nx, y = Math.floor(i / g.nx) % g.ny, z = Math.floor(i / (g.nx * g.ny));
    return [g.origin[0] + (x + 0.5) * g.h - L.center[0], g.origin[1] + (y + 0.5) * g.h - L.center[1], g.origin[2] + (z + 0.5) * g.h - L.center[2]];
  };

  function rebuildVoxels() {
    if (!L.grid) return;
    const g = L.grid;
    const lim = [g.nx, g.ny, g.nz][cut.axis] * cut.at;
    visible = [];
    const solid = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < g.nx && y < g.ny && z < g.nz && g.solid[x + g.nx * (y + g.ny * z)] && [x, y, z][cut.axis] < lim;
    for (let z = 0; z < g.nz; z++) for (let y = 0; y < g.ny; y++) for (let x = 0; x < g.nx; x++) {
      if (!solid(x, y, z)) continue;
      if (!solid(x - 1, y, z) || !solid(x + 1, y, z) || !solid(x, y - 1, z) || !solid(x, y + 1, z) || !solid(x, y, z - 1) || !solid(x, y, z + 1)) visible.push(x + g.nx * (y + g.ny * z));
    }
    if (vox) { world.remove(vox); vox.dispose(); }
    vox = new THREE.InstancedMesh(boxGeo, voxMat, Math.max(1, visible.length));
    vox.count = visible.length;
    world.add(vox);
    paint();
  }

  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  function paint() {
    if (!vox || !L.grid) return;
    const s = L.grid.h * 0.96;
    const d = L.result?.disp;
    const k = deform * (L.deformScale ?? 0);
    visible.forEach((cell, n) => {
      const c = cellCenter(cell);
      if (d && k) { c[0] += d[cell * 3] * k; c[1] += d[cell * 3 + 1] * k; c[2] += d[cell * 3 + 2] * k; }
      m4.makeScale(s, s, s).setPosition(c[0], c[1], c[2]);
      vox.setMatrixAt(n, m4);
      const rgb = tintOf?.(cell) ?? colorOf(cell);
      col.setRGB(rgb[0], rgb[1], rgb[2]);
      vox.setColorAt(n, col);
    });
    vox.instanceMatrix.needsUpdate = true;
    if (vox.instanceColor) vox.instanceColor.needsUpdate = true;
  }
  L.paint = paint;

  // ---- loading the part
  async function loadSource() {
    status.textContent = 'Loading the part...';
    const v = srcSel.value;
    let buf;
    let name = '';
    try {
      if (v === 'designer') {
        const parts = ctx?.currentParts?.() ?? [];
        if (!parts.length) { status.textContent = 'No part in the designer yet: open a tab (Shop, Quadcopters...), pick a part, then come back. Or choose an STL file.'; return; }
        const p = parts[Number(arg) || 0] ?? parts[0];
        name = p.name;
        buf = await (await fetch(p.url)).arrayBuffer();
      } else if (v.startsWith('stl:')) {
        const id = v.slice(4);
        name = library.find((e) => e.id === id)?.name ?? id;
        buf = await (await fetch(`/api/library/${id}.stl`)).arrayBuffer();
      } else return;
    } catch (err) { status.textContent = `Could not load the part: ${err.message}`; return; }
    useStl(buf, name);
  }
  fileIn.onchange = async () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) useStl(await f.arrayBuffer(), f.name); };
  srcSel.onchange = () => (srcSel.value === 'upload' ? fileIn.click() : loadSource());
  resSel.onchange = () => { store.set('labRes', resSel.value); if (L.pos) useStl(null, L.name); };

  async function useStl(buf, name) {
    const { voxelize, meshBounds } = await import('/shared/lab/voxel.js');
    if (buf) {
      const geo = new STLLoader().parse(buf);
      L.pos = geo.attributes.position.array;
      L.name = name;
    }
    const b = meshBounds(L.pos);
    L.center = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
    L.bounds = b;
    L.grid = voxelize(L.pos, { target: Number(resSel.value) });
    L.result = null; L.groups = []; L.weak = null; L.wind = null; L.pools = null;
    // context mesh
    if (partMesh) { world.remove(partMesh); partMesh.geometry.dispose(); }
    const geo = new THREE.BufferGeometry();
    const shifted = new Float32Array(L.pos.length);
    for (let i = 0; i < L.pos.length; i += 3) { shifted[i] = L.pos[i] - L.center[0]; shifted[i + 1] = L.pos[i + 1] - L.center[1]; shifted[i + 2] = L.pos[i + 2] - L.center[2]; }
    geo.setAttribute('position', new THREE.BufferAttribute(shifted, 3));
    geo.computeVertexNormals();
    partMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8899aa, transparent: true, opacity: 0.12, depthWrite: false }));
    world.add(partMesh);
    overlay.clear();
    frame(b.size);
    const { depthMap } = await import('/shared/lab/voxel.js');
    L.depth = depthMap(L.grid);
    colorOf = () => [0.72, 0.74, 0.78];
    tintOf = groupTint;
    rebuildVoxels();
    status.textContent = `${name}: ${b.size.map((x) => x.toFixed(1)).join(' x ')} mm, ${L.grid.count.toLocaleString()} cells of ${L.grid.h.toFixed(2)} mm.${L.grid.openWarning ? ` Note: ${L.grid.openWarning}.` : ''}`;
    drawMode();
  }

  // ---- picking
  const ray = new THREE.Raycaster();
  let pickMode = null; // 'anchor' | 'force' | 'pressure' | 'torque'
  const pickAt = (ev) => {
    if (!vox || !renderer) return null;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObject(vox)[0];
    return hit ? { cell: visible[hit.instanceId], point: hit.point, normal: hit.face?.normal } : null;
  };
  if (renderer) {
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return; // a drag rotates the view
      const h = pickAt(e);
      if (!h) return;
      if (pickMode) addGroupAt(h);
      else probe(h, e);
    });
    renderer.domElement.addEventListener('pointermove', (e) => { if (!pickMode && L.result) { const h = pickAt(e); if (h) probe(h, e); else tip.hidden = true; } });
    renderer.domElement.addEventListener('pointerleave', () => { tip.hidden = true; });
  }

  function cellsNear(cell, radius) {
    const g = L.grid;
    const c0 = cellCenter(cell);
    const out = [];
    const rCells = Math.ceil(radius / g.h);
    const x0 = cell % g.nx, y0 = Math.floor(cell / g.nx) % g.ny, z0 = Math.floor(cell / (g.nx * g.ny));
    for (let z = z0 - rCells; z <= z0 + rCells; z++) for (let y = y0 - rCells; y <= y0 + rCells; y++) for (let x = x0 - rCells; x <= x0 + rCells; x++) {
      if (x < 0 || y < 0 || z < 0 || x >= g.nx || y >= g.ny || z >= g.nz) continue;
      const i = x + g.nx * (y + g.ny * z);
      if (!g.solid[i] || L.depth[i] > 2) continue; // surface skin only
      const c = cellCenter(i);
      if (Math.hypot(c[0] - c0[0], c[1] - c0[1], c[2] - c0[2]) <= radius) out.push(i);
    }
    return out;
  }

  const GROUP_COLORS = { anchor: [0.15, 0.35, 0.95], force: [0.95, 0.15, 0.15], pressure: [0.95, 0.4, 0.75], torque: [0.6, 0.2, 0.9] };
  function groupTint(cell) {
    for (const gr of L.groups) if (gr.set.has(cell)) return GROUP_COLORS[gr.type];
    return null;
  }

  function addGroupAt(h) {
    const radius = Number(brush.value) || L.grid.h * 2;
    const cells = cellsNear(h.cell, radius);
    const n = h.normal ? [h.normal.x, h.normal.y, h.normal.z] : [0, 0, 1];
    const gr = { id: Math.random().toString(36).slice(2, 7), type: pickMode, cells, set: new Set(cells), at: [h.point.x, h.point.y, h.point.z], normal: n,
      magnitude: pickMode === 'torque' ? 1000 : pickMode === 'pressure' ? 0.1 : 20, dir: pickMode === 'force' ? 'into' : 'into', axis: 2 };
    L.groups.push(gr);
    L.result = null;
    pickMode = null;
    drawMode();
    paint();
  }

  function probe(h, ev) {
    const i = h.cell;
    const r = L.result;
    const lines = [`Cell ${i}${L.depth ? `, ${L.depth[i] * L.grid.h <= shellDepth() ? 'wall' : 'infill'}` : ''}`];
    if (r) {
      lines.push(`Safety factor ${Number.isFinite(r.sf[i]) ? r.sf[i].toFixed(2) : 'n/a'}`, `Von Mises ${r.vm[i].toFixed(2)} MPa`, `Across layers ${r.across[i].toFixed(2)} MPa`, `Moves ${Math.hypot(r.disp[i * 3], r.disp[i * 3 + 1], r.disp[i * 3 + 2]).toFixed(3)} mm`);
    }
    if (L.windCp?.has(i)) lines.push(`Cp ${L.windCp.get(i).toFixed(2)}`);
    tip.replaceChildren(...lines.map((t) => el('div', { textContent: t })));
    const rr = view.getBoundingClientRect();
    tip.style.left = `${ev.clientX - rr.left + 14}px`;
    tip.style.top = `${ev.clientY - rr.top + 14}px`;
    tip.hidden = false;
  }

  // labels that follow 3D points (worst spots, load arrows)
  function drawLabels() {
    if (!L.labels?.length || !renderer) { labels.replaceChildren(); return; }
    const r = renderer.domElement;
    labels.replaceChildren(...L.labels.map(({ p, text, cls }) => {
      const v = new THREE.Vector3(...p).project(camera);
      if (v.z > 1) return el('span');
      return el('span', { className: `lab-label ${cls ?? ''}`, textContent: text, style: `left:${((v.x + 1) / 2) * r.clientWidth}px;top:${((1 - v.y) / 2) * r.clientHeight}px` });
    }));
  }

  const brush = el('input', { type: 'number', min: 0.5, max: 200, step: 0.5, value: store.get('labBrush') ?? 4, className: 'num', title: 'Radius of the area a click selects (mm)' });
  brush.onchange = () => store.set('labBrush', brush.value);
  const shellDepth = () => Number(walls.value) * physics().lineWidth;
  for (const x of [walls, infill]) x.onchange = () => { store.set('labWalls', walls.value); store.set('labInfill', infill.value); L.result = null; drawMode(); };
  matSel.onchange = () => { store.set('labMaterial', matSel.value); if (L.result) showStress(); drawMode(); };
  axisSel.onchange = () => { L.result = null; L.weak = null; drawMode(); };

  // ---------------------------------------------------------------- modes

  function setMode(k) {
    L.mode = k;
    store.set('labMode', k);
    for (const b of modeBar.children) b.classList.toggle('active', b.dataset.mode === k);
    drawMode();
  }

  function drawMode() {
    overlay.clear();
    L.labels = [];
    L.onFrame = null;
    L.windCp = null;
    legend.replaceChildren();
    panel.replaceChildren();
    if (L.mode === 'materials') { side.replaceChildren(); return materialsMode(); }
    if (!L.grid) { side.replaceChildren(el('p', { className: 'muted', textContent: 'Choose a part above.' })); return; }
    if (L.mode === 'stress') stressMode();
    else if (L.mode === 'weak') weakMode();
    else if (L.mode === 'wind') windMode();
    else if (L.mode === 'env') envMode();
  }

  // ---------------------------------------------------------------- stress test

  function arrow(from, dir, len, color) {
    const d = new THREE.Vector3(...dir).normalize();
    const a = new THREE.ArrowHelper(d, new THREE.Vector3(...from).addScaledVector(d, -len), len, color, len * 0.3, len * 0.18);
    overlay.add(a);
    return a;
  }

  function groupForce(gr) {
    // force vector (N) for force / pressure groups
    const n = gr.normal;
    const base = gr.dir === 'into' ? n.map((v) => -v) : gr.dir === 'out' ? n : { '-z': [0, 0, -1], '+z': [0, 0, 1], '-x': [-1, 0, 0], '+x': [1, 0, 0], '-y': [0, -1, 0], '+y': [0, 1, 0] }[gr.dir] ?? [0, 0, -1];
    const len = Math.hypot(...base) || 1;
    const total = gr.type === 'pressure' ? gr.magnitude * gr.cells.length * L.grid.h ** 2 : gr.magnitude;
    return base.map((v) => (v / len) * total);
  }

  function solverLoads() {
    const loads = [];
    const anchors = L.groups.filter((g) => g.type === 'anchor');
    const aCenter = anchors.length ? mean(anchors.flatMap((g) => g.cells.map(cellCenter))) : [0, 0, 0];
    for (const gr of L.groups) {
      if (gr.type === 'force' || gr.type === 'pressure') loads.push({ cells: gr.cells, force: groupForce(gr) });
      if (gr.type === 'torque') {
        // torque (N mm) about an axis through the anchors' center: tangential forces on the cells
        const ax = [0, 0, 0]; ax[gr.axis] = 1;
        const rs = gr.cells.map((c) => { const p = cellCenter(c).map((v, k) => v - aCenter[k]); p[gr.axis] = 0; return p; });
        const sum = rs.reduce((s, r) => s + r[0] ** 2 + r[1] ** 2 + r[2] ** 2, 0) || 1;
        gr.cells.forEach((c, k) => {
          const r = rs[k];
          const t = [ax[1] * r[2] - ax[2] * r[1], ax[2] * r[0] - ax[0] * r[2], ax[0] * r[1] - ax[1] * r[0]];
          loads.push({ cells: [c], force: t.map((v) => (v * gr.magnitude) / sum) });
        });
      }
    }
    return loads;
  }

  function mean(pts) { const s = [0, 0, 0]; for (const p of pts) for (let k = 0; k < 3; k++) s[k] += p[k] / pts.length; return s; }

  function presetBottomAnchor() {
    const g = L.grid, axis = Number(axisSel.value), cells = [];
    const first = (() => { for (let k = 0; k < [g.nx, g.ny, g.nz][axis]; k++) for (let i = 0; i < g.solid.length; i++) if (g.solid[i] && [i % g.nx, Math.floor(i / g.nx) % g.ny, Math.floor(i / (g.nx * g.ny))][axis] === k) return k; return 0; })();
    for (let i = 0; i < g.solid.length; i++) if (g.solid[i] && [i % g.nx, Math.floor(i / g.nx) % g.ny, Math.floor(i / (g.nx * g.ny))][axis] === first) cells.push(i);
    L.groups.push({ id: 'base', type: 'anchor', cells, set: new Set(cells), at: mean(cells.map(cellCenter)), normal: [0, 0, -1] });
  }

  function presetFarEnd(type, magnitude, dir) {
    // load the cells farthest from the anchors (a hook tip, a bracket end, a horn arm)
    const anchors = L.groups.filter((g) => g.type === 'anchor');
    if (!anchors.length) presetBottomAnchor();
    const a = mean(L.groups.filter((g) => g.type === 'anchor').flatMap((g) => g.cells.map(cellCenter)));
    let best = -1, far = 0;
    for (let i = 0; i < L.grid.solid.length; i++) if (L.grid.solid[i] && L.depth[i] === 1) { const c = cellCenter(i); const d = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]); if (d > far) { far = d; best = i; } }
    if (best < 0) return;
    const cells = cellsNear(best, Math.max(L.grid.h * 2.5, far * 0.08));
    L.groups.push({ id: 'tip', type, cells, set: new Set(cells), at: cellCenter(best), normal: [0, 0, 1], magnitude, dir, axis: 2 });
    return far;
  }

  function stressMode() {
    tintOf = L.result && !showGroups.checked ? null : groupTint;
    const list = el('div', { className: 'lab-groups' });
    const drawGroups = () => {
      list.replaceChildren(...(L.groups.length ? L.groups.map((gr) => {
        const mag = el('input', { type: 'number', step: 'any', value: gr.magnitude ?? '', className: 'num', title: gr.type === 'pressure' ? 'MPa (N/mm2)' : gr.type === 'torque' ? 'N mm' : 'N' });
        mag.onchange = () => { gr.magnitude = Number(mag.value); L.result = null; };
        const dir = el('select', {}, ...[['into', 'Into the surface'], ['out', 'Out of the surface'], ['-z', 'Down (-Z)'], ['+z', 'Up (+Z)'], ['-x', '-X'], ['+x', '+X'], ['-y', '-Y'], ['+y', '+Y']].map(([v, l]) => el('option', { value: v, textContent: l, selected: gr.dir === v })));
        dir.onchange = () => { gr.dir = dir.value; L.result = null; drawMode(); };
        const axis = el('select', {}, ...AX.map((a, i) => el('option', { value: i, textContent: `about ${a}`, selected: gr.axis === i })));
        axis.onchange = () => { gr.axis = Number(axis.value); L.result = null; };
        return el('div', { className: `lab-group g-${gr.type}` },
          el('strong', { textContent: { anchor: 'Anchor (held still)', force: 'Force', pressure: 'Pressure', torque: 'Torque' }[gr.type] }),
          el('span', { className: 'muted', textContent: ` ${gr.cells.length} cells` }),
          gr.type === 'anchor' ? null : el('div', { className: 'row' }, mag, el('span', { textContent: gr.type === 'pressure' ? 'MPa' : gr.type === 'torque' ? 'N mm' : 'N' }), gr.type === 'torque' ? axis : dir),
          el('button', { type: 'button', className: 'secondary small', textContent: 'Remove', onclick: () => { L.groups = L.groups.filter((x) => x !== gr); L.result = null; drawMode(); paint(); } }));
      }) : [el('p', { className: 'muted', textContent: 'No anchors or loads yet. Use a quick setup or click the part.' })]));
    };
    drawGroups();
    const pickBtn = (type, label) => el('button', { type: 'button', className: pickMode === type ? '' : 'secondary', textContent: label, onclick: () => { pickMode = pickMode === type ? null : type; status.textContent = pickMode ? `Click the part where the ${type} goes (brush ${brush.value} mm).` : ''; drawMode(); } });
    const gload = el('input', { type: 'number', step: 'any', value: L.gload ?? 0, className: 'num', title: 'Acceleration in g on the whole part (weight = 1, crash or drop: see Environment)' });
    gload.onchange = () => { L.gload = Number(gload.value); L.result = null; };
    const servoT = el('input', { type: 'number', step: 'any', placeholder: 'kg cm', className: 'num', title: "The servo's stall torque from its datasheet, in kg cm" });
    side.replaceChildren(
      el('div', { className: 'card' }, el('h4', { textContent: 'Anchors and loads' }),
        el('div', { className: 'row' }, pickBtn('anchor', '+ Anchor'), pickBtn('force', '+ Force'), pickBtn('pressure', '+ Pressure'), pickBtn('torque', '+ Torque')),
        el('label', {}, 'Click area radius (mm) ', brush),
        list,
        el('label', {}, 'Whole-part acceleration (g) ', gload),
        el('details', { open: Boolean(L.presetsOpen), ontoggle: (e) => { L.presetsOpen = e.target.open; } }, el('summary', { textContent: 'Quick setups' }),
          el('div', { className: 'lab-presets' },
            el('button', { type: 'button', className: 'secondary small', textContent: 'Hold the bottom (plate side)', onclick: () => { presetBottomAnchor(); L.result = null; drawMode(); paint(); } }),
            el('button', { type: 'button', className: 'secondary small', textContent: 'Hook / bracket: 50 N down at the far end', onclick: () => { presetFarEnd('force', 50, '-z'); L.result = null; drawMode(); paint(); } }),
            el('div', { className: 'row' }, el('span', { textContent: 'Servo horn: stall torque ' }), servoT, el('button', { type: 'button', className: 'secondary small', textContent: 'Apply at the arm tip', onclick: () => {
              const t = Number(servoT.value);
              if (!(t > 0)) { toast('Enter the servo stall torque (kg cm) from its datasheet', 'error'); return; }
              // horn hub = anchor picked by the user, or the part center
              if (!L.groups.some((g) => g.type === 'anchor')) { const c = nearestCellTo([0, 0, L.bounds.size[2] / 2]); const cells = cellsNear(c, L.grid.h * 3); L.groups.push({ id: 'hub', type: 'anchor', cells, set: new Set(cells), at: cellCenter(c), normal: [0, 0, 1] }); }
              const arm = presetFarEnd('force', 0, 'out');
              const gr = L.groups.at(-1);
              const tNmm = t * 98.0665; // 1 kg cm = 98.0665 N mm
              gr.magnitude = arm ? tNmm / arm : 0;
              gr.dir = '+y';
              toast(`${t} kg cm = ${tNmm.toFixed(0)} N mm; ${gr.magnitude.toFixed(1)} N at ${arm.toFixed(1)} mm. Check the force direction (sideways to the arm).`, 'ok', 7000);
              L.result = null; drawMode(); paint();
            } })),
            el('p', { className: 'muted', textContent: 'For wings: Wind tunnel > Apply lift to the stress test. For drops and crashes: Environment > Drop impact.' }))),
        el('label', { className: 'check-inline' }, showGroups, ' Show anchors and loads on the result')),
      el('div', { className: 'row' }, el('button', { type: 'button', textContent: L.result ? 'Solve again' : 'Solve', onclick: runSolve }),
        el('button', { type: 'button', className: 'secondary', textContent: 'Clear all', onclick: () => { L.groups = []; L.result = null; L.gload = 0; drawMode(); paint(); } })));
    // arrows for loads
    for (const gr of L.groups) {
      const c = mean(gr.cells.map(cellCenter));
      const len = Math.max(...L.bounds.size) * 0.18;
      if (gr.type === 'force' || gr.type === 'pressure') arrow(c, groupForce(gr), len, 0xdd2222);
      if (gr.type === 'anchor') L.labels.push({ p: c, text: 'anchor', cls: 'anchor' });
      if (gr.type === 'torque') L.labels.push({ p: c, text: `torque ${gr.magnitude} N mm about ${AX[gr.axis]}`, cls: 'load' });
      if (gr.type !== 'anchor' && gr.type !== 'torque') L.labels.push({ p: c, text: `${gr.type === 'pressure' ? `${gr.magnitude} MPa` : `${gr.magnitude} N`}`, cls: 'load' });
    }
    if (L.result) showStress();
    else { colorOf = () => [0.72, 0.74, 0.78]; legend.replaceChildren(el('span', { className: 'muted', textContent: pickMode ? `Placing: ${pickMode}` : 'Blue = anchor, red = force, pink = pressure, purple = torque' })); paint(); }
  }
  const showGroups = el('input', { type: 'checkbox', checked: false, onchange: () => { tintOf = showGroups.checked ? groupTint : null; paint(); } });

  function nearestCellTo(p) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < L.grid.solid.length; i++) if (L.grid.solid[i]) { const c = cellCenter(i); const d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]); if (d < bd) { bd = d; best = i; } }
    return best;
  }

  function cellFactors(m) {
    const g = L.grid, ph = physics();
    const fill = Math.max(0.02, Number(infill.value) / 100);
    const k = fill ** ph.infillExponent;
    const shell = shellDepth();
    const factor = new Float32Array(g.solid.length);
    const fillArr = new Float32Array(g.solid.length);
    for (let i = 0; i < g.solid.length; i++) {
      if (!g.solid[i]) continue;
      const inWall = (L.depth[i] - 0.5) * g.h < shell;
      factor[i] = inWall ? 1 : k;
      fillArr[i] = inWall ? 1 : fill;
    }
    return { factor, fillArr };
  }

  function runSolve() {
    const m = materials.find((x) => x.id === matSel.value);
    const st = matStiffness(m), str = matStrength(m);
    if (!st.E || !str.xy) { toast(`${m.product}: the datasheet has no stiffness or strength value. Pick another material or add the values in Materials.`, 'error', 8000); return; }
    if (!L.groups.some((g) => g.type === 'anchor')) { toast('Add at least one anchor (where the part is held).', 'error'); return; }
    if (!L.groups.some((g) => g.type !== 'anchor') && !L.gload) { toast('Add a load (force, pressure, torque) or a whole-part acceleration.', 'error'); return; }
    const ph = physics();
    const g = L.grid;
    const { factor, fillArr } = cellFactors(m);
    const E = new Float32Array(g.solid.length);
    for (let i = 0; i < E.length; i++) if (g.solid[i]) E[i] = st.E * factor[i];
    const fixed = L.groups.filter((x) => x.type === 'anchor').flatMap((x) => x.cells);
    const body = L.gload ? { accel: [0, 0, -9.80665 * L.gload], density: m.density ?? 1.24, fill: fillArr } : null;
    if (body && !m.density) toast('No density on this datasheet: 1.24 g/cm3 (PLA) used for the weight.', 'info', 6000);
    L.worker?.terminate();
    L.worker = new Worker('/lab-worker.js', { type: 'module' });
    status.textContent = 'Solving...';
    const grid = { nx: g.nx, ny: g.ny, nz: g.nz, h: g.h, origin: g.origin, solid: g.solid };
    L.worker.onmessage = (e) => {
      if (e.data.progress) { status.textContent = `Solving: step ${e.data.progress.iter}, error ${e.data.progress.residual.toExponential(1)}`; return; }
      if (e.data.error) { status.textContent = `Solver error: ${e.data.error}`; return; }
      L.result = { ...e.data.result, material: m, E: st, strength: str, factor };
      status.textContent = `Solved in ${(L.result.ms / 1000).toFixed(1)} s, ${L.result.iterations} steps, ${L.result.dofs.toLocaleString()} unknowns${L.result.converged ? '' : ' (did not fully converge: check the anchors hold the part)'}.`;
      L.deformScale = L.result.maxDisp > 0 ? (Math.max(...L.bounds.size) * 0.08) / L.result.maxDisp : 0;
      drawMode();
    };
    L.worker.postMessage({ grid, E, nu: ph.poisson, fixed, loads: solverLoads(), body, tol: ph.tol, maxIter: ph.maxIter, fail: { strengthXY: str.xy, strengthZ: str.z, axis: Number(axisSel.value), factor } });
  }

  function showStress() {
    const r = L.result;
    const g = L.grid;
    const view = store.get('labView') ?? 'sf';
    const cells = []; for (let i = 0; i < g.solid.length; i++) if (g.solid[i]) cells.push(i);
    const max = (arr) => cells.reduce((m, i) => Math.max(m, Math.abs(arr[i])), 0) || 1;
    const vmMax = max(r.vm), accMax = max(r.across);
    const dMag = (i) => Math.hypot(r.disp[i * 3], r.disp[i * 3 + 1], r.disp[i * 3 + 2]);
    let t = L.ramp ?? 1;
    if (view === 'sf') colorOf = (i) => sfColor(r.sf[i] / t);
    else if (view === 'vm') colorOf = (i) => ramp((r.vm[i] * t) / vmMax);
    else if (view === 'across') colorOf = (i) => (r.across[i] > 0 ? ramp(0.5 + (0.5 * r.across[i] * t) / accMax) : ramp(0.5 + (0.5 * r.across[i] * t) / accMax));
    else if (view === 'disp') colorOf = (i) => ramp(dMag(i) / (r.maxDisp || 1));
    else if (view === 'infill') colorOf = (i) => (r.factor[i] === 1 ? [0.85, 0.55, 0.2] : [0.6, 0.75, 0.95]);
    paint();
    // worst spots
    const order = cells.filter((i) => Number.isFinite(r.sf[i])).sort((a, b) => r.sf[a] - r.sf[b]);
    const spots = [];
    for (const i of order) {
      const c = cellCenter(i);
      if (spots.some((s) => Math.hypot(s.c[0] - c[0], s.c[1] - c[1], s.c[2] - c[2]) < g.h * 4)) continue;
      const s = r.stress.subarray(i * 6, i * 6 + 6);
      const why = r.across[i] / ((r.strength.z ?? r.strength.xy) * r.factor[i]) >= r.vm[i] / (r.strength.xy * r.factor[i]) ? 'layers pull apart' : 'material overstressed';
      spots.push({ i, c, sf: r.sf[i], why, s });
      if (spots.length >= 5) break;
    }
    const minSf = spots[0]?.sf ?? Infinity;
    for (const [k, s] of spots.entries()) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(g.h * 1.4, 16, 12), new THREE.MeshBasicMaterial({ color: s.sf < 1 ? 0xff0000 : 0xffaa00, wireframe: true }));
      m.position.set(...s.c);
      overlay.add(m);
      L.labels.push({ p: s.c, text: `${k + 1}: SF ${s.sf.toFixed(2)} (${s.why})`, cls: s.sf < 1 ? 'bad' : 'warn' });
    }
    // legend + views
    const viewSel = el('select', {}, ...[['sf', 'Safety factor'], ['vm', 'Stress (von Mises)'], ['across', 'Stress across layers'], ['disp', 'Displacement'], ['infill', 'Walls vs infill']].map(([v, l]) => el('option', { value: v, textContent: l, selected: view === v })));
    viewSel.onchange = () => { store.set('labView', viewSel.value); drawMode(); };
    const def = el('input', { type: 'range', min: 0, max: 3, step: 0.1, value: deform, title: 'Show the shape bent (exaggerated)' });
    def.oninput = () => { deform = Number(def.value); paint(); };
    const cutAx = el('select', {}, ...AX.map((a, i) => el('option', { value: i, textContent: `Cut ${a}`, selected: cut.axis === i })));
    const cutAt = el('input', { type: 'range', min: 0.05, max: 1, step: 0.01, value: cut.at });
    cutAx.onchange = () => { cut.axis = Number(cutAx.value); rebuildVoxels(); };
    cutAt.oninput = () => { cut.at = Number(cutAt.value); rebuildVoxels(); };
    const rampBtn = el('button', { type: 'button', className: 'secondary small', textContent: 'Animate the load 0 to 200 %', onclick: () => {
      let k = 0;
      L.onFrame = () => { k += 0.008; L.ramp = Math.min(2, k); showStressColors(); if (k >= 2) { L.onFrame = null; L.ramp = 1; showStressColors(); } };
    } });
    const showStressColors = () => { t = L.ramp ?? 1; paint(); rampLabel.textContent = `Load ${(t * 100).toFixed(0)} %`; };
    const rampLabel = el('span', { className: 'muted', textContent: 'Load 100 %' });
    legend.replaceChildren(
      el('div', { className: 'row' }, viewSel, el('label', {}, 'Bend ', def), cutAx, cutAt, rampBtn, rampLabel),
      view === 'sf' ? el('div', { className: 'lab-scale' }, ...[['< 1 fails', sfColor(0.5)], ['1-1.5', sfColor(1.2)], ['1.5-2', sfColor(1.7)], ['2-3', sfColor(2.5)], ['> 3', sfColor(4)]].map(([l, c]) => el('span', { textContent: l, style: `background:rgb(${c.map((v) => Math.round(v * 255)).join(',')})` })))
        : el('div', { className: 'lab-scale grad', textContent: view === 'disp' ? `0 to ${r.maxDisp.toFixed(3)} mm` : view === 'vm' ? `0 to ${vmMax.toFixed(1)} MPa` : view === 'across' ? `-${accMax.toFixed(1)} (pressed) to +${accMax.toFixed(1)} MPa (pulled apart)` : 'orange = walls, blue = infill' }));
    // results + material comparison (stress does not depend on E for one material, so this is instant)
    const rows = materials.map((m) => {
      const st = matStiffness(m), str = matStrength(m);
      if (!st.E || !str.xy) return null;
      let fiMax = 0;
      for (const i of cells) fiMax = Math.max(fiMax, r.vm[i] / (str.xy * r.factor[i]), Math.max(0, r.across[i]) / ((str.z ?? str.xy) * r.factor[i]));
      return { m, sf: fiMax ? 1 / fiMax : Infinity, defl: r.maxDisp * (r.E.E / st.E), zNote: !str.z };
    }).filter(Boolean).sort((a, b) => b.sf - a.sf);
    panel.replaceChildren(el('div', { className: 'card' },
      el('h4', { textContent: `Result: ${r.material.brand} ${r.material.product}` }),
      el('p', {}, el('strong', { textContent: minSf < 1 ? `Fails: safety factor ${minSf.toFixed(2)}.` : `Holds: lowest safety factor ${minSf.toFixed(2)}.` }),
        ` It would fail at about ${(minSf * 100).toFixed(0)} % of these loads. Largest movement ${r.maxDisp.toFixed(3)} mm. Stiffness: ${r.E.basis}. Layer strength: ${r.strength.zNote}.`),
      el('ol', {}, ...spots.map((s) => el('li', { textContent: `SF ${s.sf.toFixed(2)}: ${s.why}${r.factor[s.i] < 1 ? ' (in infill)' : ' (in a wall)'}` }))),
      el('details', {}, el('summary', { textContent: `Compare materials (${rows.length})` }),
        el('table', { className: 'est-table' }, el('thead', {}, el('tr', {}, ...['Material', 'Safety factor', 'Movement (mm)', ''].map((h) => el('th', { textContent: h })))),
          el('tbody', {}, ...rows.map((x) => el('tr', { className: x.sf < 1 ? 'misfit' : '' }, el('td', { textContent: `${x.m.brand} ${x.m.product}` }), el('td', { textContent: Number.isFinite(x.sf) ? x.sf.toFixed(2) : '-' }), el('td', { textContent: x.defl.toFixed(3) }), el('td', { className: 'muted', textContent: x.zNote ? 'no Z data' : '' })))))),
      el('p', { className: 'muted', textContent: 'Estimate: linear voxel FEA, walls and infill modeled as solid and scaled infill, layer strength from the datasheet. Real prints vary with temperature, moisture, layer time and seams: keep a safety factor of 2 or more for parts that carry people or payloads, and test-print.' })));
  }

  // ---------------------------------------------------------------- weak points & supports

  async function weakMode() {
    tintOf = null;
    const w = await import('/shared/lab/weak.js');
    const axis = Number(axisSel.value);
    const ph = physics();
    const minWall = el('input', { type: 'number', step: 0.1, min: 0.2, value: store.get('labMinWall') ?? (2 * ph.lineWidth).toFixed(2), className: 'num' });
    const angle = el('input', { type: 'number', step: 1, min: 10, max: 89, value: store.get('labAngle') ?? 45, className: 'num' });
    const show = store.get('labWeakShow') ?? { thin: true, overhang: true, support: true, neck: true };
    const toggles = Object.entries({ thin: 'Thin walls', overhang: 'Overhangs', support: 'Support columns', neck: 'Narrowest layer' }).map(([k, l]) => el('label', { className: 'check-inline' }, el('input', { type: 'checkbox', checked: show[k], onchange: (e) => { show[k] = e.target.checked; store.set('labWeakShow', show); drawMode(); } }), ` ${l}`));
    const run = () => { store.set('labMinWall', minWall.value); store.set('labAngle', angle.value); drawMode(); };
    minWall.onchange = run; angle.onchange = run;
    const thin = new Set(w.thinWalls(L.grid, L.depth, Number(minWall.value)));
    const sup = w.supports(L.grid, axis);
    const cs = w.crossSections(L.grid, axis);
    const isl = w.islands(L.grid, axis);
    const ov = w.overhangs(L.pos, axis, Number(angle.value));
    const neckLayer = cs.narrowest?.layer ?? -1;
    const overSet = new Set(sup.over);
    colorOf = (i) => {
      const g = L.grid;
      const c = [i % g.nx, Math.floor(i / g.nx) % g.ny, Math.floor(i / (g.nx * g.ny))];
      if (show.thin && thin.has(i)) return [0.6, 0.2, 0.85];
      if (show.neck && c[axis] === neckLayer) return [0.9, 0.15, 0.15];
      if (show.support && overSet.has(i)) return [0.1, 0.55, 0.95];
      return [0.75, 0.77, 0.8];
    };
    paint();
    // support columns as translucent boxes, overhang triangles in orange
    if (show.support && sup.columns.length) {
      const g = L.grid;
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x3399ff, transparent: true, opacity: 0.25, depthWrite: false }), sup.columns.length);
      sup.columns.forEach((col, k) => {
        const c = cellCenter(col.cell);
        const s = [g.h * 0.8, g.h * 0.8, g.h * 0.8];
        s[axis] = col.height;
        c[axis] -= g.h / 2 + col.height / 2;
        mesh.setMatrixAt(k, new THREE.Matrix4().makeScale(...s).setPosition(...c));
      });
      overlay.add(mesh);
    }
    if (show.overhang && ov.tris.length) {
      const arr = new Float32Array(ov.tris.length * 9);
      ov.tris.forEach((t, k) => { for (let j = 0; j < 9; j++) arr[k * 9 + j] = L.pos[t * 9 + j] - L.center[j % 3]; });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      overlay.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff8800, side: THREE.DoubleSide, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 })));
    }
    legend.replaceChildren(el('div', { className: 'lab-scale' }, ...[['thin wall', [0.6, 0.2, 0.85]], ['overhang', [1, 0.53, 0]], ['printed over air', [0.1, 0.55, 0.95]], ['narrowest layer', [0.9, 0.15, 0.15]]].map(([l, c]) => el('span', { textContent: l, style: `background:rgb(${c.map((v) => Math.round(v * 255)).join(',')})` }))));
    const lines = [
      `Thin walls under ${minWall.value} mm: ${thin.size} cells${thin.size ? ' (purple). Thicken them or expect them to be fragile and print poorly.' : '.'}`,
      `Overhangs steeper than ${angle.value} deg from vertical: ${ov.areaMm2.toFixed(0)} mm2 (orange).`,
      `Printed over air: ${sup.over.length} cells; support volume about ${(sup.volumeMm3 / 1000).toFixed(1)} cm3 (${sup.columns.filter((c) => c.toPlate).length} columns to the plate, ${sup.columns.filter((c) => !c.toPlate).length} on the part).`,
      cs.narrowest ? `Narrowest layer at ${cs.narrowest.heightMm.toFixed(1)} mm: ${cs.narrowest.areaMm2.toFixed(0)} mm2, ${(cs.narrowest.ratioToLargest * 100).toFixed(0)} % of the largest layer (red). A sharp narrowing across layers is a typical snap point.` : 'Single-layer part: no narrowing.',
      isl.length ? `New regions start in mid-air at ${isl.slice(0, 6).map((x) => `${x.heightMm.toFixed(1)} mm`).join(', ')}${isl.length > 6 ? '...' : ''}: they need support or a different orientation.` : 'No region starts in mid-air.',
    ];
    side.replaceChildren(el('div', { className: 'card' }, el('h4', { textContent: 'Checks' }),
      el('label', {}, 'Thinnest wall allowed (mm) ', minWall),
      el('label', {}, 'Overhang limit (deg from vertical) ', angle),
      ...toggles,
      el('p', { className: 'muted', textContent: 'Change the print orientation above to compare supports and layer directions.' })));
    panel.replaceChildren(el('div', { className: 'card' }, el('h4', { textContent: `Weak points and supports (layers along ${AX[axis]})` }), el('ul', {}, ...lines.map((t) => el('li', { textContent: t })))));
  }

  // ---------------------------------------------------------------- wind tunnel

  async function windMode() {
    tintOf = null;
    const aero = await import('/shared/lab/aero.js');
    const s = { flow: 0, lift: 2, auto: true, speed: 15, altitude: 0, tempC: '', alpha: 4, e: 0.9, clMax: '', spanAt: 50, kind: 'wing', body: 'cube', cd: '', fullSpan: '', ...(store.get('labWind') ?? {}) };
    if (s.auto && s.kind === 'wing') {
      // span = longest side, lift = thinnest side, flow = the chord in between
      const order = [0, 1, 2].sort((a, c) => L.bounds.size[a] - L.bounds.size[c]);
      s.lift = order[0]; s.flow = order[1];
    }
    const save = () => store.set('labWind', s);
    const inp = (k, attrs = {}) => { const i = el('input', { type: 'number', step: 'any', value: s[k], className: 'num', ...attrs }); i.onchange = () => { s[k] = i.value === '' ? '' : Number(i.value); save(); drawMode(); }; return i; };
    const sel = (k, opts) => { const x = el('select', {}, ...opts.map(([v, l]) => el('option', { value: v, textContent: l, selected: String(s[k]) === String(v) }))); x.onchange = () => { s[k] = /^\d+$/.test(x.value) ? Number(x.value) : x.value; if (k === 'flow' || k === 'lift') s.auto = false; save(); drawMode(); }; return x; };
    const spanAxis = [0, 1, 2].find((a) => a !== s.flow && a !== s.lift) ?? 1;
    const kindSel = sel('kind', [['wing', 'Wing or blade (makes lift)'], ['body', 'Body (drag only)']]);
    side.replaceChildren(el('div', { className: 'card' }, el('h4', { textContent: 'Wind tunnel' }),
      kindSel,
      el('div', { className: 'row' }, el('label', {}, 'Air flows along ', sel('flow', AX.map((a, i) => [i, `${a}`]))), el('label', {}, 'lift is ', sel('lift', AX.map((a, i) => [i, `+${a}`]))),
        el('button', { type: 'button', className: 'secondary small', textContent: s.auto ? 'Axes: auto' : 'Auto axes', title: 'Span = longest side, lift = thinnest side', onclick: () => { s.auto = true; save(); drawMode(); } })),
      el('label', {}, 'Speed (m/s) ', inp('speed', { min: 0 })), el('span', { className: 'muted', textContent: ` = ${(s.speed * 3.6).toFixed(0)} km/h, ${(s.speed * 2.23694).toFixed(0)} mph` }),
      el('div', { className: 'row' }, el('label', {}, 'Altitude (m) ', inp('altitude')), el('label', {}, 'Air temp (C, blank = standard) ', inp('tempC'))),
      s.kind === 'wing' ? el('div', {},
        el('label', {}, 'Angle of attack (deg) ', inp('alpha', { min: -15, max: 20 })),
        el('label', {}, 'Section at span (%) ', inp('spanAt', { min: 2, max: 98 })),
        el('label', { title: 'This part may be one printed section: enter the span of the whole wing (tip to tip) to get the real aspect ratio, lift and drag. Blank = this part is the whole wing.' }, 'Whole wing span (mm) ', inp('fullSpan', { min: 0 })),
        el('label', { title: 'Oswald efficiency: 1 = ideal elliptic wing; rectangular model wings are often 0.7-0.9. Your choice.' }, 'Span efficiency e ', inp('e', { min: 0.3, max: 1 })),
        el('label', { title: 'Maximum lift coefficient of your airfoil at your Reynolds number (from its polar). Blank = no stall shown.' }, 'CL max (optional) ', inp('clMax'))) :
        el('div', {}, el('label', {}, 'Shape ', sel('body', Object.entries(aero.BODY_CD).map(([k, v]) => [k, `${v.name}: Cd ${v.cd}`]))), el('label', {}, 'or your own Cd ', inp('cd')))));
    const at = aero.air(s.altitude, s.tempC === '' ? null : s.tempC);
    const sec2d = el('canvas', { width: 640, height: 300, className: 'lab-canvas' });
    const polar = el('canvas', { width: 640, height: 260, className: 'lab-canvas' });
    const g = L.grid;
    const b = L.bounds;
    // frontal area: cells projected along the flow axis
    const proj = new Set();
    for (let i = 0; i < g.solid.length; i++) if (g.solid[i]) { const c = [i % g.nx, Math.floor(i / g.nx) % g.ny, Math.floor(i / (g.nx * g.ny))]; c[s.flow] = 0; proj.add(c.join(',')); }
    const frontal = proj.size * g.h * g.h;
    const flowDir = [0, 0, 0]; flowDir[s.flow] = 1;
    const liftDir = [0, 0, 0]; liftDir[s.lift] = 1;
    const size = Math.max(...b.size);
    // flow arrows upstream
    for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) {
      const p = [0, 0, 0]; p[s.flow] = -size * 0.8; p[spanAxis] = k * size * 0.3; p[s.lift] = j * size * 0.2 + b.size[2] / 2;
      arrow(p.map((v, a) => v + flowDir[a] * size * 0.25), flowDir, size * 0.25, 0x66aadd);
    }
    if (s.kind === 'body') {
      const cd = s.cd !== '' ? Number(s.cd) : aero.BODY_CD[s.body].cd;
      const D = aero.bodyDrag(frontal, s.speed, cd, s.altitude, s.tempC === '' ? null : s.tempC);
      colorOf = () => [0.72, 0.74, 0.78];
      paint();
      arrow([0, 0, b.size[2] / 2].map((v, a) => v + flowDir[a] * size * 0.5), flowDir, size * 0.4, 0xdd6600);
      panel.replaceChildren(el('div', { className: 'card' }, el('h4', { textContent: 'Body drag' }),
        el('p', { textContent: `Frontal area ${(frontal / 100).toFixed(1)} cm2 along ${AX[s.flow]}, Cd ${cd} ${s.cd !== '' ? '(yours)' : `(${aero.BODY_CD[s.body].name}, Hoerner)`}, air ${at.rho.toFixed(3)} kg/m3: drag ${D.toFixed(2)} N (${(D / 9.80665 * 1000).toFixed(0)} g-force) at ${s.speed} m/s.` }),
        el('button', { type: 'button', className: 'secondary', textContent: 'Apply this drag to the stress test', onclick: () => applyAeroLoad(D, flowDir, 'drag') }),
        el('p', { className: 'muted', textContent: 'Cd from a reference shape (Hoerner, Fluid-Dynamic Drag): pick the closest shape or enter a measured Cd. Real parts with holes and edges differ.' })));
      return;
    }
    // wing: section, panel method, polar
    const spanMin = b.min[spanAxis], spanLen = b.size[spanAxis];
    const sec = aero.section(L.pos, { flowAxis: s.flow, spanAxis, liftAxis: s.lift, at: spanMin + spanLen * (s.spanAt / 100) });
    const notWing = sec.ok && (sec.thickness < 0.01 || sec.thickness > 0.4 || sec.chordMm < b.size[s.flow] * 0.3);
    if (!sec.ok || notWing) {
      panel.replaceChildren(el('p', { className: 'error', textContent: `${sec.ok ? `The cut at ${s.spanAt} % span does not look like a wing section (chord ${sec.chordMm.toFixed(1)} mm, thickness ${(sec.thickness * 100).toFixed(1)} %).` : sec.reason} Check the flow, lift and span axes (span = ${AX[spanAxis]}), move the section, or switch to "Body (drag only)".` }));
      colorOf = () => [0.72, 0.74, 0.78]; paint(); return;
    }
    // planform area: cells projected along the lift axis
    const plan = new Set();
    for (let i = 0; i < g.solid.length; i++) if (g.solid[i]) { const c = [i % g.nx, Math.floor(i / g.nx) % g.ny, Math.floor(i / (g.nx * g.ny))]; c[s.lift] = 0; plan.add(c.join(',')); }
    const partArea = plan.size * g.h * g.h;
    const wingSpan = s.fullSpan ? Number(s.fullSpan) : spanLen;
    const area = (partArea / spanLen) * wingSpan; // mean chord of this part x whole span
    const polarRes = aero.wingPolar(sec.nodes, { spanMm: wingSpan, areaMm2: area, chordMm: sec.chordMm, thickness: sec.thickness }, { speed: s.speed, altitude: s.altitude, tempC: s.tempC === '' ? null : s.tempC, e: s.e, clMax: s.clMax === '' ? null : s.clMax, alphas: [-6, -4, -2, 0, 2, 4, 6, 8, 10, 12, 14] });
    const here = aero.wingPolar(sec.nodes, { spanMm: wingSpan, areaMm2: area, chordMm: sec.chordMm, thickness: sec.thickness }, { speed: s.speed, altitude: s.altitude, tempC: s.tempC === '' ? null : s.tempC, e: s.e, clMax: s.clMax === '' ? null : s.clMax, alphas: [s.alpha] }).rows[0];
    // the part only carries its share of the lift
    const share = Math.min(1, spanLen / wingSpan);
    const sol = aero.panel(sec.nodes, s.alpha);
    // 3D pressure colors: map surface cells to the section's Cp by chord position and side
    const cpAt = (x, upper) => { const pts = sol.cp.filter((p) => (upper ? p.y >= 0 : p.y < 0) || Math.abs(p.y) < 1e-9); let best = pts[0]; for (const p of pts) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p; return best?.cp ?? 0; };
    L.windCp = new Map();
    const midLift = (b.min[s.lift] + b.max[s.lift]) / 2;
    for (let i = 0; i < g.solid.length; i++) {
      if (!g.solid[i] || L.depth[i] !== 1) continue;
      const c = cellCenter(i).map((v, a) => v + L.center[a]);
      const xc = sec.mirrored ? (sec.leMm - c[s.flow]) / sec.chordMm : (c[s.flow] - sec.leMm) / sec.chordMm;
      if (xc < -0.05 || xc > 1.05) continue;
      L.windCp.set(i, cpAt(Math.min(1, Math.max(0, xc)), sec.liftFlipped ? c[s.lift] < midLift : c[s.lift] >= midLift));
    }
    colorOf = (i) => (L.windCp.has(i) ? ramp(0.5 - L.windCp.get(i) / 2.2) : [0.72, 0.74, 0.78]);
    paint();
    // lift and drag arrows at the quarter chord
    const flowSign = sec.mirrored ? -1 : 1;
    if (sec.mirrored) flowDir[s.flow] = -1;
    if (sec.liftFlipped) liftDir[s.lift] = -1;
    const qc = [0, 0, 0]; qc[s.flow] = sec.leMm + flowSign * sec.chordMm * 0.25 - L.center[s.flow]; qc[s.lift] = midLift - L.center[s.lift];
    arrow(qc.map((v, a) => v + liftDir[a] * size * 0.4), liftDir, size * 0.4, 0x22aa44);
    arrow(qc.map((v, a) => v + flowDir[a] * size * 0.25), flowDir, size * 0.25, 0xdd6600);
    L.labels.push({ p: qc.map((v, a) => v + flowDir[a] * size * 0.25), text: `drag ${here.dragN.toFixed(2)} N`, cls: 'warn' });
    L.labels.push({ p: qc.map((v, a) => v + liftDir[a] * size * 0.5), text: `lift ${here.liftN.toFixed(1)} N`, cls: 'load' });
    // flow particles through the section field at five span stations
    const parts = [];
    const pGeo = new THREE.BufferGeometry();
    const nP = 600;
    const pArr = new Float32Array(nP * 3);
    for (let k = 0; k < nP; k++) parts.push({ x: -1 - Math.random() * 1.5, y: (Math.random() - 0.5) * 1.2, st: Math.floor(Math.random() * 5) });
    pGeo.setAttribute('position', new THREE.BufferAttribute(pArr, 3));
    overlay.add(new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0x2277ee, size: Math.max(0.6, size / 150) })));
    const toWorld = (x, y, st) => { const p = [0, 0, 0]; p[s.flow] = sec.leMm + flowSign * x * sec.chordMm - L.center[s.flow]; p[s.lift] = midLift + (sec.liftFlipped ? -y : y) * sec.chordMm - L.center[s.lift]; p[spanAxis] = spanMin + spanLen * (0.1 + 0.2 * st) - L.center[spanAxis]; return p; };
    const cache = new Map();
    const vel = (x, y) => { const key = `${Math.round(x * 40)},${Math.round(y * 40)}`; let v = cache.get(key); if (!v) { v = sol.field(x, y); cache.set(key, v); } return v; };
    L.onFrame = () => {
      parts.forEach((p, k) => {
        const [u, v] = vel(p.x, p.y);
        p.x += u * 0.025; p.y += v * 0.025;
        if (p.x > 2.2 || Math.abs(p.y) > 1.5 || (p.x > 0 && p.x < 1 && Math.abs(p.y) < 0.02)) { p.x = -1 - Math.random() * 0.4; p.y = (Math.random() - 0.5) * 1.2; }
        const w = toWorld(p.x, p.y, p.st);
        pArr[k * 3] = w[0]; pArr[k * 3 + 1] = w[1]; pArr[k * 3 + 2] = w[2];
      });
      pGeo.attributes.position.needsUpdate = true;
    };
    drawSection(sec2d, sec.nodes, sol);
    drawPolar(polar, polarRes.rows);
    legend.replaceChildren(el('div', { className: 'lab-scale grad', textContent: 'Surface color: pressure coefficient Cp (red = suction, blue = pressure). Dots: airflow around the section at five span stations.' }));
    panel.replaceChildren(el('div', { className: 'card' },
      el('h4', { textContent: `Wing at ${s.alpha} deg, ${s.speed} m/s` }),
      el('table', { className: 'est-table' }, el('tbody', {}, ...[
        ['Section', `chord ${sec.chordMm.toFixed(1)} mm, thickness ${(sec.thickness * 100).toFixed(1)} %`],
        ['Wing', `span ${wingSpan.toFixed(0)} mm${s.fullSpan ? ` (this part ${spanLen.toFixed(0)} mm)` : ''}, area ${(area / 100).toFixed(0)} cm2, aspect ratio ${polarRes.AR.toFixed(2)}${sec.mirrored ? '; part faces -flow: leading edge found by shape' : ''}${sec.liftFlipped ? `; cambered side faces -${AX[s.lift]}: lift points -${AX[s.lift]}` : ''}`],
        ['Air', `${at.rho.toFixed(3)} kg/m3, Reynolds number ${polarRes.re.toFixed(0)}`],
        ['Section (2D)', `Cl ${here.cl2d.toFixed(3)}, Cm(c/4) ${here.cm.toFixed(3)}, zero-lift angle ${polarRes.alpha0.toFixed(2)} deg, lift slope ${polarRes.a0.toFixed(2)} /rad`],
        ['Wing (3D)', `CL ${here.CL.toFixed(3)}${here.stalled ? ' (limited by your CL max: stalled)' : ''}, CD ${here.CD.toFixed(4)} (profile ${here.CD0.toFixed(4)} + induced ${here.CDi.toFixed(4)}), L/D ${here.LD.toFixed(1)}`],
        ['Forces', `whole wing: lift ${here.liftN.toFixed(2)} N (${(here.liftN / 9.80665 * 1000).toFixed(0)} g), drag ${here.dragN.toFixed(3)} N${share < 1 ? `; this part carries about ${(here.liftN * share).toFixed(2)} N (by span share)` : ''}`],
      ].map(([k, v]) => el('tr', {}, el('td', { textContent: k }), el('td', { textContent: v }))))),
      sec2d, polar,
      el('div', { className: 'row' },
        el('button', { type: 'button', textContent: 'Apply this lift to the stress test', onclick: () => applyAeroLoad(here.liftN * share, liftDir, 'lift') }),
        ctx?.currentGenerator?.() ? el('button', { type: 'button', className: 'secondary', textContent: 'Edit the wing in the designer', onclick: () => ctx.openGenerator(ctx.currentGenerator()) }) : null),
      el('p', { className: 'muted', textContent: 'Section: inviscid panel method (no stall, no laminar bubbles). Wing: lifting-line with your span efficiency; drag from flat-plate skin friction x form factor (Raymer). Good for comparing shapes and sizing loads; small model wings at low Reynolds numbers stall earlier than this predicts.' })));
  }

  function applyAeroLoad(newtons, dir, what) {
    // root anchor (lowest span layer) + force over the surface, for the stress test
    const s = store.get('labWind') ?? { flow: 0, lift: 2 };
    const spanAxis = [0, 1, 2].find((a) => a !== s.flow && a !== s.lift) ?? 1;
    const g = L.grid;
    const coord = (i) => [i % g.nx, Math.floor(i / g.nx) % g.ny, Math.floor(i / (g.nx * g.ny))];
    let first = Infinity;
    for (let i = 0; i < g.solid.length; i++) if (g.solid[i]) first = Math.min(first, coord(i)[spanAxis]);
    const root = [], skin = [];
    for (let i = 0; i < g.solid.length; i++) {
      if (!g.solid[i]) continue;
      if (coord(i)[spanAxis] <= first + 1) root.push(i);
      else if (L.depth[i] === 1) skin.push(i);
    }
    L.groups = [{ id: 'root', type: 'anchor', cells: root, set: new Set(root), at: mean(root.map(cellCenter)), normal: [0, 0, -1] },
      { id: what, type: 'force', cells: skin, set: new Set(skin), at: mean(skin.map(cellCenter)), normal: dir, magnitude: Number(newtons.toFixed(3)), dir: dir[2] ? '+z' : dir[1] ? '+y' : '+x' }];
    L.result = null;
    toast(`Stress test set: root held, ${newtons.toFixed(2)} N ${what} spread over the surface. Press Solve.`, 'ok', 6000);
    setMode('stress');
  }

  function drawSection(cv, nodes, sol) {
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    c.clearRect(0, 0, W, H);
    const sx = (x) => 40 + x * (W - 80), sy = (y) => H * 0.62 - y * (W - 80);
    // streamlines
    c.strokeStyle = 'rgba(60,120,220,0.45)';
    for (let k = -8; k <= 8; k++) {
      let x = -0.6, y = k * 0.05 + 0.02;
      c.beginPath(); c.moveTo(sx(x), sy(y));
      for (let s = 0; s < 220; s++) { const [u, v] = sol.field(x, y); const n = Math.hypot(u, v) || 1; x += (u / n) * 0.01; y += (v / n) * 0.01; if (x > 1.6) break; if (x > 0 && x < 1 && Math.abs(y) < 0.003) break; c.lineTo(sx(x), sy(y)); }
      c.stroke();
    }
    // airfoil
    c.fillStyle = 'rgba(120,130,145,0.85)';
    c.beginPath(); nodes.forEach(([x, y], i) => (i ? c.lineTo(sx(x), sy(y)) : c.moveTo(sx(x), sy(y)))); c.closePath(); c.fill();
    // Cp plot (inverted: suction up)
    const cpY = (cp) => 40 - cp * 18;
    c.strokeStyle = '#d33'; c.beginPath();
    sol.cp.forEach((p, i) => (i ? c.lineTo(sx(p.x), cpY(p.cp)) : c.moveTo(sx(p.x), cpY(p.cp))));
    c.stroke();
    c.fillStyle = getComputedStyle(document.body).color; c.font = '12px sans-serif';
    c.fillText('-Cp (red, up = suction) and streamlines around the section', 40, H - 8);
  }

  function drawPolar(cv, rows) {
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    c.clearRect(0, 0, W, H);
    const aMin = rows[0].alpha, aMax = rows.at(-1).alpha;
    const clMax = Math.max(...rows.map((r) => Math.abs(r.CL)), 0.5);
    const ldMax = Math.max(...rows.map((r) => Math.abs(r.LD)), 1);
    const x = (a) => 40 + ((a - aMin) / (aMax - aMin)) * (W - 60);
    c.strokeStyle = '#888'; c.beginPath(); c.moveTo(40, H / 2); c.lineTo(W - 20, H / 2); c.moveTo(x(0), 10); c.lineTo(x(0), H - 20); c.stroke();
    const line = (f, color) => { c.strokeStyle = color; c.beginPath(); rows.forEach((r, i) => (i ? c.lineTo(x(r.alpha), f(r)) : c.moveTo(x(r.alpha), f(r)))); c.stroke(); };
    line((r) => H / 2 - (r.CL / clMax) * (H / 2 - 20), '#2a8');
    line((r) => H / 2 - (r.LD / ldMax) * (H / 2 - 20), '#c70');
    c.fillStyle = getComputedStyle(document.body).color; c.font = '12px sans-serif';
    c.fillText(`Angle of attack ${aMin} to ${aMax} deg. Green: CL (max ${clMax.toFixed(2)}), orange: L/D (max ${ldMax.toFixed(1)})`, 40, H - 4);
  }

  // ---------------------------------------------------------------- environment

  async function envMode() {
    tintOf = null;
    const env = await import('/shared/lab/env.js');
    const weak = await import('/shared/lab/weak.js');
    const m = materials.find((x) => x.id === matSel.value);
    const s = { tempC: 40, uv: m.uvRetainedPerYear ?? '', years: 5, up: 2, upSign: 1, drop: 1, stop: 2, sfP: m.fatigueSf ?? '', bP: m.fatigueB ?? '', ...(store.get('labEnv') ?? {}) };
    const save = () => store.set('labEnv', s);
    const inp = (k, attrs = {}) => { const i = el('input', { type: 'number', step: 'any', value: s[k], className: 'num', ...attrs }); i.onchange = () => { s[k] = i.value === '' ? '' : Number(i.value); save(); drawMode(); }; return i; };
    const maxStress = L.result ? Math.max(...[...L.result.vm].filter(Number.isFinite)) : 0;
    const heat = env.heatCheck(m, s.tempC, maxStress);
    const moist = env.moisture(m);
    const tl = s.uv !== '' ? env.uvTimeline(s.uv, s.years) : null;
    const pools = weak.waterPools(L.grid, s.up, s.upSign);
    const poolSet = new Set(pools.cells);
    const accel = env.dropAccel(s.drop, s.stop);
    const cycles = L.result && s.sfP !== '' && s.bP !== '' ? env.fatigueLife(maxStress / 2, s.sfP, s.bP) : null;
    const minSf = L.result ? Math.min(...[...L.result.sf].filter(Number.isFinite)) : null;
    // time-lapse: tint toward yellow and lower the safety factor as UV takes strength
    const year = el('input', { type: 'range', min: 0, max: tl ? tl.length - 1 : 0, step: 1, value: 0, disabled: !tl });
    const yearLabel = el('span', { className: 'muted' });
    const paintYear = () => {
      const k = Number(year.value);
      const st = tl?.[k];
      colorOf = (i) => {
        if (poolSet.size && L.envShowWater !== false) { /* water drawn separately */ }
        const base = L.result ? sfColor(L.result.sf[i] * (st?.retained ?? 1)) : [0.78, 0.8, 0.82];
        const y = st?.yellowing ?? 0;
        return [base[0] + (0.95 - base[0]) * y * 0.6, base[1] + (0.85 - base[1]) * y * 0.6, base[2] * (1 - y * 0.6)];
      };
      paint();
      yearLabel.textContent = st ? `Year ${st.year.toFixed(1)}: ${(st.retained * 100).toFixed(0)} % strength left${minSf ? `, lowest safety factor ${(minSf * st.retained).toFixed(2)}` : ''}` : 'Enter a UV rate to see the time-lapse.';
    };
    year.oninput = paintYear;
    paintYear();
    // water as blue boxes
    if (pools.cells.length) {
      const g = L.grid;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(g.h, g.h, g.h), new THREE.MeshStandardMaterial({ color: 0x2a7fff, transparent: true, opacity: 0.55 }), pools.cells.length);
      pools.cells.forEach((c, k) => mesh.setMatrixAt(k, new THREE.Matrix4().setPosition(...cellCenter(c))));
      overlay.add(mesh);
    }
    side.replaceChildren(el('div', { className: 'card' }, el('h4', { textContent: 'Conditions' }),
      el('label', {}, 'Hottest it gets (C) ', inp('tempC')),
      el('label', { title: 'Strength left after one year outdoors, as a fraction (0.8 = 80 %). From a published weathering test or your own. Blank = no time-lapse.' }, 'UV: strength left after 1 year (0-1) ', inp('uv', { min: 0, max: 1 })),
      el('label', {}, 'Years ', inp('years', { min: 1, max: 30 })),
      el('label', {}, 'Rain falls from ', (() => { const x = el('select', {}, ...['X', 'Y', 'Z'].flatMap((a, i) => [[`${i}:1`, `+${a} (sky is +${a})`], [`${i}:-1`, `-${a}`]]).map(([v, l]) => el('option', { value: v, textContent: l, selected: v === `${s.up}:${s.upSign}` }))); x.onchange = () => { const [a, b] = x.value.split(':').map(Number); s.up = a; s.upSign = b; save(); drawMode(); }; return x; })()),
      el('div', { className: 'row' }, el('label', {}, 'Drop height (m) ', inp('drop')), el('label', { title: 'How far the part or the floor gives when it lands: 1-2 mm on concrete, more on grass or foam (your estimate)' }, 'stops within (mm) ', inp('stop'))),
      el('div', { className: 'row' }, el('label', { title: 'Fatigue strength coefficient from an S-N test of this material' }, "S-N sf' (MPa) ", inp('sfP')), el('label', { title: 'Basquin exponent (negative) from the same S-N test' }, 'b ', inp('bP')))));
    panel.replaceChildren(el('div', { className: 'card' },
      el('h4', { textContent: `Environment: ${m.brand} ${m.product}` }),
      el('div', { className: 'row' }, el('span', { textContent: 'Sunlight time-lapse ' }), year, yearLabel),
      el('ul', { className: 'health' },
        el('li', { className: `lvl-${heat.level === 'ok' ? 'ok' : heat.level === 'nodata' ? 'info' : 'warn'}` }, el('strong', { textContent: 'Heat: ' }), heat.text),
        el('li', { className: tl ? 'lvl-info' : 'lvl-info' }, el('strong', { textContent: 'Sunlight: ' }), tl ? `With ${(s.uv * 100).toFixed(0)} % kept per year: ${(tl.at(-1).retained * 100).toFixed(0)} % after ${s.years} years.` : `No UV rate entered.${m.uvResistant === false ? ' Datasheet: not UV resistant.' : ''} ASA is the usual choice for parts in the sun; enter a rate from a weathering test to see the time-lapse.`),
        el('li', { className: pools.cells.length ? 'lvl-warn' : 'lvl-ok' }, el('strong', { textContent: 'Rain: ' }), pools.cells.length ? `Water collects in ${pools.pools.length} spots, about ${(pools.volumeMm3 / 1000).toFixed(2)} ml (blue). Add a drain hole at the deepest spot or tilt the part.` : 'No place holds water in this orientation.'),
        el('li', { className: 'lvl-info' }, el('strong', { textContent: 'Moisture: ' }), moist.notes.join(' ') || 'No moisture data on this datasheet.'),
        el('li', { className: 'lvl-info' }, el('strong', { textContent: 'Drop: ' }), accel ? `${s.drop} m onto a surface that stops it within ${s.stop} mm: about ${accel.toFixed(0)} g peak.` : 'Enter a drop height and stopping distance.',
          accel ? el('button', { type: 'button', className: 'secondary small', textContent: `Use ${accel.toFixed(0)} g in the stress test`, onclick: () => { L.gload = Number(accel.toFixed(1)); L.result = null; setMode('stress'); toast('Whole-part acceleration set. Add an anchor where it lands, then Solve.', 'ok', 6000); } }) : null),
        el('li', { className: 'lvl-info' }, el('strong', { textContent: 'Fatigue: ' }), cycles !== null ? `Stress amplitude ${(maxStress / 2).toFixed(1)} MPa (half the peak, for a load that cycles 0 to full): about ${cycles.toExponential(1)} cycles.` : L.result ? "Enter the material's S-N values (sf', b) to estimate cycles." : 'Solve a stress test first, then enter S-N values.'),
      ),
      el('p', { className: 'muted', textContent: 'Heat uses the datasheet HDT; sunlight, fatigue and drop use the numbers you enter (no invented material data). Rain uses the part shape only.' })));
  }

  // ---------------------------------------------------------------- materials & physics

  function materialsMode() {
    const ph = physics();
    const field = (k, label, help) => { const i = el('input', { type: 'number', step: 'any', value: ph[k], className: 'num' }); i.onchange = () => { store.set('labPhysics', { ...physics(), [k]: Number(i.value) }); toast('Saved', 'ok', 1000); }; return el('label', { className: 'set-field', title: help }, el('span', { textContent: label }), i); };
    const fmt = (o) => (o ? Object.entries(o).map(([k, v]) => `${v} ${k}`).join(' / ') : '-');
    const form = el('form', { className: 'card', onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const n = (k) => (f.get(k) === '' ? undefined : Number(f.get(k)));
      try {
        await api('POST', '/api/materials', { brand: f.get('brand'), product: f.get('product'), type: f.get('type'), density: n('density'), hdt045: n('hdt045'), modulus: { xy: n('Exy'), z: n('Ez') }, tensile: { xy: n('Txy'), z: n('Tz') }, uvRetainedPerYear: n('uv'), fatigueSf: n('sfp'), fatigueB: n('b'), notes: f.get('notes'), source: { doc: f.get('src') || 'Entered by the user' } });
        toast('Material added', 'ok');
        renderLab(page);
      } catch (err) { toast(err.message, 'error'); }
    } },
    el('h4', { textContent: 'Add your own material (custom filament or your test results)' }),
    ...[['brand', 'Brand'], ['product', 'Product'], ['type', 'Type (PLA, PETG...)'], ['density', 'Density g/cm3'], ['hdt045', 'HDT at 0.45 MPa (C)'], ['Exy', 'Modulus X-Y (MPa)'], ['Ez', 'Modulus Z (MPa)'], ['Txy', 'Tensile strength X-Y (MPa)'], ['Tz', 'Tensile strength Z / layer (MPa)'], ['uv', 'UV: strength left after 1 year (0-1)'], ['sfp', "Fatigue sf' (MPa)"], ['b', 'Fatigue b'], ['src', 'Source (datasheet, your test)'], ['notes', 'Notes']].map(([k, l]) => el('label', { className: 'set-field' }, el('span', { textContent: l }), el('input', { name: k, type: ['brand', 'product', 'type', 'src', 'notes'].includes(k) ? 'text' : 'number', step: 'any' }))),
    el('button', { type: 'submit', textContent: 'Add material' }));
    side.replaceChildren(el('div', { className: 'card' }, el('h4', { textContent: 'Physics settings' }),
      field('poisson', "Poisson's ratio", 'Not on most datasheets; 0.35 is a typical value for thermoplastics. Your choice.'),
      field('infillExponent', 'Infill stiffness exponent', '1 = stiffness and strength scale with infill % (rule of mixtures). Raise it to be more conservative (gyroid and grid are weaker than solid at the same density).'),
      field('lineWidth', 'Line width (mm)', 'Wall line width: walls x line width = solid shell thickness.'),
      field('tol', 'Solver tolerance', 'Relative residual to stop at (1e-6 default).'),
      field('maxIter', 'Solver step limit', ''),
      el('button', { type: 'button', className: 'secondary small', textContent: 'Reset physics settings', onclick: () => { store.set('labPhysics', null); renderLab(page); } })));
    panel.replaceChildren(
      el('div', { className: 'card' }, el('h4', { textContent: `Materials (${materials.length})` }),
        el('table', { className: 'est-table' }, el('thead', {}, el('tr', {}, ...['Material', 'Type', 'Modulus (MPa)', 'Tensile (MPa)', 'HDT 0.45 (C)', 'Source', ''].map((h) => el('th', { textContent: h })))),
          el('tbody', {}, ...materials.map((m) => el('tr', {}, el('td', { textContent: `${m.brand} ${m.product}${m.custom ? ' (yours)' : ''}` }), el('td', { textContent: m.type }), el('td', { textContent: fmt(m.modulus ?? m.flexModulus) }), el('td', { textContent: fmt(m.tensile ?? m.tensileYield) }), el('td', { textContent: m.hdt045 ?? '-' }),
            el('td', {}, m.source?.url ? el('a', { href: m.source.url, target: '_blank', rel: 'noopener', textContent: 'datasheet' }) : document.createTextNode(m.source?.doc ?? '')),
            el('td', {}, m.custom ? el('button', { type: 'button', className: 'secondary small', textContent: 'Delete', onclick: async () => { await api('DELETE', `/api/materials/${m.id}`); renderLab(page); } }) : null)))))),
      form);
  }

  // first load
  if (arg?.startsWith('stl-')) srcSel.value = `stl:${arg}`;
  if ((srcSel.value === 'designer' && ctx?.currentParts?.()?.length) || srcSel.value.startsWith('stl:')) await loadSource();
  else drawMode();
}
