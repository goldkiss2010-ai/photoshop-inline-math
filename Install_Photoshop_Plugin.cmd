@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install_photoshop_plugin.ps1" -Mode Normal
set "paper_math_exit=%ERRORLEVEL%"
pause
exit /b %paper_math_exit%
