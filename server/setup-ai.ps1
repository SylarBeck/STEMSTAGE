# STEMSTAGE AI splitter setup
# Creates a Python 3.11 environment with PyTorch + Demucs (htdemucs_6s).
# Uses CUDA wheels when an NVIDIA GPU is present, CPU wheels otherwise.
# The environment lives in %LOCALAPPDATA%\stemstage\venv: a short path avoids the
# Windows 260-char limit that PyTorch's CUDA DLLs hit in deep folders, and it keeps
# working if you move the game folder.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$Venv = Join-Path $env:LOCALAPPDATA "stemstage\venv"

function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "Installing uv (Python package manager)..." -ForegroundColor Cyan
    powershell -ExecutionPolicy Bypass -c "irm https://astral.sh/uv/install.ps1 | iex"
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}

if (-not (Test-Path "$Venv\Scripts\python.exe")) {
    uv venv $Venv --python 3.11; Check "venv"
}

$hasNvidia = $null -ne (Get-Command nvidia-smi -ErrorAction SilentlyContinue)
if ($hasNvidia) {
    Write-Host "NVIDIA GPU detected - installing CUDA PyTorch" -ForegroundColor Green
    uv pip install --python $Venv torch torchaudio --index-url https://download.pytorch.org/whl/cu128; Check "torch install"
} else {
    Write-Host "No NVIDIA GPU - installing CPU PyTorch (separation will be slower)" -ForegroundColor Yellow
    uv pip install --python $Venv torch torchaudio --index-url https://download.pytorch.org/whl/cpu; Check "torch install"
}

uv pip install --python $Venv -r requirements.txt; Check "demucs + controller bridge install"

# basic-pitch (neural note transcription) through ONNX: installed without its TensorFlow dependency
uv pip install --python $Venv --no-deps basic-pitch==0.4.0; Check "basic-pitch install"
uv pip install --python $Venv onnxruntime librosa resampy pretty_midi mir_eval; Check "basic-pitch dependencies"

Write-Host "Pre-downloading the htdemucs_6s model weights..." -ForegroundColor Cyan
& "$Venv\Scripts\python.exe" -c "import torch; print('CUDA available:', torch.cuda.is_available()); from demucs.pretrained import get_model; get_model('htdemucs_6s'); print('model ready')"
Check "model download"

Write-Host "`nDone. Start the splitter with:  .\server\start-ai.ps1" -ForegroundColor Green
