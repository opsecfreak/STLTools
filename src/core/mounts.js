// Wall mounts shared by hooks and racks: pegboard pegs, screw holes, flat back for tape.
//
// "Use" coordinates: X along the wall, Y out from the wall (wall face at y = 0,
// the part lives at y >= 0), Z up.
//
// Pegboard pegs come in two shapes, picked by how the part is printed:
//   round   - for parts printed on their side (hooks). Pegs are cylinders that
//             touch the bed, so they print without support.
//   diamond - for parts printed upright (racks). A 45 degree diamond section
//             overhangs at 45 degrees only, so it prints without support.
// The top peg bends up behind the board, like a standard metal pegboard hook.

import { teardrop } from './kernel.js';

export function mountParamSchema(group = 'Mount', { columns = false } = {}) {
  const schema = {
    mount: {
      type: 'select', default: 'pegboard', group, label: 'Mount type',
      options: [
        { value: 'pegboard', label: 'Pegboard' },
        { value: 'screw', label: 'Screw to wall' },
        { value: 'adhesive', label: 'Flat back (tape / glue)' },
      ],
    },
    pegboardPitch: { type: 'number', default: 25.4, min: 10, max: 60, step: 0.1, unit: 'mm', group, label: 'Pegboard hole spacing', help: 'US pegboard: 25.4 (1 in).' },
    pegDiameter: { type: 'number', default: 5.8, min: 3, max: 12, step: 0.1, unit: 'mm', group, label: 'Peg diameter', help: '5.8 for 1/4 in (6.35 mm) holes. 4.4 for 3/16 in holes.' },
    boardThickness: { type: 'number', default: 6.35, min: 0.5, max: 20, step: 0.05, unit: 'mm', group, label: 'Pegboard thickness', help: '6.35 for 1/4 in board, 3.2 for 1/8 in board.' },
    bottomPeg: { type: 'boolean', default: true, group, label: 'Lower anti-rotation peg' },
    screwHole: { type: 'number', default: 4.5, min: 2, max: 10, step: 0.1, unit: 'mm', group, label: 'Screw hole diameter' },
    countersink: { type: 'boolean', default: true, group, label: 'Countersink screw holes' },
    plateThickness: { type: 'number', default: 4, min: 2, max: 12, step: 0.5, unit: 'mm', group, label: 'Back plate thickness' },
  };
  if (columns) {
    schema.mountColumns = { type: 'integer', default: 2, min: 1, max: 8, group, label: 'Peg / screw columns' };
  }
  return schema;
}

/**
 * Build the mount.
 * @param opts.width   plate width (X)
 * @param opts.zMin    lowest plate Z the part needs
 * @param opts.zMax    highest plate Z the part needs (the plate grows to fit pegs/screws)
 * @param opts.style   'round' (side-printed part) or 'diamond' (upright part)
 * @param opts.columns number of peg / screw columns
 * @param opts.upAxis  'x' or 'z': which use axis is "up" while printing (for teardrop holes)
 * @returns {{ add: Manifold[], cut: Manifold[], zMin: number, zMax: number, notes: string[], warnings: string[] }}
 */
