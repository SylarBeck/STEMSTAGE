; STEMSTAGE installer hooks.
; The default per-user folder %LOCALAPPDATA%\STEMSTAGE is the same folder (case-insensitive) as
; %LOCALAPPDATA%\stemstage, which holds the game's Python environment and logs. Install the app to the
; standard per-user programs folder instead, unless the user picked a different folder.
!macro NSIS_HOOK_PREINSTALL
  ${If} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${PRODUCTNAME}"
    SetOutPath $INSTDIR
  ${EndIf}
!macroend
