"""Read-only inventory of the local Paper Math runtime and font candidates.

No rendering, downloads, registry changes, font installation or file writes.
Candidate font paths are not proof that a particular formula used that font.
"""
from __future__ import annotations
import argparse
import importlib.metadata as metadata
import json
import platform
import shutil
import subprocess
from pathlib import Path

FONT_CANDIDATES=('cmr10.pfb','cmmi10.pfb','cmsy10.pfb','cmex10.pfb',
                 'msam10.pfb','msbm10.pfb','lmroman10-regular.otf')
TEX_INPUTS=('standalone.cls','amsmath.sty','amssymb.sty')

def command(args):
    if not shutil.which(args[0]):
        return {'available':False,'output':'','error':'not found on PATH'}
    try:
        result=subprocess.run(args,capture_output=True,text=True,errors='replace',timeout=10)
    except (OSError,subprocess.TimeoutExpired) as exc:
        return {'available':True,'output':'','error':type(exc).__name__}
    return {'available':True,'returncode':result.returncode,
            'output':result.stdout.strip()[:4000],'error':result.stderr.strip()[:1000]}

def package(name):
    try:
        dist=metadata.distribution(name)
    except metadata.PackageNotFoundError:
        return {'installed':False}
    info=dist.metadata
    return {'installed':True,'version':dist.version,
            'license':info.get('License-Expression') or info.get('License') or 'not stated in metadata',
            'license_classifiers':[x for x in info.get_all('Classifier',[]) if x.startswith('License ::')]}

def pdf_fonts(path):
    import pymupdf
    records={}
    with pymupdf.open(path) as pdf:
        for page in pdf:
            for row in page.get_fonts(full=True):
                # Font identity only. Do not include manuscript text or outlines.
                key=(row[0],row[1],row[2],row[3],row[4])
                records[key]={'xref':row[0],'extension':row[1],'type':row[2],
                              'base_font':row[3],'resource_name':row[4]}
    return list(records.values())

def inventory(pdf=None):
    report={'python':platform.python_version(),'platform':platform.system(),
            'packages':{name:package(name) for name in ('fonttools','PyMuPDF')},
            'commands':{name:command([name,'--version']) for name in ('uv','pdflatex','lualatex','kpsewhich')},
            'tex_files':{},'font_candidates':{},
            'scope':'Candidate paths and package metadata are inventory, not a licensing clearance or font-use proof.'}
    if report['commands']['kpsewhich']['available']:
        report['tex_files']={name:command(['kpsewhich',name]) for name in TEX_INPUTS}
        report['font_candidates']={name:command(['kpsewhich',name]) for name in FONT_CANDIDATES}
    if pdf is not None:
        report['pdf_fonts']=pdf_fonts(pdf)
    return report

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pdf',type=Path,help='Optional existing TeX PDF; inspect font names only')
    args=parser.parse_args()
    if args.pdf is not None and not args.pdf.is_file():
        parser.error('--pdf must be an existing file')
    print(json.dumps(inventory(args.pdf),ensure_ascii=True,indent=2))
    return 0

if __name__=='__main__':raise SystemExit(main())
