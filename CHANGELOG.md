# Changelog

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
