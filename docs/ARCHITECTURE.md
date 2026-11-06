# Architecture

> See also: [API](API.md) | [AGENTS.md](../AGENTS.md) | [Extending](EXTENDING.md) | [Self-hosting](SELF-HOSTING.md) | [All docs](README.md)

```
 Browser (public/*.js, three.js)                    Node server (src/server.js)
 ───────────────────────────────                    ──────────────────────────────────────────
 app.js      routing, designer, catalog   ──HTTP──▶  route()  ─▶ registry.generate() ─▶ generators/*.js
 home.js     Home, search index, projects            │                                    │
 search.js   header search                           │        kernel.js (manifold-3d WASM)◀┘
 settings.js Settings page                           ├─▶ export.js  toStl, meshStats
 files.js    Import, STL Files                       ├─▶ jsonstore  settings, designs, projects,
 printers.js Printers (view only)                    │              favorites, catalog, library,
 viewer.js   3D view + thumbnailer                   │              printers   (data folder)
 viewtools.js 3D controls + estimate ◀─/shared/estimate.js (same file as src/core/estimate.js)
                                                     ├─▶ hosting.js  run mode, LAN PIN gate (before route())
                                                     └─▶ printers.js ──LAN──▶ Moonraker (SV07)
                                                                       read-only GETs, upload print=false,
                                                                       webcam MJPEG piped through /stream
 bin/stltools-app.js (desktop launcher): data folder by mode (desktop, --portable,
 --temp, --data), port, LAN and auto-stop from flags or Settings > Self-hosting,
 then imports src/server.js with STLTOOLS_MODE / STLTOOLS_STOP_AT set.
```

## Generation flow

1. The browser sends `POST /api/generate/<id>` with the form values.
2. `registry.generate()` runs `migrate()` (renamed parameters), `resolveParams()`
   (types, limits, defaults), then the generator's `generate(p, k, lib)` with a
   fresh kernel scope.
3. Each returned part is a manifold. `toPlainMesh` simplifies by 0.005 mm and
   converts it to a triangle mesh; the scope is freed.
4. `publish()` writes STL bytes into the job cache (last 50 jobs) under a key
   that is a hash of generator + parameters, and returns part URLs and stats
   (`size`, `volumeMm3`, `areaMm2`, `flatAreaMm2`, `bedAreaMm2`, `triangles`).
5. The browser loads the STL URLs into the viewer, and the estimate box
   computes print time from the stats and the selected printer profile.

## Data folder

Set by `STLTOOLS_DATA` (default `./data`; the desktop launcher uses a per-user
folder). All files are JSON written atomically (temp file + rename).

| File | Owner module |
|---|---|
| `settings.json` | `core/settings.js` |
| `designs.json` | `core/designs.js` |
| `projects.json`, `favorites.json` | `core/projects.js` |
| `catalog.json`, `categories.json` | `core/catalog.js` |
| `printers.json` (API keys, never sent to browsers) | `core/printers.js` |
| `library.json` + `library/<id>.stl` | `core/library.js` |
| `thumbs/<app version>/<key>.png` | `core/thumbs.js` |

## Print estimate model

See the header of `src/core/estimate.js` and [PRINTER-PROFILES.md](PRINTER-PROFILES.md).
Walls from vertical surface area, top/bottom from flat area, infill from the
rest of the volume; times from flow rates capped by the hotend's max flow,
divided by a motion efficiency, plus per-layer overhead and heat-up; times the
user's calibration factor.

## Printers (view only)

`core/printers.js` has no pass-through. Each function maps to one fixed
Moonraker GET (`/server/info`, `/printer/info`, `/printer/objects/query`,
`/server/files/list|metadata|roots`, `/server/history/list`,
`/server/webcams/list`, thumbnails, snapshots, the toolhead + configfile
query for `machine()`, the webcam MJPEG stream) plus one upload
(`POST /server/files/upload` with `print=false`). Only LAN addresses are
accepted. `diagnose()` runs the read-only checks one by one for the Settings
page. The Sovol SV07 runs Klipper + Moonraker + Mainsail, so it uses this path
on port 80 (Mainsail's nginx forwards the API) or 7125 (Moonraker directly).

Webcam: `cameras()` reads Moonraker's webcam list, else the profile's
`webcam` paths, else the Mainsail defaults (tried with one snapshot). The
stream route pipes the upstream MJPEG body to the browser and aborts the
upstream fetch when the browser disconnects (max 3 per printer).

Estimates: `machine()` reads bed travel, max velocity / accel, nozzle and
filament diameter; `profileFromMachine()` in `estimate.js` merges them into the
printer's profile; `GET /api/estimate-targets` gives the browser the merged
profiles so browser and server estimates match.

The front end hides printer UI (`data-needs-printers`) when Settings >
Printers > Printer features is off, or "auto" with no printer saved. Without
WebGL, `createViewer()` returns a fallback with the same interface (a parts
list with sizes).

## Self-hosting and access (1.1)

- `bin/stltools-app.js` picks the data folder: per-user (desktop), next to the
  package (`--portable` or `portable.txt`; on macOS next to the `.app`), a new
  temp folder deleted on exit (`--temp`), or `--data`. `--hours` / Settings >
  Self-hosting > autoStopHours exit the process after a time.
- `src/core/hosting.js`: the LAN access PIN (scrypt hash, random secret,
  HMAC cookie token, 5 tries per minute per address). `startServer()` checks
  `hosting.allowed(req)` before `route()`: loopback is always allowed; other
  clients without the cookie get the login page (HTML) or 401 (API).
- `GET /api/hosting` reports mode, listen address, LAN URLs, PIN state, board
  model (`/proc/device-tree/model`) and the data folder.
- A 15 s timer runs `printers.checkAll()` every `printers.checkMinutes`
  (read-only `/server/info`; results in memory, shown as `lastCheck`).

## Front end

No build step. `index.html` loads `app.js` as an ES module with an import map
for three.js (served from `node_modules/three`). Settings are loaded once
(`lib.loadSettings()`) and cached; `saveSettings(patch)` sends partial updates
and notifies listeners (`onSettings`). Hash routes make Back work and pages
bookmarkable.

## Tests

`node --test test/*.test.js`. Suites start real servers on port 0 with a temp
data folder. `helpers/mock-moonraker.js` is a fake SV07 that records every
request so tests prove that nothing but read-only calls and `print=false`
uploads are sent.
