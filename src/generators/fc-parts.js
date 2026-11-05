// Flight controller and vibration parts: pattern adapter plate, TPU soft-mount
// grommets, gimbal / camera damper plates.

import { bolt, boltParam, squarePattern, rotate2d } from '../core/hardware.js';

export const fcAdapter = {
  id: 'fc-adapter',
  name: 'FC Stack Adapter',
  sections: ['accessories', 'quads', 'robotics'],
  description: 'Adapter plate between hole patterns (30.5, 25.5, 20, 16 mm...). Board bosses, optional 45 deg rotation, soft-mount grommet holes, wire pass-through.',
  params: {
    outerPattern: { type: 'number', default: 30.5, min: 8, max: 120, step: 0.05, unit: 'mm', label: 'Frame pattern (square)', group: 'Patterns' },
    outerHole: { type: 'number', default: 3.4, min: 1, max: 10, step: 0.05, unit: 'mm', label: 'Frame hole diameter', group: 'Patterns', help: '3.4 for M3. Soft mount: the grommet groove diameter.' },
    innerPattern: { type: 'number', default: 20, min: 6, max: 110, step: 0.05, unit: 'mm', label: 'Board pattern (square)', group: 'Patterns' },
    innerHole: { type: 'number', default: 1.7, min: 0.8, max: 6, step: 0.05, unit: 'mm', label: 'Board hole diameter', group: 'Patterns', help: '1.7 to thread M2 into the plastic, 2.4 for M2 through.' },
    innerRotate: { type: 'number', default: 0, min: 0, max: 90, step: 45, unit: 'deg', label: 'Rotate board pattern', group: 'Patterns' },
    bossDiameter: { type: 'number', default: 5, min: 2, max: 15, step: 0.1, unit: 'mm', label: 'Board boss diameter', group: 'Plate' },
    bossHeight: { type: 'number', default: 3, min: 0, max: 20, step: 0.1, unit: 'mm', label: 'Board boss height', group: 'Plate' },
    plateSize: { type: 'number', default: 0, min: 0, max: 150, step: 0.5, unit: 'mm', label: 'Plate size (0 = auto)', group: 'Plate' },
    thickness: { type: 'number', default: 2.4, min: 1, max: 10, step: 0.1, unit: 'mm', label: 'Plate thickness', group: 'Plate' },
    centerCutout: { type: 'number', default: 10, min: 0, max: 100, step: 0.5, unit: 'mm', label: 'Center cutout (0 = none)', group: 'Plate' },
  },
  generate(p, k) {
    const warnings = [];
    if (p.innerPattern >= p.outerPattern) warnings.push('Board pattern is not smaller than the frame pattern. Check the values.');
    const T = p.thickness;
    const size = p.plateSize > 0 ? p.plateSize : p.outerPattern + p.outerHole + 6;
    const plate = k.roundedBlock(size, size, 4, 0, T, 8);
    const inner = rotate2d(squarePattern(p.innerPattern), p.innerRotate);
    const add = [plate];
    if (p.bossHeight > 0) for (const [x, y] of inner) add.push(k.cylZ(p.bossDiameter / 2, x, y, T - 0.01, T + p.bossHeight, 32));
    const cuts = [];
    for (const [x, y] of squarePattern(p.outerPattern)) cuts.push(k.cylZ(p.outerHole / 2, x, y, -1, T + 1, 32));
    for (const [x, y] of inner) cuts.push(k.cylZ(p.innerHole / 2, x, y, -1, T + p.bossHeight + 1, 24));
    if (p.centerCutout > 0) cuts.push(k.translate(k.extrude(k.roundedRect(p.centerCutout, p.centerCutout, 2, 6), T + 2), [0, 0, -1]));
    const minGap = Math.min(...inner.flatMap(([x, y]) => squarePattern(p.outerPattern).map(([a, b]) => Math.hypot(x - a, y - b))));
    if (minGap < (p.outerHole + p.bossDiameter) / 2 + 0.8) warnings.push('Board bosses collide with frame holes. Rotate the board pattern 45 deg.');
    return {
      parts: [{ name: 'adapter', manifold: k.placeOnBed(k.difference(k.union(add), cuts)) }],
      warnings,
      notes: [`${p.outerPattern} mm frame pattern to ${p.innerPattern} mm board pattern${p.innerRotate ? ` rotated ${p.innerRotate} deg` : ''}. Plate ${size.toFixed(1)} mm.`],
    };
  },
};

