#!/usr/bin/env bash
# Starts the STEMSTAGE controller bridge (DualSense via pydualsense) on ws://127.0.0.1:8766 (Linux; Windows: start-bridge.ps1)
VENV="${XDG_DATA_HOME:-$HOME/.local/share}/stemstage/venv"
[ -x "$VENV/bin/python" ] || { echo "Python environment not found. Run server/setup-ai.sh first." >&2; exit 1; }
exec "$VENV/bin/python" "$(dirname "$0")/controller_bridge.py" "$@"
