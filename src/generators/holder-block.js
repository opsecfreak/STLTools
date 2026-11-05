// Holder block: a solid block with a grid of pockets for bits, batteries,
// SD cards, drivers, markers and similar items. Printed upright, pockets open up.

import { labelParamSchema, frontLabel } from '../core/labels.js';

export default {
  id: 'holder-block',
  name: 'Holder Block',
  sections: ['shop'],
  description: 'Block with a grid of round, hex, square or slot pockets. Bits, batteries, SD cards, USB sticks, drivers, markers.',
  params: {
    shape: {
      type: 'select', default: 'hex', group: 'Pockets', label: 'Pocket shape',
      options: [
        { value: 'round', label: 'Round' },
        { value: 'hex', label: 'Hex (size = across flats)' },
        { value: 'square', label: 'Square / rectangle' },
        { value: 'slot', label: 'Slot (rounded rectangle)' },
      ],
    },
    itemSize: { type: 'number', default: 6.35, min: 0.5, max: 120, step: 0.05, unit: 'mm', label: 'Item size X (diameter / across flats / width)', group: 'Pockets' },
    itemSize2: { type: 'number', default: 0, min: 0, max: 120, step: 0.05, unit: 'mm', label: 'Item size Y (0 = same as X)', group: 'Pockets', help: 'For square, rectangle and slot pockets.' },
    clearance: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.05, unit: 'mm', label: 'Clearance added to the size', group: 'Pockets' },
    pocketDepth: { type: 'number', default: 12, min: 1, max: 150, step: 0.5, unit: 'mm', label: 'Pocket depth', group: 'Pockets' },
    columns: { type: 'integer', default: 6, min: 1, max: 40, label: 'Columns (X)', group: 'Pockets' },
    rows: { type: 'integer', default: 4, min: 1, max: 40, label: 'Rows (Y)', group: 'Pockets' },
    spacing: { type: 'number', default: 3, min: 0.8, max: 40, step: 0.1, unit: 'mm', label: 'Wall between pockets', group: 'Pockets' },
    chamfer: { type: 'number', default: 0.6, min: 0, max: 5, step: 0.1, unit: 'mm', label: 'Entry chamfer', group: 'Pockets' },

    border: { type: 'number', default: 4, min: 1, max: 30, step: 0.5, unit: 'mm', label: 'Outer border', group: 'Block' },
    base: { type: 'number', default: 2, min: 0.6, max: 20, step: 0.2, unit: 'mm', label: 'Base under pockets', group: 'Block' },
    cornerRadius: { type: 'number', default: 3, min: 0, max: 20, step: 0.5, unit: 'mm', label: 'Corner radius', group: 'Block' },
    frontLedge: { type: 'number', default: 0, min: 0, max: 40, step: 1, unit: 'mm', label: 'Extra front border for a label (0 = none)', group: 'Block' },

    ...Object.fromEntries(Object.entries(labelParamSchema()).map(([key, def]) => [key, key === 'labelType' ? { ...def, default: 'none' } : def])),
  },

  generate(p, k) {
    const warnings = [];
    const notes = [];
    const sx = p.itemSize + p.clearance;
    const sy = (p.itemSize2 > 0 ? p.itemSize2 : p.itemSize) + p.clearance;
    // pocket footprint in X/Y
    let fx = sx;
    let fy = sy;
    if (p.shape === 'hex') { fx = (2 * sx) / Math.sqrt(3); fy = sx; }
    if (p.shape === 'round') fy = sx;

    const W = p.columns * fx + (p.columns - 1) * p.spacing + 2 * p.border;
    const D = p.rows * fy + (p.rows - 1) * p.spacing + 2 * p.border + p.frontLedge;
    const H = p.base + p.pocketDepth;
    let block = k.roundedBlock(W, D, p.cornerRadius, 0, H, 8);

    const pocket2d = () => {
      if (p.shape === 'round') return k.track(k.CrossSection.circle(sx / 2, 48));
      if (p.shape === 'hex') return k.track(k.CrossSection.circle(fx / 2, 6)); // vertex on +X, flats top/bottom
      if (p.shape === 'square') return k.roundedRect(sx, sy, 0.4, 3);
      return k.roundedRect(sx, sy, Math.min(sx, sy) / 2 - 0.01, 10);
    };
    const shape = pocket2d();
    const body = k.extrude(shape, p.pocketDepth + 1);
    let pocket = k.translate(body, [0, 0, p.base]);
    if (p.chamfer > 0) {
      const scale = [(fx + 2 * p.chamfer) / fx, (fy + 2 * p.chamfer) / fy];
      const flare = k.track(k.Manifold.extrude(shape, p.chamfer + 0.01, 0, 0, scale));
      pocket = k.union([pocket, k.translate(flare, [0, 0, H - p.chamfer])]);
    }

    const cuts = [];
    const y0 = -D / 2 + p.border + p.frontLedge + fy / 2;
    const x0 = -W / 2 + p.border + fx / 2;
    for (let r = 0; r < p.rows; r++) {
      for (let c = 0; c < p.columns; c++) {
        cuts.push(k.translate(pocket, [x0 + c * (fx + p.spacing), y0 + r * (fy + p.spacing), 0]));
      }
    }
    block = k.difference(block, cuts);
    if (p.spacing < 1.2) warnings.push('Walls between pockets under 1.2 mm print poorly.');
    if (W > 250 || D > 250) warnings.push(`Block is ${W.toFixed(0)} x ${D.toFixed(0)} mm. Check it fits your bed.`);

    const label = frontLabel(k, p, { faceY: -D / 2, zMin: 0.5, zMax: H - 0.5, maxWidth: W - 2 * p.cornerRadius, minWall: p.border + p.frontLedge });
    warnings.push(...label.warnings);
    if (label.add.length) block = k.union([block, ...label.add]);
    if (label.cut.length) block = k.difference(block, label.cut);

    notes.push(`${p.rows * p.columns} pockets, ${sx.toFixed(2)}${p.shape === 'square' || p.shape === 'slot' ? ` x ${sy.toFixed(2)}` : ''} mm (item + clearance), ${p.pocketDepth} mm deep. Block ${W.toFixed(1)} x ${D.toFixed(1)} x ${H.toFixed(1)} mm.`);
    notes.push('Test-print a 1 x 2 block first to tune clearance for your printer.');
    return { parts: [{ name: 'block', manifold: block }], warnings, notes, meta: { labelCard: label.card } };
  },
};
