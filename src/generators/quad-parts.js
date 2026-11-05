// Multirotor parts: printable frame, arm-tube motor mount, ducted prop guard, landing leg.

import { bolt, boltParam, squarePattern, crossPattern, rotate2d } from '../core/hardware.js';
import { regularPolygon } from '../core/kernel.js';

const INCH = 25.4;

export const multirotorFrame = {
  id: 'multirotor-frame',
  name: 'Multirotor Frame',
  sections: ['quads'],
  description: 'One-piece printable frame for 3, 4, 6 or 8 arms: wheelbase, arm size, motor pattern, FC pattern, strap slots, optional top plate. Good for small builds, jigs and prototypes.',
  params: {
    arms: { type: 'integer', default: 4, min: 3, max: 8, label: 'Arms', group: 'Layout' },
    wheelbase: { type: 'number', default: 220, min: 60, max: 600, step: 1, unit: 'mm', label: 'Wheelbase (motor to opposite motor)', group: 'Layout' },
    armOffset: { type: 'number', default: 45, min: 0, max: 90, step: 1, unit: 'deg', label: 'First arm angle', group: 'Layout', help: '45 = X layout for 4 arms, 0 = plus layout.' },
    propInches: { type: 'number', default: 5, min: 1, max: 20, step: 0.1, unit: 'in', label: 'Prop size (for clearance check)', group: 'Layout' },
    armWidth: { type: 'number', default: 13, min: 5, max: 40, step: 0.5, unit: 'mm', label: 'Arm width', group: 'Arms' },
    thickness: { type: 'number', default: 5, min: 2, max: 15, step: 0.5, unit: 'mm', label: 'Frame thickness', group: 'Arms' },
    lighten: { type: 'boolean', default: true, label: 'Lightening slots in arms', group: 'Arms' },
    motorPad: { type: 'number', default: 28, min: 8, max: 60, step: 0.5, unit: 'mm', label: 'Motor pad diameter', group: 'Motors' },
    motorPatternA: { type: 'number', default: 16, min: 4, max: 50, step: 0.1, unit: 'mm', label: 'Motor hole spacing A', group: 'Motors', help: '16 x 19 for most 22xx-23xx motors, 12 x 12 for 13xx-14xx, 9 x 9 for 08xx-11xx. Check your motor.' },
    motorPatternB: { type: 'number', default: 19, min: 4, max: 50, step: 0.1, unit: 'mm', label: 'Motor hole spacing B', group: 'Motors' },
    motorBolt: boltParam('Motors', 'M3', 'Motor screws'),
    motorCenterHole: { type: 'number', default: 7, min: 0, max: 20, step: 0.5, unit: 'mm', label: 'Motor center hole (shaft / clip)', group: 'Motors' },
    centerSize: { type: 'number', default: 50, min: 20, max: 200, step: 0.5, unit: 'mm', label: 'Center body size', group: 'Center' },
    fcPattern: { type: 'number', default: 30.5, min: 0, max: 120, step: 0.05, unit: 'mm', label: 'FC hole pattern (0 = none)', group: 'Center' },
    fcPattern2: { type: 'number', default: 20, min: 0, max: 120, step: 0.05, unit: 'mm', label: 'Second FC pattern (0 = none)', group: 'Center' },
    standoffSpacing: { type: 'number', default: 40, min: 0, max: 190, step: 0.5, unit: 'mm', label: 'Top plate standoff spacing (0 = none)', group: 'Center' },
    strapSlots: { type: 'boolean', default: true, label: 'Battery strap slots', group: 'Center' },
    topPlate: { type: 'boolean', default: true, label: 'Also make a top plate', group: 'Center' },
    topThickness: { type: 'number', default: 2.5, min: 1.2, max: 10, step: 0.1, unit: 'mm', label: 'Top plate thickness', group: 'Center' },
  },
  generate(p, k) {
    const warnings = [];
    const notes = [];
    const T = p.thickness;
    const reach = p.wheelbase / 2;
    const mb = bolt(p.motorBolt);
    const sb = bolt('M3');
    const angles = Array.from({ length: p.arms }, (_, i) => p.armOffset + (i * 360) / p.arms);
    const add = [k.roundedBlock(p.centerSize, p.centerSize, 6, 0, T, 8)];
    const cuts = [];
    for (const a of angles) {
      const arm = k.cuboid([reach, p.armWidth, T], [reach / 2, 0, T / 2]);
      const pad = k.cylZ(p.motorPad / 2, reach, 0, 0, T, 64);
      add.push(k.rotate(k.union([arm, pad]), [0, 0, a]));
      const armCuts = [];
      for (const [x, y] of crossPattern(p.motorPatternA, p.motorPatternB)) armCuts.push(k.cylZ(mb.clear / 2, reach + x, y, -1, T + 1, 24));
      if (p.motorCenterHole > 0) armCuts.push(k.cylZ(p.motorCenterHole / 2, reach, 0, -1, T + 1, 40));
      if (p.lighten) {
        const x0 = p.centerSize / 2 + 4;
        const x1 = reach - p.motorPad / 2 - 3;
        if (x1 - x0 > 8) armCuts.push(k.translate(k.extrude(k.roundedRect(x1 - x0, p.armWidth * 0.4, p.armWidth * 0.2 - 0.01, 6), T + 2), [(x0 + x1) / 2, 0, -1]));
      }
      cuts.push(...armCuts.map((c) => k.rotate(c, [0, 0, a])));
    }
    const center = [];
    for (const pat of [p.fcPattern, p.fcPattern2]) if (pat > 0) for (const [x, y] of squarePattern(pat)) center.push(k.cylZ(sb.clear / 2, x, y, -1, T + 1, 24));
    if (p.standoffSpacing > 0) for (const [x, y] of squarePattern(p.standoffSpacing)) center.push(k.cylZ(sb.clear / 2, x, y, -1, T + 1, 24));
    const slots = [];
    if (p.strapSlots) {
      const sx = Math.min(p.centerSize / 2 - 4, Math.max(p.fcPattern, p.fcPattern2) / 2 + 6);
      for (const x of [-sx, sx]) slots.push(k.cuboid([3.2, Math.min(22, p.centerSize - 10), T + 2], [x, 0, T / 2]));
    }
    const frame = k.difference(k.union(add), [...cuts, ...center, ...slots]);

    // checks
    const motorGap = 2 * reach * Math.sin(Math.PI / p.arms) - p.propInches * INCH;
    if (motorGap < 5) warnings.push(`Props overlap or nearly touch: ${motorGap.toFixed(1)} mm between ${p.propInches} in props. Raise wheelbase to at least ${((p.propInches * INCH + 5) / Math.sin(Math.PI / p.arms)).toFixed(0)} mm.`);
    else notes.push(`Prop tip gap ${motorGap.toFixed(1)} mm with ${p.propInches} in props.`);
    if (p.standoffSpacing > 0 && p.standoffSpacing / 2 + 3 > p.centerSize / 2) warnings.push('Standoff holes are outside the center body.');
    const bed = Math.max(...angles.map((a) => Math.abs(Math.cos((a * Math.PI) / 180)))) * (reach + p.motorPad / 2) * 2;
    notes.push(`Wheelbase ${p.wheelbase} mm, ${p.arms} arms, about ${bed.toFixed(0)} mm across. Print flat; PETG, ASA or nylon. A printed frame is heavier and weaker than carbon: use it for small builds, tests and jigs.`);

    const parts = [{ name: 'frame', manifold: k.placeOnBed(frame) }];
    if (p.topPlate) {
      const tT = p.topThickness;
      const tc = [];
      if (p.standoffSpacing > 0) for (const [x, y] of squarePattern(p.standoffSpacing)) tc.push(k.cylZ(sb.clear / 2, x, y, -1, tT + 1, 24));
      if (p.strapSlots) {
        const sx = Math.min(p.centerSize / 2 - 4, Math.max(p.fcPattern, p.fcPattern2) / 2 + 6);
        for (const x of [-sx, sx]) tc.push(k.cuboid([3.2, Math.min(22, p.centerSize - 10), tT + 2], [x, 0, tT / 2]));
      }
      tc.push(k.translate(k.extrude(k.roundedRect(p.centerSize * 0.3, p.centerSize * 0.3, 3, 6), tT + 2), [0, 0, -1]));
      parts.push({ name: 'top-plate', manifold: k.placeOnBed(k.difference(k.roundedBlock(p.centerSize, p.centerSize, 6, 0, tT, 8), tc)) });
    }
    return { parts, warnings, notes };
  },
};

