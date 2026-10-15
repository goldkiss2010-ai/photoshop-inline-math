"""Read-only UXP restore map: isolated local server, no font/PSD writes."""
from __future__ import annotations

import json
import sys
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import local_server


def fixture():
    return {
        'schema': 1, 'next_codepoint': 'E002',
        'font': {'family': 'Test Math', 'postscript_name': 'TestMath-Regular'},
        'entries': [
            {'codepoint': 'E000', 'latex': 'x_i', 'mode': 'inline'},
            {'codepoint': 'E001', 'latex': r'\frac{a}{b}', 'mode': 'inline'},
        ]
    }


def get(port, path, origin=None):
    conn=HTTPConnection("127.0.0.1",port,timeout=5)
    headers={} if origin is None else {'Origin':origin}
    try:
        conn.request('GET',path,headers=headers)
        response=conn.getresponse()
        return response.status,json.loads(response.read().decode('utf-8'))
    finally:
        conn.close()


class RestoreMapTests(unittest.TestCase):
    def test_restore_mapping_is_stable_and_does_not_refresh(self):
        before=fixture()
        data=json.dumps(before,sort_keys=True)
        with patch.object(local_server, 'load_registry', return_value=before), \
             patch.object(local_server, 'refresh', side_effect=AssertionError('must not rebuild')):
            with ThreadingHTTPServer(('127.0.0.1',0),local_server.make_handler()) as server:
                worker=threading.Thread(target=server.serve_forever,daemon=True)
                worker.start()
                try:
                    port=server.server_address[1]
                    code,response=get(port,'/api/restore/map')
                    self.assertEqual(code,200)
                    self.assertEqual(response['backend'],local_server.BACKEND_ID)
                    self.assertEqual(response['font']['postscript_name'],'TestMath-Regular')
                    self.assertEqual(response['revision'],2)
                    self.assertEqual(response['entries'],[
                        {'codepoint':'E000','char':'\ue000','latex':'x_i'},
                        {'codepoint':'E001','char':'\ue001','latex':r'\frac{a}{b}'}])
                    self.assertEqual(get(port,'/api/restore/map')[1],response)
                    self.assertEqual(get(port,'/api/restore/map','https://attacker.invalid')[0],403)
                    self.assertEqual(get(port,'/api/restore/unknown')[0],404)
                finally:
                    server.shutdown()
                    worker.join(timeout=3)
        self.assertEqual(json.dumps(before,sort_keys=True),data)


if __name__=='__main__':
    unittest.main()

