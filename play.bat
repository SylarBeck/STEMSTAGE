@echo off
title STEMSTAGE
cd /d "%~dp0"
set "URL=http://127.0.0.1:5173"
set "PY=%LOCALAPPDATA%\stemstage\venv\Scripts\python.exe"

rem Browser version. For the desktop app, run STEMSTAGE from the Start menu / desktop shortcut instead.

if not exist node_modules (
  echo Installing game dependencies...
  call npm install || goto :error
)

rem ---- only one game server at a time
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo.
  echo Port 5173 is already in use - another STEMSTAGE game server ^(or the desktop app^) is still running.
  echo Close it and run play.bat again.
  echo.
  pause
  goto :eof
)

if not exist "%PY%" (
  echo Python environment not installed. Run:  powershell -ExecutionPolicy Bypass -File server\setup-ai.ps1
  echo Until then the game uses the in-browser DSP splitter and DualSense buttons only.
  goto :browser
)

rem ---- AI stem splitter (Demucs), unless it is already running
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/health -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  echo AI stem splitter already running.
) else (
  echo Starting the AI stem splitter ^(Demucs^)...
  start "STEMSTAGE AI splitter" /min "%PY%" "%~dp0server\stem_server.py"
)

rem ---- controller bridge (DualSense via pydualsense), unless it is already running
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8766/health -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  echo Controller bridge already running.
) else (
  echo Starting the controller bridge ^(DualSense via pydualsense^)...
  start "STEMSTAGE controller bridge" /min "%PY%" "%~dp0server\controller_bridge.py"
)

:browser
rem ---- MIDI needs a Chromium browser, so prefer Chrome, then Edge.
set "BROWSER="
for %%B in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") do (
  if not defined BROWSER if exist "%%~B" set "BROWSER=%%~B"
)
if defined BROWSER (
  echo Opening %URL% in "%BROWSER%"
  start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 3; Start-Process -FilePath '%BROWSER%' -ArgumentList '%URL%'"
) else (
  start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 3; Start-Process '%URL%'"
)

echo.
echo Songs are stored in: %~dp0songs
echo Starting the game server at %URL%  ^(close this window to stop^)
call npx vite --strictPort
goto :eof

:error
echo Something went wrong. Is Node.js installed?  https://nodejs.org
pause
