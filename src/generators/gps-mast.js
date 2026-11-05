// GPS / compass mast: printed base and top platform joined by a carbon tube
// (or a printed mast). Both base and top print plate-down with the socket up.

import { bolt, boltParam, squarePattern } from '../core/hardware.js';

/** Plate with an upward socket and 4 gusset fins. */
function plateWithSocket(k, { shape, size, thickness, socketR, boreR, socketH, holes, holeR, wireHole }) {
  const plate = shape === 'round' ? k.cylZ(size / 2, 0, 0, 0, thickness, 96) : k.roundedBlock(size, size, 3, 0, thickness, 8);
  const R = socketR;
  const add = [plate, k.cylZ(R, 0, 0, thickness - 0.01, thickness + socketH, 64)];
  const finLen = Math.min(size / 2 - R - 1, socketH);
  if (finLen > 2) {
    for (const a of [45, 135, 225, 315]) {
      const fin = k.prismY([[R - 0.5, thickness - 0.01], [R + finLen, thickness - 0.01], [R - 0.5, thickness + finLen * 0.9]], -1, 1);
      add.push(k.rotate(fin, [0, 0, a]));
    }
  }
  const cuts = [k.cylZ(boreR, 0, 0, thickness + 0.8, thickness + socketH + 1, 64)];
  if (wireHole > 0) cuts.push(k.cylZ(wireHole / 2, 0, 0, -1, thickness + 1, 32));
  for (const [x, y] of holes) cuts.push(k.cylZ(holeR, x, y, -1, thickness + 1, 24));
  return k.difference(k.union(add), cuts);
}

