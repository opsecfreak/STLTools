// Robotics and mechanism parts: gears, racks, pulleys, stepper and bearing
// mounts, shaft couplers, link bars, knobs, electronics enclosures.

import { bolt, boltParam, squarePattern } from '../core/hardware.js';

const DEG = Math.PI / 180;

// ---------- shaft bores shared by gears, pulleys, couplers, knobs ----------

export function boreParams(group = 'Bore', def = 5) {
  return {
    bore: { type: 'number', default: def, min: 0, max: 60, step: 0.05, unit: 'mm', label: 'Bore diameter (0 = none)', group },
    boreType: { type: 'select', default: 'round', group, label: 'Bore type', options: [{ value: 'round', label: 'Round' }, { value: 'd', label: 'D-shaft (one flat)' }, { value: 'hex', label: 'Hex (bore = across flats)' }] },
    dFlat: { type: 'number', default: 0.5, min: 0.1, max: 5, step: 0.05, unit: 'mm', label: 'D-flat depth', group, help: '5 mm stepper shafts: 0.5 mm.' },
    boreClearance: { type: 'number', default: 0.1, min: -0.2, max: 1, step: 0.05, unit: 'mm', label: 'Bore clearance (per side)', group },
  };
}

/** Bore cutter along Z from z0 to z1. */
export function boreCut(k, p, z0, z1) {
  if (p.bore <= 0) return null;
  const r = p.bore / 2 + p.boreClearance;
  if (p.boreType === 'hex') return k.hexZ(2 * r, 0, 0, z0, z1, 0);
  const circle = k.cylZ(r, 0, 0, z0, z1, 48);
  if (p.boreType === 'd') return k.difference(circle, [k.cuboid([4 * r, 2 * r, z1 - z0 + 2], [0, r - p.dFlat + r, (z0 + z1) / 2])]);
  return circle;
}

// ---------- involute gear outline ----------

/** Involute spur gear outline (CCW points). Module m, z teeth, pressure angle pa (deg), backlash (mm). */
export function gearOutline(m, z, pa = 20, backlash = 0.1, flankSteps = 8) {
  const alpha = pa * DEG;
  const r = (m * z) / 2;
  const rb = r * Math.cos(alpha);
  const ra = r + m;
  const rf = Math.max(r - 1.25 * m, 0.5);
  const inv = (x) => Math.tan(x) - x;
  const halfAt = (rho) => {
    // half tooth angle at radius rho (thinned for backlash)
    const a = Math.acos(Math.min(1, rb / rho));
    return Math.PI / (2 * z) + inv(alpha) - inv(a) - backlash / (4 * r);
  };
  const pts = [];
  const rStart = Math.max(rb, rf);
  for (let i = 0; i < z; i++) {
    const c = (2 * Math.PI * i) / z;
    const flank = [];
    for (let j = 0; j <= flankSteps; j++) {
      const rho = rStart + ((ra - rStart) * j) / flankSteps;
      flank.push([rho, Math.max(halfAt(rho), 0.002)]);
    }
    const hb = flank[0][1];
    // root (radial line below the base circle), right flank up, tip land, left flank down
    if (rf < rStart) pts.push([rf * Math.cos(c - hb), rf * Math.sin(c - hb)]);
    for (const [rho, h] of flank) pts.push([rho * Math.cos(c - h), rho * Math.sin(c - h)]);
    for (let j = flank.length - 1; j >= 0; j--) { const [rho, h] = flank[j]; pts.push([rho * Math.cos(c + h), rho * Math.sin(c + h)]); }
    if (rf < rStart) pts.push([rf * Math.cos(c + hb), rf * Math.sin(c + hb)]);
    // root arc to the next tooth
    const next = (2 * Math.PI * (i + 1)) / z;
    for (let j = 1; j < 4; j++) {
      const a = c + hb + ((next - hb - (c + hb)) * j) / 4;
      pts.push([rf * Math.cos(a), rf * Math.sin(a)]);
    }
  }
  return { pts, r, ra, rf, rb };
}

