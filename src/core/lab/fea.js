// Linear elastic finite-element solver on a voxel grid (browser Web Worker and Node).
//
// Each solid voxel is one 8-node hexahedral element (trilinear, 2x2x2 Gauss). The
// global stiffness matrix is never assembled: a preconditioned conjugate gradient
// (Jacobi) multiplies element by element. Units: mm, N, MPa (N/mm2).
//
// Known limits (stated in the UI):
// - Linear, small deformation, isotropic per element (print anisotropy is handled in
//   the failure check: stress across layers is compared with the Z strength).
// - Accuracy measured on a cantilever (100 x 10 x 10 mm, tip load, test/v13.test.js):
//   deflection 94 % of beam theory with 4 voxels through the thickness, 98 % with 8;
//   root stress within about 2-8 %. Fewer than 3 voxels through a wall reads too stiff:
//   raise the resolution for the final check.
//
// solve(grid, {
//   E: Float32Array(cells)  modulus per cell in MPa (0 for empty cells), nu: Poisson's ratio,
//   fixed: [cell...]        cells whose 8 nodes are held,
//   loads: [{ cells: [...], force: [Fx, Fy, Fz] }]   total force spread over the cells' nodes (N),
//   body:  { accel: [ax, ay, az] (m/s2), density: g/cm3, fill: Float32Array(cells) 0..1 } (optional),
//   tol, maxIter, onProgress(iter, residual)
// }) -> { disp: Float64Array(nodes*3), nodeOf: Int32Array(cells*8), stress: Float32Array(cells*6),
//          vm: Float32Array(cells), maxDisp, iterations, residual, converged, dofs }

const CORNERS = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];

/** Constitutive matrix (6x6, Voigt: xx yy zz xy yz zx with engineering shear) for E=1. */
function dMatrix(nu) {
  const l = nu / ((1 + nu) * (1 - 2 * nu));
  const m = 1 / (2 * (1 + nu));
  const D = Array.from({ length: 6 }, () => new Float64Array(6));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) D[i][j] = l + (i === j ? 2 * m : 0);
  for (let i = 3; i < 6; i++) D[i][i] = m;
  return D;
}

/** Strain-displacement matrix B (6x24) at local point (xi, eta, zeta) for a unit cube (h=1). */
function bMatrix(xi, eta, zeta) {
  const B = Array.from({ length: 6 }, () => new Float64Array(24));
  CORNERS.forEach(([cx, cy, cz], n) => {
    const sx = cx ? 1 : -1, sy = cy ? 1 : -1, sz = cz ? 1 : -1;
    // dN/dxi * dxi/dx with dxi/dx = 2 (unit cube spans -1..1 in local coordinates)
    const dx = (sx * (1 + sy * eta) * (1 + sz * zeta)) / 8 * 2;
    const dy = (sy * (1 + sx * xi) * (1 + sz * zeta)) / 8 * 2;
    const dz = (sz * (1 + sx * xi) * (1 + sy * eta)) / 8 * 2;
    const c = n * 3;
    B[0][c] = dx; B[1][c + 1] = dy; B[2][c + 2] = dz;
    B[3][c] = dy; B[3][c + 1] = dx;
    B[4][c + 1] = dz; B[4][c + 2] = dy;
    B[5][c] = dz; B[5][c + 2] = dx;
  });
  return B;
}

/** Element stiffness (24x24, flat) of a unit cube with E = 1. Scale by E * h for a cube of edge h. */
export function unitKe(nu) {
  const D = dMatrix(nu);
  const K = new Float64Array(576);
  const g = 1 / Math.sqrt(3);
  const detJ = 1 / 8; // (h/2)^3 with h = 1
  for (const xi of [-g, g]) for (const eta of [-g, g]) for (const zeta of [-g, g]) {
    const B = bMatrix(xi, eta, zeta);
    // DB = D * B (6x24)
    const DB = Array.from({ length: 6 }, (_, i) => {
      const row = new Float64Array(24);
      for (let k = 0; k < 6; k++) { const d = D[i][k]; if (d) for (let j = 0; j < 24; j++) row[j] += d * B[k][j]; }
      return row;
    });
    for (let a = 0; a < 24; a++) for (let b = 0; b < 24; b++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += B[k][a] * DB[k][b];
      K[a * 24 + b] += s * detJ;
    }
  }
  return K;
}