export function buildMount(k, p, { width, zMin, zMax, style, columns = 1, upAxis }) {
  const out = { add: [], cut: [], zMin, zMax, notes: [], warnings: [] };
  const T = p.plateThickness;
  const r = p.pegDiameter / 2;
  const margin = 2.5;

  if (p.mount === 'pegboard') {
    const need = (p.bottomPeg ? p.pegboardPitch : 0) + 2 * (r + margin) + 2 * r;
    out.zMax = Math.max(zMax, zMin + need);
    const zTop = out.zMax - (r + margin) - 2 * r; // leave room so the up-bend stays on the plate's level band
    const xs = [];
    if (style === 'round') {
      xs.push(-width / 2 + r); // touches the bed when printed on its side
    } else {
      const n = Math.max(1, Math.min(columns, Math.floor((width - 2 * r - 4) / p.pegboardPitch) + 1));
      if (n < columns) out.warnings.push(`Only ${n} peg column(s) fit in ${width} mm.`);
      for (let i = 0; i < n; i++) xs.push((i - (n - 1) / 2) * p.pegboardPitch);
    }
    const clr = 0.4;
    const yBend = -(p.boardThickness + clr + r); // axis of the up-bend, behind the board
    const upLen = Math.max(5, 2 * r);
    for (const x of xs) {
      if (style === 'round') {
        out.add.push(k.rod([x, T / 2, zTop], [x, yBend, zTop], r, 32));
        out.add.push(k.track(k.track(k.Manifold.sphere(r, 32)).translate([x, yBend, zTop])));
        out.add.push(k.rod([x, yBend, zTop], [x, yBend, zTop + upLen], r, 32));
        if (p.bottomPeg) out.add.push(k.rod([x, T / 2, zTop - p.pegboardPitch], [x, -p.boardThickness * 0.8, zTop - p.pegboardPitch], r, 32));
      } else {
        const diamondXZ = (zc) => [[x + r, zc], [x, zc + r], [x - r, zc], [x, zc - r]];
        out.add.push(k.prismY(diamondXZ(zTop), yBend - r, T / 2));
        // Bend starts inside the peg and is slightly thinner, so the two solids overlap
        // instead of touching along an edge (which slicers flag as non-manifold).
        const br = r * 0.9;
        out.add.push(k.prismZ([[x + br, yBend], [x, yBend + br], [x - br, yBend], [x, yBend - br]], zTop - 0.3 * r, zTop + upLen));
        if (p.bottomPeg) out.add.push(k.prismY(diamondXZ(zTop - p.pegboardPitch), -p.boardThickness * 0.8, T / 2));
      }
    }
    out.notes.push(`Pegboard: ${xs.length} peg column(s) at ${p.pegboardPitch} mm pitch, ${p.pegDiameter} mm pegs for ${p.boardThickness} mm board. Insert the top peg tilted, then rotate down.`);
  } else if (p.mount === 'screw') {
    const hr = p.screwHole / 2;
    const head = p.countersink ? hr * 2 : 0;
    const need = 2 * (Math.max(hr, head) + margin) + 10;
    out.zMax = Math.max(zMax, zMin + need);
    const zs = out.zMax - out.zMin > 60 ? [out.zMax - head - margin - 4, out.zMin + head + margin + 4] : [out.zMax - head - margin - 4];
    const n = Math.max(1, columns);
    const span = width - 2 * (head + margin);
    const xs = n === 1 ? [0] : Array.from({ length: n }, (_, i) => -span / 2 + (i * span) / (n - 1));
    const td = teardrop(hr, 24);
    for (const x of xs) {
      for (const z of zs) {
        const orient = (pts, cx, cz) => (upAxis === 'x' ? pts.map(([u, v]) => [cx + u, cz + v]) : pts.map(([u, v]) => [cx + v, cz + u]));
        if (!p.countersink) {
          out.cut.push(k.prismY(orient(td, x, z), -1, T + 1));
        } else {
          // Hole + 90 degree countersink as ONE convex solid: a teardrop prism
          // up to where the cone starts, then a teardrop cone to the face.
          // One solid has no internal edge crossings, so the STL stays clean.
          const yStart = T - (head - hr);
          const ring = (radius, y) => orient(teardrop(radius, 24), x, z).map(([px, pz]) => [px, y, pz]);
          out.cut.push(k.track(k.Manifold.hull([...ring(hr, -1), ...ring(hr, yStart), ...ring(head + 1, T + 1)])));
        }
      }
    }
    if (T < head - hr + 1.3) out.warnings.push('Back plate is thin for the countersink. Use a thicker plate or turn off countersink.');
    out.notes.push(`Screw mount: ${xs.length * zs.length} hole(s), ${p.screwHole} mm.`);
  } else {
    out.notes.push('Flat back: attach with double-sided mounting tape or adhesive strips.');
  }
  return out;
}
