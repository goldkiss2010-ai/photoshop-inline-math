"""Backend/UXP integration regressions; fonttools required, no TeX or Photoshop."""
import glob
import subprocess
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PATTERNS=['test_partial_prepare.py','test_project_fonts.py','test_project_font_api.py',
          'test_mapping_ledger.py','test_render_failure_context.py','test_tex_ligature_alignment.py',
          'test_restore_map_api.py','test_font_management.py','test_font_management_api.py',
          'test_font_provenance.py','test_setup_check.py','test_distribution_setup.py','test_uxp_packaging.py',
          'test_plugin_installer.py']
def main():
    commands=[[sys.executable,'tools/run_partial_math_tests.py']]
    commands.extend([sys.executable,'-m','unittest','discover','-s','tests','-p',p,'-v'] for p in PATTERNS)
    commands.append(['node','--test',*sorted(glob.glob(str(ROOT/'tests/test_uxp_*.cjs')))])
    for args in commands:
        result=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=60)
        if result.returncode:
            print(result.stdout+result.stderr)
            return result.returncode
        if args[0]=='node':print(result.stdout[-300:])
        else:print((result.stdout+result.stderr).strip())
    print('実機のTeX生成・Windows登録・Photoshop書き込みは別途確認してください。')
    return 0
if __name__=='__main__':raise SystemExit(main())
