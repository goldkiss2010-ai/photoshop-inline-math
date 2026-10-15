"""Rendering errors must identify the exact formula before any font is published."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import registry


class RenderFailureContextTests(unittest.TestCase):
    def test_glyph_count_mismatch_identifies_latex_and_registry_position(self):
        formula=r'\sum_{i=1}^{128} x_i'
        definitions={
            'font': {'family':'Paper Math Test','postscript_name':'PaperMathTest-Regular'},
            'entries': [
                {'codepoint':'E000','latex':'x^2','mode':'inline'},
                {'codepoint':'E001','latex':formula,'mode':'inline'},
            ],
        }
        with tempfile.TemporaryDirectory() as temp:
            work=Path(temp)
            def fake_render(latex,svg,engine):
                if latex == formula:
                    raise RuntimeError(
                        'PDF/SVG glyph count mismatch: 128 PDF glyphs vs 127 SVG glyphs')
                svg.write_text('<svg/>', encoding='utf-8')
                return {'texWidthPt':10.0,'texHeightPt':6.0,'texDepthPt':2.0}

            with patch.object(registry,'CACHE',work/'isolated-cache'), \
                 patch.object(registry,'render_expression',side_effect=fake_render):
                with self.assertRaises(RuntimeError) as raised:
                    registry.build_all(definitions,work/'stage')
            message=str(raised.exception)
            self.assertIn('登録簿 2/2',message)
            self.assertIn('U+E001',message)
            self.assertIn('LaTeX: '+formula,message)
            self.assertIn('128 PDF glyphs vs 127 SVG glyphs',message)
            self.assertIsInstance(raised.exception.__cause__,RuntimeError)
            self.assertFalse((work/'stage'/'PaperMathTest-Regular.otf').exists())


if __name__=='__main__':
    unittest.main()

