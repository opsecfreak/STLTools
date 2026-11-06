// Mounts and cases for modules: Raspberry Pi 5 / 4 / 3 cases, sensor brackets
// (TF-Luna, TFmini, XIAO-size boards), puck lidar plates, drone repair stands,
// aluminium extrusion brackets (2020 / 3030 / 4040) and motor clamps.
//
// Board and sensor sizes in presets come from the makers' published drawings
// and datasheets. They are marked "verify" in the presets: measure your part
// before a long print. Port openings on the Pi cases are wide windows, not
// exact holes, so small differences between board revisions still fit.

import { bolt, boltParam, squarePattern, circlePattern } from '../core/hardware.js';

const STRAP_T = 2.6; // zip-tie slot height

// ---------------------------------------------------------------- shared base

const baseParams = (group = 'Base', def = 'plate') => ({
  base: {
    type: 'select', default: def, group, label: 'Base',
    options: [
      { value: 'plate', label: 'Screw plate (2 ears)' },
      { value: 'saddle', label: 'Zip-tie saddle onto a tube' },
      { value: 'tape', label: 'Flat (tape / glue)' },
    ],
  },
  baseThickness: { type: 'number', default: 3, min: 1.2, max: 12, step: 0.1, unit: 'mm', label: 'Base thickness', group },
  tubeOD: { type: 'number', default: 16, min: 3, max: 80, step: 0.05, unit: 'mm', label: 'Tube OD (saddle)', group, help: 'The tube runs along the length (X).' },
  bolt: boltParam(group, 'M3', 'Base screws'),
});

/**
 * Base slab under a footprint fl (X) x fw (Y), top at z = T. Returns { slab, cuts, T, fl, fw, notes, warnings }.
 * Plate: countersunk ears at both X ends. Saddle: groove along X plus two zip-tie tunnels across Y.
 */
function buildBase(k, p, fl, fw) {
  const notes = [];
  const warnings = [];
  const b = bolt(p.bolt);
  let T = p.baseThickness;
  const cuts = [];
  if (p.base === 'plate') {
    const ear = b.head + 4;
    fl += 2 * ear;
    T = Math.max(T, 2.4);
    for (const x of [-(fl / 2 - ear / 2), fl / 2 - ear / 2]) {
      cuts.push(k.cylZ(b.clear / 2, x, 0, -1, T + 1, 24));
      cuts.push(k.coneZ(b.clear / 2, b.head / 2 + 1, x, 0, T - (b.head - b.clear) / 2, T + 0.5, 32));
    }
    notes.push(`Screw plate: 2 countersunk ${p.bolt} holes, ${(fl - ear).toFixed(1)} mm apart.`);
  } else if (p.base === 'saddle') {
    const r = p.tubeOD / 2;
    const gd = Math.min(r * 0.35, 4);
    T = Math.max(T, gd + STRAP_T + 2.2);
    fw = Math.max(fw, 2 * r + 6);
    fl = Math.max(fl, 22);
    cuts.push(k.track(k.track(k.Manifold.cylinder(fl + 2, r + 0.2, r + 0.2, 96, true)).rotate([0, 90, 0]).translate([0, 0, gd - r - 0.2])));
    for (const x of [-(fl / 2 - 5), fl / 2 - 5]) cuts.push(k.cuboid([5.5, fw + 2, STRAP_T], [x, 0, gd + 1 + STRAP_T / 2]));
    notes.push(`Saddle for a ${p.tubeOD} mm tube (${gd.toFixed(1)} mm groove). Two zip ties go through the tunnels and around the tube.`);
  } else {
    notes.push('Flat base: use double-sided mounting tape or glue.');
  }
  const slab = k.roundedBlock(fl, fw, 2, 0, T, 6);
  return { slab, cuts, T, fl, fw, notes, warnings };
}

// ---------------------------------------------------------------- Raspberry Pi case

// Board frame: lower-left corner at (0, 0), the long port edge (USB-C / HDMI) at y = 0,
// USB + Ethernet on the right short edge (x = width), microSD under the left edge.
// Values from the Raspberry Pi mechanical drawings (85 x 56 mm, holes 58 x 49 mm, 3.5 mm in).
const SBC = {
  pi5: { w: 85, d: 56, holes: [3.5, 3.5, 58, 49], name: 'Raspberry Pi 5' },
  pi4: { w: 85, d: 56, holes: [3.5, 3.5, 58, 49], name: 'Raspberry Pi 4 B' },
  pi3: { w: 85, d: 56, holes: [3.5, 3.5, 58, 49], name: 'Raspberry Pi 3 B / B+' },
};

