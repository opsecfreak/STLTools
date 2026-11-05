// Component mount: "a holder for X, mounted on Y".
//
// Holder (payload): tray (ESC, receiver, BEC, battery), board pad (FC, VTX,
// Pi), cradle (flashlight, cylinder), cup (puck sensor, buzzer), cable clips,
// support post (socket for a second tube).
// Base: screw plate, tape (flat), zip-tie saddle onto a tube, or a bolt-on
// clamp kit (holder + matching tube clamp from the Tube Clamp generator).
//
// Print frame: base on the bed, holder upward. The item's length runs along Y,
// which is also the tube direction for the saddle and clamp-kit bases.

import { bolt, boltParam } from '../core/hardware.js';
import { resolveParams } from '../core/params.js';
import tubeClamp from './tube-clamp.js';

const STRAP_T = 2.6; // strap slot thickness (zip ties and thin hook-and-loop straps)

export default {
  id: 'component-mount',
  name: 'Component Mount',
  sections: ['accessories', 'quads', 'planes', 'robotics', 'shop'],
  description: 'Holder for a component (ESC, receiver, battery, board, camera, sensor, cables, support tube) on a screw plate, tape, zip-tie saddle on a tube, or a bolt-on tube clamp. Every size adjustable.',
  params: {
    holder: {
      type: 'select', default: 'tray', group: 'Holder', label: 'Holder type',
      options: [
        { value: 'tray', label: 'Tray (box-shaped item)' },
        { value: 'pad', label: 'Board pad (hole pattern + bosses)' },
        { value: 'cradle', label: 'Cradle (lying cylinder)' },
        { value: 'cup', label: 'Cup (standing cylinder)' },
        { value: 'cable', label: 'Cable clips' },
        { value: 'post', label: 'Support post (tube socket)' },
      ],
    },
    itemWidth: { type: 'number', default: 22, min: 3, max: 250, step: 0.1, unit: 'mm', label: 'Item width (across)', group: 'Item', help: 'Tray. Measure your part.' },
    itemLength: { type: 'number', default: 45, min: 3, max: 250, step: 0.1, unit: 'mm', label: 'Item length (along)', group: 'Item', help: 'Tray, cradle, cable clips.' },
    itemHeight: { type: 'number', default: 12, min: 1, max: 150, step: 0.1, unit: 'mm', label: 'Item height', group: 'Item', help: 'Tray. Wall height is a share of this.' },
    itemDiameter: { type: 'number', default: 25, min: 2, max: 200, step: 0.1, unit: 'mm', label: 'Item diameter', group: 'Item', help: 'Cradle, cup, cable clips (cable diameter).' },
    clearance: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.05, unit: 'mm', label: 'Fit clearance (per side)', group: 'Item' },
    orientation: { type: 'select', default: 'along', group: 'Item', label: 'Item direction vs. tube', options: [{ value: 'along', label: 'Along the tube' }, { value: 'across', label: 'Across the tube' }] },

    wall: { type: 'number', default: 2, min: 0.8, max: 10, step: 0.1, unit: 'mm', label: 'Wall', group: 'Holder' },
    wallHeight: { type: 'number', default: 0, min: 0, max: 150, step: 0.5, unit: 'mm', label: 'Tray wall height (0 = 60% of item)', group: 'Holder' },
    endStops: { type: 'select', default: 'one', group: 'Holder', label: 'Tray end stops', options: [{ value: 'none', label: 'None (open ends)' }, { value: 'one', label: 'One end' }, { value: 'both', label: 'Both ends' }] },
    straps: { type: 'integer', default: 2, min: 0, max: 6, label: 'Strap / zip-tie slots', group: 'Holder' },
    strapWidth: { type: 'number', default: 5.5, min: 2, max: 30, step: 0.5, unit: 'mm', label: 'Strap slot width', group: 'Holder', help: '5.5 for 4.8 mm zip ties, 21 for 20 mm battery straps.' },
    vents: { type: 'boolean', default: false, label: 'Vent slots in the floor', group: 'Holder' },
    padPatternX: { type: 'number', default: 30.5, min: 4, max: 200, step: 0.05, unit: 'mm', label: 'Pad hole spacing X', group: 'Pad' },
    padPatternY: { type: 'number', default: 30.5, min: 4, max: 200, step: 0.05, unit: 'mm', label: 'Pad hole spacing Y', group: 'Pad' },
    padHole: { type: 'number', default: 2.6, min: 0.8, max: 8, step: 0.05, unit: 'mm', label: 'Pad hole (2.6 threads M3)', group: 'Pad' },
    bossHeight: { type: 'number', default: 4, min: 0, max: 40, step: 0.5, unit: 'mm', label: 'Boss height', group: 'Pad' },
    bossDiameter: { type: 'number', default: 6, min: 2, max: 20, step: 0.1, unit: 'mm', label: 'Boss diameter', group: 'Pad' },
    cableCount: { type: 'integer', default: 3, min: 1, max: 20, label: 'Cable clips', group: 'Cables' },
    cupDepth: { type: 'number', default: 15, min: 2, max: 150, step: 0.5, unit: 'mm', label: 'Cup depth', group: 'Cup / post' },
    postTubeOD: { type: 'number', default: 10, min: 2, max: 60, step: 0.05, unit: 'mm', label: 'Post socket tube OD', group: 'Cup / post' },
    postHeight: { type: 'number', default: 20, min: 0, max: 200, step: 0.5, unit: 'mm', label: 'Post height below the socket', group: 'Cup / post' },
    socketDepth: { type: 'number', default: 15, min: 3, max: 80, step: 0.5, unit: 'mm', label: 'Socket depth', group: 'Cup / post' },

    base: {
      type: 'select', default: 'saddle', group: 'Base', label: 'Base',
      options: [
        { value: 'saddle', label: 'Zip-tie saddle onto a tube' },
        { value: 'clamp-kit', label: 'Bolt-on tube clamp (2 parts)' },
        { value: 'plate', label: 'Screw plate' },
        { value: 'tape', label: 'Flat (tape / glue)' },
      ],
    },
    floor: { type: 'number', default: 2.4, min: 1, max: 15, step: 0.1, unit: 'mm', label: 'Floor thickness', group: 'Base' },
    tubeOD: { type: 'number', default: 16, min: 3, max: 80, step: 0.05, unit: 'mm', label: 'Tube OD (saddle / clamp)', group: 'Base' },
    clampType: { type: 'select', default: 'mount', group: 'Base', label: 'Clamp type (clamp kit)', options: [{ value: 'mount', label: 'Ring + plate (slide on)' }, { value: 'two-piece', label: 'Two-piece (fits mid-tube)' }, { value: 'snap', label: 'Snap-on clip' }] },
    clampLength: { type: 'number', default: 16, min: 6, max: 80, step: 0.5, unit: 'mm', label: 'Clamp length (clamp kit)', group: 'Base' },
    bolt: boltParam('Base', 'M3', 'Screws'),
  },

  generate(p, k) {
    const warnings = [];
    const notes = [];
    const c = p.clearance;
    const b = bolt(p.bolt);
    const strapMargin = p.straps > 0 ? STRAP_T + 2.4 : 0;

    // ---------- holder, built with its length along Y, centered, sitting on z = 0 ----------
    let W, L; // holder footprint (without strap margin)
    const add = [];
    const cut = [];
    const strapYs = (len) => (p.straps === 0 ? [] : Array.from({ length: p.straps }, (_, i) => -len / 2 + ((i + 0.5) * len) / p.straps));

    if (p.holder === 'tray') {
      const iw = p.itemWidth + 2 * c;
      const il = p.itemLength + 2 * c;
      const wh = p.wallHeight > 0 ? p.wallHeight : Math.max(2, p.itemHeight * 0.6);
      const stops = p.endStops === 'both' ? 2 : p.endStops === 'one' ? 1 : 0;
      W = iw + 2 * p.wall;
      L = il + stops * p.wall;
      const y0 = -L / 2 + (stops >= 1 ? p.wall : 0);
      for (const sx of [-1, 1]) add.push(k.cuboid([p.wall, L, wh], [sx * (iw / 2 + p.wall / 2), 0, wh / 2]));
      if (stops >= 1) add.push(k.cuboid([W, p.wall, wh * 0.7], [0, -L / 2 + p.wall / 2, (wh * 0.7) / 2]));
      if (stops === 2) add.push(k.cuboid([W, p.wall, wh * 0.7], [0, L / 2 - p.wall / 2, (wh * 0.7) / 2]));
      for (const y of strapYs(il * 0.8)) for (const sx of [-1, 1]) cut.push(k.cuboid([STRAP_T, p.strapWidth, 400], [sx * (W / 2 + STRAP_T / 2 + 1), y + y0 + il / 2 - 0, 0]));
      if (p.vents && iw > 10 && il > 14) {
        const n = Math.max(1, Math.floor((il - 8) / 7));
        for (let i = 0; i < n; i++) cut.push(k.translate(k.extrude(k.roundedRect(iw * 0.6, 3, 1.49, 4), 400), [0, y0 + 4 + 1.5 + i * 7 + 0.5, -200]));
      }
      notes.push(`Tray inside ${iw.toFixed(1)} x ${il.toFixed(1)} mm, walls ${wh.toFixed(1)} mm high.`);
      if (p.straps === 0) notes.push('No strap slots: glue the item, or use hook-and-loop tape.');
    } else if (p.holder === 'pad') {
      W = p.padPatternX + p.bossDiameter + 4;
      L = p.padPatternY + p.bossDiameter + 4;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const x = (sx * p.padPatternX) / 2;
          const y = (sy * p.padPatternY) / 2;
          if (p.bossHeight > 0) add.push(k.cylZ(p.bossDiameter / 2, x, y, -0.01, p.bossHeight, 32));
          cut.push(k.cylZ(p.padHole / 2, x, y, -0.8 + 0.01, p.bossHeight + 1, 24));
        }
      }
      for (const y of strapYs(L * 0.6)) for (const sx of [-1, 1]) cut.push(k.cuboid([STRAP_T, p.strapWidth, 400], [sx * (W / 2 + STRAP_T / 2 + 1), y, 0]));
      notes.push(`Pad ${p.padPatternX} x ${p.padPatternY} mm hole pattern, ${p.bossHeight} mm bosses. Holes are closed at the bottom; screws thread in from the top.`);
    } else if (p.holder === 'cradle') {
      const r = p.itemDiameter / 2 + c;
      W = 2 * (r + p.wall);
      L = p.itemLength;
      const zc = r + 0.8; // keep 0.8 mm under the item
      const h = zc + r * 0.15; // walls just past the center so the item clicks in
      add.push(k.cuboid([W, L, h], [0, 0, h / 2]));
      cut.push(k.track(k.track(k.Manifold.cylinder(L + 2, r, r, 96, true)).rotate([90, 0, 0]).translate([0, 0, zc])));
      for (const y of strapYs(L * 0.8)) for (const sx of [-1, 1]) cut.push(k.cuboid([STRAP_T, p.strapWidth, 400], [sx * (W / 2 + STRAP_T / 2 + 1), y, 0]));
      notes.push(`Cradle for a ${p.itemDiameter} mm cylinder, ${L} mm long. Strap it over the top.`);
    } else if (p.holder === 'cup') {
      const r = p.itemDiameter / 2 + c;
      W = L = 2 * (r + p.wall);
      add.push(k.cylZ(r + p.wall, 0, 0, -0.01, p.cupDepth, 96));
      cut.push(k.cylZ(r, 0, 0, 0.8, p.cupDepth + 1, 96));
      cut.push(k.cuboid([Math.min(6, r), r + p.wall + 2, p.cupDepth + 2], [0, r, p.cupDepth / 2 + 1.6])); // cable slot
      notes.push(`Cup ${(2 * r).toFixed(1)} mm inside, ${p.cupDepth} mm deep, with a cable slot.`);
    } else if (p.holder === 'cable') {
      const r = p.itemDiameter / 2 + c;
      const t = Math.max(1.2, p.wall * 0.8);
      const pitch = 2 * (r + t) + 1;
      W = p.cableCount * pitch;
      L = Math.max(6, p.itemLength > 40 ? 10 : p.itemLength);
      for (let i = 0; i < p.cableCount; i++) {
        const x = -W / 2 + pitch * (i + 0.5);
        const zc = r + 0.8;
        const prof = [];
        for (let j = 0; j <= 24; j++) { const a = (Math.PI * j) / 24; prof.push([x + (r + t) * Math.cos(a), zc + (r + t) * Math.sin(a)]); }
        prof.push([x - r - t, -0.01], [x + r + t, -0.01]);
        add.push(k.prismY(prof, -L / 2, L / 2));
        cut.push(k.track(k.track(k.Manifold.cylinder(L + 2, r, r, 48, true)).rotate([90, 0, 0]).translate([x, 0, zc])));
        cut.push(k.cuboid([2 * r * 0.75, L + 2, r + t + 2], [x, 0, zc + r * 0.6 + (r + t + 2) / 2]));
      }
      notes.push(`${p.cableCount} snap clips for ${p.itemDiameter} mm cables. TPU or PETG flexes best.`);
    } else {
      // post: socket for a support tube
      const r = p.postTubeOD / 2 + 0.15;
      const R = r + Math.max(2, p.wall);
      W = L = 2 * R + 8;
      const top = p.postHeight + p.socketDepth;
      add.push(k.cylZ(R, 0, 0, -0.01, top, 64));
      for (const a of [45, 135, 225, 315]) {
        const gl = Math.min(W / 2 - R, Math.max(4, top * 0.5));
        add.push(k.rotate(k.prismY([[R - 0.5, -0.01], [R + gl, -0.01], [R - 0.5, gl * 1.2]], -1, 1), [0, 0, a]));
      }
      cut.push(k.cylZ(r, 0, 0, p.postHeight + 0.01, top + 1, 64));
      notes.push(`Post with a ${p.postTubeOD} mm socket, ${p.socketDepth} mm deep, ${top.toFixed(0)} mm tall. Use it to support a boom or brace between tubes.`);
    }

    let holder = add.length ? k.union(add) : null;
    if (p.orientation === 'across') {
      if (holder) holder = k.rotate(holder, [0, 0, 90]);
      for (let i = 0; i < cut.length; i++) cut[i] = k.rotate(cut[i], [0, 0, 90]);
      [W, L] = [L, W];
    }

    // ---------- base ----------
    const parts = [];
    let T = p.floor;
    let fw = W + 2 * strapMargin; // floor footprint
    let fl = L;
    const baseCuts = [];
    const r = p.tubeOD / 2;
    let kitSpacing = 0;
    if (p.base === 'saddle') {
      // shallow groove under the floor along Y; it bridges, so keep it shallow
      const gd = Math.min(r * 0.35, 4);
      T = Math.max(T, gd + 2);
      fw = Math.max(fw, 2 * r + 6);
      baseCuts.push(k.track(k.track(k.Manifold.cylinder(fl + 2, r + 0.2, r + 0.2, 96, true)).rotate([90, 0, 0]).translate([0, 0, gd - r - 0.2])));
      if (p.straps === 0) warnings.push('Saddle base without strap slots: nothing holds it to the tube. Add straps.');
      notes.push(`Saddle for a ${p.tubeOD} mm tube, ${gd.toFixed(1)} mm groove. Zip ties go through the slots, around the item and the tube.`);
    } else if (p.base === 'plate') {
      const ear = b.head + 4;
      fw += 2 * ear;
      const xs = [-(fw / 2 - ear / 2), fw / 2 - ear / 2];
      const ys = fl > 45 ? [-fl / 4, fl / 4] : [0];
      for (const x of xs) for (const y of ys) {
        baseCuts.push(k.cylZ(b.clear / 2, x, y, -1, T + 1, 24));
        baseCuts.push(k.coneZ(b.clear / 2, b.head / 2 + 1, x, y, T - (b.head - b.clear) / 2, T + 1, 32));
      }
      notes.push(`Screw plate: ${xs.length * ys.length} countersunk ${p.bolt} holes.`);
    } else if (p.base === 'clamp-kit') {
      // holder floor gets two blind tap holes; the clamp's plate gets matching clearance holes
      const RA = r + 0.15 + 3;
      const earLen = b.head + 3;
      const minS = p.clampType === 'two-piece' ? 2 * (RA + earLen + b.head / 2 + 1) : 2 * (RA * 0.7 + b.head / 2) + 1;
      kitSpacing = Math.ceil(Math.max(minS, Math.min(fw - b.head - 2, 60)));
      fw = Math.max(fw, kitSpacing + b.head + 6);
      fl = Math.max(fl, p.clampLength);
      T = Math.max(T, 4);
      for (const x of [-kitSpacing / 2, kitSpacing / 2]) baseCuts.push(k.cylZ(b.tap / 2, x, 0, -1, T - 0.8, 24));
      const cp = resolveParams(tubeClamp.params, {
        type: p.clampType, tubeOD: p.tubeOD, length: p.clampLength, bolt: p.bolt, mountBolt: p.bolt,
        mountHoleSpacing: kitSpacing, plateWidth: kitSpacing + b.head + 6, basePlate: true,
      });
      const clamp = tubeClamp.generate(cp, k);
      parts.push(...clamp.parts.map((pt) => ({ ...pt, name: `clamp-${pt.name}` })));
      warnings.push(...clamp.warnings);
      notes.push(`Clamp kit: ${p.clampType} clamp for a ${p.tubeOD} mm tube. Two ${p.bolt} screws go through the clamp plate and thread into the holder floor (${kitSpacing} mm apart).`);
    } else {
      notes.push('Flat base: use double-sided mounting tape or glue.');
    }
    const floor = k.roundedBlock(fw, fl, 2, 0, T, 6);
    let part = holder ? k.union([floor, k.translate(holder, [0, 0, T - 0.01])]) : floor;
    const holderCuts = cut.map((cc) => k.translate(cc, [0, 0, T]));
    part = k.difference(part, [...holderCuts, ...baseCuts]);
    parts.unshift({ name: 'holder', manifold: k.placeOnBed(part) });
    if (p.base === 'saddle' && p.straps > 0 && W / 2 + 1 < r) warnings.push('Strap slots fall over the tube groove. Make the holder wider or use the clamp kit.');
    return { parts, warnings: [...new Set(warnings)], notes };
  },
};