export default {
  id: 'gps-mast',
  name: 'GPS Mast',
  sections: ['accessories', 'quads'],
  description: 'GPS / compass stand: base plate with hole pattern, top platform, carbon tube or printed mast. Raises the GPS away from noisy electronics.',
  params: {
    mast: { type: 'select', default: 'tube', group: 'Mast', label: 'Mast', options: [{ value: 'tube', label: 'Carbon / aluminum tube (sockets only)' }, { value: 'printed', label: 'Printed mast on the base' }] },
    mastOD: { type: 'number', default: 8, min: 3, max: 30, step: 0.05, unit: 'mm', label: 'Mast tube OD', group: 'Mast' },
    clearance: { type: 'number', default: 0.15, min: -0.2, max: 1, step: 0.05, unit: 'mm', label: 'Socket clearance (per side)', group: 'Mast' },
    mastHeight: { type: 'number', default: 60, min: 10, max: 300, step: 1, unit: 'mm', label: 'Printed mast height (above base socket)', group: 'Mast' },
    socketDepth: { type: 'number', default: 14, min: 5, max: 50, step: 0.5, unit: 'mm', label: 'Socket depth', group: 'Mast' },
    socketWall: { type: 'number', default: 2.4, min: 1.2, max: 8, step: 0.1, unit: 'mm', label: 'Socket wall', group: 'Mast' },
    wireHole: { type: 'number', default: 4, min: 0, max: 20, step: 0.5, unit: 'mm', label: 'Wire hole through the base (0 = none)', group: 'Mast' },

    baseShape: { type: 'select', default: 'square', group: 'Base', label: 'Base shape', options: [{ value: 'square', label: 'Square' }, { value: 'round', label: 'Round' }] },
    baseSize: { type: 'number', default: 38, min: 15, max: 150, step: 0.5, unit: 'mm', label: 'Base size', group: 'Base' },
    baseThickness: { type: 'number', default: 3, min: 1.5, max: 10, step: 0.1, unit: 'mm', label: 'Base thickness', group: 'Base' },
    baseHoleSpacing: { type: 'number', default: 30.5, min: 0, max: 140, step: 0.1, unit: 'mm', label: 'Base hole pattern (square, 0 = none)', group: 'Base', help: '30.5 or 20 to share flight controller stack holes.' },
    baseBolt: boltParam('Base', 'M3'),

    topShape: { type: 'select', default: 'round', group: 'Top', label: 'Top platform shape', options: [{ value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }] },
    topSize: { type: 'number', default: 32, min: 15, max: 150, step: 0.5, unit: 'mm', label: 'Top platform size', group: 'Top', help: 'Match your GPS puck or board.' },
    topThickness: { type: 'number', default: 2.4, min: 1.2, max: 10, step: 0.1, unit: 'mm', label: 'Top thickness', group: 'Top' },
    topHoleSpacing: { type: 'number', default: 0, min: 0, max: 140, step: 0.1, unit: 'mm', label: 'Top hole pattern (square, 0 = tape mount)', group: 'Top' },
    topBolt: boltParam('Top', 'M2'),
  },

  generate(p, k) {
    const warnings = [];
    const notes = [];
    const r = p.mastOD / 2 + p.clearance;
    const R = r + p.socketWall;
    const bb = bolt(p.baseBolt);
    const tb = bolt(p.topBolt);
    const baseHoles = p.baseHoleSpacing > 0 ? squarePattern(p.baseHoleSpacing) : [];
    const topHoles = p.topHoleSpacing > 0 ? squarePattern(p.topHoleSpacing) : [];
    if (p.baseHoleSpacing > 0 && p.baseHoleSpacing / Math.SQRT2 - bb.head / 2 < R) warnings.push('Base holes sit under the socket.');
    if (p.baseHoleSpacing + bb.head > p.baseSize * (p.baseShape === 'round' ? 0.7 : 1)) warnings.push('Base holes are outside the base. Raise baseSize.');

    let base;
    if (p.mast === 'tube') {
      base = plateWithSocket(k, { shape: p.baseShape, size: p.baseSize, thickness: p.baseThickness, socketR: R, boreR: r, socketH: p.socketDepth, holes: baseHoles, holeR: bb.clear / 2, wireHole: p.wireHole });
    } else {
      // printed mast: solid rod with a wire channel, sized like the tube so the top socket fits
      const top = p.baseThickness + p.socketDepth + p.mastHeight;
      base = plateWithSocket(k, { shape: p.baseShape, size: p.baseSize, thickness: p.baseThickness, socketR: R, boreR: 0.01, socketH: p.socketDepth, holes: baseHoles, holeR: bb.clear / 2, wireHole: 0 });
      base = k.union([base, k.cylZ(p.mastOD / 2, 0, 0, p.baseThickness + p.socketDepth - 0.5, top, 64)]);
      if (p.wireHole > 0) {
        if (p.wireHole > p.mastOD - 2.4) warnings.push('Wire hole is too big for the printed mast. It is skipped.');
        else base = k.difference(base, [k.cylZ(p.wireHole / 2, 0, 0, -1, top + 1, 32)]);
      }
      notes.push(`Printed mast ${p.mastOD} mm OD, ${p.mastHeight} mm. Print upright with 4+ perimeters, or use a carbon tube for stiffness.`);
    }
    const top = plateWithSocket(k, { shape: p.topShape, size: p.topSize, thickness: p.topThickness, socketR: R, boreR: r, socketH: p.socketDepth, holes: topHoles, holeR: tb.clear / 2, wireHole: p.wireHole });
    notes.push(`Sockets ${(2 * r).toFixed(2)} mm for a ${p.mastOD} mm mast, ${p.socketDepth} mm deep. Total GPS height = tube length + ${(p.baseThickness + p.topThickness + 1.6).toFixed(1)} mm.`);
    notes.push('Print both parts plate-down as exported. Glue the tube with epoxy or CA. Mount the GPS arrow forward.');
    return { parts: [{ name: 'base', manifold: k.placeOnBed(base) }, { name: 'top', manifold: k.placeOnBed(top) }], warnings, notes };
  },
};
