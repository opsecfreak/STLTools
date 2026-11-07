// Modular quad frame (assembly): bottom plate, top plate, four separate arms with
// motor mounts, and standoffs (bought nylon ones, or printed). Each arm is its own
// print, so a broken arm is one small reprint.
//
// Arm joints (arm root sits on the bottom plate):
//   bolt     2 machine screws through arm and plate, nuts in hex pockets under the plate
//   insert   2 heat-set inserts in the arm (pressed in from below), screws from under the plate
//   dovetail the root drops into a dovetail socket on the plate and cannot pull out;
//            one screw holds it down (quick swap in the field)
// Screws M2 to M4. Standoffs M2, M2.5 or M3, between the arms, with the FC stack
// (20 x 20, 25.5 x 25.5 or 30.5 x 30.5) in the middle.
// Cable routing: a groove along the top of each arm from the motor to the plate,
// zip-tie slot pairs along the arm, strap and wire slots in both plates, optional
// SMA antenna tab at the back.
//
// Built in place (assembled), then each part is turned to print flat.
import { bolt, boltParam, squarePattern, crossPattern, rotate2d } from '../core/hardware.js';
import { regularPolygon } from '../core/kernel.js';

const INCH = 25.4;
const STACK = { none: null, '20': { s: 20, b: 'M2' }, '25.5': { s: 25.5, b: 'M2' }, '30.5': { s: 30.5, b: 'M3' } };

/** Column-major 4x4: rotation about Z by deg, times matrix m. */
function rotZTimes(deg, m) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const out = m.slice();
  for (let col = 0; col < 4; col++) {
    const x = m[col * 4], y = m[col * 4 + 1];
    out[col * 4] = c * x - s * y;
    out[col * 4 + 1] = s * x + c * y;
  }
  return out.map((v) => Math.round(v * 1e6) / 1e6);
}

