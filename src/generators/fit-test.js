// Fit test coupons: small, fast prints that tell you the right hole size
// before a long print. Heat-set inserts, screw clearance / tap holes, tube
// and bearing bores, peg-in-socket press fits.
//
// A strip of `count` holes from nominal - (count-1)/2 x step to
// nominal + (count-1)/2 x step. The smallest hole is at the end with the cut
// corner; the nominal (middle) hole has a notch next to it. The notes list
// every size in order. Print, test, and type the size that fit into your design.
//
// Heat-set insert sizes in the presets are common values (M2 3.2 x 4.5,
// M3 4.0 x 5.5, M4 5.6 x 6.5 mm): UNVERIFIED for any given insert kit. That is
// exactly what this coupon checks.

export const fitTest = {
  id: 'fit-test',
  name: 'Fit Test Coupon',
  sections: ['shop', 'robotics', 'accessories'],
  description: 'Test strip for hole sizes: heat-set inserts (blind holes with a chamfer), screw clearance / tap holes, tube and bearing bores, or pegs + sockets for press fits. Holes step up by a set amount from small to large.',
  params: {
    mode: {
      type: 'select', default: 'insert', group: 'Test', label: 'Test',
      options: [
        { value: 'insert', label: 'Heat-set insert (blind holes, chamfer)' },
        { value: 'hole', label: 'Through holes (screws, tubes, bearings)' },
        { value: 'peg', label: 'Pegs + sockets (press fit, 2 parts)' },
      ],
    },
    nominal: { type: 'number', default: 4, min: 0.8, max: 60, step: 0.05, unit: 'mm', label: 'Nominal (middle) diameter', group: 'Test', help: 'Insert hole, screw hole, tube OD or peg size.' },
    step: { type: 'number', default: 0.1, min: 0.02, max: 2, step: 0.01, unit: 'mm', label: 'Step between holes', group: 'Test' },
    count: { type: 'integer', default: 5, min: 2, max: 11, label: 'Number of sizes', group: 'Test', help: 'Odd counts put the nominal size in the middle.' },
    depth: { type: 'number', default: 5.5, min: 1, max: 40, step: 0.1, unit: 'mm', label: 'Hole depth / peg height', group: 'Test', help: 'Insert length + 0.5 to 1 mm.' },
    floor: { type: 'number', default: 1.2, min: 0.6, max: 5, step: 0.1, unit: 'mm', label: 'Floor under blind holes', group: 'Strip' },
    wall: { type: 'number', default: 2, min: 1.2, max: 10, step: 0.1, unit: 'mm', label: 'Wall around each hole', group: 'Strip', help: 'At least 1.2 mm around an insert.' },
    chamfer: { type: 'number', default: 0.4, min: 0, max: 2, step: 0.05, unit: 'mm', label: 'Mouth chamfer (insert)', group: 'Strip' },
  },
  generate(p, k) {
    const warnings = [];
    const n = p.count;
    const sizes = Array.from({ length: n }, (_, i) => Math.round((p.nominal + (i - (n - 1) / 2) * p.step) * 1000) / 1000);
    if (sizes[0] <= 0.3) throw new Error('The smallest size is below 0.3 mm. Use a smaller step or a larger nominal size.');
    const dMax = sizes[n - 1];
    const pitch = dMax + p.wall;
    const L = n * pitch + p.wall;
    const W = dMax + 2 * p.wall + 3; // room for the notch row
    const blind = p.mode === 'insert';
    const H = p.mode === 'peg' ? 2.4 : blind ? p.depth + p.floor : Math.max(3, p.depth);
    const xs = sizes.map((_, i) => -L / 2 + p.wall + pitch / 2 + i * pitch);
    const yHole = -1.5;
    const seg = (d) => Math.max(24, Math.min(96, Math.round(d * 6) | 1));
    const strip = (height) => {
      const body = k.roundedBlock(L, W, 1.5, 0, height, 6);
      // cut corner at the small end (-X, +Y) and a notch at the nominal hole
      const corner = k.prismZ([[-L / 2 - 1, W / 2 - 3], [-L / 2 + 3, W / 2 + 1], [-L / 2 - 1, W / 2 + 1]], -1, height + 1);
      const mid = Math.floor(n / 2);
      const notch = k.cuboid([1.2, 2.4, height + 2], [xs[mid], W / 2, height / 2]);
      return k.difference(body, [corner, notch]);
    };
    const notes = [`Sizes from the cut corner: ${sizes.map((d) => d.toFixed(2)).join(', ')} mm. The notch marks ${sizes[Math.floor(n / 2)].toFixed(2)} mm.`];
    if (p.mode === 'peg') {
      const socketD = p.nominal;
      const sockets = k.difference(strip(p.depth + p.floor), xs.map((x) => k.cylZ(socketD / 2, x, yHole, p.floor, p.depth + p.floor + 1, seg(socketD))));
      const pegs = k.union([strip(2.4), ...xs.map((x, i) => k.cylZ(sizes[i] / 2, x, yHole, 2.39, 2.4 + p.depth, seg(sizes[i])))]);
      notes.push(`Sockets are all ${socketD.toFixed(2)} mm. Push each peg into a socket: the largest peg that goes in by hand is a sliding fit; one step larger is a press fit.`);
      return { parts: [{ name: 'sockets', manifold: k.placeOnBed(sockets) }, { name: 'pegs', manifold: k.placeOnBed(pegs) }], warnings, notes };
    }
    const cuts = [];
    xs.forEach((x, i) => {
      const r = sizes[i] / 2;
      cuts.push(k.cylZ(r, x, yHole, blind ? p.floor : -1, H + 1, seg(sizes[i])));
      if (blind && p.chamfer > 0) cuts.push(k.coneZ(r, r + p.chamfer, x, yHole, H - p.chamfer, H + 0.01, seg(sizes[i])));
    });
    if (blind) notes.push(`Blind holes ${p.depth} mm deep on a ${p.floor} mm floor. Press an insert into each with the iron; the smallest hole that seats the insert straight without bulging the wall is the one to use.`);
    else notes.push('Through holes. Test screws, tubes or bearings in each.');
    if (p.wall < 1.2) warnings.push('Less than 1.2 mm wall: inserts may crack the wall.');
    return { parts: [{ name: blind ? 'insert-coupon' : 'hole-coupon', manifold: k.placeOnBed(k.difference(strip(H), cuts)) }], warnings, notes };
  },
};
