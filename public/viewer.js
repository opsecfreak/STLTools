// 3D preview of generated parts (three.js). STL is Z-up.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(1, -1.5, 2);
  scene.add(sun);
  const group = new THREE.Group();
  scene.add(group);
  let grid = null;

  const dark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
  const colors = () => (dark()
    ? { bg: 0x0f1114, grid1: 0x3a414b, grid2: 0x23282f }
    : { bg: 0xe9ecf0, grid1: 0xb8bec7, grid2: 0xd3d7dd });
  const applyTheme = () => { scene.background = new THREE.Color(colors().bg); };
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();
  (function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();

  function frame(box) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 10);
    if (grid) scene.remove(grid);
    const extent = Math.ceil((Math.max(size.x, size.y) * 1.4) / 10) * 10 + 20;
    const c = colors();
    grid = new THREE.GridHelper(extent, extent / 10, c.grid1, c.grid2);
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
  const cache = new Map();
  const load = (url) => {
    if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
    return cache.get(url);
  };

  /** Show parts side by side on the plate. parts: [{ url }] */
  async function show(parts) {
    group.clear();
    const material = new THREE.MeshStandardMaterial({ color: 0x3d8bfd, roughness: 0.55, metalness: 0.05 });
    let offsetX = 0;
    const all = new THREE.Box3();
    for (const part of parts) {
      const geometry = await load(part.url);
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.x = offsetX - bb.min.x;
      mesh.position.y = -(bb.min.y + bb.max.y) / 2;
      mesh.position.z = -bb.min.z;
      offsetX += bb.max.x - bb.min.x + 10;
      group.add(mesh);
      all.expandByObject(mesh);
    }
    frame(all);
  }

  return { show };
}
