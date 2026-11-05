// Metric hardware sizes used by many generators.
// Nut sizes: ISO 4032 across flats / height. Head sizes: ISO 4762 socket head cap screws.
// Clearance and tap sizes are typical for FDM prints; tune per printer.

export const BOLTS = {
  M2: { d: 2, clear: 2.4, tap: 1.7, head: 3.8, headH: 2.0, nutAF: 4.0, nutH: 1.6 },
  'M2.5': { d: 2.5, clear: 2.9, tap: 2.1, head: 4.5, headH: 2.5, nutAF: 5.0, nutH: 2.0 },
  M3: { d: 3, clear: 3.4, tap: 2.6, head: 5.5, headH: 3.0, nutAF: 5.5, nutH: 2.4 },
  M4: { d: 4, clear: 4.5, tap: 3.4, head: 7.0, headH: 4.0, nutAF: 7.0, nutH: 3.2 },
  M5: { d: 5, clear: 5.5, tap: 4.3, head: 8.5, headH: 5.0, nutAF: 8.0, nutH: 4.0 },
};

export const BOLT_OPTIONS = Object.keys(BOLTS).map((value) => ({ value, label: value }));

/** Select param for a bolt size. */
export function boltParam(group, defaultSize = 'M3', label = 'Bolt size') {
  return { type: 'select', default: defaultSize, group, label, options: BOLT_OPTIONS };
}

export function bolt(size) {
  const b = BOLTS[size];
  if (!b) throw new Error(`Unknown bolt size ${size}`);
  return b;
}

/** Hole pattern helpers. Return [[x, y], ...]. */
export function squarePattern(sx, sy = sx) {
  return [[-sx / 2, -sy / 2], [sx / 2, -sy / 2], [sx / 2, sy / 2], [-sx / 2, sy / 2]];
}

/** Motor "cross" pattern: one pair a apart on X, one pair b apart on Y (e.g. 16 x 19). */
export function crossPattern(a, b = a) {
  return [[-a / 2, 0], [a / 2, 0], [0, -b / 2], [0, b / 2]];
}

/** Points on a circle. */
export function circlePattern(diameter, count, startDeg = 0) {
  return Array.from({ length: count }, (_, i) => {
    const a = ((startDeg + (i * 360) / count) * Math.PI) / 180;
    return [(diameter / 2) * Math.cos(a), (diameter / 2) * Math.sin(a)];
  });
}

/** Rotate 2D points. */
export function rotate2d(points, deg) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return points.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}
