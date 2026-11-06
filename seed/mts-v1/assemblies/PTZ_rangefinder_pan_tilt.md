# PTZ rangefinder / camera pan-tilt (v1 to v5)

Status: designed in software, **nothing printed, no last known good**. Latest is **v5**. v4 is the fallback.
Source chats: "STL holder with camera slot" (v1, Oct 23 2026) and "3D-printed pan-tilt camera housing" (v2 to v5, Oct 26 2026).

## Source files (not in this zip)
The STLs and Python source live in the zips delivered in those chats. Attach them next to this package:
- `ptz_v5.zip` (current): 13 STLs, `params.py`, `build.py`, `check.py`, `check_inserts.py`, `parts/`, `PRINT_GUIDE.md`, `README.md`, renders.
- `ptz_v4.zip` (fallback, no inserts), `ptz_v1.zip` (servo, split head).
If a zip is missing, rebuild from this spec. Do not guess dimensions that are marked UNVERIFIED; keep them as parameters.

## Toolchain
```
pip install --break-system-packages manifold3d trimesh numpy
python3 build.py            # writes stl/
python3 check.py 90 90      # pan/tilt sweep collisions + gear mesh, must print "clear"
python3 check_inserts.py    # wall around every insert
```
OpenSCAD was not available; the model is manifold3d CSG in Python. Interference is checked by boolean intersection volume across the sweep.

## Version history
| Ver | Drive | Key change |
|---|---|---|
| v1 | 2x MG996R-class servos | Head split vertically (5x M3x35), JC02 + 19 mm camera + Split board inside, hollow 6 mm trunnion, cable tunnels, ±90 pan/tilt clear |
| v2 | Servos, 2:1 involute gears | Bearings on all pivots (6801/6806/608), base with 3S battery, VTX, electronics |
| v3 | Servos | Hollow head shell with locator rails for lens and rangefinder window |
| v4 | 2x 28BYJ-48 + ULN2003 | D-shaft pinions, ear-mount slots for mesh adjust, 608 removed, unit ~8 mm shorter |
| v5 | 28BYJ-48 | Heat-set inserts everywhere (10x M2, 16x M3) with bosses; tight precision fits, loose module pockets; captive-nut pinions; turntable 86 dia (was 80) |

## v5 printed parts (all fit 220x220, files already in print orientation, do not rotate or scale)
| # | File | Qty | Layer | Walls | Infill | Supports | Brim |
|---|---|---|---|---|---|---|---|
| 01 | head_shell | 1 | 0.20 | 4 | 25% gyroid | Tree, build plate only, under the two trunnions | 4 mm |
| 02 | head_lid | 1 | 0.20 | 3 | 20% | no | no |
| 03 | tilt_gear_40T | 1 | 0.12 | 5 | 50% gyroid | no | no |
| 04 | stepper_pinion_20T | 2 | 0.12 | 5 | 60% gyroid | no | no |
| 05 | arm_left | 1 | 0.20 | 5 | 40% gyroid | no | no |
| 06 | arm_right | 1 | 0.20 | 5 | 40% gyroid | no | no |
| 07 | tilt_gear_cover | 1 | 0.20 | 3 | 20% | no | no |
| 08 | turntable_40T | 1 | 0.16 | 5 | 40% gyroid | no | 4 mm |
| 09 | pan_retainer | 1 | 0.20 | 4 | 50% | no | no |
| 10 | pan_boss | 1 | 0.16 | 6 | 60% | no | no |
| 11 | base | 1 | 0.20 | 4 | 20% gyroid | no | 5 mm |
| 12 | base_cover | 1 | 0.20 | 3 | 20% | no | 5 mm |
| 13 | battery_door | 1 | 0.20 | 3 | 20% | no | no |

Print order: 04 (fit test) first, then 03, 08, 10, 09, 01, 02, 05, 06, 07, 11, 12, 13.
Global: PLA 205-215 C, bed 60 C, 0.45 line width, 5 top/bottom, XY hole compensation 0, elephant foot 0.15.

## Inserts (v5)
| Part | M2 | M3 |
|---|---|---|
| head_shell | 4 | 1 |
| arm_left | 0 | 2 |
| arm_right | 3 | 2 |
| pan_boss | 3 | 0 |
| base | 0 | 11 |
Hole sizes (UNVERIFIED, common values): M2 3.2 dia x 4.5 deep, M3 4.0 x 5.5, M4 5.6 x 6.5 (reserved). 0.4 mm mouth chamfer, min 1.2 mm wall. Measure the kit and edit `INS` in params.py.

## Fit strategy
Precision fits print tight (sand/file to fit): 6801/6806 pockets nominal 21.0/42.0, trunnions 12.0, pan boss seat 30.0, D-bores +0.05.
Module fits print loose (putty/foam): rangefinder and camera pockets +0.5 per side, Split groove +0.35, RP2040 slot +0.6, stepper cutouts +0.6 with ±1.5 ear-slot travel, VTX locators +0.6, battery bay +1.0 (bay 77x37x28), door plug -0.4.

## Hardware (v5)
- 2x 28BYJ-48 5V, 2x ULN2003, 2x 6801-2RS, 1x 6806-2RS.
- Screws: 4x M2x6 (lid), 3x M2x18 (gear cover), 3x M2x6 CSK (pan retainer), 1x M2x5 (camera), 1x M3x8 + washer (tilt gear), 4x M3x8 CSK (arms), 4x M3x8 CSK (pan boss), 5x M3x8 CSK (base cover), 2x M3x6 (door), 2x M3x12 button head + nut (tilt stepper), 2x M3x8 button head + nut (pan stepper), 2x M3x8 grub + 2x M3 nut (pinions), 4x M4 (mount ears), 1x 1/4-20 nut (tripod).
- Stepper ear screws must be button heads (ISO 7380); socket heads hit the pinions.

## Electronics layout
- Head: RP2040-Zero #1 (JC02 UART, Split OSD UART, CRSF in), JC02, RunCam Split 3 Micro camera + board.
- Base: RP2040-Zero #2 driving both steppers via ULN2003, 5V converter (3 A or more), CR8 RX, Black Mamba VTX straight off 3S, fan down over grille, SMA out rear.
- Hollow trunnion: 4 wires (5V, GND, video, CRSF). Pan bore: those 4 + tilt stepper 4 coil wires.
- No endstops. Firmware must hold position across power cycles; keep pan within ±180 for cables.

## Open items for v6
1. Measure insert kit, update `INS`.
2. Measure 28BYJ-48 (shaft height, flats, wire cover side), 3S pack, VTX SMA height, Split SD slot edge.
3. Print pinion first; adjust `D_CLR`.
4. Optional microswitch home mount on pan and tilt.
5. JC02 PCB side (`RF_PCB_SIDE`) confirmed from the real module.
