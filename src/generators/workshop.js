// Workshop and build parts (1.0): battery cell holders, SK-style shaft
// supports, a drawer unit (assembly), filament spool holder, printed
// multirotor arm, and a drill guide.
//
// Cell sizes are typical diameters for each cell type plus a clearance:
// cells from different makers vary by a few tenths of a millimeter, so the
// presets mark the diameter "verify".

import { bolt, boltParam } from '../core/hardware.js';

const CELLS = { 18650: 18.4, 21700: 21.2, 26650: 26.3, 14500: 14.2, AA: 14.2, AAA: 10.4, 10440: 10.4 };

export const cellHolder = {
  id: 'cell-holder',
  name: 'Battery Cell Holder',
  sections: ['accessories', 'shop', 'robotics'],
  description: 'Holder or pack end plate for cylindrical cells (18650, 21700, 26650, 14500 / AA, AAA or custom): any grid, contact window under each cell, grooves for nickel strip, optional screw ears. Print 2 for a pack (one each end).',
  basic: ['cell', 'columns', 'rows', 'depth', 'stripGrooves'],
  params: {
    cell: { type: 'select', default: '18650', group: 'Cells', label: 'Cell type', options: [...Object.keys(CELLS).map((v) => ({ value: v, label: `${v} (${CELLS[v]} mm)` })), { value: 'custom', label: 'Custom diameter' }] },
    customDiameter: { type: 'number', default: 18.4, min: 5, max: 40, step: 0.05, unit: 'mm', label: 'Custom cell diameter', group: 'Cells' },
    clearance: { type: 'number', default: 0.3, min: 0, max: 1.5, step: 0.05, unit: 'mm', label: 'Clearance (per side)', group: 'Cells', help: 'Measure a few cells: they vary.' },
    columns: { type: 'integer', default: 3, min: 1, max: 12, label: 'Cells across (X)', group: 'Cells' },
    rows: { type: 'integer', default: 1, min: 1, max: 12, label: 'Cells deep (Y)', group: 'Cells' },
    gap: { type: 'number', default: 1.2, min: 0.4, max: 6, step: 0.1, unit: 'mm', label: 'Wall between cells', group: 'Holder' },
    depth: { type: 'number', default: 10, min: 3, max: 70, step: 0.5, unit: 'mm', label: 'Pocket depth', group: 'Holder', help: 'About 10 for a pack end plate, 30+ for a storage holder.' },
    floor: { type: 'number', default: 1.6, min: 0.8, max: 5, step: 0.1, unit: 'mm', label: 'Floor', group: 'Holder' },
    contactWindow: { type: 'number', default: 55, min: 0, max: 85, step: 5, unit: '%', label: 'Contact window (share of cell diameter)', group: 'Holder', help: '0 = closed floor (storage).' },
    stripGrooves: { type: 'boolean', default: true, label: 'Nickel strip grooves under each row', group: 'Holder' },
    stripWidth: { type: 'number', default: 8.5, min: 3, max: 20, step: 0.5, unit: 'mm', label: 'Strip groove width', group: 'Holder' },
    ears: { type: 'boolean', default: false, label: 'Screw ears', group: 'Holder' },
    earBolt: boltParam('Holder', 'M3', 'Ear screws'),
  },
  generate(p, k) {
    const warnings = [];
    const d = (CELLS[p.cell] ?? p.customDiameter) + 2 * p.clearance;
    const pitch = d + p.gap;
    const W = p.columns * pitch + p.gap;
    const D = p.rows * pitch + p.gap;
    const H = p.depth + p.floor;
    const add = [k.roundedBlock(W, D, Math.min(3, p.gap + 1), 0, H, 8)];
    const cuts = [];
    const eb = bolt(p.earBolt);
    if (p.ears) {
      const ear = eb.head + 5;
      for (const s of [-1, 1]) {
        add.push(k.cuboid([ear + 2, Math.min(D, 24), 3], [s * (W / 2 + ear / 2 - 1), 0, 1.5]));
        cuts.push(k.cylZ(eb.clear / 2, s * (W / 2 + ear / 2), 0, -1, 4, 24));
      }
    }
    for (let i = 0; i < p.columns; i++) {
      for (let j = 0; j < p.rows; j++) {
        const x = -W / 2 + p.gap + pitch / 2 + i * pitch - p.gap / 2;
        const y = -D / 2 + p.gap + pitch / 2 + j * pitch - p.gap / 2;
        cuts.push(k.cylZ(d / 2, x, y, p.floor, H + 1, 64));
        if (p.contactWindow > 0) cuts.push(k.cylZ((d * p.contactWindow) / 200, x, y, -1, p.floor + 1, 48));
      }
    }
    if (p.stripGrooves && p.contactWindow > 0) {
      const gd = Math.min(0.6, p.floor - 0.6);
      for (let j = 0; j < p.rows; j++) {
        const y = -D / 2 + p.gap + pitch / 2 + j * pitch - p.gap / 2;
        cuts.push(k.cuboid([W - 2 * p.gap, p.stripWidth, gd * 2], [0, y, 0]));
      }
    }
    if (p.contactWindow === 0 && p.stripGrooves) warnings.push('Strip grooves need a contact window: grooves skipped.');
    const part = k.difference(k.union(add), cuts);
    const n = p.columns * p.rows;
    return {
      parts: [{ name: 'cell-holder', manifold: k.placeOnBed(part) }],
      warnings,
      notes: [`${n} cell${n > 1 ? 's' : ''} (${p.cell === 'custom' ? `${p.customDiameter} mm` : p.cell}), pockets ${d.toFixed(2)} mm, ${W.toFixed(1)} x ${D.toFixed(1)} x ${H.toFixed(1)} mm. For a pack print 2 and join them with the cells.`, 'Spot-weld or use holders with springs; never solder directly to cells.'],
    };
  },
};

