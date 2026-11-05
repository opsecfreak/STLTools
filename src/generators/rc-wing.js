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
 * Point in panel coordinates for airfoil coordinates (f = chord fraction,
 * yAf = height in chord units) at span station s, with taper, sweep and the
 * same twist about the main spar pivot that the skin gets.
 */
function panelPoint(pf, p, f, yAf, s) {
  const c = pf.chordAt(s);
  const pivotX = p.sparPosition / 100;
  const pivotY = sectionAt(p.airfoil, pivotX).camber;
  const dx = (f - pivotX) * c;
  const dy = (yAf - pivotY) * c;
  const tw = pf.twistAt(s);
  return [pf.leAt(s) + pivotX * c + dx * Math.cos(tw) - dy * Math.sin(tw), pivotY * c + dx * Math.sin(tw) + dy * Math.cos(tw), s];
}

/** Point on a spar line at span station s (chord fraction f, on the camber line). */
function sparPointAt(pf, p, f, s) {
  return panelPoint(pf, p, f, sectionAt(p.airfoil, f).camber, s);
}

/**
 * Convex solid between span stations sa and sb: poly(s) gives a convex 2D
 * outline [[x, y], ...] in panel coordinates at station s. zShift moves it
 * into section-local Z.
 */
function sweepHull(k, poly, sa, sb, zShift) {
  const pts = [];
  for (const s of [sa, sb]) for (const [x, y] of poly(s)) pts.push([x, y, s - zShift]);
  return k.track(k.Manifold.hull(pts));
}

