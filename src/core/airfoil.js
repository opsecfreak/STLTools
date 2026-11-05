// NACA 4-digit airfoil generator.
// Reference: Abbott & von Doenhoff, "Theory of Wing Sections", NACA 4-digit series equations.

/**
 * Parse "2412" -> { m: 0.02, p: 0.4, t: 0.12 }.
 */
export function parseNaca4(code) {
  if (!/^\d{4}$/.test(code)) throw new Error(`NACA code must be 4 digits, got "${code}"`);
  const m = Number(code[0]) / 100;
  const p = Number(code[1]) / 10;
  const t = Number(code.slice(2)) / 100;
  if (t <= 0) throw new Error('NACA thickness (last two digits) must be greater than 00');
  if (m > 0 && p === 0) throw new Error('Cambered NACA airfoil needs a camber position (2nd digit) of 1-9');
  return { m, p, t };
}

function thicknessAt(x, t) {
  // Closed trailing edge variant (-0.1036) so the TE converges cleanly.
  return 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}

function camberAt(x, m, p) {
  if (m === 0) return { yc: 0, dyc: 0 };
  if (x < p) {
    return { yc: (m / p ** 2) * (2 * p * x - x ** 2), dyc: ((2 * m) / p ** 2) * (p - x) };
  }
  return {
    yc: (m / (1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x ** 2),
    dyc: ((2 * m) / (1 - p) ** 2) * (p - x),
  };
}

/**
 * Camber line height and full thickness at a chord fraction x (0..1), unit chord.
 */
export function sectionAt(code, x) {
  const { m, p, t } = parseNaca4(code);
  return { camber: camberAt(x, m, p).yc, thickness: 2 * thicknessAt(x, t) };
}

/**
 * Unit-chord airfoil outline as a closed counter-clockwise polygon:
 * upper surface TE -> LE, then lower surface LE -> TE.
 *
 * @param {string} code      NACA 4-digit code
 * @param {number} n         points per surface (cosine spaced)
 * @param {number} minTe     minimum trailing-edge thickness as a fraction of chord
 *                           (a printed TE cannot be zero thick)
 * @returns {Array<[number, number]>}
 */
export function naca4Outline(code, n = 60, minTe = 0) {
  const { m, p, t } = parseNaca4(code);
  const upper = [];
  const lower = [];
  for (let i = 0; i <= n; i++) {
    const beta = (Math.PI * i) / n;
    const x = (1 - Math.cos(beta)) / 2; // cosine spacing: dense at LE and TE
    let yt = thicknessAt(x, t);
    if (x > 0.5 && yt * 2 < minTe) yt = minTe / 2; // TE only; the LE stays round

    const { yc, dyc } = camberAt(x, m, p);
    const th = Math.atan(dyc);
    upper.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]);
    lower.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
  }
  // upper: TE -> LE (reverse), lower: skip LE point (shared), LE -> TE
  return [...upper.reverse(), ...lower.slice(1)];
}
