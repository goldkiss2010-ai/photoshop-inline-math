"""Inventory checks without TeX, downloads or filesystem mutation."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import audit_runtime as audit

class InventoryTests(unittest.TestCase):
    def test_missing_executable_never_runs(self):
        with patch.object(audit.shutil,'which',return_value=None),patch.object(audit.subprocess,'run') as run:
            self.assertFalse(audit.command(['pdflatex','--version'])['available'])
            run.assert_not_called()

    def test_timeout_is_reported_and_does_not_hide_other_tools(self):
        with patch.object(audit.shutil,'which',return_value='pdflatex'),\
             patch.object(audit.subprocess,'run',side_effect=audit.subprocess.TimeoutExpired('pdflatex',10)):
            result=audit.command(['pdflatex','--version'])
        self.assertEqual(result['error'],'TimeoutExpired')

    def test_inventory_uses_only_versions_and_known_tex_file_lookups(self):
        calls=[]
        def probe(args):
            calls.append(args)
            return {'available':True,'returncode':0,'output':'test','error':''}
        with patch.object(audit,'command',side_effect=probe),\
             patch.object(audit,'package',return_value={'installed':False}),\
             patch.object(audit,'pdf_fonts') as fonts:
            report=audit.inventory()
        fonts.assert_not_called()
        self.assertEqual(len(report['font_candidates']),len(audit.FONT_CANDIDATES))
        for args in calls:
            self.assertTrue(args[1]=='--version' or args[0]=='kpsewhich')
        self.assertNotIn('node',report['commands'])

if __name__=='__main__':unittest.main()
