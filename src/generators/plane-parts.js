// RC airplane parts: control horn, servo mount, pin hinge, firewall motor
// mount with thrust angles, fuselage former, wheel.

import { bolt, boltParam, crossPattern, squarePattern, circlePattern } from '../core/hardware.js';

export const controlHorn = {
  id: 'control-horn',
  name: 'Control Horn',
  sections: ['planes', 'robotics'],
  description: 'Control horn for ailerons, elevators and rudders: base plate with screw or glue holes, tapered fin with a row of pushrod holes.',
  params: {
    hornHeight: { type: 'number', default: 18, min: 6, max: 60, step: 0.5, unit: 'mm', label: 'Horn height', group: 'Horn' },
    hornThickness: { type: 'number', default: 2.4, min: 1.2, max: 8, step: 0.1, unit: 'mm', label: 'Fin thickness', group: 'Horn' },
    holes: { type: 'integer', default: 3, min: 1, max: 8, label: 'Pushrod holes', group: 'Horn' },
    holeDiameter: { type: 'number', default: 1.6, min: 0.8, max: 5, step: 0.05, unit: 'mm', label: 'Pushrod hole diameter', group: 'Horn', help: '1.6 for 1.5 mm wire / Z-bends, 2.1 for clevis pins.' },
    holeSpacing: { type: 'number', default: 3.5, min: 2, max: 12, step: 0.1, unit: 'mm', label: 'Hole spacing', group: 'Horn' },
    baseLength: { type: 'number', default: 22, min: 8, max: 60, step: 0.5, unit: 'mm', label: 'Base length', group: 'Base' },
    baseWidth: { type: 'number', default: 10, min: 4, max: 40, step: 0.5, unit: 'mm', label: 'Base width', group: 'Base' },
    baseThickness: { type: 'number', default: 1.6, min: 0.8, max: 6, step: 0.1, unit: 'mm', label: 'Base thickness', group: 'Base' },
    baseHoles: { type: 'integer', default: 2, min: 0, max: 4, label: 'Base screw holes', group: 'Base' },
    baseHole: { type: 'number', default: 2.2, min: 1, max: 5, step: 0.05, unit: 'mm', label: 'Base hole diameter', group: 'Base' },
    count: { type: 'integer', default: 2, min: 1, max: 20, label: 'How many', group: 'Batch' },
  },
  generate(p, k) {
    const warnings = [];
    const T = p.baseThickness;
    const one = () => {
      const top = T + p.hornHeight;
      const L = p.baseLength;
      // fin outline in (y, z): wide at the base, rounded tip carrying the holes
      const tipW = p.holeDiameter + 4;
      const fin = k.prismX([[-L / 2 + 1, T - 0.3], [L / 2 - 1, T - 0.3], [tipW / 2, top - tipW / 2], [0, top], [-tipW / 2, top - tipW / 2]], -p.hornThickness / 2, p.hornThickness / 2);
      const add = [k.roundedBlock(p.baseWidth, L, 1.5, 0, T, 6), fin];
      const cuts = [];
      for (let i = 0; i < p.holes; i++) {
        const z = top - tipW / 2 - 0.6 - i * p.holeSpacing;
        if (z < T + p.holeDiameter + 1.5) { warnings.push('Not all holes fit. Raise hornHeight or lower the hole count.'); break; }
        cuts.push(k.holeX(p.holeDiameter / 2, 0, z, -p.hornThickness, p.hornThickness, 20));
      }
      const bh = p.baseHoles;
      for (let i = 0; i < bh; i++) {
        const y = bh === 1 ? L / 2 - 3 : -L / 2 + 3 + (i * (L - 6)) / (bh - 1);
        const x = bh > 2 ? (i % 2 ? 1 : -1) * (p.baseWidth / 2 - 2.2) : p.baseWidth / 2 - 2.2;
        cuts.push(k.cylZ(p.baseHole / 2, Math.abs(x) < p.hornThickness / 2 + p.baseHole / 2 + 0.5 ? x + p.baseHole : x, y, -1, T + 1, 20));
      }
      return k.difference(k.union(add), cuts);
    };
    const unit = one();
    const pitch = p.baseWidth + 4;
    const copies = Array.from({ length: p.count }, (_, i) => k.translate(unit, [i * pitch, 0, 0]));
    return { parts: [{ name: p.count > 1 ? `horns-x${p.count}` : 'horn', manifold: k.placeOnBed(k.union(copies)) }], warnings: [...new Set(warnings)], notes: ['Prints base-down; the fin is upright so layers run along it. Glue or screw through the base into a hard point.'] };
  },
};

