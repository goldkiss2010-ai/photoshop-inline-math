# Paper Math — フォントの作成・選択・表示名・書き出し

**更新: 2026-10-16。Photoshop版0.8.2＋新規フォント名の改善。**
作成・選択・追加生成、表示名変更とZIP書き出しに対応する。通知を含む実機保存ZIPの確認報告がある。操作・停止条件は [現行仕様](CURRENT_SPEC.md)。

## 名前と識別

Paper Mathで作成したフォントは `project.json` に日本語を含む表示名を保存する。名前は1〜28文字、文字・数字・空白・ハイフン・下線。同じ表示名は大文字小文字を区別せず重複不可。変更するのは表示名だけで、Family/PostScript名・生成OTF・PUA対応・生成情報・選択中のIDを変更しない。名前変更だけならWindowsへ再インストールする必要はない。

新規フォントのWindows/Photoshop用Family名は、作成時の名前と8桁の識別子を含める。例：`配布確認` → `Paper Math 配布確認 4f3b3403`。Family全体を31 UTF-16単位以内に収めるため、名前の部分は先頭11単位まで使う。管理画面には入力した名前全体を保持する。短い識別子を含むFamily名も作成時に固定し、その後の表示名変更や式の追加では変えない。

| 名前 | 用途と変更 |
| --- | --- |
| 管理画面の表示名 | 日本語可。後から変更できる |
| Windows/PhotoshopのFamily名 | 作成時の名前＋8桁ID。作成後は固定 |
| PostScript名・OTFファイル名 | 従来と同じ16桁IDを含むASCII名。照合・復元に使う |

旧管理フォント（`project.json` のschema 1）は、従来の `Paper Math <16桁ID>` のまま読み込む。自動移行・既存OTFの改名は行わない。新規フォントはschema 2に固定の `creation_name` を保存するため、この更新より前のサーバーでは扱えない。対応表のschemaとPUAの割り当て方法は変わらない。

日本語のFamily/Full nameはOpenTypeのnameテーブルへ記録し、PostScript名とCFF内の名前はASCIIに保つ。根拠：[OpenType nameテーブル](https://learn.microsoft.com/en-us/typography/opentype/spec/name)、[Adobe CFF仕様](https://adobe-type-tools.github.io/font-tech-notes/pdfs/5176.CFF.pdf)。生成・読取り・照合は確認済み。日本語FamilyのWindows導入とPhotoshop一覧での表示は実機確認を行う。

一覧と選択中の表示に登録数式数を示す。これは一意な登録式の数であり、選択レイヤーの出現数とは別。詳細欄にはWindows/Photoshopで使うフォント名も表示する。名前を変更しても、Photoshopのフォント一覧の名前は同じ。

旧 `InlineMathLab-Regular` はlegacyとして残す。表示名変更はPaper Mathで作成した管理フォントが対象。legacyでも生成済みOTFと対応表の書き出しは可能。

## 同じフォントへ式を追加する

local-build/paper-math-projects/pm-<16文字ID>/ にプロジェクトを独立管理する。一度登録したPUAの意味を維持して式を追加する。別プロジェクトで同じU+E000が違う式を指すことはあるため、管理フォントの復元は内部PostScript名を照合する。旧legacyの限定的なフォント不一致互換は別の経路として維持する。

Windowsの登録版と生成OTFは読取り照合し、インストールは手動。表示名変更とZIP書き出しは生成・OS登録・PSD編集を行わない。

## ZIPへまとめて保存する

「フォントを作成・管理」内で「フォントと対応表をZIPに書き出す」を押し、保存先を選ぶ。選択したフォントの生成済みOTFが現在の対応表と一致する場合に保存する。未生成の空プロジェクトや不一致は理由を表示し、書き出しのために再生成しない。

| ZIPの内容 | 用途 |
| --- | --- |
| 内部名.otf | 選択中の生成済みフォントのバイト列そのもの |
| registry.json | 対応するLaTeX/PUA、必要な生成メトリクス。SVGキャッシュのローカルパスを除く |
| project.json / stamp.json | 管理フォントの表示名・ID・内部名、新規フォントの作成時名と、生成版の照合情報。legacyには含めない |
| bundle.json | プロジェクト、登録式数、各ファイルのSHA-256 |
| README.txt | OTFと対応表を組で扱う手順、読み込み機能の範囲 |
| FONT_NOTICES.txt / font-sources.json | 字形の実出所・版・copyright・ハッシュ・変更内容と、未記録／未解決のPUA一覧 |
| licenses/ | OFL・GUST・LPPLの参照本文。未知の書体への許諾を意味しない |

登録LaTeXと、記録済みの持ち運べる字形出所はZIPへ含まれる。PSD・SVGキャッシュ・OS登録情報・サーバー実行環境は含まれない。ZIPの自動読み込み・削除は未実装。別端末でPSDを表示する場合はOTFの導入が必要で、LaTeXへの復元には対応する登録簿も必要。通知の仕組みは [FONT_SOURCE_NOTICES.md](FONT_SOURCE_NOTICES.md) に実装済み。旧フォントの未記録や混在の配布条件確定は別の確認項目。

## 実機の確認手順

1. `Start_Paper_Math.cmd` を起動し、Photoshopの「プラグイン」からPaper Mathを開く。
2. 新しい管理フォントを日本語名で作成し、式を生成してOTFを導入する。Windows/Photoshopで作成時の名前＋8桁IDが表示されることを確認する。次に管理欄の「選択中のフォントの表示名」に別名を入れ、「表示名を変更」。
3. 一覧と選択中の名前が更新されること、Windows/Photoshopのフォント名が変わらないことを確認。既存PSDのLaTeX↔PUA往復も確認する。
4. サーバーとパネルを再起動し、表示名が残っていることを確認。
5. 生成済みのフォントをZIPへ保存。解凍し、OTFとregistry.json、管理フォントならproject.jsonとstamp.jsonも含まれることを確認。保存ダイアログのキャンセルも試す。
6. 新規の空プロジェクトではZIP保存ボタンが使えず、式を生成すると使えることを確認。未登録のWindowsフォントでも、生成済みで対応表と一致するOTFは書き出せる。
7. legacyへ切り替え、表示名変更が対象外で、既存の変換・復元・ZIP書き出しが使えることを確認。

表示名変更は適用待ちの変換がある間は無効。ZIPは読み取り操作なので、生成フォントのWindows登録・適用待ちでも利用できる。

## 検証

[TESTING.md](TESTING.md)に自動試験と実機報告をまとめる。通知を含む実機保存ZIPはOTF・対応表・ハッシュを読取り確認済み。別端末への導入と、リリース候補の操作ごとの確認は別途行う。
