[CmdletBinding()]
param([ValidateSet('Setup','Start','Check','Data','Info','Package')][string]$Action='Start')
$ErrorActionPreference='Stop'

function Get-PaperMathPaths {
    $app=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    if (!$env:LOCALAPPDATA) { throw 'Windowsのユーザー用保存先を取得できません。' }
    $runtime=Join-Path $env:LOCALAPPDATA 'PaperMath\runtime'
    $data=$app
    if (Test-Path -LiteralPath (Join-Path $app 'paper-math-distribution.json')) {
        $data=Join-Path $env:LOCALAPPDATA 'PaperMath\data'
    }
    if ($env:PAPER_MATH_DATA_DIR) {
        if (![IO.Path]::IsPathRooted($env:PAPER_MATH_DATA_DIR)) { throw 'PAPER_MATH_DATA_DIR must be absolute.' }
        $data=[IO.Path]::GetFullPath($env:PAPER_MATH_DATA_DIR)
    }
    $requirements=Join-Path $app 'requirements-runtime.txt'
    $hash=(Get-FileHash -LiteralPath $requirements -Algorithm SHA256).Hash.ToLowerInvariant()
    # Keep each dependency set independent, so a new release does not update
    # packages in an environment still used by another open version.
    $venv=Join-Path $runtime ('env-3.13.15-'+$hash.Substring(0,16))
    return @{App=$app;Data=$data;Runtime=$runtime;Requirements=$requirements;
        Hash=$hash;Venv=$venv;Python=(Join-Path $venv 'Scripts\python.exe');
        Stamp=(Join-Path $venv 'paper-math-ready.json')}
}

