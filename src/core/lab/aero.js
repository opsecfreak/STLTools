// Wind tunnel models (browser and Node; no imports). SI units unless named (mm for geometry).
//
// 1. Air: ISA standard atmosphere, Sutherland viscosity.
// 2. Wing section: Hess-Smith panel method (constant-strength sources + one vortex,
//    Kutta condition), as in Moran, "An Introduction to Theoretical and Computational
//    Aerodynamics" / Katz & Plotkin, "Low-Speed Aerodynamics". Inviscid: gives Cp, Cl,
//    Cm, streamlines; no stall and no drag (drag is added from skin friction below).
// 3. Finite wing: Prandtl lifting-line result for the lift slope and induced drag with
//    an Oswald efficiency e (user setting).
// 4. Profile drag: flat-plate skin friction (laminar Blasius 1.328/sqrt(Re), turbulent
//    0.455/log10(Re)^2.58) x form factor x wetted area, Raymer "Aircraft Design:
//    A Conceptual Approach" (wing FF and wetted-area formulas).
// 5. Bodies: drag = 0.5 rho V^2 A Cd with Cd from a reference shape (Hoerner, "Fluid-
//    Dynamic Drag", values as commonly tabulated) or the user's own Cd.

export const G0 = 9.80665;

/** ISA air at altitude h (m); tempC overrides the temperature. -> { rho kg/m3, mu Pa s, nu m2/s, T K, p Pa } */
export function air(altitudeM = 0, tempC = null) {
  const Tisa = 288.15 - 0.0065 * altitudeM;
  const p = 101325 * (Tisa / 288.15) ** 5.25588;
  const T = tempC === null || tempC === undefined || tempC === '' ? Tisa : Number(tempC) + 273.15;
  const rho = p / (287.053 * T);
  const mu = (1.458e-6 * T ** 1.5) / (T + 110.4);
  return { rho, mu, nu: mu / rho, T, p };
}

