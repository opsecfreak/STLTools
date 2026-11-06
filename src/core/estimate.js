// Print time and filament estimate from a part's geometry and a printer profile.
//
// This file has NO Node imports: the server uses it (project ZIP README, API)
// and the browser loads the same file from /shared/estimate.js, so the number
// in the 3D view and the number in a project are always computed the same way.
//
// How it works (a simple slicer model, not a slicer):
//   1. Walls:      vertical surface area x wall count x line width
//   2. Top/bottom: flat surface area x shell layers x layer height
//   3. Infill:     what is left of the volume x infill %
//   4. Time:       each volume / flow rate (line width x layer height x speed),
//                  capped by the hotend's max volumetric flow, divided by the
//                  profile's motion efficiency (acceleration, corners, short
//                  moves), plus a fixed overhead per layer (travel, retracts)
//                  and the first layer at first-layer speed.
//   5. Calibration: x timeFactor from Settings (compare one print with your
//                  slicer and set the factor; see docs/PRINT-ESTIMATES.md).
//
// Expect about +/- 25 % before calibration. The slicer's estimate (shown on
// the Printers page for uploaded G-code) is the real number.
//
// Inputs:
//   stats    { size: [x, y, z], volumeMm3, areaMm2, flatAreaMm2, bedAreaMm2 }  (from meshStats)
//   profile  a printer profile (printer-profiles/*.json)
//   opts     { layerHeight, walls, shellLayers, infill, material, timeFactor, filamentCostPerKg }

export const MATERIALS = {
  pla: { name: 'PLA', density: 1.24 },
  petg: { name: 'PETG', density: 1.27 },
  abs: { name: 'ABS', density: 1.04 },
  asa: { name: 'ASA', density: 1.07 },
  tpu: { name: 'TPU', density: 1.21, speedFactor: 0.35 },
  'pla-cf': { name: 'PLA-CF', density: 1.3 },
  'petg-cf': { name: 'PETG-CF', density: 1.3 },
  nylon: { name: 'Nylon', density: 1.14 },
};

export const DEFAULT_PRINT_OPTS = { layerHeight: 0.2, walls: 3, shellLayers: 4, infill: 15, material: 'pla', timeFactor: 1, filamentCostPerKg: null };

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Does a part of this size fit the bed? Tries the part turned 90 degrees too. */
export function fitsBed(size, bed) {
  if (!bed) return { fits: true, rotated: false };
  const [x, y, z] = size;
  if (z > bed.z) return { fits: false, rotated: false, reason: `${z.toFixed(0)} mm tall, the build height is ${bed.z} mm` };
  if (x <= bed.x && y <= bed.y) return { fits: true, rotated: false };
  if (y <= bed.x && x <= bed.y) return { fits: true, rotated: true };
  // diagonal placement is possible but not worth trusting for a warning
  return { fits: false, rotated: false, reason: `${x.toFixed(0)} x ${y.toFixed(0)} mm footprint, the bed is ${bed.x} x ${bed.y} mm` };
}

/** Estimate one part. Returns { seconds, filamentMm, grams, cost, layers, fit, breakdown }. */
export function estimatePart(stats, profile, opts = {}) {
  const o = { ...DEFAULT_PRINT_OPTS, ...opts };
  const mat = MATERIALS[o.material] ?? MATERIALS.pla;
  const nozzle = num(profile?.nozzle, 0.4);
  const lw = num(profile?.lineWidth, nozzle * 1.125);
  const lh = Math.max(0.04, num(o.layerHeight, 0.2));
  const sp = { outerWall: 60, innerWall: 80, infill: 100, topBottom: 60, firstLayer: 30, ...(profile?.speeds ?? {}) };
  const speedFactor = mat.speedFactor ?? 1;
  const maxFlow = num(profile?.maxVolumetricFlow, 12) * (mat.speedFactor ?? 1);
  const eff = Math.min(1, Math.max(0.2, num(profile?.motionEfficiency, 0.7)));
  const layerOverhead = num(profile?.layerOverheadSeconds, 1.5);

  const V = Math.max(0, num(stats.volumeMm3, 0));
  const A = Math.max(0, num(stats.areaMm2, 0));
  const Af = Math.min(A, Math.max(0, num(stats.flatAreaMm2, 0)));
  const Av = A - Af;
  const Abed = Math.max(0, num(stats.bedAreaMm2, 0));
  const height = Math.max(lh, num(stats.size?.[2], lh));
  const layers = Math.ceil(height / lh);

  // volumes (mm3), each capped so the sum never exceeds the solid volume
  const outerVol = Math.min(V, Av * lw);
  const innerVol = Math.min(V - outerVol, Av * lw * Math.max(0, o.walls - 1));
  const skinVol = Math.min(V - outerVol - innerVol, Af * o.shellLayers * lh);
  const infillVol = Math.max(0, V - outerVol - innerVol - skinVol) * Math.min(1, Math.max(0, o.infill / 100));
  const firstVol = Math.min(V, Abed * lh);

  const rate = (speed) => Math.min(lw * lh * speed * speedFactor, maxFlow); // mm3 / s
  const tOuter = outerVol / rate(sp.outerWall);
  const tInner = innerVol / rate(sp.innerWall);
  const tSkin = skinVol / rate(sp.topBottom);
  const tInfill = infillVol / rate(sp.infill);
  // first layer runs slower: add the difference for its share of the volume
  const tFirst = Math.max(0, firstVol / rate(sp.firstLayer) - firstVol / rate(sp.topBottom));
  const moving = (tOuter + tInner + tSkin + tInfill + tFirst) / eff;
  const seconds = (moving + layers * layerOverhead) * Math.max(0.1, num(o.timeFactor, 1));

  const extruded = outerVol + innerVol + skinVol + infillVol;
  const fd = num(profile?.filamentDiameter, 1.75);
  const filamentMm = extruded / (Math.PI * (fd / 2) ** 2);
  const grams = (extruded / 1000) * mat.density;
  const cost = o.filamentCostPerKg ? (grams / 1000) * o.filamentCostPerKg : null;
  return {
    seconds, filamentMm, grams, cost, layers,
    fit: fitsBed(stats.size ?? [0, 0, 0], profile?.bed),
    breakdown: { walls: tOuter + tInner, topBottom: tSkin, infill: tInfill, firstLayerExtra: tFirst, overhead: layers * layerOverhead, efficiency: eff },
  };
}

