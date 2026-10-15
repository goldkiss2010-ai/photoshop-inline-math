"""Adobe Inline Math v0.6c: loopback-only JSON bridge for the Photoshop UXP panel.

Run via start_inline_math.cmd (or uv run --with fonttools --with pymupdf python ...).
Only local documents authored by a trusted user should be passed to the TeX engine.
"""
from __future__ import annotations

import argparse
import json
import logging
import threading
from app_paths import DATA_ROOT, initialize_data
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from registry import (FONT_FILE, ROOT, font_is_current, index, load_registry,
                      refresh, render_source, scan_inline)
from readonly_mapping import validate_registry
from pua_preview import make_current_preview
from font_bundle import make_font_bundle
from project_fonts import (
    active as active_project, create as create_project,
    select as select_project, projects as list_projects, rename as rename_project,
    selected as selected_project, prepare as prepare_project,
    font_file as project_font_file, font_current as project_font_current,
    windows_status as project_windows_status,
)
from font_update_guard import (GuardError, SOURCE, prepare as prepare_font_update,
    verify as verify_font_update, sync_status, windows_registry_entries, open_explorer)

HOST = '127.0.0.1'
DEFAULT_PORT = 8765
BACKEND_ID = 'python-latex-fonttools-v1'
MAX_BODY_BYTES = 128 * 1024
_REGISTRY_LOCK = threading.RLock()


def prepare_source(source: str) -> dict:
    """Register unknown expressions, preserve existing ids, return a compact text map."""
    if not isinstance(source, str) or not source.strip():
        raise ValueError('テキストが空です。')
    if len(source) > 100_000:
        raise ValueError('テキストが長すぎます（上限10万文字）。')
    # Photoshop's current UTF-16 range adapter does not support non-BMP text.
    # Reject BEFORE registry/font writes, including ordinary-body emoji.
    if any(ord(char) > 0xFFFF or 0xD800 <= ord(char) <= 0xDFFF for char in source):
        raise ValueError('絵文字などBMP外の文字・サロゲート文字は未対応です。')
    instances = scan_inline(source)
    if not instances:
        raise ValueError('数式が見つかりません（$...$ で囲んでください）。')
    formulas = [entry[2] for entry in instances]
    with _REGISTRY_LOCK:
        registry = load_registry()
        updated, additions = refresh(registry, formulas)
        lookup = index(updated)
        converted = render_source(source, lookup)
        entries = []
        used = set()
        for formula in formulas:
            if formula not in used:
                used.add(formula)
                entries.append({'latex': formula, 'codepoint': lookup[formula],
                                'char': chr(int(lookup[formula], 16))})
        return {
            'backend': BACKEND_ID,
            'formula_instances': len(instances),
            'unique_formulas': len(entries),
            'new_count': len(additions),
            'added': [{'latex': e['latex'], 'codepoint': e['codepoint']} for e in additions],
            'entries': entries,
            'converted': converted,
            'revision': len(updated['entries']),
            'font_path': str(FONT_FILE),
        }


def safe_origin(origin: str | None) -> bool:
    """Disallow cross-origin browser requests from arbitrary public websites."""
    if not origin:
        return True
    if origin == 'null' or origin.startswith('uxp://') or origin.startswith('file://'):
        return True
    try:
        parsed = urlsplit(origin)
    except ValueError:
        return False
    return parsed.scheme in ('http', 'https') and parsed.hostname in ('127.0.0.1', 'localhost')