export const sbcCase = {
  id: 'sbc-case',
  name: 'Raspberry Pi Case',
  sections: ['robotics', 'quads', 'shop'],
  description: 'Two-part case (base + press-fit lid) for Raspberry Pi 5, 4 or 3, or any board you measure: wide port windows, microSD slot, GPIO slot, vents or a 30 / 40 mm fan, optional screw ears.',
  params: {
    board: {
      type: 'select', default: 'pi5', group: 'Board', label: 'Board',
      options: [
        { value: 'pi5', label: 'Raspberry Pi 5' },
        { value: 'pi4', label: 'Raspberry Pi 4 B' },
        { value: 'pi3', label: 'Raspberry Pi 3 B / B+' },
        { value: 'custom', label: 'Custom (set the sizes below)' },
      ],
    },
    boardWidth: { type: 'number', default: 85, min: 20, max: 250, step: 0.1, unit: 'mm', label: 'Custom board width (X)', group: 'Board' },
    boardDepth: { type: 'number', default: 56, min: 15, max: 250, step: 0.1, unit: 'mm', label: 'Custom board depth (Y)', group: 'Board' },
    holeInset: { type: 'number', default: 3.5, min: 1, max: 50, step: 0.1, unit: 'mm', label: 'Custom first hole from the corner', group: 'Board' },
    holeSpacingX: { type: 'number', default: 58, min: 0, max: 240, step: 0.1, unit: 'mm', label: 'Custom hole spacing X (0 = no holes)', group: 'Board' },
    holeSpacingY: { type: 'number', default: 49, min: 0, max: 240, step: 0.1, unit: 'mm', label: 'Custom hole spacing Y', group: 'Board' },
    boardGap: { type: 'number', default: 1, min: 0.3, max: 6, step: 0.1, unit: 'mm', label: 'Gap around the board', group: 'Case' },
    wall: { type: 'number', default: 2, min: 1.2, max: 5, step: 0.1, unit: 'mm', label: 'Wall', group: 'Case' },
    floor: { type: 'number', default: 2, min: 1, max: 5, step: 0.1, unit: 'mm', label: 'Floor', group: 'Case' },
    standoff: { type: 'number', default: 4, min: 2, max: 15, step: 0.5, unit: 'mm', label: 'Standoff height (under the board)', group: 'Case' },
    standoffHole: { type: 'number', default: 2.2, min: 1.2, max: 4, step: 0.05, unit: 'mm', label: 'Standoff screw hole', group: 'Case', help: '2.2 threads an M2.5 screw into the plastic.' },
    headroom: { type: 'number', default: 22, min: 5, max: 80, step: 0.5, unit: 'mm', label: 'Room above the board', group: 'Case', help: 'USB / Ethernet stack is about 16 mm. Add room for a cooler or HAT.' },
    cornerRadius: { type: 'number', default: 3, min: 0.5, max: 10, step: 0.5, unit: 'mm', label: 'Corner radius', group: 'Case' },
    ears: { type: 'boolean', default: false, label: 'Screw ears on the base (mount the case)', group: 'Case' },
    earBolt: boltParam('Case', 'M3', 'Ear screws'),
    frontWindow: { type: 'boolean', default: true, label: 'Window: USB-C / HDMI / audio edge', group: 'Openings' },
    frontFrom: { type: 'number', default: 3, min: 0, max: 240, step: 0.5, unit: 'mm', label: 'Front window from (board X)', group: 'Openings' },
    frontTo: { type: 'number', default: 60, min: 5, max: 250, step: 0.5, unit: 'mm', label: 'Front window to (board X)', group: 'Openings' },
    frontHeight: { type: 'number', default: 10, min: 3, max: 40, step: 0.5, unit: 'mm', label: 'Front window height', group: 'Openings', help: 'Starts 2 mm below the board top. Plugs are bigger than the sockets.' },
    sideWindow: { type: 'boolean', default: true, label: 'Window: USB + Ethernet edge', group: 'Openings' },
    sideHeight: { type: 'number', default: 17.5, min: 3, max: 50, step: 0.5, unit: 'mm', label: 'USB / Ethernet window height', group: 'Openings' },
    sdSlot: { type: 'boolean', default: true, label: 'microSD slot (left edge)', group: 'Openings' },
    leftSlot: { type: 'boolean', default: false, label: 'Slot above the board on the left edge (ribbon cables)', group: 'Openings' },
    lidThickness: { type: 'number', default: 2, min: 1.2, max: 5, step: 0.1, unit: 'mm', label: 'Lid thickness', group: 'Lid' },
    lidClearance: { type: 'number', default: 0.2, min: 0, max: 0.8, step: 0.05, unit: 'mm', label: 'Lid lip clearance (per side)', group: 'Lid', help: 'Raise if the lid is too tight.' },
    gpioSlot: { type: 'boolean', default: true, label: 'GPIO header slot', group: 'Lid' },
    cooling: {
      type: 'select', default: 'vents', group: 'Lid', label: 'Cooling',
      options: [
        { value: 'vents', label: 'Vent slots' },
        { value: 'fan30', label: '30 mm fan (24 mm screws)' },
        { value: 'fan40', label: '40 mm fan (32 mm screws)' },
        { value: 'none', label: 'None' },
      ],
    },
  },
  generate(p, k) {
    const warnings = [];
    const notes = [];
    const bd = SBC[p.board] ?? { w: p.boardWidth, d: p.boardDepth, holes: [p.holeInset, p.holeInset, p.holeSpacingX, p.holeSpacingY], name: 'custom board' };
    const t = p.wall;
    const cw = bd.w + 2 * p.boardGap;
    const cd = bd.d + 2 * p.boardGap;
    const W = cw + 2 * t;
    const D = cd + 2 * t;
    const F = p.floor;
    const zPcb = F + p.standoff;
    const zTop = zPcb + 1.6;
    const H = zTop + p.headroom;
    const lipDepth = 3;
    const r = Math.min(p.cornerRadius, Math.min(W, D) / 2 - 1);
    const bx = (x) => x - bd.w / 2; // board X -> case X
    const by = (y) => y - bd.d / 2;

    // ---- base ----
    const add = [k.difference(k.roundedBlock(W, D, r, 0, H, 8), [k.roundedBlock(cw, cd, Math.max(0.5, r - t), F, H + 1, 8)])];
    const cuts = [];
    const [ix, iy, sx, sy] = bd.holes;
    const holes = sx > 0 ? [[ix, iy], [ix + sx, iy], [ix, iy + sy], [ix + sx, iy + sy]] : [];
    for (const [x, y] of holes) {
      add.push(k.cylZ(2.9, bx(x), by(y), F - 0.01, zPcb, 32));
      cuts.push(k.cylZ(p.standoffHole / 2, bx(x), by(y), F + 0.6, zPcb + 1, 20));
    }
    const winTopLimit = H - lipDepth - 0.8;
    if (p.frontWindow) {
      const x0 = bx(Math.max(0, p.frontFrom));
      const x1 = bx(Math.min(bd.w, Math.max(p.frontTo, p.frontFrom + 3)));
      const z0 = zTop - 2;
      const z1 = Math.min(z0 + p.frontHeight, winTopLimit);
      cuts.push(k.cuboid([x1 - x0, t * 3, z1 - z0], [(x0 + x1) / 2, -D / 2 + t / 2, (z0 + z1) / 2]));
      if (z0 + p.frontHeight > winTopLimit) warnings.push('Front window is cut short by the lid lip. Add headroom.');
    }
    if (p.sideWindow) {
      const z0 = zTop - 0.8;
      const z1 = Math.min(z0 + p.sideHeight, winTopLimit);
      cuts.push(k.cuboid([t * 3, Math.max(5, bd.d - 4), z1 - z0], [W / 2 - t / 2, 0, (z0 + z1) / 2]));
      if (z0 + p.sideHeight > winTopLimit) warnings.push('USB / Ethernet window is cut short by the lid lip. Add headroom.');
    }
    if (p.sdSlot) {
      const z0 = F + 0.6;
      const z1 = zTop + 0.8;
      cuts.push(k.cuboid([t * 3, Math.min(16, bd.d - 6), z1 - z0], [-W / 2 + t / 2, by(bd.d / 2), (z0 + z1) / 2]));
    }
    if (p.leftSlot) {
      const z0 = zTop + 1;
      const z1 = Math.min(z0 + 6, winTopLimit);
      cuts.push(k.cuboid([t * 3, Math.min(24, bd.d - 10), z1 - z0], [-W / 2 + t / 2, by(bd.d / 2), (z0 + z1) / 2]));
    }
    if (p.ears) {
      const eb = bolt(p.earBolt);
      const ear = eb.head + 5;
      for (const s of [-1, 1]) {
        add.push(k.cuboid([ear + 2, Math.min(D * 0.5, 30), 3], [s * (W / 2 + ear / 2 - 1), 0, 1.5]));
        cuts.push(k.cylZ(eb.clear / 2, s * (W / 2 + ear / 2), 0, -1, 4, 24));
      }
      notes.push(`Ears: 2 x ${p.earBolt} holes ${(W + ear).toFixed(1)} mm apart.`);
    }
    const base = k.difference(k.union(add), cuts);

    // ---- lid (printed top face down, so board Y is mirrored) ----
    const LT = p.lidThickness;
    const lc = p.lidClearance;
    const lipW = 1.2;
    const lipOuter = k.roundedBlock(cw - 2 * lc, cd - 2 * lc, Math.max(0.5, r - t - lc), LT - 0.01, LT + lipDepth, 8);
    const lipInner = k.roundedBlock(cw - 2 * lc - 2 * lipW, cd - 2 * lc - 2 * lipW, Math.max(0.3, r - t - lc - lipW), LT - 0.5, LT + lipDepth + 1, 8);
    const lid = [k.roundedBlock(W, D, r, 0, LT, 8), k.difference(lipOuter, [lipInner])];
    const lidCuts = [];
    const ly = (y) => -by(y); // mirrored for the flipped lid
    if (p.gpioSlot && bd.d > 20) {
      lidCuts.push(k.roundedBlock(Math.min(54, bd.w - 6), 7, 1, -1, LT + lipDepth + 1, 4).translate([bx(Math.min(bd.w / 2, 32.5)), ly(bd.d - 3.5), 0]));
      k.track(lidCuts[lidCuts.length - 1]);
    }
    const fx = bx(holes.length ? ix + sx / 2 : bd.w / 2);
    const fy = ly(holes.length ? iy + sy / 2 : bd.d / 2);
    if (p.cooling === 'fan30' || p.cooling === 'fan40') {
      const big = p.cooling === 'fan40';
      const open = big ? 37 : 27.5;
      const sp = big ? 32 : 24;
      if (sp + 7 > Math.min(cw, cd)) warnings.push('Fan is larger than the case.');
      const ring = k.difference(k.cylZ(open / 2, fx, fy, -1, LT + 1, 64), [
        k.cuboid([open + 2, 1.6, LT + 4], [fx, fy, LT / 2]),
        k.cuboid([1.6, open + 2, LT + 4], [fx, fy, LT / 2]),
      ]);
      lidCuts.push(ring);
      for (const [x, y] of squarePattern(sp)) lidCuts.push(k.cylZ(1.6, fx + x, fy + y, -1, LT + 1, 20));
      notes.push(`${big ? 40 : 30} mm fan on the lid, screws ${sp} mm apart (3.2 mm holes). Fan blows into the case: label side down.`);
    } else if (p.cooling === 'vents') {
      const n = Math.max(3, Math.floor((cw * 0.6) / 4.5));
      const len = Math.min(cd * 0.45, 26);
      for (let i = 0; i < n; i++) lidCuts.push(k.roundedBlock(2.2, len, 1, -1, LT + 1, 4).translate([fx - ((n - 1) * 4.5) / 2 + i * 4.5, fy, 0]));
      for (const c of lidCuts.slice(-n)) k.track(c);
    }
    const lidPart = k.difference(k.union(lid), lidCuts);
    notes.push(`${bd.name}: inside ${cw.toFixed(1)} x ${cd.toFixed(1)} mm, board top ${zTop.toFixed(1)} mm above the bed, case height ${H.toFixed(1)} mm.`);
    notes.push('Port windows are wide openings that fit board revisions. Check your board against them before a long print.');
    if (p.board === 'pi5') notes.push('Pi 5 with the official Active Cooler: keep headroom 22 mm or more and use vents.');
    return {
      parts: [{ name: 'base', manifold: k.placeOnBed(base) }, { name: 'lid', manifold: k.placeOnBed(lidPart) }],
      warnings, notes,
    };
  },
};

