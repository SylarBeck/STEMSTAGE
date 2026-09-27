# Starts the STEMSTAGE controller bridge (DualSense via pydualsense) on ws://127.0.0.1:8766
$Venv = Join-Path $env:LOCALAPPDATA "stemstageenv"
if (-not (Test-Path "$VenvScriptspython.exe")) {
    Write-Host "Python environment not found. Run .serversetup-ai.ps1 first." -ForegroundColor Red
    exit 1
}
& "$VenvScriptspython.exe" "$PSScriptRootcontroller_bridge.py" @args
