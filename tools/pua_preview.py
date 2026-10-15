"""Create a self-contained, read-only HTML glyph catalogue from *our* OTF.

The input font must be validated by the caller as the project's generated
font. Do not accept a client-specified font file, path or PostScript name.
"""
from __future__ import annotations

import base64
from html import escape

from readonly_mapping import validate_registry

MAX_EMBEDDED_FONT_BYTES = 16 * 1024 * 1024


def make_preview_html(registry: dict, font_data: bytes, display_name: str | None = None) -> str:
    """Return standalone HTML; no TeX rendering, registry edits or OS writes."""
    validate_registry(registry)
    if not isinstance(font_data, bytes) or not font_data:
        raise ValueError('プレビュー用の生成済みOTFがありません。')
    if len(font_data) > MAX_EMBEDDED_FONT_BYTES:
        raise ValueError('OTFが16MBを超えるため単体HTMLに埋め込めません。')
    entries = registry['entries']
    font = registry['font']
    family = escape(font['family'], quote=True)
    display = escape(display_name, quote=True) if display_name else None
    display_line = '<span>フォント: '+display+'</span>' if display else ''
    ps_name = escape(font['postscript_name'], quote=True)
    cards = []
    for i, item in enumerate(entries):
        cp = int(item['codepoint'], 16)
        code = f'U+{cp:04X}'
        glyph = f'&#x{cp:04X};'
        latex = escape(item['latex'], quote=True)
        cards.append(
            f'<article class="item" id="pua-{cp:04X}">'
            f'<div class="glyph" aria-label="{code}">{glyph}</div>'
            f'<div class="identity"><span>{code}</span><span>#{i + 1:03d}</span></div>'
            f'<code class="source">{latex}</code>'
            '</article>'
        )
    count = len(entries)
    gallery = '\n'.join(cards) if cards else (
        '<p class="empty">登録済み数式はありません。</p>'
    )
    encoded = base64.b64encode(font_data).decode('ascii')
    # All content is local; no CDN, scripts, user-supplied markup or remote URL.
    return f'''<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'">
<title>Paper Math — PUA glyph catalogue</title>
<style>
@font-face {{
  font-family: 'PaperMathCatalogue';
  src: url(data:font/otf;base64,{encoded}) format('opentype');
  font-display: block;
}}
:root {{ color-scheme: light; font-family: system-ui, 'Noto Sans JP', sans-serif; color:#232a33; background:#f5f6f8; }}
* {{ box-sizing: border-box; }}
body {{ max-width:1200px; margin:0 auto; padding:32px 18px 80px; }}
h1 {{ font-size:1.55rem; margin:0 0 8px; }}
p {{ line-height:1.6; color:#566473; }}
.metadata {{ margin:14px 0 28px; display:flex; flex-wrap:wrap; gap:12px; }}
.metadata span {{ padding:7px 10px; background:#e9edf2; border-radius:6px; font-size:.86rem; }}
.gallery {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:13px; }}
.item {{ background:white; border:1px solid #d9dfe8; border-radius:10px; overflow:hidden; min-width:0; }}
.glyph {{ font-family:'PaperMathCatalogue'; font-size:48px; line-height:1.75; white-space:nowrap; overflow-x:auto; padding:24px 14px; background:#fff; min-height:137px; }}
.identity {{ display:flex; justify-content:space-between; padding:10px 13px 4px; font-size:.79rem; color:#526377; font-variant-numeric:tabular-nums; }}
.source {{ display:block; white-space:pre-wrap; overflow-wrap:anywhere; border-top:1px solid #e3e7ed; margin:8px 0 0; padding:12px 13px; color:#273342; font-size:.88rem; }}
.note {{ margin-top:30px; font-size:.85rem; }}
@media print {{ body {{ background:#fff; }} .gallery {{ grid-template-columns:repeat(3,1fr); }} .item {{ break-inside:avoid; }} }}
</style>
</head>
<body>
<h1>Paper Math — PUA数式一覧</h1>
<p>生成済みフォントに含まれる数式と、登録簿のLaTeX・文字コードの対応を確認します。</p>
<div class="metadata">
{display_line}
<span>Family: {family}</span><span>PostScript: {ps_name}</span>
<span>登録数: {count}</span><span>Engine: pdfLaTeX / fontTools</span>
</div>
<section class="gallery" aria-label="数式グリフ一覧">
{gallery}
</section>
<p class="note">このHTMLには生成済みOTFを埋め込んでいます。ネット接続なしで開けます。制作物以外への再配布はフォント輪郭のライセンスを確認してください。文字コードとLaTeXの対応はこのフォント固有です。</p>
</body>
</html>
'''


def make_current_preview(registry: dict, font_file, display_name: str | None = None) -> str:
    """Validate generated OTF's PS identity and PUA cmap before embedding."""
    from io import BytesIO
    from fontTools.ttLib import TTFont

    data = font_file.read_bytes()
    if len(data) > MAX_EMBEDDED_FONT_BYTES:
        raise ValueError('生成OTFがプレビューの上限16MBを超えています。')
    validate_registry(registry)
    with TTFont(BytesIO(data)) as font:
        postscript_name = font['name'].getDebugName(6)
        family_name = font['name'].getDebugName(1)
        if postscript_name != registry['font']['postscript_name'] or (
            family_name != registry['font']['family']
        ):
            raise ValueError('フォント内部名と登録簿の名前が一致しません。')
        cmap = font.getBestCmap() or {}
        expected = {int(e['codepoint'], 16) for e in registry['entries']}
        actual = {n for n in cmap if 0xE000 <= n <= 0xF8FF}
        if actual != expected:
            raise ValueError('OTFのPUA文字集合が登録簿と一致しません。')
    return make_preview_html(registry, data, display_name)

