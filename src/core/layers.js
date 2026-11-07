// Layer preview: a slicer-style look at a part, layer by layer, without a slicer.
//
// Each layer is a cross-section of the solid at mid-layer height (manifold slice).
// Walls are insets of that outline (one line width apart). The rest is filled with
// straight lines: solid skin where the part is within `shellLayers` of a top or bottom
// surface, sparse infill elsewhere (direction turns 90 degrees every layer). Time per
// layer uses the same speeds, flow cap and efficiency as estimate.js.
//
// It is a preview, not G-code: no seams, no travel paths, no supports, no bridges, no
// gap fill. Use it to see walls, thin spots and where infill goes; the slicer decides.

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null ? Number(v) : d);
const q = (v) => Math.round(v * 100) / 100;

/** Polygon perimeter (closed). */
function perim(poly) {
  let L = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}

/**
 * Straight fill lines inside polygons (even-odd), at `angle` degrees, `spacing` apart.
 * -> flat [x1, y1, x2, y2, ...] and total length.
 */
export function hatch(polys, spacing, angle) {
  const out = [];
  let len = 0;
  if (!polys.length || !(spacing > 0)) return { segs: out, len };
  const c = Math.cos((angle * Math.PI) / 180), s = Math.sin((angle * Math.PI) / 180);
  // rotate by -angle so the lines are horizontal
  const rp = polys.map((p) => p.map(([x, y]) => [x * c + y * s, -x * s + y * c]));
  let lo = Infinity, hi = -Infinity;
  for (const p of rp) for (const v of p) { lo = Math.min(lo, v[1]); hi = Math.max(hi, v[1]); }
  const start = Math.ceil(lo / spacing) * spacing; // lines on a fixed grid: same lines on every layer of one direction
  for (let y = start; y <= hi; y += spacing) {
    const xs = [];
    for (const p of rp) for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x1 = xs[i], x2 = xs[i + 1];
      if (x2 - x1 < 0.05) continue;
      len += x2 - x1;
      // rotate back
      out.push(q(x1 * c - y * s), q(x1 * s + y * c), q(x2 * c - y * s), q(x2 * s + y * c));
    }
  }
  return { segs: out, len };
}

/**
 * Slice a solid into preview layers.
 * opts: { layerHeight, walls, shellLayers, infill (%), lineWidth, firstLayerHeight?, maxLayers? }
 * profile: printer profile (speeds, maxVolumetricFlow, motionEfficiency, layerOverheadSeconds, nozzle)
 * -> { layerHeight, lineWidth, bounds, layers: [{ z, outer: [[x,y,...]], inner: [[...]], skin: [...], infill: [...], seconds, mm: { walls, skin, infill } }], totals }
 */
