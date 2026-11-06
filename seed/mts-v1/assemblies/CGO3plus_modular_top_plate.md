# CGO3+ modular top plate (Typhoon H / H480)

Status: **v1 designed, not printed, no last known good.** Source chat: "Yuneec CGO3 modular top plate" (Oct 24 2026).

## Source files (attach)
`CGO3P_TopPlate_Modular_v1.stl`, `CGO3P_Sled_Universal_v1.stl`, `params_v1.json`, `build_v1.py`, `README_v1.md`, and the base `Typhoon_H_Camera_Mount.stl` from Thingiverse thing:1683583 (Alex confirmed this is the true size).

## v1 content
- Base plate geometry kept exactly: slide rails, 6 contact windows, damper bores, skirt. The source STL had T-junction cracks and was rebuilt from 0.1 mm Z slices (trimesh.section + shapely cleanup + manifold3d union) to get a closed solid.
- Added a dovetail rail block on each side in the waist between the damper ears, each with 3 M3 insert holes for a thumb-screw lock.
- Universal sled: 20x20 (M2) and 30.5x30.5 (M3) board patterns, center wire slot, thumb-screw dovetail lock.
- Plate grows from about 71 to 85 wide. Sled hangs about 36 below, about 10 outside the stock outline.

## Print
PETG or ASA (the base STL author says PLA is not suitable). Plate with supports like the original. Sled flat on its outer face, no supports.

## Risks / untested
- Landing gear retract clearance with the wider plate.
- Gimbal pan sweep hitting the sled.
- Rollback: reprint the original base STL.

## Needed for v2 modules
1. JC02 rangefinder outer size and mounting holes (measure the real module).
2. Drop servo size: standard, mini or micro.
3. Black Mamba VTX hole pattern (if not 20x20).
4. Retract test result: does a 7 mm rail each side clear?

## Fit notes from research
- CGO3 damper tubes are about .10 in shorter than CGO3+; keep CGO3+ tube depth.
- If the contact board pocket is too thick, the board will not sit flat and loses contact with the drone side.
- CGO3 has 3 top contacts, CGO3+ has 6.
