#!/usr/bin/env node
// Builds the size-series presets in presets/50-series-*.json.
//
// Each series below is a generator + a list of parameter sets (sizes, bolt
// sizes, tooth counts...). For every candidate the script:
//   1. checks the parameters against the generator schema,
//   2. generates the part and keeps it only if every STL is watertight
//      (0 open edges, 0 float32 edge issues), has no warnings, and fits the
//      Sovol SV07 bed (220 x 220 x 250, turned 90 degrees if needed),
//   3. skips it if a hand-written preset already has the same parameters.
// The output files are normal preset files (they load like any other).
//
//   node scripts/build-series.mjs            build all series
//   node scripts/build-series.mjs gears      only series whose file name contains "gears"
//
// Add a series: add an entry to SERIES, run this script, run npm test, commit
// both the script and the generated file. Do not edit the generated files by hand.

import { writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { initKernel } = await import('../src/core/kernel.js');
const { generate, getGenerator } = await import('../src/core/registry.js');
const { resolveParams } = await import('../src/core/params.js');
const { meshStats, openEdgeCount, stlEdgeIssues } = await import('../src/core/export.js');
const { fitsBed } = await import('../src/core/estimate.js');
await initKernel();

const BED = { x: 220, y: 220, z: 250 }; // Sovol SV07
// Warnings that are notes about the part type, not problems with these sizes.
// A preset with only these is kept; the note goes into its description.
const ADVISORY = [/GT2 tooth shape is approximate/, /undercut a real gear/];
const only = process.argv[2] ?? '';

// ---------------------------------------------------------------- helpers
const f = (v) => String(+(+v).toFixed(3)); // 6.350 -> "6.35"
const idn = (v) => f(v).replace('.', 'p'); // 6.35 -> "6p35"
const cross = (obj) => Object.entries(obj).reduce((acc, [k, vals]) => acc.flatMap((a) => vals.map((v) => ({ ...a, [k]: v }))), [{}]);
const BOLT_CLEAR = { M2: 2.4, 'M2.5': 2.9, M3: 3.4, M4: 4.5, M5: 5.5 };
const OD = [3, 4, 5, 6, 8, 10, 12, 14, 15, 16, 18, 19, 20, 22, 25, 28, 30, 32, 35, 38, 40];

// Each series: { file, group, section, tags, generator, items: [{ id, name, description?, params, tags?, verify?, alts? }] }
// alts: other parameter sets to try, in order, if the first one warns.
const SERIES = [];
const add = (s) => SERIES.push(s);

// ---- tube clamps: every type x tube size
const CLAMP = { split: 'Split clamp', mount: 'Clamp + plate', saddle: 'Saddle clamp', snap: 'Snap-on clip', 'two-piece': 'Two-piece clamp', collar: 'Collar' };
add({
  file: '50-series-tube-clamps', group: 'Clamp sizes', section: 'accessories', tags: ['clamp', 'tube', 'carbon'], generator: 'tube-clamp',
  items: Object.entries(CLAMP).flatMap(([type, label]) => OD.map((od) => {
    const length = Math.max(10, Math.round(od * 1.1));
    const base = { type, tubeOD: od, length, bolt: od <= 6 ? 'M2' : od >= 30 ? 'M4' : 'M3' };
    const alts = [];
    if (type === 'mount' || type === 'two-piece' || type === 'saddle') {
      for (const extra of [20, 26, 32, 40, 50, 60, 70]) {
        const s = Math.ceil(od + extra);
        alts.push({ ...base, mountHoleSpacing: s, plateWidth: s + 10 });
      }
    }
    return { id: `clamp-${type}-${idn(od)}`, name: `${label}, ${f(od)} mm tube`, description: `${label} for a ${f(od)} mm OD tube (carbon, aluminium, PVC). Tune clearance for your tube.`, params: alts[0] ?? base, alts: alts.slice(1), tags: [type, `${f(od)}mm`] };
  })),
});

// ---- parallel and cross clamps
add({
  file: '50-series-tube-clamps-2', group: 'Clamp sizes', section: 'accessories', tags: ['clamp', 'tube'], generator: 'tube-clamp',
  items: ['parallel', 'cross'].flatMap((type) => [6, 8, 10, 12, 14, 15, 16, 18, 20, 22, 25].flatMap((a) => [a, ...[10, 12, 16, 20].filter((b) => b !== a)].map((b) => ({
    id: `clamp-${type}-${idn(a)}x${idn(b)}`, name: `${type === 'parallel' ? 'Parallel' : 'Cross'} clamp, ${f(a)} + ${f(b)} mm tubes`,
    description: `${type === 'parallel' ? 'Holds two tubes side by side' : 'Joins two tubes at 90 degrees'}: ${f(a)} mm and ${f(b)} mm.`,
    params: { type, tubeOD: a, tubeOD2: b, length: Math.max(12, Math.round(Math.max(a, b))) }, tags: [type],
  })))),
});

// ---- tube joints
const JOINT = { straight: 'Straight joiner', elbow: 'Elbow', tee: 'Tee', cross: 'Cross', y: 'Y joint', radial: 'Radial hub', corner: '3-way corner', 'tee-up': 'Tee with riser', 'corner-4': '4-way corner', 'cross-up': 'Cross with riser' };
add({
  file: '50-series-tube-joints', group: 'Joint sizes', section: 'accessories', tags: ['joint', 'tube', 'frame'], generator: 'tube-joint',
  items: Object.entries(JOINT).flatMap(([type, label]) => [6, 8, 10, 12, 14, 15, 16, 18, 19, 20, 22, 25].flatMap((od) => [false, true].map((setScrew) => ({
    id: `joint-${type}-${idn(od)}${setScrew ? '-screw' : ''}`, name: `${label}, ${f(od)} mm tube${setScrew ? ', set screws' : ''}`, description: `${label} for ${f(od)} mm OD tubes. ${setScrew ? 'M3 set screw in each socket.' : 'Glue in.'}`,
    params: { type, tubeOD: od, socketDepth: Math.max(12, Math.round(od * 1.4)), setScrew }, tags: [type],
  })))),
});

// ---- tube caps, feet and plugs (plugs assume 1 mm wall: verify the ID)
add({
  file: '50-series-tube-caps', group: 'Cap and plug sizes', section: 'accessories', tags: ['cap', 'tube'], generator: 'tube-cap',
  items: [
    ...OD.map((od) => ({ id: `cap-${idn(od)}`, name: `End cap, ${f(od)} mm tube`, params: { type: 'cap', tubeOD: od, tubeID: Math.max(1, od - 2) }, tags: ['cap'] })),
    ...OD.map((od) => ({ id: `foot-${idn(od)}`, name: `Angled foot, ${f(od)} mm tube`, params: { type: 'foot', tubeOD: od, tubeID: Math.max(1, od - 2) }, tags: ['foot', 'landing gear'] })),
    ...OD.filter((od) => od >= 6).map((od) => ({ id: `plug-${idn(od)}x${idn(od - 2)}`, name: `Plug, ${f(od)} x ${f(od - 2)} mm tube`, description: 'Plug for a tube with 1 mm wall. Measure your tube ID.', params: { type: 'plug', tubeOD: od, tubeID: od - 2 }, tags: ['plug'], verify: ['tubeID'] })),
  ],
});

// ---- spacers, standoffs, washers
const LENGTHS = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40];
add({
  file: '50-series-spacers', group: 'Spacer sizes', section: 'accessories', tags: ['spacer', 'standoff', 'hardware'], generator: 'spacer',
  items: ['round', 'hex'].flatMap((shape) => Object.entries(BOLT_CLEAR).flatMap(([b, id]) => LENGTHS.map((len) => {
    const od = +(id * 2 + 0.2).toFixed(1);
    const washer = len <= 1.5;
    return { id: `${washer ? 'washer' : 'spacer'}-${shape}-${b.toLowerCase().replace('.', 'p')}-${idn(len)}`, name: `${washer ? 'Washer' : 'Spacer'} ${shape}, ${b}, ${f(len)} mm`, description: `${shape === 'hex' ? 'Hex' : 'Round'} ${washer ? 'washer' : 'spacer'} for ${b} screws (${id} mm hole), ${f(len)} mm long.`, params: { shape, innerDiameter: id, outerDiameter: od, length: len, count: washer ? 8 : 4 }, tags: [b, shape] };
  }))),
});

