# User guide

From a first part in one minute to your own generators. Each section links to the detailed doc.

> See also: [Install](INSTALL.md) | [Self-hosting](SELF-HOSTING.md) | [FAQ](FAQ.md) | [Troubleshooting](TROUBLESHOOTING.md) | [All docs](README.md)

**Contents:** [The screen](#the-screen) | [Make a part](#make-a-part) | [Simple or all settings](#simple-or-all-settings) | [Find things](#find-things) | [Check the size before you print](#check-the-size-before-you-print) | [Print time and filament](#print-time-and-filament) | [Assemblies](#assemblies) | [Projects](#projects) | [My Parts](#my-parts) | [Collections and favorites](#collections-and-favorites) | [Shop catalog and labels](#shop-catalog-and-labels) | [STL files](#stl-files) | [Printers](#printers) | [Grow the catalog](#grow-the-catalog) | [Keyboard](#keyboard)

## The screen

| Area | What it is |
|---|---|
| Header | Global search (`/`), default printer status chip (when you have a printer), Settings |
| Tabs | **Home**, **Browse**; designer tabs **Shop**, **Planes**, **Quadcopters**, **Accessories**, **Robotics**; **Projects**, **My Parts**, **My Designs**, **STL Files**, **Import**, **Printers** |
| Designer tab | left: presets and the parameter form; right: 3D view, view tools, print estimate, downloads |

## Make a part

1. Home > **Make something** > pick a part (for example *Tube clamp*), or open a designer tab and click a preset.
2. Change the sizes. The 3D view rebuilds as you type (Settings > Appearance > Live preview).
3. Press **Download STL** (one part) or **Download ZIP** (several parts).
4. Optional: **Save design** keeps your values under a name (My Designs), **Add to project** puts it in a parts list.

Every STL is checked watertight and comes in print orientation. Units are millimeters.

## Simple or all settings

- **Simple** shows the few sizes that matter for that part (tube size, length, screw).
- **All settings** shows every wall, clearance, fillet and screw option, in groups. Settings > Appearance > Collapse parameter groups opens one group at a time.
- Point at a setting for its range, default and name (the name works in the CLI and in search: `tubeOD:16`). Settings > Tooltips and help sets delay, size and where help shows.

## Find things

- **Global search** (`/` anywhere): presets, generators, saved designs, projects, STL files, My Parts, settings pages. Query syntax: `tubeOD:16`, `teeth>=30`, `tag:esc`, `own:owned`, `gen:tube-clamp`, `series:gears`, `"exact phrase"`, `-exclude` (full list: the search help on Home).
- **Browse**: every preset with filters: type, tab, category, generator, tags, size series, "needs measurement", your collections. Grid or list view.
- **Preset list** in each designer tab: search box and group filter.

## Check the size before you print

- **Highlighted fields** come from a datasheet: check them against your part with calipers before a long print.
- **Needs measurement**: a preset for a part nobody measured leaves those sizes empty, and Generate waits until you type them. STL Tools never guesses a size.
- **Fit test** generator: print a small coupon to tune clearances for inserts, holes and pegs on your printer first.
- 3D view: size labels, cut slider (look inside at any height), top / front / side / iso views, measure against the printer bed outline.

## Print time and filament

The estimate box under the 3D view shows time, grams, meters and (with a price set) cost, per part and in total, plus a bed-fit check.

- **On**: pick a saved printer or a profile. A saved Klipper printer adds "(own limits)": its bed size, max speed and acceleration read from the printer ([how](PRINTERS.md#estimates-from-your-actual-printer)).
- Layer height, infill and material change the estimate at once and are remembered.
- Calibrate once: Settings > Print estimates > Time calibration factor = slicer time / STL Tools time. Expect about +/- 25 % before calibration. Details: [PRINTER-PROFILES.md](PRINTER-PROFILES.md#calibrate-the-estimate).

## Assemblies

Some generators make several parts that belong together (servo pan-tilt gimbal, brushless 2-axis gimbal, drawer unit). The 3D view toggles between **Assembled** (each part in its place, one color each) and **Print plate** (laid out to print). The estimate table lists each part with its quantity; click a part name to show only that part.

## Projects

A project is a parts list for a build: presets, saved designs, custom parts and imported STLs, each with a quantity, note and "printed" checkbox.

1. Projects > New project, or **Add to project** from any part.
2. **Show parts, print times and 3D assembly**: every STL with its estimate and a 3D view where you place parts (position and rotation per item) to see the build together.
3. **Download ZIP**: every part plus a README with the parts list and estimates. "Only unprinted" skips what you already printed.
4. **Export** a project file (with its designs and STLs) to move it to another computer; **Import** it there.

Projects also carry a priority, status (idea, active, done) and linked parts from My Parts.

## My Parts

Your own parts list: what you own, need to confirm, or plan to buy, with sizes and where the size came from.

- **Load the example list**, or **Import components.json** (format: [seed/example/README.md](../seed/example/README.md)).
- Sizes marked `MEASURE` or with a conflict are flagged; presets for those parts keep the sizes empty until you type them here.
- Each part lists the presets that fit it. Home > "My parts only" (or `own:owned` in search) filters presets to what you own.

## Collections and favorites

- Star anything to pin it on Home (favorites).
- **Collections** (Browse) group presets, designs, generators, STLs and projects under your own name and color, for example "Bench tools" or "ZD550 build". Toggle an item in or out from its card.

## Shop catalog and labels

Shop tab > **Shop catalog**: items with a code (`SCR-001`), location and category color, each linked to a preset. **Generate** makes the bin or holder with its label embossed or engraved; **Preview paper labels** prints matching paper labels (Settings > Paper labels).

## STL files

Import STL files you already have (Import tab or drag and drop): 3D view, size, estimate, tags, folders, notes, add to projects. Binary and ASCII STL up to 100 MB.

## Printers

Optional. Add a Klipper / Moonraker printer (Sovol SV07, any Mainsail or Fluidd printer) in Settings > Printers to see status, temperatures, progress, files, print history and the live webcam, and to upload G-code (never starts a print). Off: Settings > Printers > Printer features. Guide: [PRINTERS.md](PRINTERS.md).

## Grow the catalog

From quick to deep:

| You want | Do this | Doc |
|---|---|---|
| Keep your own values | Save design (My Designs), or a collection | above |
| Many sizes of one part | a preset file with your sizes in `custom/presets/` | [presets/README.md](../presets/README.md) |
| Your parts list | `components.json` import in My Parts | [seed/example/README.md](../seed/example/README.md) |
| Your printer | a printer profile JSON in `custom/printer-profiles/` | [PRINTER-PROFILES.md](PRINTER-PROFILES.md) |
| A new kind of part | a generator in `custom/generators/` (a small JavaScript file with parameters and a build function) | [custom/README.md](../custom/README.md), [src/generators/README.md](../src/generators/README.md) |
| Share it with everyone | a pull request on GitHub | [CONTRIBUTING.md](../CONTRIBUTING.md), [EXTENDING.md](EXTENDING.md) |
| Script it | the CLI (`stltools gen tube-clamp --tubeOD 16 -o out`) or the HTTP API | [README.md](../README.md#cli), [API.md](API.md) |

The custom folder is in your data folder (desktop), `stltools-data/custom` (USB), or `/opt/stltools/custom` (Pi). Restart STL Tools after adding files; problems with custom files show in Settings > About.

## Keyboard

| Key | Does |
|---|---|
| `/` | search everything |
| Ctrl+Enter | generate now |
| Escape | close search or dialogs |
