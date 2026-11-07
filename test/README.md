# test: test suites

`npm test` runs every `*.test.js` here with Node's built-in test runner. CI runs them on Node 18, 20 and 22 on Linux, and with Node 22 on Windows, macOS and Linux ARM64; the browser smoke test (`scripts/ui-smoke.mjs`) runs on Linux and Windows.

> See also: [Scripts](../scripts/README.md) | [Testing a release](../docs/TESTING.md) | [All docs](../docs/README.md)

| File | Covers |
|---|---|
| `generators.test.js` | Every generator with defaults and every preset: watertight, no STL rounding issues, positive volume, on the bed |
| `contract.test.js` | Rules every generator and preset must follow (custom ones too) |
| `catalog.test.js`, `server.test.js` | Shop catalog, HTTP API basics |
| `printers.test.js` | Moonraker client: read-only calls only, connection test, webcam |
| `v3` to `v8` | Generators by tab, settings and estimates, STL library, project export / import, My Parts, assemblies, end-to-end generation and export |
| `v10.test.js` | Collections, tooltips, 1.0 generators, license files |
| `v11.test.js` | Self-hosting, access PIN, optional printers, background checks, estimates from the printer |
| `v12.test.js` | Opt-in printer control: off by default, refusals logged, state guards, upload-and-print only with confirm; materials data sources; bed mesh and logs |
| `v13.test.js` | Stress Lab engines against textbook results (cantilever, failure across layers, weak points, panel method, environment) |
| `v14.test.js` | Splitter and plate arranger |
| `v15.test.js` | Profile import, pre-print checklist and G-code header check, live updates (websocket or polling) |
| `v16.test.js` | Layer preview, G-code parser, printer G-code file route |
| `v17.test.js` | Modular quad frame, board holder, camera case, antenna holder, their presets |
| `v18.test.js` | Filament per project, estimates by filament, Home page settings |

`helpers/mock-moonraker.js` is a fake Klipper printer (HTTP and a small websocket) that answers like Moonraker: status, files with Range requests, thumbnails, webcam MJPEG, config, logs, bed mesh, history, and control calls. Tests and the UI smoke test use it, so no real printer is needed. It records every request, so tests can prove that read-only features never send a control call.

Run one file: `node --test test/v17.test.js`. Run every preset (slow): `STLTOOLS_FULL_PRESET_TEST=1 npm test`.