// ---- stacking bins
add({
  file: '50-series-bins', group: 'Bin sizes', section: 'shop', tags: ['bin', 'stacking', 'storage'], generator: 'stack-bin',
  items: cross({ width: [50, 75, 100, 125, 150], depth: [75, 100, 125, 150, 200], height: [30, 50, 70, 100], div: [[1, 1], [2, 1], [1, 2], [2, 2]] }).filter((p) => p.width <= p.depth && p.width / p.div[0] >= 35 && p.depth / p.div[1] >= 40).map(({ div, ...p }) => ({
    id: `bin-${p.width}x${p.depth}x${p.height}${div[0] * div[1] > 1 ? `-${div[0]}x${div[1]}` : ''}`, name: `Stacking bin ${p.width} x ${p.depth} x ${p.height} mm${div[0] * div[1] > 1 ? `, ${div[0] * div[1]} compartments` : ''}`, description: `Stackable bin with an open front. ${p.width} wide, ${p.depth} deep, ${p.height} tall.`,
    params: { ...p, compartmentsX: div[0], compartmentsY: div[1], frontWallHeight: Math.round(p.height * 0.45), labelType: 'slot' }, tags: [`${p.width}x${p.depth}`],
    alts: [{ ...p, compartmentsX: div[0], compartmentsY: div[1], frontWallHeight: Math.round(p.height * 0.45), labelType: 'slot', labelHeight: 10 }, { ...p, compartmentsX: div[0], compartmentsY: div[1], frontWallHeight: Math.round(p.height * 0.45), labelType: 'none' }],
  })),
});

// ---- divided parts boxes
add({
  file: '50-series-boxes', group: 'Divided box sizes', section: 'shop', tags: ['box', 'organizer'], generator: 'parts-box',
  items: cross({ size: [[80, 60], [120, 80], [160, 100], [200, 120]], grid: [[1, 1], [2, 1], [2, 2], [3, 2], [4, 2], [4, 3], [6, 3]], height: [25, 40] }).filter(({ size, grid }) => size[0] / grid[0] >= 18 && size[1] / grid[1] >= 18).map(({ size, grid, height }) => ({
    id: `box-${size[0]}x${size[1]}x${height}-${grid[0]}x${grid[1]}`, name: `Parts box ${size[0]} x ${size[1]} x ${height}, ${grid[0] * grid[1]} compartments`,
    params: { width: size[0], depth: size[1], height, compartmentsX: grid[0], compartmentsY: grid[1] }, tags: [`${grid[0] * grid[1]} compartments`],
  })),
});

