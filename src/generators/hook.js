// Wall / pegboard hook. Printed on its side: the hook outline lies flat on the
// bed and is extruded up by the hook width. Layer lines then run along the arm,
// which is the strong direction for a loaded hook.

import { mountParamSchema, buildMount } from '../core/mounts.js';

const deg = (d) => (d * Math.PI) / 180;

/** Rectangle from (y0, z0) along angle a (deg from +Y toward +Z), length L, thickness t (below the line). */
function bar(y0, z0, aDeg, L, t) {
  const c = Math.cos(deg(aDeg));
  const s = Math.sin(deg(aDeg));
  const ny = s;   // normal pointing "down" from the bar's top line
  const nz = -c;
  return [
    [y0, z0],
    [y0 + L * c, z0 + L * s],
    [y0 + L * c + t * ny, z0 + L * s + t * nz],
    [y0 + t * ny, z0 + t * nz],
  ];
}

export default {
  id: 'hook',
  name: 'Hook',
  sections: ['shop'],
  description: 'J hook, angled hook, double coat-style hook or wide cradle for cables and gear. Pegboard, screw or tape mount. Prints on its side, no supports.',
  params: {
    style: {
      type: 'select', default: 'j', group: 'Hook', label: 'Hook style',
      options: [
        { value: 'j', label: 'J hook (tip up)' },
        { value: 'straight', label: 'Straight angled arm' },
        { value: 'double', label: 'Double (long + short arm)' },
      ],
    },
    width: { type: 'number', default: 12, min: 6, max: 120, step: 1, unit: 'mm', label: 'Hook width (thickness across)', group: 'Hook', help: 'Wider = stronger and gentler on cables. Becomes the print height.' },
    armLength: { type: 'number', default: 50, min: 10, max: 250, step: 1, unit: 'mm', label: 'Arm length', group: 'Hook' },
    armThickness: { type: 'number', default: 7, min: 3, max: 30, step: 0.5, unit: 'mm', label: 'Arm thickness', group: 'Hook' },
    armAngle: { type: 'number', default: 0, min: -10, max: 60, step: 1, unit: 'deg', label: 'Arm angle (up from level)', group: 'Hook' },
    tipHeight: { type: 'number', default: 15, min: 0, max: 100, step: 1, unit: 'mm', label: 'Tip height (0 = no tip)', group: 'Hook' },
    tipThickness: { type: 'number', default: 5, min: 2, max: 20, step: 0.5, unit: 'mm', label: 'Tip thickness', group: 'Hook' },
    plateHeight: { type: 'number', default: 40, min: 15, max: 200, step: 1, unit: 'mm', label: 'Back plate height (min)', group: 'Hook' },
    gusset: { type: 'number', default: 8, min: 0, max: 40, step: 1, unit: 'mm', label: 'Gusset under the arm', group: 'Hook' },
    ...mountParamSchema(),
  },

  generate(p, k) {
    const warnings = [];
    const notes = [];
    const T = p.plateThickness;
    if (p.mount === 'pegboard' && p.width < p.pegDiameter) throw new Error('Hook width must be at least the peg diameter.');

    // Arm root sits above the gusset; the plate covers the arm root and gusset.
    const armZ = p.gusset + p.armThickness; // top line of the arm at the plate
    const mount = buildMount(k, p, { width: p.width, zMin: 0, zMax: Math.max(p.plateHeight, armZ + 5), style: 'round', upAxis: 'x' });
    warnings.push(...mount.warnings);
    notes.push(...mount.notes);

    const profile = [];
    profile.push([[0, mount.zMin], [T, mount.zMin], [T, mount.zMax], [0, mount.zMax]]); // back plate

    const addArm = (angle, L, tipH) => {
      const a = bar(T - 0.5, armZ, angle, L + 0.5, p.armThickness);
      profile.push(a);
      if (tipH > 0) {
        // Tip post at the arm end, perpendicular to the arm, flush with the arm's end face.
        const c = Math.cos(deg(angle));
        const s = Math.sin(deg(angle));
        const [ey, ez] = a[1]; // arm top, outer end
        const [by, bz] = a[2]; // arm bottom, outer end
        const top = [ey - tipH * s, ez + tipH * c];
        profile.push([
          [by, bz],
          top,
          [top[0] - p.tipThickness * c, top[1] - p.tipThickness * s],
          [by - p.tipThickness * c, bz - p.tipThickness * s],
        ]);
      }
    };

    if (p.style === 'j') addArm(p.armAngle, p.armLength, p.tipHeight);
    else if (p.style === 'straight') addArm(p.armAngle || 15, p.armLength, 0);
    else {
      addArm(p.armAngle, p.armLength, p.tipHeight);
      // short upper arm at 35 deg, starting near the plate top
      const upperZ = Math.min(mount.zMax - 2, armZ + 25);
      profile.push(bar(T - 0.5, upperZ, 35, p.armLength * 0.45, p.armThickness * 0.85));
    }

    if (p.gusset > 0) {
      profile.push([[T - 0.5, armZ - p.armThickness + 0.5], [T + p.gusset, armZ - p.armThickness + 0.5], [T - 0.5, armZ - p.armThickness - p.gusset]]);
    }

    const x0 = -p.width / 2;
    const x1 = p.width / 2;
    const solids = profile.map((poly) => k.prismX(poly, x0, x1));
    let hook = k.union([...solids, ...mount.add]);
    hook = k.difference(hook, mount.cut);

    // Lay it on its side: use +X becomes print +Z.
    const printed = k.placeOnBed(k.rotate(hook, [0, -90, 0]));
    notes.push(`Print on its side as exported (${p.width} mm tall). Use 4+ perimeters for strength.`);
    if (p.armLength > 12 * p.armThickness) warnings.push('Long thin arm: it will flex under load. Raise armThickness or width.');
    notes.push('Load capacity is not rated. Test with a light load first.');
    return { parts: [{ name: 'hook', manifold: printed }], warnings, notes };
  },
};