export default {
  id: 'rc-wing',
  name: 'RC Wing / Tail Panel',
  sections: ['planes'],
  description: 'Tapered NACA 4-digit wing (or tail) panel: wingspan, chords, sweep, washout, spar tubes, aileron / flap / elevator cut as separate parts, servo pocket with wire channel. Split into sections that fit your printer.',
  // Older saves used halfSpan (one panel). Convert to total wingspan.
  migrate(input) {
    if (input && 'halfSpan' in input && !('wingspan' in input)) {
      const { halfSpan, ...rest } = input;
      return { ...rest, wingspan: Number(halfSpan) * 2 };
    }
    return input;
  },
  params: {
    airfoil: { type: 'string', default: '2412', pattern: '^\\d{4}$', label: 'NACA 4-digit airfoil', group: 'Airfoil', help: 'e.g. 2412 trainer, 4412 high lift, 0012 symmetric/aerobatic.' },
    airfoilPoints: { type: 'integer', default: 60, min: 20, max: 200, label: 'Points per surface', group: 'Airfoil' },
    minTrailingEdge: { type: 'number', default: 0.8, min: 0.2, max: 3, step: 0.1, unit: 'mm', label: 'Min trailing edge thickness', group: 'Airfoil', help: 'About 2 nozzle widths so the slicer can print it.' },

    wingspan: { type: 'number', default: 800, min: 100, max: 4000, step: 5, unit: 'mm', label: 'Wingspan (tip to tip)', group: 'Planform', help: 'Each panel is half of this.' },
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

    controlSurface: { type: 'select', default: 'aileron', group: 'Control surface', label: 'Control surface', options: [{ value: 'none', label: 'None' }, { value: 'aileron', label: 'Aileron / flap / elevator / rudder' }] },
    surfaceStart: { type: 'number', default: 180, min: 0, max: 2000, step: 1, unit: 'mm', label: 'Starts at (mm from root)', group: 'Control surface' },
    surfaceLength: { type: 'number', default: 200, min: 20, max: 2000, step: 1, unit: 'mm', label: 'Length along the span', group: 'Control surface', help: 'Aileron length. Clipped at the tip.' },
    surfaceChord: { type: 'number', default: 25, min: 10, max: 50, step: 1, unit: '% chord', label: 'Surface chord', group: 'Control surface' },
    hingeGap: { type: 'number', default: 0.8, min: 0.2, max: 3, step: 0.1, unit: 'mm', label: 'Hinge gap', group: 'Control surface' },
    hingeStyle: { type: 'select', default: 'top', group: 'Control surface', label: 'Hinge', options: [{ value: 'top', label: 'Top surface (tape / film hinge)' }, { value: 'center', label: 'Center line (pin / CA hinges)' }] },
    bevel: { type: 'number', default: 30, min: 0, max: 45, step: 1, unit: 'deg', label: 'Leading edge bevel (max throw)', group: 'Control surface' },

    servoBay: { type: 'boolean', default: true, label: 'Servo pocket in the bottom', group: 'Servo' },
    servoPosition: { type: 'number', default: 110, min: 10, max: 2000, step: 1, unit: 'mm', label: 'Pocket center (mm from root)', group: 'Servo' },
    servoChordPos: { type: 'number', default: 45, min: 15, max: 80, step: 1, unit: '% chord', label: 'Pocket center (% chord)', group: 'Servo' },
    servoLength: { type: 'number', default: 23.5, min: 8, max: 80, step: 0.1, unit: 'mm', label: 'Servo length (spanwise)', group: 'Servo', help: '9 g class is about 23 x 12.5 mm. Measure your servo.' },
    servoWidth: { type: 'number', default: 12.5, min: 4, max: 40, step: 0.1, unit: 'mm', label: 'Servo width (chordwise)', group: 'Servo' },
    servoDepth: { type: 'number', default: 12, min: 3, max: 60, step: 0.5, unit: 'mm', label: 'Pocket depth from the bottom skin', group: 'Servo' },
    wireChannel: { type: 'number', default: 6, min: 0, max: 15, step: 0.5, unit: 'mm', label: 'Wire channel to root (0 = none)', group: 'Servo' },

    maxSectionHeight: { type: 'number', default: 200, min: 30, max: 1000, step: 5, unit: 'mm', label: 'Max section length (printer Z)', group: 'Printing' },
    bothSides: { type: 'boolean', default: false, label: 'Also output mirrored left panel', group: 'Printing' },
    holeSegments: { type: 'integer', default: 32, min: 8, max: 96, label: 'Spar hole smoothness', group: 'Quality' },
  },

  generate(input, k) {
    const warnings = [];
    const notes = [];
    const p = { ...input, halfSpan: input.wingspan / 2 };

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

    // ---- control surface geometry (panel coordinates) ----
    let surf = null;
    if (p.controlSurface !== 'none') {
      const sStart = Math.min(p.surfaceStart, p.halfSpan - 10);
      const sEnd = Math.min(p.surfaceStart + p.surfaceLength, p.halfSpan + 0.01);
      if (sEnd - sStart < 20) {
        warnings.push('Control surface is shorter than 20 mm after clipping at the tip. It was skipped.');
      } else {
        const fh = 1 - p.surfaceChord / 100;
        const g = p.hingeGap;
        const tb = Math.tan((p.bevel * Math.PI) / 180);
        const hinge = (s) => panelPoint(pf, p, fh, sectionAt(p.airfoil, fh).camber, s);
        const half = (s) => pf.chordAt(s); // generous Y range for vertical cuts
        const back = (s) => pf.leAt(s) + pf.chordAt(s) * 1.2;
        const sec = sectionAt(p.airfoil, fh);
        surf = {
          s0: sStart,
          s1: sEnd,
          removePoly: (s) => { const [xh] = hinge(s); return [[xh - g / 2, -half(s)], [back(s), -half(s)], [back(s), half(s)], [xh - g / 2, half(s)]]; },
          keepPoly: (s) => { const [xh] = hinge(s); return [[xh + g / 2, -half(s)], [back(s), -half(s)], [back(s), half(s)], [xh + g / 2, half(s)]]; },
          bevelPolys: [],
        };
        if (p.bevel > 0) {
          const D = (s) => pf.chordAt(s) * 0.3;
          if (p.hingeStyle === 'top') {
            // pivot 0.6 mm under the top skin; bevel the bottom of the surface's leading edge
            surf.bevelPolys.push((s) => {
              const [xh] = hinge(s);
              const xa = xh + g / 2;
              const yh = panelPoint(pf, p, fh, sec.camber + sec.thickness / 2, s)[1] - 0.6;
              return [[xa - 1, yh], [xa, yh], [xa + D(s) * tb, yh - D(s)], [xa - 1, yh - D(s)]];
            });
          } else {
            for (const dir of [1, -1]) {
              surf.bevelPolys.push((s) => {
                const [xh, yc] = hinge(s);
                const xa = xh + g / 2;
                return [[xa - 1, yc], [xa, yc], [xa + D(s) * tb, yc + dir * D(s)], [xa - 1, yc + dir * D(s)]];
              });
            }
          }
        }
        notes.push(`Control surface: ${p.surfaceChord}% chord, ${(sEnd - sStart).toFixed(0)} mm long from ${sStart.toFixed(0)} mm, ${g} mm gap, ${p.hingeStyle} hinge, ${p.bevel} deg bevel. Printed as separate parts (surfaceN).`);
        if (p.hingeStyle === 'top') notes.push('Top hinge: the bevel gives down throw; up throw is limited by the gap. Use the center hinge for equal throw.');
        for (const sp of spars) {
          const f = (sp === spars[0] ? p.sparPosition : p.rearSparPosition) / 100;
          if (f > fh - 0.03 && sp.sEnd > sStart) warnings.push(`${sp.name} spar runs into the control surface. Move it forward or shorten it.`);
        }
      }
    }

    // ---- servo pocket ----
    let servo = null;
    if (p.servoBay && p.servoPosition + p.servoLength / 2 > p.halfSpan - 5) {
      warnings.push(`Servo pocket at ${p.servoPosition} mm is past the tip (panel is ${p.halfSpan} mm). It was skipped; set servoPosition inside the panel.`);
    } else if (p.servoBay) {
      const f = p.servoChordPos / 100;
      const sec = sectionAt(p.airfoil, f);
      const sc = p.servoPosition;
      const thickHere = sec.thickness * pf.chordAt(sc);
      if (p.servoDepth > thickHere - 1.2) warnings.push(`Servo pocket ${p.servoDepth} mm is deeper than the wing allows (${thickHere.toFixed(1)} mm thick there, keep 1.2 mm top skin). Use a thinner servo, a thicker airfoil, or move it inboard.`);
      const halfW = p.servoWidth / 2;
      const poly = (s) => {
        const [xc] = panelPoint(pf, p, f, sec.camber, s);
        const yBot = panelPoint(pf, p, f, sec.camber - sec.thickness / 2, s)[1];
        return [[xc - halfW, yBot - 20], [xc + halfW, yBot - 20], [xc + halfW, yBot + p.servoDepth], [xc - halfW, yBot + p.servoDepth]];
      };
      servo = { s0: sc - p.servoLength / 2, s1: sc + p.servoLength / 2, poly, wire: null };
      if (p.wireChannel > 0) {
        servo.wire = { a: panelPoint(pf, p, f, sec.camber, sc), b: panelPoint(pf, p, f, sec.camber, -1) };
        for (const [name, pos, dia] of [['Main', p.sparPosition, p.sparDiameter], ['Rear', p.rearSparPosition, p.rearSparDiameter]]) {
          if (dia > 0 && Math.abs(pos - p.servoChordPos) / 100 * pf.chordAt(0) < (dia + p.wireChannel) / 2 + 1) warnings.push(`Wire channel crosses the ${name.toLowerCase()} spar hole. Move the servo chord position.`);
        }
      }
      for (const [name, pos, dia, len] of [['Main', p.sparPosition, p.sparDiameter, p.sparLength], ['Rear', p.rearSparPosition, p.rearSparDiameter, p.rearSparLength]]) {
        if (dia > 0 && (len / 100) * p.halfSpan > servo.s0 && Math.abs(pos - p.servoChordPos) / 100 * pf.chordAt(sc) < halfW + dia / 2 + 1) warnings.push(`Servo pocket hits the ${name.toLowerCase()} spar hole.`);
      }
      if (surf && servo.s1 > surf.s0 && servo.s0 < surf.s1 && p.servoChordPos + (p.servoWidth / pf.chordAt(sc)) * 50 > 100 - p.surfaceChord) warnings.push('Servo pocket overlaps the control surface.');
      notes.push(`Servo pocket ${p.servoLength} x ${p.servoWidth} x ${p.servoDepth} mm at ${sc} mm from root, ${p.servoChordPos}% chord, open on the bottom.${p.wireChannel ? ` ${p.wireChannel} mm wire channel to the root.` : ''}`);
    }

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
      const sectionParts = [];

      // Servo pocket (opens through the bottom skin) and wire channel to the root.
      if (servo && servo.s1 > s0 && servo.s0 < s1) {
        const cutters = [sweepHull(k, servo.poly, Math.max(servo.s0, s0 - 1), Math.min(servo.s1, s1 + 1), s0)];
        if (servo.wire) cutters.push(k.rod([servo.wire.a[0], servo.wire.a[1], servo.wire.a[2] - s0], [servo.wire.b[0], servo.wire.b[1], servo.wire.b[2] - s0], p.wireChannel / 2, 24));
        geom = k.difference(geom, cutters);
      } else if (servo?.wire && servo.s0 >= s1) {
        // channel passes through this inner section toward the root
        geom = k.difference(geom, [k.rod([servo.wire.a[0], servo.wire.a[1], servo.wire.a[2] - s0], [servo.wire.b[0], servo.wire.b[1], servo.wire.b[2] - s0], p.wireChannel / 2, 24)]);
      }

      // Control surface: remove it (plus the gap) from the wing, keep it as its own part.
      if (surf && surf.s1 > s0 && surf.s0 < s1) {
        const full = geom;
        geom = k.difference(full, [sweepHull(k, surf.removePoly, Math.max(surf.s0, s0 - 1), Math.min(surf.s1, s1 + 1), s0)]);
        const a0 = Math.max(surf.s0 + p.hingeGap, s0 - 1);
        const a1 = Math.min(surf.s1 - p.hingeGap, s1 + 1);
        if (a1 - a0 > 2) {
          let piece = k.intersect(full, sweepHull(k, surf.keepPoly, a0, a1, s0));
          if (surf.bevelPolys.length) piece = k.difference(piece, surf.bevelPolys.map((bp) => sweepHull(k, bp, a0 - 1, a1 + 1, s0)));
          if (!piece.isEmpty()) sectionParts.push({ name: `surface${i + 1}`, manifold: k.dropToBed(piece) });
        }
      }
      sectionParts.unshift({ name: `section${i + 1}`, manifold: geom });

      for (const sp of sectionParts) {
        parts.push({ name: `right-${sp.name}`, manifold: sp.manifold });
        if (p.bothSides) parts.push({ name: `left-${sp.name}`, manifold: k.mirror(sp.manifold, [1, 0, 0]) });
      }
    }

    // The airfoil is scaled with chord, so the minimum TE shrinks toward a smaller tip.
    const tipTe = (p.minTrailingEdge * p.tipChord) / p.rootChord;
    if (tipTe < p.minTrailingEdge - 0.05) {
      notes.push(`Trailing edge thins from ${p.minTrailingEdge} mm at the root to ${tipTe.toFixed(2)} mm at the tip. Raise minTrailingEdge if the tip TE prints poorly.`);
    }

    const area = ((p.rootChord + p.tipChord) / 2) * p.halfSpan; // mm^2, one panel
    notes.unshift(
      `Wingspan ${p.wingspan} mm (${p.halfSpan} mm per panel). ${nSections} section(s) of ${sectionLen.toFixed(1)} mm. Panel area ${(area / 100).toFixed(0)} cm^2 (${((2 * area) / 100).toFixed(0)} cm^2 both sides).`,
    );
    notes.push('Print each section standing on its root face. Low infill (gyroid 5-8%) or 2-3 perimeters with 0% infill keeps weight down.');
    notes.push('Dihedral is set at assembly: glue the root faces at an angle or use an angled spar joiner.');

    return { parts, warnings, notes };
  },
};
