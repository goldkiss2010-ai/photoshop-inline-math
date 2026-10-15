@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\windows_launcher.ps1" -Action Setup
set "PAPER_MATH_EXIT=%ERRORLEVEL%"
pause
exit /b %PAPER_MATH_EXIT%
