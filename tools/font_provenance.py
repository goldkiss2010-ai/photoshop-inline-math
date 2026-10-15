"""Read-only TeX/PDF font provenance and portable outline-license notices.

Names are correlated with TeX's recorder inputs; hashes identify both input
font files and embedded PDF programs. This is evidence, not a security proof
or a blanket clearance for arbitrary user fonts.
"""
from __future__ import annotations
import hashlib
import json
import re
from io import BytesIO
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
LICENSE_FILES=('OFL-1.1.txt','GUST-FONT-LICENSE.txt','LPPL-1.3c.txt')
TEXT_FIELDS=('postscript_name','family','version','copyright','license_id','notice')
HASH=re.compile(r'[0-9a-f]{64}')

# Executed after the formula box is typeset, before it is shipped out.
# Lua font loaders may use cached tables without recording the OTF in .fls.
# Read their actual filename fields; never infer a font file from its name.
LUA_FONT_RECORDER = r'''local paths = {}
for _, f in font.each() do
    local path = f.filename or (f.properties and f.properties.filename)
    if type(path) == "string" and not path:find("[\r\n]") then
        paths[path] = true
    end
end
local ordered = {}
for path in pairs(paths) do ordered[#ordered + 1] = path end
table.sort(ordered)
local out = assert(io.open("formula.lua-fonts", "w"))
for _, path in ipairs(ordered) do out:write("INPUT ", path, "\n") end
out:close()
'''

def _font_info(path):
    data=path.read_bytes()
    info={'filename':path.name,'sha256':hashlib.sha256(data).hexdigest()}
    if path.suffix.lower() in ('.pfb','.pfa'):
        header=data[:20000].decode('latin-1',errors='replace')
        comments=header.split('%%EndComments',1)[0]
        name=re.search(r'/FontName\s+/([^\s]+)',header)
        version=re.search(r'%Version:\s*([^\r\n]+)',comments)
        copyrights=re.findall(r'^%Copyright:\s*(.*)',comments,re.M)
        info.update(postscript_name=name[1] if name else '',
                    version=version[1] if version else '',
                    copyright=' '.join(copyrights),
                    notice='\n'.join(line.lstrip('% ').strip() for line in comments.splitlines()
                                     if line.startswith('%') and not line.startswith('%%')))
    else:
        from fontTools.ttLib import TTFont
        with TTFont(BytesIO(data)) as font:
            names=font['name']
            for key,index in [('copyright',0),('family',1),('version',5),('postscript_name',6)]:
                info[key]=names.getDebugName(index) or ''
            info['notice']='\n'.join(filter(None,[names.getDebugName(0),names.getDebugName(13),names.getDebugName(14)]))
    notice=info.get('notice','')
    if re.search(r'SIL Open Font License.*(?:Version\s*)?1\.1',notice,re.I|re.S):
        info['license_id']='OFL-1.1'
    elif re.search(r'GUST Font Licen[cs]e',notice,re.I):
        info['license_id']='LicenseRef-GUST-Font-License'
    else:
        info['license_id']='unknown'
    info['reserved_font_names']=[x.rstrip('.') for x in re.findall(r'Reserved Font Name\s+([A-Za-z0-9_.-]+)',notice,re.I)]
    return info

def _inputs(recorder,include_lua=False):
    fonts=[];seen=set()
    lines=recorder.read_text(encoding='utf-8',errors='replace').splitlines()
    supplement=recorder.with_suffix('.lua-fonts')
    if include_lua and supplement.is_file():
        try:lines.extend(supplement.read_text(encoding='utf-8',errors='replace').splitlines())
        except OSError:pass
    for line in lines:
        if not line.startswith('INPUT '):continue
        path=Path(line[6:].strip().strip('"'))
        if not path.is_absolute():path=recorder.parent/path
        if path.suffix.lower() not in ('.pfb','.pfa','.otf','.ttf'):continue
        path=path.resolve()
        if path in seen:continue
        seen.add(path)
        try:fonts.append(_font_info(path))
        except Exception:continue # Provenance failure must not change rendering.
    return fonts

def collect_font_sources(pdf,recorder,engine):
    """Best-effort metadata for the accepted PDF, never rejected attempts."""
    try:
        inputs=_inputs(recorder,include_lua=engine=='lualatex')
        fonts=[];seen=set()
        for page in pdf:
            found=set()
            used={re.sub(r'^[A-Z]{6}\+','',span.get('font','')) for span in page.get_texttrace()
                  if span.get('chars')}
            for row in page.get_fonts(full=True):
                xref,extension,kind,name=row[:4]
                name=re.sub(r'^[A-Z]{6}\+','',name)
                if name not in used:continue
                found.add(name)
                if (xref,name) in seen:continue
                seen.add((xref,name))
                candidates=[f for f in inputs if f.get('postscript_name')==name]
                unique={f['sha256']:f for f in candidates}
                candidates=list(unique.values())
                embedded=pdf.extract_font(xref)[3] if xref else b''
                fonts.append({'pdf_name':name,'pdf_type':kind,
                    'embedded_sha256':hashlib.sha256(embedded).hexdigest() if embedded else None,
                    'status':'matched' if len(candidates)==1 and embedded else 'unresolved',
                    'input_fonts':candidates})
            for name in sorted(used-found):
                fonts.append({'pdf_name':name,'pdf_type':'unknown','embedded_sha256':None,
                              'status':'unresolved','input_fonts':[]})
        return {'schema':1,'engine':engine,'status':'recorded','fonts':fonts}
    except Exception as exc:
        return {'schema':1,'engine':engine,'status':'unavailable','fonts':[],
                'error_type':type(exc).__name__}