// ---------------------------------------------------------------- sensor bracket

export const sensorBracket = {
  id: 'sensor-bracket',
  name: 'Sensor Bracket',
  sections: ['robotics', 'quads', 'accessories'],
  description: 'Snap-in cradle for a box-shaped sensor or small board (TF-Luna, TFmini, XIAO ESP32 boards, any module you measure). Open face, snap lips, cable notch, tilt wedge, screw plate, tube saddle or tape.',
  params: {
    bodyLength: { type: 'number', default: 35, min: 5, max: 150, step: 0.05, unit: 'mm', label: 'Body length (X)', group: 'Sensor', help: 'Measure the module. The open face (lenses, antenna) points away from the base.' },
    bodyWidth: { type: 'number', default: 21.25, min: 4, max: 120, step: 0.05, unit: 'mm', label: 'Body width (Y)', group: 'Sensor' },
    bodyDepth: { type: 'number', default: 13.5, min: 1, max: 80, step: 0.05, unit: 'mm', label: 'Body depth (into the cradle)', group: 'Sensor' },
    clearance: { type: 'number', default: 0.3, min: 0, max: 2, step: 0.05, unit: 'mm', label: 'Fit clearance (per side)', group: 'Sensor' },
    wall: { type: 'number', default: 1.8, min: 1, max: 6, step: 0.1, unit: 'mm', label: 'Wall', group: 'Cradle' },
    floor: { type: 'number', default: 1.6, min: 0.8, max: 6, step: 0.1, unit: 'mm', label: 'Cradle floor', group: 'Cradle' },
    wallShare: { type: 'number', default: 85, min: 30, max: 100, step: 5, unit: '%', label: 'Wall height (share of depth)', group: 'Cradle', help: 'Below 100% the face of the module stands above the walls.' },
    lip: { type: 'number', default: 0.5, min: 0, max: 1.5, step: 0.05, unit: 'mm', label: 'Snap lip (0 = none)', group: 'Cradle', help: 'Small 45 degree lips on the long walls hold the module.' },
    cableNotch: { type: 'select', default: 'one', group: 'Cradle', label: 'Cable notch in the end wall', options: [{ value: 'none', label: 'None' }, { value: 'one', label: 'One end (+X)' }, { value: 'both', label: 'Both ends' }] },
    notchWidth: { type: 'number', default: 10, min: 2, max: 60, step: 0.5, unit: 'mm', label: 'Cable notch width', group: 'Cradle', help: 'XIAO USB-C plug: about 13.' },
    floorWindow: { type: 'boolean', default: false, label: 'Window in the floor (back of the module)', group: 'Cradle' },
    tilt: { type: 'number', default: 0, min: 0, max: 60, step: 1, unit: 'deg', label: 'Tilt (wedge)', group: 'Cradle', help: '0 = face points straight away from the base.' },
    ...baseParams('Base', 'plate'),
  },
  generate(p, k) {
    const warnings = [];
    const notes = [];
    const c = p.clearance;
    const iw = p.bodyWidth + 2 * c;
    const il = p.bodyLength + 2 * c;
    const t = p.wall;
    const OW = iw + 2 * t;
    const OL = il + 2 * t;
    const wallH = Math.max(1, (p.bodyDepth * p.wallShare) / 100);
    const top = p.floor + wallH;
    // cradle in its own frame: floor bottom at z = 0
    let cradle = k.difference(k.roundedBlock(OL, OW, 1.2, 0, top, 6), [k.roundedBlock(il, iw, 0.6, p.floor, top + 1, 4)]);
    const add = [cradle];
    if (p.lip > 0) {
      const L = p.lip;
      for (const s of [-1, 1]) {
        const a = s * (iw / 2);
        const prof = [[a + s * 0.3, top - 2 * L - 0.4], [a - s * L, top - L - 0.4], [a - s * L, top], [a + s * 0.3, top]];
        add.push(k.prismX(prof.map(([y, z]) => [y, z]), -il / 2 + 1, il / 2 - 1));
      }
    }
    cradle = k.union(add);
    const cuts = [];
    const notchEnds = p.cableNotch === 'both' ? [-1, 1] : p.cableNotch === 'one' ? [1] : [];
    for (const s of notchEnds) cuts.push(k.cuboid([t * 3, Math.min(p.notchWidth, iw), top], [s * (OL / 2 - t / 2), 0, p.floor + 0.8 + top / 2]));
    if (p.floorWindow) cuts.push(k.roundedBlock(Math.max(2, il - 6), Math.max(2, iw - 6), 1, -1, p.floor + 1, 4));
    cradle = k.difference(cradle, cuts);

    // base under the cradle footprint (wedge footprint when tilted)
    const tiltRad = (p.tilt * Math.PI) / 180;
    const footW = p.tilt > 0 ? OW * Math.cos(tiltRad) + top * Math.sin(tiltRad) : OW;
    const base = buildBase(k, p, OL, footW + 0.01);
    notes.push(...base.notes);
    warnings.push(...base.warnings);
    const T = base.T;
    let body;
    if (p.tilt > 0) {
      // rotate about X around the front-bottom edge so the back rises; fill below with a wedge
      const front = -base.fw / 2 + (base.fw - footW) / 2;
      const placed = k.translate(k.rotate(k.translate(cradle, [0, OW / 2, 0]), [p.tilt, 0, 0]), [0, front + top * Math.sin(tiltRad), T - 0.01]);
      const floorSlab = k.translate(k.rotate(k.translate(k.cuboid([OL, OW, 0.4], [0, 0, 0.2]), [0, OW / 2, 0]), [p.tilt, 0, 0]), [0, front + top * Math.sin(tiltRad), T - 0.01]);
      const wedge = k.hull([floorSlab, k.cuboid([OL, base.fw - 0.02, 0.4], [0, 0, T - 0.2])]);
      body = k.union([base.slab, wedge, placed]);
      notes.push(`Tilted ${p.tilt} degrees: the open face leans toward -Y.`);
    } else {
      body = k.union([base.slab, k.translate(cradle, [0, 0, T - 0.01])]);
    }
    body = k.difference(body, base.cuts);
    notes.push(`Pocket ${il.toFixed(2)} x ${iw.toFixed(2)} mm, walls ${wallH.toFixed(1)} mm high${p.lip > 0 ? `, ${p.lip} mm snap lips` : ''}.`);
    if (p.lip > 0 && t > 2.4) warnings.push('Thick walls do not flex: the snap lips may be too stiff. Use wall 2.4 or less, or lip 0.');
    return { parts: [{ name: 'bracket', manifold: k.placeOnBed(body) }], warnings, notes };
  },
};

