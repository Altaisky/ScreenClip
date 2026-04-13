@echo off
set "SCRIPT_DIR=%~dp0"
set "APP_DIR=%SCRIPT_DIR%.electron"
set "ELECTRON_BIN=%APP_DIR%\node_modules\.bin\electron.cmd"

if not exist "%ELECTRON_BIN%" (
  echo ERROR: Electron not found
  pause
  exit /b 1
)

cd /d "%APP_DIR%"
start /B "" "%ELECTRON_BIN%" .