export const servoMount = {
  id: 'servo-mount',
  name: 'Servo Mount',
  sections: ['planes', 'robotics', 'quads'],
  description: 'Servo tray or L-bracket: body cutout plus ear screw holes. Set any servo size (micro, 9 g, standard).',
  params: {
    style: { type: 'select', default: 'tray', group: 'Mount', label: 'Style', options: [{ value: 'tray', label: 'Flat tray (servo drops through)' }, { value: 'bracket', label: 'L-bracket with a base' }] },
    servoLength: { type: 'number', default: 23, min: 8, max: 80, step: 0.1, unit: 'mm', label: 'Servo body length', group: 'Servo', help: 'Measure the body without the ears. 9 g class about 23 x 12.5 mm; standard about 40.5 x 20 mm.' },
    servoWidth: { type: 'number', default: 12.5, min: 4, max: 40, step: 0.1, unit: 'mm', label: 'Servo body width', group: 'Servo' },
    earSpacing: { type: 'number', default: 28, min: 10, max: 80, step: 0.1, unit: 'mm', label: 'Ear screw hole spacing', group: 'Servo', help: '9 g about 27-28 mm, standard about 48-49 mm.' },
    earHole: { type: 'number', default: 1.8, min: 0.8, max: 5, step: 0.05, unit: 'mm', label: 'Ear screw hole', group: 'Servo' },
    clearance: { type: 'number', default: 0.3, min: 0, max: 2, step: 0.05, unit: 'mm', label: 'Body clearance (per side)', group: 'Servo' },
    thickness: { type: 'number', default: 3, min: 1.2, max: 10, step: 0.1, unit: 'mm', label: 'Plate thickness', group: 'Mount' },
    border: { type: 'number', default: 5, min: 2, max: 30, step: 0.5, unit: 'mm', label: 'Border around the cutout', group: 'Mount' },
    baseDepth: { type: 'number', default: 20, min: 6, max: 80, step: 0.5, unit: 'mm', label: 'Bracket base depth', group: 'Mount' },
    baseBolt: boltParam('Mount', 'M3', 'Base screws'),
  },
  generate(p, k) {
    const warnings = [];
    const T = p.thickness;
    const cl = p.servoLength + 2 * p.clearance;
    const cw = p.servoWidth + 2 * p.clearance;
    const L = Math.max(cl + 2 * p.border, p.earSpacing + p.earHole + 2 * p.border * 0.6);
    const W = cw + 2 * p.border;
    if (p.earSpacing - p.earHole < cl) warnings.push('Ear holes fall inside the body cutout. Check earSpacing.');
    if (p.style === 'tray') {
      const plate = k.roundedBlock(L, W, 3, 0, T, 6);
      const cuts = [k.translate(k.extrude(k.roundedRect(cl, cw, 0.8, 4), T + 2), [0, 0, -1])];
      for (const x of [-p.earSpacing / 2, p.earSpacing / 2]) cuts.push(k.cylZ(p.earHole / 2, x, 0, -1, T + 1, 20));
      return { parts: [{ name: 'servo-tray', manifold: k.placeOnBed(k.difference(plate, cuts)) }], warnings, notes: [`Cutout ${cl.toFixed(1)} x ${cw.toFixed(1)} mm, ears ${p.earSpacing} mm. Print flat.`] };
    }
    // L-bracket: upright plate (servo face) along X/Z on a base plate. Printed with the base on the bed.
    const H = W; // plate height = plate width of the tray
    const face = k.cuboid([L, T, H], [0, T / 2, H / 2]);
    const base = k.cuboid([L, p.baseDepth, T], [0, p.baseDepth / 2, T / 2]);
    const gussets = [-L / 2, L / 2 - 2].map((x) => k.prismX([[T - 0.3, T - 0.3], [Math.min(p.baseDepth, H) * 0.8, T - 0.3], [T - 0.3, Math.min(p.baseDepth, H) * 0.8]], x, x + 2));
    const zc = T + (H - T) / 2;
    const cuts = [k.translate(k.rotate(k.extrude(k.roundedRect(cl, cw, 0.8, 4), T + 2), [90, 0, 0]), [0, T + 1, zc])];
    for (const x of [-p.earSpacing / 2, p.earSpacing / 2]) cuts.push(k.holeY(p.earHole / 2, x, zc, -1, T + 1, 20));
    const bb = bolt(p.baseBolt);
    for (const x of [-L / 2 + bb.head, L / 2 - bb.head]) cuts.push(k.cylZ(bb.clear / 2, x, T + (p.baseDepth - T) / 2 + 1, -1, T + 1, 24));
    if (zc - cw / 2 < T + 0.6) warnings.push('Cutout is too close to the base. Raise border.');
    const part = k.difference(k.union([face, base, ...gussets]), cuts);
    return { parts: [{ name: 'servo-bracket', manifold: k.placeOnBed(part) }], warnings, notes: ['Prints base-down; the cutout top bridges. Servo output faces away from the base.'] };
  },
};

