// Text to 2D outlines for embossed / debossed labels.
// Font: Roboto Condensed Bold (SIL Open Font License), loaded from node_modules.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import opentype from 'opentype.js';

const require = createRequire(import.meta.url);
let font = null;

function getFont() {
  if (!font) {
    const file = require.resolve('@fontsource/roboto-condensed/files/roboto-condensed-latin-700-normal.woff');
    const buf = readFileSync(file);
    font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  }
  return font;
}

/** Flatten an opentype path into closed contours. Output is y-up. */
function pathToContours(path, curveSteps = 6) {
  const contours = [];
  let cur = [];
  let x = 0;
  let y = 0;
  for (const c of path.commands) {
    if (c.type === 'M') {
      if (cur.length > 2) contours.push(cur);
      cur = [[c.x, -c.y]];
      x = c.x; y = c.y;
    } else if (c.type === 'L') {
      cur.push([c.x, -c.y]);
      x = c.x; y = c.y;
    } else if (c.type === 'Q') {
      for (let i = 1; i <= curveSteps; i++) {
        const t = i / curveSteps, u = 1 - t;
        cur.push([u * u * x + 2 * u * t * c.x1 + t * t * c.x, -(u * u * y + 2 * u * t * c.y1 + t * t * c.y)]);
      }
      x = c.x; y = c.y;
    } else if (c.type === 'C') {
      for (let i = 1; i <= curveSteps; i++) {
        const t = i / curveSteps, u = 1 - t;
        cur.push([
          u * u * u * x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          -(u * u * u * y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y),
        ]);
      }
      x = c.x; y = c.y;
    } else if (c.type === 'Z') {
      if (cur.length > 2) contours.push(cur);
      cur = [];
    }
  }
  if (cur.length > 2) contours.push(cur);
  return contours;
}

/** Cap height of the font, as a fraction of font size. */
function capRatio(f) {
  return (f.tables.os2?.sCapHeight || f.unitsPerEm * 0.71) / f.unitsPerEm;
}

/**
 * Lay out one or two lines of text to fit a box, centered on (0, 0).
 * Line 1 is the main label; line 2 is smaller (codes, sizes, location).
 *
 * @returns {{ contours: number[][][], width: number, height: number } | null}
 *   null when there is no text.
 */
export function layoutText(lines, { boxWidth, boxHeight, line2Scale = 0.55, gapRatio = 0.35 }) {
  const f = getFont();
  const clean = lines.map((l) => String(l ?? '').trim()).filter(Boolean);
  if (!clean.length) return null;

  const cap = capRatio(f);
  const scales = clean.map((_, i) => (i === 0 ? 1 : line2Scale));
  // first pass at unit cap height to measure
  const widths = clean.map((l, i) => f.getAdvanceWidth(l, scales[i] / cap));
  const unitHeight = scales.reduce((a, b) => a + b, 0) + gapRatio * (clean.length - 1);
  const capH = Math.min(boxHeight / unitHeight, boxWidth / Math.max(...widths));

  const contours = [];
  let yTop = (unitHeight * capH) / 2;
  let maxW = 0;
  clean.forEach((line, i) => {
    const lineCap = capH * scales[i];
    const fontSize = lineCap / cap;
    const w = f.getAdvanceWidth(line, fontSize);
    maxW = Math.max(maxW, w);
    const baseline = yTop - lineCap;
    const path = f.getPath(line, -w / 2, -baseline, fontSize);
    contours.push(...pathToContours(path));
    yTop = baseline - gapRatio * capH;
  });
  return { contours, width: maxW, height: unitHeight * capH };
}
