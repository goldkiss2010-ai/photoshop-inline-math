"""Managed, per-project Paper Math PUA fonts, isolated from the legacy OTF."""
from __future__ import annotations
import hashlib
import json
import os
import re
import shutil
import tempfile
import uuid
from io import BytesIO
from pathlib import Path
from build_font import ROOT
from app_paths import DATA_ROOT
from registry import build_all, index, render_source, scan_inline, write_text_atomic
from readonly_mapping import validate_registry

STORE = DATA_ROOT / 'local-build' / 'paper-math-projects'
ID_RE = re.compile(r'^pm-[0-9a-f]{16}$')


def _path(pid, store=STORE):
    if not isinstance(pid, str) or not ID_RE.fullmatch(pid):
        raise ValueError('不正なPaper MathフォントIDです。')
    if Path(store).is_symlink():
        raise ValueError('フォント管理フォルダがリンクになっています。')
    base = Path(store).resolve()
    path = base / pid
    if not path.is_dir() or path.is_symlink() or path.resolve().parent != base:
        raise ValueError('Paper Mathの管理外フォントです。')
    return path


def _name(value):
    if not isinstance(value,str):
        raise ValueError('フォント名を入力してください。')
    name = ' '.join(value.split())
    if not 1 <= len(name) <= 28 or not all(c.isalnum() or c in ' _-' for c in name):
        raise ValueError('名前は1〜28文字の文字・数字・空白・ハイフン・下線にしてください。')
    if name.casefold() in ('regular','inline math lab','paper math'):
        raise ValueError('予約されたフォント名です。')
    return name


def _load(pid, store=STORE):
    folder = _path(pid,store)
    meta = json.loads((folder/'project.json').read_text(encoding='utf-8'))
    reg = json.loads((folder/'registry.json').read_text(encoding='utf-8'))
    if (meta.get('schema')!=1 or meta.get('project_id')!=pid or
        meta.get('managed_by')!='paper-math' or
        meta.get('font')!=reg.get('font') or
        meta['font'].get('engine')!='pdflatex'):
        raise ValueError('Paper Mathフォントの管理情報が一致しません。')
    # Internal OpenType/CFF names are ASCII and derived from our private ID.
    # The user's (possibly Japanese) label remains in project.json only.
    expected_family='Paper Math '+pid[3:]
    expected_ps='PaperMath'+pid[3:]+'-Regular'
    if reg['font'].get('family')!=expected_family or reg['font'].get('postscript_name')!=expected_ps:
        raise ValueError('管理外のフォント内部名は使用できません。')
    validate_registry(reg)
    return meta,reg


def font_file(pid, store=STORE):
    meta,_ = _load(pid,store)
    return _path(pid,store)/(meta['font']['postscript_name']+'.otf')


def info(pid, store=STORE):
    meta,reg = _load(pid,store)
    return {'project_id':pid,'name':meta['name'],'font':meta['font'],
            'registered':len(reg['entries']),
            'generated':font_file(pid,store).is_file(),
            'font_path':str(font_file(pid,store))}


def projects(store=STORE):
    base=Path(store)
    if not base.exists(): return []
    return [info(p.name,store) for p in sorted(base.iterdir())
            if p.is_dir() and ID_RE.fullmatch(p.name)]


