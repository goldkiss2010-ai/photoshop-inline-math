"""HTTP contract for project fonts; no OTF builds or OS font changes."""
from __future__ import annotations
import json
import sys
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import local_server as server


PID='pm-'+'a'*16
FONT={'family':'Paper Math '+'a'*16,
      'postscript_name':'PaperMath'+'a'*16+'-Regular','engine':'pdflatex'}
REG={'schema':1,'font':FONT,'next_codepoint':'E000','entries':[]}


class ProjectAPI(unittest.TestCase):
    def setUp(self):
        self.http=ThreadingHTTPServer(('127.0.0.1',0),server.make_handler())
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True)
        self.thread.start()

    def tearDown(self):
        self.http.shutdown()
        self.thread.join(3)
        self.http.server_close()

    def request(self,method,path,data=None,origin=None):
        conn=HTTPConnection('127.0.0.1',self.http.server_address[1],timeout=5)
        body=json.dumps(data).encode('utf-8') if data is not None else None
        headers={'Content-Type':'application/json'} if body is not None else {}
        if origin: headers['Origin']=origin
        try:
            conn.request(method,path,body,headers)
            response=conn.getresponse()
            return response.status,json.loads(response.read().decode('utf-8'))
        finally:
            conn.close()

    def test_project_create_and_select_accept_only_managed_parameters(self):
        info={'project_id':PID,'name':'日本語 数式','font':FONT,'registered':0}
        with patch.object(server,'create_project',return_value=info) as create, \
             patch.object(server,'select_project',return_value=PID) as select:
            status,value=self.request('POST','/api/projects/create',{'name':'日本語 数式'})
            self.assertEqual(status,200)
            self.assertEqual(value['project']['project_id'],PID)
            create.assert_called_once_with('日本語 数式')
            status,value=self.request('POST','/api/projects/select',{'project_id':PID})
            self.assertEqual(status,200)
            self.assertEqual(value['active'],PID)
            select.assert_called_once_with(PID)
            status,value=self.request('POST','/api/projects/create',
                                      {'name':'A','font_path':'C:\\Windows\\Fonts\\Other.otf'})
            self.assertEqual(status,400)
            self.assertEqual(create.call_count,1)

    def test_selected_project_is_exposed_by_health_list_and_mapping(self):
        with patch.object(server,'selected_project',return_value=(PID,{'font':FONT},REG)), \
             patch.object(server,'active_project',return_value=PID), \
             patch.object(server,'list_projects',return_value=[]), \
             patch.object(server,'project_font_file',return_value=Path('/nonexistent.otf')):
            status,health=self.request('GET','/api/health')
            self.assertEqual(status,200)
            self.assertEqual(health['project_id'],PID)
            self.assertEqual(health['backend'],server.BACKEND_ID)
            self.assertEqual(health['font']['postscript_name'],FONT['postscript_name'])
            status,listing=self.request('GET','/api/projects')
            self.assertEqual(status,200)
            self.assertEqual(listing['active'],PID)
            self.assertEqual(listing['backend'],server.BACKEND_ID)
            status,links=self.request('GET','/api/restore/map')
            self.assertEqual(status,200)
            self.assertEqual(links['entries'],[])
            self.assertEqual(links['project_id'],PID)
            self.assertEqual(links['backend'],server.BACKEND_ID)

    def test_partial_prepare_routes_and_exposes_local_holds(self):
        result={'project_id':PID,'font':FONT,'revision':1,'formula_instances':1,
                'candidate_instances':2,'entries':[{'latex':'x','codepoint':'E000','char':'\ue000'}],
                'converted':'\ue000 $bad$','issues':[{'code':'render-failed','from':4,'to':9,'message':'bad'}]}
        with patch.object(server,'selected_project',return_value=(PID,{'font':FONT},REG)), \
             patch('partial_prepare.prepare_partial',return_value=result) as prepare, \
             patch.object(server,'prepare_project',side_effect=AssertionError('strict path called')):
            status,value=self.request('POST','/api/prepare',{'text':'$x$ $bad$','partial':True})
            self.assertEqual(status,200)
            self.assertEqual(value['formula_instances'],1)
            self.assertEqual(value['issues'][0]['code'],'render-failed')
            self.assertEqual(value['converted'],'\ue000 $bad$')
            prepare.assert_called_once_with(PID,'$x$ $bad$')

    def test_prepare_routes_to_selected_project_not_legacy_registry(self):
        converted={'project_id':PID,'font':FONT,'entries':[{'latex':'x',
                   'codepoint':'E000','char':'\ue000'}],
                   'converted':'\ue000','revision':1,'formula_instances':1,
                   'new_count':1}
        with patch.object(server,'selected_project',return_value=(PID,{},REG)), \
             patch.object(server,'prepare_project',return_value=converted) as prepare, \
             patch.object(server,'prepare_source') as legacy:
            status,result=self.request('POST','/api/prepare',{'text':'$x$'})
            self.assertEqual(status,200)
            self.assertEqual(result['font'],FONT)
            self.assertEqual(result['backend'],server.BACKEND_ID)
            prepare.assert_called_once_with(PID,'$x$')
            legacy.assert_not_called()

    def test_font_status_and_external_origin_guard(self):
        with patch.object(server,'selected_project',return_value=(PID,{},REG)), \
             patch.object(server,'project_windows_status',
                          return_value={'state':'update_required'}) as check:
            status,result=self.request('GET','/api/font/status')
            self.assertEqual(status,200)
            self.assertEqual(result['project_id'],PID)
            self.assertEqual(result['state'],'update_required')
            self.assertEqual(result['backend'],server.BACKEND_ID)
            check.assert_called_once_with(PID)
            status,result=self.request('GET','/api/projects',origin='https://attacker.example')
            self.assertEqual(status,403)


if __name__=='__main__':
    unittest.main()

