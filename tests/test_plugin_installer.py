"""Public distribution and Windows install requests; never installs into Adobe."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'tools/install_photoshop_plugin.ps1'

class PublicDistributionTests(unittest.TestCase):
    @unittest.skipUnless((ROOT/'plugin/PaperMath.ccx').is_file(),'Source-only preview has no Adobe installer')
    def test_default_cli_bundles_real_source_matched_ccx_and_both_install_paths(self):
        with tempfile.TemporaryDirectory() as td:
            output=Path(td)/'PaperMath.zip'
            result=subprocess.run([sys.executable,str(ROOT/'tools/build_distribution.py'),
                                   '--output',str(output)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            with ZipFile(output) as archive:
                self.assertIsNone(archive.testzip())
                manifest=json.loads(archive.read('PaperMath/distribution-files.json'))
                self.assertTrue(manifest['ccx_included'])
                self.assertTrue(manifest['plugin']['source_match'])
                self.assertFalse(manifest['plugin']['installation_verified'])
                self.assertEqual(archive.read('PaperMath/plugin/PaperMath.ccx'),
                                 (ROOT/'plugin/PaperMath.ccx').read_bytes())
                for name in ('Install_Photoshop_Plugin.cmd','Install_Photoshop_Plugin_Alternative.cmd',
                             'tools/install_photoshop_plugin.ps1','Prepare_Photoshop_Package.cmd'):
                    self.assertIn(name,manifest['files'])
                for name,digest in manifest['files'].items():
                    self.assertEqual(hashlib.sha256(archive.read('PaperMath/'+name)).hexdigest(),digest)
                guide=archive.read('PaperMath/FIRST_START.html').decode('utf-8')
                self.assertIn('Install_Photoshop_Plugin_Alternative.cmd',guide)

@unittest.skipUnless(os.name=='nt','Windows PowerShell required')
class WindowsInstallerTests(unittest.TestCase):
    def run_ps(self,code,extra=()):
        with tempfile.TemporaryDirectory(prefix='paper math 日本語 ') as td:
            harness=Path(td)/'harness.ps1'
            harness.write_text("$ErrorActionPreference='Stop'\n. $args[0]\n"+code,encoding='utf-8-sig')
            result=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass',
                                   '-File',str(harness),str(SCRIPT),*map(str,extra)],
                                  capture_output=True,text=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_parse_and_dot_source_do_not_launch_any_process(self):
        self.run_ps(r'''
$tokens=$null; $parseErrors=$null
[Management.Automation.Language.Parser]::ParseFile($args[0],[ref]$tokens,[ref]$parseErrors) | Out-Null
if ($parseErrors.Count -ne 0) {throw 'PARSE_ERROR'}
if (!(Get-Command Invoke-PaperMathPluginInstall)) {throw 'MISSING_FUNCTION'}
''')

    def test_normal_and_direct_requests_use_the_bundled_ccx_without_a_python_runtime(self):
        self.run_ps(r'''
$script:calls=New-Object Collections.ArrayList
function Get-PaperMathCcxPath {return 'D:\配布 フォルダー\plugin\PaperMath.ccx'}
function Get-PaperMathCreativeCloudPath {return 'C:\Program Files\Adobe\ACC\Creative Cloud.exe'}
function Start-Process {param($FilePath,$ArgumentList,$WorkingDirectory,$ErrorAction)
    [void]$script:calls.Add(@{FilePath=$FilePath;ArgumentList=$ArgumentList;WorkingDirectory=$WorkingDirectory})
}
if ((Invoke-PaperMathPluginInstall Normal) -ne 0) {throw 'NORMAL_FAILED'}
if ((Invoke-PaperMathPluginInstall Direct) -ne 0) {throw 'DIRECT_FAILED'}
if ($script:calls.Count -ne 2) {throw 'REQUEST_COUNT'}
if ($script:calls[0].FilePath -ne (Get-PaperMathCcxPath)) {throw 'WRONG_CCX'}
if ($script:calls[1].FilePath -ne (Get-PaperMathCreativeCloudPath)) {throw 'WRONG_CC'}
if ($script:calls[1].ArgumentList[0] -ne '--workflow=routeToPath') {throw 'WRONG_WORKFLOW'}
$expected='"--routePath=/pmp/action/doubleClick?filePath=D:\配布 フォルダー\plugin\PaperMath.ccx"'
if ($script:calls[1].ArgumentList[1] -cne $expected) {throw 'PATH_NOT_PRESERVED'}
''')

    def test_missing_inputs_and_association_failure_do_not_claim_installation(self):
        self.run_ps(r'''
function Test-Path {param($LiteralPath,$PathType) return $false}
function Start-Process {throw 'UNEXPECTED_LAUNCH'}
try {Get-PaperMathCcxPath; throw 'MISSING_CCX_ACCEPTED'} catch {
    if (!$_.Exception.Message.Contains('PaperMath.ccx')) {throw}
}
try {Get-PaperMathCreativeCloudPath; throw 'MISSING_CC_ACCEPTED'} catch {
    if (!$_.Exception.Message.Contains('Creative Cloud')) {throw}
}
function Get-PaperMathCcxPath {return 'D:\plugin\PaperMath.ccx'}
try {Invoke-PaperMathPluginInstall Normal; throw 'ASSOCIATION_FAILURE_ACCEPTED'} catch {
    if (!$_.Exception.Message.Contains('Install_Photoshop_Plugin_Alternative.cmd')) {throw}
}
''')

    def test_direct_arguments_survive_native_windows_argv_with_spaces_and_unicode(self):
        # Use Python as an argv observer; no Adobe executable is launched.
        with tempfile.TemporaryDirectory(prefix='paper math 日本語 ') as td:
            probe=Path(td)/'argv probe.py';output=Path(td)/'argv.json'
            probe.write_text('import json, pathlib, sys\npathlib.Path(sys.argv[1]).write_text(json.dumps(sys.argv[2:],ensure_ascii=True),encoding="utf-8")\n',encoding='utf-8')
            self.run_ps(r'''
$ccx='D:\配布 フォルダー & 100% #\plugin\PaperMath.ccx'
$nativeArgs=@(('"'+$args[2]+'"'),('"'+$args[3]+'"'))+(Get-PaperMathDirectInstallArguments $ccx)
$process=Start-Process -FilePath $args[1] -ArgumentList $nativeArgs -Wait -PassThru
if ($process.ExitCode -ne 0) {throw 'ARGV_PROBE_FAILED'}
$result=Get-Content -LiteralPath $args[3] -Raw | ConvertFrom-Json
if ($result.Count -ne 2 -or $result[0] -ne '--workflow=routeToPath') {throw 'ARGV_SPLIT'}
$prefix='--routePath=/pmp/action/doubleClick?filePath='
if (!$result[1].StartsWith($prefix)) {throw 'WRONG_ROUTE'}
$roundtrip=[Uri]::UnescapeDataString($result[1].Substring($prefix.Length))
if ($roundtrip -cne $ccx) {throw 'PATH_ROUNDTRIP_FAILED'}
''',(sys.executable,probe,output))

if __name__=='__main__':unittest.main()
