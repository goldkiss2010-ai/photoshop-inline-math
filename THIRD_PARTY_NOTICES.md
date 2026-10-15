# Paper Math — third-party notices

Updated 2026-10-15. Scope: the Windows Photoshop UXP + Python backend.
These are notices and source references, not a single license covering all
components or generated fonts.

## Active runtime

| Component | Baseline and purpose | License / original source |
| --- | --- | --- |
| fontTools | 4.67.0; SVG outlines, OTF construction and inspection | MIT. Copyright (c) 2017 Just van Rossum. Full text: [fonttools-MIT.txt](licenses/fonttools-MIT.txt). [Versioned source](https://github.com/fonttools/fonttools/tree/4.67.0). |
| PyMuPDF / MuPDF | PyMuPDF 1.28.2; PDF extraction and SVG/text-position checks | GNU AGPL v3, or a separate Artifex commercial license. The open-source path is used here. [Versioned source and COPYING](https://github.com/pymupdf/PyMuPDF/tree/1.28.2), [Artifex licensing](https://artifex.com/licensing). The full AGPL text is [LICENSE](LICENSE). |
| Python | 3.13.15, selected by uv | Separately installed runtime. [PSF and component license information](https://docs.python.org/3/license.html). |
| uv | Windows inventory: 0.12.19 | Separately installed launcher/environment manager; MIT or Apache-2.0. [License and source](https://github.com/astral-sh/uv). |
| MiKTeX / TeX Live | MiKTeX 25.12 observed on Windows | Separately installed distribution with multiple component licenses. Do not describe a complete TeX distribution as one licensed component. [MiKTeX copying](https://miktex.org/copying), [TeX Live copying](https://www.tug.org/texlive/copying.html). |
| standalone / amsmath / amssymb | TeX class and packages used for rendering | Separately installed TeX packages. [standalone](https://ctan.org/pkg/standalone), [amsmath](https://ctan.org/pkg/amsmath), [amsfonts](https://ctan.org/pkg/amsfonts). Their macros and actual font files must be distinguished. |
| Adobe Photoshop / UXP | Host application and API | Supplied by the user's Adobe installation; not bundled here. [UXP documentation](https://developer.adobe.com/photoshop/uxp/). |

Python wheels, uv, Python, TeX, and Photoshop are not included in the
initial source-distribution plan. The launcher obtains pinned Python
packages from their normal distribution channel. Keep upstream licenses
and corresponding-source information when changing to a bundled runtime.
PyMuPDF/MuPDF binary wheels also contain third-party components; preserve
their accompanying notices if distributing those wheels.

PyMuPDF 1.28.2's Python wrapper source includes GPL-3.0-only SPDX headers.
Retain those component-specific notices. The project's official documentation
and COPYING identify the combined PyMuPDF/MuPDF distribution's open-source
AGPL path; this notice does not overwrite individual upstream licenses.

## Fonts and outlines

- AMSFonts Type 1 files are released under the SIL Open Font License 1.1.
  The inspected CM/AMS files identify the American Mathematical Society
  and their reserved font names in the file headers. [Original package](https://ctan.org/pkg/amsfonts),
  [package README](https://ctan.org/tex-archive/fonts/amsfonts),
  [OFL full text](licenses/OFL-1.1.txt).
  New font records retain the actual file's copyright, version, reserved
  names and hash; they do not substitute a generic owner or date.
- Latin Modern is released under the GUST Font License. [Original package](https://ctan.org/pkg/lm),
  [GUST license](licenses/GUST-FONT-LICENSE.txt), [LPPL 1.3c](licenses/LPPL-1.3c.txt).
  Its copyright and version are read from the actual font when present.
- Original Computer Modern METAFONT rules, AMS Type 1 implementations,
  and Latin Modern are distinct distributions. Do not use one license
  statement to stand for all three.

The generator changes encoding, names, metrics and organization: one
formula's TeX/PDF/SVG outlines become one BMP PUA glyph. Recorded,
exclusively OFL sources receive OFL copyright/license metadata in new
OTFs. The font ZIP contains the outline notices, recorded evidence and
reference license texts. Missing or mixed source information is explicitly
marked for review. A file-name or metadata match is provenance evidence,
not a legal or cryptographic guarantee for arbitrary user-supplied fonts.

The upstream authors do not provide support for, or endorse, the modified
Paper Math font. Use Paper Math's distinct internal names. Do not rename
a derived font to a reserved source name.

## Archived experiments

Node/npm, MathJax, opentype.js and RaTeX are not dependencies of the current
Photoshop runtime. The archived browser/Node/Illustrator paths are not in
the first distribution scope. Before publishing their data or bundling
their runtimes, verify each version's license and font-origin conditions.

## License-text provenance

- `LICENSE`: GNU AGPL v3 text from PyMuPDF 1.28.2's unmodified COPYING.
- `licenses/fonttools-MIT.txt`: unmodified fontTools 4.67.0 LICENSE.
- `licenses/OFL-1.1.txt`: official OFL 1.1 body from
  https://openfontlicense.org/documents/OFL.txt ; source-specific copyright
  and reserved names accompany it in each font's notices.
- `licenses/GUST-FONT-LICENSE.txt`: GUST Font License 1.0, 22 June 2009;
  verified against the Latin Modern distribution and [TUG description](https://www.tug.org/fonts/licenses/gfl.html).
- `licenses/LPPL-1.3c.txt`: full original license from
  https://www.latex-project.org/lppl.txt / LaTeX3's base distribution.