export const motorMount = {
  id: 'motor-mount',
  name: 'Motor Mount for Tube Arms',
  sections: ['quads', 'accessories'],
  description: 'Motor plate that clamps onto a round or square arm tube. Motor bolt pattern, pad size, tube size and clamp bolt are all adjustable. Prints motor-side down.',
  params: {
    tubeShape: { type: 'select', default: 'round', group: 'Arm tube', label: 'Tube shape', options: [{ value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }] },
    tubeSize: { type: 'number', default: 16, min: 4, max: 40, step: 0.05, unit: 'mm', label: 'Tube OD / side', group: 'Arm tube' },
    clearance: { type: 'number', default: 0.15, min: -0.3, max: 1.5, step: 0.05, unit: 'mm', label: 'Bore clearance (per side)', group: 'Arm tube' },
    clampLength: { type: 'number', default: 22, min: 8, max: 80, step: 0.5, unit: 'mm', label: 'Clamp length along the arm', group: 'Arm tube' },
    clampWall: { type: 'number', default: 2.5, min: 1.2, max: 10, step: 0.1, unit: 'mm', label: 'Clamp wall', group: 'Arm tube' },
    clampBolt: boltParam('Arm tube', 'M3', 'Clamp bolt'),
    slitGap: { type: 'number', default: 1.5, min: 0.4, max: 5, step: 0.1, unit: 'mm', label: 'Clamp slit gap', group: 'Arm tube' },
    padDiameter: { type: 'number', default: 32, min: 10, max: 80, step: 0.5, unit: 'mm', label: 'Motor pad diameter', group: 'Motor' },
    plateThickness: { type: 'number', default: 4, min: 2, max: 12, step: 0.1, unit: 'mm', label: 'Plate thickness', group: 'Motor' },
    motorPatternA: { type: 'number', default: 16, min: 4, max: 60, step: 0.1, unit: 'mm', label: 'Motor hole spacing A', group: 'Motor' },
    motorPatternB: { type: 'number', default: 19, min: 4, max: 60, step: 0.1, unit: 'mm', label: 'Motor hole spacing B', group: 'Motor' },
    patternRotate: { type: 'number', default: 45, min: 0, max: 90, step: 1, unit: 'deg', label: 'Pattern rotation vs. arm', group: 'Motor' },
    motorBolt: boltParam('Motor', 'M3', 'Motor screws'),
    centerHole: { type: 'number', default: 8, min: 0, max: 30, step: 0.5, unit: 'mm', label: 'Center hole', group: 'Motor' },
  },
  generate(p, k) {
    const warnings = [];
    const T = p.plateThickness;
    const cb = bolt(p.clampBolt);
    const mb = bolt(p.motorBolt);
    const holes = rotate2d(crossPattern(p.motorPatternA, p.motorPatternB), p.patternRotate);
    // the clamp starts behind the motor screws so their heads stay reachable from below
    const xStart = Math.max(...holes.map(([x]) => x + mb.head / 2 + 1), p.centerHole / 2 + 1);
    const xEnd = xStart + p.clampLength;
    const half = p.tubeSize / 2 + p.clearance;
    const R = half + p.clampWall;
    const zc = T + R - 0.6; // bore axis height above the bed
    const earLen = cb.head + 3;
    const earHalf = p.slitGap / 2 + Math.max(cb.nutH + 1.6, 3);
    const add = [
      k.cylZ(p.padDiameter / 2, 0, 0, 0, T, 72),
      k.cuboid([xEnd, 2 * R + 2, T], [xEnd / 2, 0, T / 2]), // wider than the clamp so faces never line up
    ];
    // clamp body: square bottom on the plate, round (or square) top, ears on top
    let bore;
    if (p.tubeShape === 'round') {
      const prof = [];
      for (let i = 0; i <= 32; i++) { const a = (Math.PI * i) / 32; prof.push([R * Math.cos(a), zc + R * Math.sin(a)]); }
      prof.push([-R, T - 0.5], [R, T - 0.5]);
      add.push(k.prismX(prof, xStart, xEnd));
      bore = k.holeX(half, 0, zc, xStart - 1, xEnd + 1, 64);
    } else {
      add.push(k.cuboid([xEnd - xStart, 2 * R, zc + R - (T - 0.5)], [(xStart + xEnd) / 2, 0, (T - 0.5 + zc + R) / 2]));
      bore = k.translate(k.rotate(k.extrude(k.roundedRect(2 * half, 2 * half, 1, 4), xEnd - xStart + 2), [0, 90, 0]), [xStart - 1, 0, zc]);
    }
    const top = zc + R;
    add.push(k.cuboid([xEnd - xStart, 2 * earHalf, earLen + 1], [(xStart + xEnd) / 2, 0, top + earLen / 2 - 0.5]));
    const cuts = [bore, k.cuboid([xEnd - xStart + 2, p.slitGap, earLen + R + 1], [(xStart + xEnd) / 2, 0, zc + (earLen + R + 1) / 2])];
    const nb = p.clampLength >= 4 * cb.head + 6 ? 2 : 1;
    const xs = nb === 1 ? [(xStart + xEnd) / 2] : [xStart + cb.head / 2 + 2, xEnd - cb.head / 2 - 2];
    const zb = top + earLen / 2 - 0.5;
    for (const x of xs) {
      cuts.push(k.holeY(cb.clear / 2, x, zb, -earHalf - 1, earHalf + 1));
      cuts.push(k.holeY(cb.head / 2 + 0.3, x, zb, earHalf - cb.headH - 0.3, earHalf + 1));
      const Rn = (cb.nutAF + 0.3) / Math.sqrt(3);
      cuts.push(k.prismY(regularPolygon(Rn, 6, 0).map(([u, v]) => [x + u, zb + v]), -earHalf - 1, -earHalf + cb.nutH + 0.4));
    }
    for (const [x, y] of holes) {
      cuts.push(k.cylZ(mb.clear / 2, x, y, -1, T + 1, 24));
      if (Math.abs(y) < R + mb.head / 2 && x + mb.head / 2 > xStart) warnings.push('A motor screw sits under the clamp. Change the pattern rotation.');
    }
    if (p.centerHole > 0) cuts.push(k.cylZ(p.centerHole / 2, 0, 0, -1, T + 1, 40));
    const part = k.difference(k.union(add), cuts);
    return {
      parts: [{ name: 'motor-mount', manifold: k.placeOnBed(part) }],
      warnings: [...new Set(warnings)],
      notes: [
        `Motor side is the bed side. Tube ${p.tubeShape} ${p.tubeSize} mm, clamp ${p.clampLength} mm, bore axis ${(zc).toFixed(1)} mm above the motor face.`,
        'Slide the arm tube in until it stops at the clamp start, tighten the clamp bolt, then fit the motor from the flat side.',
      ],
    };
  },
};

