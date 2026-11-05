# Run STL Tools on a Raspberry Pi

The Pi runs the web UI 24/7 in the shop. Open it from a PC, tablet or phone on the same network. The Pi only generates the STL files. Slice and print from your normal slicer.

## What you need

- Raspberry Pi 4 or 5 (2 GB RAM or more). A Pi 3B+ may work but is untested.
- microSD card, 16 GB or larger, or a USB SSD.
- Raspberry Pi OS (64-bit), Bookworm or newer. The Lite version (no desktop) is enough.
- Network: Ethernet or Wi-Fi.

Note: performance on a Pi is not measured yet. Expect slower generation than on a desktop. Large parts with text take the longest.

## 1. Prepare the Pi

1. Open Raspberry Pi Imager on your PC.
2. Select Raspberry Pi OS Lite (64-bit).
3. Open the settings (gear icon).
4. Set the hostname to `stltools`.
5. Turn on SSH.
6. Set a user name and password.
7. Enter your Wi-Fi name and password if you do not use Ethernet.
8. Write the card.
9. Put the card in the Pi and power it on.
10. Wait 2 minutes, then connect from your PC:

```bash
ssh <your-user>@stltools.local
```

Note: if `stltools.local` does not resolve, find the Pi's IP address in your router's device list and use that.

## 2. Install STL Tools

1. Update the system.

```bash
sudo apt-get update && sudo apt-get -y upgrade
```

2. Install git.

```bash
sudo apt-get install -y git
```

3. Download the installer.

```bash
git clone https://github.com/opsecfreak/STLTools.git ~/STLTools
```

4. Run the installer.

```bash
sudo bash ~/STLTools/deploy/install-pi.sh
```

The installer does these steps:
- Installs Node.js, npm, git and curl from Raspberry Pi OS if they are missing.
- Creates a `stltools` system user.
- Puts the app in `/opt/stltools`.
- Installs a systemd service that starts on boot and restarts after a crash.
- Checks that the web UI answers.

Note: if the GitHub repository is private, step 3 asks for a login. Use a GitHub personal access token as the password, or set up an SSH key on the Pi and use `REPO_URL=git@github.com:opsecfreak/STLTools.git`. Never put the token in a script or file.

## 3. Open it

1. On any device on the same network, open `http://stltools.local:3000`.
2. If that does not load, use the IP address the installer printed, for example `http://192.168.1.50:3000`.
3. On a phone, add the page to the home screen for one-tap access.

## 4. Update

Run the installer again. It pulls the latest `main`, reinstalls dependencies and restarts the service. Your shop catalog is not touched.

```bash
sudo bash /opt/stltools/deploy/install-pi.sh
```

Roll back to an earlier version:

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

Note: the next update run moves you back to the latest `main`.

## 5. Back up the shop catalog

Your categories and items are in `/opt/stltools/data`. Everything else can be reinstalled.

1. Copy the folder to your PC (run on the PC).

```bash
scp -r <your-user>@stltools.local:/opt/stltools/data ./stltools-backup
```

2. Or copy it to a USB stick on the Pi (replace the mount path).

```bash
sudo cp -r /opt/stltools/data /media/<your-user>/<usb-name>/stltools-data-$(date +%F)
```

Restore: copy the files back into `/opt/stltools/data`, run `sudo chown -R stltools:stltools /opt/stltools/data`, then `sudo systemctl restart stltools`.

## 6. Access away from the shop

Do not forward port 3000 on your router. The app has no login.

Use Tailscale (a free private VPN for personal use) instead:

1. Install Tailscale on the Pi.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

2. Connect the Pi to your Tailscale account.

```bash
sudo tailscale up
```

3. Install the Tailscale app on your phone and sign in to the same account.
4. Open `http://stltools:3000` (or the Pi's Tailscale IP) from the phone.

## Troubleshooting

| Problem | Check |
|---------|-------|
| Page does not load | `systemctl status stltools` |
| Service keeps restarting | `journalctl -u stltools -n 50` |
| Works on the Pi, not from the phone | The phone must be on the same network. The service must use `HOST=0.0.0.0` (the installer default). |
| Port 3000 is used by something else | Run the installer with another port: `sudo PORT=3100 bash /opt/stltools/deploy/install-pi.sh` |
| "Node.js is too old" | Use Raspberry Pi OS Bookworm or newer. |

## Change settings

The installer reads these environment variables. Pass them in front of the command, for example `sudo PORT=3100 HOST=127.0.0.1 bash deploy/install-pi.sh`.

| Variable | Default | Meaning |
|----------|---------|---------|
| `REPO_URL` | GitHub HTTPS URL | Where to clone from |
| `BRANCH` | `main` | Branch to run |
| `APP_DIR` | `/opt/stltools` | Install folder |
| `HOST` | `0.0.0.0` | `0.0.0.0` = reachable on your network, `127.0.0.1` = this Pi only |
| `PORT` | `3000` | Web port |
