"""Find math in mixed Markdown/Quarto/Pandoc/LaTeX text.

This is a delimited math scanner, not a full TeX document parser.
All offsets are Python Unicode string offsets (the server rejects non-BMP).
Return (from, to, canonical_formula, kind, notation). No file writes.
"""
from __future__ import annotations
import re

_ENV = re.compile(r'\\begin\{(math|displaymath|equation\*?|align\*?|gather\*?|multline\*?)\}')
def _escaped(text: str, pos: int) -> bool:
    n = 0
    while pos - n - 1 >= 0 and text[pos - n - 1] == '\\':
        n += 1
    return n % 2 == 1


def _fenced_spans(text: str) -> list[tuple[int, int]]:
    """Quarto/Markdown fenced source blocks, indexed in original text."""
    spans = []
    start = -1
    marker = None
    count = 0
    offset = 0
    for line in text.splitlines(keepends=True):
        plain = line.rstrip('\r\n')
        trim = plain.lstrip(' ')
        indent = len(plain) - len(trim)
        if start < 0:
            if indent <= 3:
                opening = re.match(r'^(\x60{3,}|~{3,})', trim)
                if opening:
                    marker = opening.group(1)[0]
                    count = len(opening.group(1))
                    start = offset
        elif indent <= 3:
            close = trim.rstrip(' \t')
            if len(close) >= count and all(ch == marker for ch in close):
                spans.append((start, offset + len(line)))
                start, marker, count = -1, None, 0
        offset += len(line)
    if start >= 0:
        spans.append((start, len(text)))
    return spans


def scan_math(text: str) -> list[tuple[int, int, str, str, str]]:
    if not isinstance(text, str):
        raise ValueError('数式入力テキストがありません。')
    spans = []
    fences = _fenced_spans(text)
    fence_index = 0
    i, n = 0, len(text)
    while i < n:
        if fence_index < len(fences) and i >= fences[fence_index][0]:
            i = fences[fence_index][1]
            fence_index += 1
            continue
        start = i
        delim, opening, closing, kind = None, None, None, None
        env = None
        if text[i] == '$' and not _escaped(text, i):
            if text.startswith('$$', i):
                opening, closing, kind, delim = '$$', '$$', 'display', 'dollars-display'
            else:
                opening, closing, kind, delim = '$', '$', 'inline', 'dollars-inline'
        elif text[i] == '\\' and not _escaped(text, i):
            if text.startswith(r'\(', i):
                opening, closing, kind, delim = r'\(', r'\)', 'inline', 'paren'
            elif text.startswith(r'\[', i):
                opening, closing, kind, delim = r'\[', r'\]', 'display', 'bracket'
            else:
                match = _ENV.match(text, i)
                if match:
                    env = match.group(1)
                    opening = match.group(0)
                    closing = r'\end{' + env + '}'
                    kind, delim = ('inline' if env == 'math' else 'display'), 'environment'
        if opening is None:
            i += 1
            continue
        body_from = start + len(opening)
        j = body_from
        end = -1
        while j < n:
            if closing.startswith('$'):
                if text[j] == '$' and not _escaped(text, j):
                    if closing == '$$' and text.startswith('$$', j):
                        end = j
                        break
                    if closing == '$':
                        if text.startswith('$$', j):
                            raise ValueError('インライン数式内に$$があります。')
                        end = j
                        break
            elif text.startswith(closing, j) and not _escaped(text, j):
                end = j
                break
            j += 1
        if end < 0:
            raise ValueError('数式の閉じ記号がありません: ' + opening)
        # Physical line breaks inside display sources are layout syntax,
        # not separate Photoshop paragraphs after one-glyph conversion.
        # Keep registered latex single-line so the inverse path stays valid.
        raw_body = text[body_from:end]
        if any(ch == '%' and not _escaped(raw_body, pos)
               for pos, ch in enumerate(raw_body)):
            raise ValueError('数式内のTeX行コメント%は未対応です。コメントを削除してから変換してください。')
        formula = raw_body.strip().replace('\r\n', ' ').replace('\r', ' ').replace('\n', ' ')
        if not formula:
            raise ValueError('空の数式です: ' + opening)
        if env:
            if env.startswith('align'):
                formula = r'\begin{aligned}' + formula + r'\end{aligned}'
            elif env.startswith('gather') or env.startswith('multline'):
                formula = r'\begin{gathered}' + formula + r'\end{gathered}'
        spans.append((start, end + len(closing), formula, kind, delim))
        i = end + len(closing)
    return spans
