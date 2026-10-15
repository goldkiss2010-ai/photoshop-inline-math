"""Run the portable partial-scan fixture suite without TeX or Photoshop."""
from __future__ import annotations
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def main():
    node=shutil.which('node')
    if not node:
        print('全テストにはNode.jsが必要です。解析CLIはPythonだけで実行できます。',file=sys.stderr)
        return 2
    commands=[
        ('Python', [sys.executable,'-m','unittest','discover','-s','tests','-p','test_math_scan_plan.py','-v']),
        ('JavaScript',[node,'--test','--test-reporter=tap','tests/test_uxp_partial_math_plan.cjs']),
    ]
    for name,args in commands:
        result=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=60)
        output=result.stdout+result.stderr
        if result.returncode:
            print(output)
            return result.returncode
        if name=='JavaScript':
            counts={key:int(value) for key,value in re.findall(r'^# (tests|pass|fail|skipped) (\d+)$',output,re.M)}
            print(name+': '+str(counts))
        else:
            summary=re.search(r'Ran \d+ tests[^\n]*',output)
            print(name+': '+(summary.group(0) if summary else 'OK'))
    print('35例 × LF/CRLF/CR、両言語の全解析結果一致、本文・コード書式の投影を確認。')
    print('フォント生成・OS登録・Photoshop書き込みの実機検証は含みません。')
    return 0

if __name__=='__main__':
    raise SystemExit(main())