export const shaftSupport = {
  id: 'shaft-support',
  name: 'Shaft Support (SK style)',
  sections: ['robotics'],
  description: 'Support block for a smooth rod or shaft (linear rails, axles): rod bore with a pinch slot and screw, base with two mounting holes. Any rod size.',
  basic: ['rod', 'centerHeight', 'width', 'bolt'],
  params: {
    rod: { type: 'number', default: 8, min: 3, max: 30, step: 0.05, unit: 'mm', label: 'Rod diameter', group: 'Support' },
    clearance: { type: 'number', default: 0.1, min: -0.2, max: 0.6, step: 0.05, unit: 'mm', label: 'Bore clearance (per side)', group: 'Support' },
    centerHeight: { type: 'number', default: 20, min: 8, max: 80, step: 0.5, unit: 'mm', label: 'Rod center height', group: 'Support' },
    width: { type: 'number', default: 42, min: 20, max: 120, step: 0.5, unit: 'mm', label: 'Base width', group: 'Support' },
    thickness: { type: 'number', default: 14, min: 6, max: 40, step: 0.5, unit: 'mm', label: 'Block thickness (along the rod)', group: 'Support' },
    base: { type: 'number', default: 5, min: 3, max: 15, step: 0.5, unit: 'mm', label: 'Base thickness', group: 'Support' },
    bolt: boltParam('Support', 'M4', 'Mounting screws'),
    pinch: boltParam('Support', 'M3', 'Pinch screw'),
  },
  generate(p, k) {
    const warnings = [];
    const b = bolt(p.bolt);
    const pb = bolt(p.pinch);
    const r = p.rod / 2 + p.clearance;
    const T = p.thickness;
    const towerW = Math.max(2 * r + 10, p.rod * 1.8 + 6);
    const top = p.centerHeight + r + Math.max(5, pb.head);
    if (p.centerHeight - r < p.base + 1) warnings.push('Rod bore cuts into the base: raise the center height.');
    if (towerW + 2 * (b.head + 3) > p.width) warnings.push('Base is narrow for the screw heads: widen it.');
    // profile in XZ, extruded along Y (rod axis along Y)
    const tower = k.cuboid([towerW, T, top], [0, 0, top / 2]);
    const basePl = k.cuboid([p.width, T, p.base], [0, 0, p.base / 2]);
    const fillets = [-1, 1].map((s) => k.prismY([[s * (towerW / 2 - 0.2), p.base - 0.2], [s * (towerW / 2 + 5), p.base - 0.2], [s * (towerW / 2 - 0.2), p.base + 5]], -T / 2, T / 2));
    const cuts = [
      k.holeY(r, 0, p.centerHeight, -T, T, 64),
      k.cuboid([1.2, T + 2, top - p.centerHeight + 1], [0, 0, (p.centerHeight + top) / 2 + 0.5]), // pinch slot
      k.holeX(pb.clear / 2, 0, p.centerHeight + r + pb.head / 2 + 1, -towerW, towerW, 20),
      k.translate(k.rotate(k.hexZ(pb.nutAF + 0.3, 0, 0, 0, pb.nutH + 0.4), [0, 90, 0]), [towerW / 2 - pb.nutH + 0.01, 0, p.centerHeight + r + pb.head / 2 + 1]),
    ];
    for (const s of [-1, 1]) cuts.push(k.cylZ(b.clear / 2, s * (p.width / 2 - (p.width / 2 - towerW / 2) / 2 - 0.5), 0, -1, p.base + 1, 24));
    const part = k.difference(k.union([tower, basePl, ...fillets]), cuts);
    return {
      parts: [{ name: 'shaft-support', manifold: k.placeOnBed(part) }],
      warnings,
      notes: [`Bore ${(2 * r).toFixed(2)} mm (teardrop top, prints without support), center ${p.centerHeight} mm above the base. ${p.pinch} pinch screw with a nut trap; ${p.bolt} mounting holes.`],
    };
  },
};

