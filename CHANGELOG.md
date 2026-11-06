# Changelog

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
