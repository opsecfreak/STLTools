# Contributing

> See also: [AGENTS.md](AGENTS.md) | [Extending safely](docs/EXTENDING.md) | [Security](SECURITY.md) | [All docs](docs/README.md)

Thanks for helping. STL Tools is a small Node.js app with no build step, so
most contributions are one file plus a test run.

## Before you start

1. Read [AGENTS.md](AGENTS.md): commands, the hard rules and the code map.
2. Install Node.js 18 or newer, then run these from the repository folder:

```bash
npm install
```

```bash
npm test
```

## What to contribute

| You want to add | Where | Guide |
|---|---|---|
| A new part type (generator) | `src/generators/<name>.js` | [src/generators/README.md](src/generators/README.md) |
| Ready-made sizes of an existing part | a file in `presets/`, or a size series in `scripts/build-series.mjs` | [presets/README.md](presets/README.md) |
| Your printer's bed size and speeds | `printer-profiles/<maker>-<model>.json` | [docs/PRINTER-PROFILES.md](docs/PRINTER-PROFILES.md) |
| An API route or UI page | `src/server.js`, `public/` | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/API.md](docs/API.md) |

## Rules that keep it working

- Every STL must be watertight and sit on z = 0 in print orientation. The tests check every generator option.
- Never invent sizes for a real product. Use a published standard or datasheet (and say which), mark datasheet values with `verify`, and leave unknown sizes in `measure`.
- Printers stay view only: no start, stop, G-code or settings calls.
- No secrets, API keys or personal data in code, presets or docs.
- Keep text plain and short. No em dashes.

## Pull requests

1. Fork the repository and create a branch.
2. Make the change and run `npm test` (Node 18 and 22 if you can).
3. For UI changes, open the app and check the page for console errors.
4. Add a CHANGELOG line under the next version.
5. Open a pull request. CI runs the tests on Node 18, 20 and 22.

By contributing you agree that your contribution is licensed under the
Apache License 2.0 ([LICENSE](LICENSE)).
