// Tube joints / hubs: sockets that slide over tubes, for frames, stands, jigs.
// Horizontal sockets have a flat bottom (D profile) and teardrop bores, so the
// whole joint prints flat on the bed with no supports. Up sockets point +Z.

const SEG = 64;
const TYPES = {
  straight: { dirs: [0, 180] },
  elbow: { dirs: (a) => [0, a] },
  tee: { dirs: [0, 180, 90] },
  cross: { dirs: [0, 90, 180, 270] },
  y: { dirs: (a) => [180, a / 2, -a / 2] },
  radial: { dirs: (a, n) => Array.from({ length: n }, (_, i) => (i * 360) / n) },
  corner: { dirs: [0, 90], up: true },
  'tee-up': { dirs: [0, 180], up: true },
  'cross-up': { dirs: [0, 90, 180, 270], up: true },
  'corner-4': { dirs: [0, 90, 180], up: true },
};

export default {
  id: 'tube-joint',
  name: 'Tube Joint',
  sections: ['accessories', 'quads', 'robotics'],
  description: 'Joint hub for tubes: straight, elbow (any angle), tee, cross, Y, radial hub, 3D corners. Set tube OD, socket depth and set screws.',
  params: {
    type: {
      type: 'select', default: 'tee', group: 'Joint', label: 'Joint type',
      options: [
        { value: 'straight', label: 'Straight coupler' },
        { value: 'elbow', label: 'Elbow (set angle)' },
        { value: 'tee', label: 'Tee' },
        { value: 'cross', label: 'Cross (4-way flat)' },
        { value: 'y', label: 'Y (set angle)' },
        { value: 'radial', label: 'Radial hub (N arms)' },
        { value: 'corner', label: '3-way corner (X, Y, up)' },
        { value: 'tee-up', label: 'Tee + up' },
        { value: 'corner-4', label: '4-way (3 flat + up)' },
        { value: 'cross-up', label: '5-way (4 flat + up)' },
      ],
    },
    angle: { type: 'number', default: 90, min: 20, max: 180, step: 1, unit: 'deg', label: 'Angle (elbow / Y)', group: 'Joint' },
    arms: { type: 'integer', default: 6, min: 3, max: 12, label: 'Arms (radial hub)', group: 'Joint' },
    tubeOD: { type: 'number', default: 10, min: 2, max: 80, step: 0.05, unit: 'mm', label: 'Tube outer diameter', group: 'Tube' },
    clearance: { type: 'number', default: 0.2, min: -0.3, max: 2, step: 0.05, unit: 'mm', label: 'Socket clearance (per side)', group: 'Tube', help: '0.1-0.2 for a glued fit, 0.3+ for a loose slip fit.' },
    wall: { type: 'number', default: 2.4, min: 1.2, max: 15, step: 0.1, unit: 'mm', label: 'Wall thickness', group: 'Joint' },
    socketDepth: { type: 'number', default: 20, min: 4, max: 150, step: 0.5, unit: 'mm', label: 'Socket depth', group: 'Joint' },
    setScrew: { type: 'boolean', default: false, label: 'Set screw / pin hole per socket', group: 'Joint' },
    setScrewHole: { type: 'number', default: 2.6, min: 1, max: 8, step: 0.1, unit: 'mm', label: 'Set screw hole diameter', group: 'Joint', help: '2.6 to tap or self-thread M3. 3.4 for an M3 through bolt.' },
  },

  generate(p, k) {
    const warnings = [];
    const t = TYPES[p.type];
    const dirs = typeof t.dirs === 'function' ? t.dirs(p.angle, p.arms) : t.dirs;
    const r = p.tubeOD / 2 + p.clearance;
    const R = r + p.wall;
    const zc = R; // socket axis height: horizontal sockets sit on the bed
    const len = R + p.socketDepth; // center to socket end

    // Hub rounds the outside corners between sockets. Slightly smaller than the
    // sockets so its surface never lies tangent to a socket face (tangent
    // surfaces leave slivers that break the STL).
    const add = [k.cylZ(R * 0.97, 0, 0, 0, 2 * R - 0.15, SEG)];
    const cut = [];
    // D-profile socket along +X: round top, square bottom on the bed
    const half = [];
    for (let i = 0; i <= 32; i++) {
      const a = (Math.PI * i) / 32; // 0..180 deg over the top
      half.push([R * Math.cos(a), zc + R * Math.sin(a)]);
    }
    const dProfile = [...half, [-R, 0], [R, 0]]; // (y, z)
    for (const deg of dirs) {
      let sock = k.prismX(dProfile, 0, len);
      let bore = k.holeX(r, 0, zc, R, len + 1, SEG);
      const extra = [];
      if (p.setScrew) extra.push(k.cylZ(p.setScrewHole / 2, R + p.socketDepth / 2, 0, zc, 2 * R + 1, 24));
      sock = k.rotate(sock, [0, 0, deg]);
      bore = k.rotate(bore, [0, 0, deg]);
      add.push(sock);
      cut.push(bore, ...extra.map((e) => k.rotate(e, [0, 0, deg])));
    }
    if (t.up) {
      const top = zc + len;
      add.push(k.cylZ(R + 0.5, 0, 0, 0, top, SEG)); // +0.5 so it crosses the flat socket sides instead of touching them
      cut.push(k.cylZ(r, 0, 0, top - p.socketDepth, top + 1, SEG));
      if (p.setScrew) cut.push(k.holeX(p.setScrewHole / 2, 0, top - p.socketDepth / 2, 0, R + 1));
    }
    // sockets closer than ~2 walls collide at the hub
    const sorted = [...dirs].map((d) => ((d % 360) + 360) % 360).sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      const gap = ((sorted[(i + 1) % sorted.length] - sorted[i]) + 360) % 360 || 360;
      if (sorted.length > 1 && gap < 2 * (Math.asin(Math.min(1, R / len)) * 180) / Math.PI) {
        warnings.push(`Sockets ${gap.toFixed(0)} deg apart overlap near the hub. Tubes will touch; shorten them or open the angle.`);
        break;
      }
    }
    const joint = k.dropToBed(k.difference(k.union(add), cut));
    return {
      parts: [{ name: 'joint', manifold: joint }],
      warnings,
      notes: [
        `${dirs.length + (t.up ? 1 : 0)} sockets, bore ${(2 * r).toFixed(2)} mm for ${p.tubeOD} mm tube, ${p.socketDepth} mm deep, tube stop ${R.toFixed(1)} mm from center.`,
        'Print flat side down as exported. Glue with epoxy or CA, or use the set screw holes.',
      ],
    };
  },
};