export const gear = {
  id: 'gear',
  name: 'Gear / Rack',
  sections: ['robotics'],
  description: 'Involute spur, helical or herringbone gear, or a matching rack. Module, tooth count, pressure angle, backlash, bore (round / D / hex), hub with set screw.',
  params: {
    type: { type: 'select', default: 'spur', group: 'Gear', label: 'Type', options: [{ value: 'spur', label: 'Spur' }, { value: 'helical', label: 'Helical' }, { value: 'herringbone', label: 'Herringbone' }, { value: 'rack', label: 'Rack (straight)' }] },
    module: { type: 'number', default: 1.5, min: 0.3, max: 10, step: 0.05, unit: 'mm', label: 'Module', group: 'Gear', help: 'Tooth size. Mating gears need the same module. 1-2 for printed gears.' },
    teeth: { type: 'integer', default: 20, min: 6, max: 200, label: 'Teeth (rack: tooth count)', group: 'Gear' },
    pressureAngle: { type: 'number', default: 20, min: 14.5, max: 30, step: 0.5, unit: 'deg', label: 'Pressure angle', group: 'Gear' },
    thickness: { type: 'number', default: 8, min: 1, max: 100, step: 0.5, unit: 'mm', label: 'Face width', group: 'Gear' },
    helixAngle: { type: 'number', default: 20, min: 0, max: 45, step: 1, unit: 'deg', label: 'Helix angle (helical / herringbone)', group: 'Gear' },
    backlash: { type: 'number', default: 0.15, min: 0, max: 1, step: 0.01, unit: 'mm', label: 'Backlash', group: 'Gear' },
    ...boreParams('Bore', 5),
    hubDiameter: { type: 'number', default: 0, min: 0, max: 100, step: 0.5, unit: 'mm', label: 'Hub diameter (0 = none)', group: 'Hub' },
    hubHeight: { type: 'number', default: 6, min: 1, max: 60, step: 0.5, unit: 'mm', label: 'Hub height', group: 'Hub' },
    setScrew: { type: 'number', default: 2.6, min: 0, max: 6, step: 0.1, unit: 'mm', label: 'Hub set screw hole (0 = none)', group: 'Hub' },
    lighten: { type: 'boolean', default: false, label: 'Lightening holes (large gears)', group: 'Gear' },
    rackHeight: { type: 'number', default: 8, min: 2, max: 50, step: 0.5, unit: 'mm', label: 'Rack body height below the teeth', group: 'Rack' },
  },
  generate(p, k) {
    const warnings = [];
    const notes = [];
    const m = p.module;
    if (p.type === 'rack') {
      // straight-sided rack teeth at the pressure angle, pitch line at y = 0
      const pitch = Math.PI * m;
      const t = Math.tan(p.pressureAngle * DEG);
      const add = m, ded = 1.25 * m;
      const half = pitch / 4 - p.backlash / 4;
      const L = pitch * p.teeth;
      const teeth = [];
      for (let i = 0; i < p.teeth; i++) {
        const c = -L / 2 + pitch * (i + 0.5);
        teeth.push([c - half - ded * t, -ded], [c - half + add * t, add], [c + half - add * t, add], [c + half + ded * t, -ded]);
      }
      const outline = [[-L / 2, -ded - p.rackHeight], [-L / 2, -ded], ...teeth, [L / 2, -ded], [L / 2, -ded - p.rackHeight]];
      const rack = k.extrude(k.polygon(outline), p.thickness);
      notes.push(`Rack: ${p.teeth} teeth, module ${m}, ${L.toFixed(1)} mm long. Pitch line ${(ded + p.rackHeight).toFixed(2)} mm above the back. Print flat.`);
      return { parts: [{ name: 'rack', manifold: k.placeOnBed(rack) }], warnings, notes };
    }
    const g = gearOutline(m, p.teeth, p.pressureAngle, p.backlash);
    if (p.teeth < 17) warnings.push(`${p.teeth} teeth at ${p.pressureAngle} deg undercut a real gear; this model has no undercut, so check mesh with the mating gear.`);
    const cs = k.polygon(g.pts);
    const H = p.thickness;
    let body;
    const twistDeg = (h) => ((h * Math.tan(p.helixAngle * DEG)) / g.r) / DEG;
    if (p.type === 'spur' || p.helixAngle === 0) body = k.extrude(cs, H);
    else if (p.type === 'helical') body = k.track(k.Manifold.extrude(cs, H, Math.ceil(H / 0.5), twistDeg(H)));
    else {
      const h2 = H / 2;
      const low = k.track(k.Manifold.extrude(cs, h2, Math.ceil(h2 / 0.5), twistDeg(h2)));
      const highRaw = k.track(k.Manifold.extrude(cs, h2, Math.ceil(h2 / 0.5), -twistDeg(h2)));
      const high = k.translate(k.rotate(highRaw, [0, 0, -twistDeg(h2)]), [0, 0, h2 - 0.001]);
      body = k.union([low, high]);
    }
    const add = [body];
    const top = p.hubDiameter > 0 ? H + p.hubHeight : H;
    if (p.hubDiameter > 0) add.push(k.cylZ(p.hubDiameter / 2, 0, 0, H - 0.5, top, 48));
    const cuts = [];
    const b = boreCut(k, p, -1, top + 1);
    if (b) cuts.push(b);
    if (p.hubDiameter > 0 && p.setScrew > 0) cuts.push(k.holeX(p.setScrew / 2, 0, H + p.hubHeight / 2, 0, p.hubDiameter, 20));
    if (p.lighten) {
      const inner = g.rf - 3;
      const hubR = Math.max(p.hubDiameter / 2, p.bore / 2 + 3) + 2;
      if (inner - hubR > 6) {
        const rr = (inner - hubR) / 2;
        for (let i = 0; i < 6; i++) {
          const a = (i * 60) * DEG;
          cuts.push(k.cylZ(rr * 0.85, (hubR + rr) * Math.cos(a), (hubR + rr) * Math.sin(a), -1, H + 1, 40));
        }
      }
    }
    const part = k.difference(k.union(add), cuts);
    notes.push(`Pitch diameter ${(2 * g.r).toFixed(2)} mm, outside ${(2 * g.ra).toFixed(2)} mm. Center distance to a ${p.teeth}-tooth mate: ${(m * p.teeth).toFixed(2)} mm (m x (z1 + z2) / 2).`);
    if (p.type === 'herringbone') notes.push('Herringbone: prints without support and runs without axial thrust.');
    if (p.type === 'helical') notes.push(`Helical: the mate needs the same helix angle, opposite hand.`);
    return { parts: [{ name: `gear-${p.teeth}t`, manifold: k.placeOnBed(part) }], warnings, notes };
  },
};

