// Voxel model of a triangle mesh for the Stress Lab (browser and Node; no imports).
//
// voxelize(positions, { size | target }) fills a regular grid: a cell is solid when
// its center is inside the mesh (ray parity along Z through the cell center).
// Works for closed meshes (every STL that STL Tools makes is watertight; imported STLs
// with holes give partial results, reported as `openWarning`).
//
//   positions  Float32Array of triangle vertices [x0,y0,z0, x1,y1,z1, ...] in mm
//   size       voxel edge in mm, or target = wanted solid voxel count (auto size)
// -> { nx, ny, nz, h, origin: [x,y,z], solid: Uint8Array(nx*ny*nz), count, volumeMm3, openWarning }
//    cell index i = x + nx * (y + ny * z), cell center = origin + (x+0.5, y+0.5, z+0.5) * h

export function meshBounds(pos) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = pos[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** Signed volume of a closed mesh (mm3). */
export function meshVolume(pos) {
  let v = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [pos[i], pos[i + 1], pos[i + 2], pos[i + 3], pos[i + 4], pos[i + 5], pos[i + 6], pos[i + 7], pos[i + 8]];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(v / 6);
}

export function voxelize(pos, { size, target = 12000, maxCells = 4e6 } = {}) {
  const b = meshBounds(pos);
  let h = size;
  if (!h) {
    // first guess from the mesh volume, so the solid count lands near the target
    const vol = Math.max(meshVolume(pos), 1e-6);
    h = Math.cbrt(vol / target);
  }
  h = Math.max(h, Math.cbrt((b.size[0] * b.size[1] * b.size[2]) / maxCells), 0.05);
  const nx = Math.max(1, Math.ceil(b.size[0] / h));
  const ny = Math.max(1, Math.ceil(b.size[1] / h));
  const nz = Math.max(1, Math.ceil(b.size[2] / h));
  // center the grid on the part
  const origin = [0, 1, 2].map((a) => b.min[a] - ((([nx, ny, nz][a]) * h - b.size[a]) / 2));
  const solid = new Uint8Array(nx * ny * nz);
  const hits = Array.from({ length: nx * ny }, () => []);
  for (let t = 0; t < pos.length; t += 9) {
    const ax = pos[t], ay = pos[t + 1], az = pos[t + 2];
    const bx = pos[t + 3], by = pos[t + 4], bz = pos[t + 5];
    const cx = pos[t + 6], cy = pos[t + 7], cz = pos[t + 8];
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - origin[0]) / h - 0.5));
    const x1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - origin[0]) / h - 0.5));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - origin[1]) / h - 0.5));
    const y1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - origin[1]) / h - 0.5));
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) continue; // triangle edge-on to the ray
    for (let x = x0; x <= x1; x++) {
      const px = origin[0] + (x + 0.5) * h + h * 1.234567e-5; // tiny offset: rays never hit shared edges exactly
      for (let y = y0; y <= y1; y++) {
        const py = origin[1] + (y + 0.5) * h + h * 2.345678e-5;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        hits[x + nx * y].push(l1 * az + l2 * bz + l3 * cz);
      }
    }
  }
  let count = 0;
  let odd = 0;
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      const zs = hits[x + nx * y].sort((p, q) => p - q);
      if (zs.length % 2) odd++;
      for (let k = 0; k + 1 < zs.length; k += 2) {
        const z0 = Math.max(0, Math.ceil((zs[k] - origin[2]) / h - 0.5));
        const z1 = Math.min(nz - 1, Math.floor((zs[k + 1] - origin[2]) / h - 0.5));
        for (let z = z0; z <= z1; z++) {
          const i = x + nx * (y + ny * z);
          if (!solid[i]) { solid[i] = 1; count++; }
        }
      }
    }
  }
  return { nx, ny, nz, h, origin, solid, count, volumeMm3: count * h ** 3, openWarning: odd > 0 ? `${odd} column(s) crossed the surface an odd number of times: the mesh may have holes` : '' };
}

export const idx = (g, x, y, z) => x + g.nx * (y + g.ny * z);
export const isSolid = (g, x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < g.nx && y < g.ny && z < g.nz && g.solid[x + g.nx * (y + g.ny * z)] === 1;
export const center = (g, i) => {
  const x = i % g.nx;
  const y = Math.floor(i / g.nx) % g.ny;
  const z = Math.floor(i / (g.nx * g.ny));
  return [g.origin[0] + (x + 0.5) * g.h, g.origin[1] + (y + 0.5) * g.h, g.origin[2] + (z + 0.5) * g.h];
};
export const coords = (g, i) => [i % g.nx, Math.floor(i / g.nx) % g.ny, Math.floor(i / (g.nx * g.ny))];

/** Solid cells with at least one empty face neighbour (what is drawn). */
export function surfaceCells(g) {
  const out = [];
  for (let z = 0; z < g.nz; z++) for (let y = 0; y < g.ny; y++) for (let x = 0; x < g.nx; x++) {
    if (!isSolid(g, x, y, z)) continue;
    if (!isSolid(g, x - 1, y, z) || !isSolid(g, x + 1, y, z) || !isSolid(g, x, y - 1, z) || !isSolid(g, x, y + 1, z) || !isSolid(g, x, y, z - 1) || !isSolid(g, x, y, z + 1)) out.push(idx(g, x, y, z));
  }
  return out;
}

/**
 * Distance (in cells, 6-connected) from each solid cell to the nearest empty cell or
 * grid edge: 1 = on the surface. Used for wall thickness and the shell / infill split.
 */
export function depthMap(g) {
  const n = g.nx * g.ny * g.nz;
  const d = new Int32Array(n).fill(-1);
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) {
    if (!g.solid[i]) continue;
    const [x, y, z] = coords(g, i);
    if (!isSolid(g, x - 1, y, z) || !isSolid(g, x + 1, y, z) || !isSolid(g, x, y - 1, z) || !isSolid(g, x, y + 1, z) || !isSolid(g, x, y, z - 1) || !isSolid(g, x, y, z + 1)) { d[i] = 1; q[tail++] = i; }
  }
  while (head < tail) {
    const i = q[head++];
    const [x, y, z] = coords(g, i);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = x + dx, b = y + dy, c = z + dz;
      if (!isSolid(g, a, b, c)) continue;
      const j = idx(g, a, b, c);
      if (d[j] === -1) { d[j] = d[i] + 1; q[tail++] = j; }
    }
  }
  return d;
}
