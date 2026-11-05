// Small accessory mounts: antenna, zip-tie anchor, FPV camera cage,
// action-cam finger mount, connector panel. Each is a separate generator.

import { bolt, boltParam } from '../core/hardware.js';
import { regularPolygon } from '../core/kernel.js';

const zipSlots = (k, x, z, w, h, y0, y1) => k.cuboid([w, y1 - y0, h], [x, (y0 + y1) / 2, z]);

export const antennaMount = {
  id: 'antenna-mount',
  name: 'Antenna Mount',
  sections: ['accessories', 'quads'],
  description: 'SMA / RP-SMA bulkhead antenna mount, single or V pair, tilted. Screw or zip-tie base.',
  params: {
    count: { type: 'integer', default: 1, min: 1, max: 2, label: 'Antennas (2 = V pair)', group: 'Antenna' },
    holeDiameter: { type: 'number', default: 6.5, min: 2, max: 20, step: 0.05, unit: 'mm', label: 'Connector hole diameter', group: 'Antenna', help: 'SMA bulkhead thread is 1/4 in (6.35 mm). Measure yours.' },
    tilt: { type: 'number', default: 30, min: 0, max: 45, step: 1, unit: 'deg', label: 'Tilt from vertical', group: 'Antenna' },
    vSpacing: { type: 'number', default: 22, min: 10, max: 100, step: 0.5, unit: 'mm', label: 'Spacing (V pair)', group: 'Antenna' },
    bossDiameter: { type: 'number', default: 12, min: 6, max: 40, step: 0.5, unit: 'mm', label: 'Boss diameter', group: 'Antenna' },
    bossHeight: { type: 'number', default: 10, min: 3, max: 50, step: 0.5, unit: 'mm', label: 'Boss height', group: 'Antenna' },
    baseLength: { type: 'number', default: 30, min: 10, max: 120, step: 0.5, unit: 'mm', label: 'Base length (Y)', group: 'Base' },
    baseWidth: { type: 'number', default: 18, min: 8, max: 120, step: 0.5, unit: 'mm', label: 'Base width (X)', group: 'Base' },
    baseThickness: { type: 'number', default: 3, min: 1.5, max: 10, step: 0.1, unit: 'mm', label: 'Base thickness', group: 'Base' },
    baseMount: { type: 'select', default: 'zip', group: 'Base', label: 'Base mount', options: [{ value: 'zip', label: 'Zip-tie slots' }, { value: 'screws', label: '2 screws' }] },
    screwSpacing: { type: 'number', default: 20, min: 5, max: 110, step: 0.1, unit: 'mm', label: 'Screw spacing (Y)', group: 'Base' },
    bolt: boltParam('Base', 'M3', 'Screw'),
  },
  generate(p, k) {
    const warnings = [];
    const T = p.baseThickness;
    const W = p.count === 2 ? Math.max(p.baseWidth, p.vSpacing + p.bossDiameter + 4) : p.baseWidth;
    const add = [k.roundedBlock(W, p.baseLength, 2, 0, T, 6)];
    const cuts = [];
    const bosses = p.count === 2
      ? [{ x: -p.vSpacing / 2, dir: [-Math.sin(p.tilt * Math.PI / 180), 0] }, { x: p.vSpacing / 2, dir: [Math.sin(p.tilt * Math.PI / 180), 0] }]
      : [{ x: 0, dir: [0, -Math.sin(p.tilt * Math.PI / 180)] }];
    const c = Math.cos(p.tilt * Math.PI / 180);
    for (const b of bosses) {
      const top = [b.x + b.dir[0] * (T + p.bossHeight), b.dir[1] * (T + p.bossHeight), (T + p.bossHeight) * c];
      const below = [b.x - b.dir[0] * 3, -b.dir[1] * 3, -3 * c];
      add.push(k.rod(below, top, p.bossDiameter / 2, 48));
      cuts.push(k.rod([below[0] - b.dir[0] * 2, below[1] - b.dir[1] * 2, below[2] - 2 * c], [top[0] + b.dir[0], top[1] + b.dir[1], top[2] + c], p.holeDiameter / 2, 40));
    }
    if (p.baseMount === 'zip') {
      for (const y of [-p.baseLength / 2 + 4, p.baseLength / 2 - 4]) cuts.push(zipSlots(k, 0, T / 2, W + 2, 1.8, y - 2.6, y + 2.6));
      if (T < 2.6) warnings.push('Base is thin for zip-tie slots.');
    } else {
      const bt = bolt(p.bolt);
      for (const y of [-p.screwSpacing / 2, p.screwSpacing / 2]) cuts.push(k.cylZ(bt.clear / 2, 0, y, -1, T + 1, 24));
      if (p.screwSpacing / 2 < p.bossDiameter / 2 + bt.head / 2 && p.count === 1) warnings.push('Screw holes sit under the boss. Increase screwSpacing.');
    }
    let part = k.difference(k.union(add), cuts);
    part = k.intersect(part, k.cuboid([W * 4, p.baseLength * 4, 200], [0, 0, 100])); // trim below the bed
    return {
      parts: [{ name: 'antenna-mount', manifold: k.placeOnBed(part) }],
      warnings,
      notes: [`${p.count} x ${p.holeDiameter} mm hole, ${p.tilt} deg tilt. Print base down as exported. TPU survives crashes better.`],
    };
  },
};