export function sliceLayers(k, solid, opts = {}, profile = {}) {
  const lh = Math.max(0.05, num(opts.layerHeight, 0.2));
  const nozzle = num(profile.nozzle, 0.4);
  const lw = Math.max(0.2, num(opts.lineWidth, num(profile.lineWidth, nozzle * 1.125)));
  const walls = Math.max(1, Math.min(10, Math.round(num(opts.walls, 3))));
  const shell = Math.max(0, Math.min(20, Math.round(num(opts.shellLayers, 4))));
  const infill = Math.max(0, Math.min(100, num(opts.infill, 15)));
  const sp = { outerWall: 60, innerWall: 80, infill: 100, topBottom: 60, firstLayer: 30, ...(profile.speeds ?? {}) };
  const maxFlow = num(profile.maxVolumetricFlow, 12);
  const eff = Math.min(1, Math.max(0.2, num(profile.motionEfficiency, 0.7)));
  const overhead = num(profile.layerOverheadSeconds, 1.5);
  const bb = solid.boundingBox();
  const z0 = bb.min[2], height = bb.max[2] - bb.min[2];
  const count = Math.max(1, Math.ceil(height / lh - 1e-6));
  const maxLayers = Math.max(1, num(opts.maxLayers, 3000));
  if (count > maxLayers) throw new Error(`${count} layers at ${lh} mm: more than ${maxLayers}. Use a thicker layer for the preview.`);

  // cross-section of each layer and its infill region (inside the walls)
  const sections = [];
  for (let i = 0; i < count; i++) {
    const z = z0 + Math.min(height - 1e-4, (i + 0.5) * lh);
    const cs = k.track(solid.slice(z));
    const inside = cs.isEmpty() ? cs : k.track(cs.offset(-lw * walls, 'Miter', 2));
    sections.push({ z: z0 + (i + 1) * lh, cs, inside });
  }
  const unit = k.track(k.CrossSection.square([1, 1]));
  const empty = k.track(unit.subtract(unit));
  const insideAt = (i) => (i < 0 || i >= count ? empty : sections[i].inside);

  const speed = (v) => Math.min(v, maxFlow / (lw * lh)); // mm/s, capped by flow
  const layers = [];
  const totals = { seconds: 0, walls: 0, skin: 0, infill: 0 };
  const sparse = infill > 0 ? lw / (infill / 100) * 2 : 0; // two directions over two layers make the grid
  for (let i = 0; i < count; i++) {
    const { z, cs, inside } = sections[i];
    const L = { z: q(z), outer: [], inner: [], skin: [], infill: [], seconds: 0, mm: { walls: 0, skin: 0, infill: 0 } };
    if (cs.isEmpty()) { layers.push(L); continue; }
    let outerLen = 0, innerLen = 0;
    for (let w = 0; w < walls; w++) {
      const ring = k.track(cs.offset(-lw * (w + 0.5), 'Miter', 2));
      if (ring.isEmpty()) break;
      for (const poly of ring.toPolygons()) {
        if (poly.length < 2) continue;
        const flat = poly.flatMap(([x, y]) => [q(x), q(y)]);
        const len = perim(poly);
        if (w === 0) { L.outer.push(flat); outerLen += len; } else { L.inner.push(flat); innerLen += len; }
      }
    }
    // skin: what is inside here but not covered by the layers `shell` above and below
    let skinRegion = empty, sparseRegion = inside;
    if (!inside.isEmpty()) {
      if (shell > 0) {
        const covered = k.track(insideAt(i - shell).intersect(insideAt(i + shell)));
        skinRegion = k.track(inside.subtract(covered));
        sparseRegion = k.track(inside.intersect(covered));
      }
    }
    const angle = i % 2 ? -45 : 45;
    const sk = skinRegion.isEmpty() ? { segs: [], len: 0 } : hatch(skinRegion.toPolygons(), lw, angle);
    const inf = sparse && !sparseRegion.isEmpty() ? hatch(sparseRegion.toPolygons(), sparse, angle) : { segs: [], len: 0 };
    L.skin = sk.segs;
    L.infill = inf.segs;
    const first = i === 0;
    const t = first
      ? (outerLen + innerLen + sk.len + inf.len) / speed(sp.firstLayer)
      : outerLen / speed(sp.outerWall) + innerLen / speed(sp.innerWall) + sk.len / speed(sp.topBottom) + inf.len / speed(sp.infill);
    L.seconds = Math.round((t / eff + overhead) * 10) / 10;
    L.mm = { walls: Math.round(outerLen + innerLen), skin: Math.round(sk.len), infill: Math.round(inf.len) };
    totals.seconds += L.seconds; totals.walls += L.mm.walls; totals.skin += L.mm.skin; totals.infill += L.mm.infill;
    layers.push(L);
  }
  totals.seconds = Math.round(totals.seconds);
  const extruded = (totals.walls + totals.skin + totals.infill) * lw * lh; // mm3
  totals.filamentMm = Math.round(extruded / (Math.PI * (num(profile.filamentDiameter, 1.75) / 2) ** 2));
  return {
    layerHeight: lh, lineWidth: q(lw), walls, shellLayers: shell, infill,
    bounds: { min: bb.min.map(q), max: bb.max.map(q) },
    layers, totals,
    note: 'Preview from cross-sections: walls, solid skin and infill lines. No seams, travel, supports or bridges; the slicer decides the real paths.',
  };
}