// ---- gears
const TEETH = [10, 12, 14, 15, 16, 18, 20, 24, 25, 30, 32, 36, 40, 45, 48, 50, 60, 72, 80];
const gearBore = (pd) => [8, 6, 5, 4, 3, 2, 0].find((b) => b <= pd * 0.45) ?? 0;
add({
  file: '50-series-gears', group: 'Gear sizes', section: 'robotics', tags: ['gear', 'robotics'], generator: 'gear',
  items: [
    ...cross({ module: [0.5, 0.8, 1, 1.25, 1.5, 2, 2.5, 3], teeth: TEETH }).filter((p) => p.module * p.teeth <= 200).map((p) => {
      const pd = p.module * p.teeth;
      const bore = gearBore(pd - 2.5 * p.module);
      return { id: `gear-m${idn(p.module)}-${p.teeth}`, name: `Spur gear module ${f(p.module)}, ${p.teeth} teeth`, description: `Pitch diameter ${f(pd)} mm. ${bore ? `${bore} mm bore.` : 'No bore.'} Gears of the same module mesh at (z1 + z2) x module / 2.`, params: { type: 'spur', module: p.module, teeth: p.teeth, bore, thickness: Math.max(4, Math.round(p.module * 6)) }, tags: [`m${f(p.module)}`, 'spur'], alts: [{ type: 'spur', module: p.module, teeth: p.teeth, bore: 0, thickness: Math.max(4, Math.round(p.module * 6)) }] };
    }),
    ...cross({ type: ['helical', 'herringbone'], module: [1, 1.5, 2], teeth: [12, 16, 20, 24, 30, 36, 40, 48, 60] }).filter((p) => p.module * p.teeth <= 150).map((p) => {
      const pd = p.module * p.teeth;
      const bore = gearBore(pd - 2.5 * p.module);
      return { id: `gear-${p.type}-m${idn(p.module)}-${p.teeth}`, name: `${p.type === 'helical' ? 'Helical' : 'Herringbone'} gear module ${f(p.module)}, ${p.teeth} teeth`, params: { ...p, bore, thickness: Math.round(p.module * 8) }, tags: [p.type, `m${f(p.module)}`], alts: [{ ...p, bore: 0, thickness: Math.round(p.module * 8) }] };
    }),
    ...cross({ module: [0.5, 0.8, 1, 1.25, 1.5, 2, 2.5, 3], teeth: [10, 20, 30, 40] }).filter((p) => Math.PI * p.module * p.teeth <= 200).map((p) => ({ id: `rack-m${idn(p.module)}-${p.teeth}`, name: `Gear rack module ${f(p.module)}, ${p.teeth} teeth`, params: { type: 'rack', module: p.module, teeth: p.teeth, thickness: Math.max(4, Math.round(p.module * 6)), rackHeight: Math.max(5, Math.round(p.module * 5)) }, tags: ['rack', `m${f(p.module)}`] })),
  ],
});

// ---- pulleys
add({
  file: '50-series-pulleys', group: 'Pulley sizes', section: 'robotics', tags: ['pulley', 'gt2', 'belt'], generator: 'pulley',
  items: [
    ...cross({ teeth: [16, 20, 24, 30, 32, 36, 40, 48, 60, 72, 80], bore: [3, 4, 5, 6, 6.35, 8], beltWidth: [6, 9] }).filter((p) => p.bore <= p.teeth * 0.25).map((p) => ({ id: `gt2-${p.teeth}t-${idn(p.bore)}-${p.beltWidth}`, name: `GT2 pulley ${p.teeth} teeth, ${f(p.bore)} mm bore, ${p.beltWidth} mm belt`, description: 'Printed GT2-style pulley (profile approximation). Test belt fit; tune toothFit.', params: { type: 'gt2', ...p, hubDiameter: Math.max(12, Math.round(p.bore * 2 + 6)) }, tags: [`${p.teeth}T`, `${f(p.bore)}mm bore`] })),
    ...cross({ smoothDiameter: [10, 12, 16, 20, 25, 30], bore: [3, 4, 5, 8] }).filter((p) => p.bore <= p.smoothDiameter - 5).map((p) => ({ id: `idler-${p.smoothDiameter}-${idn(p.bore)}`, name: `Smooth idler ${p.smoothDiameter} mm, ${f(p.bore)} mm bore`, params: { type: 'smooth', ...p, setScrew: 0 }, tags: ['idler'] })),
  ],
});

// ---- shaft couplers
const BORES = [2, 3, 3.175, 4, 5, 6, 6.35, 8, 10, 12];
add({
  file: '50-series-couplers', group: 'Coupler sizes', section: 'robotics', tags: ['coupler', 'shaft'], generator: 'shaft-coupler',
  items: BORES.flatMap((a, i) => BORES.slice(i).map((b) => ({ id: `coupler-${idn(a)}-${idn(b)}`, name: `Shaft coupler ${f(a)} to ${f(b)} mm`, params: { boreA: a, boreB: b, outerDiameter: Math.max(14, Math.ceil(Math.max(a, b) * 2 + 8)), length: Math.max(20, Math.ceil((a + b) * 1.6)), setScrew: Math.max(a, b) >= 8 ? 'M4' : 'M3' }, tags: [`${f(a)}mm`, `${f(b)}mm`] }))),
});

// ---- bearing blocks
const BRG = ['608', '623', '625', '688', '6000', '6001', '6801', '6806', '6800', '6802', '6803', '6804', '6805', '6700', '6900', '6002', '6003', '6200', '6201', '6202', '624', '626', '627', '629', '693', '695', 'MR105', 'MR85', 'LM6UU', 'LM8UU', 'LM10UU', 'LM12UU'];
add({
  file: '50-series-bearing-blocks', group: 'Bearing block sizes', section: 'robotics', tags: ['bearing', 'robotics'], generator: 'bearing-block',
  items: BRG.flatMap((bearing) => ['flange', 'pillow'].map((style) => ({ id: `bearing-${style}-${bearing.toLowerCase()}`, name: `${style === 'flange' ? 'Flange' : 'Pillow'} block, ${bearing}`, description: `${style === 'flange' ? 'Flange' : 'Pillow'} block for a ${bearing} bearing (ISO size). Pocket is a slight press fit.`, params: { bearing, style, bolt: ['6806', '6805', '6804', '6003', '6202', 'LM12UU'].includes(bearing) ? 'M4' : 'M3' }, tags: [bearing, style] }))),
});