export const zipTieMount = {
  id: 'zip-tie-mount',
  name: 'Zip-Tie Anchor',
  sections: ['accessories', 'quads', 'robotics', 'shop'],
  description: 'Anchor block with a tunnel for zip ties. Screw, double screw or flat (tape/glue) base. Optional cross tunnel.',
  params: {
    tieWidth: { type: 'number', default: 4.8, min: 1.5, max: 15, step: 0.1, unit: 'mm', label: 'Zip-tie width', group: 'Tie' },
    tieThickness: { type: 'number', default: 1.4, min: 0.6, max: 4, step: 0.1, unit: 'mm', label: 'Zip-tie thickness', group: 'Tie' },
    cross: { type: 'boolean', default: false, label: 'Second tunnel at 90 deg', group: 'Tie' },
    size: { type: 'number', default: 16, min: 8, max: 60, step: 0.5, unit: 'mm', label: 'Base size (square)', group: 'Base' },
    height: { type: 'number', default: 9, min: 3, max: 30, step: 0.5, unit: 'mm', label: 'Height', group: 'Base' },
    mount: { type: 'select', default: 'screw', group: 'Base', label: 'Mount', options: [{ value: 'screw', label: 'Center screw (countersunk)' }, { value: 'two', label: 'Two screws' }, { value: 'flat', label: 'Flat (tape / glue)' }] },
    bolt: boltParam('Base', 'M3', 'Screw'),
    count: { type: 'integer', default: 1, min: 1, max: 50, label: 'How many', group: 'Batch' },
  },
  generate(p, k) {
    const warnings = [];
    const b = bolt(p.bolt);
    const S = p.size;
    const tw = p.tieWidth + 0.6;
    const th = p.tieThickness + 0.5;
    // Center screw: head sits on a 1.6 mm seat below the tunnel, driver goes in from the top.
    const seat = 1.6;
    const zt = p.mount === 'screw' ? seat + b.headH + 0.4 : 1.6; // tunnel floor
    const H = Math.max(p.height, zt + th + 1.6);
    if (H > p.height) warnings.push(`Height raised to ${H.toFixed(1)} mm to fit the tunnel${p.mount === 'screw' ? ' over the screw head' : ''}.`);
    const one = () => {
      const block = k.roundedBlock(S, S, 2.5, 0, H, 6);
      const zc = zt + th / 2;
      const cuts = [k.cuboid([tw, S + 2, th], [0, 0, zc])];
      if (p.cross) cuts.push(k.cuboid([S + 2, tw, th], [0, 0, zc]));
      if (p.mount === 'screw') {
        cuts.push(k.cylZ(b.clear / 2, 0, 0, -1, H + 1, 24));
        cuts.push(k.cylZ(b.head / 2 + 0.4, 0, 0, seat, H + 1, 32));
      } else if (p.mount === 'two') {
        const d = S / 2 - b.head / 2 - 1.2;
        const pts = p.cross ? [[-d, -d], [d, d]] : [[-d, 0], [d, 0]];
        if (d - b.head / 2 < tw / 2) warnings.push('Screws overlap the tunnel. Raise size.');
        for (const [x, y] of pts) {
          cuts.push(k.cylZ(b.clear / 2, x, y, -1, H + 1, 24));
          cuts.push(k.coneZ(b.clear / 2, b.head / 2 + 1, x, y, H - (b.head - b.clear) / 2, H + 1, 32));
        }
      }
      return k.difference(block, cuts);
    };
    const unit = one();
    const pitch = S + 3;
    const cols = Math.ceil(Math.sqrt(p.count));
    const copies = Array.from({ length: p.count }, (_, i) => k.translate(unit, [(i % cols) * pitch, Math.floor(i / cols) * pitch, 0]));
    return { parts: [{ name: p.count > 1 ? `x${p.count}` : 'anchor', manifold: k.placeOnBed(k.union(copies)) }], warnings, notes: [`Tunnel ${tw.toFixed(1)} x ${th.toFixed(1)} mm for ${p.tieWidth} mm ties.`] };
  },
};

