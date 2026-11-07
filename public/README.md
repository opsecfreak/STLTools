# public: the browser app

Plain ES modules, no build step. three.js (vendored) for 3D. The server serves this folder as is; `/shared/` serves shared engine files from `src/core` (estimates, Stress Lab engines).

> See also: [Architecture](../docs/ARCHITECTURE.md) | [User guide](../docs/USER-GUIDE.md) | [Engine](../src/core/README.md) | [All docs](../docs/README.md)

| File | Page or part of the UI |
|---|---|
| `index.html`, `style.css` | Page shell, tabs, theme (light / dark) |
| `app.js` | Router and the designer: pick row ("Make:"), presets, parameter form (Simple / Standard / Expert), generate, downloads, Split / Layers / Stress test buttons |
| `lib.js` | Shared helpers: `el()`, `api()`, settings cache, toasts, formatting, units |
| `viewer.js` | 3D view of parts and STLs (assembled or print plate, copies of parts, bed outline) |
| `viewtools.js` | View buttons, cut slider, and the print estimate box |
| `home.js` | Home (customizable), search, cards, favorites, projects (filament per project, 3D assembly) |
| `browse.js` | Browse with facets, Families view (nested by size), collections |
| `search.js` | Global search in the header (`/`) |
| `files.js` | Import page (STL, project and design files, G-code viewer), STL Files library |
| `parts.js` | My Parts |
| `settings.js` | Settings page (search, printers manager, profile import, Home page) |
| `printers.js` | Printers page: live status and console (server-sent events), webcam, files (View in the G-code viewer), pre-print checklist, upload, opt-in control, printer details |
| `layerview.js` | Layer viewer window: layer preview of a part and the G-code viewer (2D layer, 3D stack, time chart) |
| `gcode-parse.js` | G-code parser (browser and Node): moves, arcs, feature comments, layers, times |
| `split.js` | Split / arrange panel |
| `lab.js`, `lab-worker.js` | Stress Lab page and its solver thread |
| `thumbs.js` | Card thumbnails (rendered once, cached on the server) |
| `labels.html`, `labels.js` | Printable paper labels |

Rules: no inline secrets, no external network calls (everything comes from the local server), every page must open without a script error (`scripts/ui-smoke.mjs`).
