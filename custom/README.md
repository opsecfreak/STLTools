# Your custom generators and presets

STL Tools loads extra generators and presets from this folder. Files here are
yours: app updates never overwrite them (the desktop app keeps this folder in
your user data folder, not in the app folder).

```
custom/
  generators/   your own part generators (.js)
  presets/      your own presets (.json)
```

## Add a preset (no code)

1. In the web UI, load the closest preset and change values until it looks right.
2. Press **Export**. You get a `.params.json` file with every value.
3. Create `presets/my-presets.json` here, using `presets/_example-presets.json` as the template.
4. Copy only the values you changed into `params`.
5. Restart STL Tools. Your preset appears in the tab named by `section`.

Faster option: press **Save design** in the web UI. Saved designs are stored on
the server and listed under **My Designs**, with no files to edit.

## Add a generator (JavaScript)

1. Copy `generators/_example-bracket.js` to `generators/my-part.js` (no leading underscore).
2. Change `id`, `name`, `sections`, `params` and `generate`.
3. Restart STL Tools.

Rules that keep it safe:
- A custom file with an error is skipped and listed at the bottom of the web page. The rest of the app keeps working.
- A custom generator or preset cannot replace a built-in one with the same `id`; use a new id.
- Files whose names start with `_` are ignored (templates).
- Keep the `package.json` in this folder (it marks the files as JavaScript modules). Or name generator files `.mjs`.

The kernel functions, helpers and printability rules are in
`src/generators/README.md` in the app folder.
