# Example parts list

> See also: [User guide: My Parts](../../docs/USER-GUIDE.md#my-parts) | [API: My Parts](../../docs/API.md#my-parts-v7) | [All docs](../../docs/README.md)

A small example of a My Parts list: 16 common hobby parts in 7 categories,
with ownership (Owned / Confirm / Planned), sizes where a published standard
exists, and MEASURE where you must measure your own part. Load it from
**My Parts > Load example parts**, or replace it with your own list.

Make your own list in the same format (`components.json`):

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

`print_candidates.json` (optional) adds project ideas linked to part ids.
Import your own file with **My Parts > Import components.json**.