export const pinHinge = {
  id: 'pin-hinge',
  name: 'Pin Hinge',
  sections: ['planes', 'robotics', 'shop'],
  description: 'Two-leaf knuckle hinge with a hole for a wire or filament pin. Control surfaces, hatches, lids, robot joints.',
  params: {
    length: { type: 'number', default: 30, min: 8, max: 200, step: 0.5, unit: 'mm', label: 'Hinge length', group: 'Hinge' },
    leafWidth: { type: 'number', default: 10, min: 4, max: 60, step: 0.5, unit: 'mm', label: 'Leaf width', group: 'Hinge' },
    leafThickness: { type: 'number', default: 1.6, min: 0.6, max: 6, step: 0.1, unit: 'mm', label: 'Leaf thickness', group: 'Hinge' },
    knuckles: { type: 'integer', default: 5, min: 3, max: 15, label: 'Knuckles (odd)', group: 'Hinge' },
    knuckleDiameter: { type: 'number', default: 4, min: 2, max: 16, step: 0.1, unit: 'mm', label: 'Knuckle diameter', group: 'Hinge' },
    pinHole: { type: 'number', default: 1.8, min: 0.6, max: 8, step: 0.05, unit: 'mm', label: 'Pin hole', group: 'Hinge', help: '1.8 for 1.75 mm filament pin, 1.1 for 1 mm wire.' },
    gap: { type: 'number', default: 0.4, min: 0.1, max: 2, step: 0.05, unit: 'mm', label: 'Knuckle gap', group: 'Hinge' },
    screwHoles: { type: 'integer', default: 2, min: 0, max: 6, label: 'Screw holes per leaf', group: 'Hinge' },
    screwHole: { type: 'number', default: 2.2, min: 1, max: 5, step: 0.05, unit: 'mm', label: 'Screw hole', group: 'Hinge' },
  },
  generate(p, k) {
    const warnings = [];
    const n = p.knuckles % 2 ? p.knuckles : p.knuckles + 1;
    const R = p.knuckleDiameter / 2;
    const seg = (p.length - (n - 1) * p.gap) / n;
    if (seg < 2) throw new Error('Knuckles are too short. Use fewer knuckles or a longer hinge.');
    if (p.pinHole > p.knuckleDiameter - 1.2) warnings.push('Thin knuckle wall around the pin.');
    const leaf = (side) => {
      // leaf plate along X, knuckle axis along X at y = 0, z = R (knuckle sits on the bed)
      const add = [k.cuboid([p.length, p.leafWidth, p.leafThickness], [0, side * (p.leafWidth / 2 + R * 0.5), p.leafThickness / 2])];
      for (let i = 0; i < n; i++) {
        if ((i % 2 === 0) !== (side === 1)) continue;
        const x0 = -p.length / 2 + i * (seg + p.gap);
        // D-shaped knuckle: flat bottom on the bed, round top
        const prof = [];
        for (let j = 0; j <= 24; j++) { const a = (Math.PI * j) / 24; prof.push([R * Math.cos(a), R + R * Math.sin(a)]); }
        prof.push([-R, 0], [R, 0]);
        add.push(k.prismX(prof, x0, x0 + seg));
      }
      const cuts = [k.holeX(p.pinHole / 2, 0, R, -p.length, p.length, 20)];
      // the other leaf's knuckles need room: clear a gap ring around the axis on this leaf
      for (let i = 0; i < n; i++) {
        if ((i % 2 === 0) === (side === 1)) continue;
        const x0 = -p.length / 2 + i * (seg + p.gap) - p.gap;
        cuts.push(k.prismX([[-R - p.gap, -1], [R + p.gap, -1], [R + p.gap, 2 * R + p.gap], [-R - p.gap, 2 * R + p.gap]], x0, x0 + seg + 2 * p.gap));
      }
      for (let i = 0; i < p.screwHoles; i++) {
        const x = p.screwHoles === 1 ? 0 : -p.length / 2 + 4 + (i * (p.length - 8)) / (p.screwHoles - 1);
        cuts.push(k.cylZ(p.screwHole / 2, x, side * (R + p.leafWidth * 0.55), -1, p.leafThickness + 1, 20));
      }
      return k.difference(k.union(add), cuts);
    };
    return {
      parts: [{ name: 'leaf-a', manifold: k.placeOnBed(leaf(1)) }, { name: 'leaf-b', manifold: k.placeOnBed(leaf(-1)) }],
      warnings,
      notes: [`${n} knuckles, ${p.pinHole} mm pin. Print both leaves flat. Push a piece of filament through and melt the ends.`],
    };
  },
};