def make_handler():
    class Handler(BaseHTTPRequestHandler):
        server_version = 'InlineMathLocal/0.7.0'

        def cors(self):
            origin = self.headers.get('Origin')
            if origin and safe_origin(origin):
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type')

        def reply(self, status: int, content: dict):
            payload = json.dumps(content, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.cors()
            self.end_headers()
            self.wfile.write(payload)

        def reply_html(self, status: int, html: str):
            payload = html.encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('X-Frame-Options', 'DENY')
            self.cors()
            self.end_headers()
            self.wfile.write(payload)

        def reply_archive(self, bundle):
            self.send_response(200)
            self.send_header('Content-Type','application/zip')
            self.send_header('Content-Length',str(len(bundle['data'])))
            self.send_header('Content-Disposition','attachment; filename="'+bundle['filename']+'"')
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('X-Paper-Math-Backend',BACKEND_ID)
            self.send_header('X-Paper-Math-Project',bundle['project_id'])
            self.send_header('X-Paper-Math-Font',bundle['postscript_name'])
            self.send_header('X-Paper-Math-Revision',str(bundle['revision']))
            self.send_header('Access-Control-Expose-Headers',
                'Content-Length,Content-Disposition,X-Paper-Math-Backend,X-Paper-Math-Project,X-Paper-Math-Font,X-Paper-Math-Revision')
            self.cors()
            self.end_headers()
            self.wfile.write(bundle['data'])

        def check_origin(self):
            if safe_origin(self.headers.get('Origin')):
                return True
            self.reply(403, {'ok': False, 'error': '外部Webサイトからの操作は許可されません。'})
            return False

        def do_OPTIONS(self):
            if not self.check_origin():
                return
            self.send_response(204)
            self.cors()
            self.send_header('Content-Length', '0')
            self.end_headers()

        def do_GET(self):
            if not self.check_origin():
                return
            try:
                if self.path == '/api/health':
                    with _REGISTRY_LOCK:
                        pid, meta, reg = selected_project()
                        if pid == 'legacy':
                            reg = load_registry()
                        font_path = FONT_FILE if pid == 'legacy' else project_font_file(pid)
                    return self.reply(200, {'ok': True, 'version': '0.8.0',
                                            'backend': BACKEND_ID,
                                            'app_root': str(ROOT), 'data_root': str(DATA_ROOT),
                                            'registered': len(reg['entries']),
                                            'next_codepoint': reg['next_codepoint'],
                                            'font_exists': font_path.is_file(),
                                            'project_id': pid, 'font': reg['font'],
                                            'display_name': (meta or {}).get('name',reg['font']['family'])})
                if self.path == '/api/projects':
                    with _REGISTRY_LOCK:
                        pid = active_project()
                        project_list = list_projects()
                    return self.reply(200, {'ok': True, 'backend': BACKEND_ID,
                                            'active': pid, 'projects': project_list})
                if self.path == '/api/restore/map':
                    with _REGISTRY_LOCK:
                        pid, meta, reg = selected_project()
                        registry = load_registry() if pid == 'legacy' else reg
                        validate_registry(registry)
                        entries = [
                            {'latex': e['latex'], 'codepoint': e['codepoint'],
                             'char': chr(int(e['codepoint'], 16))}
                            for e in registry['entries']
                        ]
                    return self.reply(200, {
                        'ok': True, 'backend': BACKEND_ID,
                        'font': {
                            'family': registry['font']['family'],
                            'postscript_name': registry['font']['postscript_name'],
                        },
                        'revision': len(entries), 'entries': entries,
                        'project_id': pid,
                    })
                if self.path == '/api/font/export-zip':
                    with _REGISTRY_LOCK:
                        pid,meta,reg=selected_project()
                        registry=load_registry() if pid=='legacy' else reg
                        current=font_is_current(registry) if pid=='legacy' else project_font_current(pid)
                        if not current:
                            raise GuardError('生成OTFが現在の対応表と一致しません。先に数式を変換してください。')
                        font=FONT_FILE if pid=='legacy' else project_font_file(pid)
                        bundle=make_font_bundle(registry,font.read_bytes(),project_id=pid,
                            display_name=meta['name'] if meta else registry['font']['family'],project=meta)
                    return self.reply_archive(bundle)
                if self.path == '/api/font/preview-html':
                    # Local, read-only snapshot of this product's generated OTF
                    # and registry. Never accept client-supplied font paths.
                    with _REGISTRY_LOCK:
                        pid, meta, reg = selected_project()
                        registry = load_registry() if pid == 'legacy' else reg
                        validate_registry(registry)
                        if pid == 'legacy':
                            current = font_is_current(registry)
                            font = FONT_FILE
                        else:
                            current = project_font_current(pid)
                            font = project_font_file(pid)
                        if not current:
                            raise GuardError('生成OTFが現在の登録簿と一致しません。先にフォントを確認してください。')
                        html = make_current_preview(registry, font,
                                                    meta['name'] if meta else None)
                    return self.reply_html(200, html)
                if self.path == '/api/font/status':
                    with _REGISTRY_LOCK:
                        pid, _, _ = selected_project()
                        try:
                            result = (sync_status(SOURCE, windows_registry_entries())
                                      if pid == 'legacy' else project_windows_status(pid))
                        except GuardError as exc:
                            result = {'state': 'blocked', 'reason': str(exc)}
                    return self.reply(200, {'ok': True, 'backend': BACKEND_ID,
                                            'project_id': pid, **result})
                if self.path == '/api/font/verify':
                    with _REGISTRY_LOCK:
                        pid, _, _ = selected_project()
                        synced = (sync_status(SOURCE, windows_registry_entries())
                                  if pid == 'legacy' else project_windows_status(pid))
                        if synced['state'] != 'current':
                            raise GuardError('フォントが一致しません。')
                    return self.reply(200, {'ok': True, 'backend': BACKEND_ID,
                                            'project_id': pid, 'sync': synced})
                return self.reply(404, {'ok': False, 'error': 'Not found'})
            except GuardError as exc:
                return self.reply(409, {'ok': False, 'error': str(exc)})
            except Exception as exc:
                logging.exception('Font status failed')
                return self.reply(500, {'ok': False, 'error': str(exc)})

        def do_POST(self):
            if not self.check_origin():
                return
            if self.path not in ('/api/prepare', '/api/font/update/open',
                                 '/api/projects/create', '/api/projects/select', '/api/projects/rename'):
                return self.reply(404, {'ok': False, 'error': 'Not found'})
            try:
                length = int(self.headers.get('Content-Length', '-1'))
                if not 0 < length <= MAX_BODY_BYTES:
                    return self.reply(413, {'ok': False, 'error': '送信内容が空、または上限を超えています。'})
                if not self.headers.get('Content-Type', '').lower().startswith('application/json'):
                    return self.reply(415, {'ok': False, 'error': 'application/json が必要です。'})
                payload = json.loads(self.rfile.read(length).decode('utf-8'))
                if not isinstance(payload, dict):
                    raise ValueError('JSONの形式が正しくありません。')
                if self.path == '/api/projects/create':
                    if set(payload) != {'name'}:
                        raise ValueError('新規作成にはnameだけを指定してください。')
                    with _REGISTRY_LOCK:
                        result = create_project(payload['name'])
                    return self.reply(200, {'ok': True, 'backend': BACKEND_ID, 'project': result})
                if self.path == '/api/projects/rename':
                    if set(payload)!={'project_id','name'}:
                        raise ValueError('表示名変更にはproject_idとnameだけを指定してください。')
                    with _REGISTRY_LOCK:
                        if payload['project_id']!=active_project() or payload['project_id']=='legacy':
                            raise ValueError('選択中のPaper Mathフォントの表示名を変更してください。')
                        result=rename_project(payload['project_id'],payload['name'])
                    return self.reply(200,{'ok':True,'backend':BACKEND_ID,'project':result})
                if self.path == '/api/projects/select':
                    if set(payload) != {'project_id'}:
                        raise ValueError('切替にはproject_idだけを指定してください。')
                    with _REGISTRY_LOCK:
                        pid = select_project(payload['project_id'])
                    return self.reply(200, {'ok': True, 'backend': BACKEND_ID,
                                            'active': pid})
                if self.path == '/api/prepare':
                    with _REGISTRY_LOCK:
                        pid, _, _ = selected_project()
                        if payload.get('partial') is True:
                            from partial_prepare import prepare_partial
                            result = prepare_partial(pid,payload.get('text'))
                        else:
                            result = (prepare_source(payload.get('text'))
                                      if pid == 'legacy' else prepare_project(pid,payload.get('text')))
                        if pid == 'legacy':
                            result['font'] = load_registry()['font']
                            result['project_id'] = 'legacy'
                    return self.reply(200, {'ok': True, 'backend': BACKEND_ID, **result})
                # No path, filename, command or registry key can be supplied by the client.
                if payload:
                    raise ValueError('フォント更新APIに引数は指定できません。')
                with _REGISTRY_LOCK:
                    pid, _, _ = selected_project()
                    if pid != 'legacy':
                        result = open_explorer(direct_source=project_font_file(pid))
                        before = {'result': 'project_font_manual_install'}
                    else:
                        registrations = windows_registry_entries()
                        before = prepare_font_update(SOURCE, registrations) if registrations else {'result':'first_install'}
                        result = open_explorer(direct_source=SOURCE if not registrations else None)
                return self.reply(200, {'ok': True, 'backend': BACKEND_ID,
                                        'check': before, **result})
            except (ValueError, KeyError, UnicodeError, json.JSONDecodeError) as exc:
                return self.reply(400, {'ok': False, 'error': str(exc)})
            except GuardError as exc:
                return self.reply(409, {'ok': False, 'error': str(exc)})
            except Exception as exc:
                logging.exception('Registration or Windows Shell operation failed')
                return self.reply(500, {'ok': False, 'error': str(exc)})

        def log_message(self, fmt, *args):
            logging.info('%s %s', self.address_string(), fmt % args)
    return Handler


def bootstrap_font():
    """Fail before binding the port when the local OTF conflicts with the registry.

    This also covers direct `python tools/local_server.py` launches; it does not
    trust a same-named OTF left behind by the RaTeX/Node experiment.
    """
    with _REGISTRY_LOCK:
        return refresh(load_registry(), [], force_build=False)


def main():
    parser = argparse.ArgumentParser(description='Local Photoshop UXP to LaTeX bridge')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    if not (1 <= args.port <= 65535):
        parser.error('Port must be 1..65535')
    try:
        initialize_data()
        bootstrap_font()
    except Exception as exc:
        raise SystemExit('ERROR: フォント再生成の整合性検査に失敗しました。サーバーは起動しません: ' + str(exc)) from exc
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
    ThreadingHTTPServer.allow_reuse_address = True
    try:
        with ThreadingHTTPServer((HOST, args.port), make_handler()) as server:
            print('Paper Math — LaTeX / Python fontTools bridge')
            print('Copyright (C) 2026 Paper Math contributors. AGPL-3.0-only; no warranty.')
            print('Source is included in this project folder. See LICENSE and LICENSE_SCOPE.md.')
            print(f'Local API: http://{HOST}:{args.port}/api/health')
            print(f'Registry: {DATA_ROOT / "assets" / "registry.json"}')
            print('終了するには Ctrl+C。Photoshopでの操作中は閉じないでください。', flush=True)
            server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        print('\nサーバーを終了しました。')
    except OSError as exc:
        raise SystemExit('ERROR: ローカルポートを開けません: ' + str(exc)) from exc


if __name__ == '__main__':
    main()
