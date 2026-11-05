// Tube end parts: plug (goes inside the tube ID), cap (fits over the OD),
// and angled foot (cap with an angled pad for splayed legs to sit flat).

const SEG = 64;

export default {
  id: 'tube-cap',
  name: 'Tube Plug / Cap / Foot',
  sections: ['accessories', 'quads', 'robotics'],
  description: 'End plug for the tube inner diameter, end cap over the outer diameter, or an angled foot for legs. Optional center hole for a screw or heat-set insert.',
  params: {
    type: {
      type: 'select', default: 'plug', group: 'Part', label: 'Type',
      options: [
        { value: 'plug', label: 'Plug (inside the tube)' },
        { value: 'cap', label: 'Cap (over the tube)' },
        { value: 'foot', label: 'Angled foot (over the tube)' },
      ],
    },
    tubeOD: { type: 'number', default: 10, min: 2, max: 80, step: 0.05, unit: 'mm', label: 'Tube outer diameter', group: 'Tube' },
    tubeID: { type: 'number', default: 8, min: 1, max: 78, step: 0.05, unit: 'mm', label: 'Tube inner diameter', group: 'Tube' },
    clearance: { type: 'number', default: 0.1, min: -0.3, max: 1.5, step: 0.05, unit: 'mm', label: 'Fit clearance (per side)', group: 'Tube', help: 'Plug: removed from the ID. Cap: added to the OD.' },
    depth: { type: 'number', default: 10, min: 2, max: 100, step: 0.5, unit: 'mm', label: 'Insert / socket depth', group: 'Part' },
    wall: { type: 'number', default: 2, min: 0.8, max: 10, step: 0.1, unit: 'mm', label: 'Cap wall', group: 'Part' },
    endThickness: { type: 'number', default: 2.5, min: 0.8, max: 20, step: 0.1, unit: 'mm', label: 'End / flange thickness', group: 'Part' },
    flangeLip: { type: 'number', default: 0, min: 0, max: 10, step: 0.1, unit: 'mm', label: 'Plug flange lip beyond the OD', group: 'Part' },
    ribs: { type: 'integer', default: 6, min: 0, max: 16, label: 'Grip ribs on the plug', group: 'Part', help: 'Thin ribs crush into the tube for a press fit.' },
    footAngle: { type: 'number', default: 15, min: 0, max: 45, step: 1, unit: 'deg', label: 'Foot pad angle', group: 'Part', help: 'Leg angle from vertical; the pad sits flat on the ground.' },
    centerHole: { type: 'number', default: 0, min: 0, max: 40, step: 0.1, unit: 'mm', label: 'Center hole diameter (0 = none)', group: 'Hole', help: '3.4 for M3 through. Heat-set insert: use its hole size.' },
    centerHoleDepth: { type: 'number', default: 0, min: 0, max: 120, step: 0.5, unit: 'mm', label: 'Center hole depth (0 = through)', group: 'Hole' },
  },

  generate(p, k) {
    const warnings = [];
    const notes = [];
    let part;
    if (p.type === 'plug') {
      if (p.tubeID >= p.tubeOD) throw new Error('Tube ID must be smaller than OD.');
      const rp = p.tubeID / 2 - p.clearance - (p.ribs ? 0.25 : 0);
      const rf = p.tubeOD / 2 + p.flangeLip;
      const H = p.endThickness + p.depth;
      const add = [k.cylZ(rf, 0, 0, 0, p.endThickness, SEG), k.coneZ(rp, rp - 0.3, 0, 0, p.endThickness - 0.01, H, SEG)];
      for (let i = 0; i < p.ribs; i++) {
        const a = (i * 360) / p.ribs;
        add.push(k.rotate(k.cuboid([0.8, 1, p.depth - 1.5], [rp + 0.25 - 0.4 + 0.01, 0, p.endThickness + (p.depth - 1.5) / 2]), [0, 0, a]));
      }
      part = k.union(add);
      if (rp < 1) warnings.push('Plug is very thin.');
      notes.push(`Plug ${(2 * rp).toFixed(2)} mm${p.ribs ? ` + ${p.ribs} ribs to ${(2 * (rp + 0.25)).toFixed(2)} mm` : ''}, flange ${(2 * rf).toFixed(1)} mm. Prints flange down.`);
      if (p.centerHole > 0) {
        const d = p.centerHoleDepth > 0 ? p.centerHoleDepth : H + 2;
        part = k.difference(part, [k.cylZ(p.centerHole / 2, 0, 0, H - d, H + 1, 32)]);
      }
    } else {
      const ri = p.tubeOD / 2 + p.clearance;
      const R = ri + p.wall;
      const T = p.endThickness;
      if (p.type === 'cap' || p.footAngle === 0) {
        part = k.difference(k.cylZ(R, 0, 0, 0, T + p.depth, SEG), [k.cylZ(ri, 0, 0, T, T + p.depth + 1, SEG)]);
        if (p.centerHole > 0) part = k.difference(part, [k.cylZ(p.centerHole / 2, 0, 0, -1, T + 1, 32)]);
        notes.push(`Cap bore ${(2 * ri).toFixed(2)} mm, prints closed end down.`);
      } else {
        // Foot: cup whose closed end is cut by a plane tilted footAngle about Y.
        const tan = Math.tan((p.footAngle * Math.PI) / 180);
        const low = -T - 2 * R * tan - 1;
        let cup = k.difference(k.cylZ(R, 0, 0, low, p.depth, SEG), [k.cylZ(ri, 0, 0, 0, p.depth + 1, SEG)]);
        // plane z = -T - (x + R) * tan; keep everything above it
        const big = 4 * R + 10;
        const plane = k.track(k.Manifold.cube([big, big, big], true).translate([0, 0, -big / 2]).rotate([0, p.footAngle, 0]).translate([-R, 0, -T]));
        cup = k.difference(cup, [plane]);
        part = k.rotate(cup, [0, -p.footAngle, 0]);
        notes.push(`Foot for a leg ${p.footAngle} deg from vertical. Print pad down as exported; TPU gives grip and shock absorption.`);
      }
    }
    return { parts: [{ name: p.type, manifold: k.placeOnBed(part) }], warnings, notes };
  },
};
