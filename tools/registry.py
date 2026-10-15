"""Canonical append-only LaTeX / PUA mapping; regenerate all contours via TeX.

SVG and OTF are disposable outputs, not registration records. Requires
fonttools, PyMuPDF and pdfLaTeX for a cold font build.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path

from build_font import build, ROOT
from app_paths import DATA_ROOT
from tex_render import render_expression
from math_syntax import scan_math

def svg_sha256(data: bytes) -> str:
    """Canonical hash for text SVG assets.

    Git for Windows can check out LF SVG files using CRLF.
    Treat that single transport difference as identical while rejecting
    substantive edits to geometry or typography.
    """
    return hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()


REGISTRY = DATA_ROOT / 'assets' / 'registry.json'
FONT_FILE = DATA_ROOT / 'local-build' / 'InlineMathLab-Regular.otf'
FONTPREFIX='InlineMathLab-Regular'
CACHE = DATA_ROOT / 'local-build' / 'render-cache'
STAMP = DATA_ROOT / 'local-build' / 'python-font-stamp.json'
LEDGER = DATA_ROOT / 'local-build' / 'latex-pua-identity.json'
PIPELINE_VERSION = 4
# Single supported product backend. Old JSON metadata may still say 'ratex'.
CANONICAL_ENGINE = 'pdflatex'
JSXINC=DATA_ROOT / 'illustrator' / 'registry_generated.jsxinc'
PSJS=DATA_ROOT / 'photoshop' / 'convert_inline_math.psjs'


def identity_pairs(doc:dict)->list[list[str]]:
    return [[e['codepoint'],e['latex']] for e in doc['entries']]


def check_identity_ledger(doc:dict)->None:
    """Protect previously issued PUA meanings across Git branch checkouts.

    The ledger is an independent, Git-ignored recovery record. An existing
    LaTeX/PUA association may be extended, never renumbered or reassigned.
    """
    if not LEDGER.is_file():
        return
    saved=json.loads(LEDGER.read_text(encoding='utf-8'))
    old=saved.get('entries')
    if saved.get('schema')!=1 or not isinstance(old,list):
        raise ValueError('PUA対応バックアップが不正です: '+str(LEDGER))
    incoming=identity_pairs(doc)
    if incoming[:len(old)]!=old:
        raise ValueError('LaTeX/PUAの対応が以前の作業履歴と異なります。'
                         'Git側の6式サンプルへ戻した可能性があります。'
                         'local-build/latex-pua-identity.json を確認し、'
                         '22式などの正本を復元してください。')


def load_registry(path:Path=REGISTRY) ->dict:
    doc=json.loads(path.read_text(encoding='utf-8'))
    if doc.get('schema') != 1 or not isinstance(doc.get('entries'),list):
        raise ValueError('Registry schema mismatch')
    codes=[]; keys=[]
    for entry in doc['entries']:
        if not all(k in entry for k in ('latex','codepoint','mode')):
            raise ValueError('Registry entry needs latex, codepoint, mode (not SVG).')
        code=int(entry['codepoint'],16)
        if not 0xE000 <= code <= 0xF8FF:
            raise ValueError('Codepoint must be in BMP PUA: '+entry['codepoint'])
        if entry['mode']!='inline' or not entry['latex'].strip():
            raise ValueError('Only nonempty inline LaTeX expressions are supported.')
        codes.append(code)
        keys.append((entry['mode'],entry['latex']))
    if len(codes)!=len(set(codes)) or len(keys)!=len(set(keys)):
        raise ValueError('Duplicate formula or codepoint')
    if sorted(codes) != list(range(0xE000,0xE000+len(codes))):
        raise ValueError('Registry must have contiguous codepoints from E000')
    if int(doc['next_codepoint'],16) != 0xE000+len(codes):
        raise ValueError('next_codepoint does not match entries')
    if not isinstance(doc.get('font'), dict):
        raise ValueError('Missing font metadata')
    for key in ['family','postscript_name']:
        if key not in doc['font']: raise ValueError('Missing font property: '+key)
    # Read old registries without losing their LaTeX/PUA identities. Persist
    # the new engine metadata only after a successful font regeneration.
    doc['font']['engine'] = CANONICAL_ENGINE
    check_identity_ledger(doc)
    return doc


def clean_latex(tex:str)->str:
    text=tex.strip()
    if not text:raise ValueError('Empty LaTeX formula')
    return text


def scan_inline(text:str)->list[tuple[int,int,str]]:
    """Find mixed Quarto/LaTeX math; preserve historical span tuple API.

    Syntax notation/mode is for the caller to track; the registry stores
    the canonical TeX body. Same TeX body across delimiters reuses one PUA.
    """
    return [(start,end,formula) for start,end,formula,_,_ in scan_math(text)]


def render_source(text:str, table:dict[str,str])->str:
    out=[]; start=0
    for i,j,tex in scan_inline(text):
        if tex not in table:
            raise KeyError('Unregistered formula: '+tex)
        out.append(text[start:i]);out.append(chr(int(table[tex],16)));start=j
    out.append(text[start:]);return ''.join(out)


def index(registry:dict)->dict[str,str]:
    return {e['latex']:e['codepoint'] for e in registry['entries'] if e['mode']=='inline'}


def artifacts(registry:dict)->tuple[str,str]:
    """Generate static embedded map for Illustrator and Photoshop; no JSON parser required in JSX."""
    entries=[{'latex':e['latex'],'codepoint':e['codepoint'],'char':chr(int(e['codepoint'],16))} for e in registry['entries']]
    js='// GENERATED; changes overwritten by registry.py.\nvar AIM_ENTRIES = '+json.dumps(entries,ensure_ascii=True,indent=2)+';\n'
    ps='// GENERATED; changes overwritten by registry.py.\nconst AIM_ENTRIES = '+json.dumps(entries,ensure_ascii=True,indent=2)+';\n'
    return js,ps


def write_text_atomic(path:Path, content:str)->None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w',encoding='utf-8',dir=path.parent,delete=False,newline='\n') as h:
        stage=Path(h.name);h.write(content)
    os.replace(stage,path)


def _source_key(registry:dict)->str:
    fields={'pipeline':PIPELINE_VERSION,'font':{
        k: registry['font'][k] for k in ('family','postscript_name','engine')
    },'entries':[(e['codepoint'],e['latex']) for e in registry['entries']]}
    return hashlib.sha256(json.dumps(fields,ensure_ascii=False,sort_keys=True).encode('utf-8')).hexdigest()


def _cache_key(latex:str, engine:str)->str:
    # Include both render/conversion source files to invalidate cached SVGs
    # whenever the TeX or geometry extraction implementation changes.
    h=hashlib.sha256()
    for path in (ROOT/'tools'/'tex_render.py', ROOT/'tools'/'build_font.py', ROOT/'tools'/'font_provenance.py'):
        h.update(path.read_bytes())
    h.update(json.dumps((latex,engine),ensure_ascii=False).encode('utf-8'))
    return h.hexdigest()


def build_all(registry:dict, stage:Path, *, stage_svg:dict[str,Path]|None=None)->Path:
    """Regenerate from the LaTeX source; ignore obsolete entry['svg'] fields.

    A cached SVG is only a rebuild acceleration. The cache key includes
    the LaTeX source, TeX engine and source code for the converter.
    """
    stage.mkdir(parents=True, exist_ok=True)
    items=[]
    stage_svg=stage_svg or {}
    for ordinal,entry in enumerate(registry['entries'], 1):
        cp=entry['codepoint']; latex=entry['latex']; engine=CANONICAL_ENGINE
        svg=stage/(f'pua_{cp}.svg')
        key=_cache_key(latex,engine)
        cache_svg=CACHE/(key+'.svg')
        cache_json=CACHE/(key+'.json')
        if cp in stage_svg:
            source=Path(stage_svg[cp])
            shutil.copyfile(source,svg) if source.resolve()!=svg.resolve() else None
            metrics={k:entry[k] for k in ('texWidthPt','texHeightPt','texDepthPt')}
            if 'fontSources' in entry:metrics['fontSources']=entry['fontSources']
        else:
            metrics=None
            if cache_svg.is_file() and cache_json.is_file():
                try:
                    cached=json.loads(cache_json.read_text(encoding='utf-8'))
                    if svg_sha256(cache_svg.read_bytes()) != cached.get('svgSha256'):
                        raise ValueError('cached SVG checksum differs')
                    metrics={k:cached[k] for k in ('texWidthPt','texHeightPt','texDepthPt')}
                    if 'fontSources' in cached:metrics['fontSources']=cached['fontSources']
                    shutil.copyfile(cache_svg,svg)
                except (OSError,ValueError,KeyError,TypeError):
                    # The cache is disposable. Never block startup due to
                    # corrupted or interrupted derived SVG writes.
                    metrics=None
            if metrics is None:
                try:
                    metrics=render_expression(latex,svg,engine)
                except Exception as exc:
                    # Identify the actual expression, not merely the failing
                    # PDF/SVG counter.  Do not change PDF/SVG safety checks or
                    # publish an incomplete registry / OTF on failure.
                    raise RuntimeError(
                        '数式グリフの生成に失敗しました。'
                        f' 登録簿 {ordinal}/{len(registry["entries"])}、'
                        f' U+{cp}\n'
                        f'LaTeX: {latex}\n'
                        f'原因: {exc}'
                    ) from exc
                CACHE.mkdir(parents=True,exist_ok=True)
                staged_svg=cache_svg.with_suffix('.svg.new')
                try:
                    shutil.copyfile(svg,staged_svg)
                    os.replace(staged_svg,cache_svg)
                finally:
                    staged_svg.unlink(missing_ok=True)
                write_text_atomic(cache_json,json.dumps({**metrics,
                    'svgSha256':svg_sha256(svg.read_bytes())})+'\n')
        if 'fontSources' in metrics:entry['fontSources']=metrics['fontSources']
        entry['svgSha256']=svg_sha256(svg.read_bytes())
        items.append({'codepoint':cp,'latex':latex,'svg':str(svg),
                      'name':'pua_'+cp,**metrics})
    manifest=stage/'manifest.json'
    manifest.write_text(json.dumps(items,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    target=stage/(registry['font']['postscript_name']+'.otf')
    # Font global metrics and outlines may change; only the identity map is
    # stable. Existing OTF bytes are never compared.
    build(target,manifest,family=registry['font']['family'],
          ps_name=registry['font']['postscript_name'],
          version='0.'+str(len(items)))
    return target


def font_is_current(registry:dict)->bool:
    try:
        stamp=json.loads(STAMP.read_text(encoding='utf-8'))
        if stamp['source_key']!=_source_key(registry) or not FONT_FILE.is_file():
            return False
        return stamp['sha256']==hashlib.sha256(FONT_FILE.read_bytes()).hexdigest()
    except (OSError,ValueError,KeyError):
        return False


def refresh(registry:dict, formulas:list[str], *, write_output=True, force_build=False, staged_formulas=None)->tuple[dict,list[dict]]:
    # Callers may pass a legacy RaTeX registry directly. The rendering engine
    # is selected by the supported Python pipeline, never by saved font metadata.
    registry=json.loads(json.dumps(registry))
    registry.setdefault('font', {})['engine']=CANONICAL_ENGINE
    existing=index(registry)
    pending=[]; seen=set()
    for original in formulas:
        latex=clean_latex(original)
        if latex not in existing and latex not in seen:
            pending.append(latex);seen.add(latex)
    if 0xE000+len(registry['entries'])+len(pending)>0xF900:
        raise ValueError('BMP PUA exhausted.')
    if not pending and not force_build and font_is_current(registry):
        # Update only the engine label once a matching font has been verified.
        if write_output:
            on_disk = json.loads(REGISTRY.read_text(encoding='utf-8'))
            if on_disk.get('font', {}).get('engine') != CANONICAL_ENGINE:
                write_text_atomic(REGISTRY, json.dumps(registry, ensure_ascii=False, indent=2)+'\n')
        # Upgrade existing worktrees that already had a valid Python stamp
        # before the identity ledger was introduced.
        if write_output and not LEDGER.is_file():
            write_text_atomic(LEDGER,json.dumps({
                'schema':1,'entries':identity_pairs(registry)
            },ensure_ascii=False,indent=2)+'\n')
        return registry,[]
    new_registry=json.loads(json.dumps(registry))
    additions=[]
    for i,latex in enumerate(pending):
        cp=f'{0xE000+len(registry["entries"])+i:04X}'
        entry={'codepoint':cp,'latex':latex,'mode':'inline'}
        if staged_formulas and latex in staged_formulas:
            entry.update(staged_formulas[latex]['metrics'])
        new_registry['entries'].append(entry)
        additions.append(entry)
    new_registry['next_codepoint']=f'{0xE000+len(new_registry["entries"]):04X}'
    # Work in a completely separate directory: failures leave registry and
    # installed-font update process untouched.
    with tempfile.TemporaryDirectory(prefix='aim-registry-') as td:
        stage=Path(td)
        staged_svg={e['codepoint']:staged_formulas[e['latex']]['svg']
                    for e in additions if staged_formulas and e['latex'] in staged_formulas}
        built=(build_all(new_registry,stage,stage_svg=staged_svg) if staged_svg else
               build_all(new_registry,stage))
        from fontTools.ttLib import TTFont
        with TTFont(str(built)) as f:
            actual={cp for cp in f.getBestCmap() if 0xE000<=cp<=0xF8FF}
        expected={int(e['codepoint'],16) for e in new_registry['entries']}
        if actual!=expected:
            raise RuntimeError('Regenerated font does not match LaTeX/PUA registry.')
        if write_output:
            FONT_FILE.parent.mkdir(parents=True,exist_ok=True)
            js,ps=artifacts(new_registry)
            # All computations already succeeded. Each published file uses
            # atomic replacement, and an incomplete stamp triggers rebuild.
            write_text_atomic(REGISTRY,json.dumps(new_registry,ensure_ascii=False,indent=2)+'\n')
            write_text_atomic(JSXINC,js)
            create_psjs(ps)
            temporary=FONT_FILE.with_suffix('.otf.new')
            try:
                shutil.copy2(built,temporary)
                os.replace(temporary,FONT_FILE)
            finally:
                temporary.unlink(missing_ok=True)
            write_text_atomic(STAMP,json.dumps({
                'source_key':_source_key(new_registry),
                'sha256':hashlib.sha256(FONT_FILE.read_bytes()).hexdigest()
            },indent=2)+'\n')
            write_text_atomic(LEDGER,json.dumps({
                'schema':1,'entries':identity_pairs(new_registry)
            },ensure_ascii=False,indent=2)+'\n')
    return new_registry,additions


def create_psjs(mapping_js:str)->None:
    template=(ROOT/'photoshop'/'convert_inline_math.template.psjs').read_text(encoding='utf-8')
    write_text_atomic(PSJS,mapping_js+template)


def main(argv:list[str]|None=None)->None:
    parser=argparse.ArgumentParser(description='Append-only LaTeX PUA registry')
    sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('list',help='List registered LaTeX / codepoints')
    sub.add_parser('build',help='Build font and generated Adobe scripts from registry')
    add=sub.add_parser('add',help='Register one TeX formula; append only')
    add.add_argument('--tex',required=True,help='Math expression WITHOUT $ delimiters')
    convert=sub.add_parser('convert',help='Register all $...$ in a UTF-8 file, write PUA text')
    convert.add_argument('--input',type=Path,required=True)
    convert.add_argument('--output',type=Path,default=DATA_ROOT/'local-build'/'converted.txt')
    args=parser.parse_args(argv)
    registry=load_registry()
    if args.command=='list':
        print(f'Font: {registry["font"]["postscript_name"]}, engine: {registry["font"]["engine"]}')
        for entry in registry['entries']:
            print(f'U+{entry["codepoint"]}  {entry["latex"]}')
        print(f'Next: U+{registry["next_codepoint"]}')
        return
    if args.command=='add':
        registry,new=refresh(registry,[args.tex])
        if new:print(f'ADDED U+{new[0]["codepoint"]}: {new[0]["latex"]}')
        else:print(f'REUSED U+{index(registry)[clean_latex(args.tex)]}: {clean_latex(args.tex)}')
    elif args.command=='convert':
        source=args.input.read_text(encoding='utf-8-sig')
        pairs=scan_inline(source)
        if not pairs:raise ValueError('No $...$ found')
        registry,new=refresh(registry,[p[2] for p in pairs])
        result=render_source(source,index(registry))
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(result,encoding='utf-8')
        print(f'Processed {len(pairs)} instances / {len(new)} new formulas; output: {args.output}')
    else:
        registry,_=refresh(registry,[],write_output=True,force_build=True)
        print('Rebuilt from registry')
    print('Font:',FONT_FILE)
    print('Illustrator map:',JSXINC)
    print('Photoshop script:',PSJS)

if __name__=='__main__':
    try:main()
    except Exception as err:
        raise SystemExit('ERROR: '+str(err)) from err
