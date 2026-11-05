# Changelog

## v1 (0.1.0) - 2026-11-05

Changed: first release. Core on manifold-3d, CLI, web UI with 3D preview, systemd unit. Generators: `parts-box` (compartments, press-fit lid) and `rc-wing` (NACA 4-digit, taper, sweep, washout, spars, sectioning, mirror).
Fixed: n/a. An early JSCAD-based build was dropped because its booleans left open edges (T-junctions) in the STL.
Untested: physical prints. Lid clearance, spar fit and trailing-edge thickness defaults need a test print to confirm.
