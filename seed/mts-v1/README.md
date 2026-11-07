# MTS starter data (v1)

Alex's parts list and print ideas from the MTS print handoff package v1.
STL Tools loads it from **My Parts > Load MTS starter data** (or
`POST /api/parts/seed { "set": "mts-v1" }`). Loading is safe to repeat: parts
you already edited keep your values, and projects are only created once.

| File | Loaded as |
|---|---|
| `components.json` | My Parts inventory: 98 parts in 14 categories, ownership (Owned / Confirm / Planned), dimensions and their source |
| `print_candidates.json` | 25 project ideas (status "idea"), linked to part ids, with priority |
| `assemblies/*.md` | 4 projects (PTZ pan-tilt, CGO3+ top plate, SV07 plane + CF Twin, Tattu sleeve + ZD550 tray) with the spec as notes and the source files they need listed as missing |

Dimensions are copied as given. `MEASURE`, `CONFLICT` and `UNVERIFIED`
values stay flagged in the app. Nothing here is invented: presets for parts
marked MEASURE leave the size fields empty until you enter a measurement.

To update the list: edit the JSON files here (or your data in the app) and load again.

## File format (for your own list)

Make your own list in the same format (`components.json`) and load it with **My Parts > Import components.json**:

```json
{
  "categories": ["Sensors"],
  "items": [
    { "id": "SEN01", "category": "Sensors", "name": "TF-Luna lidar", "qty": "1",
      "ownership": "Owned", "dims_mm": "MEASURE", "dims_source": "", "print_need": "Downward mount" }
  ]
}
```

| Field | Rule |
|---|---|
| `id` | 2-4 capital letters + 2-3 digits, unique (SEN01) |
| `ownership` | `Owned`, `Confirm` (used but not sure you have it) or `Planned` |
| `dims_mm` | Sizes as text. Write `MEASURE` when unknown, `CONFLICT` when sources disagree, `UNVERIFIED` in the source when not checked |
| `print_need` | What to print for it |
| `presets` (optional) | Preset ids that fit this part. My Parts lists them, and the ownership filter ("My parts only") follows them |

`print_candidates.json` (optional) adds project ideas linked to part ids (`id`, `name`, `priority`, `parts`, `assembly` for a spec in `assemblies/<file>.md`).

> See also: [User guide: My Parts](../../docs/USER-GUIDE.md#my-parts) | [All docs](../../docs/README.md)
