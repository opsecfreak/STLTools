# HTTP API reference

> See also: [Architecture](ARCHITECTURE.md) | [Printers](PRINTERS.md) | [Self-hosting](SELF-HOSTING.md) | [All docs](README.md)

Base URL: `http://127.0.0.1:3000` (or the LAN address with `--lan`). JSON in and
out unless noted. JSON over 32 KB is gzipped when the client sends `Accept-Encoding: gzip`. Errors: `{ "error": "message" }` with HTTP 400 (bad input),
401 (access PIN needed), 403 (wrong PIN), 404 (unknown id), 405 (wrong method),
413 (too large), 415 (webcam not MJPEG), 422 (generation failed), 429 (too many
tries or streams), 502 (printer did not answer). Routes live in `route()` in `src/server.js`.

## App

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/version` | | `{ name, version, node, platform, arch, generators, presets, profiles, dataDir, issues[] }` |
| GET | `/api/generators` | | `[{ id, name, description, sections[], params{}, basic[], assembly }]` (`basic`: settings shown in Simple mode) |
| GET | `/api/presets` | | `[{ id, name, generator, section, group, description, tags[], params{}, verify[]? }]` |
| GET | `/shared/estimate.js` | | the estimator ES module (same file the server uses) |
| GET | `/api/estimate-targets` | | `[{ value: "printer:<id>" \| "profile:<id>", label, printerId?, profile }]` (printer entries carry the profile merged with the printer's own limits, `profile.fromMachine`) |

## Self-hosting (1.1)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/hosting` | | `{ mode: desktop\|portable\|temp\|custom\|service\|server, service, host, port, lan, addresses[], stopAt, pin, you: { local }, board, platform, arch, node, dataDir }` |
| PUT | `/api/hosting/pin` | `{ pin: "4-32 chars" \| "", current? }` (`current` needed when a PIN is set) | `{ pin: bool }` + `Set-Cookie` for the caller; 403 wrong current PIN |
| POST | `/api/hosting/login` | `{ pin }` | `{ ok }` + `Set-Cookie: stltools_pin=...; HttpOnly; SameSite=Strict`; 403 wrong, 429 after 5 tries a minute |
| POST | `/api/hosting/logout` | | clears the cookie |

With a PIN set, requests from other machines without the cookie get 401 (`/api/*`) or the PIN page (everything else). Requests from 127.0.0.1 / ::1 always pass.

## Generate and download

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/api/generate/:id` | parameter values `{ tubeOD: 16, ... }` | `{ id, job, zip, params, parts: [{ name, url, filename, stats, assembled?, qty? }], warnings[], notes[] }` (`assembled`: 4x4 column-major matrix from the printed STL to its place in the assembly) |
| GET | `/api/stl/:job/:part.stl` | | binary STL (last 50 jobs kept in memory) |
| GET | `/api/zip/:job` | | ZIP of every part of a job |

`stats` = `{ size: [x, y, z], min, max, volumeMm3, areaMm2, flatAreaMm2, bedAreaMm2, triangles }`.

## Print estimates

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/printer-profiles` | | profiles, named printers first |
| POST | `/api/printer-profiles/import` | `{ format: ini\|orca, text, name, id?, base? }` | `{ profile, used[], skipped[] }` (201); stored in `<data>/printer-profiles.json`; shipped ids refused |
| DELETE | `/api/printer-profiles/:id` | | 204 (imported profiles only) |
| POST | `/api/estimate` | `{ stats: [stats...], profile?: "sovol-sv07", opts?: { layerHeight, walls, shellLayers, infill, material, timeFactor, filamentCostPerKg }, qty?: [n...] }` | `{ profile, seconds, heatUp, filamentMm, grams, cost, parts: [{ seconds, layers, grams, fit, breakdown }] }` |

Without `profile`, the default printer's model is used, else Settings > Print estimates.

## Settings

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/settings` | | all settings with defaults filled in |
| PUT | `/api/settings` | partial: `{ viewer: { shading: "edges" } }` | all settings; 400 with the field name if a value is out of range |
| GET | `/api/settings/schema` | | sections, fields, types, limits, labels |
| POST | `/api/settings/reset` | `{ section: "viewer" }` (omit for all) | all settings |

## STL library

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/library` | | `[{ id, name, filename, folder, tags[], notes, bytes, stats, thumbKey, thumb, createdAt, updatedAt }]` |
| PUT | `/api/library/upload?filename=a.stl&name=&folder=&tags=a,b` | raw STL bytes (max 100 MB) | the new entry (201) |
| GET | `/api/library/:id` | | one entry |
| PUT | `/api/library/:id` | `{ name?, folder?, tags?, notes? }` | updated entry |
| DELETE | `/api/library/:id` | | 204 |
| GET | `/api/library/:id.stl` | | the STL file |