// ---------------------------------------------------------------- puck lidar plate

export const lidarMount = {
  id: 'lidar-mount',
  name: 'Lidar Plate',
  sections: ['robotics', 'quads'],
  description: 'Plate for a spinning puck lidar or any round sensor: hole pattern (rectangle or circle), standoffs to lift it above the frame, center cable hole, mounted by screws, tube saddle or tape. Set the pattern from your lidar.',
  params: {
    shape: { type: 'select', default: 'round', group: 'Plate', label: 'Plate shape', options: [{ value: 'round', label: 'Round' }, { value: 'rect', label: 'Rectangle' }] },
    plateDiameter: { type: 'number', default: 80, min: 20, max: 250, step: 0.5, unit: 'mm', label: 'Plate diameter (round)', group: 'Plate' },
    plateLength: { type: 'number', default: 90, min: 20, max: 250, step: 0.5, unit: 'mm', label: 'Plate length X (rectangle)', group: 'Plate' },
    plateWidth: { type: 'number', default: 70, min: 20, max: 250, step: 0.5, unit: 'mm', label: 'Plate width Y (rectangle)', group: 'Plate' },
    thickness: { type: 'number', default: 3, min: 1.6, max: 10, step: 0.1, unit: 'mm', label: 'Plate thickness', group: 'Plate' },
    pattern: { type: 'select', default: 'rect', group: 'Lidar holes', label: 'Lidar hole pattern', options: [{ value: 'rect', label: 'Rectangle (X x Y)' }, { value: 'circle', label: 'Circle (N holes)' }, { value: 'line', label: 'Two holes (X spacing)' }] },
    holeSpacingX: { type: 'number', default: 50, min: 4, max: 240, step: 0.05, unit: 'mm', label: 'Hole spacing X', group: 'Lidar holes', help: 'Measure center to center on your lidar.' },
    holeSpacingY: { type: 'number', default: 50, min: 4, max: 240, step: 0.05, unit: 'mm', label: 'Hole spacing Y', group: 'Lidar holes' },
    holeCircle: { type: 'number', default: 60, min: 4, max: 240, step: 0.05, unit: 'mm', label: 'Hole circle diameter', group: 'Lidar holes' },
    holeCount: { type: 'integer', default: 4, min: 2, max: 8, label: 'Holes on the circle', group: 'Lidar holes' },
    lidarHole: { type: 'number', default: 2.2, min: 1, max: 6, step: 0.05, unit: 'mm', label: 'Lidar screw hole', group: 'Lidar holes', help: '2.2 threads M2.5, 2.6 threads M3, or use clearance and a nut.' },
    standoff: { type: 'number', default: 8, min: 0, max: 60, step: 0.5, unit: 'mm', label: 'Standoff height (0 = flat)', group: 'Lidar holes' },
    standoffDiameter: { type: 'number', default: 6, min: 3, max: 15, step: 0.1, unit: 'mm', label: 'Standoff diameter', group: 'Lidar holes' },
    cableHole: { type: 'number', default: 14, min: 0, max: 80, step: 0.5, unit: 'mm', label: 'Center cable hole (0 = none)', group: 'Plate' },
    lighten: { type: 'boolean', default: true, label: 'Lightening holes', group: 'Plate' },
    mount: { type: 'select', default: 'stack', group: 'Mount', label: 'Mount to the vehicle', options: [{ value: 'stack', label: 'Square screw pattern (FC stack / frame)' }, { value: 'saddle', label: 'Zip-tie saddle onto a tube' }, { value: 'tape', label: 'Flat (tape)' }] },
    mountSpacing: { type: 'number', default: 30.5, min: 10, max: 200, step: 0.05, unit: 'mm', label: 'Mount screw spacing (square)', group: 'Mount', help: '30.5 or 20 for FC stacks, or your frame pattern.' },
    mountBolt: boltParam('Mount', 'M3', 'Mount screws'),
    tubeOD: { type: 'number', default: 16, min: 3, max: 80, step: 0.05, unit: 'mm', label: 'Tube OD (saddle)', group: 'Mount' },
  },
  generate(p, k) {
    const warnings = [];
    const notes = [];
    const T = p.thickness;
    const round = p.shape === 'round';
    const R = p.plateDiameter / 2;
    const halfX = round ? R : p.plateLength / 2;
    const halfY = round ? R : p.plateWidth / 2;
    const plate = round ? k.cylZ(R, 0, 0, 0, T, 96) : k.roundedBlock(p.plateLength, p.plateWidth, 5, 0, T, 8);
    const add = [plate];
    const cuts = [];
    const holes = p.pattern === 'circle' ? circlePattern(p.holeCircle, p.holeCount, 45) : p.pattern === 'line' ? [[-p.holeSpacingX / 2, 0], [p.holeSpacingX / 2, 0]] : squarePattern(p.holeSpacingX, p.holeSpacingY);
    const sr = p.standoffDiameter / 2;
    for (const [x, y] of holes) {
      const inside = round ? Math.hypot(x, y) + sr <= R + 0.01 : Math.abs(x) + sr <= halfX && Math.abs(y) + sr <= halfY;
      if (!inside) warnings.push('A lidar hole is outside the plate. Make the plate bigger.');
      if (p.standoff > 0) add.push(k.cylZ(sr, x, y, T - 0.01, T + p.standoff, 32));
      cuts.push(k.cylZ(p.lidarHole / 2, x, y, p.standoff > 0 ? 0.8 : -1, T + p.standoff + 1, 20));
    }
    if (p.cableHole > 0) cuts.push(k.cylZ(p.cableHole / 2, 0, 0, -1, T + 1, 48));
    const mb = bolt(p.mountBolt);
    let mountPts = [];
    let gd = 0;
    if (p.mount === 'stack') {
      mountPts = squarePattern(p.mountSpacing).map(([x, y]) => [x, y]);
      if (p.cableHole / 2 + mb.head / 2 > (p.mountSpacing / 2) * Math.SQRT2) warnings.push('Mount screws hit the cable hole. Make the cable hole smaller.');
      for (const [x, y] of mountPts) {
        cuts.push(k.cylZ(mb.clear / 2, x, y, -1, T + p.standoff + 1, 24));
        if (holes.some(([hx, hy]) => Math.hypot(hx - x, hy - y) < sr + mb.head / 2)) warnings.push('A mount screw is too close to a lidar standoff.');
      }
      notes.push(`Mount: 4 x ${p.mountBolt} on a ${p.mountSpacing} mm square.`);
    } else if (p.mount === 'saddle') {
      const r = p.tubeOD / 2;
      gd = Math.min(r * 0.35, 3);
      const bar = k.cuboid([2 * halfX * (round ? 0.8 : 1) - 2, 2 * r + 8, gd + STRAP_T + 2.2], [0, 0, -(gd + STRAP_T + 2.2) / 2 + 0.01]);
      add.push(bar);
      const zb = -(gd + STRAP_T + 2.2);
      cuts.push(k.track(k.track(k.Manifold.cylinder(4 * halfX, r + 0.2, r + 0.2, 96, true)).rotate([0, 90, 0]).translate([0, 0, zb + gd - r - 0.2])));
      for (const x of [-halfX * 0.5, halfX * 0.5]) cuts.push(k.cuboid([5.5, 2 * r + 12, STRAP_T], [x, 0, zb + gd + 1 + STRAP_T / 2]));
      notes.push(`Saddle along X for a ${p.tubeOD} mm tube with 2 zip-tie tunnels.`);
    } else {
      notes.push('Flat base: use mounting tape.');
    }
    if (p.lighten) {
      const keep = [...holes.map(([x, y]) => [x, y, sr + 2.5]), ...mountPts.map(([x, y]) => [x, y, mb.head / 2 + 2.5])];
      const ringR = Math.min(halfX, halfY) * 0.62;
      const hr = Math.min(halfX, halfY) * 0.16;
      for (let i = 0; i < 8; i++) {
        const a = ((22.5 + i * 45) * Math.PI) / 180;
        const x = ringR * Math.cos(a);
        const y = ringR * Math.sin(a);
        if (hr < 3) break;
        if (Math.hypot(x, y) - hr < p.cableHole / 2 + 3) continue;
        if (keep.some(([kx, ky, kr]) => Math.hypot(kx - x, ky - y) < kr + hr)) continue;
        if (p.mount === 'saddle' && Math.abs(y) - hr < p.tubeOD / 2 + 4) continue;
        cuts.push(k.cylZ(hr, x, y, -1, T + 1, 32));
      }
    }
    const part = k.difference(k.union(add), cuts);
    notes.push(`${holes.length} lidar holes (${p.pattern === 'circle' ? `${p.holeCount} on ${p.holeCircle} mm circle` : p.pattern === 'line' ? `${p.holeSpacingX} mm apart` : `${p.holeSpacingX} x ${p.holeSpacingY} mm`}), standoffs ${p.standoff} mm. Set the pattern from your lidar's drawing.`);
    return { parts: [{ name: 'lidar-plate', manifold: k.placeOnBed(part) }], warnings: [...new Set(warnings)], notes };
  },
};

