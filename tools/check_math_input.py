"""Inspect mixed source using the partial-scan prototype; never changes input files."""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
from math_scan_plan import scan_math_plan

def main():
    parser=argparse.ArgumentParser(description='数式・コード混在の解析試作（読み取りのみ）')
    parser.add_argument('source',type=Path,help='UTF-8のQMD/TXT/TeX入力')
    parser.add_argument('--json',action='store_true',help='改行・文字位置を含む完全な解析JSON')
    args=parser.parse_args()
    # read_text() normalizes CR/CRLF, so preserve the actual bytes/newlines here.
    with args.source.open('r',encoding='utf-8-sig',newline='') as f:
        source=f.read()
    report=scan_math_plan(source)
    if args.json:
        print(json.dumps(report,ensure_ascii=False,indent=2))
    else:
        print('解析試作のみ：フォント生成・Photoshopへの適用は行いません。')
        print(f"候補 {len(report['matches'])}箇所 / 保留診断 {len(report['issues'])}件 / "
              f"コード領域 {len(report['protected'])}件")
        for i,m in enumerate(report['matches'],1):
            print(f"{i:02d}: {m['notation']} [{m['from']},{m['to']}) {m['latex']}")
        for item in report['issues']:
            print(f"保留: 行{item['line']} 列{item['column']} / {item['code']} / {item['message']}")
    # Local syntax problems are usable partial results, not command failures.
    # Fatal encoding/range incompatibility is still distinguished.
    return 2 if report['fatal'] else 0

if __name__=='__main__':
    raise SystemExit(main())