export const pulley = {
  id: 'pulley',
  name: 'Timing Pulley / Idler',
  sections: ['robotics'],
  description: 'GT2-style 2 mm pitch timing pulley (approximate tooth shape) or smooth idler, with flanges, hub, bore and set screw.',
  params: {
    type: { type: 'select', default: 'gt2', group: 'Pulley', label: 'Type', options: [{ value: 'gt2', label: 'GT2-style toothed (2 mm pitch)' }, { value: 'smooth', label: 'Smooth idler' }] },
    teeth: { type: 'integer', default: 20, min: 10, max: 120, label: 'Teeth', group: 'Pulley' },
    beltWidth: { type: 'number', default: 6, min: 2, max: 30, step: 0.5, unit: 'mm', label: 'Belt width', group: 'Pulley' },
    toothFit: { type: 'number', default: 0, min: -0.3, max: 0.3, step: 0.01, unit: 'mm', label: 'Diameter tweak', group: 'Pulley', help: 'Tune if the belt rides loose (+) or tight (-).' },
    smoothDiameter: { type: 'number', default: 12, min: 4, max: 120, step: 0.1, unit: 'mm', label: 'Idler diameter (smooth)', group: 'Pulley' },
    flangeHeight: { type: 'number', default: 1.2, min: 0, max: 6, step: 0.1, unit: 'mm', label: 'Flange height above the teeth', group: 'Pulley' },
    flangeThickness: { type: 'number', default: 1, min: 0.6, max: 4, step: 0.1, unit: 'mm', label: 'Flange thickness', group: 'Pulley' },
    ...boreParams('Bore', 5),
    hubDiameter: { type: 'number', default: 14, min: 0, max: 60, step: 0.5, unit: 'mm', label: 'Hub diameter (0 = none)', group: 'Hub' },
    hubHeight: { type: 'number', default: 7, min: 1, max: 40, step: 0.5, unit: 'mm', label: 'Hub height', group: 'Hub' },
    setScrew: { type: 'number', default: 2.6, min: 0, max: 6, step: 0.1, unit: 'mm', label: 'Set screw hole (0 = none)', group: 'Hub' },
  },
  generate(p, k) {
    const warnings = [];
    let rOut, profile;
    if (p.type === 'gt2') {
      // 2 mm pitch: pitch diameter = z * 2 / pi; outside diameter = PD - 0.508 (belt pitch line offset)
      const pd = (p.teeth * 2) / Math.PI;
      rOut = (pd - 0.508) / 2 + p.toothFit / 2;
      const cs = k.track(k.CrossSection.circle(rOut, Math.max(96, p.teeth * 6)));
      // grooves: round-bottom teeth, 0.75 mm deep, about 1.1 mm wide
      const grooves = [];
      for (let i = 0; i < p.teeth; i++) {
        const a = (i * 2 * Math.PI) / p.teeth;
        const gc = rOut - 0.75 + 0.55;
        grooves.push(k.track(k.track(k.CrossSection.circle(0.55, 16)).translate([gc * Math.cos(a), gc * Math.sin(a)])));
      }
      profile = k.track(k.CrossSection.difference([cs, ...grooves]));
      warnings.push('GT2 tooth shape is approximate. Test-fit a belt before printing many.');
    } else {
      rOut = p.smoothDiameter / 2;
      profile = k.track(k.CrossSection.circle(rOut, 96));
    }
    const fT = p.flangeThickness;
    const rF = rOut + p.flangeHeight;
    const W = p.beltWidth + 0.6;
    const add = [];
    let z = 0;
    if (p.flangeHeight > 0) { add.push(k.cylZ(rF, 0, 0, 0, fT, 96)); z = fT; }
    add.push(k.translate(k.extrude(profile, W + 0.02), [0, 0, z - 0.01]));
    z += W;
    if (p.flangeHeight > 0) {
      // top flange flares at 45 deg so it prints without support
      add.push(k.coneZ(rOut - 0.8, rF, 0, 0, z - 0.01, z + p.flangeHeight + 0.8 - 0.01, 96));
      add.push(k.cylZ(rF, 0, 0, z + p.flangeHeight + 0.8 - 0.02, z + p.flangeHeight + 0.8 + fT * 0.5, 96));
      z += p.flangeHeight + 0.8 + fT * 0.5;
    }
    let top = z;
    if (p.hubDiameter > 0) { add.push(k.cylZ(p.hubDiameter / 2, 0, 0, z - 0.01, z + p.hubHeight, 48)); top = z + p.hubHeight; }
    const cuts = [];
    const b = boreCut(k, p, -1, top + 1);
    if (b) cuts.push(b);
    if (p.hubDiameter > 0 && p.setScrew > 0) cuts.push(k.holeX(p.setScrew / 2, 0, top - p.hubHeight / 2, 0, p.hubDiameter, 20));
    if (p.bore / 2 + 1 > rOut - 1) warnings.push('Bore is too big for this pulley.');
    return { parts: [{ name: 'pulley', manifold: k.placeOnBed(k.difference(k.union(add), cuts)) }], warnings, notes: [`${p.type === 'gt2' ? `${p.teeth}T GT2-style, OD ${(2 * rOut).toFixed(2)} mm` : `Idler ${p.smoothDiameter} mm`}, ${p.beltWidth} mm belt. Prints flange-down, hub up.`] };
  },
};

// NEMA ICS 16 face dimensions (hole spacing, pilot diameter, screw size). Check your motor's datasheet.
const NEMA = {
  nema11: { spacing: 23, pilot: 22, screw: 'M2.5', face: 28.2 },
  nema14: { spacing: 26, pilot: 22, screw: 'M3', face: 35.2 },
  nema17: { spacing: 31, pilot: 22, screw: 'M3', face: 42.3 },
  nema23: { spacing: 47.14, pilot: 38.1, screw: 'M5', face: 56.4 },
};

