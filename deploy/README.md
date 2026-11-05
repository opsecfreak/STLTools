# Deploy

STL Tools is one Node.js process with no database. Run it on a machine in the shop and open it from any browser on your network.

## Where to run it

| Option | Best for | Guide |
|--------|----------|-------|
| Raspberry Pi 4/5 | Always on, low power, the shop server | [docs/RASPBERRY-PI.md](../docs/RASPBERRY-PI.md) |
| Linux PC or server | Always on, fastest | [Main README: Run as a system service](../README.md#run-as-a-system-service-systemd) |
| Windows or macOS desktop | Use it while you work, no service | Install Node.js 18+, then `npm install` and `npm start` in the project folder |
| Cloud server | Not recommended | No login yet. Anyone who finds the URL can edit your catalog. |

Note: for access away from the shop, use a private VPN such as Tailscale. Do not open the port on your router.

## Files

| File | Purpose |
|------|---------|
| `install-pi.sh` | Installs or updates STL Tools as a systemd service on Raspberry Pi OS or other Debian-based Linux. Safe to run again. |
| `stltools.service` | systemd unit. The installer copies it to `/etc/systemd/system/` and fills in host, port, install path and node path. |

## Settings

| Variable | Default | Meaning |
|----------|---------|---------|
| `HOST` | `127.0.0.1` (installer: `0.0.0.0`) | Listen address |
| `PORT` | `3000` | Web port |
| `STLTOOLS_DATA` | `./data` (service: `/opt/stltools/data`) | Shop catalog folder. Back it up. |