// ---------------------------------------------------------------- repair stand

export const repairStand = {
  id: 'repair-stand',
  name: 'Repair Stand Cradle',
  sections: ['shop', 'quads'],
  description: 'Bench cradle that holds a drone body, gimbal, battery or tube while you work on it. U or V notch, rod holes to join two cradles. Print 2 or more. Measure your body width first.',
  params: {
    notchWidth: { type: 'number', default: 80, min: 10, max: 300, step: 0.5, unit: 'mm', label: 'Notch width (body width + room)', group: 'Cradle', help: 'Measure the part where it rests, add 2-4 mm or felt thickness.' },
    notchDepth: { type: 'number', default: 45, min: 5, max: 200, step: 0.5, unit: 'mm', label: 'Notch depth', group: 'Cradle' },
    shape: { type: 'select', default: 'u', group: 'Cradle', label: 'Notch shape', options: [{ value: 'u', label: 'U (round bottom)' }, { value: 'v', label: 'V (edges, tubes)' }, { value: 'flat', label: 'Flat bottom' }] },
    sideWidth: { type: 'number', default: 15, min: 5, max: 60, step: 0.5, unit: 'mm', label: 'Side post width', group: 'Cradle' },
    clearHeight: { type: 'number', default: 50, min: 5, max: 300, step: 0.5, unit: 'mm', label: 'Height under the notch', group: 'Cradle', help: 'Room for props, gimbal or landing gear below the body.' },
    footFlare: { type: 'number', default: 15, min: 0, max: 80, step: 0.5, unit: 'mm', label: 'Foot flare (each side)', group: 'Cradle' },
    thickness: { type: 'number', default: 12, min: 4, max: 60, step: 0.5, unit: 'mm', label: 'Thickness (print height)', group: 'Cradle' },
    rodHole: { type: 'number', default: 8.3, min: 0, max: 30, step: 0.05, unit: 'mm', label: 'Rod holes to join cradles (0 = none)', group: 'Join', help: '8.3 for 8 mm rod or tube, 10.3 for 10 mm.' },
    window: { type: 'boolean', default: true, label: 'Lightening window', group: 'Cradle' },
  },
  generate(p, k) {
    const warnings = [];
    const N = p.notchWidth;
    const S = N + 2 * p.sideWidth;
    const Htot = p.clearHeight + p.notchDepth;
    const B = S + 2 * p.footFlare;
    const footH = Math.min(10, Htot * 0.25);
    // outline in XY (Y up in use), extruded along Z = print height
    const outline = [[-B / 2, 0], [B / 2, 0], [B / 2, footH * 0.6], [S / 2, footH + p.footFlare * 0.6], [S / 2, Htot], [-S / 2, Htot], [-S / 2, footH + p.footFlare * 0.6], [-B / 2, footH * 0.6]];
    const body = k.prismZ(outline, 0, p.thickness);
    const Z = p.thickness;
    const cuts = [];
    const top = Htot;
    const bottom = p.clearHeight;
    if (p.shape === 'v') {
      cuts.push(k.prismZ([[-N / 2, top + 1], [N / 2, top + 1], [0, bottom]], -1, Z + 1));
    } else if (p.shape === 'u' && p.notchDepth >= N / 2) {
      cuts.push(k.cuboid([N, top - bottom - N / 2 + 1, Z + 2], [0, (bottom + N / 2 + top + 1) / 2, Z / 2]));
      cuts.push(k.cylZ(N / 2, 0, bottom + N / 2, -1, Z + 1, 96));
    } else {
      if (p.shape === 'u') warnings.push('U notch shallower than half its width: made with a flat bottom and round corners.');
      const rr = Math.min(6, N / 4, p.notchDepth / 2);
      cuts.push(k.cuboid([N, top - bottom - rr + 1, Z + 2], [0, (bottom + rr + top + 1) / 2, Z / 2]));
      cuts.push(k.roundedBlock(N, 2 * rr + 0.02, rr, -1, Z + 1, 8).translate([0, bottom + rr, 0]));
      k.track(cuts[cuts.length - 1]);
    }
    if (p.rodHole > 0) {
      const y = footH * 0.45 + p.rodHole / 2;
      for (const s of [-1, 1]) cuts.push(k.cylZ(p.rodHole / 2, s * (S / 2 - p.sideWidth / 2), Math.max(y, p.rodHole / 2 + 3), -1, Z + 1, 40));
    }
    if (p.window && p.clearHeight > 30 && N > 30) {
      const wy0 = footH + p.rodHole + 6;
      const wy1 = bottom - 8;
      if (wy1 - wy0 > 10) cuts.push(k.roundedBlock(N * 0.7, wy1 - wy0, 4, -1, Z + 1, 6).translate([0, (wy0 + wy1) / 2, 0]));
      if (wy1 - wy0 > 10) k.track(cuts[cuts.length - 1]);
    }
    const part = k.difference(body, cuts);
    return {
      parts: [{ name: 'cradle', manifold: k.placeOnBed(part) }],
      warnings,
      notes: [`Cradle ${B.toFixed(0)} mm wide, ${Htot.toFixed(0)} mm tall, notch ${N} x ${p.notchDepth} mm. Prints lying flat. Print 2 and join them with ${p.rodHole > 0 ? `${(p.rodHole - 0.3).toFixed(0)} mm rods` : 'a board'}.`, 'Stick felt or print TPU pads in the notch to protect the shell.'],
    };
  },
};

