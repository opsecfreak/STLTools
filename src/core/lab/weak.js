// Geometry checks that find weak spots and print problems without a load case
// (browser and Node; no imports besides voxel.js). All lengths in mm.
//
//   thinWalls(grid, depth, minWall)      cells where the wall is thinner than minWall
//   overhangs(positions, axis, maxAngle) triangles facing down more than maxAngle from vertical
//   supports(grid, axis)                 cells printed over air, support columns and volume
//   crossSections(grid, axis)            solid area per layer, the narrowest layer (necking)
//   islands(grid, axis)                  layers where a new, unconnected region starts in mid-air
//   waterPools(grid, upAxis)             where rain collects on the part (priority flood)

import { coords, isSolid, idx } from './voxel.js';

const axisDims = (g, axis) => {
  // map (u, v, w) with w along the build axis to grid (x, y, z)
  const n = [g.nx, g.ny, g.nz];
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  return { n, u, v, w: axis };
};
const at = (g, p) => isSolid(g, p[0], p[1], p[2]);

/**
 * Wall thickness at each surface cell: the deepest point of the wall it belongs to.
 * Starting from the cell's own depth D, look at every cell within D cells and take the
 * largest depth M; repeat while it grows (max 8 rounds). A wall n cells thick has
 * M = ceil(n / 2), so its thickness is between (2M - 1) h and 2M h. A cell is flagged
 * when even 2M h is under minWall. Corner and edge cells of thick blocks are not
 * flagged (their neighbourhood reaches the thick interior).
 */
export function thinWalls(g, depth, minWall) {
  const out = [];
  for (let i = 0; i < depth.length; i++) {
    if (!g.solid[i] || depth[i] !== 1) continue;
    const [x, y, z] = coords(g, i);
    let M = 1;
    for (let round = 0; round < 8; round++) {
      const r = M;
      let best = M;
      for (let c = z - r; c <= z + r; c++) for (let b = y - r; b <= y + r; b++) for (let a = x - r; a <= x + r; a++) {
        if (!isSolid(g, a, b, c)) continue;
        const d = depth[idx(g, a, b, c)];
        if (d > best) best = d;
      }
      if (best === M) break;
      M = best;
      if (2 * M * g.h >= minWall) break; // already thick enough
    }
    if (2 * M * g.h < minWall) out.push(i);
  }
  return out;
}

/**
 * Triangles that overhang: their outward normal points down (against the build axis)
 * by more than maxAngle from vertical. Faces on the build plate are not counted.
 * -> { tris: [index...], areaMm2 }
 */
export function overhangs(pos, axis = 2, maxAngleDeg = 45, plateTol = 0.05) {
  let minW = Infinity;
  for (let i = axis; i < pos.length; i += 3) minW = Math.min(minW, pos[i]);
  const limit = Math.cos((90 - maxAngleDeg) * Math.PI / 180); // n.down > cos(90 - a) means steeper than allowed
  const tris = [];
  let area = 0;
  for (let t = 0; t < pos.length; t += 9) {
    const a = [pos[t], pos[t + 1], pos[t + 2]], b = [pos[t + 3], pos[t + 4], pos[t + 5]], c = [pos[t + 6], pos[t + 7], pos[t + 8]];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n);
    if (!len) continue;
    const down = -n[axis] / len;
    if (down <= limit) continue;
    if (Math.max(a[axis], b[axis], c[axis]) - minW < plateTol) continue; // on the plate
    tris.push(t / 9);
    area += len / 2;
  }
  return { tris, areaMm2: area };
}

/**
 * Support needed under each cell printed over air: a column from the cell down to the
 * plate or to the part below. -> { over: [cell...], columns: [{ cell, height }], volumeMm3 }
 */
export function supports(g, axis = 2) {
  const { n, u, v, w } = axisDims(g, axis);
  const over = [];
  const columns = [];
  let vol = 0;
  const p = [0, 0, 0];
  for (let a = 0; a < n[u]; a++) for (let b = 0; b < n[v]; b++) for (let c = 1; c < n[w]; c++) {
    p[u] = a; p[v] = b; p[w] = c;
    if (!at(g, p)) continue;
    p[w] = c - 1;
    if (at(g, p)) continue;
    // print over air: count empty cells below to the part or the plate
    let k = c - 1;
    let gap = 0;
    while (k >= 0) { p[w] = k; if (at(g, p)) break; gap++; k--; }
    p[w] = c;
    const cell = idx(g, p[0], p[1], p[2]);
    over.push(cell);
    columns.push({ cell, height: gap * g.h, toPlate: k < 0 });
    vol += gap * g.h ** 3;
  }
  return { over, columns, volumeMm3: vol };
}