/** Estimate several parts printed one after another on one plate (heat-up counted once). */
export function estimateParts(statsList, profile, opts = {}, qty = null) {
  let seconds = 0;
  let filamentMm = 0;
  let grams = 0;
  let cost = 0;
  let hasCost = false;
  const parts = statsList.map((s, i) => {
    const e = estimatePart(s, profile, opts);
    const n = qty?.[i] ?? 1;
    seconds += e.seconds * n;
    filamentMm += e.filamentMm * n;
    grams += e.grams * n;
    if (e.cost !== null) { cost += e.cost * n; hasCost = true; }
    return e;
  });
  const heatUp = statsList.length ? num(profile?.heatUpSeconds, 150) : 0;
  return { seconds: seconds + heatUp, heatUp, filamentMm, grams, cost: hasCost ? cost : null, parts };
}

/**
 * A profile with the connected printer's own Klipper values (read-only query of
 * toolhead + configfile, see src/core/printers.js machine()). Bed size, nozzle and
 * filament come from the printer; speeds are capped at its max_velocity; motion
 * efficiency moves with its max_accel against the profile's acceleration.
 * Values the printer did not report keep the profile's numbers.
 *   machine: { bed: {x,y,z}, maxVelocity, maxAccel, nozzle, filamentDiameter, readAt }
 */
export function profileFromMachine(base, machine, printerName = 'printer') {
  if (!machine) return base;
  const b = base ?? {};
  const okBed = machine.bed && [machine.bed.x, machine.bed.y, machine.bed.z].every((v) => Number.isFinite(v) && v > 10 && v < 3000);
  const vmax = num(machine.maxVelocity, 0);
  const speeds = { ...(b.speeds ?? {}) };
  if (vmax > 0) for (const k of Object.keys(speeds)) speeds[k] = Math.min(speeds[k], vmax);
  const amax = num(machine.maxAccel, 0);
  const baseAcc = num(b.acceleration, 0);
  let eff = num(b.motionEfficiency, 0.7);
  if (amax > 0 && baseAcc > 0) eff = Math.min(0.9, Math.max(0.2, eff * Math.min(1.25, Math.max(0.6, Math.sqrt(amax / baseAcc)))));
  return {
    ...b,
    id: `${b.id ?? 'profile'}@printer`,
    name: `${printerName} (${b.name ?? 'profile'} + values from the printer)`,
    bed: okBed ? { x: machine.bed.x, y: machine.bed.y, z: machine.bed.z } : b.bed,
    nozzle: num(machine.nozzle, b.nozzle ?? 0.4),
    lineWidth: machine.nozzle && b.nozzle && machine.nozzle !== b.nozzle ? undefined : b.lineWidth,
    filamentDiameter: num(machine.filamentDiameter, b.filamentDiameter ?? 1.75),
    speeds,
    acceleration: amax || b.acceleration,
    motionEfficiency: eff,
    fromMachine: { readAt: machine.readAt ?? null, maxVelocity: vmax || null, maxAccel: amax || null },
  };
}

export function formatDuration(sec) {
  if (!Number.isFinite(sec)) return '-';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${Math.max(1, m)} min`;
}
