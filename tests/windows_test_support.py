"""Run Windows PowerShell smoke tests with native module paths and UTF-8 I/O."""
import os
import subprocess


POWERSHELL_PREAMBLE = (
    "$ErrorActionPreference='Stop'\n"
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)\n"
    "$OutputEncoding=[Console]::OutputEncoding\n"
)


def run_windows_powershell(harness, arguments=()):
    # CI starts Python from pwsh. Its PS7 modules cannot be loaded by WinPS 5.1.
    # Let this test child construct native defaults, as on an Explorer launch.
    env = {key: value for key, value in os.environ.items()
           if key.upper() != 'PSMODULEPATH'}
    return subprocess.run(
        ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
         '-File', str(harness), *map(str, arguments)],
        env=env, capture_output=True, text=True, encoding='utf-8', timeout=30,
    )
