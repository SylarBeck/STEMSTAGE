#!/usr/bin/env bash
# STEMSTAGE AI splitter + DualSense bridge setup for Linux (the Windows version is setup-ai.ps1).
# Creates a Python 3.11 environment in ~/.local/share/stemstage/venv (where the desktop app looks for it)
# with PyTorch + Demucs (htdemucs_6s), Whisper lyrics, basic-pitch and pydualsense.
# CUDA wheels when an NVIDIA GPU is present, CPU wheels otherwise.
set -euo pipefail
cd "$(dirname "$0")"
VENV="${XDG_DATA_HOME:-$HOME/.local/share}/stemstage/venv"

if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv (Python package manager)..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

[ -x "$VENV/bin/python" ] || uv venv "$VENV" --python 3.11

if command -v nvidia-smi >/dev/null 2>&1; then
  echo "NVIDIA GPU detected - installing CUDA PyTorch"
  uv pip install --python "$VENV" torch torchaudio --index-url https://download.pytorch.org/whl/cu128
else
  echo "No NVIDIA GPU - installing CPU PyTorch (separation will be slower)"
  uv pip install --python "$VENV" torch torchaudio --index-url https://download.pytorch.org/whl/cpu
fi

uv pip install --python "$VENV" -r requirements.txt
uv pip install --python "$VENV" --no-deps basic-pitch==0.4.0
uv pip install --python "$VENV" onnxruntime librosa resampy pretty_midi mir_eval yt-dlp

echo "Pre-downloading the htdemucs_6s model weights..."
"$VENV/bin/python" -c "import torch; print('CUDA available:', torch.cuda.is_available()); from demucs.pretrained import get_model; get_model('htdemucs_6s'); print('model ready')"

# DualSense over hidraw: pydualsense needs the hidapi library and read/write access to the controller
if ! ldconfig -p 2>/dev/null | grep -q libhidapi-hidraw; then
  echo
  echo "For DualSense support install hidapi:  sudo apt install libhidapi-hidraw0   (Fedora: sudo dnf install hidapi)"
fi
RULE=/etc/udev/rules.d/70-stemstage-dualsense.rules
if [ ! -f "$RULE" ]; then
  echo
  echo "To let STEMSTAGE use DualSense controllers without root, add this udev rule (once):"
  echo "  echo 'KERNEL==\"hidraw*\", ATTRS{idVendor}==\"054c\", ATTRS{idProduct}==\"0ce6|0df2\", MODE=\"0660\", TAG+=\"uaccess\"' | sudo tee $RULE"
  echo "  sudo udevadm control --reload-rules && sudo udevadm trigger"
fi

echo
echo "Done. The desktop app starts the splitter and bridge by itself; without it: server/start-ai.sh and server/start-bridge.sh"