export const stepperMount = {
  id: 'stepper-mount',
  name: 'Stepper Motor Mount',
  sections: ['robotics'],
  description: 'NEMA 11 / 14 / 17 / 23 stepper mount: flat face plate or L-bracket with slotted base and gussets.',
  params: {
    size: { type: 'select', default: 'nema17', group: 'Motor', label: 'Motor size', options: Object.keys(NEMA).map((v) => ({ value: v, label: v.toUpperCase().replace('NEMA', 'NEMA ') })) },
    pilotClearance: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.05, unit: 'mm', label: 'Pilot hole clearance (per side)', group: 'Motor' },
    style: { type: 'select', default: 'bracket', group: 'Mount', label: 'Style', options: [{ value: 'plate', label: 'Face plate' }, { value: 'bracket', label: 'L-bracket' }] },
    thickness: { type: 'number', default: 5, min: 2, max: 15, step: 0.5, unit: 'mm', label: 'Plate thickness', group: 'Mount' },
    baseDepth: { type: 'number', default: 40, min: 15, max: 120, step: 1, unit: 'mm', label: 'Bracket base depth', group: 'Mount' },
    baseSlotLength: { type: 'number', default: 8, min: 0, max: 40, step: 0.5, unit: 'mm', label: 'Base slot length (belt tension, 0 = holes)', group: 'Mount' },
    baseBolt: boltParam('Mount', 'M4', 'Base screws'),
    plateMargin: { type: 'number', default: 4, min: 0, max: 30, step: 0.5, unit: 'mm', label: 'Extra margin around the face', group: 'Mount' },
  },
  generate(p, k) {
    const warnings = [];
    const n = NEMA[p.size];
    const sb = bolt(n.screw);
    const T = p.thickness;
    const S = n.face + 2 * p.plateMargin;
    const holes = squarePattern(n.spacing);
    const pilotR = n.pilot / 2 + p.pilotClearance;
    if (p.style === 'plate') {
      const cuts = [k.cylZ(pilotR, 0, 0, -1, T + 1, 64), ...holes.map(([x, y]) => k.cylZ(sb.clear / 2, x, y, -1, T + 1, 24))];
      return { parts: [{ name: 'stepper-plate', manifold: k.placeOnBed(k.difference(k.roundedBlock(S, S, 4, 0, T, 8), cuts)) }], warnings, notes: [`${p.size.toUpperCase()}: ${n.spacing} mm holes (${n.screw}), ${n.pilot} mm pilot. Verify against your motor.`] };
    }
    // L-bracket: face plate in the X/Z plane (motor on the -Y side), base on the bed toward +Y
    const H = S + T;
    const face = k.cuboid([S, T, H], [0, T / 2, H / 2]);
    const base = k.cuboid([S, p.baseDepth, T], [0, p.baseDepth / 2, T / 2]);
    const gH = Math.min(p.baseDepth, H) * 0.75;
    const gussets = [-S / 2, S / 2 - T].map((x) => k.prismX([[T - 0.3, T - 0.3], [gH, T - 0.3], [T - 0.3, gH]], x, x + T));
    const zc = T + S / 2;
    const cuts = [k.holeY(pilotR, 0, zc, -1, T + 1, 64)];
    for (const [x, y] of holes) cuts.push(k.holeY(sb.clear / 2, x, zc + y, -1, T + 1, 20));
    const bb = bolt(p.baseBolt);
    for (const x of [-S / 4, S / 4]) {
      const y0 = T + 6 + bb.head / 2;
      const y1 = Math.min(p.baseDepth - bb.head / 2 - 2, y0 + p.baseSlotLength);
      cuts.push(k.translate(k.extrude(k.roundedRect(bb.clear, Math.max(bb.clear, y1 - y0 + bb.clear), bb.clear / 2 - 0.01, 6), T + 2), [x, (y0 + y1) / 2, -1]));
    }
    if (zc - pilotR < T + 1) warnings.push('Pilot hole is too close to the base.');
    const part = k.difference(k.union([face, base, ...gussets]), cuts);
    return { parts: [{ name: 'stepper-bracket', manifold: k.placeOnBed(part) }], warnings, notes: [`${p.size.toUpperCase()}: ${n.spacing} mm holes (${n.screw}), ${n.pilot} mm pilot, shaft ${zc.toFixed(1)} mm above the base. Prints base-down; holes in the face are teardrops.`] };
  },
};

// ISO standard bearing sizes (bore x OD x width, mm). LM*UU are linear bearings.
const BEARINGS = {
  '608': { od: 22, id: 8, w: 7 }, '625': { od: 16, id: 5, w: 5 }, '623': { od: 10, id: 3, w: 4 },
  '688': { od: 16, id: 8, w: 5 }, '6000': { od: 26, id: 10, w: 8 }, '6001': { od: 28, id: 12, w: 8 },
  'LM8UU': { od: 15, id: 8, w: 24 },
  // v7: thin-section 68xx (PTZ uses 6801 and 6806), more 6xx / 60xx / 62xx, miniature, linear
  '6801': { od: 21, id: 12, w: 5 }, '6806': { od: 42, id: 30, w: 7 }, '6800': { od: 19, id: 10, w: 5 },
  '6802': { od: 24, id: 15, w: 5 }, '6803': { od: 26, id: 17, w: 5 }, '6804': { od: 32, id: 20, w: 7 }, '6805': { od: 37, id: 25, w: 7 },
  '6700': { od: 15, id: 10, w: 4 }, '6900': { od: 22, id: 10, w: 6 },
  '6002': { od: 32, id: 15, w: 9 }, '6003': { od: 35, id: 17, w: 10 },
  '6200': { od: 30, id: 10, w: 9 }, '6201': { od: 32, id: 12, w: 10 }, '6202': { od: 35, id: 15, w: 11 },
  '624': { od: 13, id: 4, w: 5 }, '626': { od: 19, id: 6, w: 6 }, '627': { od: 22, id: 7, w: 7 }, '629': { od: 26, id: 9, w: 8 },
  '693': { od: 8, id: 3, w: 4 }, '695': { od: 13, id: 5, w: 4 }, 'MR105': { od: 10, id: 5, w: 4 }, 'MR85': { od: 8, id: 5, w: 2.5 },
  'LM6UU': { od: 12, id: 6, w: 19 }, 'LM10UU': { od: 19, id: 10, w: 29 }, 'LM12UU': { od: 21, id: 12, w: 30 },
  custom: null,
};