export const firewallMount = {
  id: 'firewall-mount',
  name: 'Firewall Motor Mount',
  sections: ['planes'],
  description: 'Motor mount plate for the firewall with built-in down and right thrust angles, motor cross pattern and firewall screws.',
  params: {
    plateSize: { type: 'number', default: 40, min: 15, max: 120, step: 0.5, unit: 'mm', label: 'Plate size (square)', group: 'Plate' },
    minThickness: { type: 'number', default: 4, min: 2, max: 15, step: 0.1, unit: 'mm', label: 'Thickness at the thin edge', group: 'Plate' },
    downThrust: { type: 'number', default: 2, min: 0, max: 8, step: 0.5, unit: 'deg', label: 'Down thrust', group: 'Thrust' },
    rightThrust: { type: 'number', default: 2, min: 0, max: 8, step: 0.5, unit: 'deg', label: 'Right thrust', group: 'Thrust' },
    motorPatternA: { type: 'number', default: 16, min: 4, max: 60, step: 0.1, unit: 'mm', label: 'Motor hole spacing A', group: 'Motor' },
    motorPatternB: { type: 'number', default: 19, min: 4, max: 60, step: 0.1, unit: 'mm', label: 'Motor hole spacing B', group: 'Motor' },
    motorBolt: boltParam('Motor', 'M3', 'Motor screws'),
    centerHole: { type: 'number', default: 10, min: 0, max: 40, step: 0.5, unit: 'mm', label: 'Center hole', group: 'Motor' },
    firewallSpacing: { type: 'number', default: 32, min: 8, max: 110, step: 0.1, unit: 'mm', label: 'Firewall screw spacing (square)', group: 'Firewall' },
    firewallBolt: boltParam('Firewall', 'M3', 'Firewall screws'),
  },
  generate(p, k) {
    const warnings = [];
    const S = p.plateSize;
    const td = Math.tan((p.downThrust * Math.PI) / 180);
    const tr = Math.tan((p.rightThrust * Math.PI) / 180);
    // bed = firewall side. Top face tilted: z = t0 + x*tr + y*td, with t0 so min thickness holds.
    const t0 = p.minThickness + (S / 2) * (tr + td);
    const pts = [];
    for (const x of [-S / 2, S / 2]) for (const y of [-S / 2, S / 2]) pts.push([x, y, 0], [x, y, t0 + x * tr + y * td]);
    const body = k.track(k.Manifold.hull(pts));
    const mb = bolt(p.motorBolt);
    const fb = bolt(p.firewallBolt);
    const cuts = [];
    const H = t0 + S;
    for (const [x, y] of crossPattern(p.motorPatternA, p.motorPatternB)) cuts.push(k.cylZ(mb.clear / 2, x, y, -1, H, 24));
    for (const [x, y] of squarePattern(p.firewallSpacing)) {
      cuts.push(k.cylZ(fb.clear / 2, x, y, -1, H, 24));
      cuts.push(k.cylZ(fb.head / 2 + 0.3, x, y, p.minThickness * 0.5, H, 32)); // counterbore from the motor side
    }
    if (p.centerHole > 0) cuts.push(k.cylZ(p.centerHole / 2, 0, 0, -1, H, 40));
    const near = Math.min(...squarePattern(p.firewallSpacing).flatMap(([x, y]) => crossPattern(p.motorPatternA, p.motorPatternB).map(([a, b]) => Math.hypot(x - a, y - b))));
    if (near < (mb.head + fb.head) / 2 + 0.5) warnings.push('Firewall screws collide with motor screws. Change firewallSpacing.');
    if (p.firewallSpacing / 2 + fb.head / 2 > S / 2) warnings.push('Firewall screws are outside the plate.');
    return {
      parts: [{ name: 'firewall-mount', manifold: k.placeOnBed(k.difference(body, cuts)) }],
      warnings,
      notes: [`${p.downThrust} deg down, ${p.rightThrust} deg right thrust. Firewall side is flat on the bed. Mark the top before fitting: the thick edge goes up and to the left (seen from behind).`],
    };
  },
};

