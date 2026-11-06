#!/usr/bin/env bash
# STL Tools installer and updater for Raspberry Pi 4 / 4B / 5 (Raspberry Pi OS
# Bookworm or newer, 64-bit recommended) and other Debian / Ubuntu Linux.
# Run it again later to update. Full guide: docs/RASPBERRY-PI.md
#
#   sudo bash deploy/install-pi.sh                 install or update from GitHub (branch main)
#   sudo bash deploy/install-pi.sh --uninstall     remove the service and app (keeps your data)
#   sudo SOURCE_DIR=/media/usb/STLTools bash deploy/install-pi.sh   install from a folder (USB drive,
#                                                  unpacked release, no internet for the app code)
#
# Settings (environment variables):
#   REPO_URL    git URL to clone            (default: https://github.com/opsecfreak/STLTools.git)
#   BRANCH      branch to run               (default: main)
#   SOURCE_DIR  copy the app from this folder instead of git (a clone or an unpacked release app/)
#   APP_DIR     install folder              (default: /opt/stltools)
#   DATA_DIR    your data                   (default: $APP_DIR/data)
#   HOST        listen address              (default: 0.0.0.0 = reachable on your LAN; 127.0.0.1 = this Pi only)
#   PORT        web port                    (default: 3000)
#   NO_AVAHI=1  do not install avahi-daemon (the <hostname>.local name)
#   SKIP_APT=1  never run apt-get (you installed node, npm, git, curl yourself)
#   USE_PACKAGE_NODE=1  with SOURCE_DIR=<package>/app: use the package's own Node.js even if the
#               system has one (copied to /opt/stltools-node)
#   SYSTEMCTL   systemctl command           (default: systemctl; the test script swaps in a stand-in)
#
# Your data folder is never touched by updates or --uninstall.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/opsecfreak/STLTools.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/stltools}"
DATA_DIR="${DATA_DIR:-$APP_DIR/data}"
APP_USER="${APP_USER:-stltools}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-3000}"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"
UNIT="$UNIT_DIR/stltools.service"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
NODE_FALLBACK_VERSION="${NODE_FALLBACK_VERSION:-22.12.0}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '\n==> %s\n' "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }
node_ok() { command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; }

[ "$(id -u)" -eq 0 ] || die "Run this with sudo: sudo bash $0"

if [ "${1:-}" = "--uninstall" ]; then
  say "Removing the STL Tools service and app (your data stays in $DATA_DIR)"
  $SYSTEMCTL disable --now stltools >/dev/null 2>&1 || true
  rm -f "$UNIT"
  $SYSTEMCTL daemon-reload >/dev/null 2>&1 || true
  if [ -d "$APP_DIR" ]; then
    find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name "$(basename "$DATA_DIR")" -exec rm -rf {} +
  fi
  echo "Done. Data kept: $DATA_DIR. Remove it yourself when you no longer need it."
  exit 0
fi
[ -z "${1:-}" ] || die "Unknown option $1 (use --uninstall, or environment variables, see the top of this file)"

say "1/7 This machine"
MODEL="$( (tr -d '\0' < /proc/device-tree/model) 2>/dev/null || true)"
ARCH="$(uname -m)"
MEM_MB="$(awk '/MemTotal/ { printf "%d", $2 / 1024 }' /proc/meminfo 2>/dev/null || echo 0)"
echo "Board:   ${MODEL:-not a Raspberry Pi (or unknown)}"
echo "CPU:     $ARCH   RAM: ${MEM_MB} MB"
. /etc/os-release 2>/dev/null && echo "OS:      ${PRETTY_NAME:-unknown}"
case "$MODEL" in
  *"Raspberry Pi 5"*|*"Raspberry Pi 4"*|*"Raspberry Pi 400"*|*"Compute Module 4"*|*"Compute Module 5"*) ;;
  *"Raspberry Pi"*) echo "NOTE: tested on Raspberry Pi 4 and 5. This model may be slow or run out of memory." ;;
esac
case "$ARCH" in
  aarch64|x86_64) ;;
  armv7l|armv6l) echo "NOTE: 32-bit OS. It works with Node 18+, but 64-bit Raspberry Pi OS is faster and recommended." ;;
  *) echo "NOTE: CPU $ARCH is untested." ;;
