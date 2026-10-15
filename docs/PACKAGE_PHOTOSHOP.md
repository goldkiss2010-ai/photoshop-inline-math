# 作者向け：CCXと配布ZIPを作る

利用者は同梱CCXをインストールします。Adobe UXP Developer Tool（UDT）は、作者がCCXを作成するときにだけ使います。

## 収録済みCCX

`plugin/PaperMath.ccx` はUDTで作成した実CCXです。0.8.2 / `com.goldkiss2010.papermath`。2026-10-15にWindowsのユーザーが導入とUDTなしの起動成功を報告しました。

SHA-256: `705672f2b5dcdebb3975cf6a11034764da5095e2a0023146efb2a202b0e318d6`

JavaScript・HTML・CSS・アイコン・通知の40ファイルをソースと照合済みです。テキストのLF/CRLF差は許容し、PNGはバイト列で照合します。公開用分離では、このCCXの内容に関わるソースと通知を維持しています。

## ソースを変更したとき

1. `Prepare_Photoshop_Package.cmd` を開きます。セットアップ前の作者は `uv run --no-project python tools/prepare_uxp_package.py` でも準備できます。
2. 生成された `local-build/uxp-package/PaperMath-0.8.2-.../manifest.json` をUDTへ追加します。開発用 `photoshop/uxp-panel/manifest.json` とは別です。
3. 同じ配布IDの古いフォルダーをUDTへ登録済みなら、新しいmanifestの登録へ切り替えます。
4. UDTの「…」→「Package」で、準備フォルダー外へCCXを保存します。
5. 新CCXを `plugin/PaperMath.ccx` へ置き、次の照合を行います。

```powershell
uv run --no-project python tools/prepare_uxp_package.py --check-ccx plugin/PaperMath.ccx
```

CCXをZIPの改名で作成しません。実機インストールの成功は、ソース照合とは別の確認です。照合ツールの `installation_verified: false` は、そのツールがAdobeのインストール結果を検証しないことを表します。

## 配布用ZIP

```powershell
uv run --no-project python tools/build_distribution.py
```

既定で収録済みCCXを照合して `local-build/PaperMath-Windows-preview.zip` へ同梱します。別の実CCXは `--ccx`、作者用のソースのみのZIPは `--without-ccx` で指定します。

本体、編集可能なPython/UXP/PowerShellのソース、テスト、案内、通知、固定6式のサンプル登録簿と混在入力サンプルを含めます。入力サンプルは `EXAMPLE_FILES` に列挙した6ファイルだけを収録します。制作登録簿や生成フォント・PSD・キャッシュ・導入済みPython/TeXは収録しません。`distribution-files.json` は同梱ファイルのSHA-256を保持します。

初回プレビューの公開用ファイルは、リポジトリの `release/windows-preview-1` へ保存します。案内やハッシュを公開用フォルダーへ追記した後も、確定済みの配布ZIPは再生成せず、そのバイト列を公開します。公開操作はリポジトリ直下の `PUBLISH_WINDOWS_PREVIEW.md` を参照してください。

## インストール時の代替経路

通常は `Install_Photoshop_Plugin.cmd` でCCXを開きます。CCが起動していてもUPIAのVulcanによる検出・起動が失敗し `-645` になる環境では、`Install_Photoshop_Plugin_Alternative.cmd` からCCへ直接要求します。

代替方法は、実機で成功したUPIAログ中の `--workflow=routeToPath` と `--routePath=/pmp/action/doubleClick?filePath=...` を元にしています。Adobe公開の安定APIではなく、CCの内部起動引数を使う方法です。ランチャー化後の実機確認は[チェックリスト](RELEASE_CHECKLIST.md)で管理します。

## 名前とアイコン

Paper Mathの表示名と紙面・x²のアイコンは暫定です。後から検討し直します。表示名・アイコンの変更時にはCCXを再作成しますが、配布用プラグインIDと既存フォントの内部識別は維持します。

開発パネルは `com.adobe-inline-math.local-lab` / 0.8.1、配布パネルは `com.goldkiss2010.papermath` / 0.8.2です。アイコンは原図SVGと1x/2x PNGを含みます。生成フォントの輪郭をアイコン素材に使っていません。

参照：[AdobeのPackage手順](https://developer.adobe.com/uxp/guides/how-to/distribution/package/)、[Install手順](https://developer.adobe.com/uxp/guides/how-to/distribution/install/)。
