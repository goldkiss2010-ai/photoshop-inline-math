# Windowsでの導入

対象はWindowsのPhotoshopです。動作報告はWindows 10 / Photoshop 27.4.0。配布用の `PaperMath-Windows-preview.zip` をすべて展開し、`PaperMath` フォルダーを保存します。中の `FIRST_START.html` が最初の案内です。ソースZIPからも導入できますが、制作データの保存先が異なります。

## 初回だけ行うこと

1. [MiKTeX](https://miktex.org/download)などのTeX環境を準備します。`pdflatex`、`lualatex`、`kpsewhich` と、`standalone`、`amsmath`、`amssymb` の各パッケージが必要です。MiKTeXの追加パッケージ導入が表示された場合は確認します。
2. `Setup_Paper_Math.cmd` を開きます。専用のPython 3.13.15・fontTools 4.67.0・PyMuPDF 1.28.2を準備します。初回はネット接続が必要です。Pythonを手動で選ぶ操作は不要です。
3. `Install_Photoshop_Plugin.cmd` を開きます。Creative Cloudの確認画面でインストールを選びます。
4. `Start_Paper_Math.cmd` を起動し、Photoshopの「プラグイン」→「Paper Math」を開きます。

利用者がGitやUXP Developer Toolを用意する必要はありません。アプリ本体とTeXは別の導入です。フォント生成・更新時にはパネルの案内に沿ってOTFをWindowsへインストールします。

## 最初の数式を変換する

1. Photoshopで新しいPSDを作り、テキストレイヤーへ `本文 $x_i^2$ と $\frac{a+b}{c}$。` と入力します。
2. Paper Mathの「フォントを作成・管理」を開き、制作物用の名前でフォントを新規作成します。
3. テキストレイヤーを1つ選択して変換します。フォント生成後、案内された「フォントの更新先を開く」を押します。
4. 選択された日本語ファイル名のOTFをWindowsへインストールし、パネルでフォントを照合して適用します。Photoshopが新規フォントを認識しないときは、保存後にPhotoshopを再起動し、同じフォントを選んで変換し直します。
5. LaTeXへ復元し、本文と数式が戻ることを確認します。

フォントのインストールは最初の生成と、式を追加してOTFが更新されたときに行います。すでに登録済みの式だけを使い、生成版も同じなら、毎回インストールする必要はありません。原稿の例は[混在サンプル](../examples/math-input/README.md)に収録しています。

## インストール確認画面が出ない場合

`Install_Photoshop_Plugin_Alternative.cmd` をダブルクリックします。Creative Cloudを標準の場所から直接呼び出し、同梱CCXのインストール確認を開きます。通常の関連付けやUPIA経由が `-645` で失敗したWindows実機で、元となる直接呼び出しの成功報告があります。

この代替方法はCCの内部起動引数を使います。別バージョンのCCでも使えることを保証する公開APIではありません。今回のランチャー化と、空白・日本語を含むパスでの実機確認は別途進めます。

ランチャーの正常終了は要求送信の結果です。導入完了はCreative Cloudのプラグイン管理とPhotoshopのパネルで確認します。UPIAが `status = -645` を表示した場合は、PowerShellの `$LASTEXITCODE` が0でも成功とは扱いません。

CCが見つからないと表示された場合や、代替方法でも画面が出ない場合は、その表示とCCのバージョンを確認します。Windows側のCC連携と、プラグイン本体の処理を分けて調べます。

## 普段の起動と終了

`Start_Paper_Math.cmd` を起動してから、PhotoshopでPaper Mathを開きます。処理用ウィンドウは作業中は開いたままにします。終了するときはCtrl+Cまたはウィンドウを閉じます。

フォントを選び、テキストレイヤーを選択して変換・復元します。新規生成・更新したOTFの導入が必要な場合は、パネルに手順を表示します。コードを含むQMD/TeX原稿を文字どおり保持するときは、Photoshopのテキスト環境設定でスマート引用符をオフにします。

## 点検する

`Check_Paper_Math.cmd` は、一時フォルダーでTeX→SVG→OTFを点検します。制作フォントやPSD、Windows登録フォントは変更しません。

開発環境からの詳細点検は次のコマンドです。

```powershell
uv run --no-project --python 3.13.15 --with-requirements requirements-runtime.txt python tools/check_setup.py --render --json
```

出所記録の `complete` は、使用した字形の記録が揃ったことを示します。すべてのフォントの配布条件を一括で認定する値ではありません。

保存先・バックアップ・更新は [WINDOWS_PREVIEW.md](WINDOWS_PREVIEW.md)、作者のCCX作成は [PACKAGE_PHOTOSHOP.md](PACKAGE_PHOTOSHOP.md)を参照してください。

[既知の制約](KNOWN_LIMITATIONS.md)と[トラブル対処](TROUBLESHOOTING.md)も参照できます。
