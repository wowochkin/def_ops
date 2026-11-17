# Старт сборки из переносимого комплекта. Совместим с Windows PowerShell 5.1.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$KitRoot)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$KitRoot = (Resolve-Path -LiteralPath $KitRoot).Path
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitProcess) { throw 'Нужна Windows x64 и 64-разрядный PowerShell.' }
$attempt = Get-Date -Format 'yyyyMMdd-HHmmss'
$logs = Join-Path $KitRoot 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
Start-Transcript -LiteralPath (Join-Path $logs ("build-$attempt.log")) | Out-Null
try {
  Write-Host 'Подготовка приёмочной Windows-сборки. На этом этапе нужен интернет.'
  Write-Host 'Проверяю контрольные суммы комплекта — это может занять несколько минут.'
  $manifest = Get-Content -LiteralPath (Join-Path $KitRoot 'kit-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($entry in $manifest.files) {
    if ($entry.path -match '(^/|\\|:|(^|/)\.\.(/|$))') { throw 'Неверный путь в манифесте комплекта' }
    $file = Join-Path $KitRoot $entry.path
    if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -ne $entry.size -or
      (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "Повреждён файл: $($entry.path). Перенесите архив заново." }
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
  $work = Join-Path $KitRoot ("work\$attempt")
  New-Item -ItemType Directory -Path $work | Out-Null
  Copy-Item -LiteralPath (Join-Path $KitRoot 'source') -Destination (Join-Path $work 'source') -Recurse
  $source = Join-Path $work 'source'
  $cache = Join-Path $source 'release\downloads'
  New-Item -ItemType Directory -Path $cache -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $KitRoot 'tools\node-v22.23.4-win-x64.zip') -Destination $cache
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
    ReferenceAudio=(Join-Path $reference 'ref.wav'); ReferenceText=$refText; Output=$output; DiagnosticCandidate=$true
  }
  & (Join-Path $source 'scripts\portable-build-win.ps1') @options
  Write-Host "Сборка завершена. Откройте $output\launch.cmd" -ForegroundColor Green
  Write-Host 'Для другого компьютера переносите всю эту папку output. LM Studio и LLM/embeddings устанавливаются отдельно.'
  Write-Host 'Это приёмочная версия: проверьте звук, оба фронта, автономность и три дисплея до выставки.'
  [IO.File]::WriteAllText((Join-Path $KitRoot 'LAST-BUILD.txt'), $output, [Text.UTF8Encoding]::new($true))
} catch {
  Write-Host $_ -ForegroundColor Red
  Write-Host "Сборка не завершена. Журнал: $logs. Повторный запуск создаст отдельную попытку и сохранит прежние файлы."
  exit 1
} finally { Stop-Transcript | Out-Null }