export const drawerUnit = {
  id: 'drawer-unit',
  name: 'Drawer Unit (assembly)',
  sections: ['shop'],
  description: 'Small parts cabinet: a housing with 1 to 8 drawers, each drawer with a handle and an optional label slot. Shown assembled; prints as one housing and N drawers.',
  assembly: true,
  basic: ['drawers', 'drawerWidth', 'drawerDepth', 'drawerHeight', 'label'],
  params: {
    drawers: { type: 'integer', default: 3, min: 1, max: 8, label: 'Drawers', group: 'Unit' },
    drawerWidth: { type: 'number', default: 80, min: 30, max: 200, step: 1, unit: 'mm', label: 'Drawer width (outside)', group: 'Unit' },
    drawerDepth: { type: 'number', default: 120, min: 30, max: 200, step: 1, unit: 'mm', label: 'Drawer depth (outside)', group: 'Unit' },
    drawerHeight: { type: 'number', default: 30, min: 12, max: 120, step: 1, unit: 'mm', label: 'Drawer height (outside)', group: 'Unit' },
    clearance: { type: 'number', default: 0.5, min: 0.2, max: 2, step: 0.05, unit: 'mm', label: 'Sliding clearance (per side)', group: 'Unit' },
    wall: { type: 'number', default: 1.6, min: 1, max: 4, step: 0.1, unit: 'mm', label: 'Wall', group: 'Unit' },
    label: { type: 'boolean', default: true, label: 'Label slot on each drawer front', group: 'Unit' },
    dividers: { type: 'integer', default: 0, min: 0, max: 6, label: 'Dividers in each drawer', group: 'Unit' },
  },
  generate(p, k) {
    const warnings = [];
    const t = p.wall;
    const c = p.clearance;
    const DW = p.drawerWidth, DD = p.drawerDepth, DH = p.drawerHeight;
    const shelf = 1.6;
    const pitch = DH + 2 * c + shelf;
    const HW = DW + 2 * c + 2 * t;
    const HD = DD + t; // open front
    const HH = p.drawers * pitch - shelf + 2 * t;
    if (HH > 220) warnings.push('Housing is taller than 220 mm: it lies on its back to print, so check it fits your bed. Use fewer or lower drawers.');
    // housing: box open at the front (-Y), shelves between drawers
    const outer = k.cuboid([HW, HD, HH], [0, HD / 2, HH / 2]);
    const cavities = [];
    for (let i = 0; i < p.drawers; i++) {
      const z0 = t + i * pitch;
      cavities.push(k.cuboid([HW - 2 * t, HD - t + 1, DH + 2 * c], [0, (HD - t) / 2 - 0.5, z0 + (DH + 2 * c) / 2]));
    }
    const housing = k.difference(outer, cavities);
    // drawer (slot 0): front at y = -frontLip, open top
    const lip = 3;
    const dz0 = t + c;
    let drawer = k.difference(k.cuboid([DW, DD, DH], [0, DD / 2 + c, dz0 + DH / 2]), [k.cuboid([DW - 2 * t, DD - 2 * t, DH], [0, DD / 2 + c, dz0 + t + DH / 2])]);
    const front = k.cuboid([HW, lip, DH + 2 * c - 0.4], [0, c - lip / 2 + 0.01, t + 0.2 + (DH + 2 * c - 0.4) / 2]);
    const handle = k.hull([k.cuboid([Math.min(40, DW * 0.5), 0.4, 6], [0, c - lip + 0.2, dz0 + DH / 2]), k.cuboid([Math.min(30, DW * 0.4), 0.4, 3], [0, c - lip - 8, dz0 + DH / 2 + 1.5])]);
    const add = [drawer, front, handle];
    for (let i = 1; i <= p.dividers; i++) add.push(k.cuboid([t, DD - 2 * t + 0.02, DH * 0.8], [-DW / 2 + (i * DW) / (p.dividers + 1), DD / 2 + c, dz0 + t - 0.01 + DH * 0.4]));
    drawer = k.union(add);
    if (p.label && DH >= 18) {
      const lw = Math.min(50, DW * 0.6);
      drawer = k.difference(drawer, [k.cuboid([lw, 1.2, 10], [0, c - lip + 0.5, dz0 + DH - 7])]);
      drawer = k.union([drawer, k.cuboid([lw + 4, 1, 1.2], [0, c - lip - 0.2, dz0 + DH - 12.6])]);
    }
    const a = k.pose(housing, [-90, 0, 0]); // back on the bed, opening up: no support
    const b = k.pose(drawer, [0, 0, 0]);
    return {
      parts: [{ name: 'housing', manifold: a.manifold, assembled: a.assembled }, { name: 'drawer', manifold: b.manifold, assembled: b.assembled, qty: p.drawers }],
      warnings,
      notes: [`Housing ${HW.toFixed(1)} x ${HD.toFixed(1)} x ${HH.toFixed(1)} mm prints on its back. Print the drawer ${p.drawers} time${p.drawers > 1 ? 's' : ''} (the Assembled view shows the first slot).`, `Drawer inside ${(DW - 2 * t).toFixed(1)} x ${(DD - 2 * t).toFixed(1)} mm${p.dividers ? `, ${p.dividers + 1} compartments` : ''}.`],
    };
  },
};

