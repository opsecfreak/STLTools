# AGENTS.md: guide for developers and AI coding agents

> See also: [All docs](docs/README.md) | [Architecture](docs/ARCHITECTURE.md) | [API](docs/API.md) | [Contributing](CONTRIBUTING.md) | [Security](SECURITY.md)

Read this first. It says how the project is built, the rules that keep it
working, and where to change things. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/API.md](docs/API.md), [docs/EXTENDING.md](docs/EXTENDING.md).

## What this is

STL Tools is a parametric STL generator for a drone, RC and robotics shop. A
Node.js server (no framework) generates watertight STL files from JavaScript
generators, serves a browser UI (vanilla ES modules + three.js), stores user
data as JSON files, and reads Klipper printers (Sovol SV07) over the LAN in
**view-only** mode.

Runs on: Windows and Linux desktops (main target), macOS, Raspberry Pi.
Node 18, 20 or 22. No Docker. No database server.

## Commands

```bash
npm install          # dependencies (manifold-3d, three, opentype.js, a font)
npm start            # server on http://127.0.0.1:3000 (HOST, PORT, STLTOOLS_DATA env)
npm run app          # desktop launcher: per-user data folder, opens an app window
npm test             # node --test test/*.test.js (must pass on Node 18 and 22)
node bin/stltools.js list | info <id> | gen <id> -o out | presets | preset <id> -o out
npm run package      # release packages (needs network to download Node)
```

## Hard rules (do not break these)

1. **Printers are view only.** `src/core/printers.js` calls a fixed list of
   read-only Moonraker endpoints. Uploads always send `print=false` and fail if
   `print_started` comes back. Never add start, pause, cancel, G-code, delete,
   restart or settings endpoints. `test/printers.test.js` fails on any control
   request.
2. **Every STL must be watertight.** Tests check `openEdgeCount` and
   `stlEdgeIssues` (edges that break after float32 rounding) for every select
   option of every generator and for presets. Geometry rules are in
   [src/generators/README.md](src/generators/README.md): overlap solids instead
   of touching them, no coplanar faces between union parts, teardrop horizontal
   holes, odd segment counts against faceted outlines.
3. **Parts sit in print orientation on z = 0**, one part per STL.
4. **Never invent dimensions.** Datasheet or assumed sizes go in presets with
   a `verify` list (highlighted in the UI). Sizes nobody measured go in a
   `measure` list and stay **out** of `params`: the UI leaves those fields
   empty and blocks Generate. Part sizes in My Parts are copied as given,
   with MEASURE / CONFLICT / UNVERIFIED kept as flags.
5. **No secrets in code, docs or tests.** Use `PLACEHOLDER_KEY`. Printer API
   keys live only in `<data>/printers.json` and are never sent to browsers.
6. **User data is never touched by upgrades.** Everything a user makes is in
   the data folder (`STLTOOLS_DATA`). New stores must default safely when their
   file is missing.
7. **Custom files must not break the app.** Files in `custom/` and
   `$STLTOOLS_CUSTOM` (generators, presets, printer profiles) are loaded
   leniently: a bad one is skipped and listed in `/api/version` issues.
8. **Versioning.** Bump `package.json` version, add a CHANGELOG entry
   (Changed / Fixed / Untested). Pushing a new version to `main` publishes a
   release (`.github/workflows/release.yml`).
9. **Access stays local-first.** The server listens on 127.0.0.1 unless told
   otherwise. The LAN PIN is stored only as a hash (`data/hosting.json`);
   requests from the machine itself never need it. Webcam snapshots and
   streams are GET only, LAN addresses only, and the upstream connection
   closes with the browser's. Printer features stay optional (Settings >
   Printers > Printer features).

## Map of the code

