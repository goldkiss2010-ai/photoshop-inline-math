"""Build a tiny CFF/OpenType PUA font *locally* from the included SVG paths.
The archive contains only SVG outlines and this generator, not font binaries.
Dependencies: fonttools. Render originals with optional render_tex.py (TeX+PyMuPDF).
"""
from __future__ import annotations
import argparse, json, math, re
import xml.etree.ElementTree as ET
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.misc.transform import Transform
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.svgLib.path import parse_path
from font_provenance import opentype_notices

ROOT=Path(__file__).resolve().parents[1]
SVG_NS='http://www.w3.org/2000/svg'
XLINK='{http://www.w3.org/1999/xlink}href'
UPM=1000
FONT_UNITS_PER_TEX_PT=100 # TeX 10pt base => font upm 1000
LEFT_PAD=32
RIGHT_PAD=50


def local_name(tag: str)->str:
    return tag.rsplit('}',1)[-1]


def svg_transform(text: str|None)->Transform:
    if not text:return Transform()
    # The bundled PyMuPDF vectors use matrix(...). Restrict deliberately,
    # rather than silently misrender arbitrary SVG transforms.
    segments=re.findall(r'(matrix|translate|scale)\s*\(([^)]*)\)', text)
    remaining=re.sub(r'(matrix|translate|scale)\s*\([^)]*\)', '', text)
    if remaining.strip():raise ValueError('Unsupported SVG transform: '+text)
    result=Transform()
    for name,args in segments:
        v=[float(t) for t in re.split(r'[\s,]+',args.strip()) if t]
        if name=='matrix' and len(v)==6:m=Transform(*v)
        elif name=='translate' and len(v) in (1,2):m=Transform(1,0,0,1,v[0],v[1] if len(v)==2 else 0)
        elif name=='scale' and len(v) in (1,2):m=Transform(v[0],0,0,v[1] if len(v)==2 else v[0],0,0)
        else:raise ValueError('Unsupported SVG transform args: '+text)
        result=result.transform(m)
    return result


def stroke_path_as_outline(d:str, dst:T2CharStringPen, tx:Transform, stroke_width:float)->bool:
    """For this controlled TeX fixture, rule strokes are single straight segments."""
    rec=RecordingPen();parse_path(d,rec)
    pts=[]
    for op,args in rec.value:
        if op in ('moveTo','lineTo'):pts.append(tx.transformPoint(args[0]))
        elif op=='endPath':continue
        else:raise ValueError('Unsupported stroked path shape: '+op)
    if len(pts)!=2:return False
    p1,p2=pts
    line_len=math.dist(p1,p2)
    if line_len==0:return False
    # stroke width is in SVG coordinates; font transform is uniform in this lab.
    radius=stroke_width*FONT_UNITS_PER_TEX_PT/2
    nx=(p2[1]-p1[1])/line_len*radius
    ny=-(p2[0]-p1[0])/line_len*radius
    points=[(p1[0]+nx,p1[1]+ny),(p2[0]+nx,p2[1]+ny),
            (p2[0]-nx,p2[1]-ny),(p1[0]-nx,p1[1]-ny)]
    dst.moveTo(points[0])
    for point in points[1:]:dst.lineTo(point)
    dst.closePath()
    return True


def svg_as_charstring(item:dict):
    svg_file=ROOT/item['svg']
    doc=ET.parse(svg_file); root=doc.getroot()
    ids={el.attrib['id']:el for el in root.iter() if 'id' in el.attrib}
    wd=math.ceil(item['texWidthPt']*FONT_UNITS_PER_TEX_PT)+LEFT_PAD+RIGHT_PAD
    pen=T2CharStringPen(wd,None)
    to_font=Transform(FONT_UNITS_PER_TEX_PT,0,0,-FONT_UNITS_PER_TEX_PT,
                      LEFT_PAD,item['texHeightPt']*FONT_UNITS_PER_TEX_PT)
    num_paths=0

    def walk(el, current:Transform):
        nonlocal num_paths
        kind=local_name(el.tag)
        if kind=='defs':return
        tx=current.transform(svg_transform(el.get('transform')))
        if kind=='use':
            href=el.get(XLINK) or el.get('href')
            if not href or not href.startswith('#'):raise ValueError('Unrecognized SVG use reference')
            ref=ids[href[1:]]
            x=float(el.get('x',0));y=float(el.get('y',0))
            use_tx=tx.transform(Transform(1,0,0,1,x,y))
            walk(ref,use_tx)
        elif kind=='path':
            d=el.get('d')
            if not d:return
            full=to_font.transform(tx)
            if el.get('fill')=='none' and el.get('stroke'):
                if not stroke_path_as_outline(d,pen,full,float(el.get('stroke-width','1'))):
                    raise ValueError('Could not outline stroke '+item['name'])
            else:
                parse_path(d,TransformPen(pen,full))
            num_paths+=1
        else:
            for child in el:walk(child,tx)
    walk(root,Transform())
    if num_paths==0:raise ValueError('No vector contours for '+item['name'])
    return pen.getCharString(),wd,num_paths


