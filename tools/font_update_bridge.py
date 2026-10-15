"""Small, opt-in Windows Shell bridge. Never copies to Fonts or writes the registry directly.

The Windows Shell receives a user-initiated request to invoke the existing OTF
'Install' context menu action.  It may prompt, fail or return without installing.
Success is *only* established by font_update_guard.verify() after the fact.
"""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

from font_update_guard import GuardError, load_pending, windows_registry_entries, digest


def install_through_shell() -> dict:
    if sys.platform != 'win32':
        raise GuardError('Windows専用です。')
    doc = load_pending()
    records = windows_registry_entries()
    if len(records) != 1 or records[0]['hive'] != 'HKCU':
        raise GuardError('ユーザー単位（HKCU）の登録が1件でないため、Windows更新を開始しません。')
    record = records[0]
    # Only automate the exact single HKCU file that the user previously
    # overwrote via Explorer. Any unexpected install path requires manual review.
    localappdata = os.environ.get('LOCALAPPDATA')
    if not localappdata:
        raise GuardError('LOCALAPPDATAが取得できません。')
    expected = Path(localappdata) / 'Microsoft' / 'Windows' / 'Fonts' / 'InlineMathLab-Regular.otf'
    if os.path.normcase(os.path.abspath(record['path'])) != os.path.normcase(
            os.path.abspath(str(expected))):
        raise GuardError('想定外のフォント登録パスです。新規追加・重複を防ぐため自動操作を停止します。')
    if os.path.normcase(os.path.abspath(record['path'])) != os.path.normcase(
            os.path.abspath(doc['installed_entry']['path'])):
        raise GuardError('登録先が準備時と変わっています。')
    if digest(Path(record['path'])) != doc['before_sha256']:
        raise GuardError('準備後にインストール済みフォントが変更されました。更新をやり直してください。')
    source = Path(doc['staged_path'])
    if not source.is_file():
        raise GuardError('インストール用OTFがありません。')
    # Invoke Windows' existing font-install context-menu verb, rather than
    # copying bytes into the Fonts directory or editing font registration.
    # 'Install' is the Windows font context menu verb on the user's system;
    # it is not guaranteed on every Windows installation or locale.
    directory = str(source.parent).replace("'", "''")
    filename = source.name.replace("'", "''")
    script = (
        "$ErrorActionPreference = 'Stop'; "
        "$shell = New-Object -ComObject Shell.Application; "
        f"$folder = $shell.Namespace('{directory}'); "
        "if ($null -eq $folder) { throw 'Source folder not found' }; "
        f"$item = $folder.ParseName('{filename}'); "
        "if ($null -eq $item) { throw 'Font item not found' }; "
        "$item.InvokeVerb('Install'); "
        "Start-Sleep -Seconds 45"
    )
    # EncodedCommand avoids quoting and non-ASCII Windows usernames.
    import base64
    command = base64.b64encode(script.encode('utf-16-le')).decode('ascii')
    try:
        child = subprocess.Popen(
            ['powershell.exe', '-NoProfile', '-Sta', '-WindowStyle', 'Hidden',
             '-EncodedCommand', command],
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
    except OSError as exc:
        raise GuardError('Windows Shellを起動できません: ' + str(exc)) from exc
    return {'result': 'windows_install_requested', 'pid': child.pid,
            'expected_sha256': doc['after_sha256'],
            'note': '依頼を送信しました。完了とは限りません。確認ダイアログが出たら承認し、更新後に照合してください。'}

