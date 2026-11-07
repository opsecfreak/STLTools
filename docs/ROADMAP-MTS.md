# MTS personal edition: roadmap

Plan for the next versions of STL Tools on branch `mts-personal`, built for MobileTechSpecialists / MTS-UAV first. A public release follows only after a feature is proven here; personal data (parts list, the shop printer's preset) stays on this branch.

> See also: [All docs](README.md) | [Printers](PRINTERS.md) | [CHANGELOG](../CHANGELOG.md) | [AGENTS.md](../AGENTS.md)

Status key: **Done**, **Next**, **Planned**, **Decide** (needs Alex's word first).

## Rules every version keeps

1. **No invented numbers.** Part sizes, material properties, prices: from a datasheet or a measurement, with the source, or left blank and flagged. Simulation models show their coefficients and say "illustrative until calibrated".
2. **Printer safety.** View only until Alex approves control mode in writing (v1.3). Never auto-start a print. Never change printer.cfg.
3. **Watertight, print-oriented STLs**, every option tested.
4. **Version labels and changelog** (changed / fixed / untested) on every release; last known good named; rollback path given.
5. **Personal first.** Build and prove on `mts-personal`; port to `main` (public) only with personal data removed.

## Where it stands

| Version | Status | Content |
|---|---|---|
| 1.0.1-mts.1 | Done, released | Public 1.0.1 + MTS parts list (98 parts), print ideas, assembly specs |
| 1.1.0-mts.1 | Done, on `mts-personal` | Public 1.1.0 (USB / one-time / Pi 4-5 hosting, LAN PIN, optional printers, live webcam, printer-based estimates) + shop printer fixes (below) + SV07 v3 profile + this roadmap |
| 1.2.0-mts.1 | Done, on `mts-personal` | Opt-in printer control with warning, confirm and log (moved up from the old 1.3 on your word); slicing research ([SLICING-RESEARCH.md](SLICING-RESEARCH.md)); materials data from eSUN, Polymaker and Prusament datasheets ([materials/](../materials/README.md)) |
| **1.3.0-mts.1** | **Done, on `mts-personal`, not released yet** | **Stress Lab** first (your word 2026-11-07: "start the stress lab and wind tunnel and environment stuff"): stress test with click-placed anchors and loads, weak points and supports, wind tunnel (3D), environment, materials and physics ([STRESS-LAB.md](STRESS-LAB.md)). The rest of the old 1.3 list (pick-then-tune UI, units, settings search, estimate presets, MOD saves, browse tree, collections) follows in 1.3.x. |

1.1.0-mts.1 shop printer fixes (from your 192.168.1.121 report):
- The connection test failed with "Printer address is required" because Test connection ran with an empty field. The scan had found the printer (`mkspi` at `http://192.168.1.121`). Now: an empty field explains what to do, scan results have **Use and test**, port 7125 is tried by itself if port 80 does not forward the API, the name comes from Mainsail ("MTS-UAV SHOP PRINTER"), and `mkspi` selects the SV07 profile.
- Webcam: read from Moonraker's list, else from Mainsail's own database (your backup's `webcams` block: `/webcam/?action=stream`, mjpegstreamer, 15 fps). crowsnest is down on the printer, so it now shows **Camera unavailable** (HTTP 502 or refused) with the fix, instead of a blank image.
- **Printer details**: health check and printer.cfg viewer (read-only, secrets hidden). It reads the *effective* `pause_on_runout` value. Note: Klipper's documented default for `pause_on_runout` is true, so a commented-out line may mean it is already on. The health check shows the real value; check it before you change printer.cfg (unverified on Klipper 0.11.0-122).
- Estimates: profile `sovol-sv07-mts-v3` from `sv07-alex-v3.ini` (80/50/25/200 mm/s, 2000 accel, 20 mm3/s), chosen automatically for `mkspi`. Klipper's axis travel (225) no longer enlarges the 220 mm bed.
- Designer: changing the generator rebuilds the 3D view at once (the "model does not update until I touch a setting" bug).

## Version plan

### 1.3.0-mts: easier picking, then settings (Next)

Goal: browse and look first, choose, then tune and generate. Lower clicks, less clutter.

1. **Pick, then tune flow.** Browse view shows parts as large 3D cards and full assemblies (a hook or a whole frame). "Use this" opens a focused editor: settings, material, printer, quality preset, then **Generate best version** (applies the printer and material rules below).
2. **Save as a mod.** Changing a preset or design offers "Save as `<name> MOD <your text>`" (keeps the original).
3. **Units.** mm / cm / in toggle for display and entry everywhere (STL output stays mm). Stored per user in Settings.
4. **Simple / Standard / Expert view** for the whole UI (what panels and fields show), plus Home layout options (which sections, order, card size).
5. **Settings page:** search box, compact two-column layout, collapsible sections.
6. **Print estimate presets:** dropdown Draft (0.28 mm) / Standard (0.2) / Fine (0.12) / Strong (4 walls, 25 % gyroid) / MTS v3 (from the ini), like the material dropdown. Each preset shows its values and can be edited and saved as your own.
7. **Filament cost per material:** a price field per material (PLA, PETG, ...), blank until you enter it. No invented average prices.
8. **Projects:** a filament (material, brand, color, cost) per project and per item; totals use it.
9. **Collections:** STL collections only (imported and generated STLs). Presets are organized by the new Browse tree instead. Existing collections keep their items. **Decide:** convert existing preset items or leave them.
10. **Browse and search revamp:** category tree in the sidebar (collapsible), size families nested (tube clamps grouped by tube size, then variants), fewer near-duplicates in results, search suggestions with filters (`tube:16`, `bolt:M3`), recent and pinned items.
11. **3D view:** more built-in controls on the view (section box, measure tool between two points, part explode slider, background, lighting presets) and their settings.

Acceptance: UI smoke test covers pick > tune > generate > save mod; units round-trip mm/in/cm; settings search finds every field.

### 1.4.0-mts: the shop printer in depth (Planned; control is done in 1.2.0-mts.1)

Based on the Muse brief (STLTools-printer-connection.md) and SV07 guidelines.

1. **Community printer profiles:** a profile library (shipped + `custom/printer-profiles` + import JSON), "duplicate and edit" in the UI, profile from the printer's live config (motion limits, nozzle) plus your slicer ini (import `.ini` from PrusaSlicer / Orca exports: speeds, accel, temps, flow cap, layers).
2. **Live updates over Moonraker's websocket** (`printer.objects.subscribe`, `notify_gcode_response`, `notify_filelist_changed`) instead of the 3 s poll. Console output view (read-only).
3. **Debug tools (read-only):** Klipper / Moonraker / crowsnest log viewer (`/server/files/logs`), objects browser (`/printer/objects/list` + query), bed mesh heightmap view, history totals and failure reasons by month, MCU / host version report. Warnings like "mesh point over 0.2 mm off its neighbours".
4. **Opt-in control mode: Done in 1.2.0-mts.1** (your word 2026-11-07: "add printer control, but require the user to enable it and give them a warning"). Next here: console replies in STL Tools (websocket), temperature presets, a control-test that checks reachability without moving anything.
5. **Pre-print checklist** from the SV07 guidelines as a page (bend test, heat 220/65 soak, Z_TILT, mesh load, header check), filled per print and saved with the job.

Acceptance: against the fake Moonraker; no control call fires in connection tests; a dead webcam shows its state.

### 1.5.0-mts: slicing preview, splitting, arranging (Planned)

1. **Slicing (research done, build on hold by your word):** STL Tools' own layer preview first, plus a G-code viewer for files on the printer. Sovol's slicer is OrcaSlicer with Sovol profiles (see [SLICING-RESEARCH.md](SLICING-RESEARCH.md)); the later option is OrcaSlicer's CLI on the PC with the shop values as Orca JSON, replacing Muse's PrusaSlicer conversion chain. PrusaSlicer: on hold. `sv07-alex-v3.ini` lives in the data folder, not git.
2. **G-code viewer:** files from the printer or from the slicer, layer slider, speed and feature colors, travel moves.
3. **Supports and overhangs:** overhang map (angle threshold from the profile, 45 deg default), bridge spans, islands, support area and volume estimate, "rotate to reduce supports" suggestions, build-plate-only vs everywhere preview.
4. **Part splitter:** cut planes placed by hand or automatically to fit the SV07 bed (220 x 220 x 250) with joints: dovetail, alignment pins, M3 bolt bosses, glue lap. Made for the plane wings first (span split at ribs, spar channel kept continuous, joiner tube option).
5. **Smart arrangement:** pack parts and copies on one or more SV07 plates (rotation allowed, spacing, brim margin), plate count, per-plate time and filament.
6. **Anchoring:** every part placed flat on the plate in its best orientation (largest flat face, fewest overhangs, strongest layer direction for the load case of v1.5).

### 1.6.0-mts: parts library growth (Planned)

1. **Modular quad frames as assemblies:** main plates, arms, arm locks / latches, motor mounts per motor pattern, battery tray, FC stack with nylon standoff sets (M2 / M2.5 / M3, 5 to 30 mm), cable routing channels and zip-tie slots. Joint options: printed latch, through bolts, or heat-set inserts M2 to M4 at any length (insert sizes from the fit-test coupon results you enter).
2. **Microcontrollers and modules:** Seeed XIAO family (ESP32-C3, ESP32-S3, ESP32-C6, RP2040, nRF52840, SAMD21), ESP32 DevKit (30 and 38 pin), STM32 Blue Pill and Black Pill, Raspberry Pi Pico, Arduino Nano. Board outline sizes from the maker datasheets in `verify`; anything without a published drawing stays MEASURE.
3. **Cameras and antennas:** Raspberry Pi Camera Module 2 / 3 housings and tilt mounts, SMA / RP-SMA bulkhead mounts, u.FL strain reliefs, dipole and patch antenna holders, angled antenna tubes.
4. **Weatherproof enclosures:** project box lid with a gasket groove and a matching printed TPU gasket (or O-ring cord size), cable glands (PG7 / PG9 / M12 openings), vent cutouts. Groove size by the compression you set (default 25 %, editable); flag it as "test with your TPU".

### 1.7.0-mts: Stress Lab (Planned, largest piece)

A new tab to see how and where a printed part could fail, before printing it.

1. **Materials library, editable:** started in 1.2.0-mts.1: `materials/filaments.json` (eSUN PLA+ with X-Y and Z values from its Feb 2026 datasheet, eSUN brand table, Polymaker PolyLite PLA / PETG / ABS and Polymaker ASA, Prusament PETG V0). Next: Overture, SUNLU, Hatchbox, Elegoo datasheets (no Bambu Lab, your word), editing in the UI, your own test results as entries.
2. **Print settings in the model:** walls, infill %, pattern, layer height and **print orientation** change the effective section (shell plus infill) and the weak direction (between layers).
3. **Solver:** voxel finite-element analysis (linear elastic) in a Web Worker in the browser: mesh to voxels (0.5 to 2 mm), anchors and loads, conjugate-gradient solve. Results: stress heatmap, deflection (exaggerated view), safety factor map, first-failure location. Stated as an estimate (+/- large); calibrate with a printed test bar.
4. **Load cases and anchors:** pick faces to fix (bolt holes, clamp faces, build-plate face) and apply force, pressure, torque, or acceleration (g load for drone parts, crash drop height). Presets: servo horn at servo stall torque (you enter the servo's rated torque), tube clamp tightening, hook load, arm tip thrust per motor, landing impact.
5. **Weak point markers without the solver:** thin walls under 2 perimeters, small cross-sections along the load path, sharp inside corners (stress raisers), long unsupported spans, layer seams across the load direction, holes too close to edges.
6. **Views:** stress / deflection / safety factor / layer direction maps, cut plane through the part, probe a point, before / after compare, animation of the load ramping up, side-by-side material comparison (PLA vs PETG vs CF).
7. **Supports in the same view:** the support and overhang map of v1.4, plus "layers that print over air" and bridge sag warnings.

### 1.8.0-mts: wind tunnel and environment (Planned)

1. **Wind tunnel:** part anchored as mounted; flow direction and speed. Wings: airfoil section (2D panel method) and finite wing (lifting line): lift, drag, pitching moment vs angle of attack, stall onset estimate, load on the spar fed into the Stress Lab. Bodies and mounts: drag from frontal area and a drag coefficient you choose (with references). Adjust wing parameters, re-run, **save the variant** as a design.
2. **Sunlight / UV:** time-lapse view of property loss and color change by material, from the material's UV fields (blank = not shown). Labeled illustrative unless you enter measured data.
3. **Rain and moisture:** water uptake by material and time, swelling and strength change for hygroscopic materials (Nylon, PETG); enclosure leak check: gasket compression, gaps, drain holes.
4. **Heat:** sag under load near the heat deflection temperature (car dash, motor mounts, battery bays).
5. **Fatigue:** cycles to failure estimate for vibration (props, servos) from an S-N curve you enter; default off without data.
6. **Physics settings:** every coefficient and model choice is visible and editable, saved as named physics profiles for development work with custom materials.

### 2.0.0: public release of what is proven

Port the proven features to `main` without MTS data (parts list, shop printer profile, roadmap), new screenshots, docs, a public release. Decide then which personal features stay personal.

## Order and why

1.3 next: everything later (Stress Lab, splitter, wind tunnel) needs the pick-then-tune flow, units and the better browser. 1.4 then, because the printer is in daily use. 1.5 before 1.7 because orientation, supports and plate placement feed the Stress Lab. 1.6 can run in parallel with 1.5 (parts only).

## Decisions

| # | Decision | Answer (2026-11-07) |
|---|---|---|
| 1 | Control mode for the shop printer | **Yes**: opt-in per printer, with a warning. Built in 1.2.0-mts.1. |
| 2 | Slicing | **Hold off on PrusaSlicer.** Research Sovol's slicer and Muse's method first: done ([SLICING-RESEARCH.md](SLICING-RESEARCH.md)). Next build decision: own preview + OrcaSlicer CLI option. |
| 3 | Collections: move existing preset items out | No answer: default applies (keep existing items, new ones STL only). |
| 4 | Where `sv07-alex-v3.ini` lives | **Data folder, not git.** |
| 5 | Stress Lab material values | **eSUN and the top few brands, no Bambu Lab.** Started: eSUN, Polymaker, Prusament. |

Open: OrcaSlicer CLI integration (needs your word before building); which other brands after eSUN / Polymaker / Prusament.

## Known limits (honest)

- The Stress Lab and wind tunnel are engineering estimates, not certified FEA or CFD. Printed parts vary a lot by printer, filament brand, moisture and orientation. Use them to compare designs and to find weak spots, and confirm with a printed test.
- The Pi 4 / 5 runs the server; the heavy simulation runs in the browser of the device you use (PC recommended).
- The shop webcam is down until crowsnest is restarted on the printer; no webcam test against the real printer until then.

## Dead ends (do not retry)

- Using Klipper axis travel as the bed size: the SV07 reports 225 mm travel on a 220 mm bed. Fixed: the profile bed is the limit.
- A `:7125/webcam/` snapshot: Moonraker has no such route (404). The camera is on port 80 `/webcam/` (nginx) or 8080 directly.
- Uploading config under any name but `printer.cfg` changes nothing (from the Muse notes); STL Tools does not upload config at all.
