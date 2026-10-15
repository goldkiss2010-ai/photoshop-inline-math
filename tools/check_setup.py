"""Check a Paper Math installation; optional isolated TeX/SVG/OTF smoke test.

Never edits project registries, source layers or OS fonts.
"""
from __future__ import annotations
import argparse
import importlib
import json
import platform
import tempfile
from pathlib import Path
from audit_runtime import inventory
ROOT=Path(__file__).resolve().parents[1]
PYTHON_VERSION='3.13.15'
PACKAGE_VERSIONS={'fonttools':'4.67.0','PyMuPDF':'1.28.2'}
REQUIRED_FILES=('requirements-runtime.txt','start_inline_math.cmd',
                'photoshop/uxp-panel/manifest.json','photoshop/uxp-panel/index.html',
                'photoshop/convert_inline_math.template.psjs',
                'assets/registry.json','LICENSE','LICENSE_SCOPE.md','THIRD_PARTY_NOTICES.md',
                'tools/font_provenance.py','tools/app_paths.py','licenses/fonttools-MIT.txt',
                'licenses/OFL-1.1.txt','licenses/GUST-FONT-LICENSE.txt','licenses/LPPL-1.3c.txt')

def evaluate(report,root=ROOT):
    checks=[]
    def add(level,name,message):checks.append({'level':level,'name':name,'message':message})
    add('PASS' if report['python']==PYTHON_VERSION else 'WARN','Python',
        report['python']+' / baseline '+PYTHON_VERSION)
    add('PASS' if report['platform']=='Windows' else 'WARN','Platform',
        report['platform']+' / Photoshop font installation is currently Windows-only')
    for name,version in PACKAGE_VERSIONS.items():
        found=report['packages'][name]
        add('FAIL' if not found.get('installed') else 'PASS' if found.get('version')==version else 'WARN',
            name,('not installed' if not found.get('installed') else found.get('version','unknown')+' / baseline '+version))
    for name in ('uv','pdflatex','lualatex','kpsewhich'):
        found=report['commands'][name]
        good=found.get('available') and found.get('returncode')==0
        add('PASS' if good else 'FAIL',name,
            'available' if good else 'not available or version probe failed; check installation and PATH')
    for name in ('standalone.cls','amsmath.sty','amssymb.sty'):
        found=report['tex_files'].get(name,{})
        good=found.get('available') and found.get('returncode')==0 and bool(found.get('output'))
        add('PASS' if good else 'FAIL',name,'found' if good else 'install the required TeX package')
    missing=[name for name in REQUIRED_FILES if not (root/name).is_file()]
    add('FAIL' if missing else 'PASS','Project files',
        'missing: '+', '.join(missing) if missing else 'required source and notice files found')
    for name,found in report['font_candidates'].items():
        if not (found.get('returncode')==0 and found.get('output')):
            add('WARN',name,'candidate not found; this is not a font-use or license determination')
    return checks

def import_checks():
    checks=[]
    for name in ('fontTools','pymupdf'):
        try:importlib.import_module(name)
        except Exception as exc:
            checks.append({'level':'FAIL','name':name+' import','message':type(exc).__name__+': '+str(exc)})
        else:checks.append({'level':'PASS','name':name+' import','message':'loaded'})
    return checks

def render_check(engine='pdflatex'):
    from tex_render import render_expression
    from build_font import build
    from font_provenance import source_report
    from fontTools.ttLib import TTFont
    with tempfile.TemporaryDirectory(prefix='paper-math-setup-') as td:
        work=Path(td);svg=work/'formula.svg'
        metrics=render_expression(r'\frac{a+b}{c}+\sqrt{x}+\mathbb{R}+\sum_{i=1}^{n}i+\text{profile}',svg,engine)
        item={'codepoint':'E000','latex':'setup smoke test','name':'setup',
              'svg':str(svg),**metrics}
        manifest=work/'manifest.json'
        manifest.write_text(json.dumps([item]),encoding='utf-8')
        otf=work/'PaperMathSetupCheck-Regular.otf'
        build(otf,manifest,family='Paper Math Setup Check',ps_name='PaperMathSetupCheck-Regular')
        with TTFont(otf) as font:
            if font['name'].getDebugName(6)!='PaperMathSetupCheck-Regular' or not (font.getBestCmap() or {}).get(0xE000):
                raise RuntimeError('OTF identity or test glyph is missing')
        sources=source_report([item])
        return {'engine':metrics.get('fontSources',{}).get('engine',engine),
                'font_sources':[x.get('postscript_name') for x in sources['source_fonts']],
                'source_coverage':sources['coverage'],'license_ids':sources['license_ids'],
                'source_details':sources,
                'scope':'temporary TeX/SVG/OTF only; no OS fonts or Photoshop edits'}

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--render',action='store_true',help='Generate one formula and OTF in a temporary folder')
    parser.add_argument('--engine',choices=('pdflatex','lualatex'),default='pdflatex')
    parser.add_argument('--json',action='store_true',help='Include the detailed local inventory')
    args=parser.parse_args(argv)
    report=inventory();checks=evaluate(report)+import_checks();rendered=None
    if args.render and not any(x['level']=='FAIL' for x in checks):
        if not args.json:print('Running isolated TeX/SVG/OTF check...',flush=True)
        try:rendered=render_check(args.engine)
        except Exception as exc:checks.append({'level':'FAIL','name':'Render','message':str(exc)})
        else:
            checks.append({'level':'PASS','name':'Render','message':rendered['engine']+' -> SVG -> OTF'})
            if rendered['source_coverage']!='complete':
                checks.append({'level':'WARN','name':'Font sources','message':'some outline sources were not recorded'})
    if args.json:
        print(json.dumps({'inventory':report,'checks':checks,'render':rendered},ensure_ascii=True,indent=2))
    else:
        for check in checks:print(check['level']+' | '+check['name']+' | '+check['message'])
        if rendered:
            print('Font sources: '+', '.join(rendered['font_sources']))
            print('Source coverage: '+rendered['source_coverage']+' (not a licensing clearance)')
        print('Next: Start_Paper_Math.cmd, then Photoshop > Plugins > Paper Math. See docs/INSTALL_WINDOWS.md.')
    return 1 if any(x['level']=='FAIL' for x in checks) else 0

if __name__=='__main__':raise SystemExit(main())
