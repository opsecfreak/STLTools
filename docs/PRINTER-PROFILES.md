# Printer profiles and print estimates

> See also: [Printers: estimates from your actual printer](PRINTERS.md#estimates-from-your-actual-printer) | [User guide: print time](USER-GUIDE.md#print-time-and-filament) | [All docs](README.md)

A printer profile tells STL Tools the build volume and typical speeds of a
printer. It is used for:

- the print time and filament estimate under the 3D view, in projects and in project ZIP READMEs,
- the build plate outline in the 3D view,
- the "does not fit the bed" warning.

Shipped profiles are in `printer-profiles/`:

| File | Printer |
|---|---|
| `sovol-sv07.json` | Sovol SV07 (Klipper, 220 x 220 x 250 mm, 0.4 mm nozzle) |
| `generic-klipper-fast.json` | Any fast Klipper printer (starting point) |
| `generic-standard.json` | Slow, stock-firmware bed slinger (starting point) |

The SV07 bed size, nozzle and filament size are Sovol's published specs. Its
speeds, flow and efficiency are starting values (`"verified": false`), so the
UI says "speeds not verified". Calibrate (below) and, if you want, send your
tuned values back as a pull request.

## Profile fields

```jsonc
{
  "id": "maker-model",                 // lowercase letters, digits, dashes (2-41 chars)
  "name": "Maker Model",
  "maker": "Maker",                    // "Generic" sorts last in lists
  "firmware": "klipper",               // klipper | marlin | other (information only)
  "bed": { "x": 220, "y": 220, "z": 250 },          // mm, required
  "nozzle": 0.4,                       // mm
  "filamentDiameter": 1.75,            // mm
  "lineWidth": 0.45,                   // optional, default nozzle x 1.125
  "speeds": {                          // mm/s, what your slicer profile uses
    "outerWall": 120, "innerWall": 200, "infill": 250,
    "topBottom": 150, "firstLayer": 50, "travel": 300
  },
  "acceleration": 5000,                // information only
  "maxVolumetricFlow": 18,             // mm3/s the hotend can melt; caps every speed
  "motionEfficiency": 0.62,            // 0.2-1: share of time at full speed (corners, short moves)
  "layerOverheadSeconds": 1.8,         // travel, retracts, z moves per layer
  "heatUpSeconds": 180,                // once per plate
  "moonraker": { "apiPort": 7125, "webPort": 80, "hostnameHints": ["sv07"] },
  "verified": false,                   // true only when speeds were checked against real prints
  "notes": "Where the numbers came from.",
  "sources": ["Maker spec page: build volume ..."]
}
```

Rules: never guess bed sizes. Use the maker's published spec and list it in
`sources`. Speeds may be starting values if `verified` is `false`.

## Add a profile for yourself (no GitHub)

1. Copy `printer-profiles/generic-klipper-fast.json`.
2. Change `id`, `name`, `bed`, `speeds` (copy speeds from your slicer profile).
3. Save it in your custom folder:
   - desktop app: `<your data folder>/../custom/printer-profiles/` (the folder
     next to `data`, shown in Settings > Data and backup),
   - from source: `custom/printer-profiles/`.
4. Restart STL Tools. The profile appears in Settings > Print estimates and in
   each printer's Model list. A broken file is skipped and listed in Settings > About.

## Import a profile from your slicer (1.5)

Settings > Print estimates > **Import a profile from your slicer**:

1. Choose the file: a PrusaSlicer / SuperSlicer `.ini` (printer or config bundle export) or an OrcaSlicer machine or process `.json` (the Sovol slicer is OrcaSlicer).
2. Pick the profile to start from (for the SV07: Sovol SV07), and type a name.
3. Press **Import**. The result lists what was read and what was kept from the base profile.

Read: bed size (`bed_shape` / `printable_area`), max height, perimeter / infill / travel / first-layer speeds, default acceleration, max volumetric speed. Speeds given as % are skipped (kept from the base), never guessed. The profile is stored in `<data folder>/printer-profiles.json` and shows in every profile list; delete it in the same box.

## Add a profile for everyone (GitHub pull request)

1. Open the repository on GitHub and press **Fork** (or create a branch if you
   have write access).
2. In your fork, open `printer-profiles/` and press **Add file > Create new file**.
3. Name it `<maker>-<model>.json` and paste the profile.
4. Fill `sources` with where the bed size came from. Leave `verified` false
   unless you compared estimates with real prints.
5. Commit to a new branch and press **Open pull request**.
6. CI runs the tests on Node 18, 20 and 22. A bad profile fails
   `printer profiles` tests with a message that names the field.

From a terminal instead:

```bash
git checkout -b profile-maker-model
```

```bash
cp printer-profiles/generic-klipper-fast.json printer-profiles/maker-model.json
```

```bash
npm test
```

```bash
git add printer-profiles/maker-model.json && git commit -m "Add Maker Model printer profile"
```

```bash
git push -u origin profile-maker-model
```

## Calibrate the estimate

The estimate is a model of a slicer, not a slicer. Expect about +/- 25 %
before calibration.

1. Generate a part (for example `bin-xs-75x100`). Note the STL Tools time.
2. Slice the same STL with the same layer height, walls and infill in your
   slicer (OrcaSlicer SV07 profile). Note the slicer time.
3. Settings > Print estimates > Time calibration factor = slicer time / STL Tools time.
4. Check a second part of a different shape.

For a shared profile, change the speeds and `motionEfficiency` instead of the
factor, so the profile is right for everyone.