| Path | What |
|---|---|
| `src/server.js` | HTTP routes (`route()`), static files, job cache for STL/ZIP downloads |
| `src/core/kernel.js` | manifold-3d wrapper: `createScope()` gives shape helpers; always `free()` |
| `src/core/registry.js` | loads generators from `src/generators/*.js` and custom folders |
| `src/core/params.js` | parameter schema checks (`resolveParams`) |
| `src/core/presets.js` | loads `presets/*.json` (+ custom), validates against generators |
| `src/core/export.js` | STL writer, `meshStats` (size, volume, surface areas), edge checks |
| `src/core/estimate.js` | print time / filament estimate; **no Node imports** (also served to browsers) |
| `src/core/profiles.js` | printer profiles from `printer-profiles/*.json` |
| `src/core/settings.js` | settings schema + store (`settings.json`) |
| `src/core/library.js` | STL library (imported files) + STL parser |
| `src/core/projects.js` | projects, favorites, project export / import bundles |
| `src/core/printers.js` | Moonraker client (view only), LAN scan, connection test, background checks, machine limits, webcam list + MJPEG stream |
| `src/core/hosting.js` | LAN access PIN (hash, cookie, rate limit), LAN URLs, Pi board model, login page |
| `src/core/catalog.js`, `designs.js`, `thumbs.js`, `zip.js`, `jsonstore.js` | shop catalog, saved designs, preview cache, ZIP writer, atomic JSON files |
| `src/generators/*.js` | one or more generators per file (exported objects with `id` + `generate`) |
| `presets/*.json` | ready-made parameter sets, grouped by tab |
| `presets/50-series-*.json` | generated size series: edit `scripts/build-series.mjs`, never the files |
| `printer-profiles/*.json` | printer bed size and speeds for estimates |
| `seed/example/` | example My Parts list and project ideas (data, not instructions); a real shop's list is on branch `mts-personal-data` |
| `src/core/parts.js` | My Parts store, dimension flags, seed reader |
| `public/` | browser UI: `app.js` (controller + routing), `home.js`, `search.js`, `settings.js`, `files.js`, `parts.js` (My Parts), `printers.js`, `viewer.js`, `viewtools.js`, `thumbs.js`, `lib.js` |
| `bin/` | `stltools.js` CLI, `stltools-app.js` desktop launcher (desktop / `--portable` / `--temp` / `--hours`) |
| `scripts/package.mjs`, `packaging/` | release packages and installers (USB portable and one-time start scripts) |
| `scripts/check-packages.mjs` | checks built packages: binary OS / CPU, CRLF, executable bits, checksums |
| `scripts/ui-smoke.mjs` | Playwright UI smoke test (pages, 3D, live webcam, printer toggle, no-WebGL) |
| `scripts/test-pi-install.sh` | end-to-end test of `deploy/install-pi.sh` (needs root) |
| `deploy/` | Pi / Linux system service installer and unit |
| `test/` | node:test suites; `helpers/mock-moonraker.js` is a fake SV07 |

## Common tasks

- **Add a generator:** new file in `src/generators/`, export an object
  `{ id, name, sections, description, params, generate(p, k, lib) }`. It shows
  up automatically. `test/v3.test.js` builds every select option.
- **Add presets:** add to a `presets/*.json` file (or a new one). Fields: `id`,
  `name`, `generator`, `description`, `tags`, `params`, optional `verify`,
  `group`, `section`.
- **Add an assembly:** build each part in place, `k.pose()` it for printing,
  return `assembled` with each part, set `assembly: true` (see
  `src/generators/gimbals.js` and src/generators/README.md).
- **Simple mode:** add the main settings of a generator to `BASIC` in
  `src/core/registry.js` (or a `basic` list on the generator).
- **Add a size series:** add an entry to `SERIES` in `scripts/build-series.mjs`,
  run it, run `npm test`, commit the script and the generated file.
- **Add a hardware preset:** add it to `presets/22-hardware-parts.json` with
  `category`, and `measure` for sizes nobody has measured. (`component` and
  `ownership` link a preset to a My Parts id; use them only in custom presets.)
- **Add a printer profile:** [docs/PRINTER-PROFILES.md](docs/PRINTER-PROFILES.md).
- **Add a setting:** add it to `SCHEMA` in `src/core/settings.js`. The Settings
  page draws it automatically.
- **Add an API route:** `route()` in `src/server.js`, document it in
  [docs/API.md](docs/API.md) and the header comment of `server.js`, add a test.
- **UI page:** add a hash route in `public/app.js` (`PAGES` + `showPage`), a
  render function in its own module, and a `PAGES` entry in `home.js` so global
  search can find it.

## Editions and branches

- `main` is the public edition. Shipped files must not contain personal or
  client data (`test/v10.test.js` checks this).
- `mts-personal` is a personal edition: `main` plus `EDITION.json`, its own
  `seed/<set>/` parts list and part-linked presets. Update it by merging
  `main` into it; its version is `<public version>-mts.<n>` and it is
  released by starting the Release workflow on that branch (pre-release).
- Tests read `EDITION.json` and skip public-only checks on a personal edition.

## Before you finish

1. `npm test` passes (also on Node 18 if you can).
2. Open the UI and check the pages you changed for console errors, or run
   `node scripts/ui-smoke.mjs` (needs Playwright with Chromium).
3. Installer or service change: `sudo bash scripts/test-pi-install.sh`.
   Packaging change: `node scripts/package.mjs` then `node scripts/check-packages.mjs`.
4. Update CHANGELOG.md and the docs you touched (docs/README.md is the index).
