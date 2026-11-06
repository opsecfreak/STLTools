# Security

STL Tools is a local tool: a small web server on your own computer or Raspberry Pi, opened in your browser. This page says what it protects and what it does not.

> See also: [Self-hosting](docs/SELF-HOSTING.md) | [Printers](docs/PRINTERS.md) | [All docs](docs/README.md)

## What it is built to do

- **Local by default.** It listens on `127.0.0.1` (this computer only) unless you start it with `--lan`, turn on Settings > Self-hosting > Reachable from other devices, or install the Pi service (LAN by default).
- **Optional LAN access PIN.** Other devices must enter it; the PIN is stored as a scrypt hash in `data/hosting.json`; the cookie is HttpOnly and SameSite=Strict; five wrong PINs block a device for a minute; the machine itself is never asked. [Details](docs/SELF-HOSTING.md#lan-access-pin)
- **Printers are view only.** Every printer request is a fixed, read-only Moonraker endpoint (plus G-code upload with `print=false`). No pass-through proxy, no control endpoints; the tests fail if one is called. Printers, webcams and streams must be on local addresses (private IPv4, Tailscale, `.local` / `.lan` names).
- **API keys stay on the server.** Printer API keys live in `data/printers.json` and are never sent to a browser or included in backups.
- **No secrets in the repository.** Keys, tokens and passwords are placeholders in code and docs.
- **Path checks.** Static files, thumbnails and the STL library cannot be read outside their folders; uploads have size limits.
- **The Pi service** runs as its own system user with `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome` and `PrivateTmp`.

## What it is not

- Not built for the open internet. Do not forward its port on your router or run it on a public cloud server. Use a VPN such as Tailscale for remote access.
- No user accounts or permissions: everyone who gets in (on the machine, or with the PIN) can change everything.
- Traffic is plain HTTP on your network. Use it on a network you trust.

## Report a problem

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting: repository > Security > Report a vulnerability. Include the version (Settings > About), what you found and how to reproduce it. Expect a first answer within a week.

Supported versions: the latest release on `main` (and the matching `mts-personal` pre-release).
