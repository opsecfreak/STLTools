# Install STL Tools

> See also: [Self-hosting: USB, one-time, LAN](SELF-HOSTING.md) | [Raspberry Pi 4 / 5](RASPBERRY-PI.md) | [User guide](USER-GUIDE.md) | [Troubleshooting](TROUBLESHOOTING.md) | [All docs](README.md)

STL Tools runs on your own computer (Windows or Linux desktop recommended, macOS, or a Raspberry Pi; also from a USB drive or as a one-time session, see [SELF-HOSTING.md](SELF-HOSTING.md)) and opens in its own app window (Microsoft Edge or Chrome in app mode, if installed) or in your web browser. Start it with `--browser` to always use a normal browser tab. No account, no cloud, no Docker. Each download includes everything it needs, including Node.js.

Desktop vs Raspberry Pi: a desktop GPU can use 3D view quality **Ultra** (Settings > 3D view). On a Pi or a phone, set quality **Low** and turn off card previews if pages feel slow.

## 0. With Node.js already installed: npm package

If you have Node.js 18 or newer, install the package and start the app:

```bash
npm install -g https://github.com/opsecfreak/STLTools/releases/latest/download/stltools-1.1.0.tgz
```

```bash
stltools app
```

`stltools app --lan` serves phones and tablets on your network; `stltools list`, `stltools gen`, `stltools preset` work from any folder. Your data goes to the same per-user folder as the desktop packages. Update by installing the newer `.tgz`; remove with `npm uninstall -g stltools`. When the package is on npmjs.com: `npm install -g stltools` or `npx stltools app`.

## 1. Download

1. Open the repository on GitHub: https://github.com/opsecfreak/STLTools
2. Click **Releases** (right side), then the newest release.
3. Under **Assets**, download the file for your computer:

| Your computer | File |
|---|---|
| Windows 10 / 11 | `stltools-<version>-windows-x64.zip` |
| Mac with Apple chip (M1-M4) | `stltools-<version>-macos-arm64.tar.gz` |
| Mac with Intel chip | `stltools-<version>-macos-x64.tar.gz` |
| Linux PC | `stltools-<version>-linux-x64.tar.gz` |
| Raspberry Pi 4 / 5, 64-bit Raspberry Pi OS | `stltools-<version>-linux-arm64.tar.gz` |
| Raspberry Pi, 32-bit Raspberry Pi OS | `stltools-<version>-linux-armv7l.tar.gz` |
| Anything with Node.js 18+ already installed | `stltools-<version>-any-os.zip` |

Note: not sure which Mac you have? Apple menu > About This Mac: "Chip: Apple M..." = Apple chip, "Processor: Intel" = Intel.

## 2. Windows

1. Right-click the downloaded zip > **Properties** > tick **Unblock** (if shown) > **OK**.
2. Right-click the zip > **Extract All** > **Extract**.
3. Open the extracted folder.
4. Double-click **Start STL Tools.bat**.
5. If Windows shows "Windows protected your PC": click **More info** > **Run anyway**.
6. Your browser opens STL Tools. Keep the black window open while you use it. Close it to stop.

Optional install (shortcuts on the Desktop and Start menu, no admin rights):

1. Double-click **Install STL Tools.bat** in the extracted folder.
2. Start STL Tools from the new shortcut. You can delete the download afterwards.

Note: the warning appears because the scripts are not code-signed.

## 3. macOS

1. Double-click the downloaded `.tar.gz`. Finder unpacks it.
2. Open the unpacked folder.
3. Drag **STL Tools.app** into **Applications** (optional).
4. First start only: **right-click** (or Control-click) **STL Tools.app** > **Open** > **Open**.
5. Your browser opens STL Tools. To stop it, right-click the STL Tools icon in the Dock > **Quit**.

Note: if macOS says the app "is damaged" or still refuses to open, run this once in Terminal (adjust the path):

```bash
xattr -dr com.apple.quarantine "/Applications/STL Tools.app"
```

