# STL Tools

Parametric STL generator for a drone / RC / robotics shop. Pick one of 3,410 ready-made designs (Raspberry Pi 5 / 4 cases, TF-Luna and lidar brackets, XIAO ESP32 clips, Typhoon H480 / H520 bench parts, tube clamps, bins, gears...), change any size, see the print time on your Sovol SV07, get a watertight STL.

Runs on a Windows or Linux desktop (main target), macOS or a Raspberry Pi. Open it in a browser, or as its own app window on the desktop.

![Home: search everything, favorites with 3D previews, printer status](docs/screenshots/home.png)

| | |
|---|---|
| ![Designer: Pi 5 case, live 3D view, SV07 print estimate](docs/screenshots/designer-pi5-case.png) | ![TF-Luna bracket with "measure before printing" fields and the 3D view settings](docs/screenshots/designer-tfluna-verify.png) |
| **Designer**: every size is a field, the part rebuilds as you type, the estimate shows time and filament for the SV07. | **Measure flags**: datasheet sizes are highlighted until you check them. The 3D view has its own settings panel. |
| ![Global search from any page](docs/screenshots/search.png) | ![Project with parts, quantities, estimate and export](docs/screenshots/project.png) |
| **Global search** in the header (press `/`): parts, presets, STLs, projects, settings. | **Projects**: parts lists, one-ZIP download, print time for the whole build, export to another computer. |
| ![Settings: connect and test the SV07](docs/screenshots/settings-printers.png) | ![Printers page: status, temperatures, files, webcam (view only)](docs/screenshots/printers.png) |
| **Settings > Printers**: add the SV07, test the connection step by step. | **Printers**: status, files, history, webcam, G-code upload. View only. |
| ![Import STL and project files](docs/screenshots/import.png) | ![Dark mode, Typhoon repair cradle](docs/screenshots/dark-mode.png) |
| **Import**: STL files, project files, design files. | **Dark mode** and the 3D view settings. |
| ![My Parts: ownership, sizes to measure, matching presets](docs/screenshots/my-parts.png) | ![A part with no measured size: fields stay empty until measured](docs/screenshots/needs-measurement.png) |
| **My Parts**: your parts list with ownership, sizes and the presets for each part. | **Needs measurement**: no invented sizes; type yours to generate. |
| ![Servo pan-tilt gimbal assembly with per-part print estimates](docs/screenshots/assembly-gimbal.png) | ![Project assembly view with item positions and per-part estimates](docs/screenshots/project-assembly.png) |
| **Assemblies**: parts shown put together, with time and grams per part. | **Project assembly**: place any parts together; per-part times and totals. |

- **Web UI**: Home with search, favorites and grid / list views; tabs for Shop, Planes, Quadcopters, Accessories, Robotics, Projects, My Designs, STL Files, Import, Printers and Settings. Live 3D preview with view buttons, display modes (shaded, edges, wireframe, x-ray), layer cut, printer bed outline and screenshots.
- **Assemblies**: multi-part designs shown put together or as a print plate (servo pan-tilt and brushless 2-axis gimbals), and project assemblies where you place any parts together in 3D.
- **Simple or detailed**: Simple mode shows only the main sizes ("Make something" on Home); "All settings" shows every wall, clearance and screw.
- **Per-part estimates**: time, grams and metres of filament for every part, with totals for a design or a whole project.
- **My Parts**: your parts (Owned / Confirm / Planned) with sizes and measure flags; filter every preset list to the parts you own. Load the example list ([seed/example](seed/example/README.md)) or import your own `components.json`.
- **Size series**: about 3,000 checked sizes of clamps, spacers, gears, pulleys, bearings, bins and more ([presets/README.md](presets/README.md)).
- **Print estimates**: time, filament (g and m) and optional cost for the selected printer profile; bed-fit warning. Sovol SV07 profile included; add more with [docs/PRINTER-PROFILES.md](docs/PRINTER-PROFILES.md).
- **Projects** group the parts for a build (quantity, notes, printed checkbox), download as one ZIP and export / import between computers.
- **STL Files**: import STL files you already have; view, estimate, tag, add to projects.
- **Printers**: view your Klipper / Mainsail printers (Sovol SV07 and others) on the LAN. View only: it cannot start, stop or change a print. See [docs/PRINTERS.md](docs/PRINTERS.md).
- **Settings** stored on the server, so every device sees the same ones.
- **CLI** for scripting and batch jobs. **Library** for other Node projects.

Units are millimeters, because slicers read STL as mm.

## Download and run

No install of Node.js or anything else needed: each release package includes it.

