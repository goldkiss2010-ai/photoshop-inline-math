"""Setup report interpretation without package installs, TeX or OS writes."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import check_setup as setup

def good_report():
    return {'python':setup.PYTHON_VERSION,'platform':'Windows',
            'packages':{name:{'installed':True,'version':version} for name,version in setup.PACKAGE_VERSIONS.items()},
            'commands':{name:{'available':True,'returncode':0} for name in ('uv','pdflatex','lualatex','kpsewhich')},
            'tex_files':{name:{'available':True,'returncode':0,'output':'file'} for name in ('standalone.cls','amsmath.sty','amssymb.sty')},
            'font_candidates':{}}
class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        for name in setup.REQUIRED_FILES:
            file=self.root/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text('fixture')
    def tearDown(self):self.temp.cleanup()
    def test_valid_inventory_and_full_source_layout_pass(self):
        self.assertTrue(all(x['level']=='PASS' for x in setup.evaluate(good_report(),self.root)))
    def test_missing_tools_packages_and_empty_tex_lookup_are_actionable_failures(self):
        report=good_report();report['commands']['pdflatex']={'available':False}
        report['packages']['PyMuPDF']={'installed':False}
        report['tex_files']['standalone.cls']['output']=''
        checks=setup.evaluate(report,self.root);failed={x['name'] for x in checks if x['level']=='FAIL'}
        self.assertEqual(failed,{'pdflatex','PyMuPDF','standalone.cls'})
    def test_baseline_version_differences_warn_without_blocking_other_checks(self):
        report=good_report();report['python']='3.12.14';report['platform']='Linux'
        report['packages']['fonttools']['version']='4.61.1'
        checks=setup.evaluate(report,self.root)
        self.assertFalse(any(x['level']=='FAIL' for x in checks))
        self.assertEqual({x['name'] for x in checks if x['level']=='WARN'},{'Python','Platform','fonttools'})
    def test_incomplete_source_distribution_reports_missing_notice_and_template(self):
        for name in ('LICENSE','photoshop/convert_inline_math.template.psjs'):(self.root/name).unlink()
        check=next(x for x in setup.evaluate(good_report(),self.root) if x['name']=='Project files')
        self.assertEqual(check['level'],'FAIL');self.assertIn('LICENSE',check['message']);self.assertIn('template',check['message'])
    def test_default_check_never_renders_or_installs(self):
        with patch.object(setup,'inventory',return_value=good_report()),patch.object(setup,'evaluate',return_value=[]),\
             patch.object(setup,'import_checks',return_value=[]),patch.object(setup,'render_check') as render,\
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(setup.main(['--json']),0)
        render.assert_not_called()
    def test_json_preserves_unresolved_fonts_and_embedding_evidence(self):
        details={'coverage':'incomplete','entries':[{'codepoint':'E000','fontSources':{
            'status':'recorded','fonts':[{'pdf_name':'CMR10','status':'unresolved',
            'embedded_sha256':None,'input_fonts':[{'filename':'cmr10.pfb'}]}]}}]}
        rendered={'engine':'lualatex','font_sources':['CMR10'],'source_coverage':'incomplete',
                  'license_ids':['OFL-1.1'],'source_details':details}
        output=io.StringIO()
        with patch.object(setup,'inventory',return_value=good_report()),\
             patch.object(setup,'evaluate',return_value=[]),\
             patch.object(setup,'import_checks',return_value=[]),\
             patch.object(setup,'render_check',return_value=rendered),\
             contextlib.redirect_stdout(output):
            self.assertEqual(setup.main(['--render','--json']),0)
        result=json.loads(output.getvalue())
        self.assertEqual(result['render']['source_details'],details)
        self.assertIn('WARN',[x['level'] for x in result['checks']])
    def test_failed_initial_environment_skips_render_and_returns_nonzero(self):
        with patch.object(setup,'inventory',return_value=good_report()),\
             patch.object(setup,'evaluate',return_value=[{'level':'FAIL','name':'pdflatex','message':'not found'}]),\
             patch.object(setup,'import_checks',return_value=[]),patch.object(setup,'render_check') as render,\
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(setup.main(['--render']),1)
        render.assert_not_called()

if __name__=='__main__':unittest.main()
