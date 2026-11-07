// Part splitter and plate arranger (server side, manifold kernel).
//
// splitToFit(scope, manifold, { bed, margin, joint, pinDiameter, pinLength, clearance })
//   Cuts a part that does not fit the printer into pieces that do: equal cuts along
//   its longest side until every piece fits the bed in some 90-degree orientation.
//   Each cut face gets alignment holes (printed pins or 1.75 mm filament pins), so
//   the pieces glue back together straight. -> { pieces: [manifold...], cuts: [{ axis, at, holes }] }
//
// arrange(items, { bed, spacing }) -> plates: [[{ index, x, y, rotated }...]...]
//   Shelf packing of footprints onto as few plates as possible (90-degree turns allowed).
//
// All lengths in mm. Pieces come back in print orientation (flat on z = 0).

const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export function bbox(m) {
  const b = m.boundingBox();
  return { min: b.min, max: b.max, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] };
}

/** 90-degree orientations of a size that fit the bed: [{ rot: [rx, ry, rz], size }] sorted by height. */
export function fitOrientations(size, bed) {
  const opts = [
    { rot: [0, 0, 0], s: [size[0], size[1], size[2]] },
    { rot: [0, 0, 90], s: [size[1], size[0], size[2]] },
    { rot: [90, 0, 0], s: [size[0], size[2], size[1]] },
    { rot: [90, 0, 90], s: [size[2], size[0], size[1]] },
    { rot: [0, 90, 0], s: [size[2], size[1], size[0]] },
    { rot: [0, 90, 90], s: [size[1], size[2], size[0]] },
  ];
  return opts.filter((o) => o.s[0] <= bed.x && o.s[1] <= bed.y && o.s[2] <= bed.z).sort((a, b) => a.s[2] - b.s[2]);
}

const fits = (size, bed) => fitOrientations(size, bed).length > 0;

const ROT_TO_AXIS = [[0, 90, 0], [90, 0, 0], [0, 0, 0]]; // turns a Z cylinder onto X, Y, Z

/**
 * Points on the cut plane where an alignment hole fits with 1.2 mm of wall around it:
 * take a 2 mm slab of the part at the cut, try a grid of spots, keep those where a
 * cylinder of radius r + 1.2 lies fully inside, return the two farthest apart.
 */
function holeSpots(k, piece, axis, at, r) {
  const n = AXES[axis];
  const slab = k.track(k.track(piece.trimByPlane(n, at - 1)).trimByPlane(n.map((v) => -v), -(at + 1)));
  if (slab.isEmpty()) return [];
  const b = bbox(slab);
  const others = [0, 1, 2].filter((a) => a !== axis);
  const R = r + 1.2;
  const probeVol = Math.PI * R * R * 1.6;
  const ok = [];
  const N = 9;
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    const p = [0, 0, 0];
    p[axis] = at;
    p[others[0]] = b.min[others[0]] + (b.size[others[0]] * i) / N;
    p[others[1]] = b.min[others[1]] + (b.size[others[1]] * j) / N;
    const cyl = k.track(k.Manifold.cylinder(1.6, R, R, 24, true).rotate(ROT_TO_AXIS[axis]).translate(p));
    const inside = k.track(slab.intersect(cyl));
    if (inside.volume() >= probeVol * 0.97) ok.push(p);
  }
  if (ok.length <= 1) return ok;
  let best = [ok[0], ok[1]], far = -1;
  for (const a2 of ok) for (const c of ok) { const d = Math.hypot(a2[0] - c[0], a2[1] - c[1], a2[2] - c[2]); if (d > far) { far = d; best = [a2, c]; } }
  return far >= 4 * R ? best : [best[0]];
}

