#!/usr/bin/env bash
# STL Tools from a USB drive: all data stays in stltools-data/ next to this script.
# Stop STL Tools (Ctrl+C) before you unplug the drive. One-time session instead: ./start.sh --temp --hours 3
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/start.sh" --portable "$@"
