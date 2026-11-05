#!/usr/bin/env bash
# Runs spike.mjs in its own Xvfb display (never on the desktop); :93 is free of capture.sh's :97
set -euo pipefail
cd "$(dirname "$0")"
D="${PW_DISPLAY:-93}"
# a server of an earlier run that is still shutting down holds the display: wait for it
for _ in $(seq 50); do [ -e "/tmp/.X$D-lock" ] || break; sleep 0.2; done
Xvfb ":$D" -screen 0 1600x1000x24 -nolisten tcp >/dev/null 2>&1 &
XVFB=$!
# wait for the server to be gone, or the next run finds its lock file and no display
trap 'kill $XVFB 2>/dev/null || true; wait $XVFB 2>/dev/null || true' EXIT
for _ in $(seq 50); do [ -S "/tmp/.X11-unix/X$D" ] && break; sleep 0.2; done
unset WAYLAND_DISPLAY
DISPLAY=":$D" node "${1:-spike.mjs}"
