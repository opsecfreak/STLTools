#!/bin/bash
# Terminal launcher for STL Tools on macOS (shows the log in the window). Close the window to stop.
DIR="$(cd "$(dirname "$0")" && pwd)"
RES="$DIR/STL Tools.app/Contents/Resources"
if [ -x "$RES/node/bin/node" ]; then NODE="$RES/node/bin/node"; APP="$RES/app"; else NODE="node"; APP="$DIR/app"; fi
exec "$NODE" "$APP/bin/stltools-app.js" "$@"
