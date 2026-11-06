// 3D preview of generated parts and imported STL files (three.js). STL is Z-up.
//
// createViewer(container, options) -> {
//   show(parts)          parts: [{ url } | { geometry }], laid out side by side, centered on the bed
//   parse(arrayBuffer)   STL bytes -> BufferGeometry (local files)
//   setOptions(partial)  any of the viewer settings below (Settings > 3D view uses the same keys)
//   setBed(bed | null)   printer build volume { x, y, z } in mm: outline + grid size
//   setView(name)        'iso' | 'top' | 'front' | 'right' | 'fit'
//   setClip(z | null)    cut the model at height z (layer preview)
//   bounds()             { size: [x, y, z] } of what is shown, or null
//   screenshot()         Promise<Blob> PNG of the current view
// }
//
// Options (src/core/settings.js SCHEMA.viewer):
//   quality   ultra | high | medium | low  -> pixel ratio, shadow map size, soft shadows
//   shading   shaded | edges | wireframe | xray
//   color     '#3d8bfd'
//   shadows, grid, bed, axes, dimensions, ortho, autoRotate   booleans
//
// createThumbnailer(w, h) renders card previews offscreen (one shared WebGL context).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { isDark } from './lib.js';

const QUALITY = {
  ultra: { ratio: () => Math.min(3, (window.devicePixelRatio || 1) * 1.5), shadowMap: 4096, soft: true },
  high: { ratio: () => window.devicePixelRatio || 1, shadowMap: 2048, soft: true },
  medium: { ratio: () => Math.min(1.5, window.devicePixelRatio || 1), shadowMap: 1024, soft: false },
  low: { ratio: () => 1, shadowMap: 0, soft: false },
};

export const DEFAULT_VIEWER = { quality: 'high', shading: 'shaded', color: '#3d8bfd', shadows: true, grid: true, bed: true, axes: false, dimensions: true, ortho: false, autoRotate: false };

