import { naca4Outline, sectionAt } from '../core/airfoil.js';

const deg = (d) => (d * Math.PI) / 180;

// Print orientation: span along +Z (root face on the bed), chord along +X
// (leading edge at the low-X side, trailing edge toward +X), thickness along +Y (upper surface toward +Y).

/**
 * Build the wing planform description. All lengths in mm.
 * Everything varies linearly from root (s = 0) to tip (s = halfSpan).
 */
function planform(p) {
  const tanSweep = Math.tan(deg(p.sweep));
  return {
    chordAt: (s) => p.rootChord + (p.tipChord - p.rootChord) * (s / p.halfSpan),
    leAt: (s) => s * tanSweep,
    twistAt: (s) => deg(p.washout) * (s / p.halfSpan),
  };
}

/**
 * Point on a spar line at span station s: chord fraction f on the camber line,
 * with the same twist about the main spar pivot that the skin gets.
 */
function sparPointAt(pf, p, f, s) {
  const c = pf.chordAt(s);
  const pivotX = p.sparPosition / 100;
  const pivotY = sectionAt(p.airfoil, pivotX).camber;
  const dx = (f - pivotX) * c;
  const dy = (sectionAt(p.airfoil, f).camber - pivotY) * c;
  const tw = pf.twistAt(s);
  return [
    pf.leAt(s) + pivotX * c + dx * Math.cos(tw) - dy * Math.sin(tw),
    pivotY * c + dx * Math.sin(tw) + dy * Math.cos(tw),
    s,
  ];
}