export const cameraMount = {
  id: 'camera-mount',
  name: 'FPV Camera Cage',
  sections: ['accessories', 'quads'],
  description: 'U-shaped cage for FPV cameras (micro 19 mm, nano 14 mm, full 22 mm) or any box camera with side screws. Base screws or zip ties.',
  params: {
    cameraWidth: { type: 'number', default: 19, min: 8, max: 80, step: 0.1, unit: 'mm', label: 'Camera width (between side screws)', group: 'Camera', help: 'Micro 19, nano 14, full size 22.' },
    clearance: { type: 'number', default: 0.2, min: 0, max: 2, step: 0.05, unit: 'mm', label: 'Side clearance (per side)', group: 'Camera' },
    screwHeight: { type: 'number', default: 11, min: 4, max: 80, step: 0.5, unit: 'mm', label: 'Side screw height above base', group: 'Camera' },
    sideScrew: boltParam('Camera', 'M2', 'Side screw'),
    wall: { type: 'number', default: 2.4, min: 1.2, max: 8, step: 0.1, unit: 'mm', label: 'Side wall thickness', group: 'Cage' },
    depth: { type: 'number', default: 16, min: 6, max: 80, step: 0.5, unit: 'mm', label: 'Cage depth (front to back)', group: 'Cage' },
    baseThickness: { type: 'number', default: 2.4, min: 1.2, max: 8, step: 0.1, unit: 'mm', label: 'Base thickness', group: 'Cage' },
    baseMount: { type: 'select', default: 'screws', group: 'Cage', label: 'Base mount', options: [{ value: 'screws', label: '2 screws' }, { value: 'zip', label: 'Zip-tie slots' }, { value: 'none', label: 'None' }] },
    baseScrewSpacing: { type: 'number', default: 10, min: 0, max: 80, step: 0.1, unit: 'mm', label: 'Base screw spacing (front-back)', group: 'Cage' },
    baseBolt: boltParam('Cage', 'M2', 'Base screw'),
  },
  generate(p, k) {
    const warnings = [];
    const sb = bolt(p.sideScrew);
    const inner = p.cameraWidth + 2 * p.clearance;
    const W = inner + 2 * p.wall;
    const T = p.baseThickness;
    const H = T + p.screwHeight + sb.head / 2 + 3;
    const add = [k.cuboid([W, p.depth, T], [0, 0, T / 2])];
    for (const sx of [-1, 1]) {
      const x0 = sx * (inner / 2 + p.wall / 2);
      // side wall: square bottom, round top around the screw
      const r = p.depth / 2;
      const zc = T + p.screwHeight;
      add.push(k.cuboid([p.wall, p.depth, zc - T + 0.01], [x0, 0, (T + zc) / 2]));
      add.push(k.track(k.track(k.Manifold.cylinder(p.wall, Math.min(r, H - zc), Math.min(r, H - zc), 48, true)).rotate([0, 90, 0]).translate([x0, 0, zc])));
    }
    const cuts = [k.holeX(sb.clear / 2, 0, T + p.screwHeight, -W, W)];
    if (p.baseMount === 'screws') {
      const bb = bolt(p.baseBolt);
      for (const y of [-p.baseScrewSpacing / 2, p.baseScrewSpacing / 2]) cuts.push(k.cylZ(bb.clear / 2, 0, y, -1, T + 1, 24));
    } else if (p.baseMount === 'zip') {
      cuts.push(k.cuboid([inner - 4, 3, T + 2], [0, 0, T / 2]));
    }
    const part = k.difference(k.union(add), cuts);
    if (p.screwHeight < sb.head) warnings.push('Side screw is close to the base.');
    return { parts: [{ name: 'camera-cage', manifold: k.placeOnBed(part) }], warnings, notes: [`Inside width ${inner.toFixed(1)} mm. Print in TPU for crash survival, base down. Tilt the camera on the side screws.`] };
  },
};