## My Parts (v7)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/parts` | | `{ categories[], items: [{ id, category, name, detail, qty, ownership, ownershipKey, projects, dims, dimsSource, dimsFlag, printNeed, notes, presets[], edited }], seeds[] }` (`presets`: preset ids that fit the part) |
| POST | `/api/parts` | `{ id: "ABC01", name, category, ownership, dims, ... }` | new part (201) |
| GET / PUT / DELETE | `/api/parts/:id` | partial part | an edited part is never overwritten by a seed |
| POST | `/api/parts/import?overwrite=1` | components.json (`{ categories, items: [{ id, dims_mm, dims_source, print_need, ... }] }`) | `{ added, updated, kept, total }` |
| GET | `/api/parts/seeds` | | `[{ set, title, loaded }]` |
| POST | `/api/parts/seed` | `{ set: "example" }` | `{ parts: { added, updated, kept }, projects: { created, skipped } }` (safe to repeat) |

`dimsFlag`: `measure`, `conflict`, `unverified`, `standard`, `given`, `none`.
`ownershipKey`: `Owned`, `Confirm`, `Planned`.

## Collections (1.0)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET / POST | `/api/collections` | `{ name, color?: "#rrggbb", description?, items?: [{ kind, id }] }` | list (by name) / new collection |
| GET / PUT / DELETE | `/api/collections/:id` | partial collection | |
| POST | `/api/collections/:id/toggle` | `{ kind: preset\|design\|generator\|stl\|project, id }` | the collection (item added, or removed if it was there) |

## Designs, projects, favorites