export const fuselageFormer = {
  id: 'fuselage-former',
  name: 'Fuselage Former',
  sections: ['planes'],
  description: 'Bulkhead former: rectangle, rounded box or oval, with lightening cutout, stringer notches and pushrod / wire holes.',
  params: {
    shape: { type: 'select', default: 'rounded', group: 'Shape', label: 'Shape', options: [{ value: 'rect', label: 'Rectangle' }, { value: 'rounded', label: 'Rounded box' }, { value: 'oval', label: 'Oval' }] },
    width: { type: 'number', default: 70, min: 10, max: 400, step: 0.5, unit: 'mm', label: 'Outer width', group: 'Shape' },
    height: { type: 'number', default: 80, min: 10, max: 400, step: 0.5, unit: 'mm', label: 'Outer height', group: 'Shape' },
    cornerRadius: { type: 'number', default: 12, min: 0, max: 100, step: 0.5, unit: 'mm', label: 'Corner radius (rounded box)', group: 'Shape' },
    thickness: { type: 'number', default: 3, min: 1, max: 12, step: 0.1, unit: 'mm', label: 'Thickness', group: 'Shape' },
    rim: { type: 'number', default: 6, min: 0, max: 100, step: 0.5, unit: 'mm', label: 'Rim width (0 = solid)', group: 'Cutouts' },
    stringers: { type: 'integer', default: 4, min: 0, max: 16, label: 'Stringer notches', group: 'Cutouts' },
    stringerSize: { type: 'number', default: 3.2, min: 1, max: 15, step: 0.1, unit: 'mm', label: 'Stringer notch size (square)', group: 'Cutouts' },
    pushrodHoles: { type: 'integer', default: 2, min: 0, max: 6, label: 'Pushrod / wire holes in the bottom rim', group: 'Cutouts' },
    pushrodHole: { type: 'number', default: 3, min: 1, max: 10, step: 0.1, unit: 'mm', label: 'Pushrod hole', group: 'Cutouts' },
  },
  generate(p, k) {
    const warnings = [];
    const T = p.thickness;
    const outline = (w, h, r) => {
      if (p.shape === 'oval') return k.track(k.track(k.CrossSection.circle(0.5, 96)).scale([w, h]));
      return k.roundedRect(w, h, p.shape === 'rect' ? 0 : Math.max(0, r), 10);
    };
    let part = k.extrude(outline(p.width, p.height, p.cornerRadius), T);
    const cuts = [];
    if (p.rim > 0 && p.width > 2 * p.rim + 4 && p.height > 2 * p.rim + 4) {
      cuts.push(k.translate(k.extrude(outline(p.width - 2 * p.rim, p.height - 2 * p.rim, p.cornerRadius - p.rim), T + 2), [0, 0, -1]));
    }
    // stringer notches around the outline (approximated on an ellipse through the outline)
    for (const [x, y] of circlePattern(1, p.stringers, 45)) {
      const ex = x * p.width;
      const ey = y * p.height;
      const n = Math.hypot(ex / p.width, ey / p.height) * 2; // normalize to the outline
      const px = (ex / n) * (p.shape === 'oval' ? 1 : 1.15);
      const py = (ey / n) * (p.shape === 'oval' ? 1 : 1.15);
      const cx = Math.max(-p.width / 2, Math.min(p.width / 2, px));
      const cy = Math.max(-p.height / 2, Math.min(p.height / 2, py));
      cuts.push(k.rotate(k.cuboid([p.stringerSize * 2, p.stringerSize, T + 2], [0, 0, T / 2]), [0, 0, (Math.atan2(cy, cx) * 180) / Math.PI]));
      cuts[cuts.length - 1] = k.translate(cuts[cuts.length - 1], [cx, cy, 0]);
    }
    for (let i = 0; i < p.pushrodHoles; i++) {
      const x = p.pushrodHoles === 1 ? 0 : -p.width / 4 + (i * (p.width / 2)) / (p.pushrodHoles - 1);
      cuts.push(k.cylZ(p.pushrodHole / 2, x, -p.height / 2 + p.rim / 2 + 0.5, -1, T + 1, 20));
    }
    if (p.pushrodHoles && p.rim > 0 && p.rim < p.pushrodHole + 2) warnings.push('Rim is too narrow for pushrod holes. Raise rim.');
    part = k.difference(part, cuts);
    return { parts: [{ name: 'former', manifold: k.placeOnBed(part) }], warnings, notes: [`${p.width} x ${p.height} mm ${p.shape} former. Print flat. Scale width/height per station for a tapered fuselage.`] };
  },
};

