@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\windows_launcher.ps1" -Action Data
set "PAPER_MATH_EXIT=%ERRORLEVEL%"
if not "%PAPER_MATH_EXIT%"=="0" pause
exit /b %PAPER_MATH_EXIT%
