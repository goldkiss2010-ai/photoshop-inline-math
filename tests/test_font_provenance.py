"""Font provenance, license metadata and cache/staged propagation, no TeX."""
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import font_provenance as fp
import registry as rg
import project_fonts as pf
from build_font import build
from font_bundle import make_font_bundle
from partial_prepare import stage_unknown
from math_scan_plan import scan_math_plan

SVG='<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 0 L1 1 Z"/></svg>'
METRICS={'texWidthPt':2.0,'texHeightPt':2.0,'texDepthPt':0.0}
def recorded(license_id='OFL-1.1'):
    return {'schema':1,'engine':'pdflatex','status':'recorded','fonts':[{
        'pdf_name':'TestMath','pdf_type':'Type1','embedded_sha256':'1'*64,
        'status':'matched','input_fonts':[{'filename':'testmath.pfb','sha256':'2'*64,
            'postscript_name':'TestMath','version':'1.0','copyright':'Copyright 2026 Test Owner',
            'license_id':license_id,'notice':'Fixture font notice','reserved_font_names':['TestMath']}]}]}
def registry():
    return {'schema':1,'font':{'family':'Test Math','postscript_name':'TestMathOutput-Regular','engine':'pdflatex'},
            'entries':[{'latex':'x','codepoint':'E000','mode':'inline'}],'next_codepoint':'E001'}
class Page:
    def get_texttrace(self):return [{'font':'TestMath','chars':[(120,1,(0,0),(0,0,1,1))]}]
    def get_fonts(self,full=True):return [(1,'pfb','Type1','ABCDEF+TestMath','F1')]
class PDF:
    def __iter__(self):return iter([Page()])
    def extract_font(self,xref):return ('TestMath','pfb','Type1',b'embedded font program')
