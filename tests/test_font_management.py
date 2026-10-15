"""Display-label persistence and complete ZIP snapshots, no OS font writes."""
import hashlib
import json
import sys
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import project_fonts as pf
from font_bundle import make_font_bundle
from font_bundle_fixture import synthetic_font

class FontManagement(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.base=Path(self.temp.name)
        self.store=self.base/'projects'
        self.pid=pf.create('数式 A',self.store)['project_id']
        self.folder=self.store/self.pid
        meta,reg=pf._load(self.pid,self.store)
        reg['entries']=[{'codepoint':'E000','latex':'x^2','mode':'inline',
                         'svg':'C:/private/source-cache.svg'}]
        reg['next_codepoint']='E001'
        self.font_data=synthetic_font(reg,self.base/'draw')
        pf.font_file(self.pid,self.store).write_bytes(self.font_data)
        (self.folder/'registry.json').write_text(json.dumps(reg,ensure_ascii=False),encoding='utf-8')
        (self.folder/'stamp.json').write_text(json.dumps({'source_key':pf._identity(reg),
            'sha256':hashlib.sha256(self.font_data).hexdigest()}))
        pf.select(self.pid,self.store)

    def tearDown(self):self.temp.cleanup()

    def snapshot(self):
        return {p.name:p.read_bytes() for p in self.folder.iterdir() if p.is_file()}

    def test_rename_changes_only_label_and_survives_reload(self):
        before=self.snapshot()
        active=(self.store/'active.json').read_bytes()
        info=pf.rename(self.pid,'数式 B',self.store)
        self.assertEqual(info['name'],'数式 B')
        self.assertEqual(info['registered'],1)
        after=self.snapshot()
        for name in before:
            if name!='project.json':self.assertEqual(before[name],after[name])
        old=json.loads(before['project.json']);new=json.loads(after['project.json'])
        self.assertEqual({**old,'name':'数式 B'},new)
        self.assertEqual(pf._load(self.pid,self.store)[0]['name'],'数式 B')
        self.assertTrue(pf.font_current(self.pid,self.store))
        self.assertEqual((self.store/'active.json').read_bytes(),active)

    def test_duplicate_reserved_and_bad_name_never_modify_files(self):
        pf.create('Other',self.store)
        before=self.snapshot()
        for name in ('other','Regular','Paper Math','../bad',''):
            with self.subTest(name=name),self.assertRaises(ValueError):pf.rename(self.pid,name,self.store)
        self.assertEqual(self.snapshot(),before)

    def test_rename_write_failure_preserves_all_assets(self):
        before=self.snapshot()
        with patch.object(pf,'write_text_atomic',side_effect=OSError('cannot write')):
            with self.assertRaises(OSError):pf.rename(self.pid,'New',self.store)
        self.assertEqual(self.snapshot(),before)

    def test_zip_is_readonly_complete_and_has_no_cache_paths(self):
        before=self.snapshot();meta,reg=pf._load(self.pid,self.store)
        bundle=make_font_bundle(reg,self.font_data,project_id=self.pid,display_name=meta['name'],project=meta)
        with ZipFile(BytesIO(bundle['data'])) as archive:
            self.assertIsNone(archive.testzip())
            names=set(archive.namelist())
            self.assertEqual(names,{meta['font']['postscript_name']+'.otf','registry.json','project.json','stamp.json','README.txt','bundle.json',
                                    'FONT_NOTICES.txt','font-sources.json','licenses/OFL-1.1.txt',
                                    'licenses/GUST-FONT-LICENSE.txt','licenses/LPPL-1.3c.txt'})
            manifest=json.loads(archive.read('bundle.json'))
            for name,digest in manifest['files'].items():
                self.assertEqual(hashlib.sha256(archive.read(name)).hexdigest(),digest)
            exported=json.loads(archive.read('registry.json'))
            self.assertEqual(exported['entries'][0]['latex'],'x^2')
            self.assertNotIn('svg',exported['entries'][0])
            self.assertNotIn(b'C:/private',archive.read('registry.json'))
            self.assertEqual(archive.read(meta['font']['postscript_name']+'.otf'),self.font_data)
            stamp=json.loads(archive.read('stamp.json'))
            self.assertEqual(stamp['source_key'],pf._identity(exported))
            self.assertEqual(manifest['display_name'],'数式 A')
            self.assertEqual(manifest['revision'],1)
            self.assertEqual(manifest['font_license_notices'],'source-review-required')
            self.assertEqual(json.loads(archive.read('font-sources.json'))['missing_codepoints'],['E000'])
        self.assertEqual(self.snapshot(),before)

    def test_wrong_font_or_incomplete_mapping_is_rejected(self):
        meta,reg=pf._load(self.pid,self.store)
        wrong=json.loads(json.dumps(reg));wrong['font']['postscript_name']='Wrong-Regular'
        with self.assertRaisesRegex(ValueError,'内部名'):
            make_font_bundle(wrong,self.font_data,project_id='legacy',display_name='Wrong')
        extra=json.loads(json.dumps(reg));extra['entries'].append({'codepoint':'E001','latex':'y','mode':'inline'});extra['next_codepoint']='E002'
        with self.assertRaisesRegex(ValueError,'PUA文字集合'):
            make_font_bundle(extra,self.font_data,project_id=self.pid,display_name=meta['name'],project=meta)

    def test_empty_unmanaged_and_filename_injection_are_rejected(self):
        meta,reg=pf._load(self.pid,self.store)
        for pid in ('../private','pm-nope'):
            with self.assertRaises(ValueError):make_font_bundle(reg,self.font_data,project_id=pid,display_name=meta['name'],project=meta)
        bad=json.loads(json.dumps(reg));bad['font']['postscript_name']='../private'
        with self.assertRaises(ValueError):make_font_bundle(bad,self.font_data,project_id='legacy',display_name='Test')
        empty=json.loads(json.dumps(reg));empty['entries']=[];empty['next_codepoint']='E000'
        with self.assertRaises(ValueError):make_font_bundle(empty,b'',project_id='legacy',display_name='Test')
        with self.assertRaises(ValueError):pf.rename('legacy','Test',self.store)

    def test_legacy_export_keeps_mapping_without_managed_project_metadata(self):
        _,reg=pf._load(self.pid,self.store)
        bundle=make_font_bundle(reg,self.font_data,project_id='legacy',display_name='Legacy')
        with ZipFile(BytesIO(bundle['data'])) as archive:
            self.assertNotIn('project.json',archive.namelist())
            self.assertNotIn('stamp.json',archive.namelist())
            self.assertEqual(json.loads(archive.read('registry.json'))['entries'][0]['codepoint'],'E000')

if __name__=='__main__':unittest.main()
