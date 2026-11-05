#!/usr/bin/env bash
# Runs spike.mjs in its own Xvfb display (never on the desktop); :93 is free of capture.sh's :97
set -euo pipefail
cd "$(dirname "$0")"
D="${PW_DISPLAY:-93}"
Xvfb ":$D" -screen 0 1600x1000x24 -nolisten tcp >/dev/null 2>&1 &
XVFB=$!
trap 'kill $XVFB 2>/dev/null || true' EXIT
sleep 1
unset WAYLAND_DISPLAY
DISPLAY=":$D" node "${1:-spike.mjs}"
