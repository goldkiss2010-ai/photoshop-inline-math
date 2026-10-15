[CmdletBinding()]
param([ValidateSet('Normal','Direct')][string]$Mode='Normal')
$ErrorActionPreference='Stop'

function Get-PaperMathCcxPath {
    $app=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $ccx=Join-Path $app 'plugin\PaperMath.ccx'
    if (!(Test-Path -LiteralPath $ccx -PathType Leaf)) {
        throw 'plugin\PaperMath.ccx がありません。配布ZIPをすべて展開してください。作者用の作成手順は docs\PACKAGE_PHOTOSHOP.md にあります。'
    }
    return $ccx
}

function Get-PaperMathCreativeCloudPath {
    $roots=@($env:ProgramW6432,$env:ProgramFiles,${env:ProgramFiles(x86)}) |
        Where-Object { $_ } | Select-Object -Unique
    foreach ($root in $roots) {
        $candidate=Join-Path $root 'Adobe\Adobe Creative Cloud\ACC\Creative Cloud.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    throw 'Creative Cloudデスクトップアプリが標準の場所に見つかりません。CCを起動できることを確認し、docs\INSTALL_WINDOWS.md を参照してください。'
}

function Get-PaperMathDirectInstallArguments([string]$ccx) {
    # Match the CC route recorded in UPIA's log. Quote the entire second argv
    # for Start-Process/Windows PowerShell 5.1, including paths with spaces.
    # Escape query delimiters without changing the confirmed ordinary path.
    if ($ccx -match '["\r\n]') { throw 'CCXのパスに使用できない文字があります。' }
    $query=$ccx.Replace('%','%25').Replace('&','%26').Replace('#','%23')
    return @('--workflow=routeToPath',('"--routePath=/pmp/action/doubleClick?filePath='+$query+'"'))
}

function Invoke-PaperMathPluginInstall([string]$operation) {
    $ccx=Get-PaperMathCcxPath
    if ($operation -eq 'Direct') {
        $cc=Get-PaperMathCreativeCloudPath
        $arguments=Get-PaperMathDirectInstallArguments $ccx
        Start-Process -FilePath $cc -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $cc) -ErrorAction Stop | Out-Null
        Write-Host 'Creative Cloudへ直接インストール画面の表示を要求しました。'
    } else {
        try { Start-Process -FilePath $ccx -ErrorAction Stop | Out-Null }
        catch { throw 'CCXを開けませんでした。Install_Photoshop_Plugin_Alternative.cmd を試してください。' }
        Write-Host 'Creative Cloudでインストール画面を開きます。'
        Write-Host '画面が表示されない場合は Install_Photoshop_Plugin_Alternative.cmd を開いてください。'
    }
    Write-Host 'CCの確認画面でインストールし、プラグイン管理の一覧を確認してください。'
    Write-Host 'このウィンドウの正常終了は、インストール完了を判定するものではありません。'
    return 0
}

# Dot-source only for Windows tests; no process is started at import time.
if ($MyInvocation.InvocationName -ne '.') {
    try { exit (Invoke-PaperMathPluginInstall $Mode) }
    catch { Write-Host ('ERROR: '+$_.Exception.Message) -ForegroundColor Red; exit 1 }
}
