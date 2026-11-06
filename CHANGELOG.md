# Changelog

## 1.0.0 - 2026-11-06 (first public release)

Changed: open source under Apache-2.0 (LICENSE, NOTICE, CONTRIBUTING). Browse page: everything with facet filters and counts (type, tab, category, generator, tags, size series, measuring, ownership) and Collections, your own named groups of presets, designs, generators, STLs and projects ("+" on any card). Tooltips on every button and setting, with range, default and setting name; Settings > Tooltips and help sets on/off, delay, size, where help text shows, and card details. 6 new generators: battery cell holders (18650 / 21700 / 26650 / 14500 / AA / AAA, pack end plates with strip grooves, storage), SK-style shaft supports, drawer unit (assembly with N drawers), spool holder arm, printed multirotor arm, drill guide; 251 new checked size-series presets (3,661 total, 54 generators). The shipped parts list is now a generic example (seed/example); the hardware holder presets stay, with neutral ids (hw-...). The previous personal parts data lives on branch `mts-personal-data`.
Fixed: n/a.
Untested: the new parts as prints (cell diameters vary by maker: measure; drawer and spool fits need a test print); tooltips on touch screens (they show on mouse hover only).
Breaking: preset ids `mts-*` were renamed to `hw-*` (projects or shop items that used an `mts-*` preset show it as missing; re-add it or import the parts list from branch `mts-personal-data`).

## v8 (0.8.0) - 2026-11-06

Changed: assemblies: generators can return parts that fit together, shown "Assembled" (one color per part) or as a print plate in the 3D view; new `servo-gimbal` (pan-tilt on 9 g to MG996R servos: base, pan bracket, camera arm with FPV cheeks / tripod plate) and `brushless-gimbal` (roll + tilt frame for a SimpleBGC 2-axis controller: damper top plate, roll arm, camera cage) with 6 presets (MG996R and SimpleBGC linked to My Parts; unknown sizes left to measure). Per-part print estimate table under the 3D view: size, quantity, time, grams and metres, layers, bed fit, STL link, totals. Projects: "Show parts, print times and 3D assembly" builds every part, shows the per-part table and a 3D view where each item can be moved and turned (saved with the project); the ZIP README lists time and grams per STL. Simple / All settings switch in the designer (main sizes only, or everything) and a "Make something" row on Home for quick parts. End-to-end test of generation and export for all 48 generators (API STL and ZIP downloads parsed back, CLI files).
Fixed: the Shop sub-tab handler took over other sub-tab buttons; My Parts row style squashed the project part cards.
Untested: both gimbals as printed parts (servo and horn sizes vary: measure; check tilt clearance in the Assembled view), brushless gimbal balance and motor fit, the project 3D view on a Raspberry Pi.

## v7 (0.7.0) - 2026-11-06

Changed: 3,404 presets (was 323): about 3,000 checked size series (clamps per tube size, joints, caps, spacers and washers per bolt and length, bins, boxes, gears, racks, GT2 pulleys, couplers, 32 bearing sizes, knobs, link bars, holders, hooks, motor mounts, frames, wheels, hinges, horns, formers, trays, panel cutouts, tool racks, GPS masts, FC and damper plates, extrusion brackets, fit tests) built by `scripts/build-series.mjs`; 104 presets for the parts in your list. My Parts page: 98 parts in 14 categories from the MTS handoff with ownership (Owned / Confirm / Planned), quantity, sizes and measure / conflict / unverified flags; ownership filter in every tab, on Home ("My parts only") and in search (`own:owned`). Presets for unmeasured parts keep the size fields empty and block Generate. 25 print candidates as projects (priority, linked parts) with the 4 assembly specs and their missing source files. New `fit-test` generator (heat-set insert, hole, bore and press-fit coupons); 25 more bearing sizes incl. 6801 / 6806. Gzip for large API responses; cached search index.
Fixed: size label said "larger than the bed" for a multi-part layout whose parts each fit; the previous part stayed in the 3D view when a needs-measurement preset opened.
Untested: every new part as a print; the insert hole values (common values, UNVERIFIED for your kit: print the fit test first); any size you have not measured. Not in this release: the PTZ, CGO3+ plate, SV07 plane and Tattu tray STL / source files (listed as missing on their projects; attach them with Import).

## v6 (0.6.0) - 2026-11-06

Changed: Settings tab (printers with step-by-step connection test and model, print estimates, 3D view, appearance, paper labels, backup). Print time / filament / cost estimates per printer profile (Sovol SV07 included, more by pull request: docs/PRINTER-PROFILES.md) in the designer, STL Files and projects. 3D view controls: view buttons, shaded / edges / wireframe / x-ray, layer cut, bed outline, axes, size label, orthographic, quality up to Ultra, PNG. Global search in the header. STL Files library and Import page (STL, project and design files); project export / import. Live preview, collapsible groups, "measure before printing" flags, dark / light theme, toasts. 6 new generators (Pi case, sensor bracket, lidar plate, repair cradle, extrusion bracket, motor clamp) and 38 presets (Pi 5 / 4 / 3, XIAO ESP32-C6, TF-Luna, TFmini, lidar, Typhoon H480 / H520, 2020 brackets, N20 / 37 mm motors). Desktop launcher opens its own app window (Edge / Chrome). AGENTS.md, ARCHITECTURE, API docs, screenshots in the README.
Fixed: project parts from saved designs showed their id instead of the name.
Untested: a real SV07 on the LAN (tested against a fake Moonraker), estimate accuracy against a slicer, the app window on Windows, all new parts as prints. Typhoon H parts use placeholder sizes until measured.