export const propGuard = {
  id: 'prop-guard',
  name: 'Prop Guard / Duct',
  sections: ['quads'],
  description: 'Ring guard that mounts under the motor with its bolt pattern: set prop size, clearance, ring height and spokes. Print in TPU or PETG.',
  params: {
    propInches: { type: 'number', default: 3, min: 1, max: 12, step: 0.1, unit: 'in', label: 'Prop diameter', group: 'Guard' },
    tipClearance: { type: 'number', default: 3, min: 1, max: 20, step: 0.5, unit: 'mm', label: 'Tip clearance', group: 'Guard' },
    ringHeight: { type: 'number', default: 12, min: 3, max: 60, step: 0.5, unit: 'mm', label: 'Ring height', group: 'Guard' },
    ringWall: { type: 'number', default: 1.6, min: 0.8, max: 5, step: 0.1, unit: 'mm', label: 'Ring wall', group: 'Guard' },
    spokes: { type: 'integer', default: 3, min: 2, max: 8, label: 'Spokes', group: 'Guard' },
    spokeWidth: { type: 'number', default: 5, min: 2, max: 20, step: 0.5, unit: 'mm', label: 'Spoke width', group: 'Guard' },
    thickness: { type: 'number', default: 2.4, min: 1, max: 8, step: 0.1, unit: 'mm', label: 'Hub / spoke thickness', group: 'Guard' },
    hubDiameter: { type: 'number', default: 20, min: 6, max: 60, step: 0.5, unit: 'mm', label: 'Hub diameter', group: 'Motor' },
    motorPatternA: { type: 'number', default: 12, min: 3, max: 40, step: 0.1, unit: 'mm', label: 'Motor hole spacing A', group: 'Motor' },
    motorPatternB: { type: 'number', default: 12, min: 3, max: 40, step: 0.1, unit: 'mm', label: 'Motor hole spacing B', group: 'Motor' },
    motorHole: { type: 'number', default: 2.2, min: 1, max: 5, step: 0.05, unit: 'mm', label: 'Motor screw hole', group: 'Motor' },
    centerHole: { type: 'number', default: 5, min: 0, max: 20, step: 0.5, unit: 'mm', label: 'Center hole', group: 'Motor' },
  },
  generate(p, k) {
    const warnings = [];
    const ri = (p.propInches * INCH) / 2 + p.tipClearance;
    const ro = ri + p.ringWall;
    const T = p.thickness;
    const add = [
      k.difference(k.cylZ(ro, 0, 0, 0, p.ringHeight, 128), [k.cylZ(ri, 0, 0, -1, p.ringHeight + 1, 128)]),
      k.cylZ(p.hubDiameter / 2, 0, 0, 0, T, 48),
    ];
    for (let i = 0; i < p.spokes; i++) {
      const a = (i * 360) / p.spokes + 90 / p.spokes;
      add.push(k.rotate(k.cuboid([ro - p.hubDiameter / 4, p.spokeWidth, T], [(p.hubDiameter / 4 + ro - 0.3) / 2, 0, T / 2]), [0, 0, a]));
    }
    const cuts = crossPattern(p.motorPatternA, p.motorPatternB).map(([x, y]) => k.cylZ(p.motorHole / 2, x, y, -1, T + 1, 20));
    if (p.centerHole > 0) cuts.push(k.cylZ(p.centerHole / 2, 0, 0, -1, T + 1, 32));
    if (Math.max(p.motorPatternA, p.motorPatternB) / 2 + p.motorHole > p.hubDiameter / 2) warnings.push('Motor holes are outside the hub. Raise hubDiameter.');
    const guard = k.difference(k.union(add), cuts);
    return {
      parts: [{ name: 'prop-guard', manifold: k.placeOnBed(guard) }],
      warnings,
      notes: [`Ring ID ${(2 * ri).toFixed(1)} mm for ${p.propInches} in props. Mounts between motor and arm; use screws ${T.toFixed(1)} mm longer.`],
    };
  },
};