esac
[ "$MEM_MB" -gt 0 ] && [ "$MEM_MB" -lt 1800 ] && echo "NOTE: under 2 GB RAM. Big parts with text may be slow; a 2 GB swap file helps."

say "2/7 Node.js 18+, npm, git, curl"
if { ! node_ok || [ "${USE_PACKAGE_NODE:-0}" = 1 ]; } && [ -n "${SOURCE_DIR:-}" ] && [ -x "$SOURCE_DIR/../node/bin/node" ] && "$SOURCE_DIR/../node/bin/node" -v >/dev/null 2>&1; then
  # release package (linux-arm64 / linux-armv7l / linux-x64): use its bundled Node.js
  say "Using the Node.js that came with the package"
  rm -rf /opt/stltools-node && mkdir -p /opt/stltools-node/bin
  cp "$SOURCE_DIR/../node/bin/node" /opt/stltools-node/bin/node
  export PATH="/opt/stltools-node/bin:$PATH"
fi
if [ "${SKIP_APT:-0}" != 1 ]; then
  pkgs=""
  node_ok || pkgs="$pkgs nodejs"
  [ -d "${SOURCE_DIR:-/nonexistent}/node_modules/manifold-3d" ] || command -v npm >/dev/null 2>&1 || pkgs="$pkgs npm"
  [ -n "${SOURCE_DIR:-}" ] || command -v git >/dev/null 2>&1 || pkgs="$pkgs git"
  command -v curl >/dev/null 2>&1 || pkgs="$pkgs curl"
  [ "${NO_AVAHI:-0}" = 1 ] || command -v avahi-daemon >/dev/null 2>&1 || [ -x /usr/sbin/avahi-daemon ] || pkgs="$pkgs avahi-daemon"
  if [ -n "$pkgs" ]; then
    apt-get update
    # shellcheck disable=SC2086
    DEBIAN_FRONTEND=noninteractive apt-get install -y $pkgs || echo "NOTE: apt-get could not install:$pkgs"
  fi
fi
if ! node_ok; then
  # Old OS (apt has Node < 18): use the official Node.js build, checksum verified.
  case "$ARCH" in aarch64) narch=arm64 ;; armv7l) narch=armv7l ;; x86_64) narch=x64 ;; *) die "No Node.js 18+ for $ARCH. Install it yourself, then run this again." ;; esac
  say "apt has no Node.js 18+: installing the official Node.js $NODE_FALLBACK_VERSION ($narch) to /opt/stltools-node"
  tmp="$(mktemp -d)"
  file="node-v$NODE_FALLBACK_VERSION-linux-$narch.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v$NODE_FALLBACK_VERSION/$file" -o "$tmp/$file"
  curl -fsSL "https://nodejs.org/dist/v$NODE_FALLBACK_VERSION/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -) || die "Node.js download checksum mismatch"
  rm -rf /opt/stltools-node && mkdir -p /opt/stltools-node
  tar -xJf "$tmp/$file" -C /opt/stltools-node --strip-components=1
  rm -rf "$tmp"
  export PATH="/opt/stltools-node/bin:$PATH"
fi
node_ok || die "Node.js 18 or newer is needed. Found: $(node -v 2>/dev/null || echo none)"
NODE_BIN="$(command -v node)"
echo "node $(node -v) at $NODE_BIN, npm $(npm -v 2>/dev/null || echo 'not installed')"

say "3/7 Service user '$APP_USER'"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
# webcam snapshots and video come from the printer over the network: no video group needed

say "4/7 App code in $APP_DIR"
mkdir -p "$APP_DIR"
if [ -n "${SOURCE_DIR:-}" ]; then
  [ -f "$SOURCE_DIR/package.json" ] && [ -d "$SOURCE_DIR/src" ] || die "SOURCE_DIR=$SOURCE_DIR is not an STL Tools folder (no package.json + src/)"
  echo "Copying from $SOURCE_DIR (your data in $DATA_DIR is kept)"
  for item in bin src public presets printer-profiles seed custom deploy docs package.json package-lock.json README.md CHANGELOG.md AGENTS.md LICENSE NOTICE EDITION.json; do
    rm -rf "${APP_DIR:?}/$item"
    [ -e "$SOURCE_DIR/$item" ] && cp -a "$SOURCE_DIR/$item" "$APP_DIR/$item"
  done
  [ -d "$SOURCE_DIR/node_modules/manifold-3d" ] && { rm -rf "$APP_DIR/node_modules"; cp -a "$SOURCE_DIR/node_modules" "$APP_DIR/node_modules"; }
