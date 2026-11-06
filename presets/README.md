# Presets

Ready-made designs. Each preset is a generator plus the values that differ from that generator's defaults. The web UI, the CLI (`stltools presets`, `stltools preset <id>`) and the shop catalog all read these files at startup.

## Files

| File | Tab | Group |
|------|-----|-------|
| `01-stacking-bins.json` | Shop | Stacking Bins |
| `02-drone-parts.json` | Shop | Drone Parts (bins, holders, hooks for parts storage) |
| `03-fasteners.json` | Shop | Fasteners and Small Parts |
| `04-hooks.json` | Shop | Hooks |
| `05-tool-racks.json` | Shop | Tool Racks |
| `06-holders.json` | Shop | Holders |
| `07-boxes.json` | Shop | Boxes |
| `08-labels.json` | Shop | Labels |
| `09-rc-aircraft.json` | Planes | Wings and Tails |
| `10-planes-parts.json` | Planes | Wings, tails, horns, servo mounts, hinges, firewalls, formers, wheels |
| `11-quads.json` | Quadcopters | Frames, motor mounts, prop guards, landing legs |
| `12-tube-clamps.json` | Accessories | Carbon tube clamps, 8 to 25 mm |
| `13-tube-joints.json` | Accessories | Tube joints, plugs, caps, feet |
| `14-mounts-hardware.json` | Accessories | GPS masts, antenna, camera, FC adapters, dampening, spacers |
| `15-robotics.json` | Robotics | Gears, pulleys, stepper and bearing mounts, couplers, links, knobs, enclosures |
| `16-clamp-types.json` | Accessories | Snap-on clips, collars, two-piece clamps |
| `17-quad-arm-mounts.json` | Quadcopters | ESC, receiver, VTX, FC, GPS, battery, light and wire mounts on arms |
| `18-component-mounts.json` | Accessories | General component trays, cradles, cups, cable clips, support posts |
| `19-robot-mounts.json` | Robotics | Pi / camera / board pads, sensor cups, cell cradles, cable guides |
| `20-my-modules.json` | Robotics, Quadcopters | Pi 5 / 4 / 3 cases, XIAO clips, TF-Luna / TFmini / lidar, Typhoon H480 / H520 |
| `21-robot-hardware.json` | Robotics | 2020 / 3030 / 4040 brackets, motor clamps, repair cradles |
| `22-mts-parts.json` | By part category | One or more presets per part in My Parts (seed/mts-v1), with `component`, `ownership`, `category`, `measure` |
| `50-series-*.json` | All tabs | Size series (about 3,000): clamps per tube size, spacers per bolt and length, gears, pulleys, bins... **Generated** by `scripts/build-series.mjs`: edit the script, not the files |

Your own presets go in `custom/presets/` (see [custom/README.md](../custom/README.md)).

Files load in name order. The number prefix sets the group order in the UI.

## Format

```json
{
  "group": "Drone Parts",
  "section": "shop",
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
| `section` (file level, or per preset) | Tab: `shop`, `planes`, `quads`, `accessories`, `robotics`. |
| `generator` | Any generator id. Run `node bin/stltools.js list`. |
| `description` | One or two sentences. Say what fits. Mark sizes that need checking. |
| `tags` | Search words. |
| `params` | Only values that differ from the generator defaults. Run `node bin/stltools.js info <generator>` for names and limits. |
| `verify` (optional) | Parameter names whose values come from a datasheet or an assumption. The UI highlights them: "check before printing". |
| `measure` (optional) | Number parameters nobody has measured. Leave them **out** of `params`. The UI shows the fields empty and blocks Generate until they are typed; the CLI needs them as flags. Never put a guessed size here instead. |
| `component` (optional) | The My Parts id this preset is for (e.g. `SEN02`). The ownership filter uses the part's current ownership. |
| `ownership` (optional) | `Owned`, `Confirm` or `Planned`: fallback when My Parts is not loaded. |
| `category` (optional) | Part category (one of the 14 in seed/mts-v1). |
| `series` (generated) | Which size series the preset came from. |

## Size series

`scripts/build-series.mjs` builds `presets/50-series-*.json`. Each series is a
generator plus lists of sizes. Every candidate is generated and kept only if
it is watertight, has no warnings (known advisory notes excepted), fits the
SV07 bed, and is not the same as a hand-written preset.

```bash
node scripts/build-series.mjs
```

```bash
npm test
```

`STLTOOLS_FULL_PRESET_TEST=1 npm test` generates every series preset again (a few minutes); the normal run samples three per series.

## Add a preset

1. Find the closest preset in the web UI and change values until it looks right.
2. Press **Export** to download the full parameter set.
3. Copy only the values you changed into a new entry in the right file.
4. Run the tests. They generate every preset and check the mesh.

```bash
npm test
```

5. Restart the server (or run the Pi installer) to load the new preset.

Note: a preset with a bad value stops the server from starting and names the preset in the error. This is on purpose, so a broken preset never reaches the shop list.

## Stacking families

Bins stack only on bins with the same width, depth and wall. Keep new bin presets in the existing footprints (75 x 100, 100 x 100, 100 x 150, 150 x 150, 200 x 150, 200 x 100, 200 x 200) unless you want a new family.