export const spoolHolder = {
  id: 'spool-holder',
  name: 'Spool Holder Arm',
  sections: ['shop'],
  description: 'Wall or bench arm for filament spools, wire reels or tape rolls: wall plate with screw holes, arm sized to the spool hole, end stop. Prints on its side for strength.',
  basic: ['spoolHole', 'spoolWidth', 'spools'],
  params: {
    spoolHole: { type: 'number', default: 52, min: 15, max: 100, step: 0.5, unit: 'mm', label: 'Spool hole diameter', group: 'Spool', help: 'Measure your spool: 1 kg filament spools are often about 52 to 56 mm.' },
    spoolWidth: { type: 'number', default: 70, min: 10, max: 200, step: 1, unit: 'mm', label: 'Spool width', group: 'Spool' },
    spools: { type: 'integer', default: 1, min: 1, max: 4, label: 'Spools on the arm', group: 'Spool' },
    armWidth: { type: 'number', default: 16, min: 8, max: 40, step: 0.5, unit: 'mm', label: 'Arm width (print height)', group: 'Arm' },
    plateHeight: { type: 'number', default: 80, min: 30, max: 200, step: 1, unit: 'mm', label: 'Wall plate height', group: 'Arm' },
    thickness: { type: 'number', default: 6, min: 3, max: 15, step: 0.5, unit: 'mm', label: 'Plate thickness', group: 'Arm' },
    bolt: boltParam('Arm', 'M4', 'Wall screws'),
  },
  generate(p, k) {
    const warnings = [];
    const T = p.thickness;
    const L = p.spools * (p.spoolWidth + 4) + 8;
    const armH = Math.min(p.spoolHole * 0.55, 40);
    const yArm = p.plateHeight * 0.65;
    if (L > 200) warnings.push('Arm is longer than 200 mm: print it diagonally or use fewer spools.');
    // outline in XY (X = out from the wall, Y = up), extruded along Z = arm width
    const outline = [
      [0, 0], [T, 0], [T, yArm - armH / 2 - 12], [T + 12, yArm - armH / 2], [T + L, yArm - armH / 2], [T + L, yArm + armH / 2 + 8],
      [T + L - 5, yArm + armH / 2 + 8], [T + L - 5, yArm + armH / 2], [T, yArm + armH / 2], [T, p.plateHeight], [0, p.plateHeight],
    ];
    const body = k.prismZ(outline, 0, p.armWidth);
    const b = bolt(p.bolt);
    const cuts = [p.plateHeight * 0.18, p.plateHeight * 0.88].map((y) => k.holeX(b.clear / 2, y, p.armWidth / 2, -1, T + 1, 24));
    const part = k.difference(body, cuts);
    return {
      parts: [{ name: 'spool-arm', manifold: k.placeOnBed(part) }],
      warnings,
      notes: [`Arm ${L.toFixed(0)} mm long, ${armH.toFixed(1)} mm tall for a ${p.spoolHole} mm hole, end stop at the tip. Prints lying on its side. 2 x ${p.bolt} wall screws.`],
    };
  },
};

