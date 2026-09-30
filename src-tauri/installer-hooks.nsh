; STEMSTAGE installer hooks.
!include "FileFunc.nsh"

; The default per-user folder %LOCALAPPDATA%\STEMSTAGE is the same folder (case-insensitive) as
; %LOCALAPPDATA%\stemstage, which holds the game's Python environment and logs. Install the app to the
; standard per-user programs folder instead, unless the user picked a different folder.
!macro NSIS_HOOK_PREINSTALL
  ${If} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${PRODUCTNAME}"
    SetOutPath $INSTDIR
  ${EndIf}
!macroend

; One-click setup: the app ships Node.js (bin\node.exe) and uv (bin\uv.exe). Here the wizard uses uv to install
; Python with the DualSense controller bridge (small), then offers the AI splitter (a few GB of downloads).
; Progress shows in the wizard's details list. Updates (passive / silent installs) skip the question; whatever
; is missing is installed by the app itself on its next start.
!macro NSIS_HOOK_POSTINSTALL
  ${GetParameters} $R8
  ClearErrors
  ${GetOptions} $R8 "/P" $R9
  ${If} ${Errors}
  ${AndIfNot} ${Silent}
    StrCpy $R7 "interactive"
  ${Else}
    StrCpy $R7 "quiet"
  ${EndIf}

  SetDetailsView show
  DetailPrint "Setting up the DualSense controller bridge (Python)..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\app\server\setup-ai.ps1" -Mode core -Uv "$INSTDIR\bin\uv.exe"'
  Pop $R6
  ${If} $R6 != 0
    DetailPrint "Controller bridge setup didn't finish (exit $R6). STEMSTAGE retries on its next start."
  ${EndIf}

  ${If} $R7 == "interactive"
  ${AndIfNot} ${FileExists} "$LOCALAPPDATA\stemstage\venv\stemstage-ai.ok"
  ${AndIfNot} ${FileExists} "$LOCALAPPDATA\stemstage\ai-declined"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\app\server\check-gpu.ps1"'
    Pop $R6
    ${If} $R6 == 2
      MessageBox MB_YESNO|MB_ICONINFORMATION "An NVIDIA GPU was found, but its driver is not working. Open NVIDIA's official driver download page now? STEMSTAGE will use quick DSP until the driver is installed." IDNO stemstage_done
      ExecShell "open" "https://www.nvidia.com/Download/index.aspx"
      Goto stemstage_done
    ${ElseIf} $R6 != 0
      DetailPrint "No working NVIDIA GPU was found; skipping the AI download. STEMSTAGE uses quick DSP."
      Goto stemstage_done
    ${EndIf}
    MessageBox MB_YESNO|MB_ICONQUESTION "Install the AI splitter now?$\r$\n$\r$\nIt splits any song into instrument stems (Demucs), transcribes the notes and writes the lyrics. It requires a working NVIDIA driver and downloads about 3-5 GB.$\r$\n$\r$\nWithout it STEMSTAGE uses the built-in DSP splitter. You can install it later from Settings -> AI splitter." IDYES stemstage_ai
      FileOpen $R5 "$LOCALAPPDATA\stemstage\ai-declined" w
      FileWrite $R5 "declined in the installer"
      FileClose $R5
      Goto stemstage_done
    stemstage_ai:
      DetailPrint "Installing the AI splitter (PyTorch, Demucs, Whisper). This is a large download..."
      nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\app\server\setup-ai.ps1" -Mode ai -Uv "$INSTDIR\bin\uv.exe"'
      Pop $R6
      ${If} $R6 != 0
        DetailPrint "AI splitter setup didn't finish (exit $R6). STEMSTAGE retries on its next start."
      ${EndIf}
    stemstage_done:
  ${EndIf}
!macroend
