# printer-profiles: shipped printer profiles

Profiles set the bed size, speeds, acceleration and flow limit used for print time estimates and the bed outline in the 3D view.

> See also: [Printer profiles guide](../docs/PRINTER-PROFILES.md) (fields, calibration, import from your slicer) | [Printers](../docs/PRINTERS.md) | [All docs](../docs/README.md)

| File | Printer |
|---|---|
| `sovol-sv07.json` | Sovol SV07 (stock values; Klipper limits read from the printer replace them when connected) |
| `sovol-sv07-mts-v3.json` | The shop's SV07 with the `sv07-alex-v3` slicer profile values (80 / 50 / 25 / 200 mm/s, 2000 accel, 20 mm3/s). Chosen automatically for the `mkspi` host. |
| `generic-klipper-fast.json` | Any fast Klipper printer |
| `generic-standard.json` | Any other printer |

Your own profiles: put a JSON file in `custom/printer-profiles/` ([custom/README.md](../custom/README.md)), or import a PrusaSlicer `.ini` / OrcaSlicer `.json` in Settings > Print estimates (stored in your data folder, not here). The slicer `.ini` files themselves stay in your data folder, not in git.