// ---- knobs
add({
  file: '50-series-knobs', group: 'Knob sizes', section: 'robotics', tags: ['knob'], generator: 'knob',
  items: cross({ diameter: [15, 20, 25, 30, 40, 50], shaftDiameter: [3, 4, 5, 6, 6.35, 8], grip: ['ribs', 'lobes', 'smooth'], shaft: ['d', 'round'] }).filter((p) => p.shaftDiameter <= p.diameter / 2.5).map((p) => ({ id: `knob-${p.diameter}-${idn(p.shaftDiameter)}-${p.grip}${p.shaft === 'round' ? '-round' : ''}`, name: `Knob ${p.diameter} mm, ${f(p.shaftDiameter)} mm ${p.shaft === 'd' ? 'D-shaft' : 'round shaft'}, ${p.grip}`, params: { ...p, dFlat: +(p.shaftDiameter * 0.25).toFixed(2), height: Math.max(10, Math.round(p.diameter * 0.6)), shaftDepth: Math.max(8, Math.round(p.diameter * 0.45)) }, tags: [p.grip] })),
});

// ---- link bars
add({
  file: '50-series-link-bars', group: 'Link bar sizes', section: 'robotics', tags: ['link', 'beam', 'robot'], generator: 'link-bar',
  items: cross({ holes: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15], pitch: [8, 10, 12.7, 15, 20], holeShape: ['round', 'hex', 'slot'] }).filter((p) => (p.holes - 1) * p.pitch <= 200).map((p) => ({ id: `link-${p.holes}h-${idn(p.pitch)}${p.holeShape === 'round' ? '' : `-${p.holeShape}`}`, name: `Link bar ${p.holes} holes, ${f(p.pitch)} mm pitch${p.holeShape === 'round' ? '' : `, ${p.holeShape} holes`}`, params: { ...p, width: Math.max(8, Math.round(p.pitch * 0.9)) }, tags: [`${p.holes} holes`, p.holeShape] })),
});

// ---- holders: bits, batteries, SD / micro SD
const HOLD = [
  ['hex', 6.35, 0, 'Hex bit 1/4 in', 'bits'], ['round', 18.6, 0, '18650 cell', '18650'], ['round', 21.6, 0, '21700 cell', '21700'], ['round', 14.8, 0, 'AA / 14500 cell', 'aa'],
  ['round', 10.8, 0, 'AAA cell', 'aaa'], ['round', 3.4, 0, 'Drill / hex key 3 mm', 'drill'], ['round', 12.4, 0, 'Marker / pen', 'pen'],
];
add({
  file: '50-series-holders', group: 'Holder sizes', section: 'shop', tags: ['holder', 'storage'], generator: 'holder-block',
  items: HOLD.flatMap(([shape, size, size2, label, tag]) => [[2, 1], [3, 1], [4, 1], [2, 2], [3, 2], [4, 2], [4, 3], [6, 4], [8, 4], [10, 5]].map(([c, r]) => ({ id: `holder-${tag}-${c}x${r}`, name: `${label} holder, ${c * r} (${c} x ${r})`, params: { shape, itemSize: size, itemSize2: size2, columns: c, rows: r, pocketDepth: shape === 'round' && size > 14 ? 25 : 12 }, tags: [tag] }))),
});

// ---- hooks
add({
  file: '50-series-hooks', group: 'Hook sizes', section: 'shop', tags: ['hook', 'wall'], generator: 'hook',
  items: cross({ style: ['j', 'straight', 'double'], width: [10, 15, 25], armLength: [25, 50, 75, 100, 125], mount: ['pegboard', 'screw', 'adhesive'] }).map((p) => ({ id: `hook-${p.style}-${p.width}-${p.armLength}-${p.mount}`, name: `${p.style === 'j' ? 'J' : p.style === 'double' ? 'Double' : 'Straight'} hook ${p.armLength} mm, ${p.width} wide, ${p.mount}`, params: p, tags: [p.mount, p.style], alts: [{ ...p, armThickness: 9 }, { ...p, armThickness: 11, gusset: 12 }, { ...p, armThickness: 13, gusset: 16 }] })),
});

// ---- zip-tie anchors
add({
  file: '50-series-zip-tie', group: 'Zip-tie anchor sizes', section: 'accessories', tags: ['zip tie', 'cable'], generator: 'zip-tie-mount',
  items: cross({ tieWidth: [2.5, 3.6, 4.8, 7.6], mount: ['screw', 'two', 'flat'], cross: [false, true] }).map((p) => ({ alts: [{ ...p, size: Math.max(16, Math.round(p.tieWidth * 4)), count: 4 }, { ...p, size: Math.max(20, Math.round(p.tieWidth * 5)), count: 4 }], id: `ziptie-${idn(p.tieWidth)}-${p.mount}${p.cross ? '-cross' : ''}`, name: `Zip-tie anchor ${f(p.tieWidth)} mm tie, ${p.mount === 'two' ? 'two screws' : p.mount}${p.cross ? ', cross' : ''}`, params: { ...p, size: Math.max(12, Math.round(p.tieWidth * 3)), count: 4 }, tags: [`${f(p.tieWidth)}mm`] })),
});

// ---- motor mounts on arm tubes (standard motor bolt patterns)
const PAT = [[9, 9, 'M2'], [12, 12, 'M2'], [16, 16, 'M3'], [16, 19, 'M3'], [19, 19, 'M3'], [25, 25, 'M3'], [30, 30, 'M3']];
add({
  file: '50-series-motor-mounts', group: 'Arm motor mount sizes', section: 'quads', tags: ['motor', 'mount', 'arm'], generator: 'motor-mount',
  items: cross({ tubeShape: ['round', 'square'], tubeSize: [10, 12, 14, 15, 16, 18, 20, 22, 25], pat: PAT }).map(({ tubeShape, tubeSize, pat: [a, b, bolt] }) => ({
    id: `motor-mount-${tubeShape}-${idn(tubeSize)}-${a}x${b}`, name: `Motor mount ${a} x ${b} on ${f(tubeSize)} mm ${tubeShape} arm`, description: `Clamps a ${f(tubeSize)} mm ${tubeShape} arm. Motor holes ${a} x ${b} mm (${bolt}). Check your motor's pattern.`,
    params: { tubeShape, tubeSize, motorPatternA: a, motorPatternB: b, motorBolt: bolt, padDiameter: Math.max(22, Math.ceil(Math.hypot(a, b) / 2 + 9) * 2), centerHole: a <= 9 ? 4 : 8 }, tags: [`${a}x${b}`, tubeShape],
    alts: [{ tubeShape, tubeSize, motorPatternA: a, motorPatternB: b, motorBolt: bolt, padDiameter: Math.max(26, Math.ceil(Math.hypot(a, b) / 2 + 12) * 2), centerHole: a <= 9 ? 4 : 8 }],
  })),
});

