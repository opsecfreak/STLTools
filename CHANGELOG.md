# Changelog

## 1.8.0-mts.1 - 2026-11-07 (MTS personal edition)

Changed: **pick then tune**: a "Make:" chip row per designer tab narrows the presets to one kind of part and opens it in Simple view. **Simple / Standard / Expert** views (Expert shows each setting's name, range and default). **Customizable Home** (sections, order, your own "Make something" list; Settings > Home page). **Browse > Families**: results nested by part, then main size, then the next setting. **Filament per project** and per part, estimates split by filament, filament line in the ZIP README.
Fixed: CI on Node 18 / 20 (live-update test in polling mode) and the Windows UI smoke wait for the settings page.
Untested: very long Families trees on a slow phone.

## 1.7.0-mts.1 - 2026-11-07 (MTS personal edition)

Changed: new generators **Modular Quad Frame** (`quad-modular`, assembly: plates, 4 arms with motor mounts, bolt / heat-set insert / dovetail joints with M2-M4 screws, M2 / M2.5 / M3 standoffs bought or printed, FC stack 20 / 25.5 / 30.5, cable grooves, zip-tie slots, wire and strap slots, SMA tab, prop and wheelbase checks), **Microcontroller Board Holder** (`mcu-holder`), **Camera Board Case** (`pi-camera-case`), **Antenna Tube Holder** (`antenna-tube-holder`). 26 presets (5 frames, 4 antenna holders, 12 board holders, 4 camera cases). Assemblies can show every copy of a part (`copies`).
Fixed: n/a.
Untested: real prints; dovetail clearance and snap-lip fit need a test print. Pi camera lens position, ESP32 DevKit, Blue / Black Pill and PCB thickness are left to measure (raspberrypi.com was not reachable from this session to confirm drawings).

## 1.6.0-mts.1 - 2026-11-07 (MTS personal edition)

Changed: **Layers** (designer, STL Files): a layer preview of the part from cross-sections (outer wall, inner walls, solid top / bottom skin, infill at 45 / -45 degrees) with the time of every layer, using the estimate box printer's speeds and flow cap; layer height, walls, top / bottom layers and infill editable in the window (`POST /api/layers`, src/core/layers.js). **G-code viewer**: printer files (**View**, `GET /api/printers/:id/gcode`, read-only), local files (Printers upload box, Import page); feature colors from ;TYPE: / ; FEATURE: comments, arcs, relative or absolute E, z-hops, travel, slicer estimate from the header. Both: 2D layer view (zoom, pan, layer below in gray), 3D stack, slider, arrow keys, Play, time-per-layer chart.
Fixed: n/a.
Untested: very large G-code files (tested to a few MB; 80 MB limit); Cura and Sovol slicer files beyond the comment formats listed.

## 1.5.0-mts.1 - 2026-11-07 (MTS personal edition)

Changed: Printers page **live updates** (Moonraker websocket, read-only, passed to the page as server-sent events; 1 s polling on Node < 22) with a Live dot and a read-only **Console** box; **Pre-print checklist** (SV07 template from the shop guidelines, generic for other printers) with an automatic **G-code header check** (heat-first order, START_PRINT, job and restore speed caps, temperatures, max flow) and a print log; **profile import** from a PrusaSlicer .ini or OrcaSlicer .json (Settings > Print estimates). Setting: Settings > Printers > Live updates.
Fixed: n/a.
Untested: websocket against the shop SV07 (fake Moonraker only); Orca process files from the Sovol slicer itself.

## 1.4.3-mts.1 - 2026-11-07 (MTS personal edition)

Changed: collections hold STL files only (your choice B). Adding a preset, saved design, generator or project to a collection saves frozen STL copies in STL Files > Collections and adds those; adding the same item again reuses its copy; existing collections are converted the first time they are read (`POST /api/collections/convert` runs it by hand). Presets that still need measured sizes are kept as they are until measured.
Fixed: n/a.
Untested: converting very large projects (every part is built once).

## 1.4.2-mts.1 - 2026-11-07 (MTS personal edition)

Changed: new generator **Weatherproof Box (gasket lid)** (`sealed-box`): box, lid with a gasket groove, printed TPU gasket; the lid rests on the rim so the groove depth sets the squeeze (25 % default, editable); screws through ears outside the seal (thread into plastic or heat-set inserts); optional cable gland hole (PG7 / PG9 / PG11 / M12 / M16 / M20) on any wall; warnings when the rim is too narrow or the gland too big. 5 presets (Shop > Weatherproof boxes), including Pi 5 and small sensor boxes.
Fixed: n/a.
Untested: a real seal test (print the gasket in TPU 95A, close with a paper towel inside, spray with water); gland hole sizes against your glands.

## 1.4.1-mts.1 - 2026-11-07 (MTS personal edition)

Changed: Printers > Printer details: **Bed mesh** heat map of each saved profile (values, range, points more than 0.2 mm off their neighbours boxed in red: re-probe before saving) and **Logs** viewer (klippy.log, moonraker.log, crowsnest.log: last 400 KB, find, errors highlighted, key lines hidden). Both read-only (`GET /api/printers/:id/mesh`, `/logs[?file=]`).
Fixed: n/a.
Untested: against the shop SV07 (fake Moonraker only).

## 1.4.0-mts.1 - 2026-11-07 (MTS personal edition)

Changed: **Split / arrange** next to Download in every designer tab (`POST /api/split`, src/core/split.js). Parts larger than the chosen printer's bed are cut into equal pieces along their longest side (piece length from the flat bed size so pieces lie down), with alignment holes on every cut (printed pins with their own STL, 1.75 mm filament pins, or glue only; pin size and hole clearance settable); then every piece and copy (quantities per part) is packed onto as few plates as possible, standing as designed when it fits, with a time and filament estimate per plate, plate STLs, piece STLs and an assembly README in one ZIP. Works on generated parts and on imported STLs.
Fixed: n/a.
Untested: pin fit on a real print (start with 0.2 mm clearance, use the fit-test coupon to tune); splitting imported STLs that are not closed solids (refused with a message).

## 1.3.2-mts.1 - 2026-11-07 (MTS personal edition)

Changed: Settings > Appearance > Show sizes in: mm, cm or inches. The 3D view size label, the estimate table and a "= 0.63 in" hint next to every mm setting follow it. You still type settings in mm; STL files stay mm.
Fixed: n/a.
Untested: typing settings directly in inches (not built: entry stays mm on purpose, so presets and the CLI stay unambiguous).

## 1.3.1-mts.1 - 2026-11-07 (MTS personal edition)

Changed: Save design on a changed preset or design saves as "<name> MOD <your text>" and keeps the original. Print estimate quality dropdown (0.28 Draft, 0.20 Standard, 0.12 Fine, Strong, MTS SV07 v3) next to the material. Settings > Filament prices: a price per kg for each material (blank until you enter it; falls back to the general price). Settings page: search box (fields and sections), compact layout.
Fixed: n/a.
Untested: n/a (covered by the UI smoke test and a settings search check).

## 1.3.0-mts.1 - 2026-11-07 (MTS personal edition)

Changed: new **Stress Lab** tab (docs/STRESS-LAB.md), also reached with "Stress test" next to Download. Stress test: click the 3D part to add anchors, forces, pressures and torques (editable list), whole-part g-loads, quick setups (hold the bottom, hook / bracket, servo horn from stall torque); voxel finite-element solve in a background thread; safety factor, von Mises, across-layer stress, displacement and wall / infill views; 5 worst spots labeled with the reason; failure load; bend, cut plane, probe, load animation 0-200 %; instant material comparison. Weak points and supports: thin walls, overhangs, support columns and volume, narrowest layer, islands, per print orientation. Wind tunnel: wing section cut from the part in any orientation, Hess-Smith panel method (Cp, streamlines, Cl, Cm), lifting-line 3D lift and induced drag, skin-friction profile drag, polar, 3D pressure colors, airflow dots, lift and drag arrows, apply lift to the stress test; bodies: frontal area x reference Cd. Environment: heat vs datasheet HDT, sunlight time-lapse from your UV rate, rain pooling, moisture, drop impact as a g-load, fatigue from your S-N data. Materials & physics: datasheet library with sources, your own materials (`/api/materials`, `<data>/materials.json`), editable physics settings.
Fixed: n/a.
Untested: results against real printed parts (no physical test yet); solve time on a Raspberry Pi browser; very large STLs (over 30k cells is slow); WebGL-less browsers get the tables only.

## 1.2.0-mts.1 - 2026-11-07 (MTS personal edition)

Changed: opt-in printer control, per printer, off by default: a warning must be accepted to turn it on; then pause, resume, cancel, print a file already on the printer, upload and print (one file, asks first), G-code console (extra warning for SAVE_CONFIG), emergency stop, firmware restart, Klipper restart, restart the crowsnest webcam service. Every action asks first; every action and every refusal is logged (`<data>/printer-control.log`, shown on the Printers page). State guards (no start while printing, no pause while idle); a new address turns control off. Slicing research (docs/SLICING-RESEARCH.md: Sovol's slicer is OrcaSlicer with Sovol profiles; Muse's PrusaSlicer chain and its known bugs; options). Materials data `materials/filaments.json` from eSUN, Polymaker and Prusament datasheets with sources (eSUN PLA+ Feb 2026: 70.4 MPa X-Y, 36.4 MPa Z).
Fixed: n/a.
Untested: control against the real SV07 (tested against the fake Moonraker and in the browser smoke test only); the crowsnest restart on the MKS Pi (Moonraker must allow it in its service list); the materials values in any simulation (the Stress Lab is not built yet).

## 1.1.0-mts.1 - 2026-11-06 (MTS personal edition)

Public 1.1.0 (below) plus the MTS shop data, and for the shop's SV07 (MKS Pi host `mkspi`): a printer profile from the proven slicer preset sv07-alex-v3 (`sovol-sv07-mts-v3`: 220 x 220 x 250, 80 mm/s print, 50 outer wall, 25 first layer, 200 travel, 2000 accel, 20 mm3/s max flow, 0.2 / 0.3 mm layers, 3 walls, 15 % gyroid, 4 top / 3 bottom, 5 mm brim) as the default estimate profile, and docs/ROADMAP-MTS.md (the plan for the next MTS versions).
Fixed: as 1.1.0.
Untested: estimate accuracy of the v3 profile against real SV07 print times (calibrate with the time factor after one print).

## 1.1.0 - 2026-11-06 (pi-deployment)

Changed: self-hosting: USB portable mode (`--portable`, `portable.txt`, "USB portable" start scripts for Windows, Linux and macOS), one-time sessions deleted on exit (`--temp`, "one-time session" .bat), auto-stop after N hours (`--hours`, Settings > Self-hosting), LAN on/off and port in Settings > Self-hosting, optional LAN access PIN (scrypt hash, cookie, 5 tries a minute; the host machine never needs it), Settings > Self-hosting status page (mode, addresses, board, data folder). Printers are optional: Settings > Printers > Printer features (auto / on / off) hides the Printers page, header chip and tile. Background read-only connection checks (every 5 min by default, "Check connections now"). Estimates from the actual printer: bed travel, max speed, acceleration, nozzle and filament read from Klipper (`toolhead` + `configfile`, read-only), merged into the profile ("SV07 (own limits)"), also for project ZIPs. Live webcam: the MJPEG stream Mainsail / Fluidd shows, proxied through STL Tools (GET only, LAN only, closed with the browser, max 3 per printer), falls back to snapshots; when Moonraker lists no camera, the SV07 profile's Mainsail default `/webcam/?action=stream` is tried. 3D view falls back to a parts list without WebGL. Raspberry Pi 4 / 4B / 5 installer: detects board, CPU and RAM, installs from a release package or USB folder (`SOURCE_DIR`, `USE_PACKAGE_NODE`), downloads checksum-verified Node.js when apt is too old, avahi for `.local`, `--uninstall` keeps data. Docs: docs hub (docs/README.md), RASPBERRY-PI.md rewritten as a full install and setup guide, SELF-HOSTING, USER-GUIDE, TROUBLESHOOTING, FAQ, SECURITY.md, issue and PR templates, "See also" links in every README. CI: Windows, macOS ARM64 and Linux ARM64 test runs, real installer runs on x64 and ARM64 (Node 18 and 22), UI smoke test in Chromium on Linux and Windows, release packages built and checked, the Windows package run on Windows and the ARM64 package run on ARM64.
Also: Printers page "Printer details (read-only)": health check of the live Klipper setup (motion limits, pressure advance, input shaper, bed mesh flatness, filament sensor pause_on_runout, MCU vs host firmware, pending SAVE_CONFIG, host system, print totals) and a printer.cfg / config file viewer with find (secrets hidden). Webcams are also read from Mainsail's own database (Mainsail 2.x stores them there); a listed camera that does not answer shows "Camera unavailable" with the reason instead of a blank image. Connection test: clear message for an empty address, scan results "Use and test", automatic retry on port 7125, printer name from Mainsail, `mkspi` host recognized as SV07. Estimates never grow the bed beyond the profile (Klipper travel is wider than the bed: SV07 225 vs 220).
Fixed: changing the generator in a designer tab (Shop and others) did not rebuild the 3D view until a setting was touched; stray "null" text on the Browse page (filters) and the Printers page (idle printer); launcher treated an empty `STLTOOLS_DATA` as a folder name; Pi installer replaced `/opt/stltools` inside custom data paths; installer printed a device-tree error on non-Pi machines.
Untested: on real hardware: a Raspberry Pi 4 / 5 (install time, generation speed), the SV07 webcam default paths and its Klipper limits, the PIN page on phones, the kiosk autostart on Raspberry Pi desktop, the 32-bit (armv7l) package (checked by binary header only), macOS portable mode.

## 1.0.1-mts.1 - 2026-11-06 (MTS personal edition)

Public STL Tools 1.0.1 (npm package, `stltools app`) plus the MTS shop data: My Parts starter list `seed/mts-v1` (98 parts, 14 categories, ownership, sizes and measure / conflict / unverified flags; 25 print ideas; the PTZ, CGO3+ top plate, SV07 plane and Tattu / ZD550 tray specs attached to their projects) and the 104 `mts-*` presets linked to those parts. The public `hw-*` copies and the example list are left out so nothing shows twice. Previous personal build: 1.0.0-mts.1.
Fixed: n/a.
Untested: same as 1.0.1.

## 1.0.0-mts.1 - 2026-11-06 (MTS personal edition)

First personal build on top of public 1.0.0 (same data as above).

## 1.0.1 - 2026-11-06

Changed: npm package: the release now includes `stltools-<version>.tgz` (346 KB; install with `npm install -g <release link>`, then `stltools app`); `stltools app` starts the web app from the CLI; `stltools-app` command; the Release workflow publishes to npmjs.com when the repository has an `NPM_TOKEN` secret (plus a manual "Publish to npm" workflow). Personal editions: EDITION.json marks a build like the MTS personal edition (branch `mts-personal`), shown next to the version in the app; versions with a suffix (`1.0.0-mts.1`) publish as pre-releases so the public Latest release stays; tests skip public-only checks on a personal edition. README and AGENTS.md describe the branches.
Fixed: n/a.
Untested: the npm package on Windows and macOS (tested: install from the .tgz on Linux, CLI generation, `stltools app`).

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