export const bearingBlock = {
  id: 'bearing-block',
  name: 'Bearing Block',
  sections: ['robotics'],
  description: 'Flange or pillow block for ball bearings (608, 6xx, 60xx, 62xx, thin 68xx like 6801 / 6806, miniature MR), LM6 / 8 / 10 / 12UU linear bearings, or a custom size.',
  params: {
    bearing: { type: 'select', default: '608', group: 'Bearing', label: 'Bearing', options: Object.keys(BEARINGS).map((v) => ({ value: v, label: v })) },
    customOD: { type: 'number', default: 22, min: 3, max: 120, step: 0.05, unit: 'mm', label: 'Custom OD', group: 'Bearing' },
    customWidth: { type: 'number', default: 7, min: 1, max: 80, step: 0.1, unit: 'mm', label: 'Custom width', group: 'Bearing' },
    customID: { type: 'number', default: 8, min: 1, max: 100, step: 0.05, unit: 'mm', label: 'Custom shaft diameter', group: 'Bearing' },
    pressFit: { type: 'number', default: 0.05, min: -0.2, max: 0.5, step: 0.01, unit: 'mm', label: 'Pocket clearance (per side)', group: 'Bearing', help: '0 to 0.1 for a press fit. Tune per printer.' },
    style: { type: 'select', default: 'flange', group: 'Block', label: 'Style', options: [{ value: 'flange', label: 'Flange (shaft vertical)' }, { value: 'pillow', label: 'Pillow block (shaft horizontal)' }] },
    wall: { type: 'number', default: 4, min: 1.6, max: 20, step: 0.1, unit: 'mm', label: 'Wall around the bearing', group: 'Block' },
    bolt: boltParam('Block', 'M4', 'Mounting bolts'),
  },
  generate(p, k) {
    const warnings = [];
    const bd = BEARINGS[p.bearing] ?? { od: p.customOD, id: p.customID, w: p.customWidth };
    const b = bolt(p.bolt);
    const rp = bd.od / 2 + p.pressFit;
    const R = rp + p.wall;
    const shaftR = bd.id / 2 + 1;
    if (p.style === 'flange') {
      const T = bd.w + 1.2;
      const span = 2 * R + b.head + 4;
      const plate = k.hull([k.cylZ(R, 0, 0, 0, T, 72), k.cylZ(b.head / 2 + 2, -span / 2, 0, 0, Math.min(T, 5), 32), k.cylZ(b.head / 2 + 2, span / 2, 0, 0, Math.min(T, 5), 32)]);
      const cuts = [k.cylZ(rp, 0, 0, 1.2, T + 1, 72), k.cylZ(shaftR, 0, 0, -1, T + 1, 48)];
      for (const x of [-span / 2, span / 2]) cuts.push(k.cylZ(b.clear / 2, x, 0, -1, T + 1, 24));
      return { parts: [{ name: 'flange-block', manifold: k.placeOnBed(k.difference(plate, cuts)) }], warnings, notes: [`Pocket ${(2 * rp).toFixed(2)} x ${bd.w} mm for ${p.bearing}. 1.2 mm lip under the bearing. Bolts ${span.toFixed(1)} mm apart.`] };
    }
    // pillow: shaft along Y, block sits on the bed
    const zc = R;
    const L = bd.w + 1.6;
    const span = 2 * R + b.head + 4;
    const body = k.union([
      k.prismY([...Array.from({ length: 33 }, (_, i) => [R * Math.cos((Math.PI * i) / 32), zc + R * Math.sin((Math.PI * i) / 32)]), [-R, 0], [R, 0]], -L / 2, L / 2),
      k.cuboid([span + b.head + 4, L, Math.min(6, zc)], [0, 0, Math.min(6, zc) / 2]),
    ]);
    const cuts = [k.holeY(rp, 0, zc, -L / 2 + 1.2, L / 2 + 1, 72), k.holeY(shaftR, 0, zc, -L / 2 - 1, L / 2 + 1, 48)];
    for (const x of [-span / 2, span / 2]) cuts.push(k.cylZ(b.clear / 2, x, 0, -1, 10, 24));
    return { parts: [{ name: 'pillow-block', manifold: k.placeOnBed(k.difference(body, cuts)) }], warnings, notes: [`Shaft center ${zc.toFixed(1)} mm above the base.`, 'The pocket is a teardrop so it prints without support; the bearing seats on the round part.'] };
  },
};

export const shaftCoupler = {
  id: 'shaft-coupler',
  name: 'Shaft Coupler',
  sections: ['robotics'],
  description: 'Rigid coupler joining two shafts of any size (5 to 8 mm lead screw, motor to motor...). Set screws with nut slots.',
  params: {
    boreA: { type: 'number', default: 5, min: 1, max: 40, step: 0.05, unit: 'mm', label: 'Bore A', group: 'Bores' },
    boreB: { type: 'number', default: 8, min: 1, max: 40, step: 0.05, unit: 'mm', label: 'Bore B', group: 'Bores' },
    clearance: { type: 'number', default: 0.1, min: -0.2, max: 1, step: 0.05, unit: 'mm', label: 'Bore clearance (per side)', group: 'Bores' },
    outerDiameter: { type: 'number', default: 20, min: 6, max: 80, step: 0.5, unit: 'mm', label: 'Outer diameter', group: 'Body' },
    length: { type: 'number', default: 25, min: 8, max: 120, step: 0.5, unit: 'mm', label: 'Length', group: 'Body' },
    setScrew: boltParam('Body', 'M3', 'Set screws'),
    nutSlots: { type: 'boolean', default: true, label: 'Square-ish nut slots for the set screws', group: 'Body' },
  },
  generate(p, k) {
    const warnings = [];
    const R = p.outerDiameter / 2;
    const L = p.length;
    const s = bolt(p.setScrew);
    const ra = p.boreA / 2 + p.clearance;
    const rb = p.boreB / 2 + p.clearance;
    if (Math.max(ra, rb) > R - 2) throw new Error('Outer diameter is too small for the bores.');
    const cuts = [k.cylZ(ra, 0, 0, -1, L / 2, 48), k.cylZ(rb, 0, 0, L / 2 - 0.01, L + 1, 48)];
    for (const [z, r] of [[L / 4, ra], [(3 * L) / 4, rb]]) {
      cuts.push(k.holeX(s.clear / 2, 0, z, 0, R + 1, 20));
      if (p.nutSlots) {
        const x = r + (R - r) / 2;
        const w = s.nutAF + 0.3;
        cuts.push(k.cuboid([s.nutH + 0.4, w, L / 4 + w / 2 + 1], [x, 0, z + (L / 4 + w / 2 + 1) / 2 - w / 2]));
        if ((R - r) < s.nutH + 2.4) warnings.push('Not enough wall for nut slots. Raise outerDiameter or turn off nut slots.');
      }
    }
    const part = k.difference(k.cylZ(R, 0, 0, 0, L, 64), cuts);
    return { parts: [{ name: 'coupler', manifold: k.placeOnBed(part) }], warnings: [...new Set(warnings)], notes: [`${p.boreA} mm to ${p.boreB} mm, ${L} mm long. Nut slots open to the top: drop nuts in, thread set screws from the side.`] };
  },
};

