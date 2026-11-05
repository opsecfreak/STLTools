# STL Tools

Parametric STL generator for 3D printing. Set dimensions, get a watertight STL, slice and print.

- **CLI** for scripting and batch jobs.
- **Web UI** with live 3D preview and per-part STL downloads.
- **Library** (`import { generate, toStl } from './src/index.js'`) for use in other Node projects.

Units are millimeters, because slicers read STL as mm.

## Generators (v1)

| id | What it makes | Parts |
|----|---------------|-------|
| `parts-box` | Rounded box with an X/Y grid of compartments and an optional press-fit lid. No supports needed. | `box`, `lid` |
| `rc-wing` | Tapered NACA 4-digit wing half with sweep, washout, main and rear spar tube holes. Split into sections that fit your printer height. Optional mirrored left panel. | `right-sectionN`, `left-sectionN` |

Run `node bin/stltools.js info <id>` for every parameter, default, unit and limit.

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

## CLI

```bash
node bin/stltools.js list
```

```bash
node bin/stltools.js info rc-wing
```

```bash
node bin/stltools.js gen parts-box --width 100 --depth 60 --height 30 --compartmentsX 4 --compartmentsY 2 -o out
```

```bash
node bin/stltools.js gen rc-wing --airfoil 4412 --halfSpan 500 --rootChord 200 --tipChord 150 --washout 2 --bothSides -o out
```

Each run writes one STL per part plus `<name>.params.json`. Feed that file back in to regenerate the same part, and override any value with a flag:

```bash
node bin/stltools.js gen rc-wing --params examples/rc-wing-trainer-1200.params.json --sparDiameter 6.1 -o out
```

Other flags: `--ascii` for ASCII STL, `--name <prefix>` for file names. Run `npm link` once to use `stltools` as a global command.

Keep `.params.json` files in Git next to your prints. They are the source of truth for a part; STLs can be rebuilt from them at any time.

## Web UI

```bash
npm start
```

Open http://127.0.0.1:3000. Pick a generator, edit values, press Generate (or Enter). Click a part name to view it alone. "Save params" downloads a `.params.json` the CLI can read.

Environment variables: `HOST` (default `127.0.0.1`), `PORT` (default `3000`). Set `HOST=0.0.0.0` to reach it from other machines on your LAN. There is no login, so do not expose it to the internet.

### Run as a system service (systemd)

1. Create a service user.

```bash
sudo useradd --system --home /opt/stltools --shell /usr/sbin/nologin stltools
```

2. Copy the project to `/opt/stltools` and install dependencies there.

```bash
sudo cp -r . /opt/stltools && cd /opt/stltools && sudo npm ci --omit=dev
```

3. Give the service user ownership.

```bash
sudo chown -R stltools:stltools /opt/stltools
```

4. Install and start the unit.

```bash
sudo cp deploy/stltools.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now stltools
```

5. Check that it runs.

```bash
systemctl status stltools
```

Note: edit `HOST` and `PORT` in `/etc/systemd/system/stltools.service`, then run `sudo systemctl restart stltools`.

## API

| Method | Path | Body / result |
|--------|------|---------------|
| GET | `/api/generators` | List of generators with parameter schemas |
| POST | `/api/generate/:id` | JSON params. Returns parts with stats and download URLs, plus warnings and notes. 400 on bad params. |
| GET | `/api/stl/:job/:part.stl` | Binary STL. The last 50 jobs are kept in memory. |

## Print notes

**Parts box**
- Wall and divider thickness work best as a multiple of your line width (0.4 nozzle: 1.2, 1.6, 2.0).
- Print the lid plate-side down. If it is too tight, raise `clearance` by 0.05 mm.

**RC wing**
- Print each section standing on its root face.
- Use low infill (gyroid 5-8%), or 2-3 perimeters with 0% infill. Spar holes get their own perimeters, so the tube is well supported.
- Spar hole diameter = tube OD + 0.1 to 0.2 mm. The generator warns when the tube leaves less than 0.8 mm of skin.
- Sections share the same spar line, so they align on the tube when you glue them.
- Not modeled yet: dihedral joiner, ailerons, servo bays, lightening holes.

## How it works

- Geometry kernel: [manifold-3d](https://github.com/elalish/manifold) (WASM, also used by OpenSCAD). Booleans always give closed, consistently oriented meshes. Tests check every part for open edges, positive volume, and that it sits on the bed at Z=0.
- Airfoils: NACA 4-digit equations with closed trailing edge and cosine point spacing. A minimum trailing-edge thickness is enforced so the slicer can print it.
- The wing is a straight extrusion of the root airfoil, then each vertex is moved for taper, sweep and twist. Twist pivots on the main spar line, so the spar stays straight through all sections.

## Add a generator

1. Create `src/generators/<id>.js`. Export `{ id, name, description, params, generate(p, k) }`.
2. Declare `params` as a schema: `type` (number, integer, boolean, string, select), `default`, `min`, `max`, `unit`, `label`, `group`, `help`. The CLI flags and the web form come from this schema.
3. Build geometry with the kernel scope `k` (`src/core/kernel.js`): `roundedBlock`, `cuboid`, `rod`, `polygon`, `extrude`, `union`, `difference`, `mirror`. Wrap any direct manifold call in `k.track()` so its WASM memory is freed.
4. Return `{ parts: [{ name, manifold }], warnings, notes }`. Put each part on the bed (min Z = 0) in its print orientation.
5. Add it to the list in `src/core/registry.js`.
6. Add a test in `test/generators.test.js`. Run `npm test`.

## Known limits

- The server runs generation on the main thread. Very large parameter values block other requests until done.
- Memory grows by about 5 MB per 1000 generations after warm-up (WASM allocator). Not an issue for normal use. A service restart clears it.
- STL only. 3MF output is on the roadmap.

## Roadmap ideas

Gridfinity-compatible bins, wing ailerons and servo bays, dihedral joiners, fuselage formers, motor mounts, Raspberry Pi and PCB enclosures, camera and lidar mounts, 3MF output.