// ---- prop guards
add({
  file: '50-series-prop-guards', group: 'Prop guard sizes', section: 'quads', tags: ['prop guard', 'whoop'], generator: 'prop-guard',
  items: cross({ propInches: [2, 2.5, 3, 3.5, 4, 5, 6, 7], pat: [[9, 9, 2.2], [12, 12, 2.2], [16, 19, 3.2]] }).map(({ propInches, pat: [a, b, h] }) => ({ id: `propguard-${idn(propInches)}in-${a}x${b}`, name: `Prop guard ${f(propInches)} in, ${a} x ${b} motor`, params: { propInches, motorPatternA: a, motorPatternB: b, motorHole: h, hubDiameter: Math.max(16, Math.ceil(Math.hypot(a, b) + 8)) }, tags: [`${f(propInches)}in`] })),
});

// ---- landing legs
add({
  file: '50-series-landing-legs', group: 'Landing leg sizes', section: 'quads', tags: ['landing gear', 'leg'], generator: 'landing-leg',
  items: cross({ legLength: [40, 60, 80, 100, 120, 150], mount: ['plate', 'socket'], tubeOD: [8, 10, 12, 16] }).filter((p) => p.mount === 'socket' || p.tubeOD === 10).map((p) => ({ id: `leg-${p.mount}-${p.legLength}${p.mount === 'socket' ? `-${idn(p.tubeOD)}` : ''}`, name: `Landing leg ${p.legLength} mm, ${p.mount === 'socket' ? `${f(p.tubeOD)} mm tube socket` : 'bolt-on plate'}`, params: p, tags: [p.mount] })),
});

// ---- stepper mounts
add({
  file: '50-series-stepper-mounts', group: 'Stepper mount sizes', section: 'robotics', tags: ['stepper', 'nema'], generator: 'stepper-mount',
  items: cross({ size: ['nema11', 'nema14', 'nema17', 'nema23'], style: ['plate', 'bracket'], thickness: [4, 6, 8] }).map((p) => ({ id: `stepper-${p.size}-${p.style}-${p.thickness}`, name: `${p.size.toUpperCase().replace('NEMA', 'NEMA ')} ${p.style}, ${p.thickness} mm`, params: { ...p, baseBolt: p.size === 'nema23' ? 'M5' : 'M3' }, tags: [p.size, p.style] })),
});

// ---- enclosures
add({
  file: '50-series-enclosures', group: 'Enclosure sizes', section: 'robotics', tags: ['enclosure', 'box', 'electronics'], generator: 'enclosure',
  items: cross({ w: [50, 70, 90, 110, 130, 150], d: [40, 60, 80, 100], h: [20, 30, 45] }).filter((p) => p.d <= p.w).map(({ w, d, h }) => ({ id: `enclosure-${w}x${d}x${h}`, name: `Electronics enclosure ${w} x ${d} x ${h} mm inside`, description: 'Box + screw lid, no board standoffs. Add standoffs and a port cutout in the settings.', params: { innerWidth: w, innerDepth: d, innerHeight: h, standoffX: 0, portWall: 'none', vents: Math.max(3, Math.round(w / 15)) }, tags: [`${w}x${d}`] })),
});

// ---- fit test coupons
const INS = [['M2', 3.2, 4.5], ['M2.5', 3.6, 5], ['M3', 4, 5.5], ['M4', 5.6, 6.5], ['M5', 6.4, 7.5]];
add({
  file: '50-series-fit-tests', group: 'Fit tests', section: 'shop', tags: ['calibration', 'fit', 'test'], generator: 'fit-test',
  items: [
    ...INS.flatMap(([b, d, depth]) => [0.1, 0.05].map((step) => ({ id: `fit-insert-${b.toLowerCase().replace('.', 'p')}-${idn(step)}`, name: `Heat-set insert test ${b} (${f(d)} mm, steps ${f(step)})`, description: `Insert holes around ${f(d)} mm, ${f(depth)} mm deep. Common value, UNVERIFIED for your kit: this coupon finds the right size.`, params: { mode: 'insert', nominal: d, depth: depth + 1, step, count: step === 0.1 ? 5 : 7, wall: 2 }, tags: [b, 'insert'], verify: ['nominal', 'depth'] }))),
    ...Object.entries(BOLT_CLEAR).flatMap(([b, d]) => [['clear', d], ['tap', d - (b === 'M2' ? 0.7 : b === 'M5' ? 1.2 : 0.8)]].map(([k, dd]) => ({ id: `fit-hole-${b.toLowerCase().replace('.', 'p')}-${k}`, name: `${b} ${k === 'clear' ? 'clearance' : 'tap (thread into plastic)'} hole test`, params: { mode: 'hole', nominal: +dd.toFixed(2), step: 0.1, count: 5, depth: 5 }, tags: [b, k] }))),
    ...[5, 6, 8, 10, 12, 16, 20].map((d) => ({ id: `fit-tube-${d}`, name: `Tube / shaft bore test ${d} mm`, params: { mode: 'hole', nominal: d + 0.2, step: 0.1, count: 5, depth: 6 }, tags: ['tube', 'bore'] })),
    ...[3, 5, 8].map((d) => ({ id: `fit-peg-${d}`, name: `Peg press-fit test ${d} mm`, params: { mode: 'peg', nominal: d, step: 0.05, count: 7, depth: 6 }, tags: ['peg', 'press fit'] })),
  ],
});

