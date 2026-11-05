// Tool rack: a shelf with holes or slots, on a back plate with a wall mount.
// Printed upright (as it hangs), shelf on the bed: holes are vertical and the
// diamond pegboard pegs overhang at 45 degrees only. No supports.

import { mountParamSchema, buildMount } from '../core/mounts.js';

export default {
  id: 'tool-rack',
  name: 'Tool Rack',
  sections: ['shop'],
  description: 'Shelf with a row (or rows) of holes or slots for screwdrivers, hex drivers, pliers, tweezers and bits. Pegboard, screw or tape mount.',
  params: {
    width: { type: 'number', default: 150, min: 30, max: 300, step: 1, unit: 'mm', label: 'Width (X)', group: 'Shelf' },
    shelfDepth: { type: 'number', default: 35, min: 10, max: 150, step: 1, unit: 'mm', label: 'Shelf depth (out from wall)', group: 'Shelf' },
    shelfThickness: { type: 'number', default: 6, min: 2, max: 30, step: 0.5, unit: 'mm', label: 'Shelf thickness', group: 'Shelf' },
    plateHeight: { type: 'number', default: 30, min: 10, max: 200, step: 1, unit: 'mm', label: 'Back plate height above shelf (min)', group: 'Shelf' },
    ribs: { type: 'boolean', default: true, label: 'Side ribs', group: 'Shelf' },
    frontLip: { type: 'number', default: 0, min: 0, max: 30, step: 1, unit: 'mm', label: 'Front lip height (0 = none)', group: 'Shelf' },

    holeShape: {
      type: 'select', default: 'round', group: 'Holes', label: 'Hole shape',
      options: [
        { value: 'round', label: 'Round' },
        { value: 'slot', label: 'Slot (front to back)' },
        { value: 'slotX', label: 'Slot (side to side)' },
        { value: 'square', label: 'Square' },
        { value: 'hex', label: 'Hex' },
      ],
    },
    holeSize: { type: 'number', default: 9, min: 1, max: 80, step: 0.1, unit: 'mm', label: 'Hole size (diameter / slot width)', group: 'Holes' },
    slotLength: { type: 'number', default: 20, min: 2, max: 140, step: 0.5, unit: 'mm', label: 'Slot length', group: 'Holes' },
    holeCount: { type: 'integer', default: 8, min: 0, max: 60, label: 'Holes per row', group: 'Holes' },
    rows: { type: 'integer', default: 1, min: 1, max: 6, label: 'Rows', group: 'Holes' },
    holeOpenFront: { type: 'boolean', default: false, label: 'Open slots to the front edge', group: 'Holes', help: 'Lets tools slide in from the front.' },

    ...mountParamSchema('Mount', { columns: true }),
  },

  generate(p, k) {
    const warnings = [];
    const notes = [];
    const T = p.plateThickness;
    const W = p.width;
    const ribT = 3;

    const mount = buildMount(k, p, {
      width: W, zMin: 0, zMax: p.shelfThickness + p.plateHeight, style: 'diamond', columns: p.mountColumns, upAxis: 'z',
    });
    warnings.push(...mount.warnings);
    notes.push(...mount.notes);

    const solids = [
      k.cuboid([W, T, mount.zMax], [0, T / 2, mount.zMax / 2]), // back plate
      k.cuboid([W, p.shelfDepth, p.shelfThickness], [0, p.shelfDepth / 2, p.shelfThickness / 2]), // shelf
    ];
    if (p.ribs) {
      const rh = Math.min(mount.zMax - p.shelfThickness, p.shelfDepth - T) * 0.9;
      for (const x of [-W / 2, W / 2 - ribT]) {
        solids.push(k.prismX([[T - 0.5, p.shelfThickness - 0.5], [p.shelfDepth * 0.95, p.shelfThickness - 0.5], [T - 0.5, p.shelfThickness + rh]], x, x + ribT));
      }
    }
    if (p.frontLip > 0) {
      solids.push(k.cuboid([W, 2.4, p.shelfThickness + p.frontLip], [0, p.shelfDepth - 1.2, (p.shelfThickness + p.frontLip) / 2]));
    }
    let rack = k.union([...solids, ...mount.add]);

    // Holes
    const cuts = [...mount.cut];
    if (p.holeCount > 0) {
      const hs = p.holeSize;
      const lenY = p.holeShape === 'slot' ? p.slotLength : hs;
      const lenX = p.holeShape === 'slotX' ? p.slotLength : hs;
      const usableW = W - 2 * (p.ribs ? ribT : 0) - 4;
      const pitchX = usableW / p.holeCount;
      if (pitchX < lenX + 1.2) warnings.push(`Holes overlap or leave walls under 1.2 mm (pitch ${pitchX.toFixed(1)} mm for ${lenX} mm holes). Fewer holes or a wider rack.`);
      const zone0 = T + 2;
      const zone1 = p.shelfDepth - (p.frontLip > 0 ? 2.4 : 0) - (p.holeOpenFront ? -1 : 2);
      const pitchY = (zone1 - zone0) / p.rows;
      if (pitchY < lenY + 1.2 && !(p.holeOpenFront && p.rows === 1)) warnings.push(`Shelf is not deep enough for ${p.rows} row(s) of ${lenY} mm holes.`);
      const h = p.shelfThickness + 2;
      for (let r = 0; r < p.rows; r++) {
        const yc = zone0 + pitchY * (r + 0.5);
        for (let i = 0; i < p.holeCount; i++) {
          const xc = -usableW / 2 + pitchX * (i + 0.5);
          let cs;
          if (p.holeShape === 'round') cs = k.track(k.CrossSection.circle(hs / 2, 40));
          else if (p.holeShape === 'hex') cs = k.track(k.CrossSection.circle(hs / Math.sqrt(3), 6));
          else if (p.holeShape === 'square') cs = k.roundedRect(hs, hs, 0.5, 4);
          else cs = k.roundedRect(lenX, lenY, Math.min(lenX, lenY) / 2 - 0.01, 8);
          let hole = k.translate(k.extrude(cs, h), [xc, yc, -1]);
          if (p.holeOpenFront && r === p.rows - 1) {
            const w = p.holeShape === 'round' || p.holeShape === 'hex' ? hs * 0.8 : lenX;
            hole = k.union([hole, k.cuboid([w, p.shelfDepth, h], [xc, yc + p.shelfDepth / 2, h / 2 - 1])]);
          }
          cuts.push(hole);
        }
      }
      notes.push(`${p.rows * p.holeCount} ${p.holeShape} holes, ${hs} mm${p.holeShape.startsWith('slot') ? ` x ${p.slotLength} mm` : ''}.`);
    }
    rack = k.difference(rack, cuts);

    const printed = k.placeOnBed(rack);
    notes.push('Print upright as exported (shelf on the bed).');
    return { parts: [{ name: 'rack', manifold: printed }], warnings, notes };
  },
};