/** Solid area per layer along the build axis; the narrowest layer above the first one. */
export function crossSections(g, axis = 2) {
  const { n, u, v, w } = axisDims(g, axis);
  const area = new Float64Array(n[w]);
  const p = [0, 0, 0];
  for (let c = 0; c < n[w]; c++) {
    let cnt = 0;
    for (let a = 0; a < n[u]; a++) for (let b = 0; b < n[v]; b++) { p[u] = a; p[v] = b; p[w] = c; if (at(g, p)) cnt++; }
    area[c] = cnt * g.h * g.h;
  }
  let min = Infinity, minLayer = -1;
  const filled = [...area].map((x, i) => [x, i]).filter(([x]) => x > 0);
  const maxA = Math.max(...filled.map(([x]) => x), 0);
  for (const [x, i] of filled.slice(1, -1)) if (x < min) { min = x; minLayer = i; }
  return { area, narrowest: minLayer >= 0 ? { layer: minLayer, heightMm: (minLayer + 0.5) * g.h, areaMm2: min, ratioToLargest: maxA ? min / maxA : 1 } : null };
}

/** Layers where a region starts without anything under it (needs support from the plate or the part). */
export function islands(g, axis = 2) {
  const sup = supports(g, axis);
  const byLayer = new Map();
  for (const col of sup.columns) {
    const layer = coords(g, col.cell)[axis];
    byLayer.set(layer, (byLayer.get(layer) ?? 0) + 1);
  }
  return [...byLayer.entries()].sort((a, b) => a[0] - b[0]).map(([layer, cells]) => ({ layer, heightMm: (layer + 0.5) * g.h, cells }));
}

/**
 * Rain on the part as it is mounted (upAxis points to the sky): where does water stay?
 * Priority-flood on the top-surface height map (Barnes et al. 2014): water fills every
 * dip up to its spill height. -> { pools: [{ x, y, depthMm }], cells: [empty cell index...], volumeMm3 }
 */
export function waterPools(g, upAxis = 2, upSign = 1) {
  const { n, u, v, w } = axisDims(g, upAxis);
  const W = n[u], H = n[v];
  const top = new Float64Array(W * H).fill(-1); // height (cells) of the highest solid + 1, -1 = no part (ground)
  const p = [0, 0, 0];
  for (let a = 0; a < W; a++) for (let b = 0; b < H; b++) {
    for (let k = 0; k < n[w]; k++) {
      const c = upSign > 0 ? n[w] - 1 - k : k;
      p[u] = a; p[v] = b; p[w] = c;
      if (at(g, p)) { top[a + W * b] = upSign > 0 ? c + 1 : n[w] - c; break; }
    }
  }
  // priority flood from the border (and from columns with no part: water drains there)
  const level = Float64Array.from(top);
  const done = new Uint8Array(W * H);
  const heap = [];
  const push = (i, h) => { heap.push([h, i]); let k = heap.length - 1; while (k > 0) { const pk = (k - 1) >> 1; if (heap[pk][0] <= heap[k][0]) break; [heap[pk], heap[k]] = [heap[k], heap[pk]]; k = pk; } };
  const pop = () => { const t = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return t; };
  for (let a = 0; a < W; a++) for (let b = 0; b < H; b++) {
    const i = a + W * b;
    if (a === 0 || b === 0 || a === W - 1 || b === H - 1 || top[i] < 0) { done[i] = 1; push(i, Math.max(top[i], 0)); }
  }
  while (heap.length) {
    const [hgt, i] = pop();
    const a = i % W, b = Math.floor(i / W);
    for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = a + da, y = b + db;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = x + W * y;
      if (done[j]) continue;
      done[j] = 1;
      level[j] = Math.max(top[j], hgt);
      push(j, level[j]);
    }
  }
  const pools = [];
  const cells = [];
  let vol = 0;
  for (let a = 0; a < W; a++) for (let b = 0; b < H; b++) {
    const i = a + W * b;
    const depth = level[i] - top[i];
    if (top[i] < 0 || depth <= 0) continue;
    pools.push({ a, b, depthMm: depth * g.h });
    vol += depth * g.h ** 3;
    for (let k = 0; k < depth; k++) {
      const c = upSign > 0 ? top[i] + k : n[w] - 1 - (top[i] + k);
      if (c < 0 || c >= n[w]) continue;
      p[u] = a; p[v] = b; p[w] = c;
      cells.push(idx(g, p[0], p[1], p[2]));
    }
  }
  return { pools, cells, volumeMm3: vol };
}
