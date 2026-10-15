LaTeXの数式を、Photoshopの本文へ文字として組み込むPaper Mathの初回Windowsプレビューです。

制作物ごとに数式フォントを作り、使う式を追加できます。変換した数式は同じテキストレイヤー上でLaTeXへ戻して編集します。

## 入手と導入

Assetsの **PaperMath-Windows-preview.zip** をダウンロードしてすべて展開し、`PaperMath/FIRST_START.html` を開いてください。GitHubの「Source code」は、開発者向けのソース取得用です。

1. MiKTeXなどのTeX環境を用意します。
2. `Setup_Paper_Math.cmd` で専用Python環境を準備します。
3. `Install_Photoshop_Plugin.cmd` でプラグインを導入します。確認画面が出ない場合は同梱のAlternative版を試します。
4. `Start_Paper_Math.cmd` を開き、Photoshopの「プラグイン」→「Paper Math」から使います。

通常利用にGit・Node.js・UXP Developer Toolは不要です。TeXは別途導入し、生成・更新したOTFのWindowsへの登録は手動です。作業中はStartのウィンドウを開いておきます。

## このプレビューで使えること

- 本文とLaTeX数式の変換・復元。同一レイヤーでの往復、任意の複製レイヤー。
- QMD等の行内コード・コードフェンスを除外した数式検出。曖昧な箇所や個別のTeX構文エラーは原文で保留。
- 制作フォントの作成・選択・式の追加・管理画面の表示名変更。
- 日本語ファイル名のインストール用OTF、フォントとLaTeX/PUA対応表・出所通知のZIP保存。
- 初回の導入案内、混在入力サンプル、点検用ランチャー。

## 確認した環境と範囲

Windows 10 / Photoshop 27.4.0 / MiKTeX 25.12の一環境で、CCX導入、UDTなしの起動、配布ZIPからのセットアップ・起動・変換／復元に成功報告があります。約36,000文字のコード混在原稿の往復とPSD再オープンも確認報告があります。

この公開用ZIPは、実機確認済みの配布物と同じ処理コード・CCX・ランチャーへ、案内と混在サンプルを追加したものです。関連79ファイルのバイト列一致、CCXのソース照合、ZIPの全収録ファイルのハッシュと案内リンクを検証しています。別PCでの初回導入は未確認です。

## 制約

- 対象はWindowsのPhotoshopです。Macや他アプリとの相互編集は今回の対象外です。
- 絵文字などBMP外の文字を含むテキストレイヤーは未対応です。
- 復元時の区切りは `$...$` に揃います。元の区切り記号・数式内の改行・数式書式の完全復元は行いません。
- 本文書体を推定できない数式だけのレイヤーでは、復元を停止します。
- フォントZIPの自動読み込みと管理フォントの削除UIは未実装です。OTFと対応表を一組で保管してください。
- 名称とアイコンは暫定です。

同梱の `docs/KNOWN_LIMITATIONS.md` と `docs/TROUBLESHOOTING.md` に詳しい説明があります。

## ソース・ライセンス・照合

編集可能なPython・UXP・PowerShellのソース、テスト、通知をZIPへ同梱しています。Python実行環境、TeX、制作フォントやPSDは同梱しません。

アプリの原コードはAGPL-3.0-onlyです。生成フォントの輪郭には元フォントの条件が適用され、利用者の原稿やPSDへアプリのライセンスを一律に適用するものではありません。同梱の `LICENSE_SCOPE.md`、`THIRD_PARTY_NOTICES.md`、生成フォントの出所通知を参照してください。

配布ZIP生成時のソース：`30569e6d8381407ef678348dddbad06b8c9ab5e0`。CCXは0.8.2 / `com.goldkiss2010.papermath`です。ZIPの照合値はAssetsの **SHA256SUMS.txt** に記載しています。
