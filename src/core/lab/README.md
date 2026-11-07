# src/core/lab: Stress Lab engines

The math behind the Stress Lab tab. The same files run in the browser (served at `/shared/lab/`, the solver in a Web Worker) and in Node (tests). No imports besides each other; units mm, N, MPa unless named.

> See also: [Stress Lab guide](../../../docs/STRESS-LAB.md) | [Materials data](../../../materials/README.md) | [UI: public/lab.js](../../../public/README.md) | [Tests: test/v13.test.js](../../../test/README.md)

| File | Model | What it gives |
|---|---|---|
| `voxel.js` | Voxelizer: a cell is solid when its center is inside the mesh (ray parity along Z). Depth map for walls vs infill. | Grid of the part at the chosen detail (Normal 8k cells and up). Open meshes give a warning. |
| `fea.js` | Linear elastic finite elements: one 8-node hexahedron per voxel, 2x2x2 Gauss, matrix-free conjugate gradient (Jacobi). Infill cells scaled by the rule of mixtures. Failure index with a separate layer (Z) strength. | Displacement, von Mises stress, safety factor per cell, first places to fail. |
| `weak.js` | Geometry checks: thin walls (neighbourhood depth), overhang angle, cells printed over air and support columns, cross-section per layer, islands, rain pooling (priority flood). | Weak points and supports without a load case. |
| `aero.js` | ISA air with Sutherland viscosity; Hess-Smith panel method for the wing section (Kutta condition); Prandtl lifting line with an Oswald factor; skin-friction drag (Blasius / Schlichting) with Raymer form factors; body drag from frontal area and a reference Cd (Hoerner). Section cutter finds leading edge, chord and camber from the STL. | Cp on the surface, Cl, Cd, Cm, polar, lift and drag in N, airflow dots for the 3D view. Inviscid section: no stall prediction. |
| `env.js` | Heat check against the datasheet HDT / Tg, UV strength timeline from your retention rate, moisture uptake from the datasheet, Basquin fatigue from your S-N data, drop deceleration in g. | Pass / warn per condition; "no data" when the material has no value. |

## Accuracy (measured in tests)

- Cantilever 100 x 10 x 10 mm, tip load: deflection 94 % of beam theory with 4 voxels through the thickness, 98 % with 8; root stress within about 2-8 %. Fewer than 3 voxels through a wall reads too stiff.
- Panel method on NACA 0012 and 2412 checked against thin-airfoil theory, and a section cut from a printed wing checked against the reference airfoil; see `test/v13.test.js`.

These are engineering estimates for comparing designs and orientations. They are not certified FEA or CFD. Confirm with a test print and keep a safety factor of 2 or more on parts that carry payloads.

## Adding a model

1. Keep it import-free (browser and Node) and state its source in the file header.
2. Use only datasheet or user-entered numbers; return "no data" instead of a default guess.
3. Add a test against a textbook result in `test/`.
