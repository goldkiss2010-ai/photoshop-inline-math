"""Partial backend integration with disposable OTFs, no TeX or OS installs."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from math_scan_plan import scan_math_plan
from partial_prepare import stage_unknown,convert_report,prepare_partial
from tex_render import FormulaRenderError,render_expression
import project_fonts as pf
import registry as rg

SVG='<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 0 L1 1 Z"/></svg>'
METRICS={'texWidthPt':2.0,'texHeightPt':2.0,'texDepthPt':0.0}

def fake_render(latex,dest):
    if latex=='bad':raise FormulaRenderError('unknown command in bad')
    dest.write_text(SVG)
    return dict(METRICS)

class PartialBackend(unittest.TestCase):
    def test_only_failed_unique_formula_held_and_new_ids_contiguous(self):
        with tempfile.TemporaryDirectory() as td:
            store=Path(td)/'projects'
            project=pf.create('Partial',store)
            pid=project['project_id']
            original=pf._load(pid,store)[1]
            source='前 $x$、$bad$、$y$、$bad$、`$code$`。'
            report=scan_math_plan(source)
            accepted,staged=stage_unknown(report,original,Path(td),fake_render)
            with patch.object(rg,'render_expression',side_effect=AssertionError('staged glyph rendered twice')):
                result=pf.prepare(pid,source,store,scan_report=accepted,staged_formulas=staged)
            self.assertEqual(result['formula_instances'],2)
            self.assertEqual(result['new_count'],2)
            self.assertEqual(result['converted'],'前 \ue000、$bad$、\ue001、$bad$、`$code$`。')
            saved=pf._load(pid,store)[1]
            self.assertEqual([(e['codepoint'],e['latex']) for e in saved['entries']],[('E000','x'),('E001','y')])
            self.assertTrue(pf.font_current(pid,store))
            self.assertEqual(len(accepted['issues']),2)

    def test_legacy_partial_uses_staged_glyphs_and_omits_failed_formula(self):
        original={'schema':1,'font':{'family':'Test Math','postscript_name':'TestMath-Regular','engine':'pdflatex'},
                  'next_codepoint':'E000','entries':[]}
        real_refresh=rg.refresh
        with tempfile.TemporaryDirectory() as td, \
             patch.object(rg,'load_registry',return_value=original), \
             patch.object(rg,'CACHE',Path(td)/'cache'), \
             patch.object(rg,'refresh',side_effect=lambda reg,formulas,**kw:real_refresh(reg,formulas,write_output=False,**kw)), \
             patch('partial_prepare.stage_unknown',side_effect=lambda report,reg,stage:stage_unknown(report,reg,stage,fake_render)), \
             patch.object(rg,'render_expression',side_effect=AssertionError('staged glyph rendered twice')):
            result=prepare_partial('legacy','$bad$ $x$')
        self.assertEqual(result['converted'],'$bad$ \ue000')
        self.assertEqual(result['entries'][0]['codepoint'],'E000')
        self.assertEqual(result['new_count'],1)
        self.assertEqual([(m['from'],m['latex']) for m in result['accepted_matches']],[(6,'x')])

    def test_environment_failure_is_global_and_no_publish(self):
        with tempfile.TemporaryDirectory() as td:
            report=scan_math_plan('$x$ $y$')
            with self.assertRaisesRegex(RuntimeError,'environment'):
                stage_unknown(report,{'entries':[]},Path(td),
                              lambda *a:(_ for _ in ()).throw(RuntimeError('environment missing')))

    def test_existing_formula_never_rerendered_during_staging(self):
        with tempfile.TemporaryDirectory() as td:
            report=scan_math_plan('$x$ $bad$ $bad$')
            seen=[]
            def renderer(latex,dest):
                seen.append(latex)
                return fake_render(latex,dest)
            accepted,_=stage_unknown(report,{'entries':[{'latex':'x'}]},Path(td),renderer)
            self.assertEqual(seen,['bad'])
            self.assertEqual(convert_report('$x$ $bad$ $bad$',accepted,{'x':'E000'}),'\ue000 $bad$ $bad$')

    def test_all_held_never_calls_font_publish(self):
        original={'font':{'postscript_name':'Mock'},'entries':[]}
        with patch.object(rg,'load_registry',return_value=original),\
             patch('partial_prepare.stage_unknown',side_effect=lambda report,reg,stage:stage_unknown(report,reg,stage,fake_render)),\
             patch.object(rg,'refresh',side_effect=AssertionError('must not publish')):
            result=prepare_partial('legacy','$bad$')
        self.assertEqual(result['converted'],'$bad$')
        self.assertEqual(result['formula_instances'],0)
        self.assertEqual(result['issues'][0]['code'],'render-failed')

    def test_font_assembly_failure_keeps_project_registry_and_otf(self):
        with tempfile.TemporaryDirectory() as td:
            store=Path(td)/'projects'
            pid=pf.create('Failure',store)['project_id']
            folder=store/pid
            before=(folder/'registry.json').read_bytes()
            report=scan_math_plan('$x$')
            accepted,staged=stage_unknown(report,pf._load(pid,store)[1],Path(td),fake_render)
            with patch.object(pf,'build_all',side_effect=RuntimeError('assembly failed')):
                with self.assertRaisesRegex(RuntimeError,'assembly'):
                    pf.prepare(pid,'$x$',store,scan_report=accepted,staged_formulas=staged)
            self.assertEqual((folder/'registry.json').read_bytes(),before)
            self.assertFalse(pf.font_file(pid,store).exists())

    def test_tex_nonzero_is_local_but_missing_package_is_global(self):
        from types import SimpleNamespace
        for output,error in [('! Undefined control sequence.',FormulaRenderError),
                             ("! LaTeX Error: File `standalone.cls' not found.",RuntimeError)]:
            with self.subTest(output=output),tempfile.TemporaryDirectory() as td,\
                 patch('tex_render.subprocess.run',return_value=SimpleNamespace(returncode=1,stdout=output)):
                with self.assertRaises(error) as caught:
                    render_expression('bad',Path(td)/'out.svg')
                if error is RuntimeError:self.assertNotIsInstance(caught.exception,FormulaRenderError)

if __name__=='__main__':unittest.main()