export const softGrommet = {
  id: 'soft-grommet',
  name: 'Soft-Mount Grommet',
  sections: ['accessories', 'quads', 'robotics'],
  description: 'TPU spool grommet that snaps into a board or plate hole to damp vibration. Prints a batch on one plate.',
  params: {
    boardHole: { type: 'number', default: 3.6, min: 1.5, max: 15, step: 0.05, unit: 'mm', label: 'Board hole diameter', group: 'Fit' },
    boardThickness: { type: 'number', default: 1.6, min: 0.4, max: 6, step: 0.05, unit: 'mm', label: 'Board / plate thickness', group: 'Fit' },
    screwHole: { type: 'number', default: 2.2, min: 0.8, max: 10, step: 0.05, unit: 'mm', label: 'Screw hole', group: 'Fit', help: 'Slightly under the screw size grips it: 2.6 for M3, 1.8 for M2.' },
    flangeDiameter: { type: 'number', default: 6.5, min: 3, max: 25, step: 0.1, unit: 'mm', label: 'Flange diameter', group: 'Shape' },
    flangeThickness: { type: 'number', default: 1.4, min: 0.6, max: 6, step: 0.1, unit: 'mm', label: 'Flange thickness', group: 'Shape' },
    count: { type: 'integer', default: 4, min: 1, max: 64, label: 'How many', group: 'Batch' },
  },
  generate(p, k) {
    const warnings = [];
    const rg = p.boardHole / 2 - 0.05; // groove sits just inside the hole
    const rF = p.flangeDiameter / 2;
    if (rF <= rg + 0.4) throw new Error('Flange must be wider than the board hole.');
    if (p.screwHole / 2 > rg - 0.4) warnings.push('Very thin groove wall around the screw.');
    const t = p.flangeThickness;
    const z1 = t; // bottom flange top
    const z2 = z1 + p.boardThickness + 0.1; // groove top
    const ch = rF - rg; // 45 deg chamfer under the top flange
    const z3 = z2 + ch;
    const z4 = z3 + t * 0.6;
    const one = k.difference(k.union([
      k.cylZ(rF, 0, 0, 0, z1, 48),
      k.cylZ(rg, 0, 0, z1 - 0.01, z2 + 0.01, 48),
      k.coneZ(rg, rF, 0, 0, z2, z3, 48),
      k.cylZ(rF, 0, 0, z3 - 0.01, z4, 48),
    ]), [k.cylZ(p.screwHole / 2, 0, 0, -1, z4 + 1, 32)]);
    const pitch = 2 * rF + 2.5;
    const cols = Math.ceil(Math.sqrt(p.count));
    const copies = Array.from({ length: p.count }, (_, i) => k.translate(one, [(i % cols) * pitch, Math.floor(i / cols) * pitch, 0]));
    return {
      parts: [{ name: `grommets-x${p.count}`, manifold: k.placeOnBed(k.union(copies)) }],
      warnings,
      notes: [`Groove ${(2 * rg).toFixed(2)} mm x ${(p.boardThickness + 0.1).toFixed(2)} mm. Print in TPU 85A-95A. Squeeze through the hole from the chamfered side.`],
    };
  },
};

