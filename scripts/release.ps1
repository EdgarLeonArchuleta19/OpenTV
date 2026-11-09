param(
  [string]$ZipPassword = "1234"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "==> 1/4 Compilando instalador NSIS y ejecutable Portable de OpenTV..." -ForegroundColor Cyan
npx electron-builder --win nsis portable
if ($LASTEXITCODE -ne 0) {
  throw "Error al compilar con electron-builder (codigo $LASTEXITCODE)"
}

$distDir = Join-Path $projectRoot "dist"
$bundleDir = Join-Path $distDir "OpenTV-Paquete-Amigos"
if (Test-Path $bundleDir) {
  Remove-Item -Path $bundleDir -Recurse -Force
}
New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

# Si Inno Setup está instalado en la PC, compilar también el instalador Inno Setup
$innoPaths = @(
  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
  "C:\Program Files\Inno Setup 6\ISCC.exe",
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ }

if ($innoPaths.Count -gt 0) {
  Write-Host "==> Inno Setup detectado: compilando installer\opentv.iss..." -ForegroundColor Cyan
  & $innoPaths[0] (Join-Path $projectRoot "installer\opentv.iss")
}

Write-Host "==> 2/4 Preparando archivos y desbloqueadores SmartScreen..." -ForegroundColor Cyan
$setupExe = Get-ChildItem -Path $distDir -Filter "OpenTV Setup *.exe" | Select-Object -First 1
$portableExe = Get-ChildItem -Path $distDir -Filter "OpenTV Portable *.exe" | Select-Object -First 1
$innoExe = Get-ChildItem -Path $distDir -Filter "OpenTV-InnoSetup-*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1

if ($setupExe) {
  Copy-Item -Path $setupExe.FullName -Destination (Join-Path $bundleDir $setupExe.Name) -Force
}
if ($portableExe) {
  Copy-Item -Path $portableExe.FullName -Destination (Join-Path $bundleDir $portableExe.Name) -Force
}
if ($innoExe) {
  Copy-Item -Path $innoExe.FullName -Destination (Join-Path $bundleDir $innoExe.Name) -Force
}

# Crear script .bat que elimina la marca de Internet (Zone.Identifier) y abre el Instalador
$batInstalar = @"
@echo off
chcp 65001 >nul
title Instalador de OpenTV
echo ========================================================
echo   Preparando instalador de OpenTV (quitando bloqueo)...
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '%~dp0' -Recurse | Unblock-File -ErrorAction SilentlyContinue"
for %%f in ("%~dp0OpenTV Setup *.exe") do (
  echo Iniciando %%~nxf...
  start "" "%%~ff"
  exit /b 0
)
echo No se encontro el archivo instalador en esta carpeta.
pause
"@
[System.IO.File]::WriteAllText((Join-Path $bundleDir "1-Instalar-OpenTV-Sin-Bloqueo.bat"), $batInstalar, [System.Text.Encoding]::UTF8)

# Crear script .bat que elimina la marca de Internet (Zone.Identifier) y abre el Portable
$batPortable = @"
@echo off
chcp 65001 >nul
title OpenTV Portable
echo ========================================================
echo   Abriendo OpenTV Portable (quitando bloqueo)...
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '%~dp0' -Recurse | Unblock-File -ErrorAction SilentlyContinue"
for %%f in ("%~dp0OpenTV Portable *.exe") do (
  echo Iniciando %%~nxf...
  start "" "%%~ff"
  exit /b 0
)
echo No se encontro OpenTV Portable en esta carpeta.
pause
"@
[System.IO.File]::WriteAllText((Join-Path $bundleDir "2-Abrir-Portable-Sin-Bloqueo.bat"), $batPortable, [System.Text.Encoding]::UTF8)

# Crear guía clara para amigos
$leeme = @"
====================================================================
                    OPENTV DESKTOP v1.0.0 (WINDOWS)
                         Contraseña ZIP: $ZipPassword
====================================================================

¡Bienvenido a OpenTV! En esta carpeta tienes dos formas de usarlo:

OPCIÓN A — INSTALADOR CLÁSICO (Recomendado)
1. Haz doble clic en: "1-Instalar-OpenTV-Sin-Bloqueo.bat"
   (o directamente en "OpenTV Setup 1.0.0.exe").
2. El asistente creará el acceso directo "OpenTV" en tu Escritorio
   y en el Menú Inicio de Windows.

OPCIÓN B — VERSIÓN PORTABLE (Sin instalar, ideal para USB)
1. Haz doble clic en: "2-Abrir-Portable-Sin-Bloqueo.bat"
   (o directamente en "OpenTV Portable 1.0.0.exe").
2. Tus favoritos e historial se guardarán automáticamente junto al
   programa en la carpeta "OpenTV - datos".

--------------------------------------------------------------------
¿QUÉ HACER SI APARECE LA VENTANA AZUL DE WINDOWS ("Windows protegió su PC")?
--------------------------------------------------------------------
Como OpenTV es un proyecto independiente, la primera vez que lo abras
Windows SmartScreen puede mostrar un aviso preventivo:

1. Haz clic en el texto subrayado que dice "Más información"
   (o "Información adicional").
2. Haz clic en el botón "Ejecutar de todas formas".

¡Listo! Windows recordará la aplicación y no volverá a preguntarte.
====================================================================
"@
[System.IO.File]::WriteAllText((Join-Path $bundleDir "LEEME-INSTRUCCIONES.txt"), $leeme, [System.Text.Encoding]::UTF8)

# Desbloquear archivos locales antes de comprimir
Get-ChildItem -Path $bundleDir -Recurse | Unblock-File -ErrorAction SilentlyContinue

Write-Host "==> 3/4 Creando archivo .ZIP protegido con contraseña ($ZipPassword)..." -ForegroundColor Cyan
$sevenZip = "C:\Users\DO-EdgarL\AppData\Local\electron-builder\Cache\7zip@1.0.0\7zip-win-x64-a34pt\bin\7za.exe"
if (-not (Test-Path $sevenZip)) {
  $sevenZip = "7z"
}

$zipPath = Join-Path $distDir "OpenTV-v1.0.0-Windows-Pass-$ZipPassword.zip"
if (Test-Path $zipPath) {
  Remove-Item -Path $zipPath -Force
}

& $sevenZip a -tzip "$zipPath" "$bundleDir\*" "-p$ZipPassword" -mem=AES256 -mx=5 | Out-Null

# Crear también ZIPs individuales (Instalador solo y Portable solo) para descargas más ligeras
if ($setupExe) {
  $zipSetup = Join-Path $distDir "OpenTV-Instalador-v1.0.0-Pass-$ZipPassword.zip"
  if (Test-Path $zipSetup) { Remove-Item -Path $zipSetup -Force }
  & $sevenZip a -tzip "$zipSetup" (Join-Path $bundleDir $setupExe.Name) (Join-Path $bundleDir "1-Instalar-OpenTV-Sin-Bloqueo.bat") (Join-Path $bundleDir "LEEME-INSTRUCCIONES.txt") "-p$ZipPassword" -mem=AES256 -mx=5 | Out-Null
}
if ($portableExe) {
  $zipPortable = Join-Path $distDir "OpenTV-Portable-v1.0.0-Pass-$ZipPassword.zip"
  if (Test-Path $zipPortable) { Remove-Item -Path $zipPortable -Force }
  & $sevenZip a -tzip "$zipPortable" (Join-Path $bundleDir $portableExe.Name) (Join-Path $bundleDir "2-Abrir-Portable-Sin-Bloqueo.bat") (Join-Path $bundleDir "LEEME-INSTRUCCIONES.txt") "-p$ZipPassword" -mem=AES256 -mx=5 | Out-Null
}

Write-Host "==> 4/4 ¡Empaquetado completado con éxito!" -ForegroundColor Green
Get-ChildItem -Path $distDir -File | Select-Object Name, @{Name="SizeMB";Expression={[math]::Round($_.Length / 1MB, 2)}} | Format-Table -AutoSize
