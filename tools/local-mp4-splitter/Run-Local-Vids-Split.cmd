@echo off
setlocal
powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Run-Local-Vids-Split.ps1"
set "launcher_exit_code=%ERRORLEVEL%"
if not "%launcher_exit_code%"=="0" pause
exit /b %launcher_exit_code%
