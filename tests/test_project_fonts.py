"""Project font management tests; no TeX render, OTF install, or legacy writes."""
from __future__ import annotations
import json
import sys
import tempfile
import unittest
from pathlib import Path
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
        return MockTTFont.postscript


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
        self.assertTrue(a['font']['family'].isascii())
        self.assertTrue(a['font']['postscript_name'].isascii())
        self.assertIn('数式図版',a['name'])
        pf.select('legacy',self.store)
        self.assertEqual(pf.active(self.store),'legacy')

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

