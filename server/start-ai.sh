#!/usr/bin/env bash
# Starts the STEMSTAGE AI stem splitter on http://127.0.0.1:8765 (Linux; Windows: start-ai.ps1)
VENV="${XDG_DATA_HOME:-$HOME/.local/share}/stemstage/venv"
[ -x "$VENV/bin/python" ] || { echo "AI environment not found. Run server/setup-ai.sh first." >&2; exit 1; }
exec "$VENV/bin/python" "$(dirname "$0")/stem_server.py" "$@"