export const landingLeg = {
  id: 'landing-leg',
  name: 'Landing Leg',
  sections: ['quads', 'accessories'],
  description: 'Landing leg with a flat bolt-on base or a tube socket, adjustable length, taper, splay angle and a flared foot. Prints base-down with no supports.',
  params: {
    mount: { type: 'select', default: 'plate', group: 'Mount', label: 'Mount', options: [{ value: 'plate', label: 'Flat plate with 2 holes' }, { value: 'socket', label: 'Tube socket' }] },
    plateLength: { type: 'number', default: 30, min: 10, max: 100, step: 0.5, unit: 'mm', label: 'Plate length', group: 'Mount' },
    plateWidth: { type: 'number', default: 14, min: 6, max: 60, step: 0.5, unit: 'mm', label: 'Plate width', group: 'Mount' },
    plateThickness: { type: 'number', default: 3, min: 1.5, max: 10, step: 0.1, unit: 'mm', label: 'Plate thickness', group: 'Mount' },
    holeSpacing: { type: 'number', default: 20, min: 0, max: 90, step: 0.1, unit: 'mm', label: 'Hole spacing', group: 'Mount' },
    bolt: boltParam('Mount', 'M3', 'Screws'),
    tubeOD: { type: 'number', default: 10, min: 3, max: 40, step: 0.05, unit: 'mm', label: 'Socket tube OD', group: 'Mount' },
    socketDepth: { type: 'number', default: 15, min: 4, max: 60, step: 0.5, unit: 'mm', label: 'Socket depth', group: 'Mount' },
    clearance: { type: 'number', default: 0.15, min: -0.2, max: 1, step: 0.05, unit: 'mm', label: 'Socket clearance', group: 'Mount' },
    legLength: { type: 'number', default: 60, min: 10, max: 250, step: 1, unit: 'mm', label: 'Leg length', group: 'Leg' },
    topDiameter: { type: 'number', default: 10, min: 4, max: 40, step: 0.5, unit: 'mm', label: 'Leg diameter at the mount', group: 'Leg' },
    bottomDiameter: { type: 'number', default: 7, min: 3, max: 40, step: 0.5, unit: 'mm', label: 'Leg diameter at the foot', group: 'Leg' },
    splay: { type: 'number', default: 15, min: 0, max: 40, step: 1, unit: 'deg', label: 'Splay angle (outward)', group: 'Leg' },
    footDiameter: { type: 'number', default: 16, min: 4, max: 60, step: 0.5, unit: 'mm', label: 'Foot diameter', group: 'Leg' },
  },
  generate(p, k) {
    const warnings = [];
    const add = [];
    const cuts = [];
    let zTop; // where the leg starts
    if (p.mount === 'plate') {
      const T = p.plateThickness;
      add.push(k.roundedBlock(p.plateLength, p.plateWidth, 3, 0, T, 6));
      const b = bolt(p.bolt);
      for (const x of [-p.holeSpacing / 2, p.holeSpacing / 2]) if (p.holeSpacing > 0) cuts.push(k.cylZ(b.clear / 2, x, 0, -1, T + 1, 24));
      if (p.holeSpacing / 2 - b.head / 2 < p.topDiameter / 2) warnings.push('Screw holes sit under the leg. Increase holeSpacing.');
      zTop = T - 0.5;
    } else {
      const r = p.tubeOD / 2 + p.clearance;
      const R = Math.max(r + 2.4, p.topDiameter / 2);
      add.push(k.cylZ(R, 0, 0, 0, p.socketDepth + 2, 64));
      cuts.push(k.cylZ(r, 0, 0, -1, p.socketDepth, 64));
      zTop = p.socketDepth + 1.5;
    }
    // leg grows upward (it hangs down in use), tilted by splay toward +X
    const s = Math.sin((p.splay * Math.PI) / 180);
    const c = Math.cos((p.splay * Math.PI) / 180);
    const end = [p.legLength * s, 0, zTop + p.legLength * c];
    const leg = k.hull([
      k.cylZ(p.topDiameter / 2, 0, 0, zTop, zTop + 0.01, 48),
      k.track(k.track(k.Manifold.sphere(p.bottomDiameter / 2, 32)).translate(end)),
    ]);
    // foot flares at 45 deg so it prints without support, then a flat pad
    const footR = p.footDiameter / 2;
    const flare = Math.max(0.5, footR - p.bottomDiameter / 2);
    const foot = k.hull([
      k.track(k.track(k.Manifold.sphere(p.bottomDiameter / 2, 32)).translate([end[0] - flare * s, 0, end[2] - flare * c])),
      k.cylZ(footR, end[0], 0, end[2], end[2] + 2, 48),
    ]);
    add.push(leg, foot);
    const part = k.difference(k.union(add), cuts);
    return {
      parts: [{ name: 'leg', manifold: k.placeOnBed(part) }],
      warnings,
      notes: [`Leg ${p.legLength} mm at ${p.splay} deg splay. Prints mount-down; the foot is at the top of the print. TPU legs absorb hard landings.`],
    };
  },
};
