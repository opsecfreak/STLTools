// Holders for small electronics on drones, robots and benches:
//   mcu-holder           cradle with snap lips (boards without holes: XIAO, Blue Pill...) or
//                        posts on the hole pattern (Pico, Nano...), USB opening, screw tabs,
//                        tape, zip-tie slots or an FC stack pattern (20 x 20 / 30.5 x 30.5)
//   pi-camera-case       two-part case for a small camera board (Pi Camera Module 2 / 3 class):
//                        front with the lens hole and posts, back with screw holes, ribbon slot,
//                        1/4-20 tripod nut, screw tab or flat back
//   antenna-tube-holder  clip for dipole / tube antennas (u.FL / IPEX pigtails) on a standoff,
//                        an arm (zip ties) or screws; single or V pair
//
// No board sizes are built in: presets carry datasheet values marked "verify" and leave
// unknown sizes to measure.
import { bolt, boltParam, squarePattern } from '../core/hardware.js';

const INCH = 25.4;

export const mcuHolder = {
  id: 'mcu-holder',
  name: 'Microcontroller Board Holder',
  sections: ['quads', 'robotics', 'accessories', 'planes'],
  description: 'Holder for a small board (XIAO, Pico, ESP32 DevKit, STM32 Blue / Black Pill, Nano): snap-lip cradle or posts on the hole pattern, USB opening, on screw tabs, tape, zip ties or an FC stack pattern.',
  basic: ['boardLength', 'boardWidth', 'style', 'base'],
  params: {
    boardLength: { type: 'number', default: 51, min: 8, max: 150, step: 0.1, unit: 'mm', label: 'Board length (USB end to end)', group: 'Board' },
    boardWidth: { type: 'number', default: 21, min: 8, max: 100, step: 0.1, unit: 'mm', label: 'Board width', group: 'Board' },
    pcbThickness: { type: 'number', default: 1.6, min: 0.6, max: 3, step: 0.05, unit: 'mm', label: 'PCB thickness', group: 'Board', help: 'Measure at the edge with calipers.' },
    underClearance: { type: 'number', default: 3, min: 0, max: 15, step: 0.1, unit: 'mm', label: 'Space under the board', group: 'Board', help: 'For parts on the underside and solder joints. Header pins down: about 9 mm, or cut them.' },
    clearance: { type: 'number', default: 0.3, min: 0, max: 1.5, step: 0.05, unit: 'mm', label: 'Fit clearance (per side)', group: 'Board' },
    style: { type: 'select', default: 'cradle', label: 'Holds the board by', group: 'Holder', options: [{ value: 'cradle', label: 'Edges: walls with snap lips' }, { value: 'posts', label: 'Mounting holes: posts' }] },
    holeSpacingL: { type: 'number', default: 47, min: 2, max: 150, step: 0.05, unit: 'mm', label: 'Hole spacing along the board', group: 'Holder' },
    holeSpacingW: { type: 'number', default: 11.4, min: 0, max: 100, step: 0.05, unit: 'mm', label: 'Hole spacing across (0 = one row)', group: 'Holder' },
    postScrew: boltParam('Holder', 'M2', 'Post screw (tap hole)'),
    wall: { type: 'number', default: 1.6, min: 1, max: 4, step: 0.1, unit: 'mm', label: 'Wall', group: 'Holder' },
    lip: { type: 'number', default: 0.6, min: 0, max: 1.5, step: 0.05, unit: 'mm', label: 'Snap lip over the board edge', group: 'Holder' },
    usbEnd: { type: 'boolean', default: true, label: 'USB opening at the front end', group: 'Holder' },
    usbWidth: { type: 'number', default: 10, min: 4, max: 20, step: 0.5, unit: 'mm', label: 'USB opening width', group: 'Holder', help: 'USB-C plug overmold is wider than the socket: 10-12 mm.' },
    floor: { type: 'number', default: 1.6, min: 1, max: 5, step: 0.1, unit: 'mm', label: 'Floor', group: 'Base' },
    base: { type: 'select', default: 'tabs', label: 'Base', group: 'Base', options: [{ value: 'tabs', label: 'Screw tabs (2)' }, { value: 'tape', label: 'Flat (tape / glue)' }, { value: 'zip', label: 'Zip-tie slots (2)' }, { value: 'stack20', label: 'FC stack 20 x 20' }, { value: 'stack30', label: 'FC stack 30.5 x 30.5' }] },
    baseScrew: boltParam('Base', 'M3', 'Tab / stack screw'),
  },
  generate(p, k) {
    const warnings = [], notes = [];
    const c = p.clearance, t = p.wall, F = p.base === 'zip' ? Math.max(p.floor, 2.4) : p.floor;
    const L = p.boardLength + 2 * c, W = p.boardWidth + 2 * c;
    const zBoard = F + p.underClearance; // underside of the PCB
    const zTop = zBoard + p.pcbThickness;
    const OL = L + 2 * t, OW = W + 2 * t;
    const add = [], cuts = [];
    // floor plate (also the base)
    let plateL = OL, plateW = OW;
    const bs = bolt(p.baseScrew);
    const stack = p.base === 'stack20' ? 20 : p.base === 'stack30' ? 30.5 : 0;
    if (stack) { plateL = Math.max(OL, stack + bs.head + 3); plateW = Math.max(OW, stack + bs.head + 3); }
    if (p.base === 'tabs') plateL = OL + 2 * (bs.head + 3);
    add.push(k.roundedBlock(plateL, plateW, 2, 0, F, 8));
    if (p.style === 'cradle') {
      // walls to just above the board, with a lip over each long edge
      const zW = zTop + 0.2 + p.lip + 0.8;
      add.push(k.difference(k.roundedBlock(OL, OW, 2, 0, zW, 8), [k.cuboid([L, W, zW], [0, 0, F + zW / 2])]));
      if (p.lip > 0) for (const s of [-1, 1]) {
        // lip: a ridge over the board edge, chamfered underneath so it prints and snaps
        const y0 = s * (W / 2), y1 = s * (W / 2 - p.lip);
        add.push(k.prismX([[y0 + s * 0.5, zTop + 0.2 - 0.5], [y1, zTop + 0.2 + p.lip], [y1, zTop + 0.2 + p.lip + 0.4], [y0 + s * 0.5, zW - 0.3]], -L / 2 + 4.6, L / 2 - 4.6)); // on the flexing wall between the relief slots
      }
      // ledges the board rests on, along the long sides
      for (const s of [-1, 1]) add.push(k.cuboid([L, 1.2, zBoard - F], [0, s * (W / 2 - 0.6), F + (zBoard - F) / 2]));
      // relief slots so the walls flex when the board snaps in
      for (const s of [-1, 1]) for (const x of [-L / 2 + 2, L / 2 - 2]) cuts.push(k.cuboid([1, t + 2, zW - F - 0.6], [x + (x < 0 ? 1.5 : -1.5), s * (W / 2 + t / 2), F + 0.6 + (zW - F) / 2 + 0.3]));
      if (p.usbEnd) cuts.push(k.cuboid([t + 2, Math.min(W - 1, p.usbWidth), zW + 2], [L / 2 + t / 2, 0, zBoard - 0.5 + (zW + 2) / 2]));
      if (p.lip > 0.9) warnings.push('A lip over 0.9 mm needs a lot of wall flex: print in PETG or TPU, or lower it.');
      notes.push(`Press the board in from above: the walls flex at the relief slots and the ${p.lip} mm lips hold it.`);
    } else {
      const ps = bolt(p.postScrew);
      const pts = p.holeSpacingW > 0 ? squarePattern(p.holeSpacingL, p.holeSpacingW) : [[-p.holeSpacingL / 2, 0], [p.holeSpacingL / 2, 0]];
      for (const [x, y] of pts) {
        add.push(k.cylZ(Math.max(ps.head / 2 + 0.6, ps.d + 1), x, y, 0, zBoard, 32));
        cuts.push(k.cylZ(ps.tap / 2, x, y, F * 0.5, zBoard + 1, 24));
      }
      if (p.holeSpacingL > p.boardLength || p.holeSpacingW > p.boardWidth) warnings.push('The hole pattern is larger than the board.');
      notes.push(`${pts.length} posts, ${p.postScrew} tap holes (${ps.tap} mm): ${p.postScrew} screws about ${Math.ceil(p.pcbThickness + 4)} mm long, or self-tapping PCB screws.`);
    }
    // base features
    if (p.base === 'tabs') for (const s of [-1, 1]) {
      cuts.push(k.cylZ(bs.clear / 2, s * (OL / 2 + bs.head / 2 + 1.5), 0, -1, F + 1, 24));
    }
    if (p.base === 'zip') for (const x of [-L / 4, L / 4]) cuts.push(k.cuboid([5.2, plateW + 2, 2.8], [x, 0, 1.8 - 1.4]));
    if (stack) for (const [x, y] of squarePattern(stack)) cuts.push(k.cylZ(bs.clear / 2, x, y, -1, F + 1, 24));
    if (stack && p.style === 'cradle' && Math.max(stack / 2 + bs.head / 2) > Math.min(OL, OW) / 2) notes.push(`Stack screws sit outside the cradle: the plate is ${plateL.toFixed(0)} x ${plateW.toFixed(0)} mm.`);
    if (p.base === 'zip' && p.floor < 2.4) notes.push('Floor raised to 2.4 mm for the zip-tie channels.');
    const part = k.difference(k.union(add), cuts);
    notes.push(`Board ${p.boardLength} x ${p.boardWidth} mm in a ${L.toFixed(1)} x ${W.toFixed(1)} mm pocket. Print as placed (floor down). Check the board size with calipers first.`);
    return { parts: [{ name: 'holder', manifold: k.placeOnBed(part) }], warnings, notes };
  },
};

