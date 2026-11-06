STL Tools {{VERSION}} ({{TARGET}})
===================================

Parametric STL generator: shop bins and labels, tube clamps and mounts,
quadcopter and plane parts, gears and robot parts, assemblies, print time
estimates. Runs on this computer and opens in your web browser. Nothing is
sent to the internet.

START
-----
{{START}}

The first start opens http://127.0.0.1:3000 in your browser.
Close the STL Tools window (or quit the app) to stop it.

WAYS TO RUN IT
--------------
  Desktop (default)   data in your user folder (below), kept across upgrades
  USB drive           portable start script: data in stltools-data/ next to the
                      start scripts. Stop STL Tools before you unplug the drive.
  One-time session    --temp: data in a temp folder, deleted when it stops.
                      Add --hours 3 to stop by itself after 3 hours.
  Raspberry Pi 4 / 5  runs as a service at boot, open it from any device on
                      your network. Guide: app/docs/RASPBERRY-PI.md
Details: app/docs/SELF-HOSTING.md

INSTALL (optional: adds shortcuts so you can delete this download)
-------
{{INSTALL}}

YOUR DATA
---------
Saved designs, projects, the shop catalog, printers and your own custom
generators/presets live in a separate folder that upgrades never touch:
  Windows: %APPDATA%\STLTools
  macOS:   ~/Library/Application Support/STLTools
  Linux:   ~/.local/share/stltools
  USB portable: stltools-data next to the start scripts
Back that folder up.

USE IT FROM A PHONE OR TABLET
-----------------------------
Start with the --lan option (Linux/macOS: ./start.sh --lan, Windows: run
"Start STL Tools.bat" --lan from a command prompt), or turn on
Settings > Self-hosting > "Reachable from other devices" and restart. Open the
address it prints on the other device. Set an access PIN in
Settings > Self-hosting when other people share the network.

PRINTERS (optional)
-------------------
No networked printer? Nothing to do: estimates use a printer profile.
Klipper printer with Mainsail or Fluidd (Sovol SV07 and others)? Add it in
Settings > Printers to see its status and live webcam, and to base estimates
on its own limits. View only: STL Tools never starts, stops or changes a print.

HELP
----
app/docs/README.md (all guides), app/docs/TROUBLESHOOTING.md, app/docs/FAQ.md
Online: https://github.com/opsecfreak/STLTools