export const linkBar = {
  id: 'link-bar',
  name: 'Link Bar / Beam',
  sections: ['robotics'],
  description: 'Flat link or beam with a row of holes (or slots) at a set pitch, rounded ends. Arms, linkages, brackets, mounting strips.',
  params: {
    holes: { type: 'integer', default: 7, min: 2, max: 60, label: 'Holes', group: 'Bar' },
    pitch: { type: 'number', default: 10, min: 3, max: 100, step: 0.1, unit: 'mm', label: 'Hole pitch', group: 'Bar' },
    holeDiameter: { type: 'number', default: 3.4, min: 0.5, max: 30, step: 0.05, unit: 'mm', label: 'Hole diameter', group: 'Bar' },
    holeShape: { type: 'select', default: 'round', group: 'Bar', label: 'Hole shape', options: [{ value: 'round', label: 'Round' }, { value: 'hex', label: 'Hex nut trap (one side)' }, { value: 'slot', label: 'Continuous slot' }] },
    width: { type: 'number', default: 9, min: 3, max: 60, step: 0.1, unit: 'mm', label: 'Width', group: 'Bar' },
    thickness: { type: 'number', default: 4, min: 1, max: 30, step: 0.1, unit: 'mm', label: 'Thickness', group: 'Bar' },
    count: { type: 'integer', default: 1, min: 1, max: 20, label: 'How many', group: 'Batch' },
  },
  generate(p, k) {
    const warnings = [];
    const L = (p.holes - 1) * p.pitch;
    const W = p.width;
    const T = p.thickness;
    const bar = k.union([k.cuboid([L, W, T], [L / 2, 0, T / 2]), k.cylZ(W / 2, 0, 0, 0, T, 48), k.cylZ(W / 2, L, 0, 0, T, 48)]);
    const cuts = [];
    if (p.holeShape === 'slot') {
      cuts.push(k.translate(k.extrude(k.roundedRect(L + p.holeDiameter, p.holeDiameter, p.holeDiameter / 2 - 0.01, 8), T + 2), [L / 2, 0, -1]));
    } else {
      for (let i = 0; i < p.holes; i++) {
        cuts.push(k.cylZ(p.holeDiameter / 2, i * p.pitch, 0, -1, T + 1, 32));
        if (p.holeShape === 'hex') cuts.push(k.hexZ(p.holeDiameter * 1.75, i * p.pitch, 0, T - Math.min(T - 1, p.holeDiameter * 0.8), T + 1, 30));
      }
    }
    if (W - p.holeDiameter < 2.4) warnings.push('Less than 1.2 mm of material beside the holes.');
    if (p.pitch - p.holeDiameter < 1.2) warnings.push('Holes are closer than 1.2 mm.');
    const one = k.difference(bar, cuts);
    const copies = Array.from({ length: p.count }, (_, i) => k.translate(one, [0, i * (W + 3), 0]));
    return { parts: [{ name: p.count > 1 ? `links-x${p.count}` : 'link', manifold: k.placeOnBed(k.union(copies)) }], warnings, notes: [`${p.holes} holes at ${p.pitch} mm, ${(L + W).toFixed(1)} mm long overall.`] };
  },
};

