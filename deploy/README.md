# Deploy

STL Tools is one Node.js process with no database. Run it on a machine in the shop and open it from any browser on your network.

> See also: [Raspberry Pi 4 / 5 guide](../docs/RASPBERRY-PI.md) | [Self-hosting options](../docs/SELF-HOSTING.md) | [Install](../docs/INSTALL.md) | [All docs](../docs/README.md)

## Where to run it

| Option | Best for | Guide |
|--------|----------|-------|
| Desktop (Windows / macOS / Linux) | Use it while you work | [docs/INSTALL.md](../docs/INSTALL.md) |
| USB drive, one-time session, a few hours | Shared PCs, carrying it around | [docs/SELF-HOSTING.md](../docs/SELF-HOSTING.md) |
| Raspberry Pi 4 / 4B / 5 | Always on, low power, the shop server | [docs/RASPBERRY-PI.md](../docs/RASPBERRY-PI.md) with `install-pi.sh` |
| Linux PC or server | Always on, fastest | `install-pi.sh` works on any Debian / Ubuntu; per-user service: `install-linux.sh --service --lan` |
| Cloud server | Not recommended | Built for a trusted LAN. Use Tailscale for remote access. |

Note: for access away from the shop, use a private VPN such as Tailscale. Do not open the port on your router.

## Files

| File | Purpose |
|------|---------|
| `install-pi.sh` | Installs, updates (`run again`) or removes (`--uninstall`) STL Tools as a systemd service on Raspberry Pi OS or other Debian-based Linux. From git or from a folder (`SOURCE_DIR`: unpacked release package, USB drive). Detects the Pi model, CPU and RAM; installs Node.js 18+ when missing. |
| `stltools.service` | systemd unit. The installer copies it to `/etc/systemd/system/` and fills in host, port, paths, user and the node binary. |
| `../scripts/test-pi-install.sh` | Tests the installer end to end (install, update keeps data, uninstall keeps data) with a systemctl stand-in. CI runs it on x64 and ARM64. |
| `../packaging/` | Launchers and installers inside the release packages (Windows .bat / PowerShell, macOS .app, Linux / Pi shell, USB portable and one-time scripts). Built by `scripts/package.mjs`, checked by `scripts/check-packages.mjs`. |

## Settings

| Variable | Default | Meaning |
|----------|---------|---------|
| `HOST` | `127.0.0.1` (installer: `0.0.0.0`) | Listen address |
| `PORT` | `3000` | Web port |
| `STLTOOLS_DATA` | `./data` (service: `/opt/stltools/data`) | Your data: settings, designs, projects, catalog, printers, My Parts, STL library, `hosting.json` (PIN hash). Back it up. |
| `STLTOOLS_MODE` | set by the launcher / unit | `desktop`, `portable`, `temp`, `custom`, `service`; shown in Settings > Self-hosting |

All installer variables: [docs/RASPBERRY-PI.md](../docs/RASPBERRY-PI.md#12-installer-settings).