def create(name, store=STORE):
    name=_name(name)
    base=Path(store)
    base.mkdir(parents=True,exist_ok=True)
    if base.is_symlink(): raise ValueError('管理フォルダがシンボリックリンクです。')
    for p in projects(store):
        if p['name'].casefold()==name.casefold():
            raise ValueError('同名のPaper Mathフォントがあります。')
    pid='pm-'+uuid.uuid4().hex[:16]
    font={'family':'Paper Math '+pid[3:],
          'postscript_name':'PaperMath'+pid[3:]+'-Regular','engine':'pdflatex'}
    meta={'schema':1,'managed_by':'paper-math','project_id':pid,'name':name,'font':font}
    reg={'schema':1,'font':font,'next_codepoint':'E000','entries':[]}
    folder=Path(tempfile.mkdtemp(prefix='.creating-',dir=base))
    try:
        (folder/'project.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        (folder/'registry.json').write_text(json.dumps(reg,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        os.rename(folder,base/pid)
    finally:
        if folder.exists(): shutil.rmtree(folder)
    return info(pid,store)


def rename(pid,name,store=STORE):
    """Change only the display label. Do not touch OTF, registry, stamp or selection."""
    meta,_=_load(pid,store)
    name=_name(name)
    for other in projects(store):
        if other['project_id']!=pid and other['name'].casefold()==name.casefold():
            raise ValueError('同名のPaper Mathフォントがあります。')
    if meta['name']!=name:
        updated={**meta,'name':name}
        write_text_atomic(_path(pid,store)/'project.json',json.dumps(updated,ensure_ascii=False,indent=2)+'\n')
    return info(pid,store)


def active(store=STORE):
    filename=Path(store)/'active.json'
    if not filename.is_file(): return 'legacy'
    value=json.loads(filename.read_text(encoding='utf-8')).get('project_id')
    if value!='legacy': _load(value,store)
    return value


def select(pid,store=STORE):
    if pid!='legacy': _load(pid,store)
    if Path(store).is_symlink():
        raise ValueError('フォント管理フォルダがリンクになっています。')
    Path(store).mkdir(parents=True,exist_ok=True)
    write_text_atomic(Path(store)/'active.json',json.dumps({'project_id':pid})+'\n')
    return pid


def selected(store=STORE):
    pid=active(store)
    if pid=='legacy': return pid,None,None
    meta,reg=_load(pid,store)
    return pid,meta,reg


def _identity(reg):
    value={'font':reg['font'],'pairs':[(e['codepoint'],e['latex']) for e in reg['entries']]}
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode('utf-8')).hexdigest()


def font_current(pid,store=STORE):
    folder=_path(pid,store)
    _,reg=_load(pid,store)
    font=font_file(pid,store)
    if not reg['entries'] or not font.is_file(): return False
    try:
        stamp=json.loads((folder/'stamp.json').read_text(encoding='utf-8'))
        return stamp.get('source_key')==_identity(reg) and stamp.get('sha256')==hashlib.sha256(font.read_bytes()).hexdigest()
    except (ValueError,OSError): return False