// ---- label cards
add({
  file: '50-series-label-cards', group: 'Label card sizes', section: 'shop', tags: ['label'], generator: 'label-card',
  items: cross({ width: [30, 40, 53, 60, 72, 90], height: [10, 12, 14, 18] }).map((p) => ({ id: `label-${p.width}x${p.height}`, name: `Label card ${p.width} x ${p.height} mm`, params: { ...p, text: 'LABEL', line2: '' }, tags: [`${p.width}x${p.height}`] })),
});

// ---- action-cam and antenna mounts
add({
  file: '50-series-camera-antenna', group: 'Camera and antenna mount sizes', section: 'quads', tags: ['mount'], generator: 'action-cam-mount',
  items: cross({ tilt: [0, 10, 15, 20, 25, 30, 35, 40], baseMount: ['zip', 'screws', 'none'] }).map((p) => ({ alts: [{ ...p, baseLength: 40, baseHoleSpacing: 30 }], id: `gopro-${p.tilt}-${p.baseMount}`, name: `Action cam (GoPro) mount, ${p.tilt} degree tilt, ${p.baseMount === 'zip' ? 'zip-tie' : p.baseMount === 'none' ? 'plain' : 'screw'} base`, params: p, tags: ['gopro', 'action cam'] })),
});
add({
  file: '50-series-antenna', group: 'Camera and antenna mount sizes', section: 'quads', tags: ['antenna', 'sma'], generator: 'antenna-mount',
  items: cross({ count: [1, 2], tilt: [0, 15, 30, 45], baseMount: ['zip', 'screws'] }).map((p) => ({ id: `antenna-${p.count}-${p.tilt}-${p.baseMount}`, name: `SMA antenna mount, ${p.count === 2 ? 'two antennas' : 'one antenna'}, ${p.tilt} degrees, ${p.baseMount === 'zip' ? 'zip-tie' : 'screw'} base`, params: p, tags: ['sma', 'rp-sma', 'lora', 'vtx'] })),
});
add({
  file: '50-series-fpv-cams', group: 'Camera and antenna mount sizes', section: 'quads', tags: ['fpv', 'camera'], generator: 'camera-mount',
  items: cross({ cameraWidth: [14, 19, 21], baseMount: ['screws', 'zip'], depth: [12, 16, 20] }).map((p) => ({ id: `fpvcam-${p.cameraWidth}-${p.baseMount}-${p.depth}`, name: `FPV camera mount ${p.cameraWidth} mm (${p.cameraWidth === 14 ? 'nano' : p.cameraWidth === 19 ? 'micro' : 'mini'}), ${p.baseMount} base, ${p.depth} deep`, params: { ...p, sideScrew: 'M2' }, tags: [`${p.cameraWidth}mm`] })),
});

// ---- extrusion brackets and motor clamps
add({
  file: '50-series-extrusion', group: 'Extrusion bracket sizes', section: 'robotics', tags: ['extrusion', 't-slot'], generator: 'extrusion-bracket',
  items: cross({ profile: ['2020', '3030', '4040'], type: ['corner', 'straight', 'tee'], holesPerLeg: [1, 2, 3] }).filter((p) => (p.type === 'tee' ? (2 * p.holesPerLeg + 1) : 2 * p.holesPerLeg) * Number(p.profile.slice(0, 2)) <= 200).map((p) => ({ id: `ext-${p.profile}-${p.type}-${p.holesPerLeg}`, name: `${p.profile} ${p.type} bracket, ${p.holesPerLeg} hole${p.holesPerLeg > 1 ? 's' : ''} per leg`, params: { ...p, thickness: p.profile === '4040' ? 6 : p.profile === '3030' ? 5 : 4 }, tags: [p.profile, p.type] })),
});
add({
  file: '50-series-motor-clamps', group: 'Motor clamp sizes', section: 'robotics', tags: ['motor', 'clamp'], generator: 'motor-clamp',
  items: [6, 8, 10, 12, 15, 16, 20, 24, 25, 28, 32, 35, 37, 42].map((d) => ({ id: `motor-clamp-${d}`, name: `Round motor clamp ${d} mm`, params: { bodyDiameter: d, flatHeight: 0, clampLength: Math.max(8, Math.round(d * 0.5)), capBolt: d >= 15 ? 'M3' : 'M2', wall: d >= 30 ? 3 : 2.5 }, tags: [`${d}mm`], verify: ['bodyDiameter'] })),
});