export const knob = {
  id: 'knob',
  name: 'Knob',
  sections: ['robotics', 'shop'],
  description: 'Control knob for pots and encoders (6 mm D-shaft by default), or a grip knob with a hex nut / bolt-head pocket.',
  params: {
    diameter: { type: 'number', default: 25, min: 6, max: 120, step: 0.5, unit: 'mm', label: 'Diameter', group: 'Knob' },
    height: { type: 'number', default: 16, min: 4, max: 80, step: 0.5, unit: 'mm', label: 'Height', group: 'Knob' },
    grip: { type: 'select', default: 'ribs', group: 'Knob', label: 'Grip', options: [{ value: 'smooth', label: 'Smooth' }, { value: 'ribs', label: 'Ribs' }, { value: 'lobes', label: 'Lobes (star)' }] },
    gripCount: { type: 'integer', default: 18, min: 3, max: 60, label: 'Ribs / lobes', group: 'Knob' },
    pointer: { type: 'boolean', default: true, label: 'Pointer line on top', group: 'Knob' },
    shaft: { type: 'select', default: 'd', group: 'Shaft', label: 'Shaft fitting', options: [{ value: 'round', label: 'Round shaft' }, { value: 'd', label: 'D-shaft' }, { value: 'hexnut', label: 'Hex nut / bolt head pocket' }] },
    shaftDiameter: { type: 'number', default: 6, min: 1, max: 30, step: 0.05, unit: 'mm', label: 'Shaft diameter (or nut across flats)', group: 'Shaft' },
    dFlat: { type: 'number', default: 1.5, min: 0.1, max: 5, step: 0.05, unit: 'mm', label: 'D-flat depth', group: 'Shaft', help: 'Common 6 mm D-shaft pots: about 1.5 mm.' },
    shaftDepth: { type: 'number', default: 12, min: 2, max: 70, step: 0.5, unit: 'mm', label: 'Shaft depth', group: 'Shaft' },
    clearance: { type: 'number', default: 0.1, min: -0.2, max: 1, step: 0.05, unit: 'mm', label: 'Shaft clearance (per side)', group: 'Shaft' },
    throughBolt: { type: 'number', default: 0, min: 0, max: 20, step: 0.1, unit: 'mm', label: 'Through hole for the bolt (hex pocket)', group: 'Shaft' },
  },
  generate(p, k) {
    const warnings = [];
    const R = p.diameter / 2;
    const H = p.height;
    // printed top-down: z = 0 is the knob's top face, the shaft opens at the top of the print
    let body;
    if (p.grip === 'lobes') {
      const pts = [];
      const n = p.gripCount;
      for (let i = 0; i < n * 8; i++) {
        const a = (i * 2 * Math.PI) / (n * 8);
        const rr = R * (0.85 + 0.15 * Math.cos(n * a));
        pts.push([rr * Math.cos(a), rr * Math.sin(a)]);
      }
      body = k.extrude(k.polygon(pts), H);
    } else {
      body = k.cylZ(p.grip === 'ribs' ? R - 0.6 : R, 0, 0, 0, H, 96);
      if (p.grip === 'ribs') {
        const ribs = [];
        for (let i = 0; i < p.gripCount; i++) ribs.push(k.rotate(k.cuboid([1.6, 1.2, H - 1], [R - 0.6, 0, H / 2 + 0.5]), [0, 0, (i * 360) / p.gripCount]));
        body = k.union([body, ...ribs]);
      }
    }
    // chamfer the top edge (the bed side) with a cone cut
    // Cutter top at z = 1.3 (cone already outside the knob there) and 101 segments, an odd count,
    // so cone edges never line up with the grip outline's vertices (that leaves slivers in the STL).
    body = k.difference(body, [k.difference(k.cylZ(R + 2, 0, 0, -1, 1.3, 101), [k.coneZ(R - 1, R + 1, 0, 0, -0.01, 2, 101)])]);
    const cuts = [];
    const r = p.shaftDiameter / 2 + p.clearance;
    const z0 = H - p.shaftDepth;
    if (z0 < 1.2) warnings.push('Shaft hole nearly breaks through the top. Lower shaftDepth.');
    if (p.shaft === 'hexnut') {
      cuts.push(k.hexZ(2 * r, 0, 0, z0, H + 1, 30));
      if (p.throughBolt > 0) cuts.push(k.cylZ(p.throughBolt / 2, 0, 0, -1, H + 1, 32));
    } else {
      let hole = k.cylZ(r, 0, 0, z0, H + 1, 48);
      if (p.shaft === 'd') hole = k.difference(hole, [k.cuboid([4 * r, 2 * r, p.shaftDepth + 4], [0, r - p.dFlat + r + p.clearance, (z0 + H) / 2])]);
      cuts.push(hole);
    }
    if (p.pointer) cuts.push(k.cuboid([1.2, R * 0.7, 1.2], [0, R * 0.45, 0.4]));
    return { parts: [{ name: 'knob', manifold: k.placeOnBed(k.difference(body, cuts)) }], warnings, notes: ['Prints top-face down (the pointer line is on the bed side). Push onto the shaft.'] };
  },
};

