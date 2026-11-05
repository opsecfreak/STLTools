#!/usr/bin/env bash
# STL Tools installer and updater for Raspberry Pi OS (Bookworm or newer)
# and other Debian-based Linux. Run it again later to update.
#
#   sudo bash deploy/install-pi.sh
#
# Settings (override with environment variables):
#   REPO_URL  git URL to clone           (default: https://github.com/opsecfreak/STLTools.git)
#   BRANCH    branch to run              (default: main)
#   APP_DIR   install folder             (default: /opt/stltools)
#   HOST      listen address             (default: 0.0.0.0 = reachable on your LAN)
#   PORT      web port                   (default: 3000)
#
# Your shop catalog in $APP_DIR/data is never touched by updates.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/opsecfreak/STLTools.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/stltools}"
APP_USER="stltools"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-3000}"
UNIT="/etc/systemd/system/stltools.service"

say() { printf '\n==> %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo bash $0" >&2
  exit 1
fi

say "1/6 Checking Node.js (needs 18 or newer), npm, git and curl"
need_node=1
if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; then
  need_node=0
fi
if [ "$need_node" -eq 1 ] || ! command -v npm >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  apt-get update
  apt-get install -y nodejs npm git curl
fi
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' || {
  echo "Node.js $(node -v) is too old. Install Node 18+ (Raspberry Pi OS Bookworm ships 18)." >&2
  exit 1
}
echo "node $(node -v), npm $(npm -v)"

say "2/6 Service user '$APP_USER'"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

say "3/6 Code in $APP_DIR (branch $BRANCH)"
git_app() { git -c safe.directory="$APP_DIR" -C "$APP_DIR" "$@"; }
if [ -d "$APP_DIR/.git" ]; then
  git_app fetch origin "$BRANCH"
  git_app checkout "$BRANCH"
  git_app pull --ff-only origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
git_app log --oneline -1

say "4/6 Installing dependencies (npm ci)"
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund)
mkdir -p "$APP_DIR/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

say "5/6 systemd service (HOST=$HOST PORT=$PORT)"
sed -e "s|^Environment=HOST=.*|Environment=HOST=$HOST|" \
    -e "s|^Environment=PORT=.*|Environment=PORT=$PORT|" \
    -e "s|/opt/stltools|$APP_DIR|g" \
    -e "s|^ExecStart=/usr/bin/node |ExecStart=$(command -v node) |" \
    "$APP_DIR/deploy/stltools.service" > "$UNIT"
systemctl daemon-reload
systemctl enable stltools >/dev/null
systemctl restart stltools

say "6/6 Checking that it answers"
ok=0
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/generators" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" -ne 1 ]; then
  echo "Service did not answer on port $PORT. Check: journalctl -u stltools -n 50" >&2
  exit 1
fi

ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "STL Tools is running."
echo "  On this machine: http://127.0.0.1:$PORT"
[ "$HOST" = "0.0.0.0" ] && echo "  On your network:  http://${ip:-<pi-ip>}:$PORT  or  http://$(hostname).local:$PORT"
echo "  Logs:            journalctl -u stltools -f"
echo "  Shop data:       $APP_DIR/data  (back this up)"
