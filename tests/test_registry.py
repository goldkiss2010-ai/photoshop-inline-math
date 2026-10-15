"""LaTeX registry contract: text/PUA survive even when SVG and OTF change."""
import json
import sys
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from fontTools.ttLib import TTFont
from registry import FONT_FILE,index,load_registry,refresh,render_source,scan_inline,build_all,font_is_current


def main():
    registry=load_registry()
    assert registry['next_codepoint']=='E006'
    assert index(registry)[r'\dfrac{a+b}{c}']=='E000'
    assert index(registry)[r'x_i^2']=='E004'
    assert scan_inline(r'Price \$10 and $x_i^2$ plus $\dfrac{a+b}{c}$')==[
        (15,22,'x_i^2'),(28,44,r'\dfrac{a+b}{c}')]
    assert render_source('式 $x_i^2$ と $x_i^2$',index(registry))=='式 \ue004 と \ue004'
    # All legacy SVG fields are deliberately optional: LaTeX is authoritative.
    stripped=json.loads(json.dumps(registry))
    for entry in stripped['entries']:
        for field in ('svg','svgSha256','texWidthPt','texHeightPt','texDepthPt'):
            entry.pop(field,None)
    # A RaTeX-labeled registry must still regenerate through pdfLaTeX.
    stripped['font']['engine']='ratex'
    with tempfile.TemporaryDirectory() as temp:
        # Both old and reduced registries regenerate the *same* LaTeX/PUA map.
        out=build_all(stripped,Path(temp))
        with TTFont(str(out)) as font:
            assert sorted(font.getBestCmap())==list(range(0xE000,0xE006))
        assert font_is_current(registry), 'startup must build before running this test'
        next_registry,adds=refresh(stripped,[r'\sqrt{1+\gamma^2}',r'\sqrt{1+\gamma^2}'],
                                   write_output=False)
        assert len(adds)==1 and adds[0]['codepoint']=='E006'
        assert next_registry['entries'][4]['latex']=='x_i^2'
        assert index(next_registry)[r'\sqrt{1+\gamma^2}']=='E006'
        # Bad TeX has no lasting effect on mapping or generated OTF.
        old=FONT_FILE.read_bytes()
        before=(ROOT/'assets/registry.json').read_bytes()
        try:refresh(stripped,[r'\undefinedCommand999{a}'],write_output=False)
        except RuntimeError:pass
        else:raise AssertionError('Invalid TeX was accepted')
        assert FONT_FILE.read_bytes()==old
        assert (ROOT/'assets/registry.json').read_bytes()==before
    print('PASS: regenerate font from LaTeX, stable PUA map, no old SVG requirement')

if __name__=='__main__':main()

