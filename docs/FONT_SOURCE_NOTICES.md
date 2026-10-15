# Paper Math — 生成フォントの出所通知

**2026-10-15。** コードのAGPLと、フォント輪郭の条件を分けて扱う実装です。通知の追加は通常の数式変換・復元を止める規則ではありません。

## 記録するもの

TeXへ `-recorder` を指定し、採用したPDFの使用フォント名を、そのTeX実行が読み込んだPFB/PFA/OTF/TTFのPostScript名と照合します。入力フォントのSHA-256と、PDFに埋め込まれたフォントプログラムのSHA-256を別々に記録します。PDFのサブセットと入力ファイルのバイト列が一致するという意味ではありません。

LuaLaTeXでは、数式ボックスの組版後に `font.each()` の実ファイル名（`filename` / `properties.filename`）を一時ファイルへ補足し、同じ照合に使います。Lua側で読み込んだOTFが通常の `.fls` に現れない場合に対応します。補足処理の失敗は描画を止めず、未解決の記録を維持します。pdfLaTeXではLuaの補足を使わず、再試行前には補足ファイルを消します。

入力ファイルから実際のcopyright、version、OFL/GUSTの表示、予約名を読むため、候補ファイルの存在だけで字形の出所を推測しません。複数の異なる入力が同じPostScript名を持つ場合や、PDFで使った書体に対応する入力がない場合は未解決として記録します。採用しなかったPDFの記録を成功版へ混ぜません。

新規式の一時描画、描画キャッシュ、登録簿、フォント生成へ `fontSources` を引き継ぎます。登録された式の `svgSha256` は実際に使ったSVGに対応します。BMPのPUA対応、内部名、文字の形と配置は従来どおりです。

記録の取得に失敗しても、描画自体の成功をライセンス判定で取り消しません。記録を `unavailable` とし、以後の通知で未確認と表示します。TeX構文・環境・PDF位置・SVG整合性・OTFの既存検査は維持します。

## OTFとZIP

| 対象 | 内容 |
| --- | --- |
| 新しく生成するOTF | 全式の出所が記録され、入力輪郭がOFLだけで、実copyrightを採取できた場合はname ID 0・13・14へcopyright・OFL本文・参照URLを追加。内部名、PUA、字形プログラム、アドバンス・行のメトリクスは変えない。 |
| `FONT_NOTICES.txt` | 実際の書体名・版・copyright・予約名・入力ハッシュ、原配布先、変更内容、責任主体。未知・混在の場合はその点を表示。 |
| `font-sources.json` | 式ごとの記録、記録不足・未解決のPUA一覧、集約した元フォント情報。ローカルの絶対パスは含めない。 |
| `licenses/` | OFL 1.1、GUST Font License 1.0、LPPL 1.3cの本文。未知の書体の許諾をこれらで補うものではない。 |
| `registry.json` / `bundle.json` | 持ち運べる出所記録を対応表へ追加。通知を含む各ファイルのハッシュと、出所の記録範囲をmanifestへ含める。 |

通知ZIPの `font_license_notices` は、OFLの出所通知を添えた `ofl-source-notices`、または `source-review-required`。出所の記録範囲は `complete` / `incomplete` で、権利確認の完了を表す値ではありません。JSONの `license_clearance` はfalseのままです。OFLだけという観察は、任意のフォントの完全な権利・改変条件を保証しません。

## 既存フォント

pullやサーバー再起動だけで、既存OTF・登録済みPUA・Windows登録を書き換えません。既存登録簿に出所がない場合はそのPUAを未記録として通知します。書き出し自体は読取りで、出所を埋めるために再描画しません。

今後の追加生成や通常の再生成で、新しい描画・キャッシュが作られた式から出所が記録されます。この変更により描画コードのキャッシュキーが更新されます。既存OTFを使うためだけの再インストールは不要です。式追加などでOTFの内容を更新した場合は、従来どおり生成版とWindows登録版を照合します。

OFLとGUST/LPPL、その他の素材が混ざる場合は、まとめてOFLやAGPLと宣言せず、各入力・改変・提供条件を確認します。元の書体が制作された版やライセンスの違いも保持します。

## 確認済みと残る確認

- 自動試験では、入力とPDFの対応、同名異字体の未解決扱い、パス除外、出所のキャッシュ・新規登録への引継ぎ、ZIPの通知・ハッシュ、OFL nameメタデータ追加を確認。
- 実OTFの字形プログラム、cmap、内部名、アドバンスと行メトリクスが、通知を追加する前と同じであることを確認。
- このLinux環境の実pdfLaTeXで分数と、黒板太字・総和・根号・合字の入力を変更前後で比較し、SVGのバイト列とTeX寸法が一致。AMSの実ファイルからOFL情報を採取。
- LinuxのLatin Modern実OTFにはGUST表示があり、抽出を確認。この環境のLuaLaTeXはluaotfload/luatex85等が不足して描画できず、代替描画の完了確認には使っていない。
- Windows/MiKTeXのユーザー実行ではLuaLaTeX→SVG→OTFが成功。AMS 7書体は照合済みで、LMRoman10-Regularの入力記録だけが未解決だったためLua補足を追加。修正後のWindows点検ではLMRoman10-Regularを含む全8書体が照合され、source_coverage completeとなった。
- 既存制作フォントの出所充足、混在ライセンスの配布条件、他PCへの導入は残る確認。コードのLICENSE追加と、全フォントの配布条件確定を同じ完了として扱わない。

Windowsでの初回点検は [INSTALL_WINDOWS.md](INSTALL_WINDOWS.md)。コードの範囲は [LICENSE_SCOPE.md](../LICENSE_SCOPE.md)、依存と元配布先は [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) を参照します。