/** NACA 4-digit section (for tests and as a reference shape): m, p, t as fractions, n points per side. */
export function naca4(m, p, t, n = 80) {
  const pts = (upper) => Array.from({ length: n + 1 }, (_, k) => {
    const x = 0.5 * (1 - Math.cos((Math.PI * k) / n));
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = !m ? 0 : x < p ? (m / p ** 2) * (2 * p * x - x ** 2) : (m / (1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x ** 2);
    const dyc = !m ? 0 : x < p ? (2 * m / p ** 2) * (p - x) : (2 * m / (1 - p) ** 2) * (p - x);
    const th = Math.atan(dyc);
    return upper ? [x - yt * Math.sin(th), yc + yt * Math.cos(th)] : [x + yt * Math.sin(th), yc - yt * Math.cos(th)];
  });
  const lower = pts(false).reverse(); // TE -> LE
  const upper = pts(true).slice(1); // LE -> TE
  return [...lower, ...upper];
}

/**
 * Panel method on a closed section, nodes ordered clockwise: trailing edge, lower
 * surface to the leading edge, upper surface back to the trailing edge (as naca4 gives).
 * alphaDeg: angle of attack. -> { cl, cm (about x = 0.25 chord), cp: [{x, y, cp}], q, gamma, field(x, y) }
 */
export function panel(nodes, alphaDeg) {
  const N = nodes.length - 1;
  const a = (alphaDeg * Math.PI) / 180;
  const xs = nodes.map((p) => p[0]), ys = nodes.map((p) => p[1]);
  const chord = Math.max(...xs) - Math.min(...xs);
  const th = [], len = [], cx = [], cy = [];
  for (let j = 0; j < N; j++) {
    const dx = xs[j + 1] - xs[j], dy = ys[j + 1] - ys[j];
    th.push(Math.atan2(dy, dx));
    len.push(Math.hypot(dx, dy));
    cx.push((xs[j] + xs[j + 1]) / 2);
    cy.push((ys[j] + ys[j + 1]) / 2);
  }
  // unit source and unit vortex velocity of panel j at point (px, py), global axes
  const induced = (px, py, j, self = false) => {
    const r1x = xs[j] - px, r1y = ys[j] - py, r2x = xs[j + 1] - px, r2y = ys[j + 1] - py;
    const r1 = Math.hypot(r1x, r1y), r2 = Math.hypot(r2x, r2y);
    const beta = self ? Math.PI : Math.atan2(r1x * r2y - r1y * r2x, r1x * r2x + r1y * r2y);
    const lg = self ? 0 : Math.log(r2 / r1);
    const c = Math.cos(th[j]), s = Math.sin(th[j]);
    const us = -lg / (2 * Math.PI), vs = beta / (2 * Math.PI); // source, panel axes
    const uv = beta / (2 * Math.PI), vv = lg / (2 * Math.PI); // vortex, panel axes
    return { sx: us * c - vs * s, sy: us * s + vs * c, vx: uv * c - vv * s, vy: uv * s + vv * c };
  };
  const A = Array.from({ length: N + 1 }, () => new Float64Array(N + 1));
  const rhs = new Float64Array(N + 1);
  const At = Array.from({ length: N }, () => new Float64Array(N + 1)); // tangential influence (for Vt)
  for (let i = 0; i < N; i++) {
    const nx = -Math.sin(th[i]), ny = Math.cos(th[i]), tx = Math.cos(th[i]), ty = Math.sin(th[i]);
    let vortN = 0, vortT = 0;
    for (let j = 0; j < N; j++) {
      const v = induced(cx[i], cy[i], j, i === j);
      A[i][j] = v.sx * nx + v.sy * ny;
      At[i][j] = v.sx * tx + v.sy * ty;
      vortN += v.vx * nx + v.vy * ny;
      vortT += v.vx * tx + v.vy * ty;
    }
    A[i][N] = vortN;
    At[i][N] = vortT;
    rhs[i] = -(Math.cos(a) * nx + Math.sin(a) * ny);
  }
  // Kutta: tangential velocity on the first and last panel cancel at the trailing edge
  for (let j = 0; j <= N; j++) A[N][j] = At[0][j] + At[N - 1][j];
  rhs[N] = -(Math.cos(a) * Math.cos(th[0]) + Math.sin(a) * Math.sin(th[0])) - (Math.cos(a) * Math.cos(th[N - 1]) + Math.sin(a) * Math.sin(th[N - 1]));
  const sol = gauss(A, rhs);
  const q = sol.slice(0, N), gamma = sol[N];
  const cp = [];
  let fx = 0, fy = 0, mz = 0;
  const xref = Math.min(...xs) + 0.25 * chord;
  for (let i = 0; i < N; i++) {
    let vt = Math.cos(a) * Math.cos(th[i]) + Math.sin(a) * Math.sin(th[i]);
    for (let j = 0; j <= N; j++) vt += At[i][j] * (j < N ? q[j] : gamma);
    const c = 1 - vt * vt;
    cp.push({ x: cx[i], y: cy[i], cp: c });
    // pressure force on the panel (outward normal is left of the clockwise direction)
    const nx = -Math.sin(th[i]), ny = Math.cos(th[i]);
    const dFx = -c * nx * len[i], dFy = -c * ny * len[i];
    fx += dFx; fy += dFy;
    mz += (cx[i] - xref) * dFy - cy[i] * dFx;
  }
  const cl = (-fx * Math.sin(a) + fy * Math.cos(a)) / chord;
  const cm = -mz / (chord * chord);
  const field = (px, py) => {
    let u = Math.cos(a), v = Math.sin(a);
    for (let j = 0; j < N; j++) { const w = induced(px, py, j); u += q[j] * w.sx + gamma * w.vx; v += q[j] * w.sy + gamma * w.vy; }
    return [u, v];
  };
  return { cl, cm, cp, q, gamma, chord, field, clCirculation: (2 * gamma * len.reduce((s, l) => s + l, 0)) / chord };
}

function gauss(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-30;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / d;
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / (M[r][r] || 1e-30);
  }
  return x;
}

/**
 * Cut a mesh with the plane {span axis = s} and return the section as 2D points in
 * (flow axis, lift axis), ordered for panel(): chord normalized to 1 from the leading
 * edge. -> { nodes, chordMm, thickness (t/c), leMm, ok, reason }
 */
export function section(pos, opts) {
  const first = sectionOnce(pos, opts, 1);
  // a cambered section printed upside down (camber toward -lift): look at it from the other side
  if (first.ok && first.camber < -0.002) {
    const flipped = sectionOnce(pos, opts, -1);
    if (flipped.ok) return { ...flipped, liftFlipped: true };
  }
  return { ...first, liftFlipped: false };
}

