# Raspberry Pi 4 / 4B / 5: install and setup

The Pi runs STL Tools all the time, starts it at boot, and serves it to every PC, tablet and phone on your network. The Pi only generates STL files and talks to your printers; slicing stays in your slicer.

> See also: [Self-hosting options](SELF-HOSTING.md) (USB drive, one-time session, desktop) | [Printers and live webcam](PRINTERS.md) | [Troubleshooting](TROUBLESHOOTING.md) | [All docs](README.md)

**Contents:** [What you need](#what-you-need) | [1. Prepare the card](#1-prepare-the-sd-card-or-ssd) | [2. First boot](#2-first-boot-and-ssh) | [3. Install](#3-install-stl-tools) | [4. Open it](#4-open-it) | [5. Set it up](#5-set-it-up) | [6. Pi with a screen](#6-pi-with-a-screen-kiosk) | [7. Update and roll back](#7-update-and-roll-back) | [8. Back up](#8-back-up-your-data) | [9. Away from home](#9-access-away-from-the-shop) | [10. Troubleshooting](#10-troubleshooting) | [11. Uninstall](#11-uninstall) | [12. Installer settings](#12-installer-settings)

## What you need

| | Raspberry Pi 4 Model B ("Pi 4B") / Pi 400 / CM4 | Raspberry Pi 5 / CM5 |
|---|---|---|
| RAM | 2 GB or more (4 GB recommended) | 2 GB or more |
| Power supply | Official 5 V 3 A USB-C supply | Official 27 W (5 V 5 A) USB-C supply |
| Storage | microSD 16 GB+ (A1/A2 class), or a USB SSD | microSD 16 GB+, USB SSD or NVMe HAT |
| OS | Raspberry Pi OS **64-bit**, Bookworm or newer. Lite (no desktop) is enough | same |
| Network | Ethernet (best) or Wi-Fi, on the same network as your PCs and printers | same |

"Pi 4" and "Pi 4B" are the same board (Raspberry Pi 4 Model B). A Pi 3B+ or Zero 2 W may work but is untested and slow.

Notes:
- 32-bit Raspberry Pi OS (`armv7l`) works too, with the `linux-armv7l` package. 64-bit is faster.
- Performance on a Pi is not measured yet (unverified). Expect generation to take several times longer than on a desktop; parts with embossed text take longest. The 3D view runs in the browser of the device you open it on, not on the Pi.
- Raspberry Pi OS Bookworm ships Node.js 18 in apt, which STL Tools supports. The release package brings its own Node.js 22.

## 1. Prepare the SD card (or SSD)

1. On your PC, install and open **Raspberry Pi Imager**.
2. Choose your device (Raspberry Pi 4 or Raspberry Pi 5).
3. Choose **Raspberry Pi OS (64-bit)**. For a Pi with no screen, choose **Raspberry Pi OS Lite (64-bit)** under "Raspberry Pi OS (other)".
4. Choose the card or SSD.
5. Press **Next**, then **Edit settings**:
   - Hostname: `stltools` (you will open `http://stltools.local:3000`).
   - Username and password: your choice.
   - Wi-Fi name, password and country (skip with Ethernet).
   - Services tab: turn on **SSH** with password authentication.
6. Write the card. Put it in the Pi and power it on.

## 2. First boot and SSH

1. Wait about 2 minutes for the first boot.
2. Connect from your PC (Windows: PowerShell or Terminal; macOS / Linux: Terminal).

```bash
ssh <your-user>@stltools.local
```

3. Update the system.

```bash
sudo apt-get update && sudo apt-get -y full-upgrade
```

4. Check the OS is 64-bit: `aarch64` = 64-bit (use `linux-arm64`), `armv7l` = 32-bit (use `linux-armv7l`).

```bash
uname -m
```

Note: if `stltools.local` does not resolve, find the Pi's IP address in your router's device list and use that. Windows 10/11 resolve `.local` names out of the box; older Windows needs Bonjour (installed with iTunes or the Bonjour Print Services).

## 3. Install STL Tools

Pick one way. Both install the same thing: a `stltools` system user, the app in `/opt/stltools`, your data in `/opt/stltools/data`, and a systemd service that starts at boot, restarts after a crash, and listens on your network.

### A. From the release package (recommended: no git, no GitHub login)

1. Download the package on the Pi (64-bit OS shown; for 32-bit use `linux-armv7l`). Replace `<version>` with the newest version on the [Releases](https://github.com/opsecfreak/STLTools/releases) page, for example `1.1.0`.

```bash
curl -fLO https://github.com/opsecfreak/STLTools/releases/download/v<version>/stltools-<version>-linux-arm64.tar.gz
```

2. Unpack it.

```bash
tar -xzf stltools-*-linux-arm64.tar.gz
```

3. Install it as a service. The package brings its own Node.js and libraries, so nothing else is downloaded.

```bash
cd stltools-*-linux-arm64 && sudo SOURCE_DIR="$PWD/app" USE_PACKAGE_NODE=1 bash app/deploy/install-pi.sh
```

No internet on the Pi? Download the package on a PC, copy it to a USB drive, plug the drive into the Pi and run steps 2 and 3 from the drive (for example `/media/<your-user>/<drive>`).

### B. From git (updates with one command)

1. Install git.

```bash
sudo apt-get install -y git
```

2. Download the code.

```bash
git clone https://github.com/opsecfreak/STLTools.git ~/STLTools
```

3. Run the installer.

```bash
sudo bash ~/STLTools/deploy/install-pi.sh
```

### What the installer does

1. Prints the board, CPU, RAM and OS, with a note if the Pi model or 32-bit OS is slower.
2. Installs Node.js 18+, npm, git, curl and avahi-daemon (the `stltools.local` name) from apt when missing. If apt only has an older Node.js, it downloads the official Node.js build and checks its SHA-256.
3. Creates the `stltools` system user (no login shell).
4. Copies or clones the app to `/opt/stltools`, installs libraries (`npm ci`), keeps `/opt/stltools/data`.
5. Writes `/etc/systemd/system/stltools.service` (HOST, PORT, data folder, hardening) and starts it.
6. Waits until `http://127.0.0.1:3000/api/version` answers and prints the addresses.

The installer is tested in CI on x64 and ARM64 Linux with `scripts/test-pi-install.sh` (install, update, uninstall).

## 4. Open it

1. On any device on the same network, open `http://stltools.local:3000`.
2. If that does not load, use the IP address the installer printed, for example `http://192.168.1.50:3000`.
3. On a phone, add the page to the home screen for one-tap access.

## 5. Set it up

Do these once, from any device.

1. **Access PIN** (recommended when others share the network): Settings > Self-hosting > LAN access PIN. Devices on the network enter it once; the Pi itself never needs it. See [SELF-HOSTING.md](SELF-HOSTING.md#lan-access-pin).
2. **Printer** (optional): Settings > Printers > Add a printer. Enter the printer's IP (for a Sovol SV07: printer screen > Settings > Network), press **Test connection**, then **Add printer**. Details: [PRINTERS.md](PRINTERS.md#add-your-sv07).
   - The Pi checks the printer every 5 minutes (Settings > Printers > Background connection check) and reads its bed size, speed and acceleration from Klipper, so print estimates fit that printer.
   - The Printers page shows the printer's live webcam (the same camera Mainsail shows). On a Pi 4 with several viewers, set Settings > Printers > Webcam to **Snapshots** to save CPU and network.
3. **No printer?** Settings > Printers > Printer features: **Off** hides the Printers page. Estimates still use the printer profile (Settings > Print estimates).
4. **Your parts:** My Parts > Load the example list, or import your own `components.json` ([format](../seed/example/README.md)).
5. **Your own designs:** add generators and presets in `/opt/stltools/custom` (see [custom/README.md](../custom/README.md)), then `sudo systemctl restart stltools`.

## 6. Pi with a screen (kiosk)

With Raspberry Pi OS (desktop) and a monitor or touchscreen, the Pi can show STL Tools full screen at login.

1. Set Settings > 3D view > Render quality to **Low (Raspberry Pi, phones)**. The Pi's GPU draws the 3D view in this case.
2. Create the autostart folder.

```bash
mkdir -p ~/.config/autostart
```

3. Create the autostart entry (the browser is `chromium-browser` on Bookworm; on newer images it can be `chromium`).

```bash
printf '[Desktop Entry]\nType=Application\nName=STL Tools kiosk\nExec=chromium-browser --kiosk --noerrdialogs http://127.0.0.1:3000\n' > ~/.config/autostart/stltools-kiosk.desktop
```

4. Reboot. Press Alt+F4 to close the kiosk window.

Note: the autostart entry is the XDG standard. It is not yet tested on every Raspberry Pi desktop (Wayfire, labwc) (unverified).

## 7. Update and roll back

Update (package install): download and unpack the new package, then run step 3A again. Your data is kept.

Update (git install): run the installer again. It pulls the latest `main`, reinstalls libraries and restarts.

```bash
sudo bash /opt/stltools/deploy/install-pi.sh
```

Roll back a git install:

1. List versions.

```bash
sudo git -C /opt/stltools log --oneline -10
```

2. Check out the version you want (replace `<commit>`).

```bash
sudo git -c safe.directory=/opt/stltools -C /opt/stltools checkout <commit>
```

3. Restart.

```bash
sudo systemctl restart stltools
```

Roll back a package install: run step 3A with the older package. Note: the next git update moves you back to the latest `main`.

## 8. Back up your data

Everything you make is in `/opt/stltools/data`: settings, designs, projects, shop catalog, printers, My Parts, the STL library. Everything else can be reinstalled.

1. Copy the folder to your PC (run this on the PC).

```bash
scp -r <your-user>@stltools.local:/opt/stltools/data ./stltools-backup
```

2. Or copy it to a USB drive on the Pi (replace the mount path).

```bash
sudo cp -r /opt/stltools/data /media/<your-user>/<drive>/stltools-data-$(date +%F)
```

Restore: copy the files back into `/opt/stltools/data`, then fix the owner and restart.

```bash
sudo chown -R stltools:stltools /opt/stltools/data && sudo systemctl restart stltools
```

Settings > Data and backup > Download backup gives a JSON summary (no STL files, no API keys) from any browser.

## 9. Access away from the shop

Do not forward port 3000 on your router. Even with an access PIN, STL Tools is made for a trusted local network.

Use Tailscale (a private VPN, free for personal use) instead:

1. Install Tailscale on the Pi.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

2. Connect the Pi to your Tailscale account.

```bash
sudo tailscale up
```

3. Install the Tailscale app on your phone or laptop and sign in to the same account.
4. Open `http://stltools:3000` (or the Pi's Tailscale IP, `100.x.y.z`).

Printers on Tailscale addresses (`100.64.0.0/10`, `*.ts.net`) are accepted too.

## 10. Troubleshooting

| Problem | Check |
|---------|-------|
| Page does not load | `systemctl status stltools` |
| Service keeps restarting | `journalctl -u stltools -n 50` |
| Works on the Pi, not from the phone | Same network? The service must use `HOST=0.0.0.0` (the installer default). Try the IP instead of `stltools.local`. |
| `stltools.local` not found | `sudo systemctl enable --now avahi-daemon`, or use the IP address. |
| Asks for a PIN you do not know | On the Pi: `sudo rm /opt/stltools/data/hosting.json && sudo systemctl restart stltools` removes the PIN. |
| Port 3000 is used by something else | `sudo PORT=3100 bash /opt/stltools/deploy/install-pi.sh` |
| "Node.js is too old" | The installer then downloads Node.js itself. If that fails (no internet), use the release package (3A). |
| Slow or "out of memory" on big parts | Pi 4 with 2 GB: add swap (`sudo dphys-swapfile swapoff && sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile && sudo dphys-swapfile setup && sudo dphys-swapfile swapon`), lower text and fillet detail. |
| Webcam shows "Live video did not load" | Settings > Printers > Webcam: Snapshots. See [PRINTERS.md](PRINTERS.md#webcam-live-video-and-snapshots). |
| Undervoltage warnings (`dmesg`) | Use the official power supply listed above. |

More: [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## 11. Uninstall

Removes the service and the app; keeps your data in `/opt/stltools/data`.

```bash
sudo bash /opt/stltools/deploy/install-pi.sh --uninstall
```

Delete the data too, when you are sure you do not need it:

```bash
sudo rm -rf /opt/stltools && sudo userdel stltools
```

## 12. Installer settings

Pass them in front of the command, for example `sudo PORT=3100 HOST=127.0.0.1 bash deploy/install-pi.sh`.

| Variable | Default | Meaning |
|----------|---------|---------|
| `SOURCE_DIR` | (git) | Copy the app from this folder (unpacked package `app/`, a USB drive, a clone) instead of git |
| `USE_PACKAGE_NODE` | `0` | `1` = use the package's own Node.js (copied to `/opt/stltools-node`) |
| `REPO_URL` | GitHub HTTPS URL | Where to clone from |
| `BRANCH` | `main` | Branch to run (`mts-personal` for the personal edition) |
| `APP_DIR` | `/opt/stltools` | Install folder |
| `DATA_DIR` | `$APP_DIR/data` | Your data |
| `HOST` | `0.0.0.0` | `0.0.0.0` = reachable on your network, `127.0.0.1` = this Pi only |
| `PORT` | `3000` | Web port |
| `NO_AVAHI` | `0` | `1` = do not install avahi-daemon |
| `SKIP_APT` | `0` | `1` = never run apt-get |

The service file is [deploy/stltools.service](../deploy/stltools.service); the installer is [deploy/install-pi.sh](../deploy/install-pi.sh). Per-user service without root (desktop Linux): [INSTALL.md](INSTALL.md#4-linux-pc).
