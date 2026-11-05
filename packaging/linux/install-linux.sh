#!/usr/bin/env bash
# Installs STL Tools for the current user on Linux or Raspberry Pi OS. No root needed
# (except --service on some systems, see below).
#   ./install/install-linux.sh             app + menu entry + "stltools-app" command
#   ./install/install-linux.sh --service   also run it in the background at boot (systemd user service)
#   ./install/install-linux.sh --service --lan   ... reachable from phones/PCs on your network (Pi / shop server)
# App:  ~/.local/opt/stltools      (replaced on every install / upgrade)
# Data: ~/.local/share/stltools    (never touched: catalog, saved designs, custom files)
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/.local/opt/stltools"
SERVICE=0; LAN=0
for a in "$@"; do
  case "$a" in
    --service) SERVICE=1 ;;
    --lan) LAN=1 ;;
    *) echo "Unknown option $a" >&2; exit 1 ;;
  esac
done

echo "==> Installing to $DEST"
mkdir -p "$DEST"
rm -rf "$DEST/app" "$DEST/node"
cp -a "$SRC/." "$DEST/"

mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/stltools-app" <<WRAP
#!/usr/bin/env bash
exec "$DEST/start.sh" "\$@"
WRAP
chmod +x "$HOME/.local/bin/stltools-app" "$DEST/start.sh"

if [ -d "$HOME/.local/share/applications" ] || [ -n "${XDG_CURRENT_DESKTOP:-}" ]; then
  mkdir -p "$HOME/.local/share/applications"
  cat > "$HOME/.local/share/applications/stltools.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=STL Tools
Comment=Parametric STL generator
Exec="$DEST/start.sh"
Terminal=true
Categories=Graphics;Engineering;
DESK
  echo "==> Added a menu entry: STL Tools"
fi

if [ "$SERVICE" = 1 ]; then
  ARGS="--no-browser"
  [ "$LAN" = 1 ] && ARGS="$ARGS --lan"
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/stltools.service" <<UNIT
[Unit]
Description=STL Tools (parametric STL generator)
After=network-online.target

[Service]
ExecStart="$DEST/start.sh" $ARGS
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now stltools.service
  # keep the service running without a login session (needed for a headless Pi)
  if ! loginctl enable-linger "$USER" 2>/dev/null; then
    echo "NOTE: to start at boot without logging in, run once: sudo loginctl enable-linger $USER"
  fi
  echo "==> Service running. Status: systemctl --user status stltools   Logs: journalctl --user -u stltools -f"
fi

echo ""
echo "Done."
echo "  Start:   stltools-app   (or the STL Tools menu entry)"
[ "$LAN" = 1 ] && echo "  Open from other devices: http://$(hostname).local:3000 or http://<this-ip>:3000"
echo "  Data:    $HOME/.local/share/stltools"
echo "  Remove:  rm -rf $DEST ~/.local/bin/stltools-app ~/.local/share/applications/stltools.desktop"
