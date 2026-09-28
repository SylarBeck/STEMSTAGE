#!/usr/bin/env bash
# STEMSTAGE Python setup (Linux; Windows: setup-ai.ps1). The desktop app runs this on first start; you can
# also run it by hand.
#
#   setup-ai.sh [core|ai|full] [path/to/uv]
#     core  Python 3.11 + the DualSense controller bridge + yt-dlp (small)
#     ai    the AI splitter: PyTorch (CUDA with an NVIDIA GPU, CPU otherwise), Demucs, Whisper, basic-pitch
#     full  both (default)
#
# The environment lives in ~/.local/share/stemstage/venv (where the desktop app looks for it). Finished steps
# leave markers (stemstage-core.ok, stemstage-ai.ok), so running it again is quick.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-full}"
UV="${2:-}"
ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/stemstage"
VENV="$ROOT/venv"
PY="$VENV/bin/python"
mkdir -p "$ROOT"
step() { echo "STEMSTAGE: $*"; }

if [ -z "$UV" ] || [ ! -x "$UV" ]; then
  if command -v uv >/dev/null 2>&1; then UV="$(command -v uv)"
  else
    step "Installing uv (Python package manager)"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    UV="$HOME/.local/bin/uv"
  fi
fi

make_venv() { [ -x "$PY" ] || "$UV" venv "$VENV" --python 3.11 --python-preference only-managed; }

if { [ "$MODE" = core ] || [ "$MODE" = full ]; } && [ ! -f "$VENV/stemstage-core.ok" ]; then
  step "Installing Python 3.11 and the DualSense controller bridge"
  make_venv
  "$UV" pip install --python "$PY" -r "$HERE/requirements-core.txt"
  date -Iseconds > "$VENV/stemstage-core.ok"
  step "Controller bridge ready"
fi

if { [ "$MODE" = ai ] || [ "$MODE" = full ]; } && [ ! -f "$VENV/stemstage-ai.ok" ]; then
  make_venv
  if command -v nvidia-smi >/dev/null 2>&1; then
    step "NVIDIA GPU found: downloading PyTorch with CUDA (about 3 GB)"
    "$UV" pip install --python "$PY" torch torchaudio --index-url https://download.pytorch.org/whl/cu128
  else
    step "No NVIDIA GPU: downloading PyTorch for the CPU (splitting will be slower)"
    "$UV" pip install --python "$PY" torch torchaudio --index-url https://download.pytorch.org/whl/cpu
  fi
  step "Installing Demucs, Whisper and note transcription"
  "$UV" pip install --python "$PY" -r "$HERE/requirements-ai.txt"
  "$UV" pip install --python "$PY" --no-deps basic-pitch==0.4.0
  step "Downloading the htdemucs_6s model"
  "$PY" -c "import torch; print('CUDA available:', torch.cuda.is_available()); from demucs.pretrained import get_model; get_model('htdemucs_6s'); print('model ready')"
  date -Iseconds > "$VENV/stemstage-ai.ok"
  step "AI splitter ready"
fi

# DualSense over hidraw needs the hidapi library and access to the controller (once, needs root)
if ! ldconfig -p 2>/dev/null | grep -q libhidapi-hidraw; then
  echo "For DualSense support install hidapi:  sudo apt install libhidapi-hidraw0   (Fedora: sudo dnf install hidapi)"
fi
RULE=/etc/udev/rules.d/70-stemstage-dualsense.rules
if [ ! -f "$RULE" ]; then
  echo "To use DualSense controllers without root, add this udev rule once:"
  echo "  echo 'KERNEL==\"hidraw*\", ATTRS{idVendor}==\"054c\", ATTRS{idProduct}==\"0ce6|0df2\", MODE=\"0660\", TAG+=\"uaccess\"' | sudo tee $RULE"
  echo "  sudo udevadm control --reload-rules && sudo udevadm trigger"
fi
step "Done"
