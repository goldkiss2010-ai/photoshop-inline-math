# 初回Windowsプレビューを公開する

公開用ファイルを準備済みです。公開そのものは、この手順を実行すると行われます。名称とアイコンは暫定のままです。

## 固定した版

| 項目 | 内容 |
| --- | --- |
| タイトル | Paper Math for Photoshop 0.8.2 / Windows Preview 1 |
| タグ | `v0.8.2-preview.1` |
| タグの対象 | `release/windows-preview-1` ブランチ |
| 配布ZIPのソース | `30569e6d8381407ef678348dddbad06b8c9ab5e0` |
| 区分 | Pre-release |
| 添付するファイル | `PaperMath-Windows-preview.zip`、`SHA256SUMS.txt` |
| 本文 | [RELEASE_NOTES.md](release/windows-preview-1/RELEASE_NOTES.md) |

`main` には、この版の生成後に公開用情報を追加しています。タグは固定した `release/windows-preview-1` を対象にし、ZIPは確定済みのバイト列を使います。ビルダーを再実行するとZIPの時刻情報によりハッシュも変わるため、再生成したZIPを同じ照合値で公開しません。

## GitHubでの最後の操作

1. [リリース作成画面](https://github.com/goldkiss2010-ai/photoshop-inline-math/releases/new?tag=v0.8.2-preview.1&target=release%2Fwindows-preview-1&title=Paper%20Math%20for%20Photoshop%200.8.2%20%2F%20Windows%20Preview%201&prerelease=1)を開きます。タグ・対象ブランチ・タイトル・Pre-releaseを確認します。
2. [RELEASE_NOTES.md](release/windows-preview-1/RELEASE_NOTES.md) の本文を貼り付け、確定したZIPと [SHA256SUMS.txt](release/windows-preview-1/SHA256SUMS.txt) を添付して、Save draftで保存します。
3. 一般公開する場合は、リポジトリの[Settings](https://github.com/goldkiss2010-ai/photoshop-inline-math/settings)でvisibilityをPublicへ変更します。プレビューの準備時点ではPrivateです。
4. 下書きの添付ファイルと本文を確認し、Publish releaseを選びます。

公開後の利用者向けリンクは [Releases](https://github.com/goldkiss2010-ai/photoshop-inline-math/releases) です。Source codeの自動生成ZIPではなく、添付した `PaperMath-Windows-preview.zip` を案内します。

利用中のGitHub接続はリポジトリのソース更新に対応していますが、Release作成・ファイル添付・公開設定変更の操作は提供していません。そのため、上の最後の操作はGitHub画面から行います。

## 配布物を確認する

```powershell
Get-FileHash -Algorithm SHA256 .\PaperMath-Windows-preview.zip
```

SHA-256が [SHA256SUMS.txt](release/windows-preview-1/SHA256SUMS.txt) と一致することを確認します。配布物の情報は [release.json](release/windows-preview-1/release.json)、実機確認済み版との差分検証は [VERIFICATION.json](release/windows-preview-1/VERIFICATION.json) に記録しています。

実機確認済みの旧ZIPも保持しています。公開用ZIPでは処理・起動・プラグイン関連の79ファイルが旧ZIPと同一で、変更はパッケージ作成処理・試験・案内・混在サンプルです。公開用ZIPのWindows再インストールを実施したという記録にはしません。

GitHubの操作の参照：[リリースの管理](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository?tool=webui)、[フォームへの事前入力](https://docs.github.com/en/repositories/releasing-projects-on-github/automation-for-release-forms-with-query-parameters)、[公開設定](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)。