export function splitToFit(k, part, { bed, margin = 2, joint = 'pins', pinDiameter = 4, pinLength = 12, clearance = 0.2, maxPieces = 24 } = {}) {
  const usable = { x: bed.x - 2 * margin, y: bed.y - 2 * margin, z: bed.z - margin };
  let queue = [part];
  const done = [];
  const cuts = [];
  while (queue.length) {
    const m = queue.shift();
    const b = bbox(m);
    if (fits(b.size, usable)) { done.push(m); continue; }
    if (done.length + queue.length + 1 >= maxPieces) throw new Error(`More than ${maxPieces} pieces needed: the part is too large for this printer.`);
    // cut along the longest side into the fewest equal pieces whose length fits the largest bed side
    const axis = b.size.indexOf(Math.max(...b.size));
    // piece length from the flat bed size, so long pieces lie down (stronger, no tall wobbly prints)
    const longestBed = Math.max(usable.x, usable.y);
    const n = Math.max(2, Math.ceil(b.size[axis] / longestBed));
    let rest = m;
    for (let i = 1; i < n; i++) {
      const at = b.min[axis] + (b.size[axis] * i) / n;
      const [hi, lo] = rest.splitByPlane(AXES[axis], at).map((x) => k.track(x));
      let a = lo, c = hi;
      if (joint !== 'none') {
        const r = (joint === 'filament' ? 1.75 : pinDiameter) / 2 + clearance;
        const depth = (joint === 'filament' ? 10 : pinLength) / 2 + 0.6;
        const spots = holeSpots(k, rest, axis, at, r);
        for (const s of spots) {
          // a hole of radius r, depth on both sides of the cut
          const hole = k.track(k.Manifold.cylinder(2 * depth, r, r, 32, true).rotate(ROT_TO_AXIS[axis]).translate(s));
          a = k.track(a.subtract(hole));
          c = k.track(c.subtract(hole));
        }
        cuts.push({ axis, at, holes: spots.length });
      } else cuts.push({ axis, at, holes: 0 });
      queue.push(a);
      rest = c;
    }
    queue.push(rest);
  }
  return { pieces: done, cuts };
}

/** Turn a piece to its best orientation for the bed and put it on the plate at the origin. */
export function placeOnBed(k, m, bed) {
  const b = bbox(m);
  // STL Tools parts come in print orientation: keep "up" when it fits (only turn on the plate);
  // turn the part over only when it has to (a cut piece taller than the printer, for example)
  const all = fitOrientations(b.size, bed);
  const o = all.find((x) => x.rot[0] === 0 && x.rot[1] === 0) ?? all[0];
  if (!o) return null;
  const turned = k.track(m.rotate(o.rot));
  const tb = bbox(turned);
  return { manifold: k.track(turned.translate([-tb.min[0], -tb.min[1], -tb.min[2]])), size: o.s, rot: o.rot };
}

/**
 * Shelf packing: sort by footprint depth, fill rows left to right, rows front to back,
 * new plate when full. items: [{ w, d }] -> plates: [[{ index, x, y, rotated, w, d }]]
 */
export function arrange(items, { bed, spacing = 5 }) {
  const order = items.map((it, index) => {
    // lay the longer side along X when it fits
    const rot = it.w < it.d && it.d <= bed.x && it.w <= bed.y;
    return { index, w: rot ? it.d : it.w, d: rot ? it.w : it.d, rotated: rot };
  }).sort((a, b) => b.d - a.d || b.w - a.w);
  const plates = [];
  let plate = null, x = 0, y = 0, rowD = 0;
  const newPlate = () => { plate = []; plates.push(plate); x = 0; y = 0; rowD = 0; };
  newPlate();
  for (const it of order) {
    if (it.w > bed.x || it.d > bed.y) throw new Error(`A piece (${it.w.toFixed(0)} x ${it.d.toFixed(0)} mm) is larger than the bed`);
    if (x + it.w > bed.x) { x = 0; y += rowD + spacing; rowD = 0; }
    if (y + it.d > bed.y) newPlate();
    plate.push({ ...it, x, y });
    x += it.w + spacing;
    rowD = Math.max(rowD, it.d);
  }
  return plates.filter((p) => p.length);
}
