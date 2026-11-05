// Example custom generator. Copy this file to a name without the leading
// underscore (for example angle-bracket.js), restart STL Tools, and it shows
// up under the tabs listed in `sections`. Files starting with _ are ignored.
//
// Where to put your copy:
//   Desktop app: the "custom/generators" folder printed when STL Tools starts
//                (Windows: %APPDATA%\STLTools\custom\generators)
//   From source: custom/generators/ in the project folder
//
// If your file has an error, STL Tools skips it and lists the problem at the
// bottom of the page. Nothing else breaks.
//
// Kernel functions (k.*) are documented in src/generators/README.md.
// Shared helpers arrive as the third argument of generate(p, k, lib):
//   lib.hardware.bolt('M3')     -> { clear, tap, head, headH, nutAF, nutH }
//   lib.hardware.squarePattern(30.5), lib.teardrop(r), lib.regularPolygon(r, n)
//   lib.labels.frontLabel(...), lib.mounts.buildMount(...)
// No imports needed, so the file works from any folder.

export default {
  id: 'my-angle-bracket', // unique, lowercase with dashes
  name: 'Angle Bracket (example)',
  sections: ['shop', 'robotics'], // tabs: shop, planes, quads, accessories, robotics
  description: 'L-shaped bracket with two holes in each leg. Example of a custom generator.',
  params: {
    width: { type: 'number', default: 20, min: 5, max: 200, step: 0.5, unit: 'mm', label: 'Width', group: 'Bracket' },
    legLength: { type: 'number', default: 30, min: 8, max: 200, step: 0.5, unit: 'mm', label: 'Leg length', group: 'Bracket' },
    thickness: { type: 'number', default: 4, min: 1.2, max: 20, step: 0.1, unit: 'mm', label: 'Thickness', group: 'Bracket' },
    bolt: { type: 'select', default: 'M3', group: 'Bracket', label: 'Bolt size', options: ['M2', 'M2.5', 'M3', 'M4', 'M5'] },
    gusset: { type: 'boolean', default: true, label: 'Gusset', group: 'Bracket' },
  },
  // p = validated values, k = geometry kernel. Return parts in print orientation, on the bed.
  generate(p, k, lib) {
    const T = p.thickness;
    const hole = lib.hardware.bolt(p.bolt).clear;
    const L = p.legLength;
    const parts = [
      k.cuboid([p.width, L, T], [0, L / 2, T / 2]), // flat leg on the bed
      k.cuboid([p.width, T, L], [0, T / 2, L / 2]), // upright leg
    ];
    if (p.gusset) parts.push(k.prismX([[T - 0.3, T - 0.3], [L * 0.6, T - 0.3], [T - 0.3, L * 0.6]], -1, 1));
    const cuts = [
      k.cylZ(hole / 2, 0, L * 0.65, -1, T + 1), // vertical hole in the flat leg
      k.holeY(hole / 2, 0, L * 0.65, -1, T + 1), // teardrop hole in the upright leg (prints without support)
    ];
    const warnings = hole > p.width - 2.4 ? ['Hole is nearly as wide as the bracket.'] : [];
    return { parts: [{ name: 'bracket', manifold: k.placeOnBed(k.difference(k.union(parts), cuts)) }], warnings, notes: ['Prints as exported: flat leg on the bed.'] };
  },
};
