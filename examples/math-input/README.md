# 数式・コード・改行の入力サンプル

**2026-10-15。部分成功を本体の変換ボタンへ接続済み。実機確認用の入力です。**
このフォルダーには合成した入力だけを置いている。Python/Rのコードは文字列の試験材料。

| ファイル | 解析試作の期待結果 | 現行パネルでの用途 |
| --- | --- | --- |
| [01_valid_mixed.qmd](01_valid_mixed.qmd) | 数式7箇所・6種類、診断0件。Python/R内の偽数式は対象外。 | 正常入力の比較に使える。 |
| [02_partial_conflicts.qmd](02_partial_conflicts.qmd) | 候補5箇所、構文の保留3件。段落をまたぐインライン式は、実際の段落記述子で別途投影を判断。 | 確定した式だけ変換し、保留位置・理由を表示する。 |
| [03_unclosed_code.qmd](03_unclosed_code.qmd) | 前方の1式を候補にし、未閉鎖コード以降は保持。未閉鎖を1件報告。 | 診断比較用。コード内の式を無理に拾う仕様ではない。 |
| [04_inline_code.qmd](04_inline_code.qmd) | 数式3箇所、未閉鎖インラインコード1件。 | コードを保持し、外側の3式を変換する。 |

| [05_render_failure.qmd](05_render_failure.qmd) | 候補3式。TeX生成時に1式だけ失敗する。 | 2式を変換し、未定義コマンドの式を原文保持する。 |

## Pythonだけで入力を確認

リポジトリのルートで:

```powershell
uv run python tools/check_math_input.py examples/math-input/01_valid_mixed.qmd
uv run python tools/check_math_input.py examples/math-input/02_partial_conflicts.qmd
uv run python tools/check_math_input.py examples/math-input/03_unclosed_code.qmd --json
```

元ファイルは変更しない。CRLF/CR/LFを読み込み時に統一せず、元の文字位置で診断する。数式の解析ができても、TeXでの字形生成・Photoshopでの書式投影が成功した意味ではない。

## 自動テスト

```powershell
uv run python tools/run_partial_math_tests.py
uv run --with fonttools python tools/run_partial_integration_tests.py
```

解析テストはPythonとNode.js、接続テストは追加でfonttoolsを使う。LaTeX、フォント登録、Photoshopは不要。35例をLF・CRLF・CRへ展開し、両言語の解析結果と、通常本文・コード・保留部分の保持を確認する。

Photoshopへ正常サンプルを貼る場合、PowerShellで:

```powershell
Get-Content examples/math-input/01_valid_mixed.qmd -Raw -Encoding utf8 | Set-Clipboard
```

原文を文字どおり保持する試験ではPhotoshopの「スマート引用符を使用」をオフにする。引用符の自動変更は数式の検出とは別に確認する。

貼り付け後の改行・段落書式はPhotoshop側から取得して比較する。ソースファイルの物理改行形式と、Photoshopの段落記述子が同じ分類になるとは限らない。

実装順序と残る試験は [TESTING.md](../../docs/TESTING.md)。
