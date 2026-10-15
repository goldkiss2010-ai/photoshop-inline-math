"""Synthetic vector font fixture; no TeX engine or user fonts."""
import json
from pathlib import Path
from build_font import build

def synthetic_font(registry,folder):
    folder=Path(folder)
    folder.mkdir(parents=True,exist_ok=True)
    svg=folder/'square.svg'
    svg.write_text('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 0 L1 1 Z"/></svg>')
    manifest=folder/'glyphs.json'
    manifest.write_text(json.dumps([{**e,'svg':str(svg),'name':'pua_'+e['codepoint'],
        'texWidthPt':2.0,'texHeightPt':2.0,'texDepthPt':0.0} for e in registry['entries']]))
    target=folder/'fixture.otf'
    build(target,manifest,family=registry['font']['family'],ps_name=registry['font']['postscript_name'])
    return target.read_bytes()
