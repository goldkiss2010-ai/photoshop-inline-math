"""Prepare editable Photoshop plugin sources for Adobe UDT's Package action.

Does not manufacture a CCX or install anything into Photoshop.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import shutil
import struct
import tempfile
from pathlib import Path
from zipfile import ZipFile
ROOT=Path(__file__).resolve().parents[1]
PLUGIN_ID='com.goldkiss2010.papermath'
PLUGIN_VERSION='0.8.2'
LICENSE_FILES=('LICENSE','LICENSE_SCOPE.md','THIRD_PARTY_NOTICES.md')

def package_files(root=ROOT):
    root=Path(root).resolve();panel=root/'photoshop'/'uxp-panel';files={}
    for path in sorted(panel.iterdir()):
        if path.is_file() and path.suffix in ('.js','.html','.css'):
            if path.is_symlink():raise ValueError('Linked plugin source: '+path.name)
            files[path.name]=path.read_bytes()
    for path in sorted((panel/'icons').glob('*')):
        if path.is_file() and path.suffix in ('.png','.svg'):
            if path.is_symlink():raise ValueError('Linked plugin icon: '+path.name)
            files['icons/'+path.name]=path.read_bytes()
    manifest=json.loads((panel/'manifest.json').read_text(encoding='utf-8'))
    manifest.update(id=PLUGIN_ID,version=PLUGIN_VERSION)
    # Photoshop packaging requires plugin icons, even if development loaded
    # without them. Follow Adobe's pluginList and docked-panel icon definitions.
    manifest['icons']=[{'width':48,'height':48,'path':'icons/plugin.png',
                        'scale':[1,2],'theme':['all'],'species':['pluginList']}]
    for entry in manifest.get('entrypoints',[]):
        if entry.get('type')=='panel':
            entry['icons']=[{'width':23,'height':23,'path':'icons/panel-dark.png',
                             'scale':[1,2],'theme':['darkest','dark','medium']},
                            {'width':23,'height':23,'path':'icons/panel-light.png',
                             'scale':[1,2],'theme':['lightest','light']}]
    icon_sets=[manifest['icons']]+[e.get('icons',[]) for e in manifest.get('entrypoints',[]) if e.get('type')=='panel']
    for icons in icon_sets:
        for icon in icons:
            for scale in icon['scale']:
                path=Path(icon['path'])
                name=path.as_posix() if scale==1 else path.with_stem(path.stem+'@'+str(scale)+'x').as_posix()
                data=files.get(name,b'')
                expected=(icon['width']*scale,icon['height']*scale)
                if (len(data)<24 or not data.startswith(b'\x89PNG\r\n\x1a\n') or
                    struct.unpack('>II',data[16:24])!=expected or len(data)>1024*1024):
                    raise ValueError('Missing or invalid plugin icon: '+name)
    if manifest.get('manifestVersion')!=5 or manifest.get('host',{}).get('app')!='PS':
        raise ValueError('Expected a Photoshop manifest v5 single host')
    if manifest.get('main') not in files:raise ValueError('Missing plugin entry document')
    # Source remains editable and byte-identical; only the distribution manifest
    # receives its stable channel ID/version. Runtime permissions are unchanged.
    files['manifest.json']=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode()
    for name in LICENSE_FILES:files[name]=(root/name).read_bytes()
    files['SOURCE_NOTICE.txt']=(
        'Paper Math Photoshop plugin '+PLUGIN_VERSION+'\n'
        'Copyright (C) 2026 Paper Math contributors. AGPL-3.0-only.\n'
        'Complete editable JavaScript, HTML, CSS and original SVG icon sources are included.\n'
        'The accompanying Paper Math application contains the Python backend\n'
        'source, setup scripts, tests, dependency notices and build instructions.\n'
        'No generated user fonts or manuscripts are included in this plugin.\n').encode()
    for name,data in list(files.items()):
        if name.endswith('.js'):
            for module in re.findall(r"require\(['\"]([^'\"]+)['\"]\)",data.decode('utf-8')):
                if module.startswith('./'):
                    dependency=module[2:]+('' if module.endswith('.js') else '.js')
                    if dependency not in files:raise ValueError('Missing plugin module: '+dependency)
    for ref in re.findall(r'(?:src|href)="([^"]+)"',files[manifest['main']].decode('utf-8')):
        if not ref.startswith(('http:','https:','#')) and ref not in files:
            raise ValueError('Missing plugin document asset: '+ref)
    return files

def canonical_text(data,name=''):
    # Git for Windows may check text out as CRLF. This is a transport change.
    return data if name.lower().endswith('.png') else data.replace(b'\r\n',b'\n')

def package_identity(files):
    return hashlib.sha256(json.dumps({n:hashlib.sha256(canonical_text(b,n)).hexdigest() for n,b in sorted(files.items())},sort_keys=True).encode()).hexdigest()

def prepare(output_root=None,root=ROOT):
    root=Path(root).resolve();files=package_files(root);identity=package_identity(files)
    base=Path(output_root or root/'local-build'/'uxp-package')
    target=base/('PaperMath-'+PLUGIN_VERSION+'-'+identity[:12])
    if target.exists():
        if not target.is_dir() or target.is_symlink() or any((target/n).is_symlink() or not (target/n).is_file() or canonical_text((target/n).read_bytes(),n)!=canonical_text(data,n) for n,data in files.items()):
            raise ValueError('Prepared package folder differs; choose a new output folder')
    else:
        base.mkdir(parents=True,exist_ok=True)
        stage=Path(tempfile.mkdtemp(prefix='.preparing-',dir=base))
        try:
            for name,data in files.items():
                dest=stage/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
            os.rename(stage,target)
        finally:
            if stage.exists():shutil.rmtree(stage)
    return {'plugin_id':PLUGIN_ID,'version':PLUGIN_VERSION,'source_key':identity,
            'manifest':str((target/'manifest.json').resolve()),'files':len(files),
            'next':'In Adobe UXP Developer Tool add this manifest, then Actions > Package.'}

def verify_ccx(path,root=ROOT):
    """Verify a UDT-produced CCX matches these sources; no installation claim."""
    path=Path(path)
    if path.suffix.lower()!='.ccx':raise ValueError('Select the .ccx created by UXP Developer Tool')
    expected=package_files(root)
    with ZipFile(path) as archive:
        names=[x.filename for x in archive.infolist() if not x.is_dir()]
        if len(names)!=len(set(names)):raise ValueError('CCX has duplicate archive entries')
        if archive.testzip() is not None:raise ValueError('CCX checksum error')
        for name,data in expected.items():
            if name not in names:raise ValueError('CCX is missing '+name)
            actual=archive.read(name)
            if name=='manifest.json':
                if json.loads(actual)!=json.loads(data):raise ValueError('CCX manifest differs from prepared distribution')
            elif canonical_text(actual,name)!=canonical_text(data,name):raise ValueError('CCX source differs from current build: '+name)
    return {'plugin_id':PLUGIN_ID,'version':PLUGIN_VERSION,
            'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'source_match':True,'installation_verified':False}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-root',type=Path)
    parser.add_argument('--check-ccx',type=Path)
    args=parser.parse_args()
    result=verify_ccx(args.check_ccx) if args.check_ccx else prepare(args.output_root)
    print(json.dumps(result,ensure_ascii=True,indent=2))
if __name__=='__main__':main()
