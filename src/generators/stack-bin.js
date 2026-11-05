// Stackable parts bin.
//
// Stacking: the bottom of each bin steps in to a "foot" that drops into the
// opening of the bin below and self-centers on a 45 degree chamfer. Bins with
// the same width and depth stack; the foot never needs support.
//
// Optional: compartment grid, finger scoop along the front, open front
// (sloped cut so you can reach in while bins are stacked), front label.

import { labelParamSchema, frontLabel } from '../core/labels.js';

/** Outer solid with a stepped, chamfered foot. Dimensions shrink by `inset2` (2x an inset) for cavities. */
function steppedSolid(k, W, D, r, footInset, footH, z0, zTop, seg) {
  const fw = W - 2 * footInset;
  const fd = D - 2 * footInset;
  const fr = Math.max(0, r - footInset);
  const chamferTop = footH + footInset;
  const parts = [];
  if (footH > z0) parts.push(k.roundedBlock(fw, fd, fr, z0, footH, seg));
  parts.push(k.loftConvex(k.roundedRect(fw, fd, fr, seg), Math.max(z0, footH), k.roundedRect(W, D, r, seg), chamferTop));
  parts.push(k.roundedBlock(W, D, r, chamferTop, zTop, seg));
  return k.union(parts);
}

export default {
  id: 'stack-bin',
  name: 'Stackable Bin',
  sections: ['shop'],
  description: 'Parts bin that stacks on bins of the same footprint. Compartments, finger scoop, open front and label slot options. No supports.',
  params: {
    width: { type: 'number', default: 100, min: 30, max: 300, step: 1, unit: 'mm', label: 'Outer width (X)', group: 'Bin' },
    depth: { type: 'number', default: 150, min: 30, max: 300, step: 1, unit: 'mm', label: 'Outer depth (Y, front to back)', group: 'Bin' },
    height: { type: 'number', default: 70, min: 15, max: 250, step: 1, unit: 'mm', label: 'Outer height (Z)', group: 'Bin' },
    wall: { type: 'number', default: 1.6, min: 0.8, max: 6, step: 0.1, unit: 'mm', label: 'Wall thickness', group: 'Bin', help: 'Multiple of line width. 1.6 or 2.0 for big bins.' },
    floor: { type: 'number', default: 1.6, min: 0.6, max: 6, step: 0.1, unit: 'mm', label: 'Floor thickness', group: 'Bin' },
    cornerRadius: { type: 'number', default: 5, min: 0, max: 30, step: 0.5, unit: 'mm', label: 'Corner radius', group: 'Bin' },

    stackable: { type: 'boolean', default: true, label: 'Stacking foot', group: 'Stacking' },
    footHeight: { type: 'number', default: 5, min: 2, max: 20, step: 0.5, unit: 'mm', label: 'Foot height', group: 'Stacking', help: 'How deep the foot drops into the bin below.' },
    stackClearance: { type: 'number', default: 0.4, min: 0.1, max: 1.5, step: 0.05, unit: 'mm', label: 'Stack clearance per side', group: 'Stacking' },

    openFront: { type: 'boolean', default: true, label: 'Open front (reach in while stacked)', group: 'Front' },
    frontWallHeight: { type: 'number', default: 30, min: 8, max: 250, step: 1, unit: 'mm', label: 'Front wall height', group: 'Front' },
    scoopRadius: { type: 'number', default: 0, min: 0, max: 40, step: 1, unit: 'mm', label: 'Finger scoop radius (0 = none)', group: 'Front', help: 'Curved floor at the front so small parts slide out.' },

    compartmentsX: { type: 'integer', default: 1, min: 1, max: 12, label: 'Compartments across X', group: 'Dividers' },
    compartmentsY: { type: 'integer', default: 1, min: 1, max: 12, label: 'Compartments front to back', group: 'Dividers' },
    dividerThickness: { type: 'number', default: 1.2, min: 0.6, max: 5, step: 0.1, unit: 'mm', label: 'Divider thickness', group: 'Dividers' },

    ...labelParamSchema(),

    segments: { type: 'integer', default: 10, min: 2, max: 48, label: 'Corner smoothness (segments per corner)', group: 'Quality' },
  },

  generate(p, k) {
    const warnings = [];
    const notes = [];
    const W = p.width, D = p.depth, H = p.height, r = p.cornerRadius, t = p.wall;

    const inset = p.stackable ? t + p.stackClearance : 0;
    const footH = p.stackable ? p.footHeight : 0;
    const shoulder = footH + inset; // z where the full outer size starts
    if (p.stackable && p.floor >= footH) throw new Error('Floor must be thinner than the foot height.');
    if (shoulder + 5 > H) throw new Error('Bin is too short for its stacking foot.');
    if (W - 2 * inset - 2 * t < 5 || D - 2 * inset - 2 * t < 5) throw new Error('Bin is too small for its walls and foot.');

    const outer = p.stackable
      ? steppedSolid(k, W, D, r, inset, footH, 0, H, p.segments)
      : k.roundedBlock(W, D, r, 0, H, p.segments);
    const cavity = p.stackable
      ? steppedSolid(k, W - 2 * t, D - 2 * t, Math.max(0, r - t), inset, footH, p.floor, H + 1, p.segments)
      : k.roundedBlock(W - 2 * t, D - 2 * t, Math.max(0, r - t), p.floor, H + 1, p.segments);
    let bin = k.difference(outer, [cavity]);

    // Parts that must stay inside the outer skin are clipped to it.
    const inside = [];

    // Dividers stop below the foot of the bin stacked on top.
    const dividerTop = p.stackable ? H - footH - 1 : H;
    const innerW = W - 2 * t;
    const innerD = D - 2 * t;
    const dh = dividerTop - p.floor;
    for (let i = 1; i < p.compartmentsX; i++) {
      const x = -innerW / 2 + (i * innerW) / p.compartmentsX;
      inside.push(k.cuboid([p.dividerThickness, D, dh], [x, 0, p.floor + dh / 2]));
    }
    for (let j = 1; j < p.compartmentsY; j++) {
      const y = -innerD / 2 + (j * innerD) / p.compartmentsY;
      inside.push(k.cuboid([W, p.dividerThickness, dh], [0, y, p.floor + dh / 2]));
    }

    // Finger scoop: quarter-round fillet between floor and front wall.
    if (p.scoopRadius > 0) {
      const sr = p.scoopRadius;
      const yWall = -D / 2 + inset + t; // inner face of the front wall at floor level
      const block = k.cuboid([W, yWall + sr + D / 2, sr], [0, (-D / 2 + yWall + sr) / 2, p.floor + sr / 2]);
      const round = k.rod([-W, yWall + sr, p.floor + sr], [W, yWall + sr, p.floor + sr], sr, 48);
      inside.push(k.difference(block, [round]));
      if (p.compartmentsY > 1 && sr > innerD / p.compartmentsY / 2) warnings.push('Scoop is large for the front compartment row.');
    }
    if (inside.length) bin = k.union([bin, k.intersect(k.union(inside), outer)]);

    // Open front: 45 degree cut from the top of the front wall back into the side walls.
    const frontTop = p.openFront ? Math.min(p.frontWallHeight, H) : H;
    if (p.openFront && frontTop < H) {
      const run = H - frontTop;
      const cut = k.prismX([[-D / 2 - 1, frontTop], [-D / 2 + run, H + 0.01], [-D / 2 + run, H + 1], [-D / 2 - 1, H + 1]], -W / 2 - 1, W / 2 + 1);
      bin = k.difference(bin, [cut]);
      if (frontTop < shoulder + 6) warnings.push('Front wall is very low. Small parts may spill when the bin is pulled out.');
    }

    // Label on the front face, above the foot chamfer.
    const label = frontLabel(k, p, {
      faceY: -D / 2,
      zMin: shoulder + 0.5,
      zMax: frontTop - 1,
      maxWidth: W - 2 * r,
      minWall: t,
    });
    warnings.push(...label.warnings);
    if (label.add.length) bin = k.union([bin, ...label.add]);
    if (label.cut.length) bin = k.difference(bin, label.cut);

    const cellW = (innerW - (p.compartmentsX - 1) * p.dividerThickness) / p.compartmentsX;
    const cellD = (innerD - (p.compartmentsY - 1) * p.dividerThickness) / p.compartmentsY;
    notes.push(`Inside: ${cellW.toFixed(1)} x ${cellD.toFixed(1)} mm per compartment, ${(H - p.floor).toFixed(1)} mm deep.`);
    if (p.stackable) {
      notes.push(`Stacks on any bin with the same ${W} x ${D} mm footprint and wall. Stacked pitch is about ${(H - footH - p.stackClearance).toFixed(1)} mm.`);
    }
    if (label.card) notes.push(`Label card size: ${label.card.width} x ${label.card.height} mm. Make it with the Label Card generator or cut cardstock to that size.`);

    return { parts: [{ name: 'bin', manifold: bin }], warnings, notes, meta: { labelCard: label.card } };
  },
};
