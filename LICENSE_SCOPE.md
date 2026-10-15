# Paper Math — license scope

Copyright (C) 2026 Paper Math contributors.

Paper Math's original application source code, tests, launch scripts and
original project documentation are licensed under the GNU Affero General
Public License, version 3 only (SPDX: AGPL-3.0-only). See [LICENSE](LICENSE)
for the full terms. The software is provided without warranty.

You may modify and redistribute this code under those terms. Preserve the
notices and provide the corresponding source for the version distributed.
When running a modified network service, follow AGPL section 13's source
offer requirements. Merely putting the UXP panel and Python backend in
different processes does not remove their license obligations.

This checkout includes editable source for the UXP panel and Python
backend, their tests and launcher. Source distributions must include those
files, build/run information, this license and third-party notices. A
reference to a private GitHub page is not a source offer to recipients who
cannot access it. Supply the actual source with an installer or provide an
accessible download of the matching source.

## Separate material

The application license does not relicense third-party components, fonts,
or font outlines. Third-party license documents retain their original
terms. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) describes the current
Photoshop/Python runtime.

Generated OTFs, SVG outlines, TeX font data and existing assets need their
own source notices. Original AMS Type 1 material marked OFL retains OFL
conditions, including copyright and reserved names. Latin Modern material
marked GUST Font License retains its conditions. Mixed or unidentified
outline sources are not automatically cleared under either license.

The project-wide code grant does not apply to third-party outline data in
assets, generated binaries, quoted third-party works, or a user's PSD,
manuscript, LaTeX content or artwork. Merely using this program does not
assign the user's work to the application license.

The browser/Node/RaTeX and Illustrator experiments are outside the initial
Photoshop distribution. Releasing their third-party outline data requires
separate review; the code license is not a clearance for those assets.

## 現在の配布方針

原コードはAGPL-3.0-onlyで整備し、WindowsのPhotoshop UXP＋ローカルPython版を最初の配布対象にします。コード・依存の通知と、生成フォントの出所通知を分けます。

生成フォントのZIPには `FONT_NOTICES.txt` と `font-sources.json`、関連するライセンス本文を添付します。出所未記録・未知のライセンス・OFLとGUST等の混在を、単に「全てOFL」へ置き換えません。新しい記録は生成時に採取し、既存OTFの書き換えやOS登録を自動的に行いません。
