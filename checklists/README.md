# checklists: pre-print checklist templates

Used by **Printers > Pre-print checklist**. One JSON file per template. The printer's model picks the template (`printerModels`), else `generic`.

> See also: [Printers guide](../docs/PRINTERS.md#pre-print-checklist-and-g-code-header-check-15) | [API](../docs/API.md) | [All docs](../docs/README.md)

| File | For |
|---|---|
| `sv07-mts.json` | The shop's Sovol SV07 (from SV07-GUIDELINES section 8): 8 steps and the v3 profile header rules |
| `generic.json` | Any other printer: 5 general steps, heat-before-start check only |

## Format

```json
{
  "id": "my-printer",
  "name": "My printer checklist",
  "printerModels": ["sovol-sv07"],
  "source": "where the steps come from",
  "items": ["Bed clean and dry", "Right filament loaded"],
  "header": {
    "heatFirst": true,
    "startMacro": "START_PRINT",
    "jobCaps": { "velocity": 200, "accel": 2000, "accelToDecel": 1000, "scv": 3 },
    "restoreCaps": { "velocity": 225, "accel": 4500, "accelToDecel": 2000, "scv": 3 },
    "firstNozzle": 220, "nozzle": 215, "firstBed": 65, "bed": 63,
    "maxVolumetric": 20
  }
}
```

Every `header` key is optional; a missing key is not checked. The header check reads the first 128 KB and the last 96 KB of the G-code file from the printer (read-only HTTP Range requests) and checks:

| Rule | Check |
|---|---|
| `heatFirst` | Bed and nozzle temperature commands come before the start macro |
| `startMacro` | The start macro name is called |
| `jobCaps` | `SET_VELOCITY_LIMIT` at the start matches these values |
| `restoreCaps` | `SET_VELOCITY_LIMIT` at the end restores these values |
| `firstNozzle`, `firstBed`, `nozzle`, `bed` | Temperatures in the start block and the slicer config at the end |
| `maxVolumetric` | Max volumetric speed in the slicer config block is not higher |

Saved checklists go to `<data>/print-log.json`. Values here come from your own guidelines and profile; do not copy another printer's numbers.
