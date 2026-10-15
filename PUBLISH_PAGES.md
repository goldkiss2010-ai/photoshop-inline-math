# 利用者向けHTMLマニュアルをGitHub Pagesへ公開する

利用者向けページは [docs/index.html](docs/index.html) です。CSS・説明・補助JavaScriptを単一HTMLへ収めているので、ビルドやNode.jsの導入は不要です。GitHub Pages以外のホスティング設定や独自ドメインは追加していません。

## 初回の公開設定

1. [Windowsプレビュー公開手順](PUBLISH_WINDOWS_PREVIEW.md)に沿って、公開用ZIPをGitHub Releaseへ添付します。一般配布する場合はリポジトリをPublicへ変更してReleaseを公開します。
2. リポジトリの [Settings → Pages](https://github.com/goldkiss2010-ai/photoshop-inline-math/settings/pages) を開きます。
3. **Build and deployment → Source** で **Deploy from a branch** を選びます。
4. Branchを **main**、フォルダーを **/docs** にして **Save** を押します。
5. Pages設定画面で公開完了とURLを確認します。標準のURLは <https://goldkiss2010-ai.github.io/photoshop-inline-math/> です。

`docs/.nojekyll` によりHTMLをそのまま公開します。以後は `main` の `docs/index.html` を更新すると、Pagesの公開処理が実行されます。アプリや既存のテスト用workflowは変更していません。

作成時点ではリポジトリはPrivate、Releaseは未公開、Pagesも未設定です。利用中のGitHub接続にはPages設定・Release作成・添付・リポジトリ公開設定の変更操作がないため、上の設定はGitHub画面から行います。GitHub FreeでのPages利用にはPublicリポジトリが必要です。

## ダウンロードボタン

ページは公開された `v0.8.2-preview.1` のReleaseをGitHub APIで読み取り、`PaperMath-Windows-preview.zip` が添付・公開済みならダウンロードボタンを表示します。Pre-releaseも対象です。未公開なら「公開準備中」、ZIP未添付なら「配布ZIPを準備中」と表示します。

- 「Source code」の自動生成ZIPを、配布ZIPの代わりにはしません。
- `SHA256SUMS.txt` も添付済みなら照合用リンクを表示します。
- APIの通信失敗・利用制限時やJavaScript無効時にも、通常のRelease一覧へのリンクは残ります。ログイン情報やトークンをページへ埋め込みません。
- ダウンロード可能と判定するのは、指定タグ・指定ファイル名・このリポジトリの正規ダウンロードURLに一致する添付だけです。

次の配布版へ切り替えるときは、`index.html` の `data-release-tag` と、版番号・対応する説明を更新します。`/releases/latest` はPre-releaseを除くため使用しません。

## 更新時の確認

- ページ内目次、配布ファイル名、リンク先が正しいこと。
- 説明とパネルの実際のボタン名・配布ファイルが一致すること。
- スマートフォン幅で手順や長いファイル名がはみ出さないこと。
- 公開前・ZIP未添付・公開後・通信失敗で、ダウンロード状態が正しく表示されること。
- 直接HTMLを開いた場合も、手順と目次を読めること。印刷時はFAQの回答も表示されます。

`FIRST_START.html` は展開後の短い案内として維持します。今後ビルドする配布ZIPには `docs/index.html` も同梱し、詳しい使い方をオフラインで読めるようにします。確定済みの配布ZIPと `release/windows-preview-1` は、Pagesの追加のために作り直しません。

公式の参照：[Pagesの公開元設定](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)、[Pagesサイトの作成](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)。