export const piCameraCase = {
  id: 'pi-camera-case',
  name: 'Camera Board Case (Pi camera class)',
  sections: ['robotics', 'quads', 'accessories'],
  description: 'Two-part case for a small camera board: front with the lens hole and screw posts, back with screw holes and a ribbon slot; 1/4-20 tripod nut, screw tab or flat back.',
  basic: ['boardWidth', 'boardHeight', 'lensFromTop', 'lensHole', 'mount'],
  params: {
    boardWidth: { type: 'number', default: 25, min: 10, max: 80, step: 0.05, unit: 'mm', label: 'Board width', group: 'Board' },
    boardHeight: { type: 'number', default: 24, min: 10, max: 80, step: 0.05, unit: 'mm', label: 'Board height (connector edge at the bottom)', group: 'Board' },
    pcbThickness: { type: 'number', default: 1, min: 0.6, max: 2.5, step: 0.05, unit: 'mm', label: 'PCB thickness', group: 'Board' },
    holeSpacingX: { type: 'number', default: 21, min: 4, max: 76, step: 0.05, unit: 'mm', label: 'Hole spacing across', group: 'Board' },
    holeSpacingY: { type: 'number', default: 12.5, min: 0, max: 76, step: 0.05, unit: 'mm', label: 'Hole spacing up / down', group: 'Board' },
    holeFromTop: { type: 'number', default: 2, min: 1, max: 40, step: 0.05, unit: 'mm', label: 'Top hole row from the top edge', group: 'Board' },
    screw: boltParam('Board', 'M2', 'Board screws'),
    lensFromTop: { type: 'number', default: 9.5, min: 2, max: 60, step: 0.05, unit: 'mm', label: 'Lens center from the top edge', group: 'Lens', help: 'The default is a placeholder, not a datasheet value: measure on your board.' },
    lensFromCenter: { type: 'number', default: 0, min: -30, max: 30, step: 0.05, unit: 'mm', label: 'Lens center left (-) / right (+) of the board middle', group: 'Lens' },
    lensHole: { type: 'number', default: 8.5, min: 2, max: 40, step: 0.1, unit: 'mm', label: 'Lens hole diameter', group: 'Lens', help: 'Lens block width plus clearance (the default is a placeholder). A square lens block needs its diagonal.' },
    frontGap: { type: 'number', default: 1.5, min: 0.5, max: 10, step: 0.1, unit: 'mm', label: 'Space between the board and the front', group: 'Case', help: 'Room for parts on the lens side next to the lens block.' },
    backGap: { type: 'number', default: 3, min: 1, max: 15, step: 0.1, unit: 'mm', label: 'Space behind the board', group: 'Case', help: 'Connector and parts on the back.' },
    wall: { type: 'number', default: 1.6, min: 1, max: 4, step: 0.1, unit: 'mm', label: 'Wall', group: 'Case' },
    clearance: { type: 'number', default: 0.3, min: 0, max: 1.5, step: 0.05, unit: 'mm', label: 'Board clearance (per side)', group: 'Case' },
    ribbonWidth: { type: 'number', default: 17, min: 5, max: 30, step: 0.5, unit: 'mm', label: 'Ribbon slot width', group: 'Case', help: 'Cable width plus 1 mm.' },
    mount: { type: 'select', default: 'tripod', label: 'Mount on the back', group: 'Mount', options: [{ value: 'tripod', label: '1/4-20 tripod nut' }, { value: 'tab', label: 'Screw tab below' }, { value: 'flat', label: 'Flat (tape)' }] },
    tabScrew: boltParam('Mount', 'M3', 'Tab screw'),
  },
  generate(p, k) {
    const warnings = [], notes = [];
    const c = p.clearance, t = p.wall;
    const bw = p.boardWidth + 2 * c, bh = p.boardHeight + 2 * c;
    const OW = bw + 2 * t, OH = bh + 2 * t; // case outline (X across, Y up)
    const depth = p.frontGap + p.pcbThickness + p.backGap; // inside depth
    const s = bolt(p.screw);
    // board frame: origin = board center, +Y = top edge
    const holes = [];
    const yTop = p.boardHeight / 2 - p.holeFromTop;
    for (const x of [-p.holeSpacingX / 2, p.holeSpacingX / 2]) { holes.push([x, yTop]); if (p.holeSpacingY > 0) holes.push([x, yTop - p.holeSpacingY]); }
    const lens = [p.lensFromCenter, p.boardHeight / 2 - p.lensFromTop];
    if (Math.abs(lens[0]) + p.lensHole / 2 > bw / 2 + t || Math.abs(lens[1]) + p.lensHole / 2 > bh / 2 + t) warnings.push('The lens hole runs off the case: check the lens position.');
    for (const [x, y] of holes) if (Math.hypot(x - lens[0], y - lens[1]) < p.lensHole / 2 + s.d / 2 + 1.2) warnings.push('A screw post is next to the lens hole: check the hole and lens positions.');
    // front shell: z = 0 front face, walls go back to z = t + depth
    const zIn = t, zEnd = t + depth;
    const front = k.difference(k.union([
      k.difference(k.roundedBlock(OW, OH, 2, 0, zEnd, 8), [k.cuboid([bw, bh, depth + 1], [0, 0, zIn + (depth + 1) / 2])]),
      ...holes.map(([x, y]) => k.cylZ(s.d / 2 + 1.1, x, y, zIn - 0.01, zIn + p.frontGap, 24)),
    ]), [
      k.cylZ(p.lensHole / 2, lens[0], lens[1], -1, zIn + 1, 48),
      ...holes.map(([x, y]) => k.cylZ(s.tap / 2, x, y, zIn * 0.4, zIn + p.frontGap + 1, 20)),
      // ribbon slot in the bottom wall, at the back
      k.cuboid([Math.min(bw - 1, p.ribbonWidth), t + 2, p.backGap + 0.6], [0, -bh / 2 - t / 2, zEnd - (p.backGap + 0.6) / 2 + 0.01]),
    ]);
    // back plate: closes the shell; spacer posts press the board; screws from behind
    const add = [k.roundedBlock(OW, OH, 2, 0, t, 8)];
    for (const [x, y] of holes) add.push(k.cylZ(s.d / 2 + 1.1, x, y, t - 0.01, t + p.backGap, 24));
    const cuts = holes.map(([x, y]) => k.cylZ(s.clear / 2, x, y, -1, t + p.backGap + 1, 20));
    for (const [x, y] of holes) cuts.push(k.cylZ(s.head / 2 + 0.3, x, y, -1, Math.min(s.headH, t - 0.6), 20)); // head recess on the outside
    if (p.mount === 'tripod') {
      // 1/4-20 UNC hex nut: 7/16 in across flats (ISO / ASME standard), 7/32 in thick
      const af = (7 / 16) * INCH + 0.3, nh = (7 / 32) * INCH + 0.3;
      const ny = -bh / 2 + Math.max(af / 2 + 1, 0); // low on the back, clear of the screws
      const bossR = af / Math.sqrt(3) + 1.8;
      add.push(k.cylZ(bossR, 0, ny, -nh - 1.2, 0.01, 48));
      cuts.push(k.hexZ(af, 0, ny, -nh - 1.3, -1.2, 0), k.cylZ((0.25 * INCH + 0.4) / 2, 0, ny, -nh - 2, t - 0.6, 32));
      for (const [x, y] of holes) if (Math.hypot(x, y - ny) < bossR + s.head / 2) warnings.push('The tripod nut boss covers a screw head: screw the board in before fitting the nut, or use the tab mount.');
      notes.push('Tripod: press a 1/4-20 hex nut into the boss from outside (a drop of CA glue holds it).');
    } else if (p.mount === 'tab') {
      const ts = bolt(p.tabScrew);
      const tl = ts.head + 6;
      add.push(k.translate(k.roundedBlock(Math.max(ts.head + 6, 10), tl + 4, 2, 0, t, 8), [0, -OH / 2 - tl / 2 + 2, 0]));
      cuts.push(k.cylZ(ts.clear / 2, 0, -OH / 2 - tl / 2 + 1, -1, t + 1, 24));
    }
    const back = k.difference(k.union(add), cuts);
    notes.push(`Front: print face down. Back: print as placed (posts up). The board sits ${p.frontGap} mm behind the front; ${holes.length} x ${p.screw} screws about ${Math.ceil(t + p.backGap + p.pcbThickness + p.frontGap * 0.8)} mm long go through the back and the board into the front posts.`);
    notes.push('Check the hole pattern, lens position and board size against your board before printing.');
    const fp = k.pose(front, [0, 0, 0]);
    // in the case the back is turned over (about Y: the hole pattern is symmetric across X) with
    // its posts toward the board; it prints posts up
    const backInPlace = k.translate(k.rotate(back, [0, 180, 0]), [0, 0, zEnd + t]);
    const bp = k.pose(backInPlace, [0, 180, 0]);
    return {
      parts: [
        { name: 'front', manifold: fp.manifold, assembled: fp.assembled },
        { name: 'back', manifold: bp.manifold, assembled: bp.assembled },
      ],
      warnings: [...new Set(warnings)], notes,
    };
  },
};