else
  git_app() { git -c safe.directory="$APP_DIR" -C "$APP_DIR" "$@"; }
  if [ -d "$APP_DIR/.git" ]; then
    git_app fetch origin "$BRANCH"
    git_app checkout "$BRANCH"
    git_app pull --ff-only origin "$BRANCH"
  elif [ -z "$(ls -A "$APP_DIR" 2>/dev/null | grep -v "^$(basename "$DATA_DIR")\$" || true)" ]; then
    tmpclone="$(mktemp -d)"
    git clone --branch "$BRANCH" "$REPO_URL" "$tmpclone/app"
    cp -a "$tmpclone/app/." "$APP_DIR/"
    rm -rf "$tmpclone"
  else
    die "$APP_DIR has files but is not a git checkout. Use SOURCE_DIR=<folder>, or move them away."
  fi
  git_app log --oneline -1
fi

say "5/7 Dependencies"
if [ -d "$APP_DIR/node_modules/manifold-3d" ] && [ -n "${SOURCE_DIR:-}" ]; then
  echo "Using the node_modules that came with $SOURCE_DIR"
else
  (cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund)
fi
mkdir -p "$DATA_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"

say "6/7 systemd service (HOST=$HOST PORT=$PORT)"
mkdir -p "$UNIT_DIR"
UNIT_SRC="$APP_DIR/deploy/stltools.service"
[ -f "$UNIT_SRC" ] || UNIT_SRC="$HERE/stltools.service"
sed -e "s|/opt/stltools|$APP_DIR|g" \
    -e "s|^Environment=HOST=.*|Environment=HOST=$HOST|" \
    -e "s|^Environment=PORT=.*|Environment=PORT=$PORT|" \
    -e "s|^Environment=STLTOOLS_DATA=.*|Environment=STLTOOLS_DATA=$DATA_DIR|" \
    -e "s|^ReadWritePaths=.*|ReadWritePaths=$DATA_DIR|" \
    -e "s|^User=.*|User=$APP_USER|" -e "s|^Group=.*|Group=$APP_USER|" \
    -e "s|^ExecStart=/usr/bin/node |ExecStart=$NODE_BIN |" \
    "$UNIT_SRC" > "$UNIT"
if command -v "${SYSTEMCTL%% *}" >/dev/null 2>&1 && { [ "$SYSTEMCTL" != systemctl ] || [ -d /run/systemd/system ]; }; then
  $SYSTEMCTL daemon-reload
  $SYSTEMCTL enable stltools >/dev/null
  $SYSTEMCTL restart stltools
  [ "${NO_AVAHI:-0}" = 1 ] || $SYSTEMCTL enable --now avahi-daemon >/dev/null 2>&1 || true
else
  echo "systemd is not running here. Start it by hand:"
  echo "  sudo -u $APP_USER HOST=$HOST PORT=$PORT STLTOOLS_DATA=$DATA_DIR $NODE_BIN $APP_DIR/src/server.js"
  exit 0
fi

say "7/7 Checking that it answers"
ok=0
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/api/version" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ "$ok" -eq 1 ] || die "Service did not answer on port $PORT. Check: journalctl -u stltools -n 50"
curl -fsS "http://127.0.0.1:$PORT/api/version" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);console.log(`STL Tools ${v.version}: ${v.generators} generators, ${v.presets} presets, Node ${v.node} ${v.arch}`)})'

ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "STL Tools is running."
echo "  On this Pi:      http://127.0.0.1:$PORT"
if [ "$HOST" = "0.0.0.0" ]; then
  echo "  On your network: http://${ip:-<pi-ip>}:$PORT   or   http://$(hostname).local:$PORT"
  echo "  Protect it:      Settings > Self-hosting > LAN access PIN"
fi
echo "  Logs:            journalctl -u stltools -f"
echo "  Your data:       $DATA_DIR  (back this up)"
echo "  Update:          run this installer again"
echo "  Remove:          sudo bash $APP_DIR/deploy/install-pi.sh --uninstall"