def prepare(pid,source,store=STORE, *, scan_report=None, staged_formulas=None):
    if not isinstance(source,str) or not source.strip() or len(source)>100000:
        raise ValueError('テキストが空、または長すぎます。')
    if any(ord(c)>0xFFFF or 0xD800<=ord(c)<=0xDFFF for c in source):
        raise ValueError('BMP外の文字は未対応です。')
    formulas=([m['latex'] for m in scan_report['matches']] if scan_report is not None
              else [x[2] for x in scan_inline(source)])
    if not formulas: raise ValueError('数式が見つかりません。')
    folder=_path(pid,store)
    meta,original=_load(pid,store)
    reg=json.loads(json.dumps(original))
    current=index(reg)
    pending=list(dict.fromkeys(f for f in formulas if f not in current))
    if len(reg['entries'])+len(pending)>6400: raise ValueError('PUAの上限です。')
    for latex in pending:
        cp=f"{0xE000+len(reg['entries']):04X}"
        entry={'codepoint':cp,'latex':latex,'mode':'inline'}
        if staged_formulas and latex in staged_formulas:
            entry.update(staged_formulas[latex]['metrics'])
        reg['entries'].append(entry)
    reg['next_codepoint']=f"{0xE000+len(reg['entries']):04X}"
    validate_registry(reg)
    if pending or not font_current(pid,store):
        with tempfile.TemporaryDirectory(prefix='.building-',dir=folder) as td:
            staged_svg={e['codepoint']:staged_formulas[e['latex']]['svg']
                        for e in reg['entries'] if staged_formulas and e['latex'] in staged_formulas}
            otf=(build_all(reg,Path(td),stage_svg=staged_svg) if staged_svg else
                 build_all(reg,Path(td)))
            font_bytes=otf.read_bytes()
            from fontTools.ttLib import TTFont
            with TTFont(BytesIO(font_bytes)) as font:
                codes={x for x in (font.getBestCmap() or {}) if 0xE000<=x<=0xF8FF}
                expected={int(e['codepoint'],16) for e in reg['entries']}
                if codes!=expected or font['name'].getDebugName(6)!=meta['font']['postscript_name']:
                    raise ValueError('生成OTFと登録簿が一致しません。')
            target=font_file(pid,store)
            staging=folder/(target.name+'.new')
            staging.write_bytes(font_bytes)
            os.replace(staging,target)
            write_text_atomic(folder/'registry.json',json.dumps(reg,ensure_ascii=False,indent=2)+'\n')
            write_text_atomic(folder/'stamp.json',json.dumps({
                'source_key':_identity(reg),'sha256':hashlib.sha256(font_bytes).hexdigest()})+'\n')
    from partial_prepare import convert_report
    mapping=index(reg)
    unique=list(dict.fromkeys(formulas))
    return {'project_id':pid,'font':meta['font'],'revision':len(reg['entries']),
            'formula_instances':len(formulas),'unique_formulas':len(unique),
            'new_count':len(pending),
            'entries':[{'latex':f,'codepoint':mapping[f],
                        'char':chr(int(mapping[f],16))} for f in unique],
            'converted':(render_source(source,mapping) if scan_report is None else
                         convert_report(source,scan_report,mapping)),'font_path':str(font_file(pid,store))}


def windows_status(pid,store=STORE):
    """Read Windows' actual OTF and compare bytes. Never writes OS fonts."""
    if not font_current(pid,store):
        return {'state':'blocked','reason':'生成OTFが登録簿と一致しません。'}
    if os.name!='nt':
        return {'state':'blocked','reason':'Windowsのフォント登録を確認できません。'}
    import winreg
    from fontTools.ttLib import TTFont
    meta,_=_load(pid,store)
    family=meta['font']['family']
    ps=meta['font']['postscript_name']
    hits=[]
    regkey=r'SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'
    for hive in (winreg.HKEY_CURRENT_USER,winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(hive,regkey,0,winreg.KEY_READ) as key:
                i=0
                while True:
                    try: label,data,kind=winreg.EnumValue(key,i)
                    except OSError: break
                    i+=1
                    if not isinstance(data,str) or family.casefold() not in label.casefold(): continue
                    if kind not in (winreg.REG_SZ,winreg.REG_EXPAND_SZ): continue
                    p=Path(os.path.expandvars(data))
                    if not p.is_absolute():
                        root=(Path(os.environ['LOCALAPPDATA'])/'Microsoft'/'Windows'/'Fonts'
                              if hive==winreg.HKEY_CURRENT_USER else Path(os.environ['WINDIR'])/'Fonts')
                        p=root/p
                    if not p.is_file(): continue
                    try:
                        with TTFont(p) as font:
                            if font['name'].getDebugName(6)==ps: hits.append(p)
                    except Exception: pass
        except FileNotFoundError: pass
    if len(hits)>1:
        return {'state':'blocked','reason':'同名フォントが複数登録されています。'}
    if not hits:
        return {'state':'update_required','reason':'新規フォントをWindowsへ手動登録してください。'}
    if hashlib.sha256(hits[0].read_bytes()).hexdigest()!=hashlib.sha256(font_file(pid,store).read_bytes()).hexdigest():
        return {'state':'update_required','reason':'Windowsの登録フォントは旧版です。'}
    return {'state':'current','registered_path':str(hits[0])}