export const antennaTubeHolder = {
  id: 'antenna-tube-holder',
  name: 'Antenna Tube Holder',
  sections: ['quads', 'planes', 'accessories'],
  description: 'Holds receiver / VTX dipole antennas in tubes (u.FL / IPEX pigtails): clip on a round or hex standoff, zip ties on an arm, or screws; single or V pair, tilted.',
  basic: ['tubeOD', 'count', 'tilt', 'mount'],
  params: {
    tubeOD: { type: 'number', default: 3, min: 1, max: 12, step: 0.05, unit: 'mm', label: 'Antenna tube OD', group: 'Antenna', help: 'Measure the tube; heat-shrink covered antennas vary.' },
    tubeFit: { type: 'number', default: 0.1, min: -0.3, max: 0.6, step: 0.05, unit: 'mm', label: 'Tube fit (per side, minus = press fit)', group: 'Antenna' },
    count: { type: 'integer', default: 2, min: 1, max: 2, label: 'Antennas (2 = V pair)', group: 'Antenna' },
    tilt: { type: 'number', default: 45, min: 0, max: 80, step: 1, unit: 'deg', label: 'Tilt from vertical', group: 'Antenna', help: 'A V pair at 45 deg each gives the usual 90 deg between receiver antennas.' },
    socketLength: { type: 'number', default: 12, min: 5, max: 40, step: 0.5, unit: 'mm', label: 'Socket length', group: 'Antenna' },
    mount: { type: 'select', default: 'standoff', label: 'Mount', group: 'Mount', options: [{ value: 'standoff', label: 'Clip on a standoff' }, { value: 'zip', label: 'Zip ties on an arm / boom' }, { value: 'screw', label: 'Screw' }] },
    standoffShape: { type: 'select', default: 'round', label: 'Standoff shape', group: 'Mount', options: [{ value: 'round', label: 'Round' }, { value: 'hex', label: 'Hex' }] },
    standoffSize: { type: 'number', default: 5, min: 2, max: 12, step: 0.05, unit: 'mm', label: 'Standoff OD / hex across flats', group: 'Mount', help: 'Measure yours: M3 nylon standoffs are often 5 or 5.5 mm, M2 ones 3.5 or 4 mm.' },
    clipHeight: { type: 'number', default: 8, min: 4, max: 30, step: 0.5, unit: 'mm', label: 'Clip height', group: 'Mount' },
    screw: boltParam('Mount', 'M3', 'Screw'),
    wall: { type: 'number', default: 1.8, min: 1, max: 4, step: 0.1, unit: 'mm', label: 'Wall', group: 'Mount' },
  },
  generate(p, k) {
    const warnings = [], notes = [];
    const t = p.wall, H = p.clipHeight;
    const rT = p.tubeOD / 2 + p.tubeFit, rS = rT + t;
    const add = [], cuts = [];
    // body block that the sockets come out of, standing on the bed (Z up = antenna up)
    const bodyW = p.count === 2 ? 2 * rS + 6 : 2 * rS + 4;
    let backY = 0;
    if (p.mount === 'standoff') {
      const rIn = (p.standoffShape === 'hex' ? p.standoffSize / Math.sqrt(3) : p.standoffSize / 2) + 0.1;
      const rOut = rIn + t + 0.4;
      const cy = -(rOut + 1); // standoff behind the body
      add.push(k.cylZ(rOut, 0, cy, 0, H, 48));
      cuts.push(p.standoffShape === 'hex' ? k.hexZ(p.standoffSize + 0.2, 0, cy, -1, H + 1, 0) : k.cylZ(rIn, 0, cy, -1, H + 1, 48));
      // opening at the back so it clips on: 80 % of the standoff width
      cuts.push(k.cuboid([p.standoffSize * 0.8, rOut + 2, H + 2], [0, cy - rOut / 2 - 1, H / 2]));
      backY = cy + rOut;
      notes.push(`Clip for a ${p.standoffSize} mm ${p.standoffShape} standoff: push it on from the side. Print in PETG or TPU so it flexes.`);
    } else if (p.mount === 'zip') {
      cuts.push(k.cuboid([bodyW + 2, 5.2, 1.8], [0, 0, 2.2]));
      notes.push('Zip-tie slot under the sockets: tie it to an arm or boom with one 4.8 mm zip tie.');
    } else {
      const sb = bolt(p.screw);
      add.push(k.translate(k.roundedBlock(bodyW, sb.head + 6, 2, 0, 2.5, 8), [0, -(sb.head + 6) / 2 - rS, 0]));
      cuts.push(k.cylZ(sb.clear / 2, 0, -(sb.head + 6) / 2 - rS, -1, 4, 24));
    }
    add.push(k.translate(k.roundedBlock(bodyW, 2 * rS + 2, 1.5, 0, H, 8), [0, backY + rS, 0]));
    // sockets: tilted tubes leaving the top of the body
    const dirs = p.count === 2 ? [-1, 1] : [0];
    const a = (p.tilt * Math.PI) / 180;
    for (const d of dirs) {
      const x0 = d * (rS + 1) * (p.count === 2 ? 0.5 : 0), y0 = backY + rS;
      const dx = p.count === 2 ? d * Math.sin(a) : 0, dy = p.count === 2 ? 0 : Math.sin(a), dz = Math.cos(a);
      const base = [x0, y0, H - 2];
      const top = [x0 + dx * p.socketLength, y0 + dy * p.socketLength, H - 2 + dz * p.socketLength];
      add.push(k.rod(base, top, rS, 32));
      cuts.push(k.rod([base[0] - dx * 4, base[1] - dy * 4, base[2] - dz * 4], [top[0] + dx, top[1] + dy, top[2] + dz], rT, 24));
    }
    let part = k.difference(k.union(add), cuts);
    part = k.intersect(part, k.cuboid([200, 200, 200], [0, 0, 100]));
    if (rT < 1) warnings.push('Very thin tube: the socket may close up when printed. Drill it out after printing.');
    notes.push(`${dirs.length} socket(s) for ${p.tubeOD} mm tubes, ${p.tilt} deg from vertical. The pigtail runs down through the socket. Print as placed.`);
    return { parts: [{ name: 'antenna-holder', manifold: k.placeOnBed(part) }], warnings, notes };
  },
};
