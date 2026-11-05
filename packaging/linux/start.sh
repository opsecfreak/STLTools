#!/usr/bin/env bash
# STL Tools launcher for Linux and Raspberry Pi. Add --lan to reach it from other devices.
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$DIR/node/bin/node" ]; then NODE="$DIR/node/bin/node"; else NODE="$(command -v node || true)"; fi
if [ -z "$NODE" ]; then
  echo "Node.js was not found. Use a linux-x64 / linux-arm64 / linux-armv7l download, or install Node.js 18+." >&2
  exit 1
fi
exec "$NODE" "$DIR/app/bin/stltools-app.js" "$@"