def portable_sources(value):
    """Export known fields only; no recorder paths or arbitrary annotations."""
    if not isinstance(value,dict) or value.get('schema')!=1:return None
    if value.get('engine') not in ('pdflatex','lualatex'):return None
    if value.get('status') not in ('recorded','unavailable'):return None
    out={'schema':1,'engine':value['engine'],'status':value['status'],'fonts':[]}
    if not isinstance(value.get('fonts'),list):return None
    for font in value['fonts']:
        if not isinstance(font,dict):return None
        clean={k:font.get(k,'') for k in ('pdf_name','pdf_type','status')}
        if not all(isinstance(v,str) for v in clean.values()):return None
        digest=font.get('embedded_sha256')
        clean['embedded_sha256']=digest if isinstance(digest,str) and HASH.fullmatch(digest) else None
        clean['input_fonts']=[]
        inputs=font.get('input_fonts',[])
        if not isinstance(inputs,list):return None
        for source in inputs:
            if not isinstance(source,dict):return None
            name=source.get('filename','')
            if not isinstance(name,str) or not name or any(c in name for c in ('/','\\',':')):return None
            digest=source.get('sha256')
            if not isinstance(digest,str) or not HASH.fullmatch(digest):return None
            item={'filename':name,'sha256':digest}
            for key in TEXT_FIELDS:
                if key in source and isinstance(source[key],str):item[key]=source[key]
            reserved=source.get('reserved_font_names',[])
            if not isinstance(reserved,list):return None
            item['reserved_font_names']=[x for x in reserved
                                         if isinstance(x,str) and re.fullmatch(r'[A-Za-z0-9_.-]+',x)]
            clean['input_fonts'].append(item)
        out['fonts'].append(clean)
    return out

def source_report(entries):
    report={'schema':1,'evidence':'accepted PDF font names + TeX recorder / Lua font table inputs',
            'license_clearance':False,'missing_codepoints':[],'unresolved_codepoints':[],
            'source_fonts':[],'entries':[]}
    originals={}
    for entry in entries:
        cp=entry['codepoint']
        sources=portable_sources(entry.get('fontSources'))
        report['entries'].append({'codepoint':cp,'fontSources':sources})
        if sources is None:
            report['missing_codepoints'].append(cp);continue
        if sources['status']!='recorded':
            report['unresolved_codepoints'].append(cp);continue
        for font in sources['fonts']:
            if (font['status']!='matched' or not font['embedded_sha256'] or len(font['input_fonts'])!=1):
                if cp not in report['unresolved_codepoints']:report['unresolved_codepoints'].append(cp)
            for item in font['input_fonts']:originals[item['sha256']]=item
    report['source_fonts']=sorted(originals.values(),key=lambda x:(x.get('postscript_name',''),x['sha256']))
    report['coverage']='complete' if not report['missing_codepoints'] and not report['unresolved_codepoints'] else 'incomplete'
    report['license_ids']=sorted({x.get('license_id','unknown') for x in report['source_fonts']})
    return report

def ofl_only(report):
    return (report['coverage']=='complete' and report['license_ids']==['OFL-1.1']
            and all(x.get('copyright') for x in report['source_fonts']))

def opentype_notices(entries):
    """Embed OFL only for fully recorded OFL outlines; leave other cases open."""
    report=source_report(entries)
    if not ofl_only(report):return {}
    license_path=ROOT/'licenses'/'OFL-1.1.txt'
    if not license_path.is_file():return {}
    copyright='\n'.join(dict.fromkeys(x['copyright'] for x in report['source_fonts']))
    return {'copyright':copyright+'\nModified font assembled by Paper Math; see FONT_NOTICES.txt.',
            'licenseDescription':license_path.read_text(encoding='utf-8'),
            'licenseInfoURL':'https://openfontlicense.org/'}

def notice_files(entries):
    report=source_report(entries)
    lines=['Paper Math — Font outline sources','',
           'The application code license does not license third-party outlines.',
           'Modified font: TeX typesetting is converted through PDF/SVG into a',
           'single BMP PUA glyph per formula; encoding, names and metrics are changed.',
           'Paper Math is responsible for this generated font; original authors',
           'do not provide support or endorse this derivative.','',
           'Recorded source coverage: '+report['coverage'],
           'OFL-only recorded outlines: '+str(ofl_only(report)), '',
           'Original distributions:',
           'AMSFonts: https://ctan.org/pkg/amsfonts',
           'Latin Modern: https://ctan.org/pkg/lm','']
    for font in report['source_fonts']:
        lines.extend([font.get('postscript_name',font['filename'])+' / '+font['filename'],
                      'Input SHA-256: '+font['sha256'],'Version: '+font.get('version',''),
                      'License: '+font.get('license_id','unknown'),font.get('copyright',''),
                      'Reserved names: '+', '.join(font.get('reserved_font_names',[])),
                      'Source notice: '+font.get('notice',''),''])
    if not report['source_fonts']:lines.append('Source font information has not been recorded for this font.')
    lines.extend(['Missing source records (PUA): '+', '.join(report['missing_codepoints']),
                  'Unresolved source records (PUA): '+', '.join(report['unresolved_codepoints']),'',
                  'License texts are reference material, not a clearance for unknown',
                  'or mixed-license outlines. Review those sources before redistribution.',
                  'Do not use reserved original font names for a modified font.',
                  'For OFL font outlines retain copyright and the OFL license.',
                  'Mixed OFL/GUST or other sources require separate distribution review.'])
    files={'FONT_NOTICES.txt':('\n'.join(lines)+'\n').encode('utf-8'),
           'font-sources.json':(json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode('utf-8')}
    for name in LICENSE_FILES:
        files['licenses/'+name]=(ROOT/'licenses'/name).read_bytes()
    return files,report
