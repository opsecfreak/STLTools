// Tube clamps for carbon fiber / aluminum tubes and rods.
// Printed with tube A vertical: the ring is drawn in X/Y and extruded up the
// tube, so layers wrap around the tube (strong in hoop direction). Horizontal
// bolt holes are teardrops. No supports.
//
// Types:
//   split    - ring with a slit and pinch bolt
//   mount    - split ring + flat plate with mounting holes (tube to a surface / frame plate)
//   saddle   - U strap that screws the tube down onto a surface
//   parallel - two parallel tubes, two-piece clamp bolted together
//   cross    - two tubes at 90 degrees, one block with a pinch bolt per tube

import { bolt, boltParam } from '../core/hardware.js';
import { regularPolygon, teardrop } from '../core/kernel.js';

const SEG = 72;

/** Hex nut pocket along Y (flat on top so it bridges cleanly), at (x, z), from y0 to y1. */
function nutY(k, af, x, z, y0, y1) {
  const R = af / Math.sqrt(3);
  return k.prismY(regularPolygon(R, 6, 0).map(([a, b]) => [x + a, z + b]), y0, y1);
}

/** Pinch bolt along Y across a slit: through hole, head counterbore on +Y, nut trap on -Y. */
function pinchBolt(k, p, b, x, z, yHalf) {
  const cuts = [k.holeY(b.clear / 2, x, z, -yHalf - 1, yHalf + 1)];
  cuts.push(k.holeY(b.head / 2 + 0.3, x, z, yHalf - b.headH - 0.3, yHalf + 1));
  if (p.nutTrap) cuts.push(nutY(k, b.nutAF + 0.3, x, z, -yHalf - 1, -yHalf + b.nutH + 0.4));
  else cuts.push(k.holeY(b.head / 2 + 0.3, x, z, -yHalf - 1, -yHalf + 0.6)); // small seat for a washer
  return cuts;
}

function boltZs(p, L, b) {
  const n = p.boltsPerSide > 0 ? p.boltsPerSide : L >= 4 * b.head + 6 ? 2 : 1;
  return n === 1 ? [L / 2] : Array.from({ length: n }, (_, i) => b.head / 2 + 2 + (i * (L - b.head - 4)) / (n - 1));
}

