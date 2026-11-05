import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

const $ = (id) => document.getElementById(id);
const els = {
  generator: $('generator'), description: $('description'), form: $('params'),
  run: $('run'), reset: $('reset'), save: $('saveParams'),
  viewer: $('viewer'), status: $('status'), parts: $('parts'), warnings: $('warnings'), notes: $('notes'),
};

let generators = [];
let current = null;
let lastResult = null;

// ---------- storage (per-viewer convenience only) ----------
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// ---------- 3D viewer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
els.viewer.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20000);
camera.up.set(0, 0, 1); // STL is Z-up
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(1, -1.5, 2);
scene.add(sun);
const modelGroup = new THREE.Group();
scene.add(modelGroup);
let grid = null;

function themeColors() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return { bg: dark ? 0x0f1114 : 0xe9ecf0, grid1: dark ? 0x3a414b : 0xb8bec7, grid2: dark ? 0x23282f : 0xd3d7dd };
}
function applyTheme() { scene.background = new THREE.Color(themeColors().bg); }
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

function resize() {
  const { clientWidth: w, clientHeight: h } = els.viewer;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(els.viewer);
resize();
(function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();

function frame(box) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 10);
  // build plate grid sized to the model, 10 mm cells
  if (grid) scene.remove(grid);
  const extent = Math.ceil((Math.max(size.x, size.y) * 1.4) / 10) * 10 + 20;
  const { grid1, grid2 } = themeColors();
  grid = new THREE.GridHelper(extent, extent / 10, grid1, grid2);
  grid.rotation.x = Math.PI / 2;
  grid.position.set(center.x, center.y, box.min.z - 0.01);
  scene.add(grid);
  controls.target.copy(center);
  camera.position.set(center.x + radius * 1.1, center.y - radius * 1.6, center.z + radius * 1.0);
  camera.near = radius / 100;
  camera.far = radius * 100;
  camera.updateProjectionMatrix();
}

const loader = new STLLoader();
const geomCache = new Map();
async function loadGeometry(url) {
  if (!geomCache.has(url)) geomCache.set(url, loader.loadAsync(url));
  return geomCache.get(url);
}

async function show(partNames) {
  modelGroup.clear();
  const material = new THREE.MeshStandardMaterial({ color: 0x3d8bfd, roughness: 0.55, metalness: 0.05 });
  let offsetX = 0;
  const all = new THREE.Box3();
  for (const name of partNames) {
    const part = lastResult.parts.find((p) => p.name === name);
    const geometry = await loadGeometry(part.url);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const mesh = new THREE.Mesh(geometry, material);
    // lay multiple parts side by side on the plate
    mesh.position.x = offsetX - bb.min.x;
    offsetX += bb.max.x - bb.min.x + 10;
    mesh.position.z = -bb.min.z;
    modelGroup.add(mesh);
    all.expandByObject(mesh);
  }
  frame(all);
  for (const li of els.parts.children) li.classList.toggle('active', partNames.length === 1 && li.dataset.name === partNames[0]);
}

// ---------- form ----------
function fieldId(key) { return `p-${key}`; }

function buildForm(gen, values) {
  els.form.innerHTML = '';
  const groups = new Map();
  for (const [key, def] of Object.entries(gen.params)) {
    const g = def.group ?? 'Parameters';
    if (!groups.has(g)) {
      const fs = document.createElement('fieldset');
      const lg = document.createElement('legend');
      lg.textContent = g;
      fs.appendChild(lg);
      groups.set(g, fs);
      els.form.appendChild(fs);
    }
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const value = values?.[key] ?? def.default;
    let input;
    const label = document.createElement('label');
    label.htmlFor = fieldId(key);

    if (def.type === 'boolean') {
      wrap.classList.add('check');
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(value);
      label.append(input, document.createTextNode(def.label));
      wrap.appendChild(label);
    } else {
      const text = document.createElement('span');
      text.textContent = def.label;
      label.appendChild(text);
      if (def.unit) {
        const u = document.createElement('span');
        u.className = 'unit';
        u.textContent = def.unit;
        label.appendChild(u);
      }
      if (def.type === 'select') {
        input = document.createElement('select');
        for (const o of def.options) {
          const opt = document.createElement('option');
          opt.value = typeof o === 'object' ? o.value : o;
          opt.textContent = typeof o === 'object' ? o.label : o;
          input.appendChild(opt);
        }
        input.value = value;
      } else {
        input = document.createElement('input');
        if (def.type === 'string') {
          input.type = 'text';
          if (def.pattern) input.pattern = def.pattern;
        } else {
          input.type = 'number';
          if (def.min !== undefined) input.min = def.min;
          if (def.max !== undefined) input.max = def.max;
          input.step = def.type === 'integer' ? 1 : def.step ?? 'any';
        }
        input.value = value;
      }
      wrap.append(label, input);
    }
    input.id = fieldId(key);
    input.name = key;
    if (def.help) {
      const h = document.createElement('div');
      h.className = 'help';
      h.textContent = def.help;
      wrap.appendChild(h);
    }
    groups.get(def.group ?? 'Parameters').appendChild(wrap);
  }
}

