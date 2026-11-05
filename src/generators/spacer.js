// Spacers, standoffs, washers, shims and top-hat bushings. Optional batch
// layout prints many at once.

export default {
  id: 'spacer',
  name: 'Spacer / Standoff / Washer',
  sections: ['accessories', 'quads', 'robotics', 'planes'],
  description: 'Round or hex spacers, standoffs, washers, shims and flanged bushings. Set OD, ID, length, and how many to print at once.',
  params: {
    shape: { type: 'select', default: 'round', group: 'Shape', label: 'Shape', options: [{ value: 'round', label: 'Round' }, { value: 'hex', label: 'Hex (OD = across flats)' }, { value: 'square', label: 'Square' }] },
    outerDiameter: { type: 'number', default: 6, min: 1, max: 150, step: 0.05, unit: 'mm', label: 'Outer diameter / across flats', group: 'Shape' },
    innerDiameter: { type: 'number', default: 3.3, min: 0, max: 148, step: 0.05, unit: 'mm', label: 'Inner diameter (0 = solid)', group: 'Shape', help: '3.3 slip fit M3, 2.6 to thread M3 into it.' },
    length: { type: 'number', default: 10, min: 0.2, max: 200, step: 0.1, unit: 'mm', label: 'Length / thickness', group: 'Shape' },
    flangeDiameter: { type: 'number', default: 0, min: 0, max: 200, step: 0.1, unit: 'mm', label: 'Flange diameter (0 = none)', group: 'Flange' },
    flangeThickness: { type: 'number', default: 1, min: 0.2, max: 20, step: 0.1, unit: 'mm', label: 'Flange thickness', group: 'Flange' },
    chamfer: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.05, unit: 'mm', label: 'Bore entry chamfer', group: 'Shape' },
    count: { type: 'integer', default: 1, min: 1, max: 100, label: 'How many (laid out on one plate)', group: 'Batch' },
  },

  generate(p, k) {
    const warnings = [];
    if (p.innerDiameter >= p.outerDiameter) throw new Error('Inner diameter must be smaller than outer diameter.');
    const R = p.outerDiameter / 2;
    const one = () => {
      let body;
      if (p.shape === 'round') body = k.cylZ(R, 0, 0, 0, p.length, 64);
      else if (p.shape === 'hex') body = k.hexZ(p.outerDiameter, 0, 0, 0, p.length, 30);
      else body = k.cuboid([p.outerDiameter, p.outerDiameter, p.length], [0, 0, p.length / 2]);
      const add = [body];
      if (p.flangeDiameter > 0) add.push(k.cylZ(p.flangeDiameter / 2, 0, 0, 0, p.flangeThickness, 64));
      let part = k.union(add);
      if (p.innerDiameter > 0) {
        const ri = p.innerDiameter / 2;
        const cuts = [k.cylZ(ri, 0, 0, -1, p.length + 1, 48)];
        if (p.chamfer > 0 && p.length > 2 * p.chamfer) {
          cuts.push(k.coneZ(ri + p.chamfer + 0.5, ri - 0.01, 0, 0, -0.5, p.chamfer, 48));
          cuts.push(k.coneZ(ri - 0.01, ri + p.chamfer + 0.5, 0, 0, p.length - p.chamfer, p.length + 0.5, 48));
        }
        part = k.difference(part, cuts);
      }
      return part;
    };
    const unit = one();
    const footprint = Math.max(p.outerDiameter * (p.shape === 'hex' ? 2 / Math.sqrt(3) : p.shape === 'square' ? Math.SQRT2 : 1), p.flangeDiameter);
    const pitch = footprint + 3;
    const cols = Math.ceil(Math.sqrt(p.count));
    const copies = Array.from({ length: p.count }, (_, i) => k.translate(unit, [(i % cols) * pitch, Math.floor(i / cols) * pitch, 0]));
    const wallT = (p.outerDiameter - p.innerDiameter) / 2;
    if (p.innerDiameter > 0 && wallT < 0.8) warnings.push(`Wall is ${wallT.toFixed(2)} mm. Under 0.8 mm prints poorly.`);
    if (p.length < 0.4) warnings.push('Under 0.4 mm is about two layers. Check your layer height.');
    return {
      parts: [{ name: p.count > 1 ? `x${p.count}` : 'spacer', manifold: k.placeOnBed(k.union(copies)) }],
      warnings,
      notes: [`${p.count} x ${p.shape} ${p.outerDiameter} OD x ${p.innerDiameter} ID x ${p.length} mm.`],
    };
  },
};
