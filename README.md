# Paper Math for Photoshop

LaTeXの数式を、Photoshopの本文へ文字として組み込むプラグインです。数式を1つのフォントグリフに変換し、同じテキストレイヤー上でLaTeXへ戻して編集できます。

Paper Math turns LaTeX expressions into individual OpenType glyphs for native Photoshop text, with a persistent LaTeX/PUA mapping for reverse conversion.

**Windowsプレビュー / 0.8.2。** Windows 10・Photoshop 27.4.0で、CCXの導入とUDTを使わない起動について成功報告があります。別PCでの初回導入確認はこれからです。

## はじめる

1. このリポジトリをZIPで取得してすべて展開するか、配布用ZIPを展開します。
2. [MiKTeX](https://miktex.org/download)などのTeX環境を準備します。必要なパッケージは[導入ガイド](docs/INSTALL_WINDOWS.md)を参照してください。
3. `Setup_Paper_Math.cmd` をダブルクリックします。専用のPython環境と必要なパッケージを準備します。
4. `Install_Photoshop_Plugin.cmd` を開き、Creative Cloudでインストールします。確認画面が出ない場合は `Install_Photoshop_Plugin_Alternative.cmd` を試します。
5. `Start_Paper_Math.cmd` を開き、Photoshopの「プラグイン」→「Paper Math」を選びます。

利用時にGit、Node.js、UXP Developer Toolは必要ありません。初回セットアップにはネット接続が必要です。処理用の起動ウィンドウは作業中は開いたままにします。

## 普段の使い方

1. テキストレイヤーへ、本文と `$x_i^2$` などの数式を入力します。
2. Paper Mathで制作物用のフォントを作成または選択し、数式を変換します。
3. フォントを新規生成・更新したときは、パネルの案内に沿ってOTFをWindowsへインストールして適用します。
4. 再編集するときは、同じフォントを選んでLaTeXへ復元します。

同一レイヤーでの変換・復元が標準です。元レイヤーの複製保存も任意で選べます。QMD等のコードフェンス・インラインコードは変換対象から除外し、曖昧な数式や個別のTeX構文エラーは、その範囲を原文のまま保留します。

## フォントと制作データ

フォントの表示名変更、登録式数の確認、OTF・対応表・出所通知をまとめたZIP保存に対応します。**フォントと対応表は一組で保管**してください。別端末でPSDを表示するには、その制作物のOTFの導入が必要です。

エクスプローラーで選ぶインストール用OTFとZIP内のOTFは、`PaperMath-配布確認-4f3b3403.otf` のように管理画面の表示名を含むファイル名にします。中身は生成済みフォントと同じです。Photoshopのフォント一覧に出る名前と内部の識別名は、従来のASCII名を維持します。

配布用ZIPでは制作データを `%LOCALAPPDATA%\PaperMath\data` へ保存します。GitやGitHubのソースZIPから起動する場合は、その作業フォルダー内へ保存します。[保存先と更新](docs/WINDOWS_PREVIEW.md)を参照してください。

## 現在の範囲

- 対象はWindowsのPhotoshopです。TeXは別途導入し、フォントのWindows登録は手動です。
- 数式入力は `$...$`、`$$...$$`、`\(...\)`、`\[...\]` と対応する数式環境。復元は `$...$` に統一します。
- 約36,000文字のコード混在原稿の往復とPSD再オープンについて実機成功報告があります。すべての長文・書式・環境の保証ではありません。
- 数式内の改行・元の区切り記号・変換前の数式書式の完全復元、ZIPの自動読み込み、他アプリとの相互編集は現在の対象外です。
- ブラウザ版・Illustrator版・過去の実験はこのリポジトリに含めません。ブラウザ版の機能整理とPagesは後続の作業です。

詳細は[現行仕様](docs/CURRENT_SPEC.md)、[フォント管理](docs/PROJECT_FONT_MANAGEMENT.md)、[検証状況](docs/TESTING.md)を参照してください。

## 開発と配布

```powershell
uv run --no-project --python 3.13.15 --with fonttools==4.67.0 python tools/run_partial_integration_tests.py
uv run --no-project python tools/prepare_uxp_package.py --check-ccx plugin/PaperMath.ccx
uv run --no-project python tools/build_distribution.py
```

テストにはNode.jsも必要です。通常利用には必要ありません。配布ZIPは `local-build/PaperMath-Windows-preview.zip` に生成し、編集可能なソース・CCX・テスト・ライセンス・通知を含みます。

CCX本体を変更する場合は、[作者向けパッケージ手順](docs/PACKAGE_PHOTOSHOP.md)に沿ってAdobe UXP Developer Toolで再作成します。通常の開発情報は[検証手順](docs/TESTING.md)、由来は[ORIGIN.md](docs/ORIGIN.md)、残る確認は[RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)へまとめています。

## ライセンス

原コードは **AGPL-3.0-only**。[LICENSE](LICENSE)、[適用範囲](LICENSE_SCOPE.md)、[依存の通知](THIRD_PARTY_NOTICES.md)を参照してください。生成フォントの輪郭には元フォントの条件が適用され、利用者の原稿やPSDへアプリのライセンスを一律に適用するものではありません。生成フォントには[出所通知](docs/FONT_SOURCE_NOTICES.md)を添付します。
