"""Regression for PyMuPDF's synthetic -1 glyph IDs in TeX ligatures.

The trace may have 7 logical Unicode chars for 'profile', while SVG has
only 6 drawable glyphs.  Do not weaken ordinary PDF-to-SVG verification.
"""
from __future__ import annotations
import sys
import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from tex_render import _align_svg_glyphs_to_pdf


def character(letter, gid, x, *, width=2):
    return (ord(letter), gid, (float(x), 10.0),
            (float(x), 0.0, float(x + width), 12.0))


class FakePage:
    def __init__(self, chars):
        self.chars=chars

    def get_texttrace(self):
        return [{'chars': self.chars}]


def glyph_svg(chars, offset=0):
    return '<svg>' + ''.join(
        '<use data-text="%s" transform="matrix(1,0,0,-1,%g,10)"/>' %
        (chr(ch[0]), ch[2][0] + offset)
        for ch in chars
    ) + '</svg>'


class LigatureAlignmentTests(unittest.TestCase):
    def setUp(self):
        # Simulates a real 'fi' ligature as emitted by PyMuPDF for CMR10.
        self.glyphs = [
            character('p', 2, 0), character('r', 3, 2),
            character('o', 4, 4), character('f', 5, 6, width=3),
            character('l', 6, 9), character('e', 7, 11)
        ]
        self.trace = self.glyphs[:4] + [
            character('i', -1, 6, width=0)
        ] + self.glyphs[4:]

    def test_fi_ligature_one_outline_two_unicode_characters(self):
        svg = glyph_svg(self.glyphs)
        self.assertEqual(_align_svg_glyphs_to_pdf(svg,FakePage(self.trace)),svg)

    def test_pdf_and_svg_still_require_matching_real_glyphs(self):
        svg=glyph_svg(self.glyphs[:-1])
        with self.assertRaisesRegex(RuntimeError,'glyph count mismatch'):
            _align_svg_glyphs_to_pdf(svg,FakePage(self.trace))

    def test_missing_leader_is_not_silently_discarded(self):
        with self.assertRaisesRegex(RuntimeError,'orphan ligature'):
            _align_svg_glyphs_to_pdf(glyph_svg(self.glyphs),
                FakePage([character('i',-1,0,width=0)]+self.glyphs))

    def test_unrecognized_negative_glyph_id_must_be_rejected(self):
        damaged = self.glyphs[:4] + [
            character('i',-1,6,width=1)
        ] + self.glyphs[4:]
        with self.assertRaisesRegex(RuntimeError,'unrecognized non-drawing'):
            _align_svg_glyphs_to_pdf(glyph_svg(self.glyphs),FakePage(damaged))

    def test_position_correction_is_kept_for_legitimate_svg_glyphs(self):
        svg=glyph_svg(self.glyphs,offset=1)
        fixed=_align_svg_glyphs_to_pdf(svg,FakePage(self.trace))
        positions = re.findall(
            r'transform="matrix\(1,0,0,-1,([^,]+),[^)]+\)"', fixed)
        self.assertEqual([float(p) for p in positions],
                         [ch[2][0] for ch in self.glyphs])
        y_positions=re.findall(r'transform="matrix\(1,0,0,-1,[^,]+,([^)]+)\)"',fixed)
        self.assertEqual([float(y) for y in y_positions],[10.0]*len(self.glyphs))


if __name__=='__main__':
    unittest.main()