1. GitHub > **Releases** > newest release > download the file for your computer (Windows, Mac Apple / Intel, Linux, Raspberry Pi 64 / 32-bit).
2. Unpack it and read `README-FIRST.txt`.
3. Start it: **Start STL Tools.bat** (Windows), **STL Tools.app** (macOS), `./start.sh` (Linux / Pi).

Step-by-step instructions for every system, including a Raspberry Pi shop server: [docs/INSTALL.md](docs/INSTALL.md). What to test first and how to send feedback: [docs/TESTING.md](docs/TESTING.md).

## Documentation

| Doc | Covers |
|-----|--------|
| [docs/INSTALL.md](docs/INSTALL.md) | Download and install on Windows, macOS, Linux, Raspberry Pi; upgrade; uninstall |
| [docs/TESTING.md](docs/TESTING.md) | First test checklist, test prints, feedback template |
| [docs/EXTENDING.md](docs/EXTENDING.md) | Adding generators and presets without breaking anything; release steps |
| [custom/README.md](custom/README.md) | Your own generators and presets |
| [docs/RASPBERRY-PI.md](docs/RASPBERRY-PI.md) | Pi setup, updates, rollback, backups, Tailscale, troubleshooting |
| [deploy/README.md](deploy/README.md) | Where to run it, installer and service files, settings |
| [presets/README.md](presets/README.md) | Preset file format, adding your own designs |
| [src/generators/README.md](src/generators/README.md) | Writing a new generator, kernel functions, printability rules |
| [docs/PRINTERS.md](docs/PRINTERS.md) | Printers: add and test your SV07, what it can and cannot do (view only), upload, troubleshooting |
| [docs/PRINTER-PROFILES.md](docs/PRINTER-PROFILES.md) | Print time estimates, calibration, adding printer profiles (also by GitHub pull request) |
| [AGENTS.md](AGENTS.md) | For developers and AI agents: commands, hard rules, code map |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the server, generators, data folder and UI fit together |
| [docs/API.md](docs/API.md) | Every HTTP endpoint with request and response shapes |
| [CHANGELOG.md](CHANGELOG.md) | Versions |

## What it makes

48 generators, grouped by tab. Every size is a parameter: tube OD and ID, clearances, wall, bolt size (M2 to M5), hole patterns, angles.

| Tab | Generators | Presets |
|-----|-----------|---------|
| Shop | `stack-bin` (stacking bins, label slot / raised / recessed text), `parts-box`, `holder-block` (bits, batteries, SD cards), `hook`, `tool-rack`, `label-card`, `fit-test` (heat-set insert, hole and press-fit test coupons) | 770 |
| Planes | `rc-wing` (wingspan, chords, sweep, washout, spar tubes, ailerons / elevator / rudder cut as separate parts, servo pocket + wire channel), `control-horn`, `servo-mount`, `pin-hinge`, `firewall-mount` (down / right thrust), `fuselage-former`, `rc-wheel` | 247 |
| Quadcopters | `multirotor-frame` (3 to 8 arms), `motor-mount` (clamps round or square arm tubes), `prop-guard`, `landing-leg`, `repair-stand` (bench cradles), plus arm mounts for ESCs, receivers, VTX, FC, GPS posts, batteries, lights, wires; Yuneec Typhoon H480 / H520 bench and gear-leg parts (measure first) | 459 |
| Accessories | `tube-clamp` (split, mount plate, saddle, parallel, cross, snap-on clip, two-piece mid-tube, collar), `component-mount` (tray / board pad / cradle / cup / cable clips / support post on a zip-tie saddle, bolt-on clamp, screw plate or tape: ESCs, receivers, batteries, VTX, FC, GPS posts, lights, sensors, Pi boards), `tube-joint` (straight, elbow, tee, cross, Y, radial hub, 3D corners), `tube-cap` (plug, cap, angled foot), `spacer` (spacers, standoffs, washers, bushings), `gps-mast`, `antenna-mount`, `zip-tie-mount`, `camera-mount`, `action-cam-mount`, `connector-mount`, `fc-adapter`, `soft-grommet`, `damper-plate` | 860 |
| Robotics | `servo-gimbal` and `brushless-gimbal` (assemblies), `gear` (spur, helical, herringbone, rack), `pulley` (GT2-style, idler), `stepper-mount` (NEMA 11 / 14 / 17 / 23), `bearing-block`, `shaft-coupler`, `link-bar`, `knob`, `enclosure`, `sbc-case` (Raspberry Pi 5 / 4 / 3 or any board: port windows, fan or vents, ears), `sensor-bracket` (TF-Luna, TFmini, XIAO boards: snap lips, tilt wedge, plate / tube saddle / tape), `lidar-mount` (puck lidar plates), `extrusion-bracket` (2020 / 3030 / 4040), `motor-clamp` (N20, 130, 25 / 37 mm gear motors), plus board / sensor / battery mounts | 1074 |

