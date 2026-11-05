# STL Tools

Parametric STL generator for organizing a shop and building RC parts. Pick a ready-made design, change any value, get a watertight STL, slice and print.

- **Web UI**: preset browser, live 3D preview, per-part STL download, shop catalog with labels.
- **CLI**: scripting and batch jobs.
- **Library**: `import { generate, toStl } from './src/index.js'`.

Units are millimeters, because slicers read STL as mm.

## What it makes

| Generator | What it makes | Prints |
|-----------|---------------|--------|
| `stack-bin` | Stackable bin. Foot drops into the bin below. Compartments, finger scoop, open front, label slot or raised/recessed text. | Upright |
| `parts-box` | Box with a compartment grid and a press-fit lid. | Upright |
| `holder-block` | Block with round, hex, square or slot pockets: bits, batteries, SD cards, USB sticks, drivers, markers. | Upright |
| `hook` | J hook, angled hook, double hook, wide cradle. Pegboard, screw or tape mount. | On its side |
| `tool-rack` | Shelf with holes or slots for screwdrivers, pliers, tweezers, wrenches. Pegboard, screw or tape mount. | Upright |
| `label-card` | Card with raised text that drops into a bin label slot. | Flat |
| `rc-wing` | Tapered NACA 4-digit wing half with spars, split into printer-height sections. | Root down |

All parts print without supports.

## Presets

82 ready-made designs in 9 groups: Stacking Bins, Drone Parts, Fasteners and Small Parts, Hooks, Tool Racks, Holders, Boxes, Labels, RC Aircraft. They live as JSON in [`presets/`](presets/). Edit a file or add your own; each preset is a generator id plus the values that differ from its defaults. Every preset is generated and checked by `npm test`.

Sizes in preset descriptions (prop lengths, battery and card sizes) are nominal. Measure your parts before a big print run.

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

Catalog data is saved as JSON in `data/` (`STLTOOLS_DATA` to change). Back it up.

## Install

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

1. Create a service user.

```bash
sudo useradd --system --home /opt/stltools --shell /usr/sbin/nologin stltools
```

2. Copy the project to `/opt/stltools` and install dependencies.

```bash
sudo cp -r . /opt/stltools && cd /opt/stltools && sudo npm ci --omit=dev
```

3. Create the data folder and set ownership.

```bash
sudo mkdir -p /opt/stltools/data && sudo chown -R stltools:stltools /opt/stltools
```

4. Install and start the unit.

```bash
sudo cp deploy/stltools.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now stltools
```

5. Check that it runs.

```bash
systemctl status stltools
```

Note: to reach it from other devices, set `Environment=HOST=0.0.0.0` in `/etc/systemd/system/stltools.service`, then run `sudo systemctl daemon-reload && sudo systemctl restart stltools`.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/generators` | Generators with parameter schemas |
| GET | `/api/presets` | Preset library |
| POST | `/api/generate/:id` | JSON params in, parts with stats and download URLs out |
| GET | `/api/stl/:job/:part.stl` | Binary STL (last 50 jobs kept in memory) |
| GET / PUT | `/api/categories` | Read / replace shop categories |
| GET / POST | `/api/catalog` | List / add shop items |
| GET / PUT / DELETE | `/api/catalog/:code` | Read / edit / delete an item |
| POST | `/api/catalog/:code/generate` | Item STL(s) with label text, plus a label card |

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

## How it works

- Geometry kernel: [manifold-3d](https://github.com/elalish/manifold) (WASM, also used by OpenSCAD). Booleans always give closed, consistently oriented meshes.
- Tests check every part of every preset: no open edges, no edges that break after STL float rounding, positive volume, sitting on the bed.
- Text: Roboto Condensed Bold (SIL Open Font License) via opentype.js, turned into outlines and extruded.
- Horizontal holes use a teardrop shape so they print without support.

## Add a generator

1. Create `src/generators/<id>.js`. Export `{ id, name, description, params, generate(p, k) }`.
2. Declare `params` as a schema: `type` (number, integer, boolean, string, select), `default`, `min`, `max`, `unit`, `label`, `group`, `help`. The CLI flags and the web form come from it. Reuse `labelParamSchema()` (`src/core/labels.js`) and `mountParamSchema()` (`src/core/mounts.js`).
3. Build geometry with the kernel scope `k` (`src/core/kernel.js`). Wrap any direct manifold call in `k.track()` so its WASM memory is freed.
4. Return `{ parts: [{ name, manifold }], warnings, notes, meta }`. Put each part on the bed in its print orientation.
5. Add it to `src/core/registry.js`, add presets in `presets/`, add a test, run `npm test`.

## Known limits

- Generation runs on the server's main thread. Very large values block other requests until done.
- No user accounts. Anyone who can reach the port can edit the catalog.
- STL only. 3MF (with colors for labels) is on the roadmap.
- Memory grows about 5 MB per 1000 generations (WASM allocator). A service restart clears it.

## Roadmap ideas

Gridfinity-compatible bins and baseplates, wall rail for open-front bins, drawer inserts, QR codes on labels, 3MF output, wing ailerons and servo bays.