def build(dest:Path, manifest:Path|None=None, *, family:str='Inline Math Lab',
          ps_name:str='InlineMathLab-Regular', version:str='0.1',
          fixed_ascent:int|None=None, fixed_descent:int|None=None)->dict:
    fixture=json.loads((manifest or ROOT/'assets'/'expressions.json').read_text(encoding='utf-8'))
    ids=[int(v['codepoint'],16) for v in fixture]
    if len(ids)!=len(set(ids)):raise ValueError('Duplicate PUA codepoint')
    if any(v<0xE000 or v>0xF8FF for v in ids):raise ValueError('Expected BMP private-use codepoints')
    cmap={int(v['codepoint'],16):'math'+v['codepoint'] for v in fixture}
    charstrings={}
    advances={}
    metrics={}
    for name,width in [('.notdef',600),('space',350)]:
        charstrings[name]=T2CharStringPen(width,None).getCharString()
        advances[name]=width
    stats=[]
    for item in fixture:
        name='math'+item['codepoint']
        charstring,width,npaths=svg_as_charstring(item)
        charstrings[name]=charstring
        advances[name]=width
        stats.append({'glyph':name,'width':width,'paths':npaths,
                      'math':item['latex']})
    glyph_order=['.notdef','space']+['math'+v['codepoint'] for v in fixture]
    max_upper=max(math.ceil(v['texHeightPt']*FONT_UNITS_PER_TEX_PT+100) for v in fixture)
    max_lower=max(math.ceil(v['texDepthPt']*FONT_UNITS_PER_TEX_PT+100) for v in fixture)
    if fixed_ascent is not None or fixed_descent is not None:
        if fixed_ascent is None or fixed_descent is None:
            raise ValueError('Provide both fixed_ascent and fixed_descent')
        # Freezing these preserves existing documents' line metrics.
        # Reject new glyphs that exceed the agreed font envelope.
        if max_upper>fixed_ascent or max_lower>abs(fixed_descent):
            raise ValueError(
                f'Math glyph exceeds frozen font metrics: requires upper {max_upper}, '
                f'lower {max_lower}, allowed upper {fixed_ascent}, lower {abs(fixed_descent)}'
            )
        max_upper=fixed_ascent
        max_lower=abs(fixed_descent)
    names={'familyName':family,'styleName':'Regular',
           'uniqueFontIdentifier':ps_name + ' Experiment ' + version,
           'fullName':family+' Regular','psName':ps_name,'version':'Version '+version}
    names.update(opentype_notices(fixture))
    # Menu names can be Unicode; keep CFF strings and the PostScript identity
    # ASCII. Record the same menu name for English and Japanese Windows UIs.
    cff_family=family
    if not family.isascii():
        cff_family=ps_name.removesuffix('-Regular')
        names['familyName']={'en':family,'ja':family}
        names['fullName']={'en':family+' Regular','ja':family+' Regular'}
    fb=FontBuilder(UPM,isTTF=False)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(cmap)
    fb.setupCFF(ps_name,{'FullName':cff_family+' Regular','FamilyName':cff_family,
                        'Weight':'Regular'},charstrings,{})
    for name in glyph_order:
        rect=charstrings[name].calcBounds(None)
        lsb=round(rect[0]) if rect else 0
        metrics[name]=(advances[name],lsb)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=max_upper,descent=-max_lower)
    fb.setupNameTable(names)
    fb.setupOS2(sTypoAscender=max_upper,sTypoDescender=-max_lower,
                sTypoLineGap=0,usWinAscent=max_upper,usWinDescent=max_lower,
                usWeightClass=400,fsType=0)
    fb.setupPost()
    dest.parent.mkdir(parents=True,exist_ok=True)
    fb.save(str(dest))
    return {'file':str(dest),'sizeBytes':dest.stat().st_size,'family':family,
            'postScriptName':ps_name,'ascent':max_upper,'descent':-max_lower,'glyphs':stats}

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--output',type=Path,default=ROOT/'local-build'/'InlineMathLab-Regular.otf')
    p.add_argument('--manifest',type=Path,default=ROOT/'assets'/'expressions.json')
    p.add_argument('--family',default='Inline Math Lab')
    p.add_argument('--ps-name',default='InlineMathLab-Regular')
    p.add_argument('--version',default='0.1')
    opt=p.parse_args()
    print(json.dumps(build(opt.output,opt.manifest,family=opt.family,ps_name=opt.ps_name,version=opt.version),ensure_ascii=False,indent=2))

