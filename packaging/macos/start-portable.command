#!/bin/bash
# STL Tools from a USB drive (macOS): all data stays in stltools-data/ next to STL Tools.app.
# Close this window to stop STL Tools before you eject the drive.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/Start STL Tools.command" --portable "$@"