export const rcWheel = {
  id: 'rc-wheel',
  name: 'RC Wheel',
  sections: ['planes', 'robotics'],
  description: 'Wheel with rounded tire edge, hub and axle hole, solid or spoked. Print in TPU for grip and bounce, or PLA/PETG with a rubber band tire.',
  params: {
    diameter: { type: 'number', default: 50, min: 10, max: 250, step: 0.5, unit: 'mm', label: 'Wheel diameter', group: 'Wheel' },
    width: { type: 'number', default: 16, min: 4, max: 80, step: 0.5, unit: 'mm', label: 'Width', group: 'Wheel' },
    edgeRadius: { type: 'number', default: 4, min: 0, max: 30, step: 0.5, unit: 'mm', label: 'Tire edge rounding', group: 'Wheel' },
    axleHole: { type: 'number', default: 3.2, min: 0.5, max: 20, step: 0.05, unit: 'mm', label: 'Axle hole', group: 'Hub' },
    hubDiameter: { type: 'number', default: 12, min: 4, max: 60, step: 0.5, unit: 'mm', label: 'Hub diameter', group: 'Hub' },
    hubWidth: { type: 'number', default: 18, min: 4, max: 80, step: 0.5, unit: 'mm', label: 'Hub width', group: 'Hub' },
    style: { type: 'select', default: 'spoked', group: 'Wheel', label: 'Style', options: [{ value: 'solid', label: 'Solid' }, { value: 'spoked', label: 'Spoked (lighter)' }] },
    spokes: { type: 'integer', default: 5, min: 3, max: 12, label: 'Spokes', group: 'Wheel' },
    rimWall: { type: 'number', default: 4, min: 1.2, max: 30, step: 0.2, unit: 'mm', label: 'Rim / tire wall', group: 'Wheel' },
    webThickness: { type: 'number', default: 3, min: 1, max: 20, step: 0.2, unit: 'mm', label: 'Web / spoke thickness', group: 'Wheel' },
  },
  generate(p, k) {
    const warnings = [];
    const R = p.diameter / 2;
    const W = p.width;
    const e = Math.min(p.edgeRadius, W / 2 - 0.5, R / 3);
    // tire body with 45 deg chamfers that approximate a rounded edge, convex so a loft hull works
    const tire = e > 0
      ? k.track(k.Manifold.hull([k.cylZ(R - e, 0, 0, 0, W, 128), k.cylZ(R, 0, 0, e, W - e, 128)]))
      : k.cylZ(R, 0, 0, 0, W, 128);
    let wheel;
    if (p.style === 'solid') {
      wheel = tire;
    } else {
      const ri = R - p.rimWall;
      if (ri < p.hubDiameter / 2 + 3) { warnings.push('Wheel too small for spokes. Made it solid.'); wheel = tire; }
      else {
        const zw = (W - p.webThickness) / 2;
        const rim = k.difference(tire, [k.cylZ(ri, 0, 0, -1, W + 1, 128)]);
        const web = [];
        for (let i = 0; i < p.spokes; i++) web.push(k.rotate(k.cuboid([ri - p.hubDiameter / 4, Math.max(3, p.webThickness * 1.5), p.webThickness], [(ri + p.hubDiameter / 4) / 2, 0, zw + p.webThickness / 2]), [0, 0, (i * 360) / p.spokes]));
        wheel = k.union([rim, ...web]);
      }
    }
    const hubZ0 = (W - p.hubWidth) / 2;
    wheel = k.union([wheel, k.cylZ(p.hubDiameter / 2, 0, 0, Math.min(0, hubZ0), Math.max(W, W - hubZ0), 48)]);
    wheel = k.difference(wheel, [k.cylZ(p.axleHole / 2, 0, 0, -50, 50, 32)]);
    return { parts: [{ name: 'wheel', manifold: k.placeOnBed(wheel) }], warnings, notes: [`${p.diameter} x ${p.width} mm wheel, ${p.axleHole} mm axle. Print flat. Use wheel collars or a printed spacer to hold it on the axle.`] };
  },
};