export const quadModular = {
  id: 'quad-modular',
  name: 'Modular Quad Frame (assembly)',
  assembly: true,
  sections: ['quads'],
  description: 'Quad frame in parts: bottom and top plates, four separate arms with motor mounts, standoffs. Arms bolt on, use heat-set inserts, or drop into dovetail sockets. M2-M4 screws, M2-M3 nylon standoffs, FC stack 20/25.5/30.5, cable grooves and zip-tie slots, SMA tab.',
  basic: ['wheelbase', 'propInches', 'joint', 'armBolt', 'standoffBolt', 'plateGap', 'stack'],
  params: {
    wheelbase: { type: 'number', default: 250, min: 100, max: 500, step: 1, unit: 'mm', label: 'Wheelbase (motor to opposite motor)', group: 'Layout' },
    armAngle: { type: 'number', default: 45, min: 20, max: 70, step: 1, unit: 'deg', label: 'Front arm angle from the nose', group: 'Layout', help: '45 = square X. Smaller = wider than long (stretch X).' },
    propInches: { type: 'number', default: 5, min: 2, max: 10, step: 0.1, unit: 'in', label: 'Prop size (clearance check)', group: 'Layout' },
    stack: { type: 'select', default: '30.5', label: 'FC stack pattern', group: 'Plates', options: [{ value: '30.5', label: '30.5 x 30.5 (M3)' }, { value: '25.5', label: '25.5 x 25.5 (M2)' }, { value: '20', label: '20 x 20 (M2)' }, { value: 'none', label: 'None' }] },
    stackHole: { type: 'select', default: 'clear', label: 'Stack holes', group: 'Plates', options: [{ value: 'clear', label: 'Clearance (screws or standoffs with nuts)' }, { value: 'tap', label: 'Tap size (screw cuts the thread)' }] },
    bottomThickness: { type: 'number', default: 4, min: 2, max: 8, step: 0.1, unit: 'mm', label: 'Bottom plate thickness', group: 'Plates' },
    topThickness: { type: 'number', default: 3, min: 1.6, max: 6, step: 0.1, unit: 'mm', label: 'Top plate thickness', group: 'Plates' },
    plateGap: { type: 'number', default: 25, min: 10, max: 60, step: 0.5, unit: 'mm', label: 'Gap between plates (standoff length)', group: 'Plates', help: 'Room for the FC stack and wires. Buy standoffs of this length.' },
    standoffBolt: { type: 'select', default: 'M3', label: 'Standoff size', group: 'Plates', options: [{ value: 'M2', label: 'M2' }, { value: 'M2.5', label: 'M2.5' }, { value: 'M3', label: 'M3' }] },
    standoffs: { type: 'select', default: 'bought', label: 'Standoffs', group: 'Plates', options: [{ value: 'bought', label: 'Bought (nylon or aluminium): holes only' }, { value: 'printed', label: 'Printed (4 extra parts)' }] },
    standoffRadius: { type: 'number', default: 0, min: 0, max: 80, step: 0.5, unit: 'mm', label: 'Standoff distance from center (0 = auto)', group: 'Plates' },
    strapSlots: { type: 'boolean', default: true, label: 'Battery strap slots in the top plate', group: 'Plates' },
    strapWidth: { type: 'number', default: 21, min: 8, max: 30, step: 0.5, unit: 'mm', label: 'Strap slot length', group: 'Plates', help: '21 for 20 mm battery straps.' },
    armWidth: { type: 'number', default: 14, min: 8, max: 30, step: 0.5, unit: 'mm', label: 'Arm width', group: 'Arms' },
    armThickness: { type: 'number', default: 6, min: 3, max: 12, step: 0.1, unit: 'mm', label: 'Arm thickness', group: 'Arms' },
    rootLength: { type: 'number', default: 30, min: 16, max: 60, step: 0.5, unit: 'mm', label: 'Arm root length on the plate', group: 'Arms' },
    joint: { type: 'select', default: 'bolt', label: 'Arm joint', group: 'Arms', options: [{ value: 'bolt', label: '2 screws + nuts' }, { value: 'insert', label: '2 screws into heat-set inserts' }, { value: 'dovetail', label: 'Dovetail socket + 1 screw (quick swap)' }] },
    armBolt: boltParam('Arms', 'M3', 'Arm screws'),
    insertHole: { type: 'number', default: 4, min: 2, max: 7, step: 0.05, unit: 'mm', label: 'Insert hole diameter', group: 'Arms', help: 'Depends on the insert brand: print the fit-test coupon and use the hole that seats yours.' },
    insertDepth: { type: 'number', default: 4.5, min: 2, max: 10, step: 0.1, unit: 'mm', label: 'Insert hole depth', group: 'Arms' },
    jointClearance: { type: 'number', default: 0.2, min: 0, max: 0.8, step: 0.05, unit: 'mm', label: 'Dovetail clearance (per side)', group: 'Arms' },
    cableGroove: { type: 'number', default: 4, min: 0, max: 10, step: 0.5, unit: 'mm', label: 'Cable groove width (0 = none)', group: 'Cables', help: 'Groove on top of each arm for the motor wires.' },
    zipSlots: { type: 'integer', default: 2, min: 0, max: 4, label: 'Zip-tie slot pairs per arm', group: 'Cables' },
    wireSlots: { type: 'boolean', default: true, label: 'Wire slots in the bottom plate (front and back of the stack)', group: 'Cables' },
    smaTab: { type: 'boolean', default: true, label: 'SMA antenna tab at the back of the top plate', group: 'Cables' },
    smaHole: { type: 'number', default: 6.5, min: 4, max: 10, step: 0.05, unit: 'mm', label: 'SMA hole', group: 'Cables', help: 'SMA bulkhead thread is 1/4 in (6.35 mm). Measure yours.' },
    motorPad: { type: 'number', default: 28, min: 12, max: 50, step: 0.5, unit: 'mm', label: 'Motor pad diameter', group: 'Motors' },
    motorPatternA: { type: 'number', default: 16, min: 4, max: 40, step: 0.1, unit: 'mm', label: 'Motor hole spacing A', group: 'Motors', help: '16 x 19 for most 22xx-23xx motors, 12 x 12 for 13xx-14xx, 9 x 9 for 08xx-11xx. Check your motor.' },
    motorPatternB: { type: 'number', default: 19, min: 4, max: 40, step: 0.1, unit: 'mm', label: 'Motor hole spacing B', group: 'Motors' },
    patternRotate: { type: 'number', default: 45, min: 0, max: 90, step: 1, unit: 'deg', label: 'Pattern rotation vs. arm', group: 'Motors' },
    motorBolt: boltParam('Motors', 'M3', 'Motor screws'),
    motorCenterHole: { type: 'number', default: 7, min: 0, max: 20, step: 0.5, unit: 'mm', label: 'Motor center hole', group: 'Motors' },
  },
  generate(p, k) {
    const warnings = [];
    const notes = [];
    const Tb = p.bottomThickness, Tt = p.topThickness, Ta = p.armThickness;
    const R = p.wheelbase / 2;
    const w = p.armWidth;
    const ab = bolt(p.armBolt), mb = bolt(p.motorBolt), sb = bolt(p.standoffBolt);
    const st = STACK[p.stack];
    const stackHalf = st ? (st.s / 2) * Math.SQRT2 + 4 : 12;
    const r0 = Math.max(stackHalf + 2, w / 2 / Math.sin(Math.PI / 4) + 2); // arm root start: clear of the stack and of the next arm
    const r1 = r0 + p.rootLength;
    if (R - p.motorPad / 2 < r1 + 5) warnings.push(`Wheelbase ${p.wheelbase} mm is too small for a ${p.rootLength} mm arm root: the motor pad reaches the plate. Use at least ${Math.ceil(2 * (r1 + 5 + p.motorPad / 2))} mm.`);
    // arm angles: front-right, back-right, back-left, front-left (nose = +Y)
    const fa = 90 - p.armAngle;
    const angles = [fa, -fa, 180 + fa, 180 - fa];
    const rad = (d) => (d * Math.PI) / 180;
    const at = (a, r, side = 0) => [r * Math.cos(rad(a)) - side * Math.sin(rad(a)), r * Math.sin(rad(a)) + side * Math.cos(rad(a))];

    // ---- plate outline: hull of the arm roots (plus margin) and the stack
    const margin = 4;
    const outline = (z0, z1, extra = 0) => {
      const posts = [];
      for (const a of angles) for (const r of [r0 - 2, r1]) for (const s of [-1, 1]) { const [x, y] = at(a, r, s * (w / 2 + margin - 3)); posts.push(k.cylZ(3 + extra, x, y, z0, z1, 24)); }
      posts.push(k.cylZ(stackHalf + 2, 0, 0, z0, z1, 48));
      return k.hull(posts);
    };

    // ---- standoffs: between the arms (at the arm angles + 90 deg halfway)
    const between = [90, 270, 0, 180];
    const extentAt = (a) => { // how far the plate reaches in direction a (sampled)
      let best = 0;
      for (const b of angles) for (const r of [r0 - 2, r1]) for (const s of [-1, 1]) { const [x, y] = at(b, r, s * (w / 2 + margin - 3)); const along = x * Math.cos(rad(a)) + y * Math.sin(rad(a)); best = Math.max(best, along + 3); }
      return best;
    };
    const minR = Math.max(stackHalf + sb.head / 2 + 1, (w / 2 + sb.head / 2 + 2) / Math.sin(rad(Math.min(p.armAngle, 90 - p.armAngle))));
    const autoR = Math.min(minR + 4, Math.min(...between.map(extentAt)) - sb.head / 2 - 2);
    const sR = p.standoffRadius > 0 ? p.standoffRadius : autoR;
    const sPts = between.map((a) => at(a, sR));
    if (sR < minR - 0.5) warnings.push(`Standoffs at ${sR.toFixed(1)} mm from the center hit the stack or an arm: use ${minR.toFixed(1)} mm or more.`);
    if (sR > Math.min(...between.map(extentAt)) - sb.head / 2 - 1) warnings.push('Standoffs sit at the plate edge: make the arm roots longer or set a smaller standoff distance.');

    // ---- bottom plate
    const bottomCuts = [];
    if (st) for (const [x, y] of squarePattern(st.s)) bottomCuts.push(k.cylZ((p.stackHole === 'tap' ? bolt(st.b).tap : bolt(st.b).clear) / 2, x, y, -1, Tb + 1, 24));
    for (const [x, y] of sPts) bottomCuts.push(k.cylZ(sb.clear / 2, x, y, -1, Tb + 1, 24));
    if (p.wireSlots && st) for (const y of [-(stackHalf + 1), stackHalf + 1]) bottomCuts.push(k.translate(k.roundedBlock(Math.min(22, st.s), 4, 1.9, -1, Tb + 1, 6), [0, y, 0]));
    const bottomAdd = [outline(0, Tb)];
    const armHoles = [r0 + p.rootLength * 0.3, r0 + p.rootLength * 0.75];
    for (const a of angles) {
      if (p.joint === 'dovetail') {
        // socket block on top of the plate around the root, open at the outer end
        const wall = 3;
        const wIn = w + 4, c = p.jointClearance;
        const block = k.prismZ([[r0 - 2 - wall, -(wIn / 2 + wall)], [r1, -(w / 2 + wall + 1)], [r1, w / 2 + wall + 1], [r0 - 2 - wall, wIn / 2 + wall]], Tb - 0.01, Tb + Ta);
        const pocket = k.prismZ([[r0 - 2 - c, -(wIn / 2 + c)], [r1 + 1, -(w / 2 + c)], [r1 + 1, w / 2 + c], [r0 - 2 - c, wIn / 2 + c]], Tb, Tb + Ta + 1);
        bottomAdd.push(k.rotate(k.difference(block, [pocket]), [0, 0, a]));
        const [x, y] = at(a, r0 + p.rootLength / 2);
        bottomCuts.push(k.cylZ(ab.tap / 2, x, y, -1, Tb + 0.01, 24));
      } else {
        for (const r of armHoles) {
          const [x, y] = at(a, r);
          bottomCuts.push(k.cylZ(ab.clear / 2, x, y, -1, Tb + 1, 24));
          if (p.joint === 'bolt') bottomCuts.push(k.hexZ(ab.nutAF + 0.3, x, y, -1, ab.nutH + 0.3, a));
          else bottomCuts.push(k.cylZ(ab.head / 2 + 0.3, x, y, -1, Math.min(ab.headH, Tb - 1.2), 24)); // screw head recess
        }
      }
    }
    if (p.joint === 'bolt' && Tb < ab.nutH + 1.2) warnings.push(`Bottom plate ${Tb} mm is thin for ${p.armBolt} nut pockets (${ab.nutH} mm nuts): use ${(ab.nutH + 1.2).toFixed(1)} mm or more.`);
    const bottom = k.difference(k.union(bottomAdd), bottomCuts);

    // ---- arm (built at angles[0], in place on the plate)
    const buildArm = () => {
      const add = [];
      const zA = Tb, zB = Tb + Ta;
      if (p.joint === 'dovetail') {
        const wIn = w + 4;
        add.push(k.prismZ([[r0 - 2, -wIn / 2], [r1, -w / 2], [r1, w / 2], [r0 - 2, wIn / 2]], zA, zB));
        add.push(k.cuboid([R - r1 + 1, w, Ta], [(R + r1 - 1) / 2, 0, (zA + zB) / 2])); // overlaps the dovetail by 1 mm
      } else add.push(k.cuboid([R - r0, w, Ta], [(R + r0) / 2, 0, (zA + zB) / 2]));
      add.push(k.cylZ(p.motorPad / 2, R, 0, zA, zB, 64));
      const cuts = [];
      for (const [x, y] of rotate2d(crossPattern(p.motorPatternA, p.motorPatternB), p.patternRotate)) cuts.push(k.cylZ(mb.clear / 2, R + x, y, zA - 1, zB + 1, 24));
      if (p.motorCenterHole > 0) cuts.push(k.cylZ(p.motorCenterHole / 2, R, 0, zA - 1, zB + 1, 40));
      if (p.joint === 'dovetail') cuts.push(k.cylZ(ab.clear / 2, r0 + p.rootLength / 2, 0, zA - 1, zB + 1, 24), k.cylZ(ab.head / 2 + 0.3, r0 + p.rootLength / 2, 0, zB - Math.min(ab.headH, Ta - 2), zB + 1, 24));
      else for (const r of armHoles) {
        if (p.joint === 'bolt') cuts.push(k.cylZ(ab.clear / 2, r, 0, zA - 1, zB + 1, 24));
        else cuts.push(k.cylZ(p.insertHole / 2, r, 0, zA - 1, zA + Math.min(p.insertDepth, Ta - 0.8), 24));
      }
      // cable groove from the motor pad to the root, zip-tie slot pairs beside it
      const gw = p.cableGroove;
      if (gw > 0) {
        const gd = Math.min(2, Ta / 3);
        if (gw > w - 4) warnings.push(`The cable groove (${gw} mm) leaves less than 2 mm of arm each side.`);
        cuts.push(k.translate(k.roundedBlock(R - p.motorCenterHole / 2 - (r0 - 2), gw, gw / 2 - 0.01, zB - gd, zB + 1, 8), [(R - p.motorCenterHole / 2 + r0 - 2) / 2, 0, 0]));
      }
      const free0 = r1 + 4, free1 = R - p.motorPad / 2 - 4;
      if (p.zipSlots > 0 && free1 - free0 > 8) {
        const off = Math.max(gw / 2 + 1.5, 2.5);
        for (let i = 0; i < p.zipSlots; i++) {
          const x = free0 + ((i + 0.5) * (free1 - free0)) / p.zipSlots;
          for (const s of [-1, 1]) cuts.push(k.cuboid([4.8, 1.8, Ta + 2], [x, s * (off + 0.9), (zA + zB) / 2]));
        }
        if (w / 2 - off - 1.8 < 1.2) warnings.push('Zip-tie slots leave a thin edge: make the arm wider or the groove narrower.');
      }
      return k.rotate(k.difference(k.union(add), cuts), [0, 0, angles[0]]);
    };
    const arm = buildArm();

    // ---- top plate
    const zt = Tb + p.plateGap;
    const topAdd = [outline(zt, zt + Tt)];
    const topCuts = [];
    for (const [x, y] of sPts) topCuts.push(k.cylZ(sb.clear / 2, x, y, zt - 1, zt + Tt + 1, 24));
    if (st) topCuts.push(k.roundedBlock(st.s - 6, st.s - 6, 4, zt - 1, zt + Tt + 1, 8)); // access to the stack
    if (p.strapSlots) for (const x of [-(stackHalf + 3), stackHalf + 3]) topCuts.push(k.translate(k.roundedBlock(3.2, p.strapWidth, 1.5, zt - 1, zt + Tt + 1, 6), [x, 0, 0]));
    if (p.smaTab) {
      const back = extentAt(270);
      topAdd.push(k.hull([k.cylZ(p.smaHole / 2 + 4, 0, -back - p.smaHole / 2 - 1, zt, zt + Tt, 40), k.cuboid([p.smaHole + 8, 2, Tt], [0, -back + 4, zt + Tt / 2])]));
      topCuts.push(k.cylZ(p.smaHole / 2, 0, -back - p.smaHole / 2 - 1, zt - 1, zt + Tt + 1, 40));
      notes.push(`SMA tab at the back: ${p.smaHole} mm hole for a bulkhead SMA / RP-SMA pigtail (VTX or receiver). u.FL antennas: route the pigtail through a wire slot and zip-tie the antenna tube to a standoff.`);
    }
    const top = k.difference(k.union(topAdd), topCuts);

    // ---- parts in print pose
    const bp = k.pose(bottom, [0, 0, 0]);
    const tp = k.pose(top, [0, 0, 0]);
    const ap = k.pose(arm, [0, 0, -angles[0]]);
    const armCopies = angles.slice(1).map((a) => rotZTimes(a - angles[0], ap.assembled));
    const parts = [
      { name: 'bottom-plate', manifold: bp.manifold, assembled: bp.assembled },
      { name: 'top-plate', manifold: tp.manifold, assembled: tp.assembled },
      { name: 'arm', manifold: ap.manifold, assembled: ap.assembled, qty: 4, copies: armCopies },
    ];
    if (p.standoffs === 'printed') {
      const af = sb.nutAF + 1.5;
      const so = k.difference(k.prismZ(regularPolygon(af / Math.sqrt(3), 6, 0).map(([u, v]) => [sPts[0][0] + u, sPts[0][1] + v]), Tb, zt), [k.cylZ(sb.tap / 2, sPts[0][0], sPts[0][1], Tb - 1, zt + 1, 24)]);
      const sp = k.pose(so, [0, 0, 0]);
      parts.push({ name: 'standoff', manifold: sp.manifold, assembled: sp.assembled, qty: 4, copies: [1, 2, 3].map((i) => { const m = sp.assembled.slice(); m[12] += sPts[i][0] - sPts[0][0]; m[13] += sPts[i][1] - sPts[0][1]; return m; }) });
      notes.push(`Printed standoffs: ${p.standoffBolt} tap holes both ends, ${p.plateGap} mm long. Bought nylon or aluminium standoffs are stronger.`);
    } else notes.push(`Standoffs: 4 x ${p.standoffBolt} female-female, ${p.plateGap} mm long, plus 8 x ${p.standoffBolt} screws (about ${Math.ceil(Math.max(Tb, Tt) + 4)} mm).`);

    // ---- checks and build notes
    const fl = [Math.cos(rad(angles[0])) * R, Math.sin(rad(angles[0])) * R], fr = [Math.cos(rad(angles[3])) * R, Math.sin(rad(angles[3])) * R], bk = [Math.cos(rad(angles[1])) * R, Math.sin(rad(angles[1])) * R];
    const nearest = Math.min(Math.hypot(fl[0] - fr[0], fl[1] - fr[1]), Math.hypot(fl[0] - bk[0], fl[1] - bk[1]));
    const gap = nearest - p.propInches * INCH;
    if (gap < 5) warnings.push(`Props overlap or nearly touch: ${gap.toFixed(1)} mm between ${p.propInches} in props. Raise the wheelbase or use smaller props.`);
    else notes.push(`Prop tip gap ${gap.toFixed(1)} mm with ${p.propInches} in props.`);
    const armLen = R + p.motorPad / 2 - (r0 - 2);
    notes.push(`Arm ${armLen.toFixed(0)} mm long (x4, print flat, groove up). Plates ${(2 * Math.max(...between.map(extentAt))).toFixed(0)} mm across. PETG, ASA, PA-CF or PC for arms; PLA is for test fits only.`);
    const screwLen = (t) => Math.ceil(t);
    if (p.joint === 'bolt') notes.push(`Arm joint: 8 x ${p.armBolt} screws at least ${screwLen(Tb + Ta + 1)} mm long and 8 nuts (in the pockets under the bottom plate).`);
    if (p.joint === 'insert') notes.push(`Arm joint: 8 heat-set inserts (${p.insertHole} mm holes, ${p.insertDepth} mm deep: press them in from the arm's bed side) and 8 x ${p.armBolt} screws about ${screwLen(Tb - Math.min(ab.headH, Tb - 1.2) + p.insertDepth)} mm long, from under the bottom plate. Check the hole with the fit-test coupon first.`);
    if (p.joint === 'dovetail') notes.push(`Arm joint: drop each arm into its dovetail socket from above; 1 x ${p.armBolt} screw per arm (${screwLen(Ta - Math.min(ab.headH, Ta - 2) + Tb - 0.5)} mm or a little shorter) threads into the plate. Socket clearance ${p.jointClearance} mm per side: test one socket first.`);
    if (st) notes.push(`FC stack ${st.s} x ${st.s} (${st.b}). Motor wires run in the arm groove under zip ties into the space between the plates.`);
    return { parts, warnings: [...new Set(warnings)], notes };
  },
};
