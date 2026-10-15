"""Render one math formula using a real TeX engine, recording TeX box metrics.

Only handles trusted, locally authored TeX. -no-shell-escape is enforced.
"""
from __future__ import annotations
import re
import html
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from font_provenance import collect_font_sources, LUA_FONT_RECORDER



class FormulaRenderError(RuntimeError):
    """A completed TeX run rejected this individual expression."""


def _align_svg_glyphs_to_pdf(svg: str, page) -> str:
    """Validate SVG glyph anchors against actual PDF text positioning.

    Some PDF-to-SVG versions misplace individual math glyphs after a TeX rule.
    Check coordinates instead of changing TeX's own layout.
    """
    # get_texttrace() returns an extra synthetic Unicode character for
    # each continuation of a font ligature. These have glyph ID -1 and
    # a zero-width bbox at the preceding glyph's origin: e.g. \\text{profile}
    # contains one visible "fi" glyph but PDF text extraction reports f+i.
    # SVG has one <use> for that glyph. Ignore only verified ligature
    # continuations, never genuine drawable glyphs.
    chars = []
    for span in page.get_texttrace():
        visible_in_span = []
        for char in span['chars']:
            if char[1] == -1:
                if not visible_in_span:
                    raise RuntimeError('PDF text trace has an orphan ligature continuation.')
                leader = visible_in_span[-1]
                same_origin = all(abs(float(char[2][axis]) -
                                      float(leader[2][axis])) <= 0.05
                                  for axis in (0, 1))
                zero_width = abs(float(char[3][2]) - float(char[3][0])) <= 0.05
                if not same_origin or not zero_width:
                    raise RuntimeError(
                        'PDF text trace has an unrecognized non-drawing character.'
                    )
                continue
            visible_in_span.append(char)
        chars.extend(visible_in_span)
    use_regex = re.compile(r'<use\b[^>]*?/>', re.S)
    uses = list(use_regex.finditer(svg))
    if len(chars) != len(uses):
        raise RuntimeError(
            'PDF/SVG glyph count mismatch: '
            f'{len(chars)} PDF glyphs vs {len(uses)} SVG glyphs'
        )
    patches = []
    for index, (entry, ch) in enumerate(zip(uses, chars)):
        tag = entry.group(0)
        named = re.search(r'data-text="([^"]*)"', tag)
        mat = re.search(r'transform="matrix\(([^)]+)\)"', tag)
        if not named or not mat:
            raise RuntimeError(f'Unexpected PDF/SVG glyph structure at #{index + 1}')
        label = html.unescape(named.group(1))
        expected = chr(ch[0])
        if label != expected:
            raise RuntimeError(
                f'PDF/SVG glyph order mismatch at #{index + 1}: '
                f'{expected!r} vs {label!r}'
            )
        parts = [float(v) for v in mat.group(1).split(',')]
        if len(parts) != 6:
            raise RuntimeError(f'Unexpected SVG glyph matrix at #{index + 1}')
        x, y = ch[2]  # real PDF glyph origin in points
        if abs(parts[4] - x) > 0.05 or abs(parts[5] - y) > 0.05:
            # Change the SVG matrix's translation only, not TeX glyph geometry.
            values = mat.group(1).split(',')
            values[4] = format(x, '.7f')
            values[5] = format(y, '.7f')
            offset = entry.start() + mat.start(1)
            patches.append((offset, offset + len(mat.group(1)), ','.join(values)))
    for start, end, value in reversed(patches):
        svg = svg[:start] + value + svg[end:]
    return svg

def _invalid_pdf_text_origins(page) -> list[dict]:
    """Reject obvious page-outside text positions before converting to SVG.

    A 2026 Windows MiKTeX/pdfTeX build emitted \frac{a+b}{c} with the
    denominator at x=-7.553pt on a 16.332pt page. This is in the *PDF*
    itself, not a fontTools/Adobe baseline or SVG transform problem.
    Allow ordinary edge overshoot; reject a grossly misplaced text origin.
    """
    width = float(page.rect.width)
    tolerance = max(1.0, width * 0.05)
    suspicious = []
    for span in page.get_texttrace():
        for char in span['chars']:
            x, y = char[2]
            if x < -tolerance or x > width + tolerance:
                suspicious.append({
                    'codepoint': char[0],
                    'origin': [float(x), float(y)],
                    'page_width_pt': width,
                })
    return suspicious