export const droneArm = {
  id: 'drone-arm',
  name: 'Multirotor Arm',
  sections: ['quads'],
  description: 'Printed replacement or test arm: frame end with two bolt holes, motor pad with any motor pattern, lightening slot. For light builds and tests; carbon is stiffer.',
  basic: ['length', 'width', 'thickness', 'motorPatternA', 'motorPatternB', 'frameHoleSpacing'],
  params: {
    length: { type: 'number', default: 110, min: 40, max: 200, step: 1, unit: 'mm', label: 'Frame hole to motor center', group: 'Arm' },
    width: { type: 'number', default: 14, min: 8, max: 40, step: 0.5, unit: 'mm', label: 'Arm width', group: 'Arm' },
    thickness: { type: 'number', default: 6, min: 3, max: 15, step: 0.5, unit: 'mm', label: 'Arm thickness', group: 'Arm' },
    frameHoleSpacing: { type: 'number', default: 16, min: 6, max: 60, step: 0.5, unit: 'mm', label: 'Frame bolt spacing (along the arm)', group: 'Arm' },
    frameBolt: boltParam('Arm', 'M3', 'Frame bolts'),
    padDiameter: { type: 'number', default: 30, min: 14, max: 60, step: 0.5, unit: 'mm', label: 'Motor pad diameter', group: 'Motor' },
    motorPatternA: { type: 'number', default: 16, min: 6, max: 40, step: 0.1, unit: 'mm', label: 'Motor holes A', group: 'Motor' },
    motorPatternB: { type: 'number', default: 19, min: 6, max: 40, step: 0.1, unit: 'mm', label: 'Motor holes B', group: 'Motor' },
    motorBolt: boltParam('Motor', 'M3', 'Motor screws'),
    centerHole: { type: 'number', default: 8, min: 0, max: 20, step: 0.5, unit: 'mm', label: 'Motor center hole', group: 'Motor' },
    lighten: { type: 'boolean', default: true, label: 'Lightening slot', group: 'Arm' },
  },
  generate(p, k) {
    const warnings = [];
    const T = p.thickness;
    const fb = bolt(p.frameBolt);
    const mb = bolt(p.motorBolt);
    const R = p.padDiameter / 2;
    const x0 = -p.frameHoleSpacing / 2 - fb.head;
    const bar = k.hull([k.cuboid([1, p.width, T], [x0 + 0.5, 0, T / 2]), k.cuboid([1, p.width, T], [p.length - R, 0, T / 2])]);
    const pad = k.cylZ(R, p.length, 0, 0, T, 64);
    const cuts = [];
    for (const x of [-p.frameHoleSpacing / 2, p.frameHoleSpacing / 2]) cuts.push(k.cylZ(fb.clear / 2, x, 0, -1, T + 1, 24));
    for (const [x, y] of [[-p.motorPatternA / 2, 0], [p.motorPatternA / 2, 0], [0, -p.motorPatternB / 2], [0, p.motorPatternB / 2]]) {
      const a = Math.PI / 4;
      cuts.push(k.cylZ(mb.clear / 2, p.length + x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), -1, T + 1, 24));
    }
    if (Math.max(p.motorPatternA, p.motorPatternB) / 2 + mb.head / 2 > R) warnings.push('Motor holes are outside the pad: raise the pad diameter.');
    if (p.centerHole > 0) cuts.push(k.cylZ(p.centerHole / 2, p.length, 0, -1, T + 1, 32));
    const slotStart = p.frameHoleSpacing / 2 + fb.head + 4;
    const slotEnd = p.length - R - 4;
    if (p.lighten && slotEnd - slotStart > 15 && p.width >= 12) cuts.push(k.roundedBlock(slotEnd - slotStart, p.width - 7, (p.width - 7) / 2 - 0.1, -1, T + 1, 8).translate([(slotStart + slotEnd) / 2, 0, 0]));
    if (cuts.length && p.lighten) k.track(cuts[cuts.length - 1]);
    const part = k.difference(k.union([bar, pad]), cuts);
    return {
      parts: [{ name: 'arm', manifold: k.placeOnBed(part) }],
      warnings,
      notes: [`Motor center ${p.length} mm from the frame bolts, ${p.motorPatternA} x ${p.motorPatternB} pattern turned 45 degrees. Print 4 (quad) in PETG or nylon, 100% infill near the pad.`],
    };
  },
};