function Test-PaperMathListener {
    $client=New-Object Net.Sockets.TcpClient
    try {
        $pending=$client.BeginConnect('127.0.0.1',8765,$null,$null)
        if (!$pending.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($pending)
        return $true
    } catch { return $false } finally { $client.Dispose() }
}

function Test-PaperMathReady($paths) {
    if (!(Test-Path -LiteralPath $paths.Python) -or !(Test-Path -LiteralPath $paths.Stamp)) { return $false }
    try {
        $stamp=Get-Content -LiteralPath $paths.Stamp -Raw | ConvertFrom-Json
        return ($stamp.requirements_sha256 -eq $paths.Hash -and $stamp.python -eq '3.13.15')
    } catch { return $false }
}

function Get-PaperMathUv($paths) {
    $private=Join-Path $paths.Runtime 'uv\uv.exe'
    if (Test-Path -LiteralPath $private) { return $private }
    $existing=Get-Command uv -CommandType Application -ErrorAction SilentlyContinue
    if ($existing) { return $existing.Source }
    Write-Host 'ダウンロード用ツール uv を公式配布元 Astral から準備しています。'
    $env:UV_UNMANAGED_INSTALL=Join-Path $paths.Runtime 'uv'
    $env:UV_NO_MODIFY_PATH='1'
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    # Official standalone installer. Scope and shell profiles are kept local.
    $installer=(Invoke-WebRequest -UseBasicParsing -Uri 'https://astral.sh/uv/0.12.19/install.ps1').Content
    & ([ScriptBlock]::Create($installer)) | Out-Host
    if (!(Test-Path -LiteralPath $private)) { throw 'uvの準備に失敗しました。インターネット接続を確認し、セットアップを再実行してください。' }
    return $private
}

function Invoke-PaperMath($operation) {
    $paths=Get-PaperMathPaths
    if ($operation -eq 'Info') { $paths | ConvertTo-Json; return 0 }
    if ($operation -eq 'Data') {
        New-Item -ItemType Directory -Force -Path $paths.Data | Out-Null
        Invoke-Item -LiteralPath $paths.Data
        return 0
    }
    $env:PAPER_MATH_DATA_DIR=$paths.Data
    $privateUv=Join-Path $paths.Runtime 'uv'
    if (Test-Path -LiteralPath (Join-Path $privateUv 'uv.exe')) { $env:PATH=$privateUv+[IO.Path]::PathSeparator+$env:PATH }
    $env:PYTHONUTF8='1'
    $env:PYTHONIOENCODING='utf-8'
    if ($operation -eq 'Start' -and (Test-PaperMathListener)) {
        try {
            $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/health' -TimeoutSec 3
            if ($health.ok -eq $true -and $health.backend -eq 'python-latex-fonttools-v1' -and
                $health.app_root -eq $paths.App -and $health.data_root -eq $paths.Data) {
                Write-Host 'Paper Mathはすでに起動しています。Photoshopのパネルを開いてください。'
                return 0
            }
        } catch {}
        throw '別のPaper Mathまたはプログラムがポート8765を使用しています。先に起動したサーバーを終了し、起動し直してください。'
    }
    if ($operation -eq 'Package') {
        if (!(Test-PaperMathReady $paths)) { throw '先にSetup_Paper_Math.cmdで準備を完了してください。' }
        & $paths.Python (Join-Path $paths.App 'tools\prepare_uxp_package.py') | Out-Host
        if ($LASTEXITCODE -ne 0) { return $LASTEXITCODE }
        Invoke-Item -LiteralPath (Join-Path $paths.App 'local-build\uxp-package')
        Write-Host '作成されたフォルダーのmanifest.jsonをUDTへ追加し、Packageを実行してください。'
        return 0
    }
    # Prevent concurrent setup/start from modifying or preparing the same runtime.
    $mutex=New-Object Threading.Mutex($false,'Local\PaperMathLauncher8765')
    $locked=$false
    try {
        try { $locked=$mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked=$true }
        if (!$locked) { throw 'Paper Mathのセットアップまたは起動処理が開いています。そのウィンドウを確認してください。' }
        if ($operation -eq 'Setup') {
            if (Test-PaperMathListener) { throw '起動中のPaper Mathサーバーを終了してから、セットアップしてください。' }
            Write-Host 'Paper Mathを準備します。Pythonと必要なパッケージをダウンロードする場合があります。'
            Write-Host ('アプリ本体: '+$paths.App)
            Write-Host ('制作データ: '+$paths.Data)
            New-Item -ItemType Directory -Force -Path $paths.Runtime | Out-Null
            $uv=Get-PaperMathUv $paths
            $env:PATH=(Split-Path -Parent $uv)+[IO.Path]::PathSeparator+$env:PATH
            Remove-Item -LiteralPath $paths.Stamp -ErrorAction SilentlyContinue
            $env:UV_PYTHON_INSTALL_DIR=Join-Path $paths.Runtime 'python'
            $env:UV_CACHE_DIR=Join-Path $paths.Runtime 'cache'
            $env:UV_PYTHON_INSTALL_BIN='0'
            if (!(Test-Path -LiteralPath $paths.Python)) {
                & $uv --no-config venv --managed-python --python 3.13.15 $paths.Venv | Out-Host
                if ($LASTEXITCODE -ne 0) { throw 'Pythonの準備に失敗しました。接続を確認し、セットアップを再実行してください。' }
            }
            & $uv --no-config pip sync --python $paths.Python $paths.Requirements | Out-Host
            if ($LASTEXITCODE -ne 0) { throw 'パッケージの準備に失敗しました。接続を確認し、セットアップを再実行してください。' }
            # check_setup also tests TeX; missing TeX gives a targeted message,
            # and no ready marker is published until that check passes.
            & $paths.Python (Join-Path $paths.App 'tools\check_setup.py') | Out-Host
            if ($LASTEXITCODE -ne 0) {
                throw '上のFAIL項目を確認してください。TeX不足の場合はMiKTeX (https://miktex.org/download) を導入し、セットアップを再実行してください。必要なパッケージはdocs\INSTALL_WINDOWS.mdに記載しています。'
            }
            $stamp=@{python='3.13.15';requirements_sha256=$paths.Hash} | ConvertTo-Json
            $temp=$paths.Stamp+'.new'
            [IO.File]::WriteAllText($temp,$stamp,(New-Object Text.UTF8Encoding($false)))
            Move-Item -LiteralPath $temp -Destination $paths.Stamp -Force
            Write-Host '準備が完了しました。Start_Paper_Math.cmdを開き、Photoshopのパネルを使ってください。'
            return 0
        }
        if (!(Test-PaperMathReady $paths)) { throw '最初にSetup_Paper_Math.cmdをダブルクリックし、準備を完了してください。' }
        if ($operation -eq 'Check') {
            & $paths.Python (Join-Path $paths.App 'tools\check_setup.py') --render | Out-Host
            return $LASTEXITCODE
        }
        Write-Host 'Paper Mathを起動します。作業中はこのウィンドウを開いたままにしてください。'
        Write-Host ('制作データ: '+$paths.Data)
        & $paths.Python (Join-Path $paths.App 'tools\local_server.py') | Out-Host
        return $LASTEXITCODE
    } finally {
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

# Dot-sourcing exposes the functions for read-only Windows smoke tests.
if ($MyInvocation.InvocationName -ne '.') {
    try { exit (Invoke-PaperMath $Action) }
    catch { Write-Host ('ERROR: '+$_.Exception.Message) -ForegroundColor Red; exit 1 }
}