export const enclosure = {
  id: 'enclosure',
  name: 'Electronics Enclosure',
  sections: ['robotics', 'quads', 'shop'],
  description: 'Box and screw-on lid for a board: inner size, board standoff pattern, port cutout on one wall, vent slots. Presets for common boards.',
  params: {
    innerWidth: { type: 'number', default: 90, min: 10, max: 300, step: 0.5, unit: 'mm', label: 'Inner width (X)', group: 'Box' },
    innerDepth: { type: 'number', default: 62, min: 10, max: 300, step: 0.5, unit: 'mm', label: 'Inner depth (Y)', group: 'Box' },
    innerHeight: { type: 'number', default: 30, min: 5, max: 200, step: 0.5, unit: 'mm', label: 'Inner height', group: 'Box' },
    wall: { type: 'number', default: 2, min: 1, max: 6, step: 0.1, unit: 'mm', label: 'Wall', group: 'Box' },
    floor: { type: 'number', default: 2, min: 0.8, max: 6, step: 0.1, unit: 'mm', label: 'Floor', group: 'Box' },
    cornerRadius: { type: 'number', default: 4, min: 0, max: 20, step: 0.5, unit: 'mm', label: 'Corner radius', group: 'Box' },
    standoffX: { type: 'number', default: 58, min: 0, max: 290, step: 0.1, unit: 'mm', label: 'Board hole spacing X (0 = none)', group: 'Board' },
    standoffY: { type: 'number', default: 49, min: 0, max: 290, step: 0.1, unit: 'mm', label: 'Board hole spacing Y', group: 'Board' },
    boardOffsetX: { type: 'number', default: -10, min: -150, max: 150, step: 0.5, unit: 'mm', label: 'Board pattern offset X', group: 'Board' },
    standoffHeight: { type: 'number', default: 5, min: 1, max: 40, step: 0.5, unit: 'mm', label: 'Standoff height', group: 'Board' },
    standoffHole: { type: 'number', default: 2.2, min: 1, max: 6, step: 0.05, unit: 'mm', label: 'Standoff screw hole', group: 'Board', help: '2.2 to thread M2.5 into plastic.' },
    portWall: { type: 'select', default: 'right', group: 'Ports', label: 'Port cutout wall', options: [{ value: 'none', label: 'None' }, { value: 'front', label: 'Front (-Y)' }, { value: 'back', label: 'Back (+Y)' }, { value: 'left', label: 'Left (-X)' }, { value: 'right', label: 'Right (+X)' }] },
    portWidth: { type: 'number', default: 50, min: 2, max: 290, step: 0.5, unit: 'mm', label: 'Port cutout width', group: 'Ports' },
    portHeight: { type: 'number', default: 16, min: 2, max: 190, step: 0.5, unit: 'mm', label: 'Port cutout height', group: 'Ports' },
    portBottom: { type: 'number', default: 5, min: 0, max: 190, step: 0.5, unit: 'mm', label: 'Port cutout bottom (above floor)', group: 'Ports' },
    lidThickness: { type: 'number', default: 2, min: 1, max: 6, step: 0.1, unit: 'mm', label: 'Lid thickness', group: 'Lid' },
    vents: { type: 'integer', default: 6, min: 0, max: 30, label: 'Lid vent slots', group: 'Lid' },
    lidScrew: boltParam('Lid', 'M3', 'Lid screws'),
  },
  generate(p, k) {
    const warnings = [];
    const t = p.wall;
    const W = p.innerWidth + 2 * t;
    const D = p.innerDepth + 2 * t;
    const H = p.floor + p.innerHeight;
    const ls = bolt(p.lidScrew);
    const postR = ls.head / 2 + 1;
    const inset = t + postR - 0.5;
    const posts = [[-W / 2 + inset, -D / 2 + inset], [W / 2 - inset, -D / 2 + inset], [W / 2 - inset, D / 2 - inset], [-W / 2 + inset, D / 2 - inset]];
    const outer = k.roundedBlock(W, D, p.cornerRadius, 0, H, 8);
    const cavity = k.roundedBlock(p.innerWidth, p.innerDepth, Math.max(0, p.cornerRadius - t), p.floor, H + 1, 8);
    const add = [k.difference(outer, [cavity])];
    for (const [x, y] of posts) add.push(k.cylZ(postR, x, y, p.floor - 0.01, H, 32));
    const cuts = posts.map(([x, y]) => k.cylZ(ls.tap / 2, x, y, p.floor + 1, H + 1, 20));
    if (p.standoffX > 0) {
      for (const [x, y] of squarePattern(p.standoffX, p.standoffY)) {
        add.push(k.cylZ(2.8, x + p.boardOffsetX, y, p.floor - 0.01, p.floor + p.standoffHeight, 24));
        cuts.push(k.cylZ(p.standoffHole / 2, x + p.boardOffsetX, y, p.floor + 0.8, p.floor + p.standoffHeight + 1, 16));
      }
      if (p.standoffX / 2 + Math.abs(p.boardOffsetX) + 3 > p.innerWidth / 2 || p.standoffY / 2 + 3 > p.innerDepth / 2) warnings.push('Board standoffs are outside the box.');
    }
    if (p.portWall !== 'none') {
      const z = p.floor + p.portBottom + p.portHeight / 2;
      const along = p.portWall === 'left' || p.portWall === 'right';
      const pos = { front: [0, -D / 2], back: [0, D / 2], left: [-W / 2, 0], right: [W / 2, 0] }[p.portWall];
      cuts.push(k.cuboid(along ? [t * 3, p.portWidth, p.portHeight] : [p.portWidth, t * 3, p.portHeight], [pos[0], pos[1], z]));
      if (p.portBottom + p.portHeight > p.innerHeight) warnings.push('Port cutout runs above the box top.');
    }
    const box = k.difference(k.union(add), cuts);
    // lid: plate plus an inner locating lip, screw holes with countersinks
    const lt = p.lidThickness;
    const lidAdd = [k.roundedBlock(W, D, p.cornerRadius, 0, lt, 8)];
    const lip = k.difference(
      k.roundedBlock(p.innerWidth - 0.6, p.innerDepth - 0.6, Math.max(0, p.cornerRadius - t), lt - 0.01, lt + 2, 8),
      [k.roundedBlock(p.innerWidth - 3.6, p.innerDepth - 3.6, Math.max(0, p.cornerRadius - t - 1.5), lt - 1, lt + 3, 8), ...posts.map(([x, y]) => k.cylZ(postR + 0.6, x, y, lt - 1, lt + 3, 32))],
    );
    lidAdd.push(lip);
    const lidCuts = posts.map(([x, y]) => k.cylZ(ls.clear / 2, x, y, -1, lt + 1, 20));
    for (const [x, y] of posts) lidCuts.push(k.coneZ(ls.head / 2 + 0.5, ls.clear / 2, x, y, -0.01, Math.min(lt - 0.6, (ls.head - ls.clear) / 2 + 0.5), 32));
    for (let i = 0; i < p.vents; i++) {
      const y = -p.innerDepth / 2 + 8 + (i * (p.innerDepth - 16)) / Math.max(1, p.vents - 1);
      lidCuts.push(k.translate(k.extrude(k.roundedRect(p.innerWidth * 0.5, 2, 0.99, 4), lt + 6), [0, y, -1]));
    }
    const lid = k.difference(k.union(lidAdd), lidCuts);
    return {
      parts: [{ name: 'box', manifold: k.placeOnBed(box) }, { name: 'lid', manifold: k.placeOnBed(lid) }],
      warnings,
      notes: [`Inside ${p.innerWidth} x ${p.innerDepth} x ${p.innerHeight} mm. Lid screws ${p.lidScrew} thread into the corner posts. Print box open-side up, lid flat side down.`],
    };
  },
};