export default {
  id: 'rc-wing',
  name: 'RC Wing Panel',
  description: 'Tapered NACA 4-digit wing half with spar tube holes, split into sections that fit your printer. Prints root-down.',
  params: {
    airfoil: { type: 'string', default: '2412', pattern: '^\\d{4}$', label: 'NACA 4-digit airfoil', group: 'Airfoil', help: 'e.g. 2412 trainer, 4412 high lift, 0012 symmetric/aerobatic.' },
    airfoilPoints: { type: 'integer', default: 60, min: 20, max: 200, label: 'Points per surface', group: 'Airfoil' },
    minTrailingEdge: { type: 'number', default: 0.8, min: 0.2, max: 3, step: 0.1, unit: 'mm', label: 'Min trailing edge thickness', group: 'Airfoil', help: 'About 2 nozzle widths so the slicer can print it.' },

    halfSpan: { type: 'number', default: 400, min: 50, max: 2000, step: 5, unit: 'mm', label: 'Half span (root to tip)', group: 'Planform' },
    rootChord: { type: 'number', default: 180, min: 30, max: 600, step: 1, unit: 'mm', label: 'Root chord', group: 'Planform' },
    tipChord: { type: 'number', default: 130, min: 20, max: 600, step: 1, unit: 'mm', label: 'Tip chord', group: 'Planform' },
    sweep: { type: 'number', default: 0, min: -30, max: 45, step: 0.5, unit: 'deg', label: 'Leading edge sweep', group: 'Planform' },
    washout: { type: 'number', default: 0, min: -5, max: 8, step: 0.5, unit: 'deg', label: 'Tip washout (nose down)', group: 'Planform', help: 'Reduces tip stall. 1-3 deg is typical.' },

    sparDiameter: { type: 'number', default: 8.2, min: 0, max: 30, step: 0.1, unit: 'mm', label: 'Main spar hole diameter (0 = none)', group: 'Spars', help: 'Tube OD plus 0.1-0.2 mm.' },
    sparPosition: { type: 'number', default: 25, min: 10, max: 60, step: 1, unit: '% chord', label: 'Main spar position', group: 'Spars' },
    sparLength: { type: 'number', default: 70, min: 5, max: 100, step: 1, unit: '% span', label: 'Main spar length from root', group: 'Spars' },
    rearSparDiameter: { type: 'number', default: 3.1, min: 0, max: 20, step: 0.1, unit: 'mm', label: 'Rear spar hole diameter (0 = none)', group: 'Spars', help: 'Anti-rotation rod.' },
    rearSparPosition: { type: 'number', default: 60, min: 30, max: 85, step: 1, unit: '% chord', label: 'Rear spar position', group: 'Spars' },
    rearSparLength: { type: 'number', default: 25, min: 5, max: 100, step: 1, unit: '% span', label: 'Rear spar length from root', group: 'Spars' },

    maxSectionHeight: { type: 'number', default: 200, min: 30, max: 1000, step: 5, unit: 'mm', label: 'Max section length (printer Z)', group: 'Printing' },
    bothSides: { type: 'boolean', default: false, label: 'Also output mirrored left panel', group: 'Printing' },
    holeSegments: { type: 'integer', default: 32, min: 8, max: 96, label: 'Spar hole smoothness', group: 'Quality' },
  },

  generate(p, k) {
    const warnings = [];
    const notes = [];

    if (p.tipChord > p.rootChord * 1.5) warnings.push('Tip chord is much larger than root chord. Check the inputs.');

    const outline = naca4Outline(p.airfoil, p.airfoilPoints, p.minTrailingEdge / p.rootChord);
    const pf = planform(p);
    const nSections = Math.ceil(p.halfSpan / p.maxSectionHeight - 1e-9);
    const sectionLen = p.halfSpan / nSections;
    // extra cross-sections only matter when the panel is twisted
    const slicesPerSection = p.washout !== 0 ? 8 : 0;

    // Root airfoil in mm, origin on the main spar pivot (twist axis).
    const pivotX = p.sparPosition / 100;
    const pivotY = sectionAt(p.airfoil, pivotX).camber;
    const rootSection = k.polygon(outline.map(([x, y]) => [(x - pivotX) * p.rootChord, (y - pivotY) * p.rootChord]));

    // Spar lines (full panel coordinates)
    const spars = [];
    const addSpar = (name, dia, posPct, lenPct) => {
      if (dia <= 0) return;
      const f = posPct / 100;
      const sEnd = (p.halfSpan * lenPct) / 100;
      const a = sparPointAt(pf, p, f, 0);
      const b = sparPointAt(pf, p, f, sEnd);
      // wall check at the deepest point the spar reaches (smallest chord)
      const thick = sectionAt(p.airfoil, f).thickness * pf.chordAt(sEnd);
      const wallLeft = (thick - dia) / 2;
      if (wallLeft < 0.8) {
        warnings.push(`${name} spar (${dia} mm) leaves only ${wallLeft.toFixed(2)} mm of skin at its end (airfoil is ${thick.toFixed(1)} mm thick there). Use a smaller tube, a shorter spar, or a thicker airfoil.`);
      }
      spars.push({ name, a, b, r: dia / 2, sEnd });
      notes.push(`${name} spar: ${dia} mm hole at ${posPct}% chord, ${sEnd.toFixed(0)} mm long from the root.`);
    };
    addSpar('Main', p.sparDiameter, p.sparPosition, p.sparLength);
    addSpar('Rear', p.rearSparDiameter, p.rearSparPosition, p.rearSparLength);

    const parts = [];
    for (let i = 0; i < nSections; i++) {
      const s0 = i * sectionLen;
      const s1 = (i + 1) * sectionLen;
      const geomRaw = k.extrude(rootSection, s1 - s0, slicesPerSection);
      // Shape the straight extrusion into the tapered, swept, twisted panel.
      // Vertex (x, y) is in root-chord mm relative to the main spar pivot.
      let geom = k.track(geomRaw.warp((v) => {
        const s = v[2] + s0;
        const scale = pf.chordAt(s) / p.rootChord;
        const tw = pf.twistAt(s);
        const x = v[0] * scale;
        const y = v[1] * scale;
        const c = pf.chordAt(s);
        v[0] = pf.leAt(s) + pivotX * c + x * Math.cos(tw) - y * Math.sin(tw);
        v[1] = pivotY * c + x * Math.sin(tw) + y * Math.cos(tw);
      }));

      const holes = [];
      for (const sp of spars) {
        if (sp.sEnd <= s0) continue;
        // extend 1 mm below the section bottom so the hole opens cleanly
        const t0 = (s0 - 1) / sp.sEnd;
        const t1 = Math.min(s1 + 1, sp.sEnd) / sp.sEnd;
        const at = (t) => [0, 1, 2].map((k) => sp.a[k] + (sp.b[k] - sp.a[k]) * t);
        const a = at(t0);
        const b = at(t1);
        holes.push(k.rod([a[0], a[1], a[2] - s0], [b[0], b[1], b[2] - s0], sp.r, p.holeSegments));
      }
      geom = k.difference(geom, holes);

      const label = `section${i + 1}`;
      parts.push({ name: `right-${label}`, manifold: geom });
      if (p.bothSides) parts.push({ name: `left-${label}`, manifold: k.mirror(geom, [1, 0, 0]) });
    }

    // The airfoil is scaled with chord, so the minimum TE shrinks toward a smaller tip.
    const tipTe = (p.minTrailingEdge * p.tipChord) / p.rootChord;
    if (tipTe < p.minTrailingEdge - 0.05) {
      notes.push(`Trailing edge thins from ${p.minTrailingEdge} mm at the root to ${tipTe.toFixed(2)} mm at the tip. Raise minTrailingEdge if the tip TE prints poorly.`);
    }

    const area = ((p.rootChord + p.tipChord) / 2) * p.halfSpan; // mm^2, one panel
    notes.unshift(
      `${nSections} section(s) of ${sectionLen.toFixed(1)} mm. Panel area ${(area / 100).toFixed(0)} cm^2 (${((2 * area) / 100).toFixed(0)} cm^2 both sides).`,
    );
    notes.push('Print each section standing on its root face. Low infill (gyroid 5-8%) or 2-3 perimeters with 0% infill keeps weight down.');
    notes.push('Dihedral, ailerons and servo bays are not modeled yet. Cut ailerons after printing or add them in a later version.');

    return { parts, warnings, notes };
  },
};
