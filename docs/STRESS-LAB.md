# Stress Lab

See how and where a printed part could fail before you print it: load it the way it is used, find weak points and supports, put wings in a wind tunnel, check heat, sun, rain and drops. Tab **Stress Lab**, or **Stress test** next to Download in any designer tab.

> See also: [User guide](USER-GUIDE.md) | [Materials data](../materials/README.md) | [Roadmap](ROADMAP-MTS.md) | [All docs](README.md)

**What it is:** engineering estimates from a voxel finite-element model and textbook aerodynamics, run in your browser. **What it is not:** certified FEA or CFD. Printed parts vary with the printer, temperature, moisture, layer time and seams. Use it to compare designs and orientations and to find the weak spot, then confirm with a test print. Keep a safety factor of 2 or more on parts that carry payloads.

## The part

- **Part**: the last part generated in the designer, an STL from My STL Files, or an STL from your computer.
- **Detail**: number of voxels (cells). Normal (8k) solves in a few seconds; Fine / Very fine for the final check. At least 3 cells through a wall give usable numbers.
- **Material**: datasheet entries (eSUN, Polymaker, Prusament) or your own (Materials & physics).
- **Walls and infill**: cells within walls x line width of the surface are solid; deeper cells are infill, with stiffness and strength scaled by infill % (rule of mixtures, exponent in Physics settings).
- **Print orientation**: the direction the layers stack. STL Tools parts come in print orientation (Z). Layer strength (Z) is checked against stress across layers.

## Stress test

1. Add **anchors** (where the part is held: bolt holes, a clamp face, the plate side) and **loads**:
   - **+ Anchor / + Force / + Pressure / + Torque**, then click the part. The click area radius sets how much surface one click takes.
   - Each anchor or load is listed with its size and direction (into / out of the surface, or along an axis); edit or remove it there.
   - **Whole-part acceleration (g)**: weight (1 g), vibration or a crash (see Environment > Drop).
   - **Quick setups**: hold the bottom; hook or bracket (50 N down at the far end); **servo horn** (enter the servo's stall torque in kg cm from its datasheet: applied as a force at the arm tip, 1 kg cm = 98.07 N mm).
2. **Solve**. The solver runs in a background thread; large parts take longer.
3. Read the result:
   - **Safety factor** colors: red < 1 fails, orange 1-1.5, yellow 1.5-2, light green 2-3, green > 3.
   - The 5 **worst spots** are circled and labeled with the reason: "material overstressed" (in-plane) or "layers pull apart" (across layers).
   - "It would fail at about N % of these loads" (linear model: failure load = load x lowest safety factor).
   - Views: safety factor, stress (von Mises), stress across layers, displacement, walls vs infill.
   - **Bend** slider: exaggerated deformed shape. **Cut** slider: look inside along X, Y or Z.
   - **Animate the load 0 to 200 %**: watch where it turns red first.
   - Point at the part to read values (probe).
   - **Compare materials**: the same load case for every material with data, sorted by safety factor (stress does not depend on stiffness for one material, so this is instant; movement scales with stiffness).

Accuracy (test/v13.test.js): a 100 x 10 x 10 mm cantilever deflects 94 % of beam theory with 4 voxels through the thickness (98 % with 8); root stress within about 10 %.

## Weak points and supports

No load needed:
- **Thin walls** (purple): thinner than the limit (default 2 lines of the line width).
- **Overhangs** (orange faces): steeper than the limit from vertical (default 45 deg).
- **Printed over air** (blue) and **support columns** (translucent): support volume, columns to the plate vs on the part.
- **Narrowest layer** (red): where the cross-section is smallest, a typical snap point across layers.
- **Islands**: heights where a new region starts in mid-air.

Change the print orientation to compare.

## Wind tunnel

- **Wing or blade**: the lab cuts the part at a span position, finds the leading edge by shape and the cambered side (any print orientation), and runs a 2D panel method (Hess-Smith) for pressure (Cp), lift and pitching moment. A lifting-line correction with your span efficiency e gives the 3D wing lift and induced drag; profile drag comes from flat-plate skin friction x form factor (Raymer).
  - **Axes: auto** takes span = longest side, lift = thinnest side.
  - **Whole wing span**: when the part is one printed section, enter the tip-to-tip span; the part's share of the lift is used for the stress test.
  - 3D: surface colored by Cp (red = suction), airflow dots through the section field at five span stations, lift and drag arrows. 2D: section with streamlines and the Cp curve; polar (CL and L/D vs angle).
  - **CL max** (optional, from your airfoil's polar at your Reynolds number) caps the lift; without it no stall is shown (the panel method is inviscid).
  - **Apply this lift to the stress test**: root held, lift spread over the surface.
  - **Edit the wing in the designer**, generate again, come back.
  - Accuracy: NACA 0012 at 5 deg gives CL 0.60, NACA 2412 a zero-lift angle of -2.0 deg and Cm -0.053 (thin-airfoil theory -2.08 deg, -0.053); sections cut from printed wings land within about 15 % of the reference airfoil.
- **Body (drag only)**: frontal area x reference Cd (Hoerner shapes) or your own Cd; apply the drag to the stress test.
- Air: ISA standard atmosphere at your altitude, or your temperature.

## Environment

- **Heat**: hottest temperature vs the datasheet heat deflection temperature (0.45 MPa, or 1.8 MPa when the part's stress is higher; flagged when stress exceeds the test load).
- **Sunlight time-lapse**: enter the strength kept after one year outdoors (from a weathering test or your own). The model and the safety factor fade year by year. No rate = no time-lapse (nothing invented).
- **Rain**: choose where the sky is; water pooling on the part is shown in blue with its volume (priority-flood on the top surface). Add a drain hole at the deepest spot.
- **Moisture**: datasheet water uptake and drying advice.
- **Drop**: height and stopping distance give the peak g (energy balance); **Use in the stress test** sets the whole-part acceleration.
- **Fatigue**: with S-N values (sf', b) from a test of the material, cycles to failure for a load that cycles 0 to full (Basquin).

## Materials and physics

- Datasheet entries with links to their source; values the sheet does not give are blank.
- **Add your own material**: brand, product, modulus and strength in X-Y and Z (from your test bars), HDT, UV rate, fatigue values, source.
- Physics settings: Poisson's ratio (0.35 default, a typical thermoplastic value, not on most datasheets), infill stiffness exponent, line width, solver tolerance and step limit. Saved in this browser.

## Files

| File | What |
|---|---|
| `src/core/lab/voxel.js` | STL to voxel grid, surface and depth maps |
| `src/core/lab/fea.js` | 8-node hex elements, matrix-free conjugate gradient, stresses, failure index |
| `src/core/lab/weak.js` | thin walls, overhangs, supports, cross-sections, islands, water pooling |
| `src/core/lab/aero.js` | ISA air, panel method, section cutter, wing polar, body drag |
| `src/core/lab/env.js` | heat, UV, moisture, fatigue, drop |
| `public/lab.js`, `public/lab-worker.js` | the page and the solver thread |
| `materials/filaments.json`, `src/core/materials.js` | datasheet materials, your materials (`<data>/materials.json`) |