class FontSourceTests(unittest.TestCase):
    def test_recorder_matches_used_pdf_font_and_preserves_exact_copyright_without_local_paths(self):
        with tempfile.TemporaryDirectory(prefix='private-source-') as td:
            folder=Path(td);font=folder/'testmath.pfb'
            data=b'%!PS-AdobeFont-1.0: TestMath 1.0\n%Version: 1.0\n%Copyright: Copyright 2026 Test Owner\n% This Font Software is licensed under the SIL Open Font License, Version 1.1.\n% with Reserved Font Name TestMath.\n%%EndComments\n/FontName /TestMath def\n'
            font.write_bytes(data);recorder=folder/'formula.fls'
            recorder.write_text('INPUT '+str(font)+'\nINPUT '+str(font)+'\n',encoding='utf-8')
            result=fp.collect_font_sources(PDF(),recorder,'pdflatex')
            self.assertEqual(result['status'],'recorded')
            item=result['fonts'][0]['input_fonts'][0]
            self.assertEqual(item['sha256'],hashlib.sha256(data).hexdigest())
            self.assertEqual(item['copyright'],'Copyright 2026 Test Owner')
            self.assertEqual(item['reserved_font_names'],['TestMath'])
            self.assertEqual(item['license_id'],'OFL-1.1')
            self.assertNotIn(td,json.dumps(result))
            self.assertEqual(font.read_bytes(),data)
            self.assertTrue(fp.ofl_only(fp.source_report([{'codepoint':'E000','fontSources':result}])))

    def test_same_postscript_name_with_different_input_programs_is_unresolved(self):
        with tempfile.TemporaryDirectory() as td:
            folder=Path(td);paths=[]
            for number in (1,2):
                file=folder/('test'+str(number)+'.pfa')
                file.write_text('%!PS-AdobeFont-1.0\n/FontName /TestMath def\n% '+str(number))
                paths.append(file)
            recorder=folder/'formula.fls';recorder.write_text(''.join('INPUT '+str(x)+'\n' for x in paths))
            source=fp.collect_font_sources(PDF(),recorder,'pdflatex')
            self.assertEqual(source['fonts'][0]['status'],'unresolved')
            self.assertEqual(len(source['fonts'][0]['input_fonts']),2)
            self.assertEqual(fp.source_report([{'codepoint':'E000','fontSources':source}])['coverage'],'incomplete')

    def test_lua_runtime_otf_filename_fills_missing_recorder_input_and_keeps_gust_notice(self):
        class LuaPage(Page):
            def get_texttrace(self):return [{'font':'TestMathOutput-Regular','chars':[(120,1,(0,0),(0,0,1,1))]}]
            def get_fonts(self,full=True):return [(1,'otf','Type0','ABCDEF+TestMathOutput-Regular','F1')]
        class LuaPDF(PDF):
            def __iter__(self):return iter([LuaPage()])
        with tempfile.TemporaryDirectory(prefix='private-lua-') as td:
            folder=Path(td);svg=folder/'shape.svg';svg.write_text(SVG)
            manifest=folder/'manifest.json'
            manifest.write_text(json.dumps([{'codepoint':'E000','latex':'x','svg':str(svg),'name':'x',**METRICS}]))
            otf=folder/'test.otf';build(otf,manifest,family='Test Math',ps_name='TestMathOutput-Regular')
            from fontTools.ttLib import TTFont
            with TTFont(otf) as font:
                font['name'].setName('Copyright Test Owner; GUST Font License',0,3,1,0x409)
                font.save(otf)
            recorder=folder/'formula.fls';recorder.write_text('')
            recorder.with_suffix('.lua-fonts').write_text('INPUT '+str(otf)+'\nINPUT '+str(otf)+'\n',encoding='utf-8')
            result=fp.collect_font_sources(LuaPDF(),recorder,'lualatex')
            self.assertEqual(result['fonts'][0]['status'],'matched')
            report=fp.source_report([{'codepoint':'E000','fontSources':result}])
            self.assertEqual(report['coverage'],'complete')
            self.assertEqual(report['license_ids'],['LicenseRef-GUST-Font-License'])
            self.assertFalse(fp.ofl_only(report));self.assertEqual(fp.opentype_notices(report['entries']),{})
            self.assertNotIn(td,json.dumps(report))
            # pdfLaTeX must not use a Lua attempt's supplemental record.
            self.assertEqual(fp.collect_font_sources(LuaPDF(),recorder,'pdflatex')['fonts'][0]['status'],'unresolved')

    def test_lua_and_recorder_conflicting_sources_remain_unresolved(self):
        with tempfile.TemporaryDirectory() as td:
            folder=Path(td);a=folder/'a.pfa';b=folder/'b.pfa'
            a.write_text('/FontName /TestMath def');b.write_text('/FontName /TestMath def\n% different bytes')
            recorder=folder/'formula.fls';recorder.write_text('INPUT '+str(a)+'\n')
            recorder.with_suffix('.lua-fonts').write_text('INPUT '+str(b)+'\n')
            result=fp.collect_font_sources(PDF(),recorder,'lualatex')
            self.assertEqual(result['fonts'][0]['status'],'unresolved')
            self.assertEqual(len(result['fonts'][0]['input_fonts']),2)

    @unittest.skipUnless(shutil.which('texlua'),'TeX Lua interpreter not installed')
    def test_real_lua_recorder_reads_runtime_filenames_and_deduplicates_without_tex_output(self):
        with tempfile.TemporaryDirectory() as td:
            folder=Path(td)
            # Run the production Lua script with font-table fixtures in the real interpreter.
            script='font={each=function() return pairs({[2]={filename="C:/Fonts/a.otf"},[7]={properties={filename="C:/Fonts/b.otf"}},[9]={filename="C:/Fonts/a.otf"},[12]={name="NoInferredFilename"},[13]={filename="bad\\nINPUT fake.otf"}}) end}\n'
            script+=fp.LUA_FONT_RECORDER
            (folder/'test.lua').write_text(script,encoding='utf-8')
            result=subprocess.run(['texlua','test.lua'],cwd=folder,capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertEqual(result.stdout,'')
            self.assertEqual((folder/'formula.lua-fonts').read_text(),'INPUT C:/Fonts/a.otf\nINPUT C:/Fonts/b.otf\n')

    def test_missing_recorder_is_metadata_unavailable_instead_of_a_render_exception(self):
        result=fp.collect_font_sources(PDF(),Path('/nonexistent/paper-math-test.fls'),'pdflatex')
        self.assertEqual(result['status'],'unavailable')
        self.assertNotIn('path',result)
        self.assertEqual(fp.opentype_notices([{'codepoint':'E000','fontSources':result}]),{})

    def test_used_font_missing_from_pdf_resources_is_unresolved_not_an_empty_success(self):
        class MissingPage(Page):
            def get_fonts(self,full=True):return []
        class MissingPDF(PDF):
            def __iter__(self):return iter([MissingPage()])
        with tempfile.TemporaryDirectory() as td:
            recorder=Path(td)/'formula.fls';recorder.write_text('')
            result=fp.collect_font_sources(MissingPDF(),recorder,'lualatex')
            self.assertEqual(result['fonts'][0]['pdf_name'],'TestMath')
            self.assertEqual(result['fonts'][0]['status'],'unresolved')
            self.assertEqual(fp.source_report([{'codepoint':'E000','fontSources':result}])['coverage'],'incomplete')

    def test_export_strips_unknown_annotations_and_rejects_invalid_source_records_without_paths(self):
        value=recorded();value['recorder']='C:/private/formula.fls'
        value['fonts'][0]['input_fonts'][0]['path']='C:/private/font.pfb'
        clean=fp.portable_sources(value)
        self.assertNotIn('C:/private',json.dumps(clean))
        value['fonts'][0]['input_fonts'][0]['filename']='C:/private/font.pfb'
        self.assertIsNone(fp.portable_sources(value))
        self.assertEqual(fp.source_report([{'codepoint':'E000','fontSources':value}])['missing_codepoints'],['E000'])

    def test_otf_license_metadata_preserves_identity_metrics_and_glyph_program(self):
        with tempfile.TemporaryDirectory() as td:
            folder=Path(td);svg=folder/'shape.svg';svg.write_text(SVG)
            item={'codepoint':'E000','latex':'x','svg':str(svg),'name':'test',**METRICS}
            manifest=folder/'manifest.json'
            manifest.write_text(json.dumps([item]))
            first=folder/'old.otf';second=folder/'new.otf'
            build(first,manifest,family='Test Math',ps_name='TestMathOutput-Regular')
            item['fontSources']=recorded();manifest.write_text(json.dumps([item]))
            build(second,manifest,family='Test Math',ps_name='TestMathOutput-Regular')
            from fontTools.ttLib import TTFont
            with TTFont(first) as before,TTFont(second) as after:
                self.assertEqual(before.getBestCmap(),after.getBestCmap())
                self.assertEqual(before['hmtx'].metrics,after['hmtx'].metrics)
                self.assertEqual(before['hhea'].ascent,after['hhea'].ascent)
                self.assertEqual(before['hhea'].descent,after['hhea'].descent)
                for name in before.getGlyphOrder():
                    a=before['CFF '].cff.topDictIndex[0].CharStrings[name]
                    b=after['CFF '].cff.topDictIndex[0].CharStrings[name]
                    a.decompile();b.decompile();self.assertEqual(a.program,b.program)
                for index in (1,2,3,4,5,6):self.assertEqual(before['name'].getDebugName(index),after['name'].getDebugName(index))
                self.assertIn('Test Owner',after['name'].getDebugName(0))
                self.assertEqual(after['name'].getDebugName(13),(ROOT/'licenses/OFL-1.1.txt').read_text())
                self.assertIsNone(before['name'].getDebugName(13))

    def test_mixed_and_missing_sources_are_not_given_a_blanket_ofl_license(self):
        entries=[{'codepoint':'E000','fontSources':recorded()},
                 {'codepoint':'E001','fontSources':recorded('LicenseRef-GUST-Font-License')}]
        entries[1]['fontSources']['fonts'][0]['input_fonts'][0]['sha256']='3'*64
        files,report=fp.notice_files(entries)
        self.assertFalse(fp.ofl_only(report));self.assertEqual(fp.opentype_notices(entries),{})
        self.assertEqual(report['coverage'],'complete')
        self.assertIn(b'Mixed OFL/GUST',files['FONT_NOTICES.txt'])
        files,report=fp.notice_files([{'codepoint':'E000'}])
        self.assertEqual(report['missing_codepoints'],['E000'])
        self.assertEqual(report['coverage'],'incomplete')
        self.assertFalse(report['license_clearance'])

    def test_render_cache_keeps_source_records_and_font_zip_includes_them_and_hashes(self):
        with tempfile.TemporaryDirectory() as td:
            folder=Path(td);first=registry();second=registry();calls=[]
            def render(latex,dest,engine):
                calls.append(latex);dest.write_text(SVG);return {**METRICS,'fontSources':recorded()}
            with patch.object(rg,'CACHE',folder/'cache'),patch.object(rg,'render_expression',side_effect=render):
                rg.build_all(first,folder/'first')
            with patch.object(rg,'CACHE',folder/'cache'),patch.object(rg,'render_expression',side_effect=AssertionError('cache missed')):
                otf=rg.build_all(second,folder/'second')
            self.assertEqual(calls,['x']);self.assertEqual(first['entries'][0]['fontSources'],second['entries'][0]['fontSources'])
            self.assertEqual(first['entries'][0]['svgSha256'],rg.svg_sha256(SVG.encode()))
            bundle=make_font_bundle(second,otf.read_bytes(),project_id='legacy',display_name='Test')
            with ZipFile(BytesIO(bundle['data'])) as archive:
                manifest=json.loads(archive.read('bundle.json'))
                self.assertEqual(manifest['font_license_notices'],'ofl-source-notices')
                self.assertIn('FONT_NOTICES.txt',manifest['files'])
                self.assertIn('font-sources.json',manifest['files'])
                self.assertEqual(json.loads(archive.read('font-sources.json'))['coverage'],'complete')
                for name,digest in manifest['files'].items():self.assertEqual(hashlib.sha256(archive.read(name)).hexdigest(),digest)
                self.assertNotIn(td,archive.read('font-sources.json').decode())

    def test_partial_stage_keeps_font_sources_when_successful_formulas_are_registered(self):
        with tempfile.TemporaryDirectory() as td:
            folder=Path(td);store=folder/'projects';pid=pf.create('Sources',store)['project_id']
            def render(latex,dest):
                dest.write_text(SVG);return {**METRICS,'fontSources':recorded()}
            original=pf._load(pid,store)[1];report=scan_math_plan('本文 $x$')
            accepted,staged=stage_unknown(report,original,folder,render)
            with patch.object(rg,'render_expression',side_effect=AssertionError('staged source lost')):
                pf.prepare(pid,'本文 $x$',store,scan_report=accepted,staged_formulas=staged)
            saved=pf._load(pid,store)[1]
            self.assertEqual(saved['entries'][0]['fontSources'],recorded())
            self.assertTrue(pf.font_current(pid,store))
            self.assertEqual(saved['entries'][0]['codepoint'],'E000')

if __name__=='__main__':unittest.main()
