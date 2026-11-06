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
