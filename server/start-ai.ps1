# Starts the STEMSTAGE AI stem splitter on http://127.0.0.1:8765
# Optional: $env:STEMSTAGE_MODEL = "htdemucs_ft" for the 4-stem fine-tuned model.
$Venv = Join-Path $env:LOCALAPPDATA "stemstage\venv"
if (-not (Test-Path "$Venv\Scripts\python.exe")) {
    Write-Host "AI environment not found. Run .\server\setup-ai.ps1 first." -ForegroundColor Red
    exit 1
}
& "$Venv\Scripts\python.exe" "$PSScriptRoot\stem_server.py" @args