export function solve(g, opts) {
  const { E, nu = 0.35, fixed = [], loads = [], body = null, tol = 1e-6, maxIter = 3000, onProgress = null } = opts;
  const nCells = g.nx * g.ny * g.nz;
  const NX = g.nx + 1, NY = g.ny + 1;
  // compact node numbering for nodes used by solid cells
  const nodeId = new Map();
  const cells = [];
  for (let i = 0; i < nCells; i++) if (g.solid[i] && E[i] > 0) cells.push(i);
  const nodeOf = new Int32Array(nCells * 8).fill(-1);
  for (const i of cells) {
    const x = i % g.nx, y = Math.floor(i / g.nx) % g.ny, z = Math.floor(i / (g.nx * g.ny));
    CORNERS.forEach(([a, b, c], k) => {
      const key = (x + a) + NX * ((y + b) + NY * (z + c));
      let id = nodeId.get(key);
      if (id === undefined) { id = nodeId.size; nodeId.set(key, id); }
      nodeOf[i * 8 + k] = id;
    });
  }
  const nNodes = nodeId.size;
  const nDof = nNodes * 3;
  const Ke = unitKe(nu);
  const scale = new Float64Array(nCells);
  for (const i of cells) scale[i] = E[i] * g.h;

  // boundary conditions
  const isFixed = new Uint8Array(nDof);
  for (const i of fixed) for (let k = 0; k < 8; k++) { const n = nodeOf[i * 8 + k]; if (n >= 0) isFixed[n * 3] = isFixed[n * 3 + 1] = isFixed[n * 3 + 2] = 1; }
  const f = new Float64Array(nDof);
  for (const ld of loads) {
    const nodes = new Set();
    for (const i of ld.cells) for (let k = 0; k < 8; k++) { const n = nodeOf[i * 8 + k]; if (n >= 0) nodes.add(n); }
    if (!nodes.size) continue;
    for (const n of nodes) for (let a = 0; a < 3; a++) f[n * 3 + a] += ld.force[a] / nodes.size;
  }
  if (body) {
    const volume = g.h ** 3; // mm3
    for (const i of cells) {
      const massKg = body.density * 1e-6 * volume * (body.fill ? body.fill[i] : 1); // g/cm3 = 1e-6 kg/mm3
      for (let k = 0; k < 8; k++) { const n = nodeOf[i * 8 + k]; for (let a = 0; a < 3; a++) f[n * 3 + a] += (massKg * body.accel[a]) / 8; }
    }
  }
  for (let d = 0; d < nDof; d++) if (isFixed[d]) f[d] = 0;

  const dofs = new Int32Array(24);
  const matvec = (x, y) => {
    y.fill(0);
    const xe = new Float64Array(24);
    for (const i of cells) {
      for (let k = 0; k < 8; k++) { const n = nodeOf[i * 8 + k]; dofs[k * 3] = n * 3; dofs[k * 3 + 1] = n * 3 + 1; dofs[k * 3 + 2] = n * 3 + 2; }
      for (let a = 0; a < 24; a++) xe[a] = x[dofs[a]];
      const s = scale[i];
      for (let a = 0; a < 24; a++) {
        let sum = 0;
        const row = a * 24;
        for (let b = 0; b < 24; b++) sum += Ke[row + b] * xe[b];
        y[dofs[a]] += s * sum;
      }
    }
    for (let d = 0; d < nDof; d++) if (isFixed[d]) y[d] = x[d]; // identity rows for held dofs
  };
  const diag = new Float64Array(nDof);
  for (const i of cells) for (let k = 0; k < 8; k++) for (let a = 0; a < 3; a++) diag[nodeOf[i * 8 + k] * 3 + a] += scale[i] * Ke[(k * 3 + a) * 25];
  for (let d = 0; d < nDof; d++) if (isFixed[d] || !diag[d]) diag[d] = 1;

  // preconditioned conjugate gradient
  const u = new Float64Array(nDof);
  const r = Float64Array.from(f);
  const z = new Float64Array(nDof);
  const p = new Float64Array(nDof);
  const Ap = new Float64Array(nDof);
  for (let d = 0; d < nDof; d++) z[d] = r[d] / diag[d];
  p.set(z);
  let rz = 0;
  for (let d = 0; d < nDof; d++) rz += r[d] * z[d];
  const fNorm = Math.sqrt(f.reduce((s, v) => s + v * v, 0)) || 1;
  let iter = 0;
  let res = 1;
  const anyFixed = isFixed.some(Boolean);
  if (anyFixed && fNorm > 1e-12) {
    for (; iter < maxIter; iter++) {
      matvec(p, Ap);
      let pAp = 0;
      for (let d = 0; d < nDof; d++) pAp += p[d] * Ap[d];
      if (!(pAp > 0)) break;
      const alpha = rz / pAp;
      let rr = 0;
      for (let d = 0; d < nDof; d++) { u[d] += alpha * p[d]; r[d] -= alpha * Ap[d]; rr += r[d] * r[d]; }
      res = Math.sqrt(rr) / fNorm;
      if (onProgress && iter % 25 === 0) onProgress(iter, res);
      if (res < tol) { iter++; break; }
      let rzNew = 0;
      for (let d = 0; d < nDof; d++) { z[d] = r[d] / diag[d]; rzNew += r[d] * z[d]; }
      const beta = rzNew / rz;
      rz = rzNew;
      for (let d = 0; d < nDof; d++) p[d] = z[d] + beta * p[d];
    }
  }

  // stresses at element centers
  const D = dMatrix(nu);
  const Bc = bMatrix(0, 0, 0);
  const stress = new Float32Array(nCells * 6);
  const vm = new Float32Array(nCells);
  const eps = new Float64Array(6);
  for (const i of cells) {
    eps.fill(0);
    for (let k = 0; k < 8; k++) {
      const n = nodeOf[i * 8 + k];
      for (let a = 0; a < 3; a++) {
        const ud = u[n * 3 + a];
        for (let s = 0; s < 6; s++) eps[s] += Bc[s][k * 3 + a] * ud;
      }
    }
    for (let s = 0; s < 6; s++) eps[s] /= g.h; // B was for h = 1
    for (let s = 0; s < 6; s++) {
      let v = 0;
      for (let t = 0; t < 6; t++) v += D[s][t] * eps[t];
      stress[i * 6 + s] = E[i] * v;
    }
    const [sx, sy, sz, txy, tyz, tzx] = stress.subarray(i * 6, i * 6 + 6);
    vm[i] = Math.sqrt(0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) + 3 * (txy ** 2 + tyz ** 2 + tzx ** 2));
  }
  let maxDisp = 0;
  for (let n = 0; n < nNodes; n++) maxDisp = Math.max(maxDisp, Math.hypot(u[n * 3], u[n * 3 + 1], u[n * 3 + 2]));
  return { disp: u, nodeOf, stress, vm, maxDisp, iterations: iter, residual: res, converged: res < tol * 10, dofs: nDof, solidCells: cells.length, anyFixed };
}

