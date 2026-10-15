"""v0.5 loopback bridge regression tests (existing equations, no mutation)."""
from __future__ import annotations

import json
import socketserver
import sys
import threading
from http.client import HTTPConnection
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from local_server import make_handler, prepare_source, safe_origin
from registry import FONT_FILE, REGISTRY, load_registry


def request(port, method, path, json_body=None, headers=None):
    conn = HTTPConnection('127.0.0.1', port, timeout=10)
    hdrs = headers or {}
    if json_body is not None:
        hdrs = {'Content-Type': 'application/json', **hdrs}
    payload = json.dumps(json_body, ensure_ascii=False).encode('utf-8') if json_body is not None else None
    conn.request(method, path, body=payload, headers=hdrs)
    resp = conn.getresponse()
    data = json.loads(resp.read().decode('utf-8')) if resp.status != 204 else {}
    code = resp.status
    conn.close()
    return code, data


def main():
    before_registry = REGISTRY.read_bytes()
    before_font = FONT_FILE.read_bytes()
    existing = prepare_source('数式 $x_i^2$ と $\\alpha+\\beta$、再利用 $x_i^2$')
    assert existing['new_count'] == 0
    assert existing['formula_instances'] == 3
    assert existing['unique_formulas'] == 2
    assert existing['converted'] == '数式 \ue004 と \ue005、再利用 \ue004'
    assert existing['entries'] == [
        {'latex':'x_i^2','codepoint':'E004','char':'\ue004'},
        {'latex':r'\alpha+\beta','codepoint':'E005','char':'\ue005'}]
    assert REGISTRY.read_bytes() == before_registry
    assert FONT_FILE.read_bytes() == before_font
    assert safe_origin('https://attacker.example') is False
    assert safe_origin('uxp://com.example') is True
    assert safe_origin(None) is True

    from http.server import ThreadingHTTPServer
    with ThreadingHTTPServer(('127.0.0.1', 0), make_handler()) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_address[1]
        status, data = request(port, 'GET', '/api/health')
        assert status == 200 and data['ok'] and data['registered'] == len(load_registry()['entries'])
        status, data = request(port, 'POST', '/api/prepare', {'text':'式 $x_i^2$'})
        assert status == 200 and data['ok'] and data['new_count'] == 0
        assert data['converted'] == '式 \ue004'
        status, data = request(port, 'POST', '/api/prepare', {'text':'式 $\\badTeXCommand123{a}$'})
        assert status == 500 and not data['ok']
        status, data = request(port, 'POST', '/api/prepare', {'text':'$x^2'},
                               {'Origin':'https://attacker.example'})
        assert status == 403
        status, data = request(port, 'POST', '/api/prepare', {'text':'$$x^2$$'})
        assert status == 400
        status, data = request(port, 'GET', '/invalid')
        assert status == 404
        server.shutdown()
        thread.join(3)
    assert REGISTRY.read_bytes() == before_registry
    assert FONT_FILE.read_bytes() == before_font
    print('PASS v0.5 loopback API: reuse, HTTP, error rollback, origin restrictions')

if __name__ == '__main__':
    main()

