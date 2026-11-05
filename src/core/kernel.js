// Geometry kernel: thin wrapper over manifold-3d (WASM).
//
// Why manifold-3d: its booleans always return watertight, consistently
// oriented meshes, so slicers never see holes or flipped faces.
//
// WASM objects are not garbage collected. Every object made through a scope
// is tracked and freed by scope.free(), so a long-running server does not leak.

import Module from 'manifold-3d';

let wasm = null;
let loading = null;

export async function initKernel() {
  if (wasm) return wasm;
  if (!loading) {
    loading = Module().then((m) => {
      m.setup();
      wasm = m;
      return m;
    });
  }
  return loading;
}

export function createScope() {
  if (!wasm) throw new Error('Kernel not initialized. Call await initKernel() first.');
  const { Manifold, CrossSection } = wasm;
  const objects = [];
  const t = (o) => {
    objects.push(o);
    return o;
  };

  const k = {
    Manifold,
    CrossSection,
    track: t,

    /** Centered rectangle with rounded corners (2D). r <= 0 gives sharp corners. */
    roundedRect(w, d, r, segmentsPerCorner = 12) {
      const rr = Math.min(r, w / 2 - 0.01, d / 2 - 0.01);
      if (rr <= 0.01) return t(CrossSection.square([w, d], true));
      const core = t(CrossSection.square([w - 2 * rr, d - 2 * rr], true));
      return t(core.offset(rr, 'Round', 2, segmentsPerCorner * 4));
    },

    /** Closed 2D polygon from [[x, y], ...]. */
    polygon(points) {
      return t(CrossSection.ofPolygons([points], 'Positive'));
    },

    extrude(cs, height, nDivisions = 0) {
      return t(Manifold.extrude(cs, height, nDivisions));
    },

    /** Rounded-rectangle block centered on X/Y, spanning z0..z1. */
    roundedBlock(w, d, r, z0, z1, segmentsPerCorner = 12) {
      return t(k.extrude(k.roundedRect(w, d, r, segmentsPerCorner), z1 - z0).translate([0, 0, z0]));
    },

    /** Axis-aligned box from its center and size. */
    cuboid(size, center = [0, 0, 0]) {
      return t(t(Manifold.cube(size, true)).translate(center));
    },

    /** Cylinder whose axis runs from point a to point b. */
    rod(a, b, radius, segments = 32) {
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const len = Math.hypot(...d);
      const [dx, dy, dz] = d.map((v) => v / len);
      // Rotation that maps +Z onto the direction (Rodrigues), column-major 4x4.
      const c = dz;
      const axis = [-dy, dx, 0];
      const s = Math.hypot(axis[0], axis[1]);
      let m;
      if (s < 1e-12) {
        m = c > 0 ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] : [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0];
      } else {
        const [ux, uy] = [axis[0] / s, axis[1] / s];
        const C = 1 - c;
        // rotation about unit axis (ux, uy, 0) by angle with cos=c, sin=s
        const r00 = c + ux * ux * C, r01 = ux * uy * C, r02 = uy * s;
        const r10 = ux * uy * C, r11 = c + uy * uy * C, r12 = -ux * s;
        const r20 = -uy * s, r21 = ux * s, r22 = c;
        m = [r00, r10, r20, 0, r01, r11, r21, 0, r02, r12, r22, 0];
      }
      m.push(a[0], a[1], a[2], 1);
      return t(t(Manifold.cylinder(len, radius, radius, segments)).transform(m));
    },

    union(list) {
      return list.length === 1 ? list[0] : t(Manifold.union(list));
    },

    difference(a, cutters) {
      if (!cutters.length) return a;
      return t(Manifold.difference([a, ...cutters]));
    },

    translate(m, v) {
      return t(m.translate(v));
    },

    mirror(m, normal) {
      return t(m.mirror(normal));
    },

    free() {
      for (const o of objects) {
        try {
          o.delete();
        } catch {
          /* already freed */
        }
      }
      objects.length = 0;
    },
  };
  return k;
}

/**
 * Copy a Manifold into a plain JS mesh (survives scope.free()).
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function toPlainMesh(manifold) {
  const status = manifold.status();
  if (status !== 'NoError') throw new Error(`Geometry kernel error: ${status}`);
  const mesh = manifold.getMesh();
  const n = mesh.numProp;
  const vp = mesh.vertProperties;
  const count = vp.length / n;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = vp[i * n];
    positions[i * 3 + 1] = vp[i * n + 1];
    positions[i * 3 + 2] = vp[i * n + 2];
  }
  return { positions, indices: Uint32Array.from(mesh.triVerts) };
}