export const drillGuide = {
  id: 'drill-guide',
  name: 'Drill Guide',
  sections: ['shop'],
  description: 'Hand drilling guide: a block with straight guide holes from small to large and an edge fence, so holes go in square to the work. Also a hole-size gauge.',
  basic: ['smallest', 'largest', 'step', 'height'],
  params: {
    smallest: { type: 'number', default: 2, min: 0.8, max: 20, step: 0.1, unit: 'mm', label: 'Smallest hole', group: 'Guide' },
    largest: { type: 'number', default: 8, min: 1, max: 25, step: 0.1, unit: 'mm', label: 'Largest hole', group: 'Guide' },
    step: { type: 'number', default: 1, min: 0.1, max: 5, step: 0.1, unit: 'mm', label: 'Step', group: 'Guide' },
    clearance: { type: 'number', default: 0.15, min: 0, max: 1, step: 0.05, unit: 'mm', label: 'Hole clearance', group: 'Guide' },
    height: { type: 'number', default: 20, min: 6, max: 60, step: 1, unit: 'mm', label: 'Guide height', group: 'Guide', help: 'Taller guides drill straighter.' },
    fence: { type: 'boolean', default: true, label: 'Edge fence', group: 'Guide' },
  },
  generate(p, k) {
    const sizes = [];
    for (let d = p.smallest; d <= p.largest + 1e-6 && sizes.length < 30; d += p.step) sizes.push(Math.round(d * 100) / 100);
    if (!sizes.length) throw new Error('Largest must be at least the smallest size.');
    const gap = 3;
    let x = gap;
    const xs = sizes.map((d) => { const c = x + d / 2; x += d + gap + 1; return c; });
    const L = x + gap;
    const W = Math.max(...sizes) + 2 * gap + 4;
    const add = [k.cuboid([L, W, p.height], [L / 2, 0, p.height / 2])];
    if (p.fence) add.push(k.cuboid([L, 4, p.height + 6], [L / 2, -W / 2 - 2 + 0.01, (p.height + 6) / 2]));
    const cuts = sizes.map((d, i) => k.cylZ(d / 2 + p.clearance, xs[i], 2, -1, p.height + 1, Math.max(24, Math.round(d * 8) | 1)));
    // size marks: one notch per whole millimeter step at the back edge
    sizes.forEach((d, i) => { if (Math.abs(d - Math.round(d)) < 1e-6) cuts.push(k.cuboid([0.8, 2, 1.2], [xs[i], W / 2, p.height])); });
    const part = k.difference(k.union(add), cuts);
    return {
      parts: [{ name: 'drill-guide', manifold: k.placeOnBed(part) }],
      warnings: sizes.length >= 30 ? ['Only the first 30 sizes are used.'] : [],
      notes: [`Holes from left: ${sizes.map((d) => d.toFixed(d % 1 ? 1 : 0)).join(', ')} mm (+${p.clearance} clearance). Notches mark whole millimeters. Print with 4+ walls so the holes stay round.`],
    };
  },
};
