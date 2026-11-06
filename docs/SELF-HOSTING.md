# Self-hosting: desktop, USB drive, one-time session, Raspberry Pi

STL Tools is a small web server plus a browser page. It runs on your own computer; nothing is uploaded anywhere. Pick how long it should live and where your data goes.

> See also: [Install](INSTALL.md) | [Raspberry Pi 4 / 5](RASPBERRY-PI.md) | [Printers](PRINTERS.md) | [Troubleshooting](TROUBLESHOOTING.md) | [All docs](README.md)

## Pick a way to run it

| Way | Start with | Data goes to | Stops | Good for |
|---|---|---|---|---|
| **Desktop** | Start STL Tools.bat / STL Tools.app / `./start.sh` / `stltools app` | your user folder (below) | when you close it | your own PC |
| **USB drive (portable)** | **Start STL Tools (USB portable).bat**, `./start-portable.sh`, or `--portable` | `stltools-data/` next to the start scripts | when you close it | carry it between PCs; nothing left on the PC |
| **One-time session** | **Start STL Tools (one-time session).bat** or `--temp` | a temp folder, **deleted** when it stops | when you close it (the .bat: after 4 hours at the latest) | a shared or borrowed PC |
| **For a few hours** | `--hours 3` (any way above), or Settings > Self-hosting > Stop by itself after | as above | by itself after that time | a workshop session, a demo |
| **On your network (LAN)** | `--lan`, or Settings > Self-hosting > Reachable from other devices | as above | as above | phones and tablets next to the printer |
| **Raspberry Pi service** | `deploy/install-pi.sh` | `/opt/stltools/data` | never (starts at boot) | the shop server ([guide](RASPBERRY-PI.md)) |
| **Linux user service** | `install/install-linux.sh --service --lan` | `~/.local/share/stltools` | never (starts at login / boot with linger) | a Linux PC that is always on |
| **From source** | `npm start` | `./data` (or `STLTOOLS_DATA`) | when you stop it | development |

Settings > **Self-hosting** shows how the running copy was started, its addresses, data folder, auto-stop time and PIN state.

### Data folders (desktop)

| System | Folder |
|---|---|
| Windows | `%APPDATA%\STLTools` |
| macOS | `~/Library/Application Support/STLTools` |
| Linux | `~/.local/share/stltools` (or `$XDG_DATA_HOME/stltools`) |

Each holds `data/` (settings, designs, projects, catalog, printers, My Parts, STL library) and `custom/` (your own generators, presets and printer profiles). Upgrading or deleting the app never touches it.

## USB drive (portable)

1. Unpack the package for the computers you will use onto the drive (Windows: `windows-x64`; Linux: `linux-x64`; Mac: `macos-arm64` or `macos-x64`). Packages for different systems can sit side by side; each keeps its own `stltools-data`.
2. Start the portable script on the drive:
   - Windows: **Start STL Tools (USB portable).bat**
   - Linux: `./start-portable.sh`
   - macOS: **Start STL Tools (USB portable).command**
3. Work as usual. Everything you save is in `stltools-data` on the drive.
4. Close the STL Tools window (or press Ctrl+C) **before** you unplug the drive.

Instead of the script you can put an empty file named `portable.txt` next to the start scripts: every start is then portable. Notes:
- Drives formatted FAT32 / exFAT work; files over 4 GB are not used.
- Windows may block scripts from a downloaded zip: right-click the zip > Properties > Unblock before you unpack it.
- USB 2.0 sticks make the start slow (it reads about 125 MB, mostly the bundled Node.js); after that it runs from memory.

## One-time session and auto-stop

`--temp` puts all data in a new temp folder and deletes it when STL Tools stops, so the PC keeps nothing. Download your STL files (or export the project) before you close it.

`--hours <n>` stops STL Tools by itself after `n` hours (for example `--hours 0.5` = 30 minutes). Settings > Self-hosting > **Stop by itself after** does the same for every start of the desktop app (0 = never).

```bash
./start.sh --temp --hours 3
```

On Windows, from a Command Prompt in the package folder:

```bat
"Start STL Tools.bat" --temp --hours 3
```

## On your network (LAN)

1. Start with `--lan`, or turn on Settings > Self-hosting > **Reachable from other devices on my network (LAN)** and restart STL Tools.
2. The window prints the addresses (also in Settings > Self-hosting), for example `http://192.168.1.20:3000`. Open one on the phone or tablet.
3. Windows asks the first time whether Node.js may use the network: allow **Private networks** only.
4. Set an access PIN (next section) when other people use the same network.

The port: `--port 3100`, or Settings > Self-hosting > Port (applies at the next start). If the port is busy, the next free one is used.

### LAN access PIN

Settings > Self-hosting > **LAN access PIN**.

- Other devices see a PIN page first. After the right PIN they get a cookie and are not asked again until the PIN changes.
- The computer that runs STL Tools (127.0.0.1) never needs the PIN, so you cannot lock yourself out.
- Five wrong PINs from one device block it for a minute.
- The PIN is stored as a scrypt hash in `data/hosting.json`, never in clear. Changing or removing it needs the current PIN. Forgot it: stop STL Tools, delete `data/hosting.json`, start again.
- It keeps housemates and customers out of your designs and printers. It is not internet-grade security: never forward the port on your router. For access from outside, use Tailscale ([Pi guide](RASPBERRY-PI.md#9-access-away-from-the-shop)).

## Printers are optional

Settings > Printers > **Printer features**:

| Value | Printers page, header chip, printer tiles |
|---|---|
| Show when a printer is saved (default) | hidden until you add a printer |
| Always show | shown |
| Off | hidden; no background checks |

Without a printer, estimates use the printer profile from Settings > Print estimates. With a printer, the connection is checked in the background (Settings > Printers > Background connection check, default every 5 minutes, read-only `GET /server/info`), and estimates use the printer's own limits. Details: [PRINTERS.md](PRINTERS.md).

## Start options

| Option | What it does |
|---|---|
| `--lan` | Listen on all network interfaces (phones, tablets, other PCs). |
| `--port 3100` | Use another port (default 3000, or Settings > Self-hosting > Port). |
| `--portable` | Data in `stltools-data/` next to the package (USB drive). Same as a `portable.txt` file there. |
| `--temp` | One-time session: data in a temp folder, deleted on exit. |
| `--hours 2` | Stop by itself after 2 hours (decimals allowed). |
| `--data <folder>` | Use this data folder. |
| `--no-browser` | Do not open a browser (servers). |
| `--browser` | Open a normal browser tab instead of an app window. |

Environment variables (servers, the systemd unit): `HOST`, `PORT`, `STLTOOLS_DATA`, `STLTOOLS_CUSTOM`, `STLTOOLS_HOME`.

Order of precedence: command-line option, then environment variable, then Settings > Self-hosting, then the default.

## What runs where

- **The server** (Node.js) generates parts, stores your data, and talks to printers. It used about 100 MB of RAM after the first part on x64 Linux (measured once; a Pi is not measured yet).
- **The browser** draws the 3D view with WebGL. Without WebGL (old graphics drivers, some remote desktops and VMs) the 3D view is replaced by a list of parts and sizes; generating, estimates and downloads still work. Settings > 3D view > Render quality: Low helps slow devices.
- Works in current Chrome, Edge, Firefox and Safari. CI checks the UI in Chromium on Linux and Windows.
