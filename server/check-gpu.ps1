# Exit 0: NVIDIA GPU with a working driver; 2: NVIDIA GPU but driver unavailable;
# 3: no NVIDIA display adapter; 4: hardware detection failed. No packages are installed here.
$ErrorActionPreference = 'Stop'
try {
    $adapters = @(Get-CimInstance Win32_PnPEntity -Filter "PNPClass='Display'")
    if (-not $adapters) { exit 4 }
    $nvidia = @($adapters | Where-Object { $_.PNPDeviceID -match 'VEN_10DE' -or $_.Name -match 'NVIDIA' })
    if (-not $nvidia) { exit 3 }
    $tool = (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue).Source
    if (-not $tool) {
        $candidate = Join-Path $env:ProgramFiles 'NVIDIA Corporation\NVSMI\nvidia-smi.exe'
        if (Test-Path -LiteralPath $candidate) { $tool = $candidate }
    }
    if (-not $tool) { exit 2 }
    & $tool --query-gpu=name --format=csv,noheader 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { exit 2 }
    exit 0
} catch {
    exit 4
}
