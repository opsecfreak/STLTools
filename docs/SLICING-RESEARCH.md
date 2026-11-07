# Slicing research: Sovol SV07 (2026-11-06)

Question: Sovol is said to use its own slicer. What is it, how does Muse slice for the shop SV07 today, and which way should STL Tools go (roadmap 1.4)? Status: research only. Nothing is built yet ("hold off", Alex 2026-11-06).

> See also: [ROADMAP-MTS.md](ROADMAP-MTS.md) | [PRINTERS.md](PRINTERS.md) | [PRINTER-PROFILES.md](PRINTER-PROFILES.md)

## 1. What "Sovol's slicer" is

| Finding | Source | Confidence |
|---|---|---|
| Sovol's download page has a "Sovol Slicer Software" heading; the entries under it are OrcaSlicer and OrcaSlicer profiles, not a separate app | [sovol3d.com/pages/download](https://sovol3d.com/pages/download) (search result summary) | medium: page not opened directly |
| Sovol's wiki points to OrcaSlicer and to a Sovol GitHub repo with profiles and documents | [wiki.sovol3d.com/en/Orca](https://wiki.sovol3d.com/en/Orca) (search result summary) | medium |
| Sovol's repo `Sovol3d/Sovol-OrcaSlicer` has folders `Document`, `OrcaSlicer`, `Profiles`; no releases, no license shown, no README text | [github.com/Sovol3d/Sovol-OrcaSlicer](https://github.com/Sovol3d/Sovol-OrcaSlicer) | high (repo page read) |
| OrcaSlicer itself ships Sovol SV07 profiles: `Sovol SV07.json`, `Sovol SV07 0.4 nozzle.json` (and SV07 Plus) | [OrcaSlicer resources/profiles/Sovol/machine](https://github.com/SoftFever/OrcaSlicer/tree/main/resources/profiles/Sovol/machine) | high (files read) |
| A Sovol forum thread says Sovol's Orca profiles had bugs and a user forked them to fix them; the profiles on Sovol's GitHub, in OrcaSlicer, and on the printer's USB stick differ | [forum.sovol3d.com/t/orca-slicer-profiles/7833](https://forum.sovol3d.com/t/orca-slicer-profiles/7833) (search summary; the forum is blocked from this session) | medium |
| No standalone, closed-source "Sovol Slicer" application was found | searches above | medium: absence of evidence; check the USB stick that came with the printer |

Conclusion: in practice, Sovol's slicer is **OrcaSlicer with Sovol profiles** (OrcaSlicer is open source, AGPL-3.0). If the USB stick has an installer named "Sovol Slicer", it is most likely an OrcaSlicer build with Sovol's profiles preloaded (unverified: check its About box).

### What the stock OrcaSlicer SV07 profile says (`Sovol SV07 0.4 nozzle.json`)

| Setting | Stock Orca SV07 | Shop preset sv07-alex-v3 | Note |
|---|---|---|---|
| Bed / height | 220 x 220 / 250 | 220 x 220 / 250 | same |
| Machine max speed X/Y | 500 mm/s | job cap 200, printer max_velocity 225 | stock is the marketing peak; the shop printer's live limit is 225 |
| Machine max accel X/Y | 12000 | job cap 2000, printer max_accel 4500 | stock values exceed this printer's config |
| Retraction | 0.8 mm @ 50 mm/s, z-hop 0.4 | 0.6 mm @ 40, z-hop 0.6 | shop values proven |
| Max layer height | 0.32 | 0.2 / first 0.3 | |
| Start G-code | G28, heat bed and nozzle and wait, its own purge lines, no START_PRINT | job caps, heat first, G28, wait, START_PRINT (loads bed mesh), SET_PRINT_STATS_INFO | stock start G-code does not load the bed mesh through START_PRINT |
| End G-code | END_PRINT | END_PRINT + restore live caps 225/4500/2000/3 | |
| Before layer change | `TIMELAPSE_TAKE_FRAME` | none | needs the moonraker-timelapse macro on the printer |

Takeaway: the stock profile is a fine base but its speed and acceleration values are too high for this printer, and its start G-code skips the shop's START_PRINT flow. The shop's v3 preset stays the reference.

## 2. How Muse slices today (from SV07-GUIDELINES.md §10)

1. PrusaSlicer 2.8.1 headless, from an extracted AppImage: `prusa-slicer --export-gcode --load <ini> -o <out.gcode> <model.stl>`.
2. Settings start as Orca / Sovol presets, flattened by `sovol-orca/flatten_presets.py`, converted by `sv07_prusa.py` into one flat PrusaSlicer `.ini` (PrusaSlicer `--load` ignores `[sections]`).
3. Upload to Moonraker with `print=false`, read the file back, start only on Alex's word.

Known problems recorded there:
- `sv07_prusa.py` turns Orca's `"0"` into supports ON (`support_material` truthiness bug).
- After a VM redeploy, PrusaSlicer fails on missing `libwebkit2gtk-4.1.so.0`.
- `slice_retry.py` changes the master ini in place.
- Headless PrusaSlicer cannot easily place support enforcers / blockers (the trunnion-only support question).
- Each conversion step (Orca to flat ini) can drop or misread keys; the v3 test slice reported zero dropped keys, but every new key is a new risk.

## 3. Options for STL Tools (roadmap 1.4)

| Option | Fidelity | Runs on | Effort | Risks |
|---|---|---|---|---|
| A. STL Tools' own layer preview (no G-code) | outlines, walls, infill pattern, overhangs, first-layer area, per-layer time estimate | anywhere (browser) | medium | not a real slicer: no exact toolpaths, cannot print from it |
| B. OrcaSlicer CLI on the PC that runs STL Tools (the slicer Sovol uses) | real G-code, Sovol's own profile format (JSON), no conversion step | Windows, macOS, Linux x64 desktops (OrcaSlicer builds); not the Pi (no official ARM Linux build found: unverified) | medium-high | CLI flags differ between Orca versions (`--slice`, `--load-settings`, `--load-filaments`, `--export-3mf`; G-code per plate); must match the installed version ([Orca CLI wiki](https://www.orcaslicer.com/wiki/cli/cli_actions)) |
| C. PrusaSlicer CLI (Muse's way) | real G-code | desktop | medium | needs the Orca-to-ini conversion and its known bugs; on hold by Alex |
| D. Send STLs to a slicing server on another machine (e.g. MTS-SERVER1) | as B or C | any client | high | more moving parts; network and security |

Recommendation:
1. **Now (1.4):** build A (own preview) for every printer, plus a **G-code viewer** for files on the printer, so sliced files (from Orca on the PC or from Muse) can be checked before printing.
2. **Next (1.4.x), opt-in:** B. If OrcaSlicer is installed on the PC, STL Tools can call it with the shop's settings written as Orca JSON (machine / process / filament), generated from the v3 values kept in the data folder (not git). Output G-code goes through the same review page and upload with `print=false`. This replaces Muse's PrusaSlicer conversion chain and its known bugs. Needs Alex's word before building.
3. Keep `sv07-alex-v3.ini` in the data folder as the single source of the shop's values; STL Tools reads it to build Orca JSON and its own estimate profile.

## 4. Open checks (need the printer or the PC)

- The USB stick that came with the SV07: name and version of any slicer installer on it (Orca build or other).
- The installed OrcaSlicer version on the PC, and its `--help` output (CLI flags).
- Whether `TIMELAPSE_TAKE_FRAME` exists on the shop printer (stock Orca profile calls it before every layer).
