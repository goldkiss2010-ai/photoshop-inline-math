@echo off
setlocal
cd /d "%~dp0"
where uv >nul 2>&1
if errorlevel 1 (
  echo ERROR: uv not found. See docs\INSTALL_WINDOWS.md.
  pause
  exit /b 1
)
uv run --no-project --python 3.13.15 --with-requirements requirements-runtime.txt python tools\check_setup.py %*
set "PAPER_MATH_CHECK_EXIT=%ERRORLEVEL%"
if not "%PAPER_MATH_CHECK_EXIT%"=="0" pause
exit /b %PAPER_MATH_CHECK_EXIT%