// ---------------------------------------------------------------- extrusion brackets

const PROFILES = {
  2020: { s: 20, slot: 6, hole: 5.5 },
  3030: { s: 30, slot: 8, hole: 6.6 },
  4040: { s: 40, slot: 8, hole: 8.5 },
};

export const extrusionBracket = {
  id: 'extrusion-bracket',
  name: 'Extrusion Bracket',
  sections: ['robotics', 'shop'],
  description: 'Brackets for 2020 / 3030 / 4040 aluminium T-slot profile: 90 degree corner with gussets, straight joining plate, T plate, end cap. Optional slot keys line the part up with the slot.',
  params: {
    profile: { type: 'select', default: '2020', group: 'Profile', label: 'Profile', options: [{ value: '2020', label: '2020 (M5)' }, { value: '3030', label: '3030 (M6)' }, { value: '4040', label: '4040 (M8)' }] },
    slotWidth: { type: 'number', default: 0, min: 0, max: 14, step: 0.05, unit: 'mm', label: 'Slot width (0 = profile default)', group: 'Profile', help: 'Defaults: 2020 = 6, 3030 / 4040 = 8. Measure yours.' },
    type: { type: 'select', default: 'corner', group: 'Bracket', label: 'Type', options: [{ value: 'corner', label: '90 degree corner' }, { value: 'straight', label: 'Straight plate' }, { value: 'tee', label: 'T plate' }, { value: 'cap', label: 'End cap' }] },
    holesPerLeg: { type: 'integer', default: 2, min: 1, max: 4, label: 'Holes per leg', group: 'Bracket' },
    thickness: { type: 'number', default: 4, min: 2, max: 10, step: 0.5, unit: 'mm', label: 'Plate thickness', group: 'Bracket' },
    slotKeys: { type: 'boolean', default: true, label: 'Slot keys (line up with the slot)', group: 'Bracket' },
  },
  generate(p, k) {
    const pr = PROFILES[p.profile];
    const s = pr.s;
    const slot = (p.slotWidth || pr.slot) - 0.3;
    const T = p.thickness;
    const n = p.holesPerLeg;
    const legL = n * s;
    const keyH = 1.4;
    const notes = [];
    if (p.type === 'cap') {
      const plate = k.roundedBlock(s, s, 1.5, 0, 2, 6);
      const add = [plate];
      if (p.slotKeys) for (const [x, y, w, d] of [[0, s / 2 - 0.9, slot, 1.6], [0, -s / 2 + 0.9, slot, 1.6], [s / 2 - 0.9, 0, 1.6, slot], [-s / 2 + 0.9, 0, 1.6, slot]]) add.push(k.cuboid([w, d, 6], [x, y, 2 + 3 - 0.01]));
      notes.push(`End cap for ${p.profile}. Keys press into the 4 slots. Fit is not tested: adjust slot width.`);
      return { parts: [{ name: 'end-cap', manifold: k.placeOnBed(k.union(add)) }], warnings: [], notes };
    }
    // a leg: plate along +X from x0, width s, with holes every s, slot key along the center line
    const leg = (len, x0, rotDeg) => {
      let m = k.cuboid([len, s, T], [x0 + len / 2, 0, T / 2]);
      const cuts = [];
      for (let i = 0; i < Math.round(len / s); i++) cuts.push(k.cylZ(pr.hole / 2, x0 + s / 2 + i * s, 0, -1, T + 1, 32));
      if (p.slotKeys) m = k.union([m, k.cuboid([len - 2, slot, keyH], [x0 + len / 2, 0, -keyH / 2 + 0.01])]);
      m = k.difference(m, cuts);
      return rotDeg ? k.rotate(m, [0, 0, rotDeg]) : m;
    };
    if (p.type === 'straight') {
      const part = k.rotate(leg(2 * legL, -legL, 0), [180, 0, 0]); // keys up: no support
      notes.push(`Joins two ${p.profile} lengths end to end: ${n} holes each side.`);
      return { parts: [{ name: 'plate', manifold: k.placeOnBed(part) }], warnings: [], notes };
    }
    if (p.type === 'tee') {
      const bar = leg(2 * legL + s, -legL - s / 2, 0);
      const stem = k.translate(leg(legL, s / 2, 90), [0, -0.01, 0]);
      const centre = k.cuboid([s, s, T], [0, 0, T / 2]);
      const part = k.rotate(k.union([bar, stem, centre]), [180, 0, 0]);
      notes.push(`T plate: ${n} holes on each of 3 legs.`);
      return { parts: [{ name: 't-plate', manifold: k.placeOnBed(part) }], warnings: [], notes };
    }
    // corner: L profile in XZ, extruded along Y (width s). Leg A on the bed, leg B upright at x = 0.
    const A = k.cuboid([legL + T, s, T], [(legL + T) / 2, 0, T / 2]);
    const Bl = k.cuboid([T, s, legL + T], [T / 2, 0, (legL + T) / 2]);
    const g = 3;
    const gs = Math.min(legL, legL) * 0.85;
    const gussets = [-1, 1].map((sy) => k.prismY([[T - 0.3, T - 0.3], [gs, T - 0.3], [T - 0.3, gs]], sy * (s / 2) - (sy > 0 ? g : 0), sy * (s / 2) + (sy > 0 ? 0 : g)));
    const cuts = [];
    const add = [A, Bl, ...gussets];
    for (let i = 0; i < n; i++) {
      const c = T + s / 2 + i * s;
      cuts.push(k.cylZ(pr.hole / 2, c, 0, -1, T + 1, 32));
      cuts.push(k.holeX(pr.hole / 2, 0, c, -1, T + 1, 32));
    }
    if (p.slotKeys) {
      add.push(k.cuboid([legL - 1, slot, keyH], [T + 1 + (legL - 1) / 2, 0, -keyH / 2 + 0.01]));
      add.push(k.cuboid([keyH, slot, legL - 1], [-keyH / 2 + 0.01, 0, T + 1 + (legL - 1) / 2]));
      notes.push('Slot keys stick out under the legs: the corner prints on its side so the keys need no support.');
    }
    let part = k.difference(k.union(add), cuts);
    // print on the side (Y down) so both hole sets and keys print cleanly
    part = k.rotate(part, [90, 0, 0]);
    notes.push(`90 degree corner for ${p.profile}: ${n} x ${p.profile === '2020' ? 'M5' : p.profile === '3030' ? 'M6' : 'M8'} per leg, side gussets.`);
    return { parts: [{ name: 'corner', manifold: k.placeOnBed(part) }], warnings: [], notes };
  },
};

