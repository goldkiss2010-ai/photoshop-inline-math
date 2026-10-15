"""Distribution boundary tests: no installs, downloads, TeX or production writes."""
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
from windows_test_support import POWERSHELL_PREAMBLE, run_windows_powershell
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import app_paths as ap
import build_distribution as dist

class DistributionTests(unittest.TestCase):
    def test_checkout_default_and_explicit_data_root(self):
        self.assertEqual(ap.data_root({},ROOT),ROOT)
        with tempfile.TemporaryDirectory() as td:
            self.assertEqual(ap.data_root({'PAPER_MATH_DATA_DIR':td},ROOT),Path(td).resolve())
        with self.assertRaises(ValueError):ap.data_root({'PAPER_MATH_DATA_DIR':'relative'},ROOT)

    def test_external_store_seeds_once_and_never_resets_issued_mappings(self):
        with tempfile.TemporaryDirectory() as td:
            base=Path(td);app=base/'app';data=base/'data';(app/'assets').mkdir(parents=True)
            (app/'assets/registry.json').write_text(json.dumps(dist.seed_registry()))
            ap.initialize_data(app,data)
            target=data/'assets/registry.json';original=target.read_bytes()
            (app/'assets/registry.json').write_text('{invalid future seed')
            ap.initialize_data(app,data)
            self.assertEqual(target.read_bytes(),original)
            self.assertFalse(list(target.parent.glob('.seed-*')))

    def test_missing_registry_with_existing_work_is_not_reinitialized(self):
        with tempfile.TemporaryDirectory() as td:
            base=Path(td);(base/'data/local-build').mkdir(parents=True)
            with self.assertRaisesRegex(ValueError,'restore'):
                ap.initialize_data(base/'app',base/'data')
            self.assertFalse((base/'data/assets/registry.json').exists())

    def test_all_runtime_paths_follow_external_store_in_fresh_process(self):
        with tempfile.TemporaryDirectory() as td:
            code="""import app_paths,registry,project_fonts,font_update_guard,readonly_mapping
from pathlib import Path
assert registry.REGISTRY==app_paths.DATA_ROOT/'assets'/'registry.json'
assert project_fonts.STORE==app_paths.DATA_ROOT/'local-build'/'paper-math-projects'
assert font_update_guard.SOURCE==registry.FONT_FILE
assert readonly_mapping.DEFAULT_REGISTRY==registry.REGISTRY
assert readonly_mapping.DEFAULT_LEDGER==registry.LEDGER
assert registry.JSXINC.is_relative_to(app_paths.DATA_ROOT)
assert registry.PSJS.is_relative_to(app_paths.DATA_ROOT)
assert registry.ROOT!=app_paths.DATA_ROOT
"""
            env={**os.environ,'PAPER_MATH_DATA_DIR':td,'PYTHONPATH':str(ROOT/'tools')}
            result=subprocess.run([sys.executable,'-c',code],env=env,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(list(Path(td).iterdir()),[],'imports must not write data')

    def test_preview_package_excludes_work_and_has_source_notices_and_hashes(self):
        with tempfile.TemporaryDirectory() as td:
            base=Path(td);app=base/'app';app.mkdir()
            for p in dist.TOP_FILES+dist.EXAMPLE_FILES+('photoshop/convert_inline_math.template.psjs',):
                target=app/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_text('source')
            for p in ['tools/app_paths.py','tools/windows_launcher.ps1','tools/install_photoshop_plugin.ps1','photoshop/uxp-panel/manifest.json',
                      'licenses/fonttools-MIT.txt','licenses/OFL-1.1.txt','licenses/GUST-FONT-LICENSE.txt','licenses/LPPL-1.3c.txt']:
                target=app/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_text('source')
            # Canary data in every currently used generated/production area.
            for p in ['assets/registry.json','local-build/paper-math-projects/private/registry.json',
                      'assets/private.otf','photoshop/convert_inline_math.psjs','tools/__pycache__/private.py',
                      'examples/math-input/private.qmd','release/private.json']:
                target=app/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_text('PRIVATE-MANUSCRIPT')
            output=base/'package.zip';dist.build_distribution(output,app)
            with ZipFile(output) as archive:
                self.assertIsNone(archive.testzip())
                self.assertFalse(any(b'PRIVATE-MANUSCRIPT' in archive.read(n) for n in archive.namelist()))
                manifest=json.loads(archive.read('PaperMath/distribution-files.json'))
                for n,digest in manifest['files'].items():
                    self.assertEqual(hashlib.sha256(archive.read('PaperMath/'+n)).hexdigest(),digest)
                self.assertFalse(manifest['ccx_included'])
                self.assertEqual(json.loads(archive.read('PaperMath/assets/registry.json')),dist.seed_registry())
                self.assertEqual(dist.seed_registry()['entries'][0]['latex'],r'\dfrac{a+b}{c}')
                self.assertIn('PaperMath/tools/windows_launcher.ps1',archive.namelist())
                for name in dist.EXAMPLE_FILES:self.assertIn('PaperMath/'+name,archive.namelist())

    @unittest.skipUnless(os.name=='nt','Windows PowerShell required')
    def test_windows_launcher_parses_and_reads_paths_without_installing(self):
        script=ROOT/'tools/windows_launcher.ps1'
        # Dot-source without main; compare native parsing + actual path calculation.
        ps=POWERSHELL_PREAMBLE+". $args[0]; $p=Get-PaperMathPaths; if (!(Test-Path -LiteralPath $p.Requirements)) {exit 2}; if (Test-PaperMathReady $p) {Write-Host 'existing-ready'}; $p.Hash"
        command=ROOT/'local-build'/'test-windows-launcher.ps1'
        # Keep harness under a disposable directory, not the application tree.
        with tempfile.TemporaryDirectory() as td:
            command=Path(td)/'harness.ps1';command.write_text(ps,encoding='utf-8-sig')
            result=run_windows_powershell(command,(script,))
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertIn(hashlib.sha256((ROOT/'requirements-runtime.txt').read_bytes()).hexdigest(),result.stdout)

    @unittest.skipUnless(os.name=='nt','Windows PowerShell required')
    def test_windows_missing_setup_and_duplicate_server_do_not_download_or_launch(self):
        ps=r'''$ErrorActionPreference='Stop'
. $args[0]
$script:listener=$false
$script:health=@{ok=$true;backend='python-latex-fonttools-v1';app_root='C:\app';data_root='C:\data'}
function Get-PaperMathPaths {return @{App='C:\app';Data='C:\data';Runtime='C:\runtime'}}
function Test-PaperMathListener {return $script:listener}
function Test-PaperMathReady {return $false}
function Get-PaperMathUv {throw 'UNEXPECTED_DOWNLOAD'}
function Invoke-RestMethod {return $script:health}
try {Invoke-PaperMath Start; throw 'MISSING_SETUP_ACCEPTED'} catch {
    if (!$_.Exception.Message.Contains('Setup_Paper_Math.cmd')) {throw}
}
$script:listener=$true
if ((Invoke-PaperMath Start) -ne 0) {throw 'DUPLICATE_NOT_REUSED'}
$script:health.app_root='C:\other-app'
try {Invoke-PaperMath Start;throw 'OTHER_COPY_ACCEPTED'} catch {
    if (!$_.Exception.Message.Contains('8765')) {throw}
}
try {Invoke-PaperMath Setup;throw 'SETUP_WITH_SERVER_ACCEPTED'} catch {
    if ($_.Exception.Message.Contains('ACCEPTED') -or $_.Exception.Message.Contains('UNEXPECTED_DOWNLOAD')) {throw}
}
'''
        with tempfile.TemporaryDirectory() as td:
            harness=Path(td)/'gates.ps1';harness.write_text(POWERSHELL_PREAMBLE+ps,encoding='utf-8-sig')
            result=run_windows_powershell(harness,(ROOT/'tools/windows_launcher.ps1',))
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)

if __name__=='__main__':unittest.main()
