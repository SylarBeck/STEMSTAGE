# STEMSTAGE Python setup (Windows). The installer runs this; you can also run it by hand.
#
#   -Mode core   Python 3.11 + the DualSense controller bridge + yt-dlp (small, ~60 MB)
#   -Mode ai     the AI splitter on top: PyTorch (CUDA when an NVIDIA GPU is present, CPU otherwise),
#                Demucs htdemucs_6s, Whisper lyrics and basic-pitch transcription (~3-5 GB)
#   -Mode full   both (the default, and what `npm run ai:setup` does)
#   -Uv <path>   the uv binary to use (the app ships one; otherwise uv from PATH or installed)
#
# The environment lives in %LOCALAPPDATA%\stemstage\venv: a short path avoids the Windows 260-char limit
# that PyTorch's CUDA DLLs hit in deep folders, and it survives reinstalls and updates. Each finished step
# leaves a marker (venv\stemstage-core.ok, venv\stemstage-ai.ok), so running it again is quick.
param(
    [ValidateSet("core", "ai", "full")] [string]$Mode = "full",
    [string]$Uv = ""
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Here = $PSScriptRoot
$Root = Join-Path $env:LOCALAPPDATA "stemstage"
$Venv = Join-Path $Root "venv"
$Py = Join-Path $Venv "Scripts\python.exe"
New-Item -ItemType Directory -Force $Root | Out-Null

function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }
function Step($text) { Write-Host "STEMSTAGE: $text" }

# ---- uv (installs Python itself, and the packages)
if (-not $Uv -or -not (Test-Path $Uv)) {
    $cmd = Get-Command uv -ErrorAction SilentlyContinue
    if ($cmd) { $Uv = $cmd.Source }
    else {
        Step "Installing uv (Python package manager)"
        powershell -NoProfile -ExecutionPolicy Bypass -c "irm https://astral.sh/uv/install.ps1 | iex"
        $Uv = Join-Path $env:USERPROFILE ".local\bin\uv.exe"
    }
}

# ---- core: Python + controller bridge
if (($Mode -eq "core" -or $Mode -eq "full") -and -not (Test-Path "$Venv\stemstage-core.ok")) {
    if (-not (Test-Path $Py)) {
        Step "Installing Python 3.11"
        & $Uv venv $Venv --python 3.11 --python-preference only-managed; Check "Python install"
    }
    Step "Installing the DualSense controller bridge"
    & $Uv pip install --python $Py -r "$Here\requirements-core.txt"; Check "controller bridge install"
    Set-Content "$Venv\stemstage-core.ok" (Get-Date -Format o)
    Step "Controller bridge ready"
}

# ---- ai: PyTorch + Demucs + Whisper + basic-pitch
if (($Mode -eq "ai" -or $Mode -eq "full") -and -not (Test-Path "$Venv\stemstage-ai.ok")) {
    if (-not (Test-Path $Py)) { & $Uv venv $Venv --python 3.11 --python-preference only-managed; Check "Python install" }
    $hasNvidia = $null -ne (Get-Command nvidia-smi -ErrorAction SilentlyContinue)
    if ($hasNvidia) {
        Step "NVIDIA GPU found: downloading PyTorch with CUDA (about 3 GB, this takes a while)"
        & $Uv pip install --python $Py torch torchaudio --index-url https://download.pytorch.org/whl/cu128; Check "PyTorch install"
    } else {
        Step "No NVIDIA GPU: downloading PyTorch for the CPU (splitting will be slower)"
        & $Uv pip install --python $Py torch torchaudio --index-url https://download.pytorch.org/whl/cpu; Check "PyTorch install"
    }
    Step "Installing Demucs, Whisper and note transcription"
    & $Uv pip install --python $Py -r "$Here\requirements-ai.txt"; Check "AI packages install"
    # basic-pitch (neural note transcription) through ONNX: without its TensorFlow dependency
    & $Uv pip install --python $Py --no-deps basic-pitch==0.4.0; Check "basic-pitch install"
    Step "Downloading the htdemucs_6s model"
    & $Py -c "import torch; print('CUDA available:', torch.cuda.is_available()); from demucs.pretrained import get_model; get_model('htdemucs_6s'); print('model ready')"
    Check "model download"
    Set-Content "$Venv\stemstage-ai.ok" (Get-Date -Format o)
    Remove-Item (Join-Path $Root "ai-declined") -ErrorAction SilentlyContinue
    Step "AI splitter ready"
}
Step "Done"
