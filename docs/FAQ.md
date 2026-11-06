# FAQ

> See also: [User guide](USER-GUIDE.md) | [Troubleshooting](TROUBLESHOOTING.md) | [All docs](README.md)

**Is anything uploaded to the internet?**
No. STL Tools is a local server on your computer or Pi. It only talks to printers on your own network when you add one. The release packages include everything; the npm install and the Pi git install download the app once.

**Do I need a 3D printer on the network?**
No. Without one, estimates use a printer profile (Settings > Print estimates) and the Printers page stays hidden. A Klipper / Moonraker printer adds status, live webcam and estimates from that printer's own limits.

**Can STL Tools start, stop or break a print?**
No. Printer access is view only by design: status, files, history, webcam, and G-code upload with `print=false`. There is no code for start, pause, cancel, G-code commands or settings, and the tests fail if any control endpoint is called. [PRINTERS.md](PRINTERS.md#view-only-by-design)

**Which printers work?**
Klipper printers with Moonraker (Mainsail or Fluidd), modeled on the Sovol SV07. Others with Klipper should work (unverified). Bambu, Prusa Connect and OctoPrint are not supported.

**How do I get the SV07 webcam?**
Set it up in Mainsail (Settings > Webcams). STL Tools reads the same camera list and shows live MJPEG video; if the list is empty it tries the Mainsail default `/webcam/?action=stream`. [PRINTERS.md](PRINTERS.md#webcam-live-video-and-snapshots)

**How accurate are the print times?**
About +/- 25 % before calibration. Calibrate once with your slicer (Settings > Print estimates > Time calibration factor). The slicer's time for uploaded G-code shows on the Printers page.

**Windows, macOS, Linux, Raspberry Pi: which download?**
Windows: `windows-x64`. Mac: `macos-arm64` (Apple chip) or `macos-x64` (Intel). Linux PC: `linux-x64`. Raspberry Pi 4 / 5 with 64-bit OS: `linux-arm64`; 32-bit OS: `linux-armv7l`. Node.js already installed: the npm package or `any-os`.

**Can I run it from a USB drive?**
Yes: the "USB portable" start script keeps all data on the drive. [SELF-HOSTING.md](SELF-HOSTING.md#usb-drive-portable)

**Can I use it on a shared PC without leaving anything behind?**
Yes: the "one-time session" start script (or `--temp`) deletes its data when it stops. [SELF-HOSTING.md](SELF-HOSTING.md#one-time-session-and-auto-stop)

**Can other people on my network use it?**
Start with `--lan` or turn on Settings > Self-hosting > Reachable from other devices, and set an access PIN. Do not forward the port to the internet; use Tailscale for remote access. [SELF-HOSTING.md](SELF-HOSTING.md#on-your-network-lan)

**Where is my data and how do I back it up?**
Settings > Data and backup shows the folder. Copy it. Desktop: `%APPDATA%\STLTools`, `~/Library/Application Support/STLTools`, `~/.local/share/stltools`; Pi: `/opt/stltools/data`; USB: `stltools-data`.

**Why are some sizes empty?**
That part was never measured, and STL Tools never invents sizes. Measure it and type the values (or fill them in My Parts).

**Can I add my own parts and generators?**
Yes, without changing the app: presets, generators and printer profiles go in the `custom/` folder. [USER-GUIDE.md](USER-GUIDE.md#grow-the-catalog)

**What is the MTS personal edition?**
A branch (`mts-personal`) with one repair shop's real parts list on top of the public version, published as pre-releases. The public release has a generic example list only. [README.md](../README.md#license-and-branches)

**What license?**
Apache-2.0. Third-party parts: [NOTICE](../NOTICE).