function readForm(gen) {
  const out = {};
  for (const [key, def] of Object.entries(gen.params)) {
    const input = $(fieldId(key));
    out[key] = def.type === 'boolean' ? input.checked : input.value;
  }
  return out;
}

function selectGenerator(id) {
  current = generators.find((g) => g.id === id) ?? generators[0];
  els.generator.value = current.id;
  els.description.textContent = current.description;
  buildForm(current, store.get(`params:${current.id}`));
  store.set('generator', current.id);
}

// ---------- output ----------
function list(el, items, cls) {
  el.innerHTML = '';
  for (const text of items) {
    const li = document.createElement('li');
    if (cls) li.className = cls;
    li.textContent = text;
    el.appendChild(li);
  }
}

function renderParts(result) {
  els.parts.innerHTML = '';
  for (const part of result.parts) {
    const li = document.createElement('li');
    li.dataset.name = part.name;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = part.name;
    name.title = 'Show only this part';
    name.onclick = () => show([part.name]);
    const stats = document.createElement('span');
    stats.className = 'stats';
    const s = part.stats;
    stats.textContent = `${s.size.join(' x ')} mm, ${(s.volumeMm3 / 1000).toFixed(1)} cm3, ${s.triangles} triangles`;
    const a = document.createElement('a');
    a.href = part.url;
    a.download = part.filename;
    a.textContent = 'Download STL';
    li.append(name, stats, a);
    els.parts.appendChild(li);
  }
  if (result.parts.length > 1) {
    const li = document.createElement('li');
    const all = document.createElement('span');
    all.className = 'name';
    all.textContent = 'show all parts';
    all.onclick = () => show(result.parts.map((p) => p.name));
    li.appendChild(all);
    els.parts.appendChild(li);
  }
}

async function run() {
  const params = readForm(current);
  store.set(`params:${current.id}`, params);
  els.run.disabled = true;
  els.status.textContent = 'Generating...';
  els.status.classList.remove('error');
  try {
    const res = await fetch(`/api/generate/${current.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.errors ? data.errors.join('\n') : data.error);
    lastResult = data;
    renderParts(data);
    list(els.warnings, data.warnings);
    list(els.notes, data.notes);
    await show(data.parts.length > 1 ? data.parts.map((p) => p.name) : [data.parts[0].name]);
    els.status.textContent = '';
  } catch (err) {
    els.status.textContent = err.message;
    els.status.classList.add('error');
  } finally {
    els.run.disabled = false;
  }
}

function saveParams() {
  const body = JSON.stringify({ generator: current.id, params: lastResult?.id === current.id ? lastResult.params : readForm(current) }, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body + '\n'], { type: 'application/json' }));
  a.download = `${current.id}.params.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- init ----------
els.run.onclick = run;
els.reset.onclick = () => buildForm(current, null);
els.save.onclick = saveParams;
els.generator.onchange = () => selectGenerator(els.generator.value);
els.form.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } };

generators = await (await fetch('/api/generators')).json();
for (const g of generators) {
  const opt = document.createElement('option');
  opt.value = g.id;
  opt.textContent = g.name;
  els.generator.appendChild(opt);
}
selectGenerator(store.get('generator') ?? generators[0].id);
run();
