// Parts box: shell + divider grid + optional press-fit lid.
// k is a kernel scope (src/core/kernel.js).

export default {
  id: 'parts-box',
  name: 'Parts Box',
  sections: ['shop'],
  description: 'Rounded storage box with a grid of compartments and an optional press-fit lid. Prints without supports.',
  params: {
    width: { type: 'number', default: 120, min: 10, max: 400, step: 1, unit: 'mm', label: 'Outer width (X)', group: 'Box' },
    depth: { type: 'number', default: 80, min: 10, max: 400, step: 1, unit: 'mm', label: 'Outer depth (Y)', group: 'Box' },
    height: { type: 'number', default: 40, min: 5, max: 300, step: 1, unit: 'mm', label: 'Outer height (Z)', group: 'Box' },
    wall: { type: 'number', default: 1.6, min: 0.8, max: 10, step: 0.1, unit: 'mm', label: 'Wall thickness', group: 'Box', help: 'Use a multiple of your line width (0.4 nozzle: 1.2, 1.6, 2.0).' },
    floor: { type: 'number', default: 1.2, min: 0.4, max: 10, step: 0.1, unit: 'mm', label: 'Floor thickness', group: 'Box' },
    cornerRadius: { type: 'number', default: 4, min: 0, max: 50, step: 0.5, unit: 'mm', label: 'Corner radius', group: 'Box' },

    compartmentsX: { type: 'integer', default: 3, min: 1, max: 20, label: 'Compartments across X', group: 'Dividers' },
    compartmentsY: { type: 'integer', default: 2, min: 1, max: 20, label: 'Compartments across Y', group: 'Dividers' },
    dividerThickness: { type: 'number', default: 1.2, min: 0.4, max: 10, step: 0.1, unit: 'mm', label: 'Divider thickness', group: 'Dividers' },
    dividerHeight: { type: 'number', default: 0, min: 0, max: 300, step: 0.5, unit: 'mm', label: 'Divider height from floor (0 = auto)', group: 'Dividers', help: 'Auto leaves room for the lid lip.' },

    lid: { type: 'boolean', default: true, label: 'Make a lid', group: 'Lid' },
    lidThickness: { type: 'number', default: 1.6, min: 0.6, max: 10, step: 0.1, unit: 'mm', label: 'Lid plate thickness', group: 'Lid' },
    lipHeight: { type: 'number', default: 4, min: 1, max: 30, step: 0.5, unit: 'mm', label: 'Lid lip height', group: 'Lid' },
    lipWall: { type: 'number', default: 1.2, min: 0.6, max: 5, step: 0.1, unit: 'mm', label: 'Lid lip wall', group: 'Lid' },
    clearance: { type: 'number', default: 0.25, min: 0, max: 1.5, step: 0.05, unit: 'mm', label: 'Lid fit clearance per side', group: 'Lid', help: '0.2-0.3 for a snug fit on a tuned printer.' },

    segments: { type: 'integer', default: 12, min: 2, max: 64, label: 'Corner smoothness (segments per corner)', group: 'Quality' },
  },

  generate(p, k) {
    const warnings = [];
    const notes = [];

    const innerW = p.width - 2 * p.wall;
    const innerD = p.depth - 2 * p.wall;
    const innerR = Math.max(0, p.cornerRadius - p.wall);
    if (innerW <= 2 || innerD <= 2) throw new Error('Walls are too thick for the box footprint.');
    if (p.floor >= p.height - 1) throw new Error('Floor is thicker than the box is tall.');

    // Shell
    const outer = k.roundedBlock(p.width, p.depth, p.cornerRadius, 0, p.height, p.segments);
    const cavity = k.roundedBlock(innerW, innerD, innerR, p.floor, p.height + 1, p.segments);
    let box = k.difference(outer, [cavity]);

    // Dividers
    const autoDivider = p.lid ? p.height - p.floor - p.lipHeight - 0.5 : p.height - p.floor;
    const dividerH = p.dividerHeight > 0 ? p.dividerHeight : autoDivider;
    if (p.lid && p.floor + dividerH > p.height - p.lipHeight) {
      warnings.push(`Dividers (top at ${(p.floor + dividerH).toFixed(1)} mm) hit the lid lip (bottom at ${(p.height - p.lipHeight).toFixed(1)} mm). Lower dividerHeight or set it to 0 for auto.`);
    }
    if (p.floor + dividerH > p.height) warnings.push('Dividers are taller than the box.');

    const dividers = [];
    const overlap = p.wall / 2; // sink into walls so the union fuses
    if (dividerH > 0) {
      for (let i = 1; i < p.compartmentsX; i++) {
        const x = -innerW / 2 + (i * innerW) / p.compartmentsX;
        dividers.push(k.cuboid([p.dividerThickness, innerD + 2 * overlap, dividerH], [x, 0, p.floor + dividerH / 2]));
      }
      for (let j = 1; j < p.compartmentsY; j++) {
        const y = -innerD / 2 + (j * innerD) / p.compartmentsY;
        dividers.push(k.cuboid([innerW + 2 * overlap, p.dividerThickness, dividerH], [0, y, p.floor + dividerH / 2]));
      }
    }
    if (dividers.length) box = k.union([box, ...dividers]);

    const cellW = (innerW - (p.compartmentsX - 1) * p.dividerThickness) / p.compartmentsX;
    const cellD = (innerD - (p.compartmentsY - 1) * p.dividerThickness) / p.compartmentsY;
    if (cellW < 5 || cellD < 5) warnings.push(`Compartments are very small (${cellW.toFixed(1)} x ${cellD.toFixed(1)} mm).`);
    notes.push(`Compartment size: ${cellW.toFixed(1)} x ${cellD.toFixed(1)} mm, usable depth ${(p.height - p.floor).toFixed(1)} mm.`);

    const parts = [{ name: 'box', manifold: box }];

    // Lid: flat plate with a lip that drops inside the box walls.
    // Printed plate-down, lip up. No supports.
    if (p.lid) {
      const lipOuterW = innerW - 2 * p.clearance;
      const lipOuterD = innerD - 2 * p.clearance;
      const lipOuterR = Math.max(0, innerR - p.clearance);
      if (lipOuterW - 2 * p.lipWall <= 1 || lipOuterD - 2 * p.lipWall <= 1) {
        throw new Error('Lid lip wall is too thick for this box.');
      }
      const plate = k.roundedBlock(p.width, p.depth, p.cornerRadius, 0, p.lidThickness, p.segments);
      const lipTop = p.lidThickness + p.lipHeight;
      const lipOuter = k.roundedBlock(lipOuterW, lipOuterD, lipOuterR, p.lidThickness - 0.01, lipTop, p.segments);
      const lipInner = k.roundedBlock(
        lipOuterW - 2 * p.lipWall,
        lipOuterD - 2 * p.lipWall,
        Math.max(0, lipOuterR - p.lipWall),
        p.lidThickness,
        lipTop + 1,
        p.segments,
      );
      const lid = k.union([plate, k.difference(lipOuter, [lipInner])]);
      parts.push({ name: 'lid', manifold: lid });
      notes.push('Print the lid plate-side down. If the fit is too tight, raise clearance by 0.05 mm and reprint.');
    }

    return { parts, warnings, notes };
  },
};