function sectionOnce(pos, { flowAxis = 0, spanAxis = 1, liftAxis = 2, at, points = 80 }, liftSign) {
  const segs = [];
  for (let t = 0; t < pos.length; t += 9) {
    const P = [0, 1, 2].map((k) => [pos[t + k * 3], pos[t + k * 3 + 1], pos[t + k * 3 + 2]]);
    const d = P.map((p) => p[spanAxis] - at);
    const cut = [];
    for (let e = 0; e < 3; e++) {
      const p = P[e], q = P[(e + 1) % 3], dp = d[e], dq = d[(e + 1) % 3];
      if ((dp < 0 && dq >= 0) || (dp >= 0 && dq < 0)) {
        const f = dp / (dp - dq);
        cut.push([p[flowAxis] + f * (q[flowAxis] - p[flowAxis]), liftSign * (p[liftAxis] + f * (q[liftAxis] - p[liftAxis]))]);
      }
    }
    if (cut.length === 2) segs.push(cut);
  }
  if (segs.length < 6) return { ok: false, reason: 'The cut plane misses the part (no section there).' };
  // chain segments into loops (segments come in any direction: walk an undirected graph)
  const r3 = (v) => (Math.round(v * 1000) + 0) / 1000; // + 0 turns -0 into 0, so 0.000 and -0.000 meet
  const key = (p) => `${r3(p[0]).toFixed(3)},${r3(p[1]).toFixed(3)}`;
  const adj = new Map();
  const pt = new Map();
  const link = (a, b) => { const ka = key(a), kb = key(b); if (ka === kb) return; pt.set(ka, a); pt.set(kb, b); (adj.get(ka) ?? adj.set(ka, []).get(ka)).push(kb); (adj.get(kb) ?? adj.set(kb, []).get(kb)).push(ka); };
  for (const [a, b] of segs) link(a, b);
  const used = new Set();
  const loops = [];
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let prev = null, cur = start;
    while (cur && !used.has(cur)) {
      used.add(cur);
      loop.push(pt.get(cur));
      const next = (adj.get(cur) ?? []).find((k) => k !== prev && !used.has(k));
      prev = cur;
      cur = next;
    }
    if (loop.length > 5) loops.push(loop);
  }
  const area = (l) => Math.abs(l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  const loop = loops.sort((x, y) => area(y) - area(x))[0];
  if (!loop) return { ok: false, reason: 'Could not close the section outline.' };
  // the leading edge is the round, thick end; the trailing edge the thin one. If the part
  // faces the other way, mirror the flow coordinate so air meets the leading edge first.
  let xsl = loop.map((p) => p[0]);
  let mirrored = false;
  {
    const lo = Math.min(...xsl), hi = Math.max(...xsl), w = (hi - lo) * 0.04;
    const ext = (near) => { const ys = loop.filter((p) => Math.abs(p[0] - near) <= w).map((p) => p[1]); return ys.length ? Math.max(...ys) - Math.min(...ys) : 0; };
    if (ext(hi) > ext(lo) * 1.2) { for (const p of loop) p[0] = -p[0]; xsl = loop.map((p) => p[0]); mirrored = true; }
  }
  const le = Math.min(...xsl), te = Math.max(...xsl), chordMm = te - le;
  // split into upper and lower at the leading and trailing edge points, interpolate each surface
  const iLe = xsl.indexOf(le), iTe = xsl.indexOf(te);
  const walk = (from, to) => { const out = []; for (let i = from; ; i = (i + 1) % loop.length) { out.push(loop[i]); if (i === to) break; } return out; };
  const s1 = walk(iTe, iLe), s2 = walk(iLe, iTe);
  const meanY = (s) => s.reduce((acc, p) => acc + p[1], 0) / s.length;
  const upperRaw = meanY(s1) > meanY(s2) ? s1 : s2;
  const lowerRaw = upperRaw === s1 ? s2 : s1;
  const interp = (surf, x) => {
    const pts = [...surf].sort((p, q) => p[0] - q[0]);
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      if (x >= x0 && x <= x1) return x1 === x0 ? y0 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
    return pts[x <= pts[0][0] ? 0 : pts.length - 1][1];
  };
  const xsCos = Array.from({ length: points + 1 }, (_, k) => 0.5 * (1 - Math.cos((Math.PI * k) / points)));
  const yLE = interp(upperRaw, le);
  const toNorm = (x, y) => [(x - le) / chordMm, (y - yLE) / chordMm];
  // Printed wings have a blunt trailing edge (minimum printable thickness). For the flow
  // model the thickness is tapered to zero over the last 3 % of chord so the trailing edge
  // is sharp (the Kutta condition needs one); the camber line is kept.
  const surf = (f, upperSide) => {
    const x = le + f * chordMm;
    const xs = le + Math.min(f, 0.999) * chordMm; // the blunt edge face itself is not part of the camber line
    const yu = interp(upperRaw, xs), yl = interp(lowerRaw, xs);
    const mid = (yu + yl) / 2, half = (yu - yl) / 2;
    const w = f > 0.97 ? Math.max(0, (1 - f) / 0.03) : 1;
    return toNorm(x, mid + (upperSide ? 1 : -1) * half * w);
  };
  const lower = xsCos.map((f) => surf(f, false)).reverse();
  const upper = xsCos.slice(1).map((f) => surf(f, true));
  const nodes = [...lower, ...upper];
  let tmax = 0, camber = 0;
  const yTE = (interp(upperRaw, te) + interp(lowerRaw, te)) / 2;
  for (const f of xsCos) {
    const yu = interp(upperRaw, le + f * chordMm), yl = interp(lowerRaw, le + f * chordMm);
    tmax = Math.max(tmax, (yu - yl) / chordMm);
    camber += (((yu + yl) / 2 - (yLE + (yTE - yLE) * f)) / chordMm) / xsCos.length; // mean camber above the chord line
  }
  return { ok: true, nodes, chordMm, thickness: tmax, camber, leMm: mirrored ? -le : le, mirrored };
}

