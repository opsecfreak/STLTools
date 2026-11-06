# Printers (Sovol SV07, Klipper, Mainsail)

The **Printers** tab shows Klipper printers on your network. It talks to Moonraker, the API that Mainsail and Fluidd use. The Sovol SV07 runs Klipper, so it works the same way.

## View only, by design

| STL Tools can | STL Tools cannot (no code for it) |
|---|---|
| Show state: idle, printing, paused, complete, error | Start, pause, resume or cancel a print |
| Show progress, layer, print time, time left (slicer estimate), filament used | Send G-code or macros |
| Show nozzle and bed temperature and target | Set temperatures, move axes, home |
| List G-code files with thumbnails, print time, filament, layer height | Delete, move or rename files |
| Show print history | Restart Klipper / Moonraker / firmware, emergency stop |
| Show webcam snapshots (every 5 seconds) | Change printer or Moonraker settings |
| Upload G-code files (`print=false` is always sent, so a print never starts) | |

Every printer request goes through a fixed list of read-only Moonraker endpoints on the STL Tools server. There is no pass-through. The tests run a fake printer and fail if any control endpoint is called. Start prints from Mainsail or the printer screen.

## Add your SV07

1. Find the printer's IP address: printer touchscreen > Settings > Network (or Wi-Fi), or your router's device list.
2. Check it in a browser: `http://<printer-ip>` should open Mainsail (or Fluidd).
3. In STL Tools open **Printers** > **Add a printer**.
4. Enter a name (for example `SV07`) and the address (for example `192.168.1.50`).
5. Press **Add printer**. STL Tools checks the printer first and shows the Moonraker and Klipper state.

Or press **Scan my network**. It looks for Moonraker on the server's own local network (ports 80 and 7125, read-only `/server/info` requests), then press **Use** on a result.

Note: STL Tools runs on your PC or Pi, and that machine talks to the printer. Both must be on the same network (or the same Tailscale network). Only local addresses are accepted.

## Upload G-code

1. Slice the STL in your slicer (OrcaSlicer, Sovol slicer, PrusaSlicer, Cura) with your SV07 profile.
2. In **Printers**, drop the `.gcode` file on **Upload G-code** (or press **choose files**).
3. The file goes to the `stltools` folder on the printer (change the folder name if you want).
4. Start the print from Mainsail or the printer screen when you are ready.

STL files are refused on purpose: the printer can only print G-code. Slicing on the server is not built.

## Troubleshooting

| Problem | Fix |
|---|---|
| "did not answer in time" | Printer off or on another network. Open `http://<printer-ip>` in a browser from the same computer. |
| HTTP 404 on port 80 | Some printers serve the web UI on another port (for example `:4408`). Use the same address you use for Mainsail, or try `<printer-ip>:7125` (Moonraker directly). |
| "refused the request (needs an API key...)" | Moonraker only allows trusted clients. Add the STL Tools computer's network to `trusted_clients` in `moonraker.conf` (`[authorization]` section), or create an API key in Mainsail (Settings > Remote Printers / API) and enter it when adding the printer. The key is stored only on the STL Tools server and is never sent to browsers. |
| No webcam | The webcam must be configured in Mainsail. Snapshots use the printer's web server (port 80, or the port you entered). |
| Thumbnails missing | Turn on thumbnails in your slicer's printer profile (G-code thumbnails, for example 300x300 PNG). |

## What is stored

`<data folder>/printers.json`: name, address and the optional API key. Remove a printer in the Printers tab; nothing on the printer changes.

## Not built yet

- Slicing on the server, then sending the G-code to the printer.
- Live push updates (the page polls every 3 seconds, every 15 seconds when the tab is hidden).
