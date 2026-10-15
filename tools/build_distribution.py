"""Build a source-inclusive Windows preview ZIP; no user data or installed runtimes.

No CCX is invented here: package that separately with Adobe's UXP Developer Tool.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
from prepare_uxp_package import verify_ccx
ROOT=Path(__file__).resolve().parents[1]
TOP_FILES=('Setup_Paper_Math.cmd','Start_Paper_Math.cmd','Check_Paper_Math.cmd',
           'Open_Paper_Math_Data.cmd','Install_Photoshop_Plugin.cmd','Install_Photoshop_Plugin_Alternative.cmd',
           'Prepare_Photoshop_Package.cmd','start_inline_math.cmd','check_inline_math.cmd',
           'FIRST_START.html','README.md','requirements-runtime.txt','LICENSE',
           'LICENSE_SCOPE.md','THIRD_PARTY_NOTICES.md')
# These are application source roots, not a walk of the checkout. Author data,
# generated scripts, assets and binary fonts have no route into the archive.
SOURCE_SUFFIXES={'tools':{'.py','.ps1'},'photoshop/uxp-panel':{'.js','.html','.css','.json','.png','.svg'},
                 'licenses':{'.txt'},'docs':{'.md'},'tests':{'.py','.cjs','.json','.qmd','.txt'}}
# Preserve the already-issued six legacy meanings; never package a user's registry.
SEED_FORMULAS=(r'\dfrac{a+b}{c}',r'\int_0^1 x^2\,\mathrm{d}x',
               r'\displaystyle\sum_{i=0}^{n}x_i',r'\sqrt{x^2+1}',r'x_i^2',r'\alpha+\beta')

def seed_registry():
    return {'schema':1,'font':{'family':'Inline Math Lab','postscript_name':'InlineMathLab-Regular','engine':'pdflatex'},
            'entries':[{'codepoint':f'{0xE000+i:04X}','latex':f,'mode':'inline'} for i,f in enumerate(SEED_FORMULAS)],
            'next_codepoint':'E006'}

def build_distribution(output,root=ROOT,ccx=None):
    root=Path(root).resolve();output=Path(output).resolve()
    paths=list(TOP_FILES)+['photoshop/convert_inline_math.template.psjs']
    for directory,suffixes in SOURCE_SUFFIXES.items():
        paths.extend(p.relative_to(root).as_posix() for p in (root/directory).rglob('*')
                     if p.is_file() and p.suffix in suffixes and '__pycache__' not in p.parts
                     and not any(x.startswith('.') for x in p.relative_to(root/directory).parts))
    files={}
    for name in sorted(set(paths)):
        p=root/name
        if p.is_symlink() or not p.resolve().is_relative_to(root):raise ValueError('Linked source is not packaged: '+name)
        files[name]=p.read_bytes()
    files['assets/registry.json']=(json.dumps(seed_registry(),ensure_ascii=False,indent=2)+'\n').encode()
    files['paper-math-distribution.json']=b'{"schema":1,"channel":"windows-preview","data_location":"LOCALAPPDATA/PaperMath/data"}\n'
    required={'tools/app_paths.py','tools/windows_launcher.ps1','photoshop/uxp-panel/manifest.json',
              'tools/install_photoshop_plugin.ps1',
              'licenses/fonttools-MIT.txt','licenses/OFL-1.1.txt','licenses/GUST-FONT-LICENSE.txt','licenses/LPPL-1.3c.txt'}
    if not required.issubset(files):raise ValueError('Incomplete application source or notices')
    plugin=None
    if ccx is not None:
        plugin=verify_ccx(ccx,root)
        files['plugin/PaperMath.ccx']=Path(ccx).read_bytes()
        guide=files['FIRST_START.html'].decode('utf-8')
        guide=re.sub(r'<p id="plugin-installer">.*?</p>',
            '<p id="plugin-installer">初回セットアップの後、<code>Install_Photoshop_Plugin.cmd</code> を開いてCreative Cloudでプラグインをインストールしてください。利用時にUXP Developer Toolは不要です。</p>',guide,count=1,flags=re.S)
        guide=re.sub(r'<p id="development-panel">.*?</p>','',guide,count=1,flags=re.S)
        files['FIRST_START.html']=guide.encode('utf-8')
    else:
        guide=files['FIRST_START.html'].decode('utf-8')
        guide=re.sub(r'<p id="plugin-installer">.*?</p>',
            '<p id="plugin-installer">作者向けのソースのみのZIPです。Photoshop用CCXは含みません。docs/PACKAGE_PHOTOSHOP.mdの手順で作成してください。</p>',guide,count=1,flags=re.S)
        files['FIRST_START.html']=guide.encode('utf-8')
    manifest={'schema':1,'product':'Paper Math','channel':'windows-preview','ccx_included':ccx is not None,'plugin':plugin,
              'python':'3.13.15','files':{n:hashlib.sha256(b).hexdigest() for n,b in sorted(files.items())}}
    files['distribution-files.json']=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode()
    output.parent.mkdir(parents=True,exist_ok=True)
    handle,temp=tempfile.mkstemp(prefix='.paper-math-package-',suffix='.zip',dir=output.parent);os.close(handle)
    try:
        with ZipFile(temp,'w',ZIP_DEFLATED) as archive:
            for name,content in sorted(files.items()):archive.writestr('PaperMath/'+name,content)
        os.replace(temp,output)
    finally:Path(temp).unlink(missing_ok=True)
    return {'path':str(output),'files':len(files),'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'local-build'/'PaperMath-Windows-preview.zip')
    plugin_options=parser.add_mutually_exclusive_group()
    plugin_options.add_argument('--ccx',type=Path,help='Use a source-matched CCX produced by Adobe UDT')
    plugin_options.add_argument('--without-ccx',action='store_true',help='Build a source-only preview')
    args=parser.parse_args()
    ccx=None if args.without_ccx else args.ccx or ROOT/'plugin/PaperMath.ccx'
    print(json.dumps(build_distribution(args.output,ccx=ccx),indent=2))
if __name__=='__main__':main()
