@echo off
setlocal
cd /d "%~dp0"
where uv >nul 2>&1
if errorlevel 1 (
  echo ERROR: uv not found. Open a shell with uv on PATH.
  pause
  exit /b 1
)
rem Runtime versions match the Windows inventory reported on 2026-10-15.
rem External MiKTeX/TeX packages are not installed or upgraded by this launcher.
rem Server startup validates the legacy registry/font before binding port 8765.
uv run --no-project --python 3.13.15 --with-requirements requirements-runtime.txt python tools\local_server.py
if errorlevel 1 pause