export const actionCamMount = {
  id: 'action-cam-mount',
  name: 'Action Cam Finger Mount',
  sections: ['accessories', 'quads'],
  description: 'Finger-style action camera mount (2 or 3 fingers, bolt through) on a base plate, with optional tilt wedge. Defaults follow the common GoPro-style size; check against your camera.',
  params: {
    fingers: { type: 'integer', default: 3, min: 2, max: 3, label: 'Fingers', group: 'Fingers', help: 'Camera usually has 2; the mount it clips into has 3.' },
    fingerThickness: { type: 'number', default: 3, min: 1.5, max: 6, step: 0.05, unit: 'mm', label: 'Finger thickness', group: 'Fingers' },
    gap: { type: 'number', default: 3.2, min: 1.5, max: 6, step: 0.05, unit: 'mm', label: 'Gap between fingers', group: 'Fingers' },
    fingerWidth: { type: 'number', default: 15, min: 8, max: 30, step: 0.5, unit: 'mm', label: 'Finger width', group: 'Fingers' },
    pivotHeight: { type: 'number', default: 12, min: 6, max: 40, step: 0.5, unit: 'mm', label: 'Bolt height above base', group: 'Fingers' },
    holeDiameter: { type: 'number', default: 5.3, min: 2, max: 10, step: 0.05, unit: 'mm', label: 'Bolt hole', group: 'Fingers' },
    nutRecess: { type: 'boolean', default: true, label: 'Hex nut recess on one side', group: 'Fingers' },
    nutAF: { type: 'number', default: 8, min: 3, max: 16, step: 0.1, unit: 'mm', label: 'Nut across flats', group: 'Fingers' },
    tilt: { type: 'number', default: 0, min: 0, max: 40, step: 1, unit: 'deg', label: 'Tilt wedge angle', group: 'Base' },
    baseLength: { type: 'number', default: 30, min: 15, max: 120, step: 0.5, unit: 'mm', label: 'Base length (Y)', group: 'Base' },
    baseWidth: { type: 'number', default: 24, min: 12, max: 120, step: 0.5, unit: 'mm', label: 'Base width (X)', group: 'Base' },
    baseThickness: { type: 'number', default: 3, min: 1.5, max: 10, step: 0.1, unit: 'mm', label: 'Base thickness', group: 'Base' },
    baseMount: { type: 'select', default: 'zip', group: 'Base', label: 'Base mount', options: [{ value: 'zip', label: 'Zip-tie / strap slots' }, { value: 'screws', label: '4 screws' }, { value: 'none', label: 'None (glue / tape)' }] },
    baseHoleSpacing: { type: 'number', default: 20, min: 5, max: 110, step: 0.1, unit: 'mm', label: 'Base hole spacing (square)', group: 'Base' },
    baseBolt: boltParam('Base', 'M3', 'Base screw'),
  },
  generate(p, k) {
    const warnings = [];
    const T = p.baseThickness;
    const n = p.fingers;
    const span = n * p.fingerThickness + (n - 1) * p.gap;
    const W = Math.max(p.baseWidth, span + 6);
    const add = [k.roundedBlock(W, p.baseLength, 2.5, 0, T, 6)];
    const wedgeH = Math.tan((p.tilt * Math.PI) / 180) * p.fingerWidth;
    const fz = T + wedgeH;
    const r = p.fingerWidth / 2;
    const zc = fz + p.pivotHeight;
    const fingersOnly = [];
    for (let i = 0; i < n; i++) {
      const x0 = -span / 2 + i * (p.fingerThickness + p.gap);
      const prof = [];
      for (let j = 0; j <= 24; j++) {
        const a = Math.PI * (j / 24);
        prof.push([r * Math.cos(a), zc + r * Math.sin(a)]);
      }
      prof.push([-r, T - 0.5], [r, T - 0.5]);
      fingersOnly.push(k.prismX(prof, x0, x0 + p.fingerThickness));
    }
    if (wedgeH > 0.1) {
      const wedge = k.prismX([[-r, T - 0.5], [r, T - 0.5], [r, fz + 0.01], [-r, T - 0.5 + 0.01]], -span / 2, span / 2);
      fingersOnly.push(wedge);
    }
    let fingers = k.union(fingersOnly);
    const cuts = [k.holeX(p.holeDiameter / 2, 0, zc, -span, span)];
    if (p.nutRecess) {
      const R = (p.nutAF + 0.3) / Math.sqrt(3);
      cuts.push(k.prismX(regularPolygon(R, 6, 0).map(([a, b]) => [a, zc + b]), span / 2 - 1.5, span / 2 + 1));
      if (p.fingerThickness < 2.5) warnings.push('Thin fingers: the nut recess weakens the outer finger.');
    }
    fingers = k.difference(fingers, cuts);
    const baseCuts = [];
    if (p.baseMount === 'zip') {
      for (const y of [-p.baseLength / 2 + 3.5, p.baseLength / 2 - 3.5]) baseCuts.push(k.cuboid([W - 6, 3, T + 2], [0, y, T / 2]));
      if (p.baseLength < p.fingerWidth + 12) warnings.push('Base is short: strap slots may hit the fingers. Raise baseLength.');
    } else if (p.baseMount === 'screws') {
      const bb = bolt(p.baseBolt);
      const h = p.baseHoleSpacing / 2;
      for (const [x, y] of [[-h, -h], [h, -h], [h, h], [-h, h]]) baseCuts.push(k.cylZ(bb.clear / 2, x, y, -1, T + 1, 24));
      if (h - bb.head / 2 < span / 2 && h - bb.head / 2 < r) warnings.push('Base screws may sit under the fingers.');
    }
    const base = k.difference(k.union(add), baseCuts);
    const part = k.union([base, fingers]);
    return {
      parts: [{ name: 'finger-mount', manifold: k.placeOnBed(part) }],
      warnings,
      notes: [`${n} fingers ${p.fingerThickness} mm, gaps ${p.gap} mm, ${p.holeDiameter} mm bolt. Fingers print upright; test the fit with your camera before flying.`],
    };
  },
};

