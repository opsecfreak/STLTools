# scripts: build, check and capture

Developer tools. None of them run inside the app.

> See also: [Extending and release steps](../docs/EXTENDING.md) | [Tests](../test/README.md) | [All docs](../docs/README.md)

| Script | What it does | Run |
|---|---|---|
| `package.mjs` | Builds the release packages into `dist/`: Windows, macOS (Apple / Intel), Linux x64, Raspberry Pi ARM64 / ARMv7, any-OS, each with Node.js | `node scripts/package.mjs` |
| `check-packages.mjs` | Checks the packages in `dist/` without running them: bundled Node.js matches the OS and CPU, start scripts present and executable, CRLF in Windows scripts, SHA256SUMS.txt matches, no personal data folder | `node scripts/check-packages.mjs` |
| `ui-smoke.mjs` | Browser smoke test with Chromium and a fake printer: every page, designer, views, pick row, layer preview, Stress Lab, printers (live, console, checklist, G-code viewer, control), Browse families, Home customize, project filament, profile import, no-WebGL fallback | `node scripts/ui-smoke.mjs` |
| `screenshots.mjs` | Captures the README screenshots into `docs/screenshots/` | `node scripts/screenshots.mjs` |
| `build-series.mjs` | Builds and checks the size-series presets (`presets/50-series-*.json`) | `node scripts/build-series.mjs` |
| `test-pi-install.sh` | Tests the Raspberry Pi installer without touching a real service | `sudo bash scripts/test-pi-install.sh` |

Releases: the GitHub workflow `.github/workflows/release.yml` runs the tests, `package.mjs` and `npm pack`, then publishes the files. On `mts-personal` it runs by hand (Actions > Release > Run workflow) and publishes a pre-release.