Note: the app is not signed by Apple, so macOS asks for confirmation the first time. A log is written to `~/Library/Logs/STLTools.log`.

## 4. Linux PC

1. Unpack the download.

```bash
tar -xzf stltools-*-linux-x64.tar.gz
```

2. Start it.

```bash
./stltools-*-linux-x64/start.sh
```

3. Optional: install a menu entry and the `stltools-app` command.

```bash
./stltools-*-linux-x64/install/install-linux.sh
```

## 5. Raspberry Pi (shop server)

The Pi runs STL Tools all the time as a system service. Open it from any PC, tablet or phone on the shop network. Full guide with SD card setup, kiosk mode, backups and remote access: [RASPBERRY-PI.md](RASPBERRY-PI.md).

1. On the Pi, download the package (`linux-arm64` for 64-bit Raspberry Pi OS, `linux-armv7l` for 32-bit; `uname -m` tells you: `aarch64` or `armv7l`). Replace `<version>`, for example `1.1.0`.

```bash
curl -fLO https://github.com/opsecfreak/STLTools/releases/download/v<version>/stltools-<version>-linux-arm64.tar.gz
```

2. Unpack it.

```bash
tar -xzf stltools-*-linux-arm64.tar.gz
```

3. Install the service (starts at boot, listens on the network, data in `/opt/stltools/data`).

```bash
cd stltools-*-linux-arm64 && sudo SOURCE_DIR="$PWD/app" USE_PACKAGE_NODE=1 bash app/deploy/install-pi.sh
```

4. On any device on the same network, open `http://stltools.local:3000` (or `http://<pi-ip>:3000`).
5. Set an access PIN: Settings > Self-hosting.

Check the service:

```bash
systemctl status stltools
```

```bash
journalctl -u stltools -f
```

Without root (a per-user service, for example on a desktop Linux PC): `./install/install-linux.sh --service --lan`, then `sudo loginctl enable-linger $USER` once.

## Upgrade

1. Download the new release.
2. Windows / Linux: run the installer from the new download again (it replaces the app, keeps your data). Without the installer: delete the old folder and use the new one.
3. macOS: replace **STL Tools.app** with the new one.

Your saved designs, shop catalog and custom files are in a separate folder and are never touched by upgrades:

| System | Data folder |
|---|---|
| Windows | `%APPDATA%\STLTools` |
| macOS | `~/Library/Application Support/STLTools` |
| Linux | `~/.local/share/stltools` |
| Pi service | `/opt/stltools/data` |
| USB portable | `stltools-data` next to the package |

## Uninstall

| System | Steps |
|---|---|
| Windows | Run `install\uninstall-windows.ps1` in the installed folder (`%LOCALAPPDATA%\Programs\STL Tools`), or delete that folder and the shortcuts. |
| macOS | Drag **STL Tools.app** to the Trash. |
| Linux | `systemctl --user disable --now stltools` (if you used `--service`), then `rm -rf ~/.local/opt/stltools ~/.local/bin/stltools-app ~/.local/share/applications/stltools.desktop` |
| Pi service | `sudo bash /opt/stltools/deploy/install-pi.sh --uninstall` (keeps `/opt/stltools/data`) |

Delete the data folder too if you want to remove your designs and catalog.

## Options

Start options (add them after the start script or app command):

| Option | What it does |
|---|---|
| `--lan` | Listen on the network so phones and tablets can connect. Set an access PIN (Settings > Self-hosting) and use it only on a trusted network. |
| `--portable` | USB drive: keep all data in `stltools-data/` next to the package (same as the "USB portable" start script). |
| `--temp` | One-time session: data in a temp folder, deleted when STL Tools stops. |
| `--hours 3` | Stop by itself after 3 hours. |
| `--port 3100` | Use another port (default 3000; it moves up automatically if 3000 is busy). |
| `--no-browser` | Do not open a browser (servers, Pi). |
| `--data <folder>` | Use another data folder. |
