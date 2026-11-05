# First test: what to try and how to report back

This is the first real-world test. Work through the list, print a few small parts, and send the feedback block at the end.

## A. Install and start (10 minutes)

1. Install for your computer with [INSTALL.md](INSTALL.md).
2. Note which file you used and whether any security warning appeared.
3. Check the bottom-right corner of the 3D view: it shows the version, generator count and preset count.

## B. Click through the app (20 minutes)

1. **Shop** tab: load "Props 5 in". Change the height. Press **Generate**.
2. **Shop** tab > **Shop catalog**: add an item (category, name, location). Press **Make**. Press **Print paper labels**.
3. **Planes** tab: load "Trainer wing 1200 mm span". Check that the aileron and servo pocket are visible. Press **Download all (ZIP)**.
4. **Quadcopters** tab: load "ESC tray on a 16 mm arm" (Arm and Frame Mounts) and "5 in X frame".
5. **Accessories** tab: load "Snap-on clip + plate, 16 mm" and "Two-piece clamp + plate, 16 mm". Change tube OD to your real tube size.
6. **Robotics** tab: load "Gear module 1, 20 teeth".
7. Press **Save design** on something you changed. Open **My Designs**. Press **Load**.
8. Press **Open STL file** and open any STL from your computer.
9. Optional: start with `--lan` and open it from your phone.

## C. Print these first (small, fast, they test the defaults)

| # | Preset | Tab | What to check |
|---|---|---|---|
| 1 | `clamp-mount-10` (or your tube size) | Accessories | Bore fit on the tube, bolt and nut fit, plate flat |
| 2 | `clamp-snap-16` (or your size) | Accessories | Snap force: too hard, right, too loose? |
| 3 | `clamp-2pc-16` | Accessories | Halves line up, bolts reach, nut traps hold nuts |
| 4 | `esc-on-arm-16` | Quadcopters | ESC fits the tray, zip-tie slots, saddle sits on the arm |
| 5 | `bin-xs-75x100` x 2 | Shop | Bins stack and come apart easily |
| 6 | `label-card-53` | Shop | Card slides into the bin slot |
| 7 | `hook-peg-j-short` | Shop | Pegs fit your pegboard |
| 8 | `joint-tee-10` | Accessories | Tube fit in the sockets |
| 9 | `gear-m1-20` + `gear-m1-40` | Robotics | Mesh at 30 mm center distance |

Print settings for the test: your normal PLA or PETG profile, 0.2 mm layers, 3 walls, 15-20% infill, no supports.

## D. Feedback block

Copy this, fill it in, and send it back:

```
STL Tools feedback
Version (bottom-right of the 3D view):
Computer + file used:
Install problems / warnings:
Printer + slicer + material:

Prints (preset, result: good / tight / loose / broke / other, measured numbers if you have them):
1.
2.
3.

Things that did not work or were confusing:

Parts or features I want next:
```

Measured numbers help most, for example "16 mm tube: bore too tight, needed clearance 0.25" or "snap 0.82 too hard, 0.86 good". Those go straight into the next version's defaults.
