"""Project font management tests; no TeX render, OTF install, or legacy writes."""
from __future__ import annotations
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import project_fonts as pf


class MockTTFont:
    def __init__(self,file):
        self.entries={0xE000:'mathE000'}
    def __enter__(self): return self
    def __exit__(self,*a): return False
    def getBestCmap(self): return self.entries
    def __getitem__(self,key):
        return MockNameTable()


class MockNameTable:
    def getDebugName(self,key):
        return MockTTFont.family if key==1 else MockTTFont.postscript


class FontProjectTests(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory()
        self.store=Path(self.t.name)/'project-fonts'

    def tearDown(self):
        self.t.cleanup()

    def create(self,name):
        return pf.create(name,store=self.store)

    def test_fresh_project_is_empty_independent_and_persistent(self):
        a=self.create('数式図版 2026')
        b=self.create('Paper Study')
        self.assertNotEqual(a['project_id'],b['project_id'])
        self.assertEqual(a['registered'],0)
        self.assertFalse(a['generated'])
        self.assertEqual(pf.active(self.store),'legacy')
        self.assertEqual(len(pf.projects(self.store)),2)
        self.assertEqual(pf.select(a['project_id'],self.store),a['project_id'])
        self.assertEqual(pf.selected(self.store)[0],a['project_id'])
        self.assertEqual(pf.selected(self.store)[2]['entries'],[])
        self.assertIn('数式図版 2026',a['font']['family'])
        self.assertTrue(a['font']['family'].endswith(a['project_id'][3:11]))
        self.assertTrue(a['font']['postscript_name'].isascii())
        self.assertIn('数式図版',a['name'])
        pf.select('legacy',self.store)
        self.assertEqual(pf.active(self.store),'legacy')

    def test_long_names_keep_complete_short_id_within_windows_family_limit(self):
        for name in ('Long Project Name For Figure','数式図版用フォント二十八文字まで入力できる名前', '\U00010400'*28):
            with self.subTest(name=name):
                p=self.create(name)
                family=p['font']['family']
                self.assertLessEqual(len(family.encode('utf-16-be'))//2,31)
                self.assertTrue(family.endswith(p['project_id'][3:11]))
                self.assertTrue(family.startswith('Paper Math '+name[0]))
                self.assertEqual(pf.info(p['project_id'],self.store)['font'],p['font'])

    def test_same_short_id_and_truncated_label_regenerates_identity(self):
        first=SimpleNamespace(hex='1234567800000000'+'0'*16)
        collision=SimpleNamespace(hex='1234567811111111'+'0'*16)
        distinct=SimpleNamespace(hex='8765432100000000'+'0'*16)
        with patch.object(pf.uuid,'uuid4',side_effect=[first,collision,distinct]):
            a=self.create('Long Shared Label A')
            b=self.create('Long Shared Label B')
        self.assertNotEqual(a['font']['family'],b['font']['family'])
        self.assertEqual(b['project_id'],'pm-8765432100000000')
        self.assertEqual(len(pf.projects(self.store)),2)

    def test_schema_one_keeps_old_identity_and_files_on_load_select_and_rename(self):
        p=self.create('旧フォント')
        pid=p['project_id'];folder=self.store/pid
        meta,reg=pf._load(pid,self.store)
        meta['schema']=1;meta.pop('creation_name')
        meta['font']['family']='Paper Math '+pid[3:]
        reg['font']=meta['font']
        for filename,value in (('project.json',meta),('registry.json',reg)):
            (folder/filename).write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')
        before=(folder/'registry.json').read_bytes()
        pf.select(pid,self.store)
        self.assertEqual(pf.selected(self.store)[1]['font'],meta['font'])
        renamed=pf.rename(pid,'旧フォント別名',self.store)
        self.assertEqual(renamed['font'],meta['font'])
        self.assertEqual((folder/'registry.json').read_bytes(),before)
        self.assertNotIn('creation_name',pf._load(pid,self.store)[0])

    def test_managed_family_and_fixed_creation_label_are_validated_together(self):
        p=self.create('Fixed Name')
        folder=self.store/p['project_id']
        meta,reg=pf._load(p['project_id'],self.store)
        meta['creation_name']='Other Name'
        (folder/'project.json').write_text(json.dumps(meta),encoding='utf-8')
        with self.assertRaises(ValueError):pf.info(p['project_id'],self.store)
        meta['creation_name']='Fixed Name'
        meta['font']['family']=reg['font']['family']='Other Family'
        for filename,value in (('project.json',meta),('registry.json',reg)):
            (folder/filename).write_text(json.dumps(value),encoding='utf-8')
        with self.assertRaises(ValueError):pf.info(p['project_id'],self.store)

    def test_bad_names_and_unmanaged_ids_never_create_or_select(self):
        for name in ('','..','../evil','Inline Math Lab','a'*29):
            with self.assertRaises(ValueError):
                self.create(name)
        for pid in ('../evil','PaperMath-Regular','pm-nope','pm-'+'A'*16):
            with self.assertRaises(ValueError):
                pf.select(pid,self.store)
        self.assertEqual(pf.projects(self.store),[])

    def test_duplicate_name_rejected_even_different_case(self):
        self.create('Test Font')
        with self.assertRaises(ValueError):
            self.create('test font')
        self.assertEqual(len(pf.projects(self.store)),1)

    def test_metadata_cannot_change_otf_identity_or_escape_folder(self):
        p=self.create('数式')
        folder=pf._path(p['project_id'],self.store)
        data=json.loads((folder/'registry.json').read_text(encoding='utf-8'))
        data['font']['postscript_name']='OtherCompany-Regular'
        (folder/'registry.json').write_text(json.dumps(data),encoding='utf-8')
        with self.assertRaises(ValueError):
            pf.info(p['project_id'],self.store)

    def test_two_projects_can_use_E000_without_sharing_latex(self):
        a=self.create('A')
        b=self.create('B')
        def fake_build(reg,stage):
            target=stage/'mock.otf'
            target.write_bytes(b'fake-otf')
            MockTTFont.postscript=reg['font']['postscript_name']
            MockTTFont.family=reg['font']['family']
            return target
        with patch.object(pf,'build_all',side_effect=fake_build), \
             patch('fontTools.ttLib.TTFont',MockTTFont):
            pa=pf.prepare(a['project_id'],'式 $x_i$ がある',self.store)
            pb=pf.prepare(b['project_id'],'式 $y^2$ がある',self.store)
        self.assertEqual(pa['entries'][0]['codepoint'],'E000')
        self.assertEqual(pb['entries'][0]['codepoint'],'E000')
        self.assertNotEqual(pa['entries'][0]['latex'],pb['entries'][0]['latex'])
        self.assertNotEqual(pa['font']['postscript_name'],pb['font']['postscript_name'])
        self.assertTrue(pf.font_current(a['project_id'],self.store))
        self.assertTrue(pf.font_current(b['project_id'],self.store))
        self.assertEqual(pf._load(a['project_id'],self.store)[1]['entries'][0]['latex'],'x_i')
        self.assertEqual(pf._load(b['project_id'],self.store)[1]['entries'][0]['latex'],'y^2')

    def test_build_failure_never_changes_registry(self):
        a=self.create('Failure')
        folder=pf._path(a['project_id'],self.store)
        before=(folder/'registry.json').read_bytes()
        with patch.object(pf,'build_all',side_effect=RuntimeError('invalid TeX')):
            with self.assertRaisesRegex(RuntimeError,'invalid TeX'):
                pf.prepare(a['project_id'],'$bad$',self.store)
        self.assertEqual(before,(folder/'registry.json').read_bytes())
        self.assertFalse(pf.font_file(a['project_id'],self.store).exists())


if __name__=='__main__':
    unittest.main()

