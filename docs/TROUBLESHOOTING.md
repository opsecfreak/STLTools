# Troubleshooting

Find the symptom, apply the fix. Still stuck: open an issue with Settings > About (version, system) and what you tried.

> See also: [FAQ](FAQ.md) | [Install](INSTALL.md) | [Raspberry Pi](RASPBERRY-PI.md#10-troubleshooting) | [Printers](PRINTERS.md#troubleshooting) | [All docs](README.md)

## Start-up

| Symptom | Fix |
|---|---|
| Windows: "Windows protected your PC" | More info > Run anyway. The package is not code-signed. |
| Windows: the start script flashes and closes | Unblock the zip before you unpack it (right-click > Properties > Unblock), unpack it fully (do not run from inside the zip), start again. |
| Windows Firewall asks about Node.js | Allow **Private networks** only. Needed only with `--lan`. |
| macOS: "cannot be opened because the developer cannot be verified" | Right-click (Control-click) STL Tools.app > Open > Open, once. |
| Linux: `Permission denied` on `./start.sh` | `chmod +x start.sh start-portable.sh` (some unzip tools drop the flag). |
| "Node.js was not found" | Use the package for your system (it includes Node.js), or install Node.js 18+ for the any-os package. |
| "STL Tools is already running" and nothing opens | Open the address it printed (`http://127.0.0.1:3000`) yourself. |
| "No free port between 3000 and 3019" | Start with `--port 3100`. |
| It stopped by itself | Started with `--hours`, the one-time session script, or Settings > Self-hosting > Stop by itself after. Set 0 there. |
| My designs are gone after a one-time session | `--temp` deletes its data on exit by design. Use the normal or portable start for work you keep. |
| USB portable: data is not on the drive | Use the "USB portable" start script, or put `portable.txt` next to the start scripts. Settings > Self-hosting shows the data folder in use. |

## In the browser

| Symptom | Fix |
|---|---|
| "3D preview is off: this browser has no WebGL" | Update the graphics driver; turn on hardware acceleration (Chrome / Edge: Settings > System); over Remote Desktop use the browser on the host. Generating, estimates and downloads still work. |
| 3D view slow or laggy | Settings > 3D view > Render quality: Low; turn off Shadows; Settings > Appearance > Card previews off. |
| Page asks for a PIN | Settings > Self-hosting > LAN access PIN is set. Ask whoever set it. On the computer that runs STL Tools no PIN is needed; to remove a forgotten PIN, stop STL Tools and delete `data/hosting.json`. |
| Phone cannot open it | Start with `--lan` (or Settings > Self-hosting > Reachable from other devices, then restart). Same Wi-Fi? Use the IP from Settings > Self-hosting, not 127.0.0.1. Guest Wi-Fi networks often block devices from each other. |
| Settings did not stick | Settings save on the server for every device; a private window still uses them. Check Settings > Data and backup for the data folder. |

## Generating

| Symptom | Fix |
|---|---|
| Generate waits and some fields are empty (needs measurement) | The part needs measuring: type the sizes (calipers). STL Tools never guesses them. |
| "must be from X to Y" | The value is outside the range shown in the tooltip. |
| A warning about gear undercut or the GT2 tooth profile | Advisory: the part still builds; read the note. |
| Very slow on a Pi | Text and many fillets take longest. A Pi 4 with 2 GB: add swap ([Pi guide](RASPBERRY-PI.md#10-troubleshooting)). |
| A custom generator or preset does not show | Settings > About lists skipped custom files with the reason. Restart after adding files. |

## Printers and webcam

| Symptom | Fix |
|---|---|
| Printers tab is missing | Settings > Printers > Printer features: Always show (or add a printer). |
| "did not answer in time" | Printer off or on another network. Open `http://<printer-ip>` in a browser on the same computer. |
| "refused the request" | Moonraker `trusted_clients` or an API key: [PRINTERS.md](PRINTERS.md#troubleshooting). |
| "Not reachable at the last check" | The background check failed. Press Check connections now; printer asleep or IP changed (give it a fixed IP in your router). |
| No webcam | Set the camera up in Mainsail (Settings > Webcams). |
| "Live video did not load, showing snapshots" | Not an MJPEG camera, or crowsnest busy. Settings > Printers > Webcam: Snapshots. |
| Video freezes on a Pi with several viewers | At most 3 video streams per printer; others see snapshots. Use Snapshots on busy setups. |
| Estimate looks too short / long | Calibrate: Settings > Print estimates > Time calibration factor. Check the printer's limits (Settings > Printers > Read limits). |

## Raspberry Pi service

| Symptom | Fix |
|---|---|
| Page does not load | `systemctl status stltools`, then `journalctl -u stltools -n 50` |
| `stltools.local` not found | `sudo systemctl enable --now avahi-daemon`, or use the IP |
| Installer: "is not an STL Tools folder" | `SOURCE_DIR` must point at the package's `app/` folder (or a git clone). |
| Installer: "has files but is not a git checkout" | You installed from a package before: update with `SOURCE_DIR=...` again, or move `/opt/stltools` away (keep `data/`). |

More: [RASPBERRY-PI.md](RASPBERRY-PI.md#10-troubleshooting).

## Report a problem

1. Settings > About: note the version and the system line.
2. What you did, what you expected, what happened (a screenshot helps).
3. For printer problems: the Test connection steps (Settings > Printers).
4. Open an issue: https://github.com/opsecfreak/STLTools/issues (bug report template). Do not post API keys, PINs or addresses outside your network.
