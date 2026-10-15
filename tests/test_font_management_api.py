"""HTTP rename/export contracts using isolated real project assets."""
import hashlib
import json
import sys
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import local_server as server
import project_fonts as pf
from font_bundle_fixture import synthetic_font

class FontManagementAPI(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name);self.store=self.base/'projects'
        self.pid=pf.create('First',self.store)['project_id'];self.folder=self.store/self.pid
        meta,reg=pf._load(self.pid,self.store)
        reg['entries']=[{'codepoint':'E000','latex':'x','mode':'inline'}];reg['next_codepoint']='E001'
        data=synthetic_font(reg,self.base/'drawing');pf.font_file(self.pid,self.store).write_bytes(data)
        (self.folder/'registry.json').write_text(json.dumps(reg))
        (self.folder/'stamp.json').write_text(json.dumps({'source_key':pf._identity(reg),'sha256':hashlib.sha256(data).hexdigest()}))
        pf.select(self.pid,self.store)
        self.patches=[patch.object(server,'selected_project',side_effect=lambda:pf.selected(self.store)),
            patch.object(server,'active_project',side_effect=lambda:pf.active(self.store)),
            patch.object(server,'list_projects',side_effect=lambda:pf.projects(self.store)),
            patch.object(server,'rename_project',side_effect=lambda pid,name:pf.rename(pid,name,self.store)),
            patch.object(server,'project_font_current',side_effect=lambda pid:pf.font_current(pid,self.store)),
            patch.object(server,'project_font_file',side_effect=lambda pid:pf.font_file(pid,self.store)),
            patch.object(server,'refresh',side_effect=AssertionError('export must not build'))]
        for p in self.patches:p.start()
        self.http=ThreadingHTTPServer(('127.0.0.1',0),server.make_handler())
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()

    def tearDown(self):
        self.http.shutdown();self.thread.join(3);self.http.server_close()
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()

    def request(self,method,path,data=None,origin=None):
        conn=HTTPConnection('127.0.0.1',self.http.server_address[1],timeout=5)
        body=json.dumps(data).encode() if data is not None else None
        headers={'Content-Type':'application/json'} if data is not None else {}
        if origin:headers['Origin']=origin
        try:
            conn.request(method,path,body,headers);r=conn.getresponse()
            return r.status,dict(r.getheaders()),r.read()
        finally:conn.close()

    def test_rename_survives_health_list_and_export_without_changing_otf(self):
        otf=pf.font_file(self.pid,self.store);before=otf.read_bytes()
        status,_,body=self.request('POST','/api/projects/rename',{'project_id':self.pid,'name':'数式 新名'})
        self.assertEqual(status,200);self.assertEqual(json.loads(body)['project']['name'],'数式 新名')
        _,_,body=self.request('GET','/api/health');health=json.loads(body)
        self.assertEqual(health['display_name'],'数式 新名');self.assertEqual(health['registered'],1)
        _,_,body=self.request('GET','/api/projects');self.assertEqual(json.loads(body)['projects'][0]['name'],'数式 新名')
        status,headers,body=self.request('GET','/api/font/export-zip',origin='null')
        self.assertEqual(status,200);self.assertEqual(headers['Content-Type'],'application/zip')
        self.assertEqual(headers['X-Paper-Math-Project'],self.pid)
        self.assertEqual(headers['X-Paper-Math-Revision'],'1')
        self.assertEqual(headers['Content-Length'],str(len(body)))
        self.assertIn('X-Paper-Math-Project',headers['Access-Control-Expose-Headers'])
        with ZipFile(BytesIO(body)) as archive:
            self.assertIsNone(archive.testzip())
            exported=json.loads(archive.read('project.json'))
            self.assertEqual(exported['name'],'数式 新名')
            self.assertEqual(exported['creation_name'],'First')
            self.assertEqual(exported['schema'],2)
            self.assertEqual(exported['font']['family'],health['font']['family'])
            self.assertEqual(json.loads(archive.read('registry.json'))['entries'][0]['latex'],'x')
        self.assertEqual(otf.read_bytes(),before)

    def test_foreign_selected_project_and_extra_path_arguments_are_rejected(self):
        other=pf.create('Other',self.store)['project_id']
        before=(self.folder/'project.json').read_bytes()
        for payload in ({'project_id':other,'name':'Wrong'},
                        {'project_id':self.pid,'name':'New','path':'C:/private'},
                        {'project_id':'legacy','name':'New'}):
            status,_,_=self.request('POST','/api/projects/rename',payload);self.assertEqual(status,400)
        self.assertEqual((self.folder/'project.json').read_bytes(),before)

    def test_stale_or_missing_font_never_returns_archive(self):
        pf.font_file(self.pid,self.store).write_bytes(b'stale font')
        status,headers,body=self.request('GET','/api/font/export-zip')
        self.assertEqual(status,409);self.assertNotEqual(headers['Content-Type'],'application/zip')
        self.assertFalse(json.loads(body)['ok'])

    def test_empty_project_never_generates_a_font_for_export(self):
        empty=pf.create('Empty',self.store)['project_id'];pf.select(empty,self.store)
        status,_,_=self.request('GET','/api/font/export-zip');self.assertEqual(status,409)
        self.assertFalse(pf.font_file(empty,self.store).exists())

    def test_external_origin_and_client_supplied_export_paths_are_rejected(self):
        status,_,_=self.request('GET','/api/font/export-zip',origin='https://outside.example')
        self.assertEqual(status,403)
        status,_,_=self.request('GET','/api/font/export-zip?path=C:/private')
        self.assertEqual(status,404)

    def test_legacy_can_export_existing_font_but_cannot_rename(self):
        _,reg=pf._load(self.pid,self.store);font=pf.font_file(self.pid,self.store)
        with patch.object(server,'selected_project',return_value=('legacy',None,None)),\
             patch.object(server,'load_registry',return_value=reg),\
             patch.object(server,'font_is_current',return_value=True),\
             patch.object(server,'FONT_FILE',font):
            status,headers,body=self.request('GET','/api/font/export-zip')
        self.assertEqual(status,200);self.assertEqual(headers['X-Paper-Math-Project'],'legacy')
        with ZipFile(BytesIO(body)) as archive:
            self.assertNotIn('project.json',archive.namelist())

if __name__=='__main__':unittest.main()
