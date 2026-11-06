// Gimbal assemblies: multi-part designs that are built where each part sits
// in the finished gimbal, then turned to print orientation with k.pose().
// The 3D view's "Assembled" layout uses the returned matrices to show the
// parts together; downloads are the print-oriented STLs.
//
//   servo-gimbal      2-axis pan-tilt on hobby servos (9 g class, MG90S, MG996R...)
//   brushless-gimbal  2-axis (roll + tilt) frame for brushless gimbal motors and a
//                     SimpleBGC-type controller (Tarot T-2D style layout)
//
// Servo and motor sizes are parameters, not built-in tables: measure yours.
// Presets mark datasheet values with "verify" and unknown ones with "measure".

import { bolt, boltParam, circlePattern, squarePattern } from '../core/hardware.js';
import { teardrop } from '../core/kernel.js';

/** Hole along X whose teardrop tip points +Y (for parts printed lying on their XZ face). */
const holeXtipY = (k, r, y, z, x0, x1) => k.prismX(teardrop(r, 24).map(([u, v]) => [y + u, z + v]), x0, x1);
/** Hole along Z whose teardrop tip points +Y. */
const holeZtipY = (k, r, x, y, z0, z1) => k.prismZ(teardrop(r, 24).map(([u, v]) => [x + v, y + u]), z0, z1);
/** Round hole along Y (rod). */
const holeY = (k, r, x, z, y0, y1) => k.rod([x, y0, z], [x, y1, z], r, 24);

