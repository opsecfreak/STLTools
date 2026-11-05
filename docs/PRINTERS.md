# Printer and slicer plan (not built yet)

Status: plan only. STL Tools stops at the STL file today. This page records the plan so it can be built later without starting over.

## Goal

From the web UI: pick a design, press **Print**, and the Pi slices it and sends it to the printer.

## Target printer

- Sovol SV07 class printers run Klipper. Klipper printers expose the Moonraker API, which Mainsail and Fluidd use. (Unverified for your exact unit: check that Mainsail or Fluidd opens on the printer's IP address.)

## Steps

1. **Slicer on the Pi.** Install a command-line slicer (PrusaSlicer, OrcaSlicer or CuraEngine) that runs on 64-bit Raspberry Pi OS. Check which one has a working ARM64 build before choosing. Slicing large parts on a Pi 4 can take minutes.
2. **Printer profile.** Export the working printer, filament and print profiles from your desktop slicer. Store them in `data/profiles/` (versioned like presets).
3. **Slice endpoint.** `POST /api/slice/:job` runs the slicer on the job's STL files with the chosen profile, writes G-code to `data/gcode/`, and returns print time and filament use from the G-code header.
4. **Send endpoint.** Upload the G-code to Moonraker (`POST http://<printer>/server/files/upload`), optionally start it (`POST /printer/print/start?filename=...`). Printer address and any API key go in environment variables on the Pi, never in code.
5. **UI.** A Print button next to Download, a printer status line (Moonraker `GET /printer/objects/query?print_stats`), and a confirm step before a print starts.

## Open questions

- Which slicer and version for the Pi.
- One printer or several (one Moonraker address per printer).
- Start prints automatically, or upload only and start from Mainsail.
