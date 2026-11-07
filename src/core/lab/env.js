// Environment checks for printed parts (browser and Node; no imports).
// Only data-backed or user-entered numbers: when a material has no value, the check
// says "no data" instead of guessing.
//
//   heatCheck(material, serviceC, maxStressMPa, marginC)  against the datasheet HDT / Tg
//   uvTimeline(retainedPerYear, years)                    strength retained over years (user's rate)
//   moisture(material)                                    datasheet water uptake, drying advice
//   fatigueLife(stressAmplitude, sfPrime, b)              Basquin: cycles to failure (user's S-N data)
//   dropAccel(heightM, stopMm)                            peak deceleration of a drop, in g

/**
 * Heat: compare the hottest service temperature with the material's heat deflection
 * temperature (HDT, ISO 75 / GB/T 1634). HDT is measured at 0.45 MPa (and 1.8 MPa) bending
 * stress, so the 1.8 MPa value is used once the part's stress exceeds 0.45 MPa; above
 * 1.8 MPa the datasheet does not cover it (flagged).
 * -> { level: ok|caution|fail|nodata, limitC, basis, text }
 */
export function heatCheck(m, serviceC, maxStressMPa = 0, marginC = 10) {
  const t = Number(serviceC);
  const hdt045 = m?.hdt045 ?? null, hdt18 = m?.hdt18 ?? null;
  let limit = null, basis = '';
  if (maxStressMPa > 0.45 && hdt18 !== null) { limit = hdt18; basis = 'HDT at 1.8 MPa'; }
  else if (hdt045 !== null) { limit = hdt045; basis = maxStressMPa > 0.45 ? 'HDT at 0.45 MPa (no 1.8 MPa value on the datasheet: real limit is lower)' : 'HDT at 0.45 MPa'; }
  else if (m?.tg) { limit = m.tg; basis = 'glass transition (no HDT on the datasheet)'; }
  if (limit === null) return { level: 'nodata', limitC: null, basis: '', text: `${m?.product ?? 'This material'} has no HDT or Tg on its datasheet: add one to check heat.` };
  const over18 = maxStressMPa > 1.8;
  const level = t >= limit ? 'fail' : t >= limit - marginC || over18 ? 'caution' : 'ok';
  const text = level === 'fail'
    ? `${t} C is at or above the ${basis} (${limit} C): the part will soften and sag under load.`
    : level === 'caution'
      ? `${t} C is within ${marginC} C of the ${basis} (${limit} C)${over18 ? `, and the stress (${maxStressMPa.toFixed(1)} MPa) is above the 1.8 MPa test load` : ''}: expect creep; use a higher-temperature material or lower the load.`
      : `${t} C is ${(limit - t).toFixed(0)} C below the ${basis} (${limit} C).`;
  return { level, limitC: limit, basis, text };
}

/**
 * Sunlight (UV) over time from the user's retention rate: the fraction of strength left
 * after one year outdoors (a measured or published value for that material). Exponential
 * decay: retained(t) = r^t. -> [{ year, retained, yellowing (0..1, for the color only) }] or null without a rate.
 */
export function uvTimeline(retainedPerYear, years = 5, steps = 20) {
  const r = Number(retainedPerYear);
  if (!(r > 0 && r <= 1)) return null;
  return Array.from({ length: steps + 1 }, (_, k) => {
    const year = (years * k) / steps;
    const retained = r ** year;
    return { year, retained, yellowing: Math.min(1, 1 - retained) };
  });
}

/** Water uptake from the datasheet plus advice by material type (dry before printing). */
export function moisture(m) {
  const notes = [];
  if (m?.moisture) notes.push(`Datasheet water uptake: ${Object.entries(m.moisture).map(([k, v]) => `${v} % after ${k}`).join(', ')}.`);
  if (m?.drying) notes.push(`Drying (datasheet): ${m.drying}.`);
  const type = String(m?.type ?? '').toUpperCase();
  if (/^PA/.test(type)) notes.push('Nylon takes up water from the air within hours: dry it before printing and expect its stiffness to change with humidity in use.');
  if (/PETG|PLA|ABS|ASA/.test(type) && !m?.moisture) notes.push('No water uptake value on this datasheet.');
  return { notes, data: m?.moisture ?? null };
}

/** Basquin: stress amplitude = sfPrime x (2N)^b  ->  N. sfPrime in MPa, b negative (both from S-N tests). */
export function fatigueLife(stressAmplitude, sfPrime, b) {
  const s = Number(stressAmplitude), f = Number(sfPrime), e = Number(b);
  if (!(s > 0 && f > 0 && e < 0)) return null;
  if (s >= f) return 0.5;
  return 0.5 * (s / f) ** (1 / e);
}

/** A drop from heightM onto a surface that stops the part within stopMm: peak deceleration in g (energy balance). */
export function dropAccel(heightM, stopMm) {
  const h = Number(heightM), d = Number(stopMm) / 1000;
  if (!(h >= 0 && d > 0)) return null;
  return 1 + h / d;
}