/** Skin-friction coefficient of a flat plate at Reynolds number re (laminar below 5e5). */
export const skinFriction = (re) => (re < 5e5 ? 1.328 / Math.sqrt(Math.max(re, 1)) : 0.455 / Math.log10(re) ** 2.58);

/**
 * Wing polar from a section: panel method per angle, lifting-line correction, drag build-up.
 *   wing: { spanMm, areaMm2, chordMm, thickness (t/c) }, opts: { speed m/s, altitude m, tempC, e (Oswald), clMax (optional), alphas: [deg...] }
 * -> { rows: [{ alpha, cl2d, CL, CDi, CD0, CD, LD, liftN, dragN, cm }], a0 (1/rad), alpha0 (deg), re, AR, air }
 */
export function wingPolar(nodes, wing, opts) {
  const at = air(opts.altitude ?? 0, opts.tempC);
  const V = Number(opts.speed);
  const c = wing.chordMm / 1000;
  const S = wing.areaMm2 / 1e6;
  const b = wing.spanMm / 1000;
  const AR = (b * b) / S;
  const e = Number(opts.e ?? 0.9);
  const re = (V * c) / at.nu;
  // lift slope and zero-lift angle from two panel solutions
  const p1 = panel(nodes, 0), p2 = panel(nodes, 4);
  const a0 = (p2.cl - p1.cl) / ((4 * Math.PI) / 180);
  const alpha0 = (-p1.cl / a0) * (180 / Math.PI);
  const a3 = a0 / (1 + a0 / (Math.PI * e * AR));
  const t = wing.thickness ?? 0.12;
  const FF = 1 + (0.6 / 0.3) * t + 100 * t ** 4; // Raymer, max thickness at 30 % chord assumed
  const swetRatio = 1.977 + 0.52 * t; // wetted / reference area, Raymer
  const CD0 = skinFriction(re) * FF * swetRatio;
  const q = 0.5 * at.rho * V * V;
  const rows = (opts.alphas ?? [-4, -2, 0, 2, 4, 6, 8, 10, 12]).map((alpha) => {
    const sec = panel(nodes, alpha);
    let CL = a3 * ((alpha - alpha0) * Math.PI / 180);
    const clMax = opts.clMax ? Number(opts.clMax) : null;
    const stalled = clMax !== null && Math.abs(CL) > clMax;
    if (stalled) CL = Math.sign(CL) * clMax;
    const CDi = (CL * CL) / (Math.PI * e * AR);
    const CD = CD0 + CDi;
    return { alpha, cl2d: sec.cl, cm: sec.cm, CL, CDi, CD0, CD, LD: CL / CD, liftN: q * S * CL, dragN: q * S * CD, stalled };
  });
  return { rows, a0, alpha0, re, AR, air: at, q, S, e };
}

/** Reference drag coefficients (Hoerner, Fluid-Dynamic Drag; flow along the axis named). */
export const BODY_CD = {
  sphere: { name: 'Sphere', cd: 0.47 },
  'half-sphere': { name: 'Half-sphere (flat face back)', cd: 0.42 },
  cone: { name: 'Cone (point first)', cd: 0.5 },
  cube: { name: 'Cube (face first)', cd: 1.05 },
  'cube-edge': { name: 'Cube (edge first)', cd: 0.8 },
  'long-cylinder': { name: 'Long cylinder (end first)', cd: 0.82 },
  'short-cylinder': { name: 'Short cylinder (end first)', cd: 1.15 },
  streamlined: { name: 'Streamlined body', cd: 0.04 },
  'streamlined-half': { name: 'Streamlined half-body', cd: 0.09 },
};

/** Drag force (N) on a body: frontal area in mm2, speed m/s, cd. */
export function bodyDrag(frontalMm2, speed, cd, altitude = 0, tempC = null) {
  const at = air(altitude, tempC);
  return 0.5 * at.rho * speed * speed * (frontalMm2 / 1e6) * cd;
}
