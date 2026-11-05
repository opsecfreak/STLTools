# Generators

Each file here makes one kind of part. A generator is a plain object:

```js
export default {
  id: 'my-part',               // used in URLs, CLI and presets
  name: 'My Part',
  description: 'One sentence for the UI.',
  params: { /* schema, see below */ },
  generate(p, k) {
    // p = validated parameters, k = kernel scope
    return { parts: [{ name: 'part', manifold }], warnings: [], notes: [], meta: {} };
  },
};
```

Register it in [`src/core/registry.js`](../core/registry.js). Set `sections` (tabs it appears in) and, if you rename parameters later, a `migrate(input)` function that converts old saved files (see `rc-wing.js`).

## Files

| File | Generators | Print orientation |
|------|-----------|-------------------|
| `stack-bin.js`, `parts-box.js`, `holder-block.js`, `label-card.js` | Shop storage | Upright / flat |
| `hook.js`, `tool-rack.js` | Shop hooks and racks | Hook on its side, rack upright |
| `rc-wing.js` | Wings and tails with control surfaces and servo pocket | Root face down |
| `plane-parts.js` | control-horn, servo-mount, pin-hinge, firewall-mount, fuselage-former, rc-wheel | Flat / base down |
| `quad-parts.js` | multirotor-frame, motor-mount, prop-guard, landing-leg | Flat / motor side down / mount down |
| `tube-clamp.js` | Clamps: split, mount, saddle, parallel, cross | Tube A vertical |
| `tube-joint.js`, `tube-cap.js` | Joints, plugs, caps, feet | Flat-bottom sockets / end down |
| `spacer.js`, `gps-mast.js`, `small-mounts.js`, `fc-parts.js` | Hardware, GPS, antenna, zip-tie, cameras, panels, FC adapter, grommets, dampers | Upright / plate down |
| `robotics.js` | gear, pulley, stepper-mount, bearing-block, shaft-coupler, link-bar, knob, enclosure | Flat / base down |

## Parameter schema

| Key | Use |
|-----|-----|
| `type` | `number`, `integer`, `boolean`, `string`, `select` |
| `default` | Required |
| `min`, `max`, `step` | Numbers. Values outside min/max are rejected. |
| `unit` | Shown next to the field (`mm`, `deg`, `% chord`) |
| `label`, `help` | UI text |
| `group` | Fieldset name in the UI |
| `options` | `select`: `[{ value, label }]` |
| `pattern`, `maxLength` | `string` checks |

Shared schemas:
- `labelParamSchema()` in [`src/core/labels.js`](../core/labels.js): label style, text, size. Use with `frontLabel()`. The shop catalog fills `labelText` and `labelLine2` automatically.
- `mountParamSchema()` in [`src/core/mounts.js`](../core/mounts.js): pegboard, screw or tape mount. Use with `buildMount()`.

## Kernel scope `k`

From [`src/core/kernel.js`](../core/kernel.js). Every object made through `k` is freed after generation. Wrap any direct `k.Manifold` / `k.CrossSection` call in `k.track()`.

| Function | Makes |
|----------|-------|
| `roundedRect(w, d, r, seg)` | 2D rounded rectangle, centered |
| `roundedBlock(w, d, r, z0, z1, seg)` | Rounded box from z0 to z1 |
| `cuboid(size, center)` | Box |
| `rod(a, b, r, seg)` | Cylinder from point a to point b |
| `polygon(points)`, `polygons(contours)` | 2D shapes |
| `extrude(cs, h)` | 2D to 3D along Z |
| `prismX`, `prismY`, `prismZ` | 2D outline extruded along an axis |
| `loftConvex(csA, zA, csB, zB)` | Convex loft (chamfers) |
| `union`, `difference`, `intersect`, `hull` | Booleans |
| `translate`, `rotate`, `mirror`, `placeOnBed` | Transforms |
| `cylZ`, `coneZ`, `hexZ` | Cylinder, cone, hex prism along Z |
| `holeX`, `holeY` | Horizontal teardrop holes (print without support) |
| `dropToBed` | Move to Z = 0 without re-centering X/Y |

Helpers: `teardrop(r)`, `regularPolygon(r, n)` in `kernel.js`; bolt sizes (`BOLTS`, `boltParam`, `bolt`) and hole patterns (`squarePattern`, `crossPattern`, `circlePattern`, `rotate2d`) in [`src/core/hardware.js`](../core/hardware.js).

## Rules

1. Put each part on the bed (min Z = 0) in the orientation it should print.
2. No supports. Overhangs at 45 deg or less, teardrop horizontal holes, chamfers under ledges.
3. Overlap solids you union. Do not let them touch only along an edge or at a point, and do not stack thin 0.01 mm slabs: both leave edges that break after STL rounding.
4. Avoid tangent surfaces: a round hub exactly as wide as a flat socket, or a cone that reaches a plane exactly at a vertex. Make one 0.3-0.5 mm bigger or smaller so the surfaces cross.
5. When a round cutter meets a faceted outline, use an odd segment count (for example 101) so edges never line up.
6. Build a hole and its countersink (or any two cutters on one axis) as one convex hull, not two touching solids.
7. Report problems in `warnings` and print tips in `notes`. Do not throw for fixable inputs.
8. Add presets. `npm test` generates every preset and every select option of every generator and checks each mesh.