/** Average displacement vector of one cell (for drawing the deformed shape). */
export function cellDisp(result, i) {
  const out = [0, 0, 0];
  for (let k = 0; k < 8; k++) {
    const n = result.nodeOf[i * 8 + k];
    if (n < 0) continue;
    for (let a = 0; a < 3; a++) out[a] += result.disp[n * 3 + a] / 8;
  }
  return out;
}

/**
 * Failure index per cell for a printed part: stress in the layer plane against the
 * X-Y strength, tension across layers against the Z strength (the weak direction).
 *   strength: { xy, z } in MPa (already scaled for infill per cell via `factor`)
 *   axis: build direction 0 = X, 1 = Y, 2 = Z
 * -> { fi: Float32Array, sf: Float32Array (1/fi), across: Float32Array (normal stress across layers) }
 */
export function failure(g, res, { strengthXY, strengthZ, axis = 2, factor = null }) {
  const n = g.nx * g.ny * g.nz;
  const fi = new Float32Array(n);
  const sf = new Float32Array(n).fill(Infinity);
  const across = new Float32Array(n);
  const zStrength = strengthZ || strengthXY; // datasheets without Z values: same as X-Y (stated in the UI)
  for (let i = 0; i < n; i++) {
    if (!g.solid[i]) continue;
    const s = res.stress.subarray(i * 6, i * 6 + 6);
    const sbb = s[axis];
    across[i] = sbb;
    const k = factor ? factor[i] : 1;
    const a = res.vm[i] / (strengthXY * k);
    const b = Math.max(0, sbb) / (zStrength * k);
    fi[i] = Math.max(a, b);
    sf[i] = fi[i] > 0 ? 1 / fi[i] : Infinity;
  }
  return { fi, sf, across };
}
