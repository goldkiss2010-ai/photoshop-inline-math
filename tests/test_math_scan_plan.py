"""Golden fixture, newline, CLI and Python/JavaScript agreement tests. No TeX run."""
from __future__ import annotations
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from math_scan_plan import scan_math_plan

CASES=json.loads((ROOT/'tests/fixtures/math_input_cases.json').read_text(encoding='utf-8'))['cases']
EOLS=[('LF','\n'),('CRLF','\r\n'),('CR','\r')]

class PartialScan(unittest.TestCase):
    def test_golden_cases_at_all_physical_newlines(self):
        for case in CASES:
            for name,eol in EOLS:
                with self.subTest(case=case['id'],newline=name):
                    source=case['source'].replace('\n',eol)
                    report=scan_math_plan(source)
                    got=dict(latex=[m['latex'] for m in report['matches']],
                             issues=[x['code'] for x in report['issues']],
                             protectedCount=len(report['protected']),fatal=report['fatal'])
                    self.assertEqual(got,case['expected'])
                    self.assertEqual(report['complete'],not report['issues'] and not report['fatal'])
                    for m in report['matches']:
                        self.assertEqual(source[m['from']:m['to']],m['raw'])
                        self.assertFalse(any(m['from']<p['to'] and p['from']<m['to']
                                             for p in report['protected']))
                        self.assertFalse(any(m['from']<p['to'] and p['from']<m['to']
                                             for p in report['issues']))

    @unittest.skipUnless(shutil.which('node'),'Node is needed for cross-language agreement')
    def test_python_javascript_complete_reports_agree(self):
        sources=[c['source'].replace('\n',eol) for c in CASES for _,eol in EOLS]
        sources.append('前 $a$\r\n\rコード '+chr(96)+'$fake$'+chr(96)+'\n$$\rb\r\n$$終わり')
        script="""
const fs=require('node:fs');
const {scanMathPlan}=require('./photoshop/uxp-panel/math_scan_plan');
const sources=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(sources.map(scanMathPlan)));
"""
        result=subprocess.run(['node','-e',script],input=json.dumps(sources,ensure_ascii=False),
                              text=True,encoding='utf-8',cwd=ROOT,capture_output=True,
                              check=True,timeout=30)
        actual=json.loads(result.stdout)
        self.assertEqual(actual,[scan_math_plan(s) for s in sources])

    def test_cli_preserves_actual_crlf_offsets(self):
        source='前 $a$\r\n\r\n未完 $bad\r\n\r\n後 $b$'
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'case.qmd';path.write_bytes(source.encode('utf-8'))
            before=path.read_bytes()
            result=subprocess.run([sys.executable,str(ROOT/'tools/check_math_input.py'),str(path),'--json'],
                                  text=True,encoding='utf-8',capture_output=True,timeout=10)
            self.assertEqual(result.returncode,0)
            self.assertEqual(json.loads(result.stdout),scan_math_plan(source))
            self.assertEqual(path.read_bytes(),before)

    def test_fatal_unicode_is_distinguished_from_partial_success(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'case.txt';path.write_text('😀 $x$',encoding='utf-8')
            result=subprocess.run([sys.executable,str(ROOT/'tools/check_math_input.py'),str(path),'--json'],
                                  text=True,encoding='utf-8',capture_output=True,timeout=10)
            self.assertEqual(result.returncode,2)
            self.assertTrue(json.loads(result.stdout)['fatal'])

    def test_no_fake_closing_delimiter_taken_from_source_code(self):
        source='未完 $x\n'+chr(96)*3+'python\nlabel="$wrong$"\n'+chr(96)*3+'\n後 $y$'
        plan=scan_math_plan(source)
        self.assertEqual([m['latex'] for m in plan['matches']],['y'])
        self.assertEqual([x['code'] for x in plan['issues']],['unclosed-math'])

if __name__=='__main__':
    unittest.main()
