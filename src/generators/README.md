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

Register it in [`src/core/registry.js`](../core/registry.js).

## Generators

| File | Print orientation | Notes |
|------|-------------------|-------|
| `stack-bin.js` | Upright | Stepped foot with a 45 deg chamfer. Dividers stop below the foot of the bin on top. |
| `parts-box.js` | Upright, lid plate-down | Lid lip fits inside the walls with `clearance` per side. |
| `holder-block.js` | Upright | Pockets are item size + clearance. Entry chamfer by scaled extrusion. |
| `hook.js` | On its side | Outline is drawn in the Y/Z plane and extruded along X, then rotated so X is print Z. |
| `tool-rack.js` | Upright, shelf on bed | Diamond pegboard pegs (45 deg overhang only). |
| `label-card.js` | Flat | Text margin 2.6 mm keeps text inside the slot window. |
| `rc-wing.js` | Root face down | Root airfoil extruded, then each vertex warped for taper, sweep and twist. |

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

Helpers: `teardrop(r)` for horizontal holes, `regularPolygon(r, n)`.

## Rules

1. Put each part on the bed (min Z = 0) in the orientation it should print.
2. No supports. Overhangs at 45 deg or less, teardrop horizontal holes, chamfers under ledges.
3. Overlap solids you union. Do not let them touch only along an edge or at a point, and do not stack thin 0.01 mm slabs: both leave edges that break after STL rounding.
4. Report problems in `warnings` and print tips in `notes`. Do not throw for fixable inputs.
5. Add a test in `test/generators.test.js`. `npm test` also generates every preset and checks every mesh.
