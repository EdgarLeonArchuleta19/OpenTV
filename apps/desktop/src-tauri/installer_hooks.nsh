; OpenTV v2 NSIS Installer Hooks
; Handles clean upgrades and missing system runtimes on stripped Windows editions
; (Tiny11, MiniOS, AtlasOS, Windows 10/11 LTSC) with clear Spanish explanations.

!macro NSIS_HOOK_PREINSTALL
  ; Ensure any background FFmpeg helper from a previous session is closed before overwriting files.
  nsExec::ExecToLog 'taskkill /F /IM ffmpeg.exe /T'
  Pop $0

  ; 1) Detect Microsoft Edge WebView2 Runtime (machine-wide or per-user).
  StrCpy $R0 "0"
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 != ""
  ${AndIf} $0 != "0.0.0.0"
    StrCpy $R0 "1"
  ${EndIf}
  ${If} $R0 == "0"
    ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
    ${If} $0 != ""
    ${AndIf} $0 != "0.0.0.0"
      StrCpy $R0 "1"
    ${EndIf}
  ${EndIf}

  ; 2) Detect Microsoft Visual C++ 2015-2022 Redistributable (x64).
  StrCpy $R1 "0"
  SetRegView 64
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  SetRegView lastused
  ${If} $0 == 1
    StrCpy $R1 "1"
  ${EndIf}
  ${If} $R1 == "0"
    IfFileExists "$WINDIR\System32\vcruntime140.dll" 0 +2
      StrCpy $R1 "1"
  ${EndIf}

  ; 3) Inform the user clearly when stripped Windows is missing WebView2 or VC++ Runtime.
  ${If} $R0 == "0"
  ${OrIf} $R1 == "0"
    StrCpy $R2 ""
    ${If} $R0 == "0"
      StrCpy $R2 "$R2$\r$\n  - Microsoft Edge WebView2 Runtime (interfaz moderna de OpenTV)"
    ${EndIf}
    ${If} $R1 == "0"
      StrCpy $R2 "$R2$\r$\n  - Microsoft Visual C++ 2015-2022 x64 (motor multimedia nativo)"
    ${EndIf}

    DetailPrint "Faltan componentes base de Windows; se instalaran automaticamente."
    IfSilent +2 0
      MessageBox MB_OK|MB_ICONINFORMATION "Tu version de Windows (comun en ediciones reducidas como MiniOS, AtlasOS, Tiny11 o LTSC) no incluye componentes base necesarios para OpenTV:$R2$\r$\n$\r$\nEl instalador los descargara e instalara automaticamente ahora (requiere conexion a internet) para garantizar que OpenTV funcione sin errores."
  ${EndIf}

  ; 4) If VC++ 2015-2022 x64 is missing, download & install Microsoft's official package silently.
  ;    (WebView2 itself is installed automatically by Tauri's embedded Microsoft WebView2 Bootstrapper.)
  ${If} $R1 == "0"
    DetailPrint "Descargando Microsoft Visual C++ 2015-2022 Redistributable (x64)..."
    nsExec::ExecToLog "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile '$TEMP\opentv_vc_redist.x64.exe' -UseBasicParsing"
    Pop $0
    ${If} $0 == 0
      IfFileExists "$TEMP\opentv_vc_redist.x64.exe" 0 vc_dl_failed
        DetailPrint "Instalando Microsoft Visual C++ 2015-2022 (x64)..."
        nsExec::ExecToLog '"$TEMP\opentv_vc_redist.x64.exe" /install /quiet /norestart'
        Pop $1
        Delete "$TEMP\opentv_vc_redist.x64.exe"
        DetailPrint "Visual C++ Redistributable finalizado (codigo $1)."
        Goto vc_done
    ${EndIf}
    vc_dl_failed:
      DetailPrint "No se pudo descargar Visual C++ Redistributable sin conexion."
      IfSilent +2 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "No se pudo descargar Microsoft Visual C++ 2015-2022 x64 (verifica tu conexion a internet). Si OpenTV muestra un error al abrir, descargalo manualmente desde: https://aka.ms/vs/17/release/vc_redist.x64.exe"
    vc_done:
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'taskkill /F /IM ffmpeg.exe /T'
  Pop $0
!macroend