// ---------------------------------------------------------------- motor clamp

export const motorClamp = {
  id: 'motor-clamp',
  name: 'Motor Clamp',
  sections: ['robotics'],
  description: 'Two-part clamp for round or flatted motor bodies (N20, 130 size, 25 / 37 mm gear motors, any size you measure). Base with screw ears plus a screw-down cap.',
  params: {
    bodyDiameter: { type: 'number', default: 12, min: 4, max: 80, step: 0.05, unit: 'mm', label: 'Body diameter (or width)', group: 'Motor', help: 'Measure the round part of the body.' },
    flatHeight: { type: 'number', default: 10, min: 0, max: 80, step: 0.05, unit: 'mm', label: 'Across the flats (0 = round)', group: 'Motor', help: 'N20 and 130 motors have two flats. Flats face up and down.' },
    clampLength: { type: 'number', default: 10, min: 4, max: 80, step: 0.5, unit: 'mm', label: 'Clamp length', group: 'Motor' },
    clearance: { type: 'number', default: 0.1, min: -0.3, max: 1, step: 0.05, unit: 'mm', label: 'Fit clearance (per side)', group: 'Motor' },
    wall: { type: 'number', default: 2.5, min: 1.2, max: 10, step: 0.1, unit: 'mm', label: 'Wall', group: 'Clamp' },
    capBolt: boltParam('Clamp', 'M2', 'Cap screws'),
    earBolt: boltParam('Clamp', 'M3', 'Mounting screws'),
  },
  generate(p, k) {
    const warnings = [];
    const R = p.bodyDiameter / 2 + p.clearance;
    const flat = p.flatHeight > 0 ? Math.min(p.flatHeight + 2 * p.clearance, 2 * R) : 2 * R;
    if (p.flatHeight > p.bodyDiameter) warnings.push('Across-flats is larger than the diameter: treated as round.');
    const hz = flat / 2; // half height of the bore
    const cb = bolt(p.capBolt);
    const eb = bolt(p.earBolt);
    const t = p.wall;
    const L = p.clampLength;
    const zc = t + hz; // bore center height
    const capPos = R + t + cb.head / 2; // cap screw X
    const W = 2 * (capPos + cb.head / 2 + 1);
    const earX = W / 2 + eb.head / 2 + 2;
    const gap = 0.4;
    const bore = () => k.intersect(k.holeY(R, 0, zc, -L, L, 64), k.cuboid([4 * R, 4 * L, flat], [0, 0, zc]));
    // base: block from 0 to zc - gap/2, ears at the bottom
    let base = k.union([
      k.cuboid([W, L, zc - gap / 2], [0, 0, (zc - gap / 2) / 2]),
      k.cuboid([2 * earX + eb.head + 4, L, 3], [0, 0, 1.5]),
    ]);
    const baseCuts = [bore()];
    for (const s of [-1, 1]) {
      baseCuts.push(k.cylZ(cb.tap / 2, s * capPos, 0, 0.8, zc + 1, 20));
      baseCuts.push(k.cylZ(eb.clear / 2, s * earX, 0, -1, 4, 24));
    }
    base = k.difference(base, baseCuts);
    // cap: block from zc + gap/2 to zc + hz + t, flipped to print split face down
    const capTop = zc + hz + t;
    let cap = k.cuboid([W, L, capTop - zc - gap / 2], [0, 0, (zc + gap / 2 + capTop) / 2]);
    const capCuts = [bore()];
    for (const s of [-1, 1]) {
      capCuts.push(k.cylZ(cb.clear / 2, s * capPos, 0, zc - 1, capTop + 1, 20));
      capCuts.push(k.cylZ(cb.head / 2 + 0.3, s * capPos, 0, capTop - cb.headH, capTop + 1, 24));
    }
    cap = k.rotate(k.difference(cap, capCuts), [180, 0, 0]);
    if (capTop - cb.headH - (zc + gap / 2) < 1.2) warnings.push('Cap is thin under the screw heads. Raise the wall.');
    return {
      parts: [{ name: 'base', manifold: k.placeOnBed(base) }, { name: 'cap', manifold: k.placeOnBed(cap) }],
      warnings,
      notes: [`Bore ${(2 * R).toFixed(2)} mm${p.flatHeight > 0 ? `, ${flat.toFixed(2)} mm across the flats` : ''}, center ${zc.toFixed(1)} mm above the base. ${p.capBolt} cap screws pinch a ${gap} mm gap. ${p.earBolt} ears ${(2 * earX).toFixed(1)} mm apart.`],
    };
  },
};
