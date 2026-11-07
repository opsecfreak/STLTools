# src/core: the engine

Everything the server, the CLI and the tests share. Plain Node.js ES modules, no framework. Units are millimeters.

> See also: [Architecture](../../docs/ARCHITECTURE.md) | [Generators](../generators/README.md) | [Stress Lab engines](lab/README.md) | [API](../../docs/API.md) | [All docs](../../docs/README.md)

## Geometry and generation

| File | What it does |
|---|---|
| `kernel.js` | Wrapper over manifold-3d (WASM). Scoped helpers for generators: blocks, cylinders, prisms, teardrop holes, hex pockets, `pose()` for assemblies, `placeOnBed()`. Every boolean result is a closed, consistently oriented solid. |
| `registry.js` | Finds every generator in `src/generators/` and `custom/generators/`, checks parameters, runs `generate()`, turns results into plain meshes (with `assembled` matrices, `qty`, `copies`, `material`). |
| `params.js` | Parameter schema rules shared by the UI, CLI and tests (types, ranges, selects, migration of old names). |
| `presets.js` | Loads `presets/*.json` and `custom/presets/`, validates `verify` / `measure` lists. |
| `hardware.js` | Metric screw, nut and head sizes (ISO 4032 / ISO 4762) and hole pattern helpers. |
| `mounts.js` | Pegboard, screw and tape mounts shared by hooks and racks. |
| `labels.js`, `text.js` | Labels on bins: card slots, raised or recessed text (Roboto Condensed outlines). |
| `airfoil.js` | NACA 4-digit airfoils for the RC wing. |
| `export.js` | STL writer and mesh checks (open edges, STL rounding issues, volume, area). |
| `zip.js` | Minimal ZIP writer for multi-part downloads. |
| `thumbs.js` | Cached card previews. |

## Print planning

| File | What it does |
|---|---|
| `estimate.js` | Print time, grams, metres and cost from part geometry and a printer profile; filament densities per material. |
| `profiles.js` | Printer profiles (shipped, custom, imported from PrusaSlicer `.ini` / OrcaSlicer `.json`). |
| `layers.js` | Layer preview: cross-sections per layer, wall insets, solid skin and infill lines, time per layer. A preview, not G-code. |
| `split.js` | Splits parts larger than the bed (alignment pin holes on every cut) and packs pieces onto plates. |
| `materials.js` | Filament data for the Stress Lab (`materials/filaments.json` plus your own). |

## Printers (Klipper / Moonraker)

| File | What it does |
|---|---|
| `printers.js` | Direct LAN connection to Moonraker: scan, connection test, status, files, history, webcam stream, machine limits, health check, config / log / mesh viewers, G-code header check, live updates (websocket, polling fallback), and the opt-in control allow-list with its log. Read-only unless control is on for that printer. Never edits printer.cfg. |

Checklist templates for the header check: [../../checklists/README.md](../../checklists/README.md). Guide: [../../docs/PRINTERS.md](../../docs/PRINTERS.md).

## Your data (stored in the data folder)

| File | Stores |
|---|---|
| `settings.js` | Settings schema and values (`settings.json`), shared by every device. |
| `designs.js` | Saved designs (My Designs). |
| `projects.js` | Projects (items, quantities, places, filament) and favorites; project export / import bundles. |
| `collections.js` | Collections of STL files (MTS edition: other kinds become frozen STL copies). |
| `library.js` | Imported STL files. |
| `parts.js` | My Parts and seed sets (`seed/`). |
| `catalog.js` | Shop catalog items and categories. |
| `jsonstore.js` | Small atomic JSON file store used by the above. |
| `hosting.js` | Run mode (desktop, USB, one-time, Pi service), LAN and access PIN. |

## Rules

- No invented sizes: generators take sizes as parameters; presets mark datasheet values `verify` and unknown ones `measure`.
- No secrets in code or docs. Printer API keys live only in `<data>/printers.json` and never reach the browser.
- Every STL must pass `openEdgeCount() === 0` and `stlEdgeIssues() === 0` (see `test/generators.test.js`).