export function createViewer(container, initial = {}) {
  let opts = { ...DEFAULT_VIEWER, ...initial };
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.localClippingEnabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const persp = new THREE.PerspectiveCamera(40, 1, 0.1, 20000);
  const ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, -20000, 20000);
  for (const c of [persp, ortho]) c.up.set(0, 0, 1);
  let camera = persp;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotateSpeed = 1.2;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(80, -120, 200);
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-100, 80, 60);
  scene.add(fill);

  const group = new THREE.Group();
  scene.add(group);
  const helpers = new THREE.Group();
  scene.add(helpers);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.22 }));
  ground.receiveShadow = true;
  ground.position.z = -0.02;
  scene.add(ground);

  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);
  const material = new THREE.MeshStandardMaterial({ color: opts.color, roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide, clippingPlanes: [clipPlane] });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x0b1a33, transparent: true, opacity: 0.55, clippingPlanes: [clipPlane] });

  const dims = document.createElement('div');
  dims.className = 'viewer-dims';
  container.appendChild(dims);

  let bed = null;
  let box = null; // bounds of what is shown
  let meshes = [];

  const theme = () => (isDark() ? { bg: 0x0f1114, grid1: 0x3a414b, grid2: 0x23282f, bed: 0x6aa1ff, edge: 0xdfe8ff } : { bg: 0xe9ecf0, grid1: 0xb8bec7, grid2: 0xd3d7dd, bed: 0x1f6feb, edge: 0x0b1a33 });

  function applyQuality() {
    const q = QUALITY[opts.quality] ?? QUALITY.high;
    renderer.setPixelRatio(q.ratio());
    const shadows = opts.shadows && q.shadowMap > 0;
    renderer.shadowMap.enabled = shadows;
    renderer.shadowMap.type = q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    sun.castShadow = shadows;
    if (shadows) {
      sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    ground.visible = shadows;
    for (const m of meshes) m.castShadow = shadows;
    resize();
  }

  function applyShading() {
    material.color.set(opts.color);
    const xray = opts.shading === 'xray';
    const mats = new Set([material, ...meshes.map((m) => m.material)]);
    for (const mat of mats) {
      mat.wireframe = opts.shading === 'wireframe';
      mat.transparent = xray;
      mat.opacity = xray ? 0.35 : 1;
      mat.depthWrite = !xray;
    }
    edgeMaterial.color.setHex(theme().edge);
    for (const m of meshes) {
      if (opts.shading === 'edges' && !m.userData.edges) {
        const lines = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), edgeMaterial);
        m.add(lines);
        m.userData.edges = lines;
      }
      if (m.userData.edges) m.userData.edges.visible = opts.shading === 'edges';
    }
  }

  function drawHelpers() {
    helpers.clear();
    const c = theme();
    scene.background = new THREE.Color(c.bg);
    const size = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(100, 100, 50);
    const useBed = opts.bed && bed;
    if (opts.grid) {
      const extent = useBed ? Math.max(bed.x, bed.y) : Math.ceil((Math.max(size.x, size.y) * 1.4) / 10) * 10 + 20;
      const grid = new THREE.GridHelper(extent, Math.round(extent / 10), c.grid1, c.grid2);
      grid.rotation.x = Math.PI / 2;
      grid.position.z = -0.01;
      helpers.add(grid);
    }
    if (useBed) {
      const pts = [[-bed.x / 2, -bed.y / 2], [bed.x / 2, -bed.y / 2], [bed.x / 2, bed.y / 2], [-bed.x / 2, bed.y / 2]];
      const base = new THREE.BufferGeometry().setFromPoints(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)));
      helpers.add(new THREE.LineLoop(base, new THREE.LineBasicMaterial({ color: c.bed })));
      const vol = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(bed.x, bed.y, bed.z)), new THREE.LineBasicMaterial({ color: c.bed, transparent: true, opacity: 0.18 }));
      vol.position.z = bed.z / 2;
      helpers.add(vol);
    }
    if (opts.axes) {
      const ax = new THREE.AxesHelper(Math.max(size.x, size.y, size.z, 20) * 0.6);
      helpers.add(ax);
    }
    const span = useBed ? Math.max(bed.x, bed.y) * 2 : Math.max(size.x, size.y, 50) * 4;
    ground.scale.set(span, span, 1);
    // shadow camera around the model
    const r = Math.max(size.x, size.y, size.z, 20);
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: r * 10 });
    sun.shadow.camera.updateProjectionMatrix();
    const center = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    sun.position.set(center.x + r * 0.8, center.y - r * 1.2, center.z + r * 2.4);
    sun.target.position.copy(center);
  }

  function drawDims() {
    if (!opts.dimensions || !box) { dims.hidden = true; return; }
    const s = box.getSize(new THREE.Vector3());
    // each part is printed on its own: only a single part larger than the bed is a problem
    const tooBig = bed ? meshes.filter((m) => {
      const p = m.geometry.boundingBox.getSize(new THREE.Vector3()); // printed orientation
      return p.z > bed.z || !((p.x <= bed.x && p.y <= bed.y) || (p.y <= bed.x && p.x <= bed.y));
    }).length : 0;
    dims.hidden = false;
    dims.textContent = `${meshes.length > 1 ? (layout === 'assembled' && canAssemble(lastParts) ? 'Assembled: ' : 'All parts: ') : ''}X ${s.x.toFixed(1)}  Y ${s.y.toFixed(1)}  Z ${s.z.toFixed(1)} mm${tooBig ? `  (${meshes.length > 1 ? `${tooBig} part${tooBig > 1 ? 's' : ''}` : 'part'} larger than the bed)` : ''}`;
    dims.classList.toggle('too-big', tooBig > 0);
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h, false);
    const aspect = w / Math.max(h, 1);
    persp.aspect = aspect;
    persp.updateProjectionMatrix();
    const half = ortho.userData.half ?? 100;
    Object.assign(ortho, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    ortho.updateProjectionMatrix();
  }

  function useCamera() {
    const next = opts.ortho ? ortho : persp;
    if (next === camera) return;
    next.position.copy(camera.position);
    next.quaternion.copy(camera.quaternion);
    camera = next;
    controls.object = camera;
    resize();
  }

  /** Point the camera at the model from a named direction. */
  function setView(name = 'iso') {
    const b = box ?? new THREE.Box3(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 30));
    const size = b.getSize(new THREE.Vector3());
    const center = b.getCenter(new THREE.Vector3());
    const r = Math.max(size.length() / 2, 10);
    const dirs = { iso: [1, -1.45, 0.95], top: [0, -0.001, 1], front: [0, -1, 0.001], right: [1, 0, 0.001], fit: null };
    const d = dirs[name] ?? dirs.iso;
    const dir = d ? new THREE.Vector3(...d).normalize() : camera.position.clone().sub(controls.target).normalize();
    const dist = r / Math.sin((persp.fov * Math.PI) / 360) * 1.05;
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(dir, dist);
    persp.near = dist / 100;
    persp.far = dist * 100;
    persp.updateProjectionMatrix();
    ortho.userData.half = r * 1.15;
    resize();
    controls.update();
  }

  const loader = new STLLoader();
  const cache = new Map();
  const load = (url) => {
    if (!cache.has(url)) {
      cache.set(url, loader.loadAsync(url));
      if (cache.size > 60) cache.delete(cache.keys().next().value);
    }
    return cache.get(url);
  };

  let showToken = 0;
  // Layout: 'plate' lays parts side by side as printed; 'assembled' puts each part
  // that has an `assembled` matrix (from the generator) in its place, one color per part.
  let layout = 'plate';
  let lastParts = [];
  const PALETTE = [0x3d8bfd, 0xf28c28, 0x2da44e, 0xbf3989, 0x8957e5, 0xd29922, 0x1b9aaa, 0xcf222e];
  const canAssemble = (parts) => parts.length > 1 && parts.every((p) => Array.isArray(p.assembled) && p.assembled.length === 16);

  async function show(parts, { layout: lay } = {}) {
    // Only the newest call draws: an older, slower call stops when a newer one starts.
    const token = ++showToken;
    if (lay) layout = lay;
    lastParts = parts;
    const assembled = layout === 'assembled' && canAssemble(parts);
    const next = [];
    let offsetX = 0;
    for (const [i, part] of parts.entries()) {
      const geometry = part.geometry ?? (await load(part.url));
      if (token !== showToken) return;
      geometry.computeBoundingBox();
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      const bb = geometry.boundingBox;
      const mat = assembled ? material.clone() : material;
      if (assembled) mat.color.setHex(PALETTE[i % PALETTE.length]);
      const mesh = new THREE.Mesh(geometry, mat);
      if (assembled) {
        mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(part.assembled);
      } else {
        mesh.position.set(offsetX - bb.min.x, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
        offsetX += bb.max.x - bb.min.x + 10;
      }
      mesh.userData.name = part.name;
      mesh.castShadow = renderer.shadowMap.enabled;
      next.push(mesh);
    }
    group.clear();
    for (const m of meshes) {
      m.userData.edges?.geometry.dispose();
      if (m.material !== material) m.material.dispose();
    }
    meshes = next;
    for (const m of meshes) group.add(m);
    // center the layout on the bed origin, standing on the bed
    group.position.set(0, 0, 0);
    group.updateMatrixWorld(true);
    const all = new THREE.Box3().setFromObject(group);
    const c = all.getCenter(new THREE.Vector3());
    group.position.set(-c.x, -c.y, meshes.length ? -all.min.z : 0);
    group.updateMatrixWorld(true);
    box = meshes.length ? new THREE.Box3().setFromObject(group) : null; // empty view: no size label
    applyShading();
    drawHelpers();
    drawDims();
    setView(camera === ortho ? 'fit' : 'iso');
  }

  function setOptions(partial = {}) {
    const before = opts;
    opts = { ...opts, ...partial };
    if (before.quality !== opts.quality || before.shadows !== opts.shadows) applyQuality();
    applyShading();
    useCamera();
    controls.autoRotate = opts.autoRotate;
    drawHelpers();
    drawDims();
  }

  function setBed(b) {
    bed = b && b.x > 0 ? { x: b.x, y: b.y, z: b.z } : null;
    drawHelpers();
    drawDims();
  }

  function setClip(z) {
    clipPlane.constant = z === null || z === undefined ? 1e6 : (box?.min.z ?? 0) + z;
  }

  window.addEventListener('themechange', () => { applyShading(); drawHelpers(); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyShading(); drawHelpers(); });

  applyQuality();
  setOptions({});
  setView('iso');
  let alive = true;
  (function loop() {
    if (!alive) return;
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  })();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  return {
    show,
    /** 'plate' or 'assembled' (only for parts with assembled matrices). Redraws the last parts. */
    setLayout: (l) => { layout = l; return show(lastParts); },
    layout: () => layout,
    canAssemble: () => canAssemble(lastParts),
    setOptions,
    setBed,
    setView,
    setClip,
    parse: (arrayBuffer) => loader.parse(arrayBuffer),
    bounds: () => (box ? { size: box.getSize(new THREE.Vector3()).toArray() } : null),
    screenshot: () => new Promise((resolve) => { renderer.render(scene, camera); renderer.domElement.toBlob(resolve, 'image/png'); }),
    options: () => ({ ...opts }),
    /** Stop drawing and free the WebGL context (for 3D views inside pages). */
    dispose() {
      alive = false;
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
      dims.remove();
    },
  };
}

/**
 * Offscreen renderer for grid thumbnails. One WebGL context is shared by all
 * cards (browsers allow only a few). render(parts) -> PNG Blob.
 */
export function createThumbnailer(width = 400, height = 300) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef1f5);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(1, -1.5, 2);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 50000);
  camera.up.set(0, 0, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x3d8bfd, roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide });
  const loader = new STLLoader();

  async function render(parts) {
    const group = new THREE.Group();
    let offsetX = 0;
    const all = new THREE.Box3();
    for (const part of parts) {
      const geometry = await loader.loadAsync(part.url);
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(offsetX - bb.min.x, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
      offsetX += bb.max.x - bb.min.x + 8;
      group.add(mesh);
      all.expandByObject(mesh);
    }
    scene.add(group);
    const size = all.getSize(new THREE.Vector3());
    const center = all.getCenter(new THREE.Vector3());
    const r = Math.max(size.length() / 2, 5);
    const dir = new THREE.Vector3(0.75, -1.15, 0.85).normalize();
    const dist = r / Math.sin((camera.fov * Math.PI) / 360) * 0.92;
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.near = dist / 100;
    camera.far = dist * 10;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    scene.remove(group);
    group.traverse((o) => o.geometry?.dispose());
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }
  return { render };
}