export default {
  id: 'tube-clamp',
  name: 'Tube Clamp',
  sections: ['accessories', 'quads', 'robotics'],
  description: 'Clamps for carbon fiber tubes and rods: split ring, mount plate, saddle strap, parallel and cross clamps. Every size is adjustable.',
  params: {
    type: {
      type: 'select', default: 'mount', group: 'Clamp', label: 'Clamp type',
      options: [
        { value: 'split', label: 'Split ring (pinch bolt)' },
        { value: 'mount', label: 'Ring + mounting plate' },
        { value: 'saddle', label: 'Saddle strap (screw to surface)' },
        { value: 'parallel', label: 'Two parallel tubes (2 pieces)' },
        { value: 'cross', label: 'Two tubes at 90 deg' },
      ],
    },
    tubeOD: { type: 'number', default: 10, min: 2, max: 80, step: 0.05, unit: 'mm', label: 'Tube A outer diameter', group: 'Tube' },
    tubeOD2: { type: 'number', default: 10, min: 2, max: 80, step: 0.05, unit: 'mm', label: 'Tube B outer diameter (parallel / cross)', group: 'Tube' },
    clearance: { type: 'number', default: 0.15, min: -0.5, max: 2, step: 0.05, unit: 'mm', label: 'Bore clearance (per side)', group: 'Tube', help: 'Added to the tube radius. Negative = tighter grip. 0.1-0.2 for a clamp you tighten.' },
    length: { type: 'number', default: 16, min: 4, max: 200, step: 0.5, unit: 'mm', label: 'Clamp length along the tube', group: 'Clamp' },
    wall: { type: 'number', default: 3, min: 1.2, max: 20, step: 0.1, unit: 'mm', label: 'Ring wall thickness', group: 'Clamp' },
    slitGap: { type: 'number', default: 1.5, min: 0.4, max: 6, step: 0.1, unit: 'mm', label: 'Slit gap', group: 'Clamp', help: 'Larger gap = more squeeze range.' },
    spacing: { type: 'number', default: 0, min: 0, max: 300, step: 0.5, unit: 'mm', label: 'Tube center distance (0 = closest)', group: 'Clamp', help: 'Parallel and cross types.' },

    bolt: boltParam('Bolts', 'M3', 'Pinch bolt'),
    boltsPerSide: { type: 'integer', default: 0, min: 0, max: 6, label: 'Pinch bolts (0 = auto)', group: 'Bolts' },
    nutTrap: { type: 'boolean', default: true, label: 'Hex nut trap', group: 'Bolts' },
    earLength: { type: 'number', default: 0, min: 0, max: 40, step: 0.5, unit: 'mm', label: 'Bolt ear length (0 = auto)', group: 'Bolts' },

    plateWidth: { type: 'number', default: 36, min: 8, max: 300, step: 0.5, unit: 'mm', label: 'Plate width', group: 'Mount plate', help: 'Mount and saddle types.' },
    plateThickness: { type: 'number', default: 4, min: 1.5, max: 20, step: 0.1, unit: 'mm', label: 'Plate thickness', group: 'Mount plate' },
    mountBolt: boltParam('Mount plate', 'M3', 'Mounting screw'),
    mountHoleSpacing: { type: 'number', default: 26, min: 0, max: 300, step: 0.1, unit: 'mm', label: 'Hole spacing across the plate', group: 'Mount plate' },
    mountHolesAlong: { type: 'integer', default: 1, min: 1, max: 6, label: 'Hole rows along the tube', group: 'Mount plate' },
    countersink: { type: 'boolean', default: false, label: 'Countersink mounting holes', group: 'Mount plate' },
  },

  generate(p, k) {
    const warnings = [];
    const notes = [];
    const b = bolt(p.bolt);
    const mb = bolt(p.mountBolt);
    const L = p.length;
    const rA = p.tubeOD / 2 + p.clearance;
    const rB = p.tubeOD2 / 2 + p.clearance;
    const RA = rA + p.wall;
    const RB = rB + p.wall;
    const earLen = p.earLength > 0 ? p.earLength : b.head + 3;
    const earHalf = p.slitGap / 2 + Math.max(b.nutH + 1.6, b.headH + 1.6, 3); // ear half thickness in Y
    const zs = boltZs(p, L, b);
    if (L < b.head + 2) warnings.push(`Clamp length ${L} mm is short for an ${p.bolt} bolt head.`);

    // Split ring with ears at +X: body, plus cuts. Returns { add, cut }.
    const splitRing = (xc, r, R, dirX = 1) => {
      const x0 = xc + dirX * (r * 0.5);
      const x1 = xc + dirX * (R + earLen);
      const add = [
        k.cylZ(R, xc, 0, 0, L, SEG),
        k.cuboid([Math.abs(x1 - x0), 2 * earHalf, L], [(x0 + x1) / 2, 0, L / 2]),
      ];
      const xb = xc + dirX * (R + earLen / 2 - 0.5);
      const cut = [
        k.cylZ(r, xc, 0, -1, L + 1, SEG),
        k.cuboid([R + earLen + 2, p.slitGap, L + 2], [xc + dirX * (R + earLen + 2) / 2, 0, L / 2]),
      ];
      for (const z of zs) cut.push(...pinchBolt(k, p, b, xb, z, earHalf));
      return { add, cut };
    };

    const mountHoles = (xFace, xBack, ys) => {
      // holes along X through a plate between xBack (screw head side) and xFace (mounting face)
      const cut = [];
      const n = p.mountHolesAlong;
      const zsM = n === 1 ? [L / 2] : Array.from({ length: n }, (_, i) => mb.head / 2 + 1.5 + (i * (L - mb.head - 3)) / (n - 1));
      const lo = Math.min(xFace, xBack) - 1;
      const hi = Math.max(xFace, xBack) + 1;
      for (const y of ys) {
        for (const z of zsM) {
          if (!p.countersink) {
            cut.push(k.holeX(mb.clear / 2, y, z, lo, hi));
          } else {
            // Hole + 90 deg countersink on the head side as one convex hull (clean STL).
            const ring = (r, x) => teardrop(r, 24).map(([u, v]) => [x, y + v, z + u]);
            const dir = xBack > xFace ? 1 : -1;
            const xStart = xBack - dir * (mb.head - mb.clear) / 2;
            cut.push(k.track(k.Manifold.hull([...ring(mb.clear / 2, xFace - dir), ...ring(mb.clear / 2, xStart), ...ring(mb.head / 2 + 1, xBack + dir)])));
          }
        }
      }
      return cut;
    };

    let parts = [];

    if (p.type === 'split' || p.type === 'mount') {
      const ring = splitRing(0, rA, RA, 1);
      const add = [...ring.add];
      const cut = [...ring.cut];
      if (p.type === 'mount') {
        const xFace = -RA - p.plateThickness + Math.min(p.wall, 1.5); // mounting face
        const xBack = xFace + p.plateThickness;
        add.push(k.cuboid([p.plateThickness, p.plateWidth, L], [(xFace + xBack) / 2, 0, L / 2]));
        const half = p.mountHoleSpacing / 2;
        const ys = p.mountHoleSpacing > 0 ? [-half, half] : [0];
        if (p.mountHoleSpacing > 0 && half - mb.head / 2 < RA * 0.7) warnings.push(`Mount holes at ${p.mountHoleSpacing} mm spacing sit under the ring. Increase mountHoleSpacing to at least ${(2 * (RA * 0.7 + mb.head / 2)).toFixed(1)} mm.`);
        if (p.mountHoleSpacing === 0) warnings.push('One center mount hole sits under the tube. Use spacing > 0 unless you drill through the tube side.');
        if (half + mb.head / 2 > p.plateWidth / 2) warnings.push('Mount holes are outside the plate. Raise plateWidth or lower mountHoleSpacing.');
        cut.push(...mountHoles(xFace, xBack, ys));
        notes.push(`Mounting face is flat, ${p.plateWidth} x ${L} mm, ${(RA - Math.min(p.wall, 1.5) + p.plateThickness).toFixed(1)} mm from the tube center.`);
      }
      parts.push({ name: 'clamp', manifold: k.difference(k.union(add), cut) });
    } else if (p.type === 'saddle') {
      const base = -rA + 0.3; // strap face sits 0.3 mm above the tube's contact line: tightening squeezes the tube
      const earT = p.plateThickness;
      const halfW = Math.max(p.plateWidth / 2, RA + mb.head + 2);
      const arch = k.difference(k.cylZ(RA, 0, 0, 0, L, SEG), [k.cuboid([RA * 2 + 2, RA * 2 + 2, L + 2], [base - RA - 1, 0, L / 2])]);
      const ears = k.cuboid([earT, 2 * halfW, L], [base + earT / 2, 0, L / 2]);
      const ys = [-(RA + (halfW - RA) / 2), RA + (halfW - RA) / 2];
      const cut = [k.cylZ(rA, 0, 0, -1, L + 1, SEG), ...mountHoles(base, base + earT, ys)];
      parts.push({ name: 'saddle', manifold: k.difference(k.union([arch, ears]), cut) });
      notes.push('Screw holes go into the surface under the tube. The strap is 0.3 mm short so it squeezes the tube.');
    } else if (p.type === 'parallel') {
      const s = p.spacing > 0 ? p.spacing : rA + rB + Math.max(p.wall, b.clear + 3);
      if (s < rA + rB + 1) warnings.push('Tubes overlap or the wall between them is under 1 mm.');
      const xA = -s / 2, xB = s / 2;
      const body = k.union([
        k.hull([k.cylZ(RA, xA, 0, 0, L, SEG), k.cylZ(RB, xB, 0, 0, L, SEG)]),
      ]);
      const yHalf = Math.max(RA, RB);
      const boltXs = [0, xA - RA - earLen / 2 + 1, xB + RB + earLen / 2 - 1];
      const ears = [
        k.cuboid([earLen + 2, 2 * yHalf * 0.9, L], [xA - RA - earLen / 2 + 1, 0, L / 2]),
        k.cuboid([earLen + 2, 2 * yHalf * 0.9, L], [xB + RB + earLen / 2 - 1, 0, L / 2]),
      ];
      let whole = k.union([body, ...ears]);
      const cuts = [k.cylZ(rA, xA, 0, -1, L + 1, SEG), k.cylZ(rB, xB, 0, -1, L + 1, SEG)];
      for (const x of boltXs) for (const z of zs) cuts.push(...pinchBolt(k, p, b, x, z, yHalf * 0.9));
      if (s - rA - rB < b.clear + 2) warnings.push('Not enough room for the center bolt between the tubes. Increase spacing or use a smaller bolt.');
      whole = k.difference(whole, cuts);
      const big = 4 * (s + RA + RB + earLen);
      const halfA = k.intersect(whole, k.cuboid([big, big, L + 2], [0, big / 2 + p.slitGap / 2, L / 2]));
      const halfB = k.intersect(whole, k.cuboid([big, big, L + 2], [0, -big / 2 - p.slitGap / 2, L / 2]));
      parts.push({ name: 'half-head-side', manifold: halfA }, { name: 'half-nut-side', manifold: halfB });
      notes.push(`Tube centers ${s.toFixed(1)} mm apart. Print both halves flat side up as exported.`);
    } else if (p.type === 'cross') {
      // Tube A vertical at x = -s/2 (clamped by a Y bolt at the -X end),
      // tube B along Y at x = +s/2 (clamped by a vertical bolt at the +X end).
      const s = p.spacing > 0 ? p.spacing : rA + rB + p.wall;
      const H = Math.max(L, 2 * RB);
      const W = Math.max(L, 2 * RA);
      const xA = -s / 2, xB = s / 2, zB = H / 2;
      const x0 = xA - RA - earLen;
      const x1 = xB + RB + earLen;
      let block = k.cuboid([x1 - x0, W, H], [(x0 + x1) / 2, 0, H / 2]);
      const cuts = [
        k.cylZ(rA, xA, 0, -1, H + 1, SEG),
        k.holeY(rB, xB, zB, -W / 2 - 1, W / 2 + 1, SEG),
        // slit A: vertical plane y = 0 from tube A to the -X end
        k.cuboid([xA - x0 + 1, p.slitGap, H + 2], [(x0 + xA) / 2 - 0.5, 0, H / 2]),
        // slit B: horizontal plane z = zB from tube B to the +X end
        k.cuboid([x1 - xB + 1, W + 2, p.slitGap], [(xB + x1) / 2 + 0.5, 0, zB]),
      ];
      const zsA = boltZs(p, H, b);
      for (const z of zsA) cuts.push(...pinchBolt(k, p, b, xA - RA - earLen / 2 + 0.5, z, W / 2));
      // vertical bolt for B through the slit, head on top, nut at the bottom
      const xb = xB + RB + earLen / 2 - 0.5;
      const ysB = W >= 4 * b.head + 6 ? [-W / 4, W / 4] : [0];
      for (const y of ysB) {
        cuts.push(k.cylZ(b.clear / 2, xb, y, -1, H + 1, 24));
        cuts.push(k.cylZ(b.head / 2 + 0.3, xb, y, H - b.headH - 0.3, H + 1, 32));
        if (p.nutTrap) cuts.push(k.hexZ(b.nutAF + 0.3, xb, y, -1, b.nutH + 0.4, 30));
      }
      if (s < rA + rB + 1) warnings.push('Tubes overlap. Increase spacing.');
      block = k.difference(block, cuts);
      parts.push({ name: 'cross-clamp', manifold: block });
      notes.push(`Tube centers ${s.toFixed(1)} mm apart (offset between the two tube axes).`);
    }

    parts = parts.map((pt) => ({ ...pt, manifold: k.placeOnBed(pt.manifold) }));
    notes.push(`Bore ${(2 * rA).toFixed(2)} mm for a ${p.tubeOD} mm tube${p.type === 'parallel' || p.type === 'cross' ? `, ${(2 * rB).toFixed(2)} mm for a ${p.tubeOD2} mm tube` : ''}. ${p.bolt} bolt${p.nutTrap ? ' with nut trap' : ''}.`);
    notes.push('Print as exported. PETG or ASA hold clamping force better than PLA. If the bore is tight, raise clearance by 0.05 mm.');
    return { parts, warnings, notes };
  },
};
