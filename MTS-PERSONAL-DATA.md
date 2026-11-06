# Branch: mts-personal-data

This branch keeps the MobileTechSpecialists (MTS) shop's own parts data as it
was in STL Tools v0.8.0, before the public 1.0.0 release removed it from the
shipped app:

- `seed/mts-v1/`: parts list (98 parts, ownership, sizes), print ideas,
  assembly specs.
- `presets/22-mts-parts.json` and the part links (`component`, `ownership`)
  on presets in `presets/20-my-modules.json`, `presets/14-mounts-hardware.json`
  and `presets/23-assemblies.json`.

The public release (branch `main`, 1.0.0 and later) ships a generic example
parts list instead. To use this data with 1.0.0 or later: open My Parts >
Import components.json and pick `seed/mts-v1/components.json` from this branch.

This branch is a snapshot. It is not merged back into `main`.
