"""Safe, read-only Windows font audit and staged Explorer update for Inline Math.

This program NEVER writes the Windows Fonts directory or Registry.
It prepares one pending OTF and one rollback OTF in the project directory,
asks the user to perform the same Explorer drag-and-drop as before, then
checks the actual registered file on disk.  For v0.6b we deliberately do
not pretend Explorer's asynchronous install means success.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from uuid import uuid4

from app_paths import ROOT, DATA_ROOT
SOURCE = DATA_ROOT / 'local-build' / 'InlineMathLab-Regular.otf'
WORK = DATA_ROOT / 'local-build' / 'font-update-guard'
STAGED = WORK / 'pending' / 'InlineMathLab-Regular.otf'
PREVIOUS = WORK / 'backup' / 'InlineMathLab-Regular.otf'
MANIFEST = WORK / 'pending.json'
FONT_FAMILY = 'Inline Math Lab'
FONT_PS_NAME = 'InlineMathLab-Regular'
FONT_REG_KEY = r'SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'


class GuardError(RuntimeError):
    pass


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def font_name_matches(label: str) -> bool:
    x = re.sub(r'[^a-z0-9]', '', label.lower())
    for suffix in ('opentype', 'truetype'):
        if x.endswith(suffix):
            x = x[:-len(suffix)]
    return x in ('inlinemathlab', 'inlinemathlabregular')


def font_info(path: Path) -> dict:
    from fontTools.ttLib import TTFont
    if not path.is_file():
        raise GuardError('フォントファイルがありません: ' + str(path))
    try:
        with TTFont(str(path)) as f:
            family, ps = f['name'].getDebugName(1), f['name'].getDebugName(6)
            if (family, ps) != (FONT_FAMILY, FONT_PS_NAME):
                raise GuardError(f'別のフォントです: family={family}, PS={ps}')
            if 'CFF ' not in f:
                raise GuardError('この実験ではCFF OpenTypeのみ対応します。')
            cmap = f.getBestCmap() or {}
            pua = sorted(c for c in cmap if 0xe000 <= c <= 0xf8ff)
            if not pua:
                raise GuardError('登録済みのPUA数式がありません。')
            return {'sha256': digest(path), 'family': family,
                    'ps_name': ps, 'pua_count': len(pua),
                    'last_codepoint': f'U+{pua[-1]:04X}'}
    except GuardError:
        raise
    except Exception as exc:
        raise GuardError('フォントを解析できません: ' + str(exc)) from exc


def _glyph_record(font, cp: int) -> tuple:
    from fontTools.pens.recordingPen import RecordingPen
    name = font.getBestCmap()[cp]
    pen = RecordingPen()
    font.getGlyphSet()[name].draw(pen)
    # Pen commands are independent of CFF storage offsets and glyph order.
    commands = tuple((op, repr(args)) for op, args in pen.value)
    width_lsb = tuple(font['hmtx'][name])
    return width_lsb, commands


def compare_font_shapes(installed: Path, incoming: Path) -> dict:
    """Describe replacement without interpreting the installed font as authority.

    Some previously installed experiment fonts may use different tables or
    glyph programs. That is not grounds to refuse a deliberate replacement.
    """
    new_info=font_info(incoming)
    from fontTools.ttLib import TTFont
    try:
        with TTFont(str(installed)) as old:
            old_cmap={cp for cp in old.getBestCmap() if 0xE000<=cp<=0xF8FF}
    except Exception:
        old_cmap=set()
    with TTFont(str(incoming)) as new:
        new_cmap={cp for cp in new.getBestCmap() if 0xE000<=cp<=0xF8FF}
    return {'old_count':len(old_cmap),
            'new_count':new_info['pua_count'],
            'added':[f'U+{cp:04X}' for cp in sorted(new_cmap-old_cmap)],
            'removed':[f'U+{cp:04X}' for cp in sorted(old_cmap-new_cmap)],
            'identity_source':'latex-pua-registry',
            'outlines_preserved':False}



def check_registry_consistency(font_path: Path):
    """Check project registry and generated PUA codepoints agree, if available."""
    reg_path = DATA_ROOT / 'assets' / 'registry.json'
    if not reg_path.is_file():
        return
    from fontTools.ttLib import TTFont
    try:
        doc = json.loads(reg_path.read_text(encoding='utf-8'))
        expected = {int(entry['codepoint'], 16) for entry in doc['entries']}
    except Exception as exc:
        raise GuardError('数式登録簿を解析できません: ' + str(exc)) from exc
    with TTFont(str(font_path)) as f:
        found = {cp for cp in f.getBestCmap() if 0xe000 <= cp <= 0xf8ff}
    if expected != found:
        missing = sorted(expected - found)
        extra = sorted(found - expected)
        raise GuardError('フォントと登録簿の文字コードが一致しません: missing=' +
                         str([f'U+{x:04X}' for x in missing]) + ', extra=' +
                         str([f'U+{x:04X}' for x in extra]))


def windows_registry_entries() -> list[dict]:
    if sys.platform != 'win32':
        raise GuardError('Windows専用の登録先検査です。')
    import winreg
    entries = []
    for hive_name, hive in (('HKCU', winreg.HKEY_CURRENT_USER),
                            ('HKLM', winreg.HKEY_LOCAL_MACHINE)):
        try:
            with winreg.OpenKey(hive, FONT_REG_KEY, 0, winreg.KEY_READ) as key:
                i = 0
                while True:
                    try:
                        label, data, val_type = winreg.EnumValue(key, i)
                        i += 1
                    except OSError:
                        break
                    if not font_name_matches(label):
                        continue
                    if not isinstance(data, str):
                        raise GuardError('Windowsフォント登録値が文字列でありません: ' + label)
                    if val_type not in (winreg.REG_SZ, winreg.REG_EXPAND_SZ):
                        raise GuardError('Windowsフォント登録値が未対応形式です: ' + label)
                    expanded = os.path.expandvars(data)
                    path = Path(expanded)
                    if not path.is_absolute():
                        if hive_name == 'HKCU':
                            base = Path(os.environ['LOCALAPPDATA']) / 'Microsoft' / 'Windows' / 'Fonts'
                            candidate = base / path
                            path = candidate if candidate.exists() else Path(os.environ['WINDIR']) / 'Fonts' / path
                        else:
                            path = Path(os.environ['WINDIR']) / 'Fonts' / path
                    entries.append({'hive': hive_name, 'label': label,
                                    'registry_data': data, 'path': str(path)})
        except FileNotFoundError:
            continue
    return entries


def get_unique_installed(entries: list[dict]) -> dict:
    if len(entries) != 1:
        if not entries:
            raise GuardError('フォントのWindows登録を発見できません。安全のため停止。status結果を確認してください。')
        raise GuardError('同じフォントの登録が複数あります（重複の恐れ）。操作せず停止。')
    e = entries[0]
    if not Path(e['path']).is_file():
        raise GuardError('登録されているOTF実体を読めません: ' + e['path'])
    return e


def atomic_json(path: Path, obj: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp-' + uuid4().hex)
    try:
        temp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def copy_checked(source: Path, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_name(dest.name + '.tmp-' + uuid4().hex)
    try:
        shutil.copyfile(source, temp)
        if digest(source) != digest(temp):
            raise GuardError('バックアップまたはステージングのコピー検証に失敗しました。')
        os.replace(temp, dest)
    finally:
        temp.unlink(missing_ok=True)


def status_report(entries: list[dict], source: Path) -> dict:
    out = {'generated_font': str(source), 'generated_exists': source.is_file(),
           'registered_fonts': []}
    if source.exists():
        out['generated'] = font_info(source)
    for e in entries:
        record = dict(e)
        p = Path(e['path'])
        record['file_exists'] = p.is_file()
        if p.is_file():
            try:
                record['installed'] = font_info(p)
            except GuardError as exc:
                record['error'] = str(exc)
        out['registered_fonts'].append(record)
    return out


def sync_status(source: Path, entries: list[dict]) -> dict:
    """Report if OS-registered bytes exactly match generated bytes.

    Status 'blocked' never grants Photoshop conversion permission.
    A font may match on disk yet Photoshop may still hold stale glyph caches.
    """
    check_registry_consistency(source)
    installed_entry = get_unique_installed(entries)
    installed = Path(installed_entry['path'])
    incoming = font_info(source)
    # Disk SHA is sufficient: a replaced legacy OTF need not be parseable.
    if digest(installed) == incoming['sha256']:
        return {'state': 'current', 'installed_count': incoming['pua_count'],
                'generated_count': incoming['pua_count'],
                'registered_path': str(installed), 'sha256': incoming['sha256']}
    comparison = compare_font_shapes(installed, source)
    return {'state': 'update_required', 'installed_count': comparison['old_count'],
            'generated_count': incoming['pua_count'],
            'registered_path': str(installed), 'target_sha256': incoming['sha256'],
            **comparison}


def prepare(source: Path, entries: list[dict], work: Path = WORK) -> dict:
    installed_entry = get_unique_installed(entries)
    old = Path(installed_entry['path'])
    incoming = font_info(source)
    check_registry_consistency(source)
    old_sha = digest(old)
    if old_sha == incoming['sha256']:
        raise GuardError('Windows登録先のフォントはすでに最新版です。上書き不要です。')
    comparison = compare_font_shapes(old, source)
    stage = work / 'pending' / 'InlineMathLab-Regular.otf'
    backup = work / 'backup' / 'InlineMathLab-Regular.otf'
    pending = work / 'pending.json'
    copy_checked(old, backup)
    copy_checked(source, stage)
    doc = {'created_utc': datetime.now(timezone.utc).isoformat(),
           'installed_entry': installed_entry,
           'before_sha256': old_sha,
           'after_sha256': incoming['sha256'],
           'comparison': comparison,
           'staged_path': str(stage), 'backup_path': str(backup)}
    atomic_json(pending, doc)
    return {'result': 'ready_for_windows_confirmation', **comparison,
            'staged_path': str(stage), 'backup_path': str(backup),
            'manifest_path': str(pending),
            'installed_scope': installed_entry['hive']}


def load_pending(work: Path = WORK) -> dict:
    manifest = work / 'pending.json'
    if not manifest.is_file():
        raise GuardError('準備データがありません。先にprepareを実行してください。')
    doc = json.loads(manifest.read_text(encoding='utf-8'))
    staged = Path(doc['staged_path'])
    if not staged.is_file() or digest(staged) != doc['after_sha256']:
        raise GuardError('ステージング中のOTFが変更されています。更新を中断してください。')
    previous = Path(doc['backup_path'])
    if not previous.is_file() or digest(previous) != doc['before_sha256']:
        raise GuardError('更新前のバックアップが壊れています。更新を中断してください。')
    return doc


def verify(entries: list[dict], work: Path = WORK) -> dict:
    doc = load_pending(work)
    if len(entries) != 1:
        raise GuardError('フォント登録数が1ではありません。新旧フォントの重複がないか確認してください。')
    target = entries[0]
    original = doc['installed_entry']
    if target['hive'] != original['hive'] or target['label'] != original['label']:
        raise GuardError('Windowsの登録先・登録名が変更されました。別の場所への重複インストールを確認してください。')
    if os.path.normcase(os.path.abspath(target['path'])) != os.path.normcase(os.path.abspath(original['path'])):
        raise GuardError('Windows上のフォント実体の場所が変わりました。古いファイルが残っている可能性があるため停止。')
    installed_path = Path(target['path'])
    if not installed_path.is_file():
        raise GuardError('Windows登録先のフォントファイルが見つかりません。')
    actual_sha = digest(installed_path)
    if actual_sha != doc['after_sha256']:
        if actual_sha == doc['before_sha256']:
            raise GuardError('OSに登録されたフォントはまだ旧版です。キャンセルまたはキャッシュの可能性があります。')
        raise GuardError('Windowsに登録されたフォントが予定のOTFと一致しません。確認してください。')
    # Stage corresponds to a specific generated OTF, even if another registration
    # run happened while the Windows confirmation dialog was open.
    if work == WORK and SOURCE.is_file() and digest(SOURCE) != doc['after_sha256']:
        raise GuardError('準備後に生成フォントが変わりました。更新を準備し直してください。')
    # If the disk file is current, we know nothing conclusive about Photoshop's
    # internal font cache. A visible text check is still mandatory.
    result = font_info(installed_path)
    return {'result': 'disk_and_registry_verified', 'registered_path': str(installed_path),
            'glyph_count': result['pua_count'], 'sha256': actual_sha,
            'photoshop_refresh_confirmed': False}


def open_explorer(work: Path = WORK, direct_source: Path | None = None):
    if sys.platform != 'win32':
        raise GuardError('Explorer起動はWindows専用です。')
    if direct_source is not None:
        if not direct_source.is_file():
            raise GuardError('生成OTFが見つかりません。')
        pending = str(direct_source)
    else:
        doc = load_pending(work)
        pending = doc['staged_path']
    # No install or copy here: manual update only.
    subprocess.Popen(['explorer.exe', '/select,' + pending])
    subprocess.Popen(['explorer.exe', str(Path(os.environ['WINDIR']) / 'Fonts')])
    return {'result': 'explorer_opened', 'pending_file': pending,
            'action': 'Fontsフォルダへドラッグし、Windowsの上書き確認を承認する'}


def main(argv=None):
    p = argparse.ArgumentParser(description='Inline Math safe font-update guard (no OS writes)')
    p.add_argument('command', choices=('status', 'prepare', 'open', 'verify'))
    p.add_argument('--source', type=Path, default=SOURCE)
    args = p.parse_args(argv)
    try:
        if args.command == 'open':
            result = open_explorer()
        elif args.command == 'verify':
            result = verify(windows_registry_entries())
        elif args.command == 'status':
            result = status_report(windows_registry_entries(), args.source.resolve())
        else:
            result = prepare(args.source.resolve(), windows_registry_entries())
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    except GuardError as exc:
        print('STOP: ' + str(exc), file=sys.stderr)
        return 2
    except Exception as exc:
        print('ERROR: ' + str(exc), file=sys.stderr)
        return 3


if __name__ == '__main__':
    raise SystemExit(main())