export const servoGimbal = {
  id: 'servo-gimbal',
  name: 'Servo Pan-Tilt Gimbal (assembly)',
  sections: ['robotics', 'quads'],
  assembly: true,
  description: 'Two-axis pan-tilt on two hobby servos: base with the pan servo, pan bracket that holds the tilt servo, camera arm with a plate, FPV-camera cheeks or a bare shelf. Three parts, shown assembled or as a print plate. Set your servo sizes.',
  basic: ['servoLength', 'servoWidth', 'servoHeight', 'earZ', 'earSpacing', 'camera', 'cameraWidth'],
  params: {
    servoLength: { type: 'number', default: 23, min: 10, max: 70, step: 0.1, unit: 'mm', label: 'Servo body length', group: 'Servo', help: 'Without the ears. 9 g class about 23, standard about 40.5. Measure yours.' },
    servoWidth: { type: 'number', default: 12.5, min: 6, max: 30, step: 0.1, unit: 'mm', label: 'Servo body width', group: 'Servo' },
    servoHeight: { type: 'number', default: 22.5, min: 8, max: 60, step: 0.1, unit: 'mm', label: 'Servo body height (no shaft boss)', group: 'Servo' },
    earZ: { type: 'number', default: 15.5, min: 3, max: 50, step: 0.1, unit: 'mm', label: 'Bottom to ear underside', group: 'Servo', help: 'From the servo bottom to the underside of the mounting ears.' },
    earSpacing: { type: 'number', default: 28, min: 12, max: 80, step: 0.1, unit: 'mm', label: 'Ear screw hole spacing', group: 'Servo' },
    earHole: { type: 'number', default: 1.8, min: 1, max: 5, step: 0.05, unit: 'mm', label: 'Ear screw hole', group: 'Servo', help: 'Self-tapping servo screws: about 1.8 (9 g) or 3 (standard).' },
    shaftFromEnd: { type: 'number', default: 6, min: 2, max: 30, step: 0.1, unit: 'mm', label: 'Shaft center from body end', group: 'Servo' },
    hornClear: { type: 'number', default: 4.5, min: 1, max: 20, step: 0.1, unit: 'mm', label: 'Body top to horn face', group: 'Servo', help: 'Height of the horn mounting face above the servo body.' },
    hornCircle: { type: 'number', default: 14, min: 6, max: 40, step: 0.1, unit: 'mm', label: 'Horn screw circle', group: 'Servo', help: 'Use a round horn; holes on this circle.' },
    hornHole: { type: 'number', default: 1.5, min: 0.8, max: 3, step: 0.05, unit: 'mm', label: 'Horn screw hole', group: 'Servo' },
    clearance: { type: 'number', default: 0.4, min: 0, max: 2, step: 0.05, unit: 'mm', label: 'Body clearance (per side)', group: 'Servo' },
    camera: { type: 'select', default: 'fpv', group: 'Camera', label: 'Camera mount', options: [{ value: 'fpv', label: 'FPV camera cheeks (side screws)' }, { value: 'plate', label: 'Plate with 1/4 in tripod hole' }, { value: 'none', label: 'Bare shelf' }] },
    cameraWidth: { type: 'number', default: 19, min: 8, max: 60, step: 0.1, unit: 'mm', label: 'Camera width (cheeks)', group: 'Camera', help: '19 micro, 14 nano, 21 mini FPV cameras.' },
    sideScrew: boltParam('Camera', 'M2', 'Camera side screws'),
    shelfWidth: { type: 'number', default: 30, min: 15, max: 100, step: 0.5, unit: 'mm', label: 'Shelf width', group: 'Camera' },
    shelfDepth: { type: 'number', default: 26, min: 10, max: 100, step: 0.5, unit: 'mm', label: 'Shelf depth (forward)', group: 'Camera' },
    shelfDrop: { type: 'number', default: 8, min: 0, max: 60, step: 0.5, unit: 'mm', label: 'Shelf below the tilt axis', group: 'Camera', help: 'Puts the camera near the tilt axis for balance.' },
    wall: { type: 'number', default: 2.4, min: 1.6, max: 6, step: 0.1, unit: 'mm', label: 'Wall', group: 'Frame' },
    thickness: { type: 'number', default: 3, min: 2, max: 8, step: 0.1, unit: 'mm', label: 'Plate thickness', group: 'Frame' },
    baseWidth: { type: 'number', default: 56, min: 30, max: 200, step: 1, unit: 'mm', label: 'Base width (min)', group: 'Frame', help: 'Grows to fit the servo.' },
    baseDepth: { type: 'number', default: 44, min: 30, max: 200, step: 1, unit: 'mm', label: 'Base depth (min)', group: 'Frame' },
    baseBolt: boltParam('Frame', 'M3', 'Base screws'),
  },
  generate(p, k) {
    const warnings = [];
    const notes = [];
    const c = p.clearance;
    const w = p.wall;
    const T = p.thickness;
    const L = p.servoLength, W = p.servoWidth, Hs = p.servoHeight;
    if (p.earZ >= Hs) throw new Error('Bottom-to-ear height must be less than the servo body height.');
    if (p.earSpacing <= L) warnings.push('Ear spacing is not longer than the body: check the servo sizes.');
    if (p.shaftFromEnd >= L) throw new Error('Shaft position is outside the servo body.');
    const cutL = L + 2 * c;
    const cutW = W + 2 * c;
    const earSpan = p.earSpacing + p.earHole + 2 * w + 2;

    // ---------------- base: plate + collar for the pan servo (shaft up at x = 0, y = 0)
    const bx = L / 2 - p.shaftFromEnd; // body center x
    const Lc = Math.max(cutL + 2 * w, earSpan);
    const Wc = cutW + 2 * w;
    const bb = bolt(p.baseBolt);
    const BW = Math.max(p.baseWidth, Lc + 2 * (bb.head + 3));
    const BD = Math.max(p.baseDepth, Wc + 12);
    const plate = k.translate(k.roundedBlock(BW, BD, 4, 0, T, 8), [bx, 0, 0]);
    const collar = k.translate(k.roundedBlock(Lc, Wc, 2, T - 0.01, T + p.earZ, 6), [bx, 0, 0]);
    const baseCuts = [
      k.cuboid([cutL, cutW, p.earZ + 1], [bx, 0, T + p.earZ / 2 + 0.5]),
      k.cuboid([w * 3, 6, 4.5], [bx - Lc / 2 + w / 2, 0, T + 2.25]), // cable notch
    ];
    for (const s of [-1, 1]) baseCuts.push(k.cylZ(p.earHole / 2, bx + s * p.earSpacing / 2, 0, T + p.earZ - 8, T + p.earZ + 1, 16));
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [bx + sx * (BW / 2 - bb.head / 2 - 2), sy * (BD / 2 - bb.head / 2 - 2)])) {
      baseCuts.push(k.cylZ(bb.clear / 2, x, y, -1, T + 1, 24));
      baseCuts.push(k.coneZ(bb.clear / 2, bb.head / 2 + 0.5, x, y, T - (bb.head - bb.clear) / 2, T + 0.01, 24));
    }
    const base = k.difference(k.union([plate, collar]), baseCuts);

    // ---------------- pan bracket: disk on the pan horn + vertical plate holding the tilt servo
    const z0 = T + Hs + p.hornClear; // pan horn face
    const Rd = p.hornCircle / 2 + 5;
    const Hpl = Math.max(cutL + 2 * w, earSpan);
    const Wpl = cutW + 2 * w;
    const yp = p.earZ - Hs / 2 - T; // plate back face, so the tilt servo body is centered over the pan axis
    const zc = z0 + T + Hpl / 2; // tilt servo cutout center
    const disk = k.cylZ(Math.max(Rd, Wpl / 2 + 2), 0, 0, z0, z0 + T, 64);
    const upright = k.cuboid([Wpl, T, Hpl], [0, yp + T / 2, z0 + T - 0.01 + Hpl / 2]);
    const gussets = [-1, 1].map((s) => {
      const x0 = s < 0 ? -Wpl / 2 : Wpl / 2 - 2;
      const g = Math.min(10, Hpl * 0.4);
      return k.prismX([[yp + 0.2, z0 + T - 0.2], [yp - g, z0 + T - 0.2], [yp + 0.2, z0 + T + g]], x0, x0 + 2);
    });
    const bracketCuts = [
      k.cylZ(1.6, 0, 0, z0 - 1, z0 + T + 1, 16), // horn screw
      ...circlePattern(p.hornCircle, 4, 45).map(([x, y]) => k.cylZ(p.hornHole / 2, x, y, z0 - 1, z0 + T + 1, 16)),
      k.cuboid([cutW, T * 3, cutL], [0, yp + T / 2, zc]),
      ...[-1, 1].map((s) => k.holeY(p.earHole / 2, 0, zc + s * p.earSpacing / 2, yp - 1, yp + T + 1, 16)),
    ];
    const bracket = k.difference(k.union([disk, upright, ...gussets]), bracketCuts);
    if (Math.abs(yp) + T > Math.max(Rd, Wpl / 2 + 2)) warnings.push('Tilt servo plate overhangs the pan disk: check the servo sizes.');

    // ---------------- camera arm on the tilt horn (tilt axis along Y)
    const zs = zc + cutL / 2 - c - p.shaftFromEnd; // tilt shaft height
    const yh = yp + T - p.earZ + Hs + p.hornClear; // tilt horn face
    const Ra = p.hornCircle / 2 + 5;
    const zsh = zs - p.shelfDrop; // shelf top
    const SW = Math.max(p.shelfWidth, p.camera === 'fpv' ? p.cameraWidth + 2 * c + 2 * w + 2 : 0);
    const armBlock = k.cuboid([SW, T, T - 0.6], [0, yh + T / 2, zsh - T / 2]);
    const arm = k.hull([k.rod([0, yh, zs], [0, yh + T, zs], Ra, 48), armBlock]);
    const shelf = k.cuboid([SW, p.shelfDepth, T], [0, yh + 0.2 + p.shelfDepth / 2, zsh - T / 2]);
    const camAdd = [];
    const camCuts = [
      holeY(k, 1.6, 0, zs, yh - 1, yh + T + 1),
      ...circlePattern(p.hornCircle, 4, 45).map(([x, z]) => holeY(k, p.hornHole / 2, x, zs + z, yh - 1, yh + T + 1)),
    ];
    if (p.camera === 'fpv') {
      const sb = bolt(p.sideScrew);
      const ch = Math.max(10, p.cameraWidth * 0.75);
      const yC = yh + T + 1 + (p.shelfDepth - T - 1) / 2;
      const depth = Math.max(8, p.shelfDepth - T - 1.2);
      for (const s of [-1, 1]) {
        const x = s * (p.cameraWidth / 2 + c + w / 2);
        camAdd.push(k.cuboid([w, depth, ch], [x, yC, zsh - 0.01 + ch / 2]));
        camCuts.push(holeXtipY(k, sb.clear / 2, yC, zsh + ch * 0.55, x - w, x + w));
      }
      notes.push(`Camera cheeks ${(p.cameraWidth + 2 * c).toFixed(1)} mm apart with ${p.sideScrew} side screw holes; the lens faces forward (away from the servos).`);
    } else if (p.camera === 'plate') {
      const yC = yh + 0.2 + p.shelfDepth / 2;
      camCuts.push(holeZtipY(k, 3.3, 0, yC, zsh - T - 1, zsh + 1));
      for (const s of [-1, 1]) camCuts.push(holeZtipY(k, 1.7, s * Math.min(10, SW / 2 - 4), yC, zsh - T - 1, zsh + 1));
      notes.push('Shelf with a 6.6 mm hole for a 1/4-20 tripod screw and two M3 holes.');
    }
    const camArm = k.difference(k.union([arm, shelf, ...camAdd]), camCuts);
    if (yh < Math.max(Rd, Wpl / 2 + 2) + 1) warnings.push('Camera arm is close to the pan disk: it may rub when tilting.');

    const a = k.pose(base, [0, 0, 0]);
    const b = k.pose(bracket, [0, 0, 0]);
    const cam = k.pose(camArm, [90, 0, 0]); // arm flat on the bed, shelf and cheeks standing
    notes.push(`Pan axis at the base center; tilt axis ${zs.toFixed(1)} mm above the bed, ${yh.toFixed(1)} mm in front of the pan axis.`);
    notes.push('Assembly: pan servo into the base collar (ears on top), pan bracket on the pan horn, tilt servo through the bracket plate, camera arm on the tilt horn. Centre both servos before fitting the horns.');
    notes.push('Single-sided camera arm: for light cameras (FPV, small boards). Turn the 3D view to Assembled to check clearance.');
    return {
      parts: [
        { name: 'base', manifold: a.manifold, assembled: a.assembled },
        { name: 'pan-bracket', manifold: b.manifold, assembled: b.assembled },
        { name: 'camera-arm', manifold: cam.manifold, assembled: cam.assembled },
      ],
      warnings, notes,
    };
  },
};

