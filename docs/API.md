# HTTP API reference

Base URL: `http://127.0.0.1:3000` (or the LAN address with `--lan`). JSON in and
out unless noted. JSON over 32 KB is gzipped when the client sends `Accept-Encoding: gzip`. Errors: `{ "error": "message" }` with HTTP 400 (bad input),
404 (unknown id), 405 (wrong method), 413 (too large), 422 (generation failed),
502 (printer did not answer). Routes live in `route()` in `src/server.js`.

## App

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/version` | | `{ name, version, node, platform, arch, generators, presets, profiles, dataDir, issues[] }` |
| GET | `/api/generators` | | `[{ id, name, description, sections[], params{}, basic[], assembly }]` (`basic`: settings shown in Simple mode) |
| GET | `/api/presets` | | `[{ id, name, generator, section, group, description, tags[], params{}, verify[]? }]` |
| GET | `/shared/estimate.js` | | the estimator ES module (same file the server uses) |

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
| GET / POST | `/api/printers` | `{ name, url, apiKey?, model? }` | list (API keys masked as `hasApiKey`) / new printer |
| PUT / DELETE | `/api/printers/:id` | `{ name?, url?, apiKey?, model? }` (`apiKey: ""` removes it) | |
| POST | `/api/printers/probe` | `{ url, apiKey? }` | `{ url, klippyState, moonraker, hostname, model }` |
| POST | `/api/printers/diagnose` | `{ url, apiKey? }` or `{ id, url }` | `{ ok, steps: [{ step, ok, detail, fix? }], url, hostname, model }` |
| GET | `/api/printers/scan` | | `{ networks[], printers[] }` |
| GET | `/api/printers/:id/status` | | state, progress, layer, temperatures, times |
| GET | `/api/printers/:id/files`, `/history?limit=`, `/webcams` | | |
| GET | `/api/printers/:id/metadata?filename=` | | slicer metadata |
| GET | `/api/printers/:id/thumb?path=`, `/snapshot?cam=0` | | images |
| PUT | `/api/printers/:id/upload?filename=x.gcode&path=folder` | raw G-code | `{ path }`; always `print=false` |

Any other method on a printer sub-route returns 405 "Read-only".

## Data

| Method | Path | Returns |
|---|---|---|
| GET | `/api/backup` | settings, designs, projects, catalog, categories, favorites, printers (no keys), library index (no STL bytes) |
| POST / PUT / GET / DELETE | `/api/thumbs/lookup`, `/api/thumbs/:key`, `/api/thumbs/:key.png`, `/api/thumbs` | preview cache |
