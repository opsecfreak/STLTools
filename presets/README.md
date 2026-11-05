# Presets

Ready-made designs. Each preset is a generator plus the values that differ from that generator's defaults. The web UI, the CLI (`stltools presets`, `stltools preset <id>`) and the shop catalog all read these files at startup.

## Files

| File | Group |
|------|-------|
| `01-stacking-bins.json` | Stacking Bins (75 x 100, 100 x 150, 150 x 150, 200 x 150 families) |
| `02-drone-parts.json` | Drone Parts (props, motors, FC/ESC, LiPo, connectors, gimbal, SD cards, hooks) |
| `03-fasteners.json` | Fasteners and Small Parts (boxes, trays, bit holders) |
| `04-hooks.json` | Hooks (pegboard, screw, tape) |
| `05-tool-racks.json` | Tool Racks (drivers, pliers, tweezers, wrenches, markers) |
| `06-holders.json` | Holders (batteries, coin cells, USB, SD, markers) |
| `07-boxes.json` | Boxes with lids |
| `08-labels.json` | Label cards sized for each bin width |
| `09-rc-aircraft.json` | RC wings |

Files load in name order. The number prefix sets the group order in the UI.

## Format

```json
{
  "group": "Drone Parts",
  "presets": [
    {
      "id": "drone-props-5in",
      "name": "Props 5 in",
      "generator": "stack-bin",
      "description": "Inside about 146 x 146 mm. Fits 5 in (127 mm) props laid flat.",
      "tags": ["props"],
      "params": { "width": 150, "depth": 150, "height": 60, "labelText": "PROPS 5IN" }
    }
  ]
}
```

| Field | Rule |
|-------|------|
| `id` | Unique across all files. Lowercase, dashes. Shop items point to it, so do not rename an id that is in use. |
| `name` | Shown in the preset list. |
| `generator` | One of: `stack-bin`, `parts-box`, `holder-block`, `hook`, `tool-rack`, `label-card`, `rc-wing`. |
| `description` | One or two sentences. Say what fits. Mark sizes that need checking. |
| `tags` | Search words. |
| `params` | Only values that differ from the generator defaults. Run `node bin/stltools.js info <generator>` for names and limits. |

## Add a preset

1. Find the closest preset in the web UI and change values until it looks right.
2. Press **Save params** to download the full parameter set.
3. Copy only the values you changed into a new entry in the right file.
4. Run the tests. They generate every preset and check the mesh.

```bash
npm test
```

5. Restart the server (or run the Pi installer) to load the new preset.

Note: a preset with a bad value stops the server from starting and names the preset in the error. This is on purpose, so a broken preset never reaches the shop list.

## Stacking families

Bins stack only on bins with the same width, depth and wall. Keep new bin presets in the existing footprints (75 x 100, 100 x 100, 100 x 150, 150 x 150, 200 x 150, 200 x 100, 200 x 200) unless you want a new family.
