"""Mixed math markup scanner regression tests (no TeX run / filesystem writes)."""
from __future__ import annotations
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from math_syntax import scan_math
from registry import scan_inline, render_source


class MixedSyntax(unittest.TestCase):
    def test_four_interleaved_notations_share_one_formula(self):
        src='前 $x^2$ と \\(x^2\\) と $$x^2$$ と \\[x^2\\] 後'
        result=scan_math(src)
        self.assertEqual([x[2] for x in result],['x^2']*4)
        self.assertEqual([x[3] for x in result],['inline','inline','display','display'])
        self.assertEqual([x[4] for x in result],
            ['dollars-inline','paren','dollars-display','bracket'])
        self.assertEqual(scan_inline(src),[(a,b,tex) for a,b,tex,_,_ in result])
        self.assertEqual(render_source(src,{'x^2':'E000'}),
                         '前 \ue000 と \ue000 と \ue000 と \ue000 後')

    def test_multiline_quarto_display_and_latex_equation_reuse_same_pua(self):
        src='本文 $x^2$。\r$$\r x^2 \r$$\r\\begin{equation}\r x^2 \r\\end{equation}'
        result=scan_math(src)
        self.assertEqual([x[2] for x in result],['x^2']*3)
        self.assertEqual([x[3] for x in result],['inline','display','display'])
        self.assertEqual(render_source(src,{'x^2':'E000'}),'本文 \ue000。\r\ue000\r\ue000')

    def test_align_gather_and_multline_turn_into_one_mathmode_safe_glyph(self):
        src=(r'\begin{align} a &= b \\ c &= d \end{align} '
             r'\begin{align*} a &= b \\ c &= d \end{align*} '
             r'\begin{gather}x\\ y\end{gather} '
             r'\begin{multline}x\\ y\end{multline}')
        result=scan_math(src)
        self.assertEqual(len(result),4)
        self.assertEqual(result[0][2],result[1][2])
        self.assertTrue(result[0][2].startswith(r'\begin{aligned}'))
        self.assertTrue(result[0][2].endswith(r'\end{aligned}'))
        self.assertTrue(result[2][2].startswith(r'\begin{gathered}'))
        self.assertEqual(result[2][2],result[3][2])
        self.assertTrue(all(x[3]=='display' for x in result))
        self.assertTrue(all('\n' not in x[2] for x in result))

    def test_escaping_raw_body_and_tex_labels(self):
        src=r'価格 \$10 と $x$ と \(\alpha\) / \[z\] / \begin{equation}\label{eq:test} y \end{equation}'
        result=scan_math(src)
        self.assertEqual(len(result),4)
        self.assertEqual(result[0][2],'x')
        self.assertIn(r'\label{eq:test}',result[-1][2])
        self.assertIn(r'\$10',src[:result[0][0]])

    def test_unclosed_malformed_and_escaped_closers(self):
        for src in ('$abc', '$$abc$', r'\(abc', r'\[abc',
                    r'\begin{align} a &= b'):
            with self.subTest(src=src),self.assertRaisesRegex(ValueError,'閉じ記号'):
                scan_math(src)
        with self.assertRaisesRegex(ValueError,'空の数式'):
            scan_math('$$ \r $$')
        with self.assertRaisesRegex(ValueError,'インライン数式内に'):
            scan_math('$x$$')

    def test_comments_are_not_silently_corrupted_by_newline_folding(self):
        with self.assertRaisesRegex(ValueError, '行コメント'):
            scan_math('$$x % comment\n y$$')
        self.assertEqual(scan_math(r'$20\%$')[0][2], r'20\%')

    def test_qmd_python_fences_ignore_embedded_math_and_keep_real_equations(self):
        fence = chr(96) * 3
        src=('本文 $x$' + '\n' +
             fence+'{python}\nprint("$not_math$")\n'+fence + '\n' +
             '$$E=mc^2$$' + '\n' +
             '~~~{r}\ntext <- "$fake$"\n~~~' + '\n' +
             '終わり \(y\)')
        got=scan_math(src)
        self.assertEqual([item[2] for item in got],['x','E=mc^2','y'])
        self.assertEqual([item[3] for item in got],['inline','display','inline'])

    def test_qmd_unclosed_fence_excludes_rest_of_source(self):
        src='本文 $x$' + '\r' + chr(96)*3+'{python}' + '\r' + 'print("$bad$")'
        self.assertEqual([item[2] for item in scan_math(src)],['x'])

    def test_empty_and_no_formula(self):
        self.assertEqual(scan_math('通常の本文と \\$だけ'),[])
        self.assertEqual(scan_math(''),[])


    def test_math_displaymath_environment_equivalents(self):
        src=(r'\begin{math}x^2\end{math} / '
             r'\begin{displaymath}x^2\end{displaymath}')
        found=scan_math(src)
        self.assertEqual([x[2] for x in found],['x^2','x^2'])
        self.assertEqual([x[3] for x in found],['inline','display'])



if __name__=='__main__':
    unittest.main()