## v5 (0.5.0) - 2026-11-06

Changed: Home page (tabs, favorites, projects, recent designs, printer status). Advanced search across presets, saved designs, generators and projects with filters and a query syntax (`tubeOD:16`, `teeth>=30`, `tab:quads`, `-snap`, phrases). Grid and list views with 3D previews rendered once in the browser and cached on the server. Favorites (server-side, every device). Projects: parts with quantity, notes and printed status, one-ZIP build with a parts list. Printers tab for Klipper / Moonraker printers (Sovol SV07, Mainsail, Fluidd): status, temperatures, progress, layer, time left, files with thumbnails, history, webcam snapshots, LAN scan, G-code upload that never starts a print. View only: no control endpoints exist. URL routing so Back works and pages can be bookmarked.
Fixed: n/a.
Untested: the Printers tab against a real SV07 (tested against a mock Moonraker built from the official API docs); preview rendering speed on a Raspberry Pi.

## v4 (0.4.0) - 2026-11-05

Changed: clamp types snap-on clip, two-piece (fits mid-tube) and collar. New `component-mount` generator: tray, board pad, cradle, cup, cable clips or support post on a zip-tie saddle, bolt-on clamp kit (2 parts), screw plate or tape: ESC on an arm, receiver, VTX / FC pads, battery trays, GPS posts, lights, sensors, Pi boards. 51 new presets (285 total). Desktop packages with Node.js included (Windows, macOS Apple / Intel app, Linux, Raspberry Pi 64 / 32-bit) plus installers; per-user data folder so upgrades never touch your work. Generators and presets load automatically; your own go in `custom/` and are skipped (not fatal) if broken; helpers passed to `generate(p, k, lib)`. `/api/version`, version and problem badge in the UI. CI on Node 18 / 20 / 22 and a tag-driven release workflow. Docs: INSTALL, TESTING, EXTENDING.
Fixed: snap clip lead-in corner on the opening face (STL slivers). Custom `.js` generators failed on Node 18 outside the app folder; the launcher now marks the custom folder as ES modules and `.mjs` is accepted.
Untested: everything on real hardware: installers on Windows / macOS / Pi, the unsigned-app warnings, and all v3 / v4 parts as printed parts.

## v3 (0.3.0) - 2026-11-05

Changed: tabs for Shop, Planes, Quadcopters, Accessories, Robotics, My Designs. 31 new generators (38 total): tube clamps (5 types), tube joints (10 types), plugs / caps / feet, spacers, GPS mast, antenna, zip-tie, camera cage, action-cam, connector panel, FC adapter, TPU grommets, damper plates, multirotor frame, tube motor mount, prop guard, landing leg, control horn, servo mount, pin hinge, firewall mount, former, wheel, gear / rack, pulley, NEMA stepper mount, bearing block, shaft coupler, link bar, knob, enclosure. Wing: total wingspan input, ailerons / elevator / rudder cut as separate parts, servo pocket and wire channel. 152 new presets (234 total). Saved designs on the server (My Designs), params import/export, local STL viewer, ZIP download. Printer / slicer plan in docs/PRINTERS.md.
Fixed: tangent and edge-aligned surfaces that left slivers in the STL (tube joint hub, motor mount, knob chamfer). Old saves with `halfSpan` convert to `wingspan` automatically.
Untested: physical prints of the new parts. Clamp grip, joint fit, gear mesh, GT2 belt fit, bearing press fit and aileron throw need test prints. Breaking: `rc-wing` parameter `halfSpan` is now `wingspan` (old files still load).

## v2.1 (0.2.1) - 2026-11-05

Changed: Raspberry Pi installer/updater `deploy/install-pi.sh` (systemd, LAN access by default). Docs: `docs/RASPBERRY-PI.md`, `deploy/README.md`, `presets/README.md`, `src/generators/README.md`, main README index.
Fixed: n/a.
Untested: the installer on real Pi hardware. It was tested on Debian-based Linux with a systemctl stand-in (fresh install, update run, catalog data kept).

## v2 (0.2.0) - 2026-11-05

Changed: new generators `stack-bin`, `hook`, `tool-rack`, `holder-block`, `label-card`. Text engine for raised/recessed labels. 82 presets in `presets/`. Shop catalog (categories, item codes, auto label text, paper label sheet). Web UI tabs, preset browser, Add to shop. CLI `presets` and `preset` commands.
Fixed: STL edge check now also catches edges that break after float32 rounding (found and fixed slivers in chamfers, peg bends and countersinks). Empty text fields now stay empty instead of falling back to defaults.
Untested: physical prints of every new part. Stack fit (0.4 mm clearance), label slot fit, pegboard peg fit and hook strength need test prints.

## v1 (0.1.0) - 2026-11-05

Changed: first release. Core on manifold-3d, CLI, web UI with 3D preview, systemd unit. Generators: `parts-box` (compartments, press-fit lid) and `rc-wing` (NACA 4-digit, taper, sweep, washout, spars, sectioning, mirror).
Fixed: n/a. An early JSCAD-based build was dropped because its booleans left open edges (T-junctions) in the STL.
Untested: physical prints. Lid clearance, spar fit and trailing-edge thickness defaults need a test print to confirm.