export const brushlessGimbal = {
  id: 'brushless-gimbal',
  name: 'Brushless 2-Axis Gimbal Frame (assembly)',
  sections: ['quads', 'robotics'],
  assembly: true,
  description: 'Frame for a 2-axis brushless gimbal (roll + tilt) with a SimpleBGC-type controller, Tarot T-2D style: damper top plate with the roll motor, roll arm to the tilt motor, camera cage. Motor hole patterns and camera size are parameters: measure your motors and camera.',
  basic: ['rollPCD', 'tiltPCD', 'motorDiameter', 'cameraWidth', 'cameraHeight', 'cameraDepth', 'ballSpacingX', 'ballSpacingY'],
  params: {
    motorDiameter: { type: 'number', default: 28, min: 15, max: 80, step: 0.5, unit: 'mm', label: 'Motor outer diameter', group: 'Motors', help: 'Measure your gimbal motors.' },
    motorHeight: { type: 'number', default: 14, min: 5, max: 40, step: 0.5, unit: 'mm', label: 'Motor height', group: 'Motors' },
    rollPCD: { type: 'number', default: 19, min: 6, max: 70, step: 0.05, unit: 'mm', label: 'Roll motor hole circle', group: 'Motors', help: 'Stator and rotor screws on this circle (4 holes). Measure.' },
    tiltPCD: { type: 'number', default: 19, min: 6, max: 70, step: 0.05, unit: 'mm', label: 'Tilt motor hole circle', group: 'Motors' },
    motorBolt: boltParam('Motors', 'M2.5', 'Motor screws'),
    centerHole: { type: 'number', default: 8, min: 0, max: 40, step: 0.5, unit: 'mm', label: 'Motor center hole (wires)', group: 'Motors' },
    cameraWidth: { type: 'number', default: 62, min: 20, max: 140, step: 0.5, unit: 'mm', label: 'Camera width (X, lens forward)', group: 'Camera', help: 'GoPro-size cameras: measure yours.' },
    cameraHeight: { type: 'number', default: 44, min: 15, max: 120, step: 0.5, unit: 'mm', label: 'Camera height', group: 'Camera' },
    cameraDepth: { type: 'number', default: 31, min: 10, max: 80, step: 0.5, unit: 'mm', label: 'Camera depth (lens axis)', group: 'Camera' },
    clearance: { type: 'number', default: 0.6, min: 0, max: 3, step: 0.05, unit: 'mm', label: 'Camera clearance (per side)', group: 'Camera' },
    ballSpacingX: { type: 'number', default: 50, min: 20, max: 160, step: 0.5, unit: 'mm', label: 'Damper ball spacing X', group: 'Top plate' },
    ballSpacingY: { type: 'number', default: 40, min: 20, max: 160, step: 0.5, unit: 'mm', label: 'Damper ball spacing Y', group: 'Top plate' },
    ballHole: { type: 'number', default: 6.5, min: 3, max: 15, step: 0.1, unit: 'mm', label: 'Damper ball hole', group: 'Top plate' },
    controllerPattern: { type: 'number', default: 30.5, min: 0, max: 60, step: 0.05, unit: 'mm', label: 'Controller hole spacing (0 = none)', group: 'Top plate', help: 'Square pattern for the gimbal controller board on the top plate.' },
    thickness: { type: 'number', default: 3, min: 2, max: 8, step: 0.1, unit: 'mm', label: 'Plate thickness', group: 'Frame' },
    armWidth: { type: 'number', default: 14, min: 8, max: 40, step: 0.5, unit: 'mm', label: 'Arm width', group: 'Frame' },
    drop: { type: 'number', default: 12, min: 4, max: 80, step: 0.5, unit: 'mm', label: 'Roll axis below the top plate', group: 'Frame' },
  },
  generate(p, k) {
    const warnings = [];
    const notes = [];
    const T = p.thickness;
    const mb = bolt(p.motorBolt);
    const Rm = p.motorDiameter / 2;
    const cw = p.cameraWidth + 2 * p.clearance;
    const chh = p.cameraHeight + 2 * p.clearance;
    const cd = p.cameraDepth + 2 * p.clearance;
    const mountR = Math.max(Rm, Math.max(p.rollPCD, p.tiltPCD) / 2 + mb.head / 2 + 2);
    if (p.rollPCD / 2 + mb.head / 2 > Rm + 4 || p.tiltPCD / 2 + mb.head / 2 > Rm + 4) warnings.push('Motor hole circle is larger than the motor: check the pattern.');
    const motorHoles = (pcd, axis, center, y0, y1) => {
      const out = [];
      for (const [u, v] of circlePattern(pcd, 4, 45)) {
        if (axis === 'x') out.push(k.rod([y0, center[1] + u, center[2] + v], [y1, center[1] + u, center[2] + v], mb.clear / 2, 20));
        else out.push(k.rod([center[0] + u, y0, center[2] + v], [center[0] + u, y1, center[2] + v], mb.clear / 2, 20));
      }
      if (p.centerHole > 0) out.push(axis === 'x' ? k.rod([y0, center[1], center[2]], [y1, center[1], center[2]], p.centerHole / 2, 32) : k.rod([center[0], y0, center[2]], [center[0], y1, center[2]], p.centerHole / 2, 32));
      return out;
    };

    // Coordinates: camera lens looks +Y. Roll axis along Y at the back (y < 0), tilt axis along X.
    // Top plate at z = 0..T. The roll motor hangs from a back plate (XZ plane) under the top plate.
    const PX = p.ballSpacingX + p.ballHole + 10;
    const PY = p.ballSpacingY + p.ballHole + 10;
    const yBack = -(cd / 2 + p.motorHeight + 2 * T + 6); // back plate front face (roll stator side)
    const zRoll = -(p.drop + mountR); // roll axis height
    const top = k.roundedBlock(PX, Math.max(PY, -yBack * 2 + 4), 5, 0, T, 8);
    const backPlate = k.hull([
      k.cuboid([2 * mountR, T, 1], [0, yBack - T / 2, -0.5 + 0.01]),
      k.rod([0, yBack - T, zRoll], [0, yBack, zRoll], mountR, 64),
    ]);
    const gus = [-1, 1].map((s) => k.prismX([[yBack - T + 0.2, 0.2], [yBack - T + 0.2 + 8, 0.2], [yBack - T + 0.2, -8]], s * (mountR - 1) - 1, s * (mountR - 1) + 1));
    const topCuts = [
      ...squarePattern(p.ballSpacingX, p.ballSpacingY).map(([x, y]) => k.cylZ(p.ballHole / 2, x, y, -1, T + 1, 32)),
      ...motorHoles(p.rollPCD, 'y', [0, 0, zRoll], yBack - T - 1, yBack + 1),
    ];
    if (p.controllerPattern > 0) for (const [x, y] of squarePattern(p.controllerPattern)) topCuts.push(k.cylZ(1.4, x, y, -1, T + 1, 16));
    const topPart = k.difference(k.union([top, backPlate, ...gus]), topCuts);

    // Roll arm: disk on the roll rotor (front of the roll motor), down and out to the tilt motor plate (YZ plane at +X side)
    const yRotor = yBack + p.motorHeight; // roll rotor face
    const gap = 3; // boss between the cage side and the tilt rotor
    const xTilt = cw / 2 + T + gap + p.motorHeight + T; // tilt motor plate (outer face at +X)
    const zTilt = zRoll - chh / 2 - 6; // tilt axis height (camera center)
    const arm = p.armWidth;
    const rollDisk = k.rod([0, yRotor, zRoll], [0, yRotor + T, zRoll], mountR, 64);
    const armBar = k.hull([
      k.cuboid([arm, T, arm], [0, yRotor + T / 2, zRoll]),
      k.cuboid([arm, T, arm], [xTilt - T / 2, yRotor + T / 2, zRoll]),
    ]);
    const armSide = k.hull([
      k.cuboid([T, T, arm], [xTilt - T / 2, yRotor + T / 2, zRoll]),
      k.cuboid([T, 2 * mountR, 2 * mountR], [xTilt - T / 2, 0, zTilt]),
    ]);
    const tiltPlate = k.rod([xTilt - T, 0, zTilt], [xTilt, 0, zTilt], mountR, 64);
    const armCuts = [
      ...motorHoles(p.rollPCD, 'y', [0, 0, zRoll], yRotor - 1, yRotor + T + 1),
      ...motorHoles(p.tiltPCD, 'x', [0, 0, zTilt], xTilt - T - 1, xTilt + 1),
    ];
    const rollArm = k.difference(k.union([rollDisk, armBar, armSide, tiltPlate]), armCuts);

    // Camera cage: U cage around the camera, plate on the tilt rotor at the -X face of the tilt motor (motor sits inside the arm)
    const xRotor = xTilt - T - p.motorHeight; // tilt rotor face (motor between arm plate and cage side)
    const cageW = cw + 2 * T;
    const cage = k.difference(
      k.cuboid([cageW, cd + 2 * T, chh + T], [0, 0, zTilt - T / 2]),
      [
        k.cuboid([cw, cd, chh + 1], [0, 0, zTilt + 0.5]),
        k.cuboid([cw - 8, cd + 4 * T, chh - 8], [0, 0, zTilt + 4]), // lens and back windows
        k.cuboid([cw - 10, cd - 8, T * 3], [0, 0, zTilt - chh / 2 - T / 2]), // floor window
      ]);
    const cageMount = k.rod([cageW / 2 - 0.01, 0, zTilt], [xRotor, 0, zTilt], mountR, 64);
    if (xTilt * 2 > 200) warnings.push('The frame is wider than 200 mm: check the camera and motor sizes.');
    const camCage = k.difference(k.union([cage, cageMount]), motorHoles(p.tiltPCD, 'x', [0, 0, zTilt], cageW / 2 - 1, xRotor + 1));

    const a = k.pose(topPart, [180, 0, 0]); // top plate face down, back plate up
    const b = k.pose(rollArm, [90, 0, 0]); // roll disk flat on the bed
    const c2 = k.pose(camCage, [0, 0, 0]);
    notes.push(`Roll axis ${(-zRoll).toFixed(1)} mm below the top plate; tilt axis at the camera center. Camera space ${cw.toFixed(1)} x ${cd.toFixed(1)} x ${chh.toFixed(1)} mm.`);
    notes.push('Balance the camera on both axes before powering the controller. Print in PETG or ASA (motors get warm).');
    notes.push('The roll arm prints with its roll disk flat; the tilt plate stands up. Use supports only if your printer needs them for the arm bridge.');
    return {
      parts: [
        { name: 'top-plate', manifold: a.manifold, assembled: a.assembled },
        { name: 'roll-arm', manifold: b.manifold, assembled: b.assembled },
        { name: 'camera-cage', manifold: c2.manifold, assembled: c2.assembled },
      ],
      warnings, notes,
    };
  },
};