Generators also show in other tabs where they fit (tube clamps under Quadcopters and Robotics, for example). Tick **show all** to pick any generator from any tab.

All parts print without supports. Each part comes out in its print orientation.

## Home, search, favorites, projects

- **Home** shows tabs, your favorites, projects, recent designs and printer status. Type in the search box to search everything.
- **Advanced search** (click "Advanced search"): filter by kind (presets, saved designs, generators, projects), tab, generator, favorites only; sort by match, name, tab or recent. Query syntax:

| Type | Finds |
|---|---|
| `esc 16` | Everything containing both words |
| `"tube clamp"` / `-snap` | Exact phrase / exclude a word |
| `tab:quads` `kind:preset` `gen:tube-clamp` `group:hooks` `tag:esc` `fav:yes` `status:active` | Filters |
| `tubeOD:16` `teeth>=30` `length<20` `bolt:M3` | Any setting, with `:` `=` `>` `<` `>=` `<=` |

- **Grid / List**: every result list has both. Grid cards show a 3D preview. Previews render once in your browser and are cached on the server for every device.
- **Favorites**: the star on any card, in the designer next to the description, or on a project. Stored on the server.
- **Projects**: press **+** on a card or **Add to project** in a designer. Unchanged presets and saved designs are linked (later edits flow through); changed settings are stored as a snapshot. On the project page set quantities, notes and printed checkboxes, and download every part (or only unprinted parts) as one ZIP with a parts list.

## Presets, saved designs and files

- **Presets** are the starting points in each tab. They are JSON files in [`presets/`](presets/); add your own there.
- **Save design** stores the current settings on the server under **My Designs**. Load, Make, Rename, Export or Delete them there. Saved designs survive updates and are shared by every device that opens the server.
- **Export / Import** downloads or loads a `.params.json` file. The CLI reads the same files.
- **Open STL file** shows any STL from your computer in the 3D view (nothing is uploaded).
- **Download all (ZIP)** gets every part of a multi-part design (wing sections and ailerons, clamp halves, box and lid) in one file.

Sizes in preset descriptions (props, batteries, servos, boards, motors) are nominal. Measure your parts before a big print run.

## Shop catalog and labels

The Shop tab tracks every bin in your shop.

1. Pick a category (Props, Motors, Fasteners ... edit the list with **Edit categories**).
2. Enter a name and an optional location (shelf/row).
3. Pick a design (any preset). To customize: load a preset in the Designs tab, change values, press **Add to shop**.
4. Press **Add item**. The item gets a code like `PRP-001` and the bin is generated with the name and code on its label.
5. **Make** generates the bin again. Bins with a card slot also get a matching `label-card` STL.
6. **Print paper labels** opens a sheet sized to each bin's slot, with the category color bar. Print at 100% scale.

Label styles on bins and holders:
- **Card slot**: swap labels when a bin changes use. Use the printed label card or cardstock cut to the reported size.
- **Raised text**: change filament at the first text layer for two colors.
- **Recessed text**: fill with paint marker.

Catalog data (`catalog.json`, `categories.json`), saved designs (`designs.json`), projects, favorites, printers and the preview cache are in `data/` (`STLTOOLS_DATA` to change). Back that folder up.

## Run from source (developers)

Needs Node.js 18 or newer. No build step. No Docker.

```bash
git clone https://github.com/opsecfreak/STLTools.git
```

```bash
cd STLTools
```

```bash
npm install
```

```bash
npm test
```

## Web UI

```bash
npm start
```

Open http://127.0.0.1:3000.

Environment variables: `HOST` (default `127.0.0.1`), `PORT` (default `3000`), `STLTOOLS_DATA` (default `./data`). Set `HOST=0.0.0.0` to open it from a phone or another PC on your LAN. There is no login, so do not expose it to the internet. For access away from the shop, use a private VPN such as Tailscale.

## CLI

```bash
node bin/stltools.js presets drone
```

```bash
node bin/stltools.js preset drone-props-5in -o out
```

```bash
node bin/stltools.js preset hook-peg-j --armLength 70 -o out
```

```bash
node bin/stltools.js info stack-bin
```

```bash
node bin/stltools.js gen stack-bin --width 100 --depth 150 --height 70 --compartmentsX 2 --labelType emboss --labelText "M3 SCREWS" -o out
```

Each run writes one STL per part plus `<name>.params.json`. Feed it back with `--params <file>` to rebuild the same part. Other flags: `--ascii`, `--name <prefix>`. Run `npm link` once to use `stltools` as a command.