export const damperPlate = {
  id: 'damper-plate',
  name: 'Damper Plates',
  sections: ['accessories', 'quads', 'robotics'],
  description: 'Two plates for rubber damping balls (gimbals, cameras, flight controllers). Set ball pattern, neck hole, and each plate\'s mounting holes.',
  params: {
    ballSpacingX: { type: 'number', default: 50, min: 8, max: 200, step: 0.1, unit: 'mm', label: 'Ball spacing X', group: 'Dampers' },
    ballSpacingY: { type: 'number', default: 40, min: 8, max: 200, step: 0.1, unit: 'mm', label: 'Ball spacing Y', group: 'Dampers' },
    ballHole: { type: 'number', default: 6.5, min: 2, max: 20, step: 0.05, unit: 'mm', label: 'Ball neck hole diameter', group: 'Dampers', help: 'Measure the groove of your damping balls.' },
    plateThickness: { type: 'number', default: 2, min: 1, max: 6, step: 0.1, unit: 'mm', label: 'Plate thickness', group: 'Dampers', help: 'Match the ball groove width.' },
    margin: { type: 'number', default: 6, min: 3, max: 30, step: 0.5, unit: 'mm', label: 'Edge margin around balls', group: 'Plates' },
    cutout: { type: 'number', default: 0, min: 0, max: 150, step: 0.5, unit: 'mm', label: 'Center cutout (0 = none)', group: 'Plates' },
    topHoleSpacing: { type: 'number', default: 20, min: 0, max: 150, step: 0.1, unit: 'mm', label: 'Payload plate hole spacing (square, 0 = none)', group: 'Plates' },
    bottomHoleSpacing: { type: 'number', default: 30.5, min: 0, max: 150, step: 0.1, unit: 'mm', label: 'Frame plate hole spacing (square, 0 = none)', group: 'Plates' },
    bolt: boltParam('Plates', 'M3', 'Plate screws'),
  },
  generate(p, k) {
    const warnings = [];
    const b = bolt(p.bolt);
    const W = p.ballSpacingX + p.ballHole + 2 * p.margin;
    const D = p.ballSpacingY + p.ballHole + 2 * p.margin;
    const balls = [[-p.ballSpacingX / 2, -p.ballSpacingY / 2], [p.ballSpacingX / 2, -p.ballSpacingY / 2], [p.ballSpacingX / 2, p.ballSpacingY / 2], [-p.ballSpacingX / 2, p.ballSpacingY / 2]];
    const plate = (holeSpacing) => {
      const cuts = balls.map(([x, y]) => k.cylZ(p.ballHole / 2, x, y, -1, p.plateThickness + 1, 40));
      if (holeSpacing > 0) for (const [x, y] of squarePattern(holeSpacing)) cuts.push(k.cylZ(b.clear / 2, x, y, -1, p.plateThickness + 1, 24));
      if (p.cutout > 0) cuts.push(k.translate(k.extrude(k.roundedRect(p.cutout, p.cutout, 3, 6), p.plateThickness + 2), [0, 0, -1]));
      return k.difference(k.roundedBlock(W, D, 5, 0, p.plateThickness, 8), cuts);
    };
    for (const s of [p.topHoleSpacing, p.bottomHoleSpacing]) {
      if (s <= 0) continue;
      const near = Math.min(...squarePattern(s).flatMap(([x, y]) => balls.map(([bx, by]) => Math.hypot(x - bx, y - by))));
      if (near < (p.ballHole + b.head) / 2 + 0.8) warnings.push(`Screw holes at ${s} mm spacing hit the damper holes. Change the spacing.`);
    }
    return {
      parts: [{ name: 'payload-plate', manifold: k.placeOnBed(plate(p.topHoleSpacing)) }, { name: 'frame-plate', manifold: k.placeOnBed(plate(p.bottomHoleSpacing)) }],
      warnings,
      notes: [`Plates ${W.toFixed(1)} x ${D.toFixed(1)} mm, 4 balls at ${p.ballSpacingX} x ${p.ballSpacingY} mm. Softer balls for light payloads.`],
    };
  },
};