export const connectorMount = {
  id: 'connector-mount',
  name: 'Connector / Switch Panel',
  sections: ['accessories', 'quads', 'robotics', 'planes'],
  description: 'Panel plate with a rectangular or round cutout for a connector, switch or port, plus mounting holes. Measure your part for the cutout.',
  params: {
    cutoutShape: { type: 'select', default: 'rect', group: 'Cutout', label: 'Cutout', options: [{ value: 'rect', label: 'Rectangle' }, { value: 'round', label: 'Round' }] },
    cutoutWidth: { type: 'number', default: 16, min: 1, max: 150, step: 0.05, unit: 'mm', label: 'Cutout width / diameter', group: 'Cutout' },
    cutoutHeight: { type: 'number', default: 8.5, min: 1, max: 150, step: 0.05, unit: 'mm', label: 'Cutout height', group: 'Cutout' },
    cutoutRadius: { type: 'number', default: 1, min: 0, max: 20, step: 0.1, unit: 'mm', label: 'Cutout corner radius', group: 'Cutout' },
    clearance: { type: 'number', default: 0.2, min: 0, max: 2, step: 0.05, unit: 'mm', label: 'Clearance (per side)', group: 'Cutout' },
    plateWidth: { type: 'number', default: 36, min: 6, max: 200, step: 0.5, unit: 'mm', label: 'Plate width', group: 'Plate' },
    plateHeight: { type: 'number', default: 18, min: 6, max: 200, step: 0.5, unit: 'mm', label: 'Plate height', group: 'Plate' },
    thickness: { type: 'number', default: 2.4, min: 0.8, max: 10, step: 0.1, unit: 'mm', label: 'Plate thickness', group: 'Plate' },
    holeSpacing: { type: 'number', default: 28, min: 0, max: 190, step: 0.1, unit: 'mm', label: 'Hole spacing (0 = no holes)', group: 'Plate' },
    bolt: boltParam('Plate', 'M2', 'Screw'),
  },
  generate(p, k) {
    const warnings = [];
    const b = bolt(p.bolt);
    const T = p.thickness;
    const plate = k.roundedBlock(p.plateWidth, p.plateHeight, 2, 0, T, 6);
    const cw = p.cutoutWidth + 2 * p.clearance;
    const ch = p.cutoutHeight + 2 * p.clearance;
    const cs = p.cutoutShape === 'round' ? k.track(k.CrossSection.circle(cw / 2, 64)) : k.roundedRect(cw, ch, p.cutoutRadius, 6);
    const cuts = [k.translate(k.extrude(cs, T + 2), [0, 0, -1])];
    if (p.holeSpacing > 0) for (const x of [-p.holeSpacing / 2, p.holeSpacing / 2]) cuts.push(k.cylZ(b.clear / 2, x, 0, -1, T + 1, 24));
    if (p.holeSpacing > 0 && p.holeSpacing / 2 - b.clear / 2 < cw / 2 + 1) warnings.push('Holes overlap the cutout. Increase holeSpacing.');
    if (cw + 2 > p.plateWidth || ch + 2 > p.plateHeight) warnings.push('Cutout is bigger than the plate.');
    return { parts: [{ name: 'panel', manifold: k.placeOnBed(k.difference(plate, cuts)) }], warnings, notes: [`Cutout ${cw.toFixed(2)} x ${(p.cutoutShape === 'round' ? cw : ch).toFixed(2)} mm.`] };
  },
};
