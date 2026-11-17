# Старт сборки из переносимого комплекта. Совместим с Windows PowerShell 5.1.
[CmdletBinding()]
param([string]$KitRoot = 'D:\k')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$KitRoot = (Resolve-Path -LiteralPath $KitRoot).Path
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitProcess) { throw 'Нужна Windows x64 и 64-разрядный PowerShell.' }
$attempt = Get-Date -Format 'yyyyMMdd-HHmmss'
$logs = Join-Path $KitRoot 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
Start-Transcript -LiteralPath (Join-Path $logs ("build-$attempt.log")) | Out-Null
try {
  Write-Host 'Продолжение сохранённой сборки без повторной подготовки голоса.'
  $saved = Get-ChildItem -LiteralPath (Join-Path $KitRoot 'work') -Directory | Sort-Object Name -Descending | Where-Object {
    (Test-Path (Join-Path $_.FullName 'source/apps/desktop/portable/runtime/manifest.json')) -and
    (Test-Path (Join-Path $_.FullName 'source/apps/desktop/portable/library/manifest.json'))
  } | Select-Object -First 1
  if (!$saved) { throw 'Нет попытки с завершёнными runtime и библиотекой' }
  $source = Join-Path $saved.FullName 'source'
  Write-Host "Продолжаю попытку: $($saved.Name)"
  $payload = Join-Path $PSScriptRoot 'payload'
  $patch = Get-Content -LiteralPath (Join-Path $payload 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($entry in $patch) {
    if ($entry.path -match '(^/|\\|:|(^|/)\.\.(/|$))') { throw 'Неверный путь патча' }
    if ((Get-FileHash -LiteralPath (Join-Path $payload $entry.path)).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Повреждён пакет продолжения' }
  }
  foreach ($entry in $patch) {
    $target = Join-Path $source $entry.path
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    if ((Test-Path $target) -and !(Test-Path "$target.before-resume")) { Copy-Item -LiteralPath $target -Destination "$target.before-resume" }
    Copy-Item -LiteralPath (Join-Path $payload $entry.path) -Destination $target -Force
  }
  function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Ошибка $LASTEXITCODE при запуске $Program" }
  }
  function Microsoft-Installer([string]$Path) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw "Не подтверждена подпись Microsoft: $Path" }
  }
  $installers = Join-Path $KitRoot 'tools\installers'
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  $vs = ''
  if (Test-Path -LiteralPath $vswhere) { $vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath }
  if (-not $vs) {
    $installer = Join-Path $installers 'vs_buildtools.exe'
    Microsoft-Installer $installer
    Write-Host 'Устанавливаю Microsoft C++ Build Tools. Windows запросит права администратора.'
    $process = Start-Process -FilePath $installer -Verb RunAs -ArgumentList '--passive','--wait','--norestart','--add','Microsoft.VisualStudio.Workload.VCTools','--includeRecommended' -Wait -PassThru
    if ($process.ExitCode -eq 3010) { throw 'Для завершения установки нужна перезагрузка Windows. После неё снова откройте BUILD-WINDOWS.cmd.' }
    if ($process.ExitCode -ne 0) { throw "Microsoft Build Tools: код $($process.ExitCode)" }
    $vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  }
  if (-not $vs) { throw 'Не найдены установленные Microsoft C++ Build Tools.' }
  # Официальная оболочка VS добавляет cl/link/dumpbin и Windows SDK только в текущий процесс.
  Import-Module (Join-Path $vs 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll')
  Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
  $nodeDir = Join-Path $KitRoot 'tools\node'
  $cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE '.cargo' }
  $env:PATH = $nodeDir + ';' + (Join-Path $cargoHome 'bin') + ';' + $env:PATH
  $rustup = Join-Path $cargoHome 'bin\rustup.exe'
  if (-not (Test-Path -LiteralPath $rustup)) {
    Invoke-Checked (Join-Path $installers 'rustup-init.exe') @('-y','--profile','minimal','--default-toolchain','none','--no-modify-path')
  }
  # Закреплена версия, на которой проверена исходная сборка. Не меняем глобальную default-toolchain.
  $env:RUSTUP_TOOLCHAIN = '1.99.0-x86_64-pc-windows-msvc'
  Invoke-Checked $rustup @('toolchain','install',$env:RUSTUP_TOOLCHAIN,'--profile','minimal')
  $env:DEFOPS_BUILD_TARGET_DIR = Join-Path $KitRoot 'target-desktop'
  $kitInputs = Join-Path $KitRoot 'inputs'
  $reference = Join-Path $kitInputs 'library\files\voice\voices\chief-15s'
  $refText = (Get-Content -LiteralPath (Join-Path $reference 'ref.json') -Raw -Encoding UTF8 | ConvertFrom-Json).text
  $webview = Join-Path $installers 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
  Microsoft-Installer $webview
  $output = Join-Path $KitRoot ("output\DefOps-Windows-$attempt")
  $options = @{
    DataDirectory=(Join-Path $kitInputs 'library\files'); LibraryArchive=(Join-Path $kitInputs 'user-library.json');
    PythonRoot=(Join-Path $kitInputs 'python\python'); Wheelhouse=(Join-Path $kitInputs 'wheels');
    ModelsDirectory=(Join-Path $kitInputs 'models'); FFmpegDirectory=(Join-Path $kitInputs 'ffmpeg\distribution');
    WebViewInstaller=$webview; WebViewSha256=(Get-FileHash -LiteralPath $webview -Algorithm SHA256).Hash.ToLowerInvariant();
    ReferenceAudio=(Join-Path $reference 'ref.wav'); ReferenceText=$refText; Output=$output; DiagnosticCandidate=$true; ResumeAfterPreparation=$true
  }
  & (Join-Path $source 'scripts\portable-build-win.ps1') @options
  Write-Host "Сборка завершена. Откройте $output\launch.cmd" -ForegroundColor Green
  Write-Host 'Для другого компьютера переносите всю эту папку output. LM Studio и LLM/embeddings устанавливаются отдельно.'
  Write-Host 'Это приёмочная версия: проверьте звук, оба фронта, автономность и три дисплея до выставки.'
  [IO.File]::WriteAllText((Join-Path $KitRoot 'LAST-BUILD.txt'), $output, [Text.UTF8Encoding]::new($true))
} catch {
  Write-Host $_ -ForegroundColor Red
  Write-Host "Сборка не завершена. Журнал: $logs. Повторите RESUME-BUILD.cmd после исправления причины; подготовка голоса сохранена."
  exit 1
} finally { Stop-Transcript | Out-Null }
