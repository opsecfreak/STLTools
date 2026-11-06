# Extending STL Tools without breaking it

> See also: [Generators](../src/generators/README.md) | [Presets](../presets/README.md) | [custom/](../custom/README.md) | [Contributing](../CONTRIBUTING.md) | [All docs](README.md)

The project is built so new parts can be added without touching existing ones.

## What loads automatically

| Thing | Where | Loaded how |
|---|---|---|
| Generators (part types) | `src/generators/*.js` | Every exported `{ id, params, generate }` object is registered at startup. No list to edit. |
| Presets (ready-made designs) | `presets/*.json` | Every file, in name order. `section` picks the tab. |
| Your generators | `custom/generators/*.js` (or `$STLTOOLS_CUSTOM/generators`) | Same as core. A broken file is skipped and reported. |
| Your presets | `custom/presets/*.json` (or `$STLTOOLS_CUSTOM/presets`) | Same as core. A bad preset is skipped and reported. |

The desktop app sets `$STLTOOLS_CUSTOM` to your user data folder, so your own files survive upgrades. Problems with custom files show as a red badge at the bottom of the web page and in `GET /api/version`.

## Safety rails

1. **Contract tests** (`test/contract.test.js`): every generator needs a valid id, name, description, known tabs, and parameters whose defaults validate. Every preset must point at a real generator and tab.
2. **Mesh tests** (`test/v3.test.js`, `test/generators.test.js`): every preset and every option of every select parameter is generated and checked for open edges, edges that break after STL rounding, positive volume, and sitting on the bed.
3. **Node 18-22**: CI runs the tests on Node 18, 20 and 22 (Raspberry Pi OS ships 18).
4. **No id clashes**: a custom generator or preset cannot replace a built-in id.
5. **Renamed parameters**: give the generator a `migrate(input)` function that maps old names to new ones (see `rc-wing.js`: `halfSpan` to `wingspan`). Saved designs, shop items, presets and old `.params.json` files keep working.

## Rules for a change that stays compatible

- Add parameters; do not remove or rename them without `migrate()`.
- New parameters need a default that reproduces the old shape.
- Do not change a preset `id` that may be used by shop items or saved designs; add a new preset instead.
- Keep data formats additive: `data/catalog.json`, `data/designs.json`, `data/categories.json`.

## Workflow

1. Create the generator in `src/generators/` (core) or `custom/generators/` (yours). Start from `custom/generators/_example-bracket.js`.
2. Add presets in `presets/` or `custom/presets/`.
3. Run the tests.

```bash
npm test
```

4. Start the app and check the part in the 3D view.

```bash
npm start
```

5. Bump the version in `package.json`, add a `CHANGELOG.md` entry (changed / fixed / untested).
6. Release: merge the PR into `main`. When `package.json` has a version with no release yet, GitHub Actions tests, builds every package, creates the tag and publishes the release. To rebuild a release: Actions > Release > Run workflow.

Details on the kernel, helpers and printability rules: [`src/generators/README.md`](../src/generators/README.md).