## Run as a system service (systemd)

On a Raspberry Pi or any Debian-based Linux, the installer does everything (Node.js, service user, `/opt/stltools`, systemd unit) and also updates an existing install:

```bash
sudo bash deploy/install-pi.sh
```

See [deploy/README.md](deploy/README.md) for settings and [docs/RASPBERRY-PI.md](docs/RASPBERRY-PI.md) for the full walkthrough.

## API

Every endpoint with request and response shapes: [docs/API.md](docs/API.md). Main ones:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/generators`, `/api/presets`, `/api/version` | What is available |
| POST | `/api/generate/:id` | JSON params in, parts with stats and download URLs out |
| POST | `/api/estimate` | Print time and filament for part stats and a printer profile |
| GET / PUT | `/api/settings` | Settings (partial updates) |
| GET / PUT | `/api/library`, `/api/library/upload` | STL library |
| GET / POST | `/api/projects/:id/export`, `/api/projects/import` | Move projects between computers |
| GET (+ upload) | `/api/printers/...`, POST `/api/printers/diagnose` | Printers, view only |

## Print notes

**Stacking bins**
- Bins stack only on bins with the same width, depth and wall.
- Dividers stop below the foot of the bin on top.
- Open-front bins: the top bin is held by the foot chamfer at the back. Do not stack them more than 4-5 high without a shelf behind.

**Hooks**
- Hooks print on their side so layer lines run along the arm. Use 4+ perimeters.
- Pegboard pegs sit on one edge of the hook so they touch the bed. Insert the top peg tilted, then rotate down. Load capacity is not rated: test with a light load first.
- 1/4 in board (6.35 mm holes): peg 5.8 mm. 1/8 in board (3/16 in holes): peg 4.4 mm, board 3.2 mm.

**Tool racks**
- Print upright with the shelf on the bed. Pegs have a 45 degree diamond section so they need no support.

**Holder blocks**
- Print a 1 x 2 test block first to tune clearance.

**RC wing**
- Print each section on its root face. Low infill (gyroid 5-8%) or 2-3 perimeters with 0% infill.
- Spar hole = tube OD + 0.1 to 0.2 mm.

**Tube clamps and joints**
- Bore = tube OD + 2 x clearance. 0.1-0.2 mm clearance for a clamp you tighten; negative values grip harder.
- Clamps print with the tube vertical so the ring layers wrap the tube. Joints print flat with teardrop bores.
- PETG, ASA or nylon hold clamping force better than PLA.

**Planes**
- Ailerons, elevators and rudders come out as separate `surfaceN` parts with the hinge gap and a leading-edge bevel. Top hinge = tape hinge; center hinge = pin or CA hinges.
- The servo pocket opens through the bottom skin. A wire channel runs to the root.

**Robotics**
- Gears: mating gears need the same module. Center distance = module x (teeth1 + teeth2) / 2.
- GT2 pulley tooth shape is approximate. Test-fit the belt first.
- NEMA dimensions follow the NEMA standard; check your motor's datasheet.

## How it works

- Geometry kernel: [manifold-3d](https://github.com/elalish/manifold) (WASM, also used by OpenSCAD). Booleans always give closed, consistently oriented meshes.
- Tests check every part of every preset: no open edges, no edges that break after STL float rounding, positive volume, sitting on the bed.
- Text: Roboto Condensed Bold (SIL Open Font License) via opentype.js, turned into outlines and extruded.
- Horizontal holes use a teardrop shape so they print without support.

## Add a generator or preset

- Quickest: **Save design** in the web UI (stored on the server, no files).
- Your own presets and generators: drop them in `custom/` (desktop app: your user data folder). Broken files are skipped, never fatal. See [custom/README.md](custom/README.md).
- Core additions: [docs/EXTENDING.md](docs/EXTENDING.md), [presets/README.md](presets/README.md), [src/generators/README.md](src/generators/README.md).

## Known limits

- Generation runs on the server's main thread. Very large values block other requests until done.
- No user accounts. Anyone who can reach the port can edit the catalog.
- STL only. 3MF (with colors for labels) is on the roadmap.
- No slicing on the server. Slice in your slicer, then upload the G-code in the Printers tab.
- Memory grows about 5 MB per 1000 generations (WASM allocator). A service restart clears it.

## Roadmap ideas

Slicing on the Pi and sending to a Klipper / Mainsail printer (see [docs/PRINTERS.md](docs/PRINTERS.md)), Gridfinity-compatible bins, wall rail for open-front bins, QR codes on labels, 3MF output, folding GPS mast, gimbal yokes, cable chains, wing dihedral joiners.
