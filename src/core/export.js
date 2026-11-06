// STL writing and mesh measurements for plain meshes
// ({ positions: Float32Array, indices: Uint32Array }). Units: mm.

function triNormal(p, a, b, c) {
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** Serialize a mesh to STL. Binary by default (smaller, faster to load). */
export function toStl(mesh, { binary = true, name = 'stltools' } = {}) {
  const { positions: p, indices: idx } = mesh;
  const triCount = idx.length / 3;

  if (binary) {
    const buf = Buffer.alloc(84 + triCount * 50);
    buf.write(`binary STL from ${name}`.slice(0, 80), 0, 'ascii');
    buf.writeUInt32LE(triCount, 80);
    let o = 84;
    for (let t = 0; t < triCount; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      for (const v of triNormal(p, a, b, c)) { buf.writeFloatLE(v, o); o += 4; }
      for (const v of [a, b, c]) {
        buf.writeFloatLE(p[v], o);
        buf.writeFloatLE(p[v + 1], o + 4);
        buf.writeFloatLE(p[v + 2], o + 8);
        o += 12;
      }
      o += 2; // attribute byte count
    }
    return buf;
  }

  const lines = [`solid ${name}`];
  const f = (n) => n.toExponential(6);
  for (let t = 0; t < triCount; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const n = triNormal(p, a, b, c);
    lines.push(`  facet normal ${n.map(f).join(' ')}`, '    outer loop');
    for (const v of [a, b, c]) lines.push(`      vertex ${f(p[v])} ${f(p[v + 1])} ${f(p[v + 2])}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push(`endsolid ${name}`, '');
  return Buffer.from(lines.join('\n'), 'utf8');
}

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Bounding box, volume, triangle count. */
export function meshStats(mesh) {
  const { positions: p, indices: idx } = mesh;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k];
      if (p[i + k] > max[k]) max[k] = p[i + k];
    }
  }
  let vol6 = 0;
  let area = 0;
  let flat = 0;
  let bottom = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    vol6 += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    // triangle normal (not normalized): area = |n| / 2
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    area += len / 2;
    if (len > 0 && Math.abs(nz / len) > 0.7) {
      flat += len / 2;
      if (nz < 0 && Math.max(p[a + 2], p[b + 2], p[c + 2]) < min[2] + 0.01) bottom += len / 2;
    }
  }
  return {
    size: [0, 1, 2].map((k) => round(max[k] - min[k])),
    min: min.map((v) => round(v)),
    max: max.map((v) => round(v)),
    volumeMm3: round(vol6 / 6, 1),
    areaMm2: round(area, 1),
    flatAreaMm2: round(flat, 1),
    bedAreaMm2: round(bottom, 1),
    triangles: idx.length / 3,
  };
}

/**
 * Watertight check: every directed edge must have exactly one opposite twin.
 * Returns the number of bad edges (0 = closed, consistently oriented mesh).
 */
export function openEdgeCount(mesh) {
  const { indices: idx } = mesh;
  const edges = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    for (let j = 0; j < 3; j++) {
      const a = idx[t + j], b = idx[t + ((j + 1) % 3)];
      const key = `${a},${b}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const [key, count] of edges) {
    const [a, b] = key.split(',');
    if (count !== 1 || edges.get(`${b},${a}`) !== 1) bad++;
  }
  return bad;
}

/**
 * The check a slicer effectively does: weld vertices by their float32 STL
 * position and count edges not shared by exactly two triangles, plus
 * zero-length edges. 0 = clean STL.
 */
export function stlEdgeIssues(mesh) {
  const { positions: p, indices: idx } = mesh;
  const f = new Float32Array(p);
  const key = (i) => `${f[i * 3]},${f[i * 3 + 1]},${f[i * 3 + 2]}`;
  const edges = new Map();
  let degenerate = 0;
  for (let t = 0; t < idx.length; t += 3) {
    for (let j = 0; j < 3; j++) {
      const a = key(idx[t + j]);
      const b = key(idx[t + ((j + 1) % 3)]);
      if (a === b) { degenerate++; continue; }
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let bad = degenerate;
  for (const c of edges.values()) if (c !== 2) bad++;
  return bad;
}
