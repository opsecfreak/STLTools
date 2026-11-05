// Labels on the front face of bins and holders.
//
// Three styles:
//   slot   - a holder on the front face. A printed label card (label-card
//            generator) or a paper/cardstock strip drops in from the top.
//            Easy to relabel when a bin changes use.
//   emboss - raised text on the face. Change filament at the first text layer
//            for two-color labels.
//   deboss - recessed text. Fill with paint or a paint marker.

import { layoutText } from './text.js';

/** Label parameters shared by every generator that supports labels. */
export function labelParamSchema(group = 'Label') {
  return {
    labelType: {
      type: 'select', default: 'slot', group, label: 'Label style',
      options: [
        { value: 'none', label: 'None' },
        { value: 'slot', label: 'Card slot (swap labels)' },
        { value: 'emboss', label: 'Raised text' },
        { value: 'deboss', label: 'Recessed text' },
      ],
    },
    labelText: { type: 'string', default: '', maxLength: 40, group, label: 'Label line 1', help: 'Main text, e.g. M3 SCREWS. Used by raised/recessed text and by the label card.' },
    labelLine2: { type: 'string', default: '', maxLength: 40, group, label: 'Label line 2', help: 'Smaller text, e.g. a code like FAS-004 or a size.' },
    labelWidth: { type: 'number', default: 0, min: 0, max: 300, step: 1, unit: 'mm', group, label: 'Label width (0 = auto)' },
    labelHeight: { type: 'number', default: 14, min: 6, max: 60, step: 0.5, unit: 'mm', group, label: 'Label height' },
    labelDepth: { type: 'number', default: 0.6, min: 0.2, max: 2, step: 0.1, unit: 'mm', group, label: 'Text raise / recess depth' },
    cardThickness: { type: 'number', default: 1.0, min: 0.3, max: 3, step: 0.1, unit: 'mm', group, label: 'Card slot gap (card thickness)', help: '1.0 fits a printed label card. 0.5 fits cardstock.' },
  };
}

const SLOT_CLEARANCE = 0.3; // per side around the card
const SLOT_PLATE = 1.2;     // front plate thickness
const SLOT_LEDGE = 1.2;     // floor the card rests on
const SLOT_LIP = 2.0;       // how far the front lips overlap the card edges
const SLOT_SIDE = 1.6;      // side wall beyond the card
const CARD_PROUD = 2.0;     // card sticks out above the holder so you can pull it

/** Text as a 2D CrossSection, centered at (0,0), or null. */
export function textShape(k, lines, boxWidth, boxHeight) {
  const t = layoutText(lines, { boxWidth, boxHeight });
  return t ? k.polygons(t.contours) : null;
}

/**
 * Label geometry on a vertical face that faces -Y at y = faceY.
 * The label is centered on X = centerX inside the vertical band zMin..zMax.
 *
 * @returns {{ add: Manifold[], cut: Manifold[], warnings: string[], card: object|null }}
 *   card = { width, height } of the card this slot takes, for the label-card generator.
 */
export function frontLabel(k, p, { faceY, centerX = 0, zMin, zMax, maxWidth, minWall = Infinity }) {
  const out = { add: [], cut: [], warnings: [], card: null };
  if (p.labelType === 'none') return out;

  const width = Math.min(p.labelWidth > 0 ? p.labelWidth : Math.min(maxWidth * 0.8, 110), maxWidth - 2 * (SLOT_SIDE + SLOT_CLEARANCE));
  const lines = [p.labelText, p.labelLine2];

  if (p.labelType === 'slot') {
    const gap = p.cardThickness + SLOT_CLEARANCE;
    const depth = gap + SLOT_PLATE;
    const needed = depth + SLOT_LEDGE + p.labelHeight - CARD_PROUD;
    if (zMax - zMin < needed) {
      out.warnings.push(`No room for a ${p.labelHeight} mm label slot (needs ${needed.toFixed(1)} mm of face height, has ${(zMax - zMin).toFixed(1)}). Lower labelHeight or make the part taller.`);
      return out;
    }
    if (width < 15) {
      out.warnings.push('Part is too narrow for a label slot.');
      return out;
    }
    const zt = zMax;
    const zb = zt - (SLOT_LEDGE + p.labelHeight - CARD_PROUD);
    const halfOuter = width / 2 + SLOT_CLEARANCE + SLOT_SIDE;
    const x0 = centerX - halfOuter;
    const x1 = centerX + halfOuter;
    const yFront = faceY - depth;
    const body = k.cuboid([x1 - x0, depth + 0.02, zt - zb], [centerX, yFront + (depth + 0.02) / 2, (zb + zt) / 2]);
    const slot = k.cuboid([width + 2 * SLOT_CLEARANCE, gap, zt + 1 - (zb + SLOT_LEDGE)], [centerX, faceY - gap / 2, (zb + SLOT_LEDGE + zt + 1) / 2]);
    const winH = zt + 1 - (zb + SLOT_LEDGE + SLOT_LIP);
    const window = k.cuboid([width - 2 * SLOT_LIP, SLOT_PLATE + 2, winH], [centerX, yFront + SLOT_PLATE / 2 - 0.5, zt + 1 - winH / 2]);
    // 45 degree wedge under the holder so it prints without support
    const wedge = k.prismX([[faceY + 0.02, zb + 0.01], [yFront, zb + 0.01], [faceY + 0.02, zb - depth - 0.02]], x0, x1);
    out.add.push(k.difference(body, [slot, window]), wedge);
    out.card = { width: Number(width.toFixed(2)), height: p.labelHeight };
    return out;
  }

  // emboss / deboss
  const boxH = Math.min(p.labelHeight, zMax - zMin - 2);
  if (boxH < 4) {
    out.warnings.push('No room on the front face for label text.');
    return out;
  }
  const shape = textShape(k, lines, width, boxH);
  if (!shape) {
    out.warnings.push(`Label style is "${p.labelType}" but label text is empty.`);
    return out;
  }
  if (p.labelType === 'deboss' && p.labelDepth > minWall - 0.6) {
    out.warnings.push(`Recessed text (${p.labelDepth} mm) leaves less than 0.6 mm of wall. Use raised text or a thicker wall.`);
  }
  const zc = (zMin + zMax) / 2;
  const h = p.labelType === 'emboss' ? p.labelDepth + 0.02 : p.labelDepth + 0.02;
  // extrude along +Z, then rotate +90 about X so the extrusion points -Y (out of the face)
  const solid = k.rotate(k.extrude(shape, h), [90, 0, 0]);
  if (p.labelType === 'emboss') {
    out.add.push(k.translate(solid, [centerX, faceY + 0.02, zc]));
  } else {
    out.cut.push(k.translate(solid, [centerX, faceY + p.labelDepth, zc]));
  }
  return out;
}
