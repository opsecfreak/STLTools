// Weatherproof project box: box, lid with a gasket groove, and a printed TPU gasket.
//
// How the seal works: the gasket sits in a groove in the underside of the lid. The
// box rim is flat and wide enough to cover the groove. When the screws pull the lid
// down until it rests on the rim, the gasket is squeezed by exactly
//   gasket height - groove depth = compression x gasket height,
// so the squeeze is set by geometry, not by how hard the screws are tightened.
// Screws go through ears OUTSIDE the walls, so no screw hole crosses the sealed space.
// Compression 25 % is a starting value for static face seals; test with your TPU.
import { bolt, boltParam } from '../core/hardware.js';

// cable gland thread outer diameters: PG (DIN 40430) and metric (ISO) glands
const GLANDS = { none: 0, PG7: 12.5, PG9: 15.2, PG11: 18.6, M12: 12, M16: 16, M20: 20 };

export default {
  id: 'sealed-box',
  name: 'Weatherproof Box (gasket lid)',
  sections: ['shop', 'robotics', 'accessories', 'quads'],
  description: 'Project box with a lid that seals on a printed TPU gasket: groove depth sets the squeeze, screws outside the seal, optional cable gland hole.',
  basic: ['innerWidth', 'innerDepth', 'innerHeight', 'gland', 'lidScrew'],
  params: {
    innerWidth: { type: 'number', default: 100, min: 20, max: 200, step: 0.5, unit: 'mm', label: 'Inner width (X)', group: 'Box' },
    innerDepth: { type: 'number', default: 60, min: 20, max: 200, step: 0.5, unit: 'mm', label: 'Inner depth (Y)', group: 'Box' },
    innerHeight: { type: 'number', default: 40, min: 10, max: 180, step: 0.5, unit: 'mm', label: 'Inner height', group: 'Box' },
    wall: { type: 'number', default: 4.5, min: 3, max: 10, step: 0.1, unit: 'mm', label: 'Wall (also the sealing rim width)', group: 'Box', help: 'Must be at least the groove width + 2 mm so the rim covers the gasket.' },
    floor: { type: 'number', default: 2.4, min: 1.2, max: 6, step: 0.1, unit: 'mm', label: 'Floor', group: 'Box' },
    cornerRadius: { type: 'number', default: 6, min: 1, max: 30, step: 0.5, unit: 'mm', label: 'Outside corner radius', group: 'Box' },
    gasketWidth: { type: 'number', default: 2, min: 1.2, max: 5, step: 0.1, unit: 'mm', label: 'Gasket width', group: 'Seal' },
    gasketHeight: { type: 'number', default: 2, min: 1, max: 5, step: 0.1, unit: 'mm', label: 'Gasket height', group: 'Seal' },
    compression: { type: 'number', default: 25, min: 10, max: 40, step: 1, unit: '%', label: 'Gasket squeeze', group: 'Seal', help: 'Share of the gasket height pressed out when the lid is down. 20-30 % is typical for static face seals; test with your TPU.' },
    grooveClearance: { type: 'number', default: 0.3, min: 0, max: 1, step: 0.05, unit: 'mm', label: 'Groove side clearance (total)', group: 'Seal' },
    lidThickness: { type: 'number', default: 3.5, min: 2.5, max: 8, step: 0.1, unit: 'mm', label: 'Lid thickness', group: 'Lid' },
    lidScrew: boltParam('Lid', 'M3', 'Lid screws'),
    screwFix: { type: 'select', default: 'tap', label: 'Screws hold in', group: 'Lid', options: [{ value: 'tap', label: 'Plastic (screw cuts its thread)' }, { value: 'insert', label: 'Heat-set insert' }] },
    insertHole: { type: 'number', default: 4, min: 2, max: 8, step: 0.05, unit: 'mm', label: 'Insert hole diameter', group: 'Lid', help: 'Depends on the insert brand: print the fit-test coupon (Shop > Fit tests) and use the hole that seats yours.' },
    gland: { type: 'select', default: 'none', label: 'Cable gland hole', group: 'Openings', options: Object.entries(GLANDS).map(([v, d]) => ({ value: v, label: v === 'none' ? 'None' : `${v} (${d} mm thread)` })) },
    glandWall: { type: 'select', default: 'right', label: 'Gland on wall', group: 'Openings', options: [{ value: 'front', label: 'Front (-Y)' }, { value: 'back', label: 'Back (+Y)' }, { value: 'left', label: 'Left (-X)' }, { value: 'right', label: 'Right (+X)' }] },
  },
  generate(p, k) {
    const warnings = [];
    const notes = [];
    const t = p.wall;
    const W = p.innerWidth + 2 * t, D = p.innerDepth + 2 * t, H = p.floor + p.innerHeight;
    const rOut = Math.min(p.cornerRadius, W / 2 - 1, D / 2 - 1);
    const rIn = Math.max(0.5, rOut - t);
    const gw = p.gasketWidth + p.grooveClearance; // groove width
    const gd = p.gasketHeight * (1 - p.compression / 100); // groove depth
    if (t < gw + 2) warnings.push(`Wall ${t} mm is narrower than the groove (${gw.toFixed(2)} mm) + 2 mm: the rim will not cover the gasket. Use ${(gw + 2).toFixed(1)} mm or more.`);
    if (gd > p.lidThickness - 1.2) warnings.push(`The groove (${gd.toFixed(2)} mm deep) leaves less than 1.2 mm of lid above it: make the lid thicker.`);
    // seal line: the middle of the wall
    const cW = p.innerWidth + t, cD = p.innerDepth + t, rC = Math.max(0.5, rOut - t / 2);
    const ring = (w, d, r, width, z0, z1) => k.difference(k.roundedBlock(w + width, d + width, r + width / 2, z0, z1, 12), [k.roundedBlock(w - width, d - width, Math.max(0.2, r - width / 2), z0 - 1, z1 + 1, 12)]);

    // screw ears outside the walls, at the four corners (45 degrees out from the corner arc center)
    const s = bolt(p.lidScrew);
    const earR = s.head / 2 + 2.2;
    const off = (Math.SQRT1_2 * (rOut + earR - 1.2));
    const ears = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [sx * (W / 2 - rOut + off), sy * (D / 2 - rOut + off)]);
    const earH = Math.min(H, 12 + p.lidThickness);

    // box: shell + ears, gland hole
    const boxAdd = [k.difference(k.roundedBlock(W, D, rOut, 0, H, 12), [k.roundedBlock(p.innerWidth, p.innerDepth, rIn, p.floor, H + 1, 12)])];
    for (const [x, y] of ears) boxAdd.push(k.cylZ(earR, x, y, H - earH, H, 40));
    const holeD = p.screwFix === 'insert' ? p.insertHole : s.tap;
    const boxCuts = ears.map(([x, y]) => k.cylZ(holeD / 2, x, y, H - earH + 1.2, H + 1, 24));
    const gd2 = GLANDS[p.gland];
    if (gd2) {
      const z = p.floor + p.innerHeight / 2;
      const pos = { front: [0, -D / 2], back: [0, D / 2], left: [-W / 2, 0], right: [W / 2, 0] }[p.glandWall];
      const along = p.glandWall === 'left' || p.glandWall === 'right';
      const hole = k.rotate(k.cylZ(gd2 / 2 + 0.2, 0, 0, -t * 2, t * 2, 64), along ? [0, 90, 0] : [90, 0, 0]);
      boxCuts.push(k.translate(hole, [pos[0], pos[1], z]));
      const wallLen = along ? p.innerDepth : p.innerWidth;
      if (gd2 + 8 > Math.min(wallLen, p.innerHeight)) warnings.push(`The ${p.gland} gland hole (${gd2} mm) needs a wall at least ${gd2 + 8} mm wide and tall for its nut and seal.`);
      notes.push(`Cable gland hole ${(gd2 + 0.4).toFixed(1)} mm for a ${p.gland} gland on the ${p.glandWall} wall: its own O-ring or flat seal goes on the outside, the nut inside.`);
    }
    const box = k.difference(k.union(boxAdd), boxCuts);

    // lid: plate + ears, groove on the underside (z = 0 side before flipping), countersunk screw holes
    const lt = p.lidThickness;
    const lidAdd = [k.roundedBlock(W, D, rOut, 0, lt, 12)];
    for (const [x, y] of ears) lidAdd.push(k.cylZ(earR, x, y, 0, lt, 40));
    const lidCuts = [ring(cW, cD, rC, gw, -1, gd)];
    for (const [x, y] of ears) {
      lidCuts.push(k.cylZ(s.clear / 2, x, y, -1, lt + 1, 24));
      lidCuts.push(k.coneZ(s.clear / 2, s.head / 2 + 0.4, x, y, lt - Math.min(lt - 0.8, (s.head - s.clear) / 2 + 0.4), lt + 0.01, 32));
    }
    const lid = k.difference(k.union(lidAdd), lidCuts);

    // gasket: a flat ring along the seal line (print in TPU)
    const gasket = ring(cW, cD, rC, p.gasketWidth, 0, p.gasketHeight);

    notes.push(`Seal: ${p.gasketWidth} x ${p.gasketHeight} mm gasket in a ${gw.toFixed(2)} x ${gd.toFixed(2)} mm groove: ${(p.gasketHeight - gd).toFixed(2)} mm squeeze (${p.compression} %) when the lid rests on the rim.`);
    notes.push('Print the gasket in TPU (95A or softer), flat. Print the box open side up and the lid groove side up (as placed). Seal test: close it with a paper towel inside and spray it with water.');
    if (p.screwFix === 'insert') notes.push(`Heat-set insert holes ${p.insertHole} mm: check with the fit-test coupon first.`);
    return {
      parts: [
        { name: 'box', manifold: k.placeOnBed(box) },
        { name: 'lid', manifold: k.placeOnBed(k.rotate(lid, [180, 0, 0])), material: 'PLA / PETG / ASA' },
        { name: 'gasket', manifold: k.placeOnBed(gasket), material: 'TPU' },
      ],
      warnings,
      notes,
    };
  },
};
