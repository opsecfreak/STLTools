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

    /** Closed 2D polygon from [[x, y], ...]. Winding direction does not matter. */
    polygon(points) {
      return t(CrossSection.ofPolygons([points], 'NonZero'));
    },

    /** Several contours (outlines and holes) as one 2D shape. */
    polygons(contours, fillRule = 'NonZero') {
      return t(CrossSection.ofPolygons(contours, fillRule));
    },

    /** Prism: 2D outline given as [[y, z], ...], extruded along X from x0 to x1. */
    prismX(yz, x0, x1) {
      const cs = k.polygon(yz.map(([y, z]) => [-z, y]));
      return t(t(t(Manifold.extrude(cs, x1 - x0)).rotate([0, 90, 0])).translate([x0, 0, 0]));
    },

    /** Prism: 2D outline given as [[x, z], ...], extruded along Y from y0 to y1. */
    prismY(xz, y0, y1) {
      const cs = k.polygon(xz.map(([x, z]) => [x, -z]));
      return t(t(t(Manifold.extrude(cs, y1 - y0)).rotate([-90, 0, 0])).translate([0, y0, 0]));
    },

    /** Prism: 2D outline given as [[x, y], ...], extruded along Z from z0 to z1. */
    prismZ(xy, z0, z1) {
      return t(t(Manifold.extrude(k.polygon(xy), z1 - z0)).translate([0, 0, z0]));
    },

    /**
     * Loft between two convex 2D outlines at heights zA < zB (convex hull of
     * their vertices). Used for 45 degree chamfers between rounded rectangles.
     */
    loftConvex(csA, zA, csB, zB) {
      const pts = [];
      for (const poly of csA.toPolygons()) for (const [x, y] of poly) pts.push([x, y, zA]);
      for (const poly of csB.toPolygons()) for (const [x, y] of poly) pts.push([x, y, zB]);
      return t(Manifold.hull(pts));
    },

    hull(list) {
      return t(Manifold.hull(list));
    },

    intersect(a, b) {
      return t(Manifold.intersection(a, b));
    },

    rotate(m, degrees) {
      return t(m.rotate(degrees));
    },

    /** Cylinder along Z at (x, y) from z0 to z1. */
    cylZ(r, x, y, z0, z1, segments = 48) {
      return t(t(Manifold.cylinder(z1 - z0, r, r, segments)).translate([x, y, z0]));
    },

    /** Cone / frustum along Z at (x, y): radius r0 at z0, r1 at z1. */
    coneZ(r0, r1, x, y, z0, z1, segments = 48) {
      return t(t(Manifold.cylinder(z1 - z0, r0, r1, segments)).translate([x, y, z0]));
    },

    /** Hex prism along Z, size across flats, flats facing +/-Y. */
    hexZ(af, x, y, z0, z1, rotDeg = 0) {
      const R = af / Math.sqrt(3);
      return k.prismZ(regularPolygon(R, 6, rotDeg).map(([a, b]) => [a + x, b + y]), z0, z1);
    },

    /** Horizontal hole along X (teardrop, point up so it prints without support). */
    holeX(r, y, z, x0, x1, segments = 32) {
      return k.prismX(teardrop(r, segments).map(([u, v]) => [y + v, z + u]), x0, x1);
    },

    /** Horizontal hole along Y (teardrop, point up). */
    holeY(r, x, z, y0, y1, segments = 32) {
      return k.prismY(teardrop(r, segments).map(([u, v]) => [x + v, z + u]), y0, y1);
    },

    /** Drop onto the bed (min Z = 0) without moving X/Y. */
    dropToBed(m) {
      const { min } = m.boundingBox();
      return t(m.translate([0, 0, -min[2]]));
    },

    /**
     * Print pose for one part of an assembly. Build the part where it sits in
     * the assembly, then call pose(part, [rx, ry, rz]) (degrees, applied X then Y
     * then Z like Manifold.rotate) to turn it into its print orientation.
     * Returns { manifold, assembled }: the part centered on the bed, and the
     * 4x4 column-major matrix that puts the printed STL back in its assembled
     * place (used by the 3D view's "Assembled" layout).
     */
    pose(m, rotDeg = [0, 0, 0]) {
      const r = rotDeg.map((d) => (d * Math.PI) / 180);
      const rot = t(m.rotate(rotDeg));
      const { min, max } = rot.boundingBox();
      const tv = [-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]];
      const placed = t(rot.translate(tv));
      // R = Rz * Ry * Rx (Manifold applies X, then Y, then Z)
      const [cx, cy, cz] = r.map(Math.cos);
      const [sx, sy, sz] = r.map(Math.sin);
      const R = [
        [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
        [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
        [-sy, cy * sx, cy * cx],
      ];
      // assembled = R^T (printed - tv): column-major, rotation part is R^T
      const Rt = (i, j) => R[j][i];
      const tr = [0, 1, 2].map((i) => -(Rt(i, 0) * tv[0] + Rt(i, 1) * tv[1] + Rt(i, 2) * tv[2]));
      const assembled = [Rt(0, 0), Rt(1, 0), Rt(2, 0), 0, Rt(0, 1), Rt(1, 1), Rt(2, 1), 0, Rt(0, 2), Rt(1, 2), Rt(2, 2), 0, tr[0], tr[1], tr[2], 1]
        .map((v) => Math.round(v * 1e6) / 1e6);
      return { manifold: placed, assembled };
    },

    /** Center on X/Y and drop onto the bed (min Z = 0). */
    placeOnBed(m) {
      const { min, max } = m.boundingBox();
      return t(m.translate([-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]]));
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
      list = list.filter(Boolean);
      return list.length === 1 ? list[0] : t(Manifold.union(list));
    },

    difference(a, cutters) {
      cutters = cutters.filter(Boolean);
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
  // Merge vertices closer than 5 microns (far below printer resolution). Without this, tiny slivers left by
  // booleans become zero-length edges once STL rounds to float32.
  const clean = manifold.simplify(0.005);
  let mesh;
  try {
    mesh = clean.getMesh();
  } finally {
    clean.delete();
  }
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

/**
 * Teardrop outline for a hole printed with its axis horizontal: a circle with
 * a 45 degree point toward +X (rotate it so the point faces print-up).
 * Removes the need for support inside horizontal holes.
 */
export function teardrop(radius, segments = 32) {
  const pts = [[radius * Math.SQRT2, 0]];
  for (let i = 0; i <= segments; i++) {
    const a = Math.PI / 4 + (i * (3 * Math.PI / 2)) / segments;
    pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return pts;
}

/** Regular polygon points, first vertex on +X. */
export function regularPolygon(radius, sides, rotationDeg = 0) {
  const r0 = (rotationDeg * Math.PI) / 180;
  return Array.from({ length: sides }, (_, i) => {
    const a = r0 + (i * 2 * Math.PI) / sides;
    return [radius * Math.cos(a), radius * Math.sin(a)];
  });
}