// ---- v7 more series: frames, wheels, hinges, horns, formers, trays, cutouts, racks, masts, damper / FC plates
add({
  file: '50-series-frames', group: 'Frame sizes', section: 'quads', tags: ['frame', 'multirotor'], generator: 'multirotor-frame',
  items: cross({ arms: [3, 4, 6], wheelbase: [100, 120, 150, 180, 220, 250, 280, 330, 380, 450], pat: [[9, 9, 'M2'], [12, 12, 'M2'], [16, 16, 'M3'], [16, 19, 'M3']] }).map(({ arms, wheelbase, pat: [a, b, bolt] }) => {
    const prop = Math.max(2, Math.min(10, Math.floor((wheelbase * Math.sin(Math.PI / arms)) / 25.4 * 0.9)));
    return { id: `frame-${arms}arm-${wheelbase}-${a}x${b}`, name: `${arms === 3 ? 'Tri' : arms === 4 ? 'Quad' : 'Hex'} frame ${wheelbase} mm, ${a} x ${b} motors`, description: `${wheelbase} mm motor-to-motor, ${arms} arms, props up to about ${prop} in. Printed frames suit light builds; check stiffness.`, params: { arms, wheelbase, propInches: prop, motorPatternA: a, motorPatternB: b, motorBolt: bolt, motorPad: Math.max(14, Math.ceil(Math.hypot(a, b) + 8)), motorCenterHole: a <= 9 ? 4 : 7 }, tags: [`${arms} arms`, `${wheelbase}mm`] };
  }),
});
add({
  file: '50-series-wheels', group: 'Wheel sizes', section: 'planes', tags: ['wheel'], generator: 'rc-wheel',
  items: cross({ diameter: [25, 30, 40, 50, 60, 70, 80, 100], axleHole: [2.2, 3.2, 4.2, 5.2], style: ['solid', 'spoked'] }).filter((p) => p.axleHole <= p.diameter / 8).map((p) => ({ id: `wheel-${p.diameter}-${idn(p.axleHole)}-${p.style}`, name: `Wheel ${p.diameter} mm, ${f(p.axleHole)} mm axle, ${p.style}`, params: { ...p, width: Math.max(8, Math.round(p.diameter * 0.3)), hubDiameter: Math.max(8, Math.round(p.axleHole * 3)) }, tags: [`${p.diameter}mm`, p.style] })),
});
add({
  file: '50-series-hinges', group: 'Hinge sizes', section: 'planes', tags: ['hinge'], generator: 'pin-hinge',
  items: cross({ length: [20, 30, 40, 50, 60, 80, 100], knuckleDiameter: [3, 4, 5, 6], pinHole: [1.1, 1.8] }).filter((p) => p.pinHole <= p.knuckleDiameter - 1.6).map((p) => ({ id: `hinge-${p.length}-${p.knuckleDiameter}-${idn(p.pinHole)}`, name: `Pin hinge ${p.length} mm, ${p.knuckleDiameter} mm knuckle, ${p.pinHole > 1.5 ? 'filament' : '1 mm wire'} pin`, params: { ...p, knuckles: p.length >= 60 ? 7 : 5, leafWidth: Math.max(8, p.knuckleDiameter * 2.5) }, tags: [`${p.length}mm`] })),
});
add({
  file: '50-series-control-horns', group: 'Control horn sizes', section: 'planes', tags: ['control horn'], generator: 'control-horn',
  items: cross({ hornHeight: [10, 14, 18, 22, 28], holes: [2, 3, 4, 5], holeDiameter: [1.1, 1.6, 2.1] }).map((p) => ({ id: `horn-${p.hornHeight}-${p.holes}-${idn(p.holeDiameter)}`, name: `Control horn ${p.hornHeight} mm, ${p.holes} holes, ${f(p.holeDiameter)} mm`, params: { ...p, holeSpacing: Math.max(2.5, +(p.holeDiameter * 2).toFixed(1)) }, tags: [`${p.hornHeight}mm`] })),
});
add({
  file: '50-series-formers', group: 'Former sizes', section: 'planes', tags: ['former', 'fuselage'], generator: 'fuselage-former',
  items: cross({ shape: ['rect', 'rounded', 'oval'], width: [40, 50, 60, 70, 80, 100, 120], height: [40, 60, 80, 100] }).map((p) => ({ id: `former-${p.shape}-${p.width}x${p.height}`, name: `Fuselage former ${p.shape}, ${p.width} x ${p.height} mm`, params: p, tags: [p.shape] })),
});
add({
  file: '50-series-trays', group: 'Tray sizes on a tube', section: 'quads', tags: ['tray', 'esc', 'receiver', 'tube'], generator: 'component-mount',
  items: cross({ item: [[12, 25, 6], [16, 32, 8], [20, 45, 10], [25, 55, 12], [30, 60, 14], [35, 70, 20]], tubeOD: [10, 12, 16, 20, 22, 25], base: ['saddle', 'clamp-kit'] }).map(({ item: [w, l, h], tubeOD, base }) => ({ id: `tray-${w}x${l}-${base}-${idn(tubeOD)}`, name: `Tray ${w} x ${l} mm on a ${f(tubeOD)} mm tube, ${base === 'saddle' ? 'zip-tie saddle' : 'bolt-on clamp'}`, description: `For an ESC, receiver, BEC or VTX about ${w} x ${l} x ${h} mm. Measure your part.`, params: { holder: 'tray', itemWidth: w, itemLength: l, itemHeight: h, tubeOD, base, clampType: 'two-piece' }, tags: [`${f(tubeOD)}mm`, base], alts: [{ holder: 'tray', itemWidth: w, itemLength: l, itemHeight: h, tubeOD, base, clampType: 'mount' }, { holder: 'tray', itemWidth: Math.max(w, tubeOD + 2), itemLength: l, itemHeight: h, tubeOD, base, clampType: 'mount' }] })),
});
add({
  file: '50-series-panel-cutouts', group: 'Panel cutout sizes', section: 'accessories', tags: ['panel', 'connector'], generator: 'connector-mount',
  items: [
    ...[[8, 4], [9, 3.5], [10, 5], [12, 6], [14, 7], [16, 8.5], [20, 10], [25, 12], [30, 15]].map(([w, h]) => ({ id: `cutout-rect-${idn(w)}x${idn(h)}`, name: `Panel plate, ${f(w)} x ${f(h)} mm rectangular cutout`, description: 'Generic rectangular cutout plate (USB, XT-style power, switches). Measure your connector.', params: { cutoutShape: 'rect', cutoutWidth: w, cutoutHeight: h, plateWidth: w + 20, plateHeight: Math.max(14, h + 10), holeSpacing: w + 12 }, tags: ['rect'], verify: ['cutoutWidth', 'cutoutHeight'] })),
    ...[5, 6.5, 8, 10, 12, 16, 19, 22].map((d) => ({ id: `cutout-round-${idn(d)}`, name: `Panel plate, ${f(d)} mm round hole`, description: d === 6.5 ? 'SMA / RP-SMA bulkhead (1/4 in thread).' : 'Generic round hole (switches, glands, LEDs).', params: { cutoutShape: 'round', cutoutWidth: d, cutoutHeight: d, plateWidth: d + 20, plateHeight: d + 10, holeSpacing: d + 12 }, tags: ['round'] })),
  ],
});
add({
  file: '50-series-tool-racks', group: 'Tool rack sizes', section: 'shop', tags: ['tool rack', 'pegboard'], generator: 'tool-rack',
  items: cross({ holeShape: ['round', 'hex', 'slot'], holeSize: [4, 6, 9, 12, 16], holeCount: [4, 6, 8, 10], mount: ['pegboard', 'screw'] }).map((p) => ({ id: `rack-${p.holeShape}-${p.holeSize}-${p.holeCount}-${p.mount}`, name: `Tool rack, ${p.holeCount} ${p.holeShape} holes ${p.holeSize} mm, ${p.mount}`, params: { ...p, width: Math.min(200, Math.max(60, p.holeCount * (p.holeSize + (p.holeShape === 'slot' ? 12 : 8)) + 10)) }, tags: [p.holeShape, p.mount] })),
});
add({
  file: '50-series-gps-masts', group: 'GPS mast sizes', section: 'quads', tags: ['gps', 'mast'], generator: 'gps-mast',
  items: cross({ mast: ['tube', 'printed'], mastHeight: [30, 50, 75, 100, 125, 150], base: [[30.5, 'M3'], [20, 'M2']] }).map(({ mast, mastHeight, base: [s, b] }) => ({ id: `gps-mast-${mast}-${mastHeight}-${idn(s)}`, name: `GPS mast ${mastHeight} mm, ${mast === 'tube' ? 'tube' : 'printed'} mast, ${f(s)} mm base`, params: { mast, mastHeight, baseHoleSpacing: s, baseBolt: b, baseSize: s + 8 }, tags: [mast] })),
});
add({
  file: '50-series-fc-plates', group: 'FC adapter sizes', section: 'quads', tags: ['fc', 'stack', 'adapter'], generator: 'fc-adapter',
  items: [[30.5, 20], [30.5, 25.5], [25.5, 20], [20, 16], [30.5, 16], [45, 30.5], [20, 30.5], [16, 20]].flatMap(([o, i]) => [0, 45].map((rot) => ({ id: `fc-adapter-${idn(o)}-${idn(i)}-${rot}`, name: `FC adapter ${f(o)} to ${f(i)} mm${rot ? ', turned 45 degrees' : ''}`, params: { outerPattern: o, innerPattern: i, innerRotate: rot, outerHole: o >= 25 ? 3.4 : 2.4, innerHole: i >= 25 ? 2.6 : i >= 20 ? 1.7 : 1.7 }, tags: [`${f(o)}`, `${f(i)}`] }))),
});
add({
  file: '50-series-damper-plates', group: 'Damper plate sizes', section: 'quads', tags: ['damper', 'gimbal', 'vibration'], generator: 'damper-plate',
  items: cross({ balls: [[30, 30], [40, 30], [50, 40], [60, 45], [70, 50]], top: [20, 30.5] }).map(({ balls: [x, y], top }) => ({ id: `damper-${x}x${y}-${idn(top)}`, name: `Damper plate, balls ${x} x ${y}, ${f(top)} mm board`, params: { ballSpacingX: x, ballSpacingY: y, topHoleSpacing: top }, tags: ['damper'], verify: ['ballHole'] })),
});

