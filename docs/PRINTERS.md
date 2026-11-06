# Printers (Sovol SV07, Klipper, Mainsail)

The **Printers** tab shows Klipper printers on your network. It talks to Moonraker, the API that Mainsail and Fluidd use. The Sovol SV07 runs Klipper, so it works the same way.

Printers are optional. With none, everything else works and estimates use a printer profile. With one, you also get its status and live webcam, and estimates based on that printer's own limits.

> See also: [Printer profiles and estimates](PRINTER-PROFILES.md) | [Self-hosting](SELF-HOSTING.md#printers-are-optional) | [Raspberry Pi setup](RASPBERRY-PI.md#5-set-it-up) | [Troubleshooting](TROUBLESHOOTING.md#printers-and-webcam) | [All docs](README.md)

## View only, by design

| STL Tools can | STL Tools cannot (no code for it) |
|---|---|
| Show state: idle, printing, paused, complete, error | Start, pause, resume or cancel a print |
| Show progress, layer, print time, time left (slicer estimate), filament used | Send G-code or macros |
| Show nozzle and bed temperature and target | Set temperatures, move axes, home |
| List G-code files with thumbnails, print time, filament, layer height | Delete, move or rename files |
| Show print history | Restart Klipper / Moonraker / firmware, emergency stop |
| Show the webcam: live MJPEG video or snapshots | Change printer or Moonraker settings |
| Read the printer's limits (bed, max speed, acceleration, nozzle) for estimates | |
| Upload G-code files (`print=false` is always sent, so a print never starts) | |

Every printer request goes through a fixed list of read-only Moonraker endpoints on the STL Tools server. There is no pass-through. The tests run a fake printer and fail if any control endpoint is called. Start prints from Mainsail or the printer screen.

## Add your SV07

1. Find the printer's IP address: printer touchscreen > Settings > Network (or Wi-Fi), or your router's device list.
2. Check it in a browser: `http://<printer-ip>` should open Mainsail (or Fluidd).
3. In STL Tools open **Settings** > **Printers** (or press the gear at the top right).
4. Enter a name (for example `SV07`) and the address (for example `192.168.1.50`). Keep Model = **Sovol SV07**.
5. Press **Test connection**. Each check shows OK or FAIL with the fix:

   | Step | What it reads | If it fails |
   |---|---|---|
   | Address | nothing (checks it is a LAN address) | use the IP from the printer screen |
   | Moonraker answers | `GET /server/info` | try `<ip>:7125`; "refused" means trusted_clients or an API key |
   | Printer info | `GET /printer/info` | Klipper stopped: fix it in Mainsail |
   | Status query | `GET /printer/objects/query` | Klipper not ready |
   | File list | `GET /server/files/list` | Moonraker file manager missing |
   | Upload folder | `GET /server/files/roots` | gcodes folder not writable |
   | Printer limits (for estimates) | `GET /printer/objects/query?toolhead&configfile=settings` | optional: estimates then use the profile only |
   | Webcam | `GET /server/webcams/list`, else the Mainsail default path | optional |

6. Press **Add printer**. The first printer becomes the default: its status shows in the header and its profile is used for print time estimates.

Or press **Scan my network**. It looks for Moonraker on the server's own local network (ports 80 and 7125, read-only `/server/info` requests), then press **Use** on a result.

Saved printers can be edited, re-tested or removed in Settings > Printers. The API key field is write-only: a saved key is never shown again.

Note: STL Tools runs on your PC or Pi, and that machine talks to the printer. Both must be on the same network (or the same Tailscale network). Only local addresses are accepted.

## Printer features on or off

Settings > Printers > **Printer features**: *Show when a printer is saved* (default), *Always show*, or *Off*. Off hides the Printers page, the header status chip and the printer tile on Home, and stops background checks. Your saved printers stay.

## Connection checks

Settings > Printers > **Background connection check** (default every 5 minutes; 0 = off). The server asks each saved printer `GET /server/info` (read-only) and remembers the answer. Settings > Printers shows "Connected 2 min ago (Klipper ready)" or the error under each printer; **Check connections now** runs it at once. A printer that answers for the first time also has its limits read (next section).

## Estimates from your actual printer

When a printer is saved, STL Tools reads its own Klipper values once (read-only `GET /printer/objects/query?toolhead&configfile=settings`):

| Value | From Klipper | Used for |
|---|---|---|
| Bed / build size | `toolhead.axis_minimum` to `axis_maximum` (negative minimums count from 0) | the bed outline in the 3D view, the "fits the bed" check |
| Max speed | `toolhead.max_velocity` | caps every print speed of the profile |
| Acceleration | `toolhead.max_accel` | scales the profile's motion efficiency (corners, short moves) |
| Nozzle, filament | `configfile.settings.extruder.nozzle_diameter`, `filament_diameter` | line width, filament length |

The estimate box then offers "SV07 (own limits)", and the default printer is used for project ZIP estimates too. The profile (Settings > Printers > Model) still gives the slicer-like speeds; the printer's values only replace what Klipper knows. Turn it off with Settings > Printers > **Estimates use the printer's own Klipper limits**. Read them again with **Read limits** (for example after you change `printer.cfg`).

Saved in `printers.json` as `machine` (bed, maxVelocity, maxAccel, nozzle, filamentDiameter, kinematics, readAt).

## Webcam: live video and snapshots

The Printers page shows the printer's camera. Settings > Printers > **Webcam**: *Live video (MJPEG stream)* (default), *Snapshots* (every 3 s, Settings > Printers > Snapshot refresh), or *Off*.

How STL Tools finds the camera (the same one Mainsail shows):

1. `GET /server/webcams/list` on Moonraker. Mainsail and Fluidd save their webcam settings there (Mainsail: Settings > Webcams), including the stream and snapshot URLs, the service type, flip and rotation.
2. If that list is empty, the printer profile's webcam paths. For the Sovol SV07 profile these are the Mainsail defaults `/webcam/?action=stream` and `/webcam/?action=snapshot` on the printer's web port (80), served by crowsnest / mjpg-streamer. STL Tools tries the snapshot first and only shows the camera if it answers. Marked "found at the Mainsail default path". These paths are not checked on a real SV07 yet (unverified).
3. Generic Klipper printers get the same Mainsail defaults.

| Camera service in Mainsail | What STL Tools shows |
|---|---|
| MJPEG-Streamer (`mjpegstreamer`), `uv4l-mjpeg`, or none set | live video (proxied MJPEG) + snapshots |
| Adaptive MJPEG, WebRTC (camera-streamer, go2rtc, MediaMTX, Janus), HLS, iframe | snapshots, plus a link to open Mainsail for the video |

How the video gets to your browser: the browser asks STL Tools (`GET /api/printers/<id>/stream`), STL Tools opens the camera's stream URL on the printer and passes the MJPEG frames through. So a phone that can reach STL Tools sees the camera even if it cannot reach the printer directly, and the PIN protects the camera too. The connection to the camera closes when you leave the Printers page or close the tab; at most 3 streams per printer are open at a time. Only cameras on local addresses are allowed.

If video does not start, the page falls back to snapshots by itself. A Pi serving several viewers uses less CPU with *Snapshots*.

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
| No webcam | Configure the camera in Mainsail (Settings > Webcams). Snapshots and video use the printer's web server (port 80, or the port you entered; with `:7125` STL Tools uses port 80 for the camera). |
| "Live video did not load, showing snapshots" | The camera service is not MJPEG, or crowsnest is busy. Snapshots keep working; set Webcam to Snapshots to skip the try. |
| Estimates do not say "own limits" | Settings > Printers > Read limits; check "Estimates use the printer's own Klipper limits" is on and the printer is the default. |
| Thumbnails missing | Turn on thumbnails in your slicer's printer profile (G-code thumbnails, for example 300x300 PNG). |

## SV07 network notes

- The SV07 runs Klipper with Moonraker and Mainsail on its own host board. Mainsail's web server on port 80 forwards the Moonraker API, so the plain IP works. Moonraker itself listens on port 7125.
- Stock Klipper images usually trust the private network ranges in `moonraker.conf` (`[authorization]` `trusted_clients`), so no API key is needed. If the test says "refused", add the STL Tools computer's network there or create an API key in Mainsail.
- STL Tools waits 6 seconds for an answer: the SV07 host board can be slow while it prints.
- Use the IP address if `sv07.local` style names do not resolve on your computer.
- Untested on a real SV07 so far. The tests use a fake Moonraker that answers like one (`test/helpers/mock-moonraker.js`).

## What is stored

`<data folder>/printers.json`: name, address, model (printer profile) and the optional API key. Remove a printer in the Printers tab; nothing on the printer changes.

## Other printer models

Any printer that runs Klipper with Moonraker should work the same way (for example Voron or RatRig builds, or a stock printer that ships Mainsail or Fluidd): add it with Model "Generic fast Klipper printer" and let STL Tools read its limits. Its webcam works when Mainsail or Fluidd lists it. Only the SV07 behavior is modeled in the tests; other models are untested (unverified). Add a profile for yours: [PRINTER-PROFILES.md](PRINTER-PROFILES.md).

Printers without Klipper / Moonraker (Bambu, Prusa Connect, OctoPrint) are not supported.

## Not built yet

- Slicing on the server, then sending the G-code to the printer.
- Live push updates (the page polls every 3 seconds, every 15 seconds when the tab is hidden).
- WebRTC / HLS video (shown as snapshots).