| Method | Path | Body | Returns |
|---|---|---|---|
| GET / POST | `/api/designs` | `{ name, generator, params, section?, notes? }` | list / new design |
| GET / PUT / DELETE | `/api/designs/:id` | | |
| GET / POST | `/api/projects` | `{ name, description?, status?, tags?, items?, priority?: high\|medium\|low, components?: [{ id, qty }], filesMissing?: [], source? }` | list / new project |
| GET / PUT / DELETE | `/api/projects/:id` | full project | |
| POST | `/api/projects/:id/items` | `{ kind: preset\|design\|custom\|stl, ref?, generator?, params?, name?, qty?, place?: { x, y, z, rx, ry, rz } }` | project (`place`: position in the project's 3D assembly view, mm and degrees) |
| POST | `/api/projects/:id/build?unprinted=1` | | `{ zip, files, errors[], estimate, parts: [{ item, uid, name, file, url, filename, stats, qty, assembled?, estimate: { seconds, grams, filamentMm, layers, fits } }] }` |
| GET | `/api/projects/:id/export?stl=0` | | bundle `{ format: "stltools-project", version: 1, project, designs[], stls[] }` (STLs base64; `stl=0` leaves them out) |
| POST | `/api/projects/import` | a bundle (max 300 MB) | `{ project, warnings[] }` (201) |
| GET | `/api/favorites` | | `[{ kind, id }]` |
| POST | `/api/favorites/toggle` | `{ kind: preset\|design\|generator\|project\|stl, id }` | list |

## Shop catalog

| Method | Path | Body | Returns |
|---|---|---|---|
| GET / PUT | `/api/categories` | list of `{ code, name, color }` | |
| GET / POST | `/api/catalog` | `{ category, name, location?, presetId, overrides?, notes? }` | |
| GET / PUT / DELETE | `/api/catalog/:code` | | |
| POST | `/api/catalog/:code/generate` | | same as generate, with label text and card |

## Printers (view only)

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET / POST | `/api/printers` | `{ name, url, apiKey?, model? }` | list (API keys masked as `hasApiKey`; plus `machine`, `lastCheck`) / new printer |
| PUT / DELETE | `/api/printers/:id` | `{ name?, url?, apiKey?, model? }` (`apiKey: ""` removes it) | |
| POST | `/api/printers/probe` | `{ url, apiKey? }` | `{ url, klippyState, moonraker, hostname, model }` |
| POST | `/api/printers/diagnose` | `{ url, apiKey? }` or `{ id, url }` | `{ ok, steps: [{ step, ok, detail, fix? }], url, hostname, model }` |
| GET | `/api/printers/scan` | | `{ networks[], printers[] }` |
| GET | `/api/printers/:id/status` | | state, progress, layer, temperatures, times |
| GET | `/api/printers/:id/files`, `/history?limit=`, `/webcams` | | |
| GET | `/api/printers/:id/metadata?filename=` | | slicer metadata |
| GET | `/api/printers/:id/thumb?path=`, `/snapshot?cam=0` | | images |
| GET | `/api/printers/:id/webcams` | | `[{ index, name, service, stream, snapshot, flipH, flipV, rotation, fps, guessed }]` (`guessed`: found at the profile / Mainsail default path) |
| GET | `/api/printers/:id/stream?cam=0` | | live MJPEG (`multipart/x-mixed-replace`), piped from the printer; 415 if the camera is not MJPEG, 429 over 3 streams per printer |
| GET | `/api/printers/:id/machine` | | reads and saves `{ bed: {x,y,z}, maxVelocity, maxAccel, nozzle, filamentDiameter, kinematics, readAt }` from Klipper (read-only query) |
| GET | `/api/printers/:id/health` | | `{ checks: [{ level: ok\|info\|warn, title, detail }], facts }` from read-only Klipper / Moonraker queries |
| GET | `/api/printers/:id/mesh` | | `{ loaded, min, max, probed, profiles: { name: { points[][], params } } }` |
| GET | `/api/printers/:id/logs[?file=klippy.log]` | | log list, or `{ path, bytes, truncated, text }` (last 400 KB, secrets hidden) |
| POST | `/api/split` | `{ job, parts?, qty?: { part: n }, library?, profile?, joint: pins\|filament\|none, pinDiameter, pinLength, clearance, spacing, margin }` | `{ zip, pieces[], plates: [{ name, url, items, estimate }], cuts, pins, readme }` |
| GET / POST | `/api/materials` | material | datasheet + your materials / new material (201) |
| PUT / DELETE | `/api/materials/:id` | partial material | your copy / 204 (datasheet entries cannot be deleted) |
| GET | `/api/printers/:id/config` | | config files `[{ path, size, modified }]` (printer.cfg first) |
| GET | `/api/printers/:id/config?file=printer.cfg` | | `{ path, text, bytes }`, secrets hidden; 400 for paths outside the config folder or other file types |
| GET / PUT | `/api/printers/:id/control` | `{ enabled: true, acknowledge: true }` or `{ enabled: false }` | `{ enabled, actions[] }` / the printer; 400 without `acknowledge` |
| POST | `/api/printers/:id/control/:action` | `pause`, `resume`, `cancel`, `estop`, `firmware_restart`, `restart`; `start` `{ filename }`; `gcode` `{ script }`; `service` `{ service: crowsnest\|klipper\|moonraker-timelapse }` | `{ ok, action, result }`; 403 control off, 409 wrong printer state, 400 bad input |
| GET | `/api/printers/:id/control/log?limit=` | | control log entries, newest first |
| GET | `/api/printers/:id/events` | | server-sent events: `status` `{ status }`, `console` `{ line, at }`, `mode` `{ live }` (websocket or 1 s polling); read-only |
| GET | `/api/checklists` | | checklist templates `[{ id, name, printerModels, items[], header }]` |
| GET | `/api/printers/:id/gcodecheck?file=&checklist=` | | `{ file, checks: [{ ok, title, detail }], found, checklist }` (reads the start and end of the file, read-only) |
| GET / POST | `/api/printers/:id/checklists` | `{ file, checklist, done[], notes, headerOk }` | print log for this printer (newest first) / new entry (201) |
| PUT | `/api/printers/:id/upload?filename=&path=&print=1&confirm=1` | raw G-code | `{ path, size, printStarted }` (control on only) |
| POST | `/api/printers/check` | | `{ <id>: { ok, at, klippy? \| error } }`: read-only connection check of every printer now (also in `GET /api/printers` as `lastCheck`) |
| PUT | `/api/printers/:id/upload?filename=x.gcode&path=folder` | raw G-code | `{ path }`; always `print=false` |

Any other method on a printer sub-route returns 405 "Read-only". Control routes are the only POSTs that reach the printer, and only with control on.

## Data

| Method | Path | Returns |
|---|---|---|
| GET | `/api/backup` | settings, designs, projects, catalog, categories, favorites, printers (no keys), library index (no STL bytes) |
| POST / PUT / GET / DELETE | `/api/thumbs/lookup`, `/api/thumbs/:key`, `/api/thumbs/:key.png`, `/api/thumbs` | preview cache |