// ---------------------------------------------------------------- build

const existing = new Map(); // generator|params -> preset id (hand-written presets)
const handIds = new Set(); // ids of hand-written presets: a series id that clashes gets "-s" added
for (const file of readdirSync(join(ROOT, 'presets')).filter((x) => x.endsWith('.json') && !x.startsWith('50-series'))) {
  for (const p of JSON.parse(readFileSync(join(ROOT, 'presets', file), 'utf8')).presets ?? []) {
    handIds.add(p.id);
    try { existing.set(`${p.generator}|${JSON.stringify(resolveParams(getGenerator(p.generator).params, p.params ?? {}))}`, p.id); } catch { /* checked by the app */ }
  }
}

let kept = 0, dropped = 0;
const usedIds = new Set();
for (const s of SERIES) {
  if (only && !s.file.includes(only)) continue;
  const g = getGenerator(s.generator);
  const out = [];
  const t0 = Date.now();
  for (const it of s.items) {
    let ok = null;
    let why = '';
    for (const params of [it.params, ...(it.alts ?? [])]) {
      let resolved;
      try { resolved = resolveParams(g.params, params); } catch (err) { why = err.message; continue; }
      const key = `${g.id}|${JSON.stringify(resolved)}`;
      if (existing.has(key)) { why = `same as ${existing.get(key)}`; ok = null; break; }
      try {
        const r = await generate(g.id, params);
        const real = r.warnings.filter((w) => !ADVISORY.some((re) => re.test(w)));
        if (real.length) { why = real[0]; continue; }
        it.advisory = r.warnings.filter((w) => ADVISORY.some((re) => re.test(w)));
        const bad = r.parts.find((pt) => openEdgeCount(pt.mesh) || stlEdgeIssues(pt.mesh));
        if (bad) { why = `mesh issue in ${bad.name}`; continue; }
        const big = r.parts.find((pt) => !fitsBed(meshStats(pt.mesh).size, BED).fits);
        if (big) { why = `${big.name} larger than the SV07 bed`; continue; }
        existing.set(key, it.id);
        ok = params;
        break;
      } catch (err) { why = err.message; }
    }
    if (handIds.has(it.id)) it.id = `${it.id}-s`;
    if (!ok || usedIds.has(it.id)) { dropped++; if (process.env.VERBOSE) console.log(`  drop ${it.id}: ${why}`); continue; }
    usedIds.add(it.id);
    out.push({ id: it.id, name: it.name, generator: g.id, description: [it.description ?? `${it.name}.`, ...(it.advisory ?? [])].join(' '), tags: [...new Set([...(s.tags ?? []), ...(it.tags ?? [])])], params: ok, series: s.file.replace(/^50-series-/, ''), ...(it.verify ? { verify: it.verify } : {}) });
  }
  kept += out.length;
  writeFileSync(join(ROOT, 'presets', `${s.file}.json`), JSON.stringify({ group: s.group, section: s.section, generatedBy: 'scripts/build-series.mjs (do not edit by hand)', presets: out }, null, 1) + '\n');
  console.log(`${s.file}: ${out.length} of ${s.items.length} kept (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
console.log(`total kept ${kept}, dropped ${dropped}`);