def render_expression(latex: str, destination: Path, engine: str = 'pdflatex',
                      *, debug_dir: Path | None = None,
                      fallback_timeout: float = 180.0) -> dict:
    if engine not in ('pdflatex', 'lualatex'):
        raise ValueError('Supported engines: pdflatex, lualatex')
    if not latex.strip():
        raise ValueError('Empty math expression')
    if not 0 < fallback_timeout <= 900:
        raise ValueError('fallback_timeout must be within 0..900 seconds')
    tex = r'''\documentclass[border=0pt]{standalone}
\usepackage{amsmath,amssymb}
\pagestyle{empty}
\begin{document}
\setbox0=\hbox{$%s$}%%%%
\typeout{AIM_METRIC: WIDTH=\the\wd0 HEIGHT=\the\ht0 DEPTH=\the\dp0}%%%%
\box0
\end{document}
''' % latex
    with tempfile.TemporaryDirectory(prefix='aim-math-') as temp:
        work = Path(temp)
        (work / 'paper_math_font_sources.lua').write_text(LUA_FONT_RECORDER, encoding='utf-8')
        # Real TeX output is authoritative; first reject *corrupted PDF*
        # rather than asking SVG or fontTools to "correct" invalid content.
        # When MiKTeX/pdfTeX misplaces a fraction after its rule, LuaLaTeX
        # is an independent PDF emitter using the same TeX math metrics.
        attempts = [engine] + (['lualatex'] if engine == 'pdflatex' else [])
        decisions = []
        selected_engine = None
        for selected in attempts:
            # Keep pdfLaTeX input unchanged. Lua provenance is best effort;
            # neither a metadata failure nor unavailable fields change typesetting.
            selected_tex = tex
            if selected == 'lualatex':
                prefix, suffix = tex.rsplit(r'\box0', 1)
                selected_tex = (prefix +
                    r'\directlua{pcall(dofile, "paper_math_font_sources.lua")}'+'\n'+r'\box0'+suffix)
            (work / 'formula.lua-fonts').unlink(missing_ok=True)
            (work / 'formula.tex').write_text(selected_tex, encoding='utf-8')
            timeout = fallback_timeout if selected == 'lualatex' else 40.0
            try:
                result = subprocess.run(
                    [selected, '-no-shell-escape', '-halt-on-error', '-recorder',
                     '-interaction=nonstopmode', 'formula.tex'],
                    cwd=work, capture_output=True, text=True,
                    errors='replace', timeout=timeout,
                )
            except subprocess.TimeoutExpired as exc:
                # MiKTeX may rebuild its LuaTeX font database on first use,
                # or wait on a package-install prompt. Preserve diagnostics
                # rather than accepting the previous corrupt PDF.
                def tail(value):
                    if isinstance(value, bytes):
                        value = value.decode('utf-8', errors='replace')
                    return str(value or '')[-6000:]
                failure = {
                    'type': 'TimeoutExpired', 'engine': selected,
                    'timeout_seconds': timeout,
                    'attempts': decisions,
                    'stdout_tail': tail(exc.stdout),
                    'stderr_tail': tail(exc.stderr),
                }
                if debug_dir is not None:
                    debug_dir.mkdir(parents=True, exist_ok=True)
                    current_log = work / 'formula.log'
                    if current_log.is_file():
                        shutil.copyfile(current_log, debug_dir / ('timeout_' + selected + '.log'))
                    (debug_dir / 'render_failure.json').write_text(
                        json.dumps(failure, ensure_ascii=False, indent=2) + '\n',
                        encoding='utf-8')
                    (debug_dir / 'render_decision.json').write_text(
                        json.dumps({'selected_engine': None, 'attempts': decisions},
                                   ensure_ascii=False, indent=2) + '\n',
                        encoding='utf-8')
                raise RuntimeError(
                    f'{selected} が {timeout:g} 秒でタイムアウトしました。'
                    ' MiKTeXの初回フォントデータベース構築、'
                    'またはパッケージのインストール待ちの可能性があります。'
                    ' 壊れたPDFはフォントに採用していません。'
                    + (f' 詳細: {debug_dir / "render_failure.json"}' if debug_dir else '')
                ) from exc
            except FileNotFoundError as exc:
                if selected == 'lualatex' and decisions:
                    raise RuntimeError(
                        'pdfLaTeXのPDF内で数式文字がページ外に配置されました。'
                        ' 自動修復用のLuaLaTeXが見つかりません。'
                        ' MiKTeXでlualatexを使えるようにしてください。'
                    ) from exc
                raise RuntimeError(
                    f'{selected} が見つかりません。TeX Live / MiKTeX をインストールしてください。'
                ) from exc
            if result.returncode != 0:
                if re.search(r"(?:LaTeX Error: File .* not found|I can't find file|Emergency stop)",result.stdout):
                    raise RuntimeError(f'{selected} の環境・パッケージを確認してください。\n'+result.stdout[-2500:])
                raise FormulaRenderError(
                    f'{selected} failed for {latex!r}:\n' + result.stdout[-2500:])
            log = (work / 'formula.log').read_text(errors='replace')
            match = re.search(
                r'AIM_METRIC:\s*WIDTH=([\d.]+)pt\s*HEIGHT=([\d.]+)pt\s*DEPTH=([\d.]+)pt',
                log
            )
            if not match:
                raise RuntimeError('Could not extract TeX box metrics: ' + log[-800:])
            try:
                import pymupdf as fitz
            except ImportError as exc:
                raise RuntimeError(
                    'PyMuPDF が必要です。uv run --with fonttools --with pymupdf を使用してください。'
                ) from exc
            with fitz.open(work / 'formula.pdf') as pdf:
                page = pdf[0]
                raw_svg = page.get_svg_image(text_as_path=True)
                outliers = _invalid_pdf_text_origins(page)
                decisions.append({'engine': selected, 'invalid_text_origins': outliers})
                if outliers:
                    # Retain the actual faulty PDF before retrying, but only
                    # in explicitly requested diagnostics.
                    if debug_dir is not None:
                        debug_dir.mkdir(parents=True, exist_ok=True)
                        for suffix in ('.tex', '.log', '.pdf'):
                            shutil.copyfile(
                                work / ('formula' + suffix),
                                debug_dir / ('rejected_' + selected + suffix))
                        (debug_dir / ('rejected_' + selected + '.svg')).write_text(
                            raw_svg, encoding='utf-8')
                    if selected == attempts[-1]:
                        raise RuntimeError(
                            f'{selected} produced invalid PDF text positions: {outliers}. '
                            'フォントは更新しません。別のTeXエンジンで再確認してください。'
                        )
                    continue
                svg = _align_svg_glyphs_to_pdf(raw_svg, page)
                font_sources = collect_font_sources(pdf, work / 'formula.fls', selected)
                if debug_dir is not None:
                    debug_dir.mkdir(parents=True, exist_ok=True)
                    for suffix in ('.tex', '.log', '.pdf', '.fls', '.lua-fonts'):
                        if not (work / ('formula' + suffix)).is_file():continue
                        shutil.copyfile(
                            work / ('formula' + suffix),
                            debug_dir / ('formula' + suffix))
                    (debug_dir / 'pdf_raw.svg').write_text(raw_svg, encoding='utf-8')
                    (debug_dir / 'pdf_aligned.svg').write_text(svg, encoding='utf-8')
                    (debug_dir / 'pdf_trace.json').write_text(
                        json.dumps(
                            [{'bbox': tuple(span['bbox']),
                              'font': span.get('font'),
                              'chars': [{'codepoint': ch[0],
                                         'origin': list(ch[2]),
                                         'bbox': list(ch[3])}
                                        for ch in span['chars']]}
                             for span in page.get_texttrace()],
                            ensure_ascii=False, indent=2) + '\n',
                        encoding='utf-8')
                selected_engine = selected
                break
        if selected_engine is None:
            raise RuntimeError('No TeX renderer returned a usable PDF.')
        if debug_dir is not None:
            (debug_dir / 'render_decision.json').write_text(
                json.dumps(
                    {'selected_engine': selected_engine, 'attempts': decisions},
                    ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(svg, encoding='utf-8')
    return {
        'texWidthPt': float(match[1]),
        'texHeightPt': float(match[2]),
        'texDepthPt': float(match[3]),
        'fontSources': font_sources,
    }

