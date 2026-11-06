#!/usr/bin/env bash
# Tests deploy/install-pi.sh without touching the real system service:
# installs this checkout into a temp folder, with a small systemctl stand-in that
# starts the server the way the generated unit says (ExecStart, Environment, User).
# Then: the service answers, runs as "service" mode on the LAN address, keeps data
# across an update, and --uninstall removes the app but keeps the data.
#
#   sudo bash scripts/test-pi-install.sh
#   sudo SOURCE_DIR=<unpacked package>/app bash scripts/test-pi-install.sh   (test a release package)
#
# Needs root (creates a system user stltools-test), node 18+, npm, curl.
# CI runs it on x64 and on ARM64 (the Raspberry Pi 4 / 5 CPU). On a real Pi you
# can run it too; it does not change an installed STL Tools.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo" >&2; exit 1; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d /tmp/stltools-pi-test.XXXXXX)"
chmod 755 "$T"
PORT="${PORT:-39$(( RANDOM % 90 + 10 ))0}"
export APP_DIR="$T/opt/stltools" UNIT_DIR="$T/systemd" APP_USER=stltools-test HOST=0.0.0.0 PORT SKIP_APT=1 NO_AVAHI=1 SOURCE_DIR="${SOURCE_DIR:-$REPO}"
export SYSTEMCTL="$T/systemctl"
fail() { echo "FAIL: $*" >&2; [ -f "$T/server.log" ] && tail -20 "$T/server.log" >&2; exit 1; }
cleanup() {
  pkill -u stltools-test 2>/dev/null || true; sleep 0.5
  userdel stltools-test 2>/dev/null || true
  rm -rf "$T"
}
trap cleanup EXIT

# systemctl stand-in: daemon-reload / enable are no-ops; restart runs ExecStart as the unit's
# User with the unit's Environment lines; disable --now / stop kills it.
cat > "$SYSTEMCTL" <<STUB
#!/usr/bin/env bash
unit="$UNIT_DIR/stltools.service"
stop() { pkill -u stltools-test -f src/server.js 2>/dev/null; rm -f "$T/pid"; sleep 0.8; }
case "\$*" in
  *restart*stltools*|*start*stltools*)
    stop
    user="\$(sed -n 's/^User=//p' "\$unit")"
    cmd="\$(sed -n 's/^ExecStart=//p' "\$unit")"
    envs="\$(sed -n 's/^Environment=//p' "\$unit" | tr '\n' ' ')"
    cd "\$(sed -n 's/^WorkingDirectory=//p' "\$unit")"
    # shellcheck disable=SC2086
    setsid runuser -u "\$user" -- env \$envs \$cmd >"$T/server.log" 2>&1 &
    echo \$! > "$T/pid" ;;
  *disable*--now*|*stop*) stop ;;
  *) : ;;
esac
STUB
chmod +x "$SYSTEMCTL"

echo "== install from $SOURCE_DIR into $APP_DIR (port $PORT)"
bash "$REPO/deploy/install-pi.sh" | tee "$T/install.log"
grep -q "STL Tools is running" "$T/install.log" || fail "installer did not finish"
grep -q "^Environment=HOST=0.0.0.0" "$UNIT_DIR/stltools.service" || fail "unit HOST"
grep -q "^Environment=PORT=$PORT" "$UNIT_DIR/stltools.service" || fail "unit PORT"
grep -q "^Environment=STLTOOLS_MODE=service" "$UNIT_DIR/stltools.service" || fail "unit mode"
grep -q "^User=stltools-test" "$UNIT_DIR/stltools.service" || fail "unit user"
grep -Eq "^ExecStart=/[^ ]*node $APP_DIR/src/server.js" "$UNIT_DIR/stltools.service" || fail "unit ExecStart"
NODE_USED="$(sed -n 's/^ExecStart=\([^ ]*\) .*/\1/p' "$UNIT_DIR/stltools.service")"

h="$(curl -fsS "http://127.0.0.1:$PORT/api/hosting")"
echo "$h" | grep -q '"mode":"service"' || fail "hosting mode: $h"
echo "$h" | grep -q '"lan":true' || fail "not on the LAN: $h"
echo "$h" | grep -q "\"dataDir\":\"$APP_DIR/data\"" || fail "data dir: $h"
curl -fsS -X POST "http://127.0.0.1:$PORT/api/generate/spacer" -d '{"length":10}' | grep -q '"parts"' || fail "generate"
pgrep -u stltools-test -f "src/server.js" >/dev/null || fail "service not running as stltools-test"
curl -fsS -X POST "http://127.0.0.1:$PORT/api/designs" -d '{"name":"keep me","generator":"spacer","params":{"length":11}}' >/dev/null || fail "save design"

echo "== update (run the installer again)"
bash "$REPO/deploy/install-pi.sh" >"$T/update.log" 2>&1 || { cat "$T/update.log"; fail "update"; }
curl -fsS "http://127.0.0.1:$PORT/api/designs" | grep -q "keep me" || fail "design lost on update"

echo "== uninstall"
bash "$REPO/deploy/install-pi.sh" --uninstall
[ ! -f "$UNIT_DIR/stltools.service" ] || fail "unit not removed"
[ ! -d "$APP_DIR/src" ] || fail "app not removed"
ls "$APP_DIR/data" | grep -q designs || fail "data removed by uninstall"
curl -fsS "http://127.0.0.1:$PORT/api/version" >/dev/null 2>&1 && fail "still running after uninstall"
echo
echo "Pi installer test passed ($(uname -m), $NODE_USED $("$NODE_USED" -v))"
