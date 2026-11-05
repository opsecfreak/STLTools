// Label card for the card slot on bins and holders. Printed flat, text up.
// Two-color: pause / change filament at the first layer above the card thickness.

import { layoutText } from '../core/text.js';

const TEXT_MARGIN = 2.6; // keeps text inside the slot window (window lips cover 2.0 mm)

export default {
  id: 'label-card',
  name: 'Label Card',
  description: 'Flat card with raised text that drops into a bin label slot. Change filament at the text layer for two colors.',
  params: {
    text: { type: 'string', default: 'M3 SCREWS', maxLength: 40, label: 'Line 1', group: 'Text' },
    line2: { type: 'string', default: 'FAS-001', maxLength: 40, label: 'Line 2 (smaller)', group: 'Text' },
    width: { type: 'number', default: 72, min: 15, max: 300, step: 0.5, unit: 'mm', label: 'Card width', group: 'Card', help: 'Use the label card size the bin generator reports.' },
    height: { type: 'number', default: 14, min: 6, max: 60, step: 0.5, unit: 'mm', label: 'Card height', group: 'Card' },
    thickness: { type: 'number', default: 0.8, min: 0.4, max: 3, step: 0.1, unit: 'mm', label: 'Card thickness', group: 'Card', help: 'Keep 0.2 mm under the slot gap.' },
    textHeight: { type: 'number', default: 0.6, min: 0.2, max: 2, step: 0.1, unit: 'mm', label: 'Text height (raised)', group: 'Text' },
    cornerRadius: { type: 'number', default: 1, min: 0, max: 5, step: 0.5, unit: 'mm', label: 'Corner radius', group: 'Card' },
  },

  generate(p, k) {
    const warnings = [];
    const card = k.roundedBlock(p.width, p.height, p.cornerRadius, 0, p.thickness, 6);
    const t = layoutText([p.text, p.line2], { boxWidth: p.width - 2 * TEXT_MARGIN, boxHeight: p.height - 2 * TEXT_MARGIN });
    let part = card;
    if (t) {
      const textSolid = k.translate(k.extrude(k.polygons(t.contours), p.textHeight + 0.01), [0, 0, p.thickness - 0.01]);
      part = k.union([card, textSolid]);
      if (t.height < 3.5) warnings.push(`Text is only ${t.height.toFixed(1)} mm tall. Shorten the text or use a wider card.`);
    } else {
      warnings.push('No text. The card is blank.');
    }
    return {
      parts: [{ name: 'card', manifold: part }],
      warnings,
      notes: [`Two colors: change filament at Z = ${p.thickness.toFixed(2)} mm (first layer of text).`],
    };
  },
};
