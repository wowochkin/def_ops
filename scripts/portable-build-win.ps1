# Сборочный компьютер Windows x64; полный комплект папкой, без ограничения размера NSIS.
# Контракт и подготовка входов: docs/expo-portable-windows-build.md. На Windows ещё не проверен.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$DataDirectory,
  [Parameter(Mandatory=$true)][string]$LibraryArchive,
  [Parameter(Mandatory=$true)][string]$PythonRoot,
  [Parameter(Mandatory=$true)][string]$Wheelhouse,
  [Parameter(Mandatory=$true)][string]$ModelsDirectory,
  [Parameter(Mandatory=$true)][string]$FFmpegDirectory,
  [Parameter(Mandatory=$true)][string]$WebViewInstaller,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$WebViewSha256,
  [Parameter(Mandatory=$true)][string]$ReferenceAudio,
  [Parameter(Mandatory=$true)][string]$ReferenceText,
  [string]$RuntimeSourceLock,
  [switch]$DiagnosticCandidate,
  [switch]$ResumeAfterPreparation,
  [string]$Output = (Join-Path $PSScriptRoot '..\release\windows-x64'),
  [ValidateRange(16,1024)][int]$MemoryWarningGB = 32
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess) { throw 'Запустите 64-разрядный PowerShell на Windows x64.' }
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$hostExe = (Get-Process -Id $PID).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$rustc = (Get-Command rustc.exe -ErrorAction Stop).Source
$null = Get-Command cargo.exe -ErrorAction Stop
$null = Get-Command dumpbin.exe -ErrorAction Stop
$ramGB = $null
try { $ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1); Write-Host "Оперативная память: $ramGB ГБ" }
catch { Write-Warning 'Не удалось определить RAM. Проверьте память выбранных моделей на целевом ПК; сборка продолжается.' }
if ($null -ne $ramGB -and $ramGB -lt ($MemoryWarningGB - 1)) { Write-Warning "Обнаружено $ramGB ГБ RAM. При объёме меньше $MemoryWarningGB ГБ особенно важна проверка совместной памяти LLM и голоса. Это справочный ориентир, не проверенный минимум; сборка продолжается." }
foreach ($name in 'DataDirectory','LibraryArchive','PythonRoot','Wheelhouse','ModelsDirectory','FFmpegDirectory','WebViewInstaller','ReferenceAudio') {
  Set-Variable -Name $name -Value (Resolve-Path -LiteralPath (Get-Variable -Name $name -ValueOnly)).Path
}
if ($RuntimeSourceLock) { $RuntimeSourceLock = (Resolve-Path -LiteralPath $RuntimeSourceLock).Path }
$Output = [IO.Path]::GetFullPath($Output).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
foreach ($source in @($DataDirectory,$PythonRoot,$Wheelhouse,$ModelsDirectory,$FFmpegDirectory,(Join-Path $repo 'apps\desktop'),(Join-Path $repo 'apps\editor\dist'),(Join-Path $repo 'packages\sim\data'))) {
  $prefix = [IO.Path]::GetFullPath($source).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (($Output + [IO.Path]::DirectorySeparatorChar).StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw "Выходная папка не может находиться внутри исходного ресурса: $source" }
}
$stage = Join-Path $repo 'release\windows-build'
$runtime = Join-Path $repo 'apps\desktop\portable\runtime'
$library = Join-Path $repo 'apps\desktop\portable\library'
$mustBeNew = if ($ResumeAfterPreparation) { @($Output) } else { @($Output,$stage,$runtime,$library) }
foreach ($path in $mustBeNew) { if (Test-Path -LiteralPath $path) { throw "Папка уже существует: $path. Сохраните прежнюю сборку и используйте чистую рабочую копию; скрипт не удаляет данные." } }
$hash = (Get-FileHash -LiteralPath $WebViewInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $WebViewSha256.ToLowerInvariant()) { throw 'SHA256 автономного установщика WebView2 не совпадает.' }
$signature = Get-AuthenticodeSignature -LiteralPath $WebViewInstaller
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Нужен установщик WebView2 с действительной подписью Microsoft.' }
$hostTriple = (& $rustc -vV | Select-String '^host: ').ToString().Substring(6).Trim()
if ($LASTEXITCODE -ne 0 -or $hostTriple -ne 'x86_64-pc-windows-msvc') { throw 'Нужен Rust x86_64-pc-windows-msvc, не GNU/ARM64.' }
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Команда завершилась с кодом ${LASTEXITCODE}: $Program" }
}
# Windows PowerShell 5.1 превращает stderr нативных программ в ErrorRecord.
# Предупреждение в stderr не заменяет код завершения команды.
function Invoke-NativeLogged([string]$Program, [string[]]$Arguments, [string]$Log) {
  $ErrorActionPreference = 'Continue'
  $global:LASTEXITCODE = $null
  & $Program @Arguments *> $Log
  if ($null -eq $global:LASTEXITCODE) { throw "Не удалось запустить $Program; журнал $Log" }
  return $global:LASTEXITCODE
}
function Write-Utf8([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, ([Text.UTF8Encoding]::new($Path.EndsWith('.ps1')))) }
$oldPortable = $env:DEFOPS_PORTABLE_BUILD
$oldLicense = $env:DEFOPS_NODE_LICENSE
$oldTarget = $env:CARGO_TARGET_DIR
$oldRequiredCore = $env:DEFOPS_REQUIRE_GAME_TESTS
Push-Location $repo
try {
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  if ($ResumeAfterPreparation) {
    Write-Host 'Проверяю сохранённый runtime и библиотеку; это чтение файлов без повторной установки.'
    Invoke-Checked (Join-Path $PythonRoot 'python.exe') @('-I','-B',(Join-Path $PSScriptRoot 'portable-resume-check.py'),$repo)
  } else {
  # Загрузка выполняется на сборочной машине с сетью, до передачи готового комплекта.
  Invoke-Checked $npm @('ci')
  Invoke-Checked $node @('--input-type=module','-e',"import { prepareNode } from './scripts/portable-node.mjs'; await prepareNode('release/downloads/node-runtime');")
  $venv = Join-Path $stage 'voice-venv'
  Invoke-Checked $hostExe @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $repo 'services\voice\setup.ps1'),'-Python',(Join-Path $PythonRoot 'python.exe'),'-VenvPath',$venv,'-Wheelhouse',$Wheelhouse)
  $voiceArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'portable-voice-win.ps1'),'-PythonRoot',$PythonRoot,'-VoiceVenv',$venv,'-ModelsDirectory',$ModelsDirectory,'-FFmpegDirectory',$FFmpegDirectory,'-Output',$runtime)
  if ($RuntimeSourceLock) { $voiceArgs += @('-SourceLock',$RuntimeSourceLock) }
  Invoke-Checked $hostExe $voiceArgs
  Invoke-Checked $node @('scripts/portable-release.mjs','--data',$DataDirectory,'--archive',$LibraryArchive,'--out',$library)
  }
  Invoke-Checked $node @('--import','tsx','scripts/portable-lexicon.ts')
  $env:DEFOPS_NODE_LICENSE = Join-Path $repo 'release\downloads\node-runtime\LICENSE'
  # На новом ПК cargo cache пуст; сборщик лицензий намеренно работает с --offline.
  Invoke-Checked 'cargo.exe' @('fetch','--locked','--target','x86_64-pc-windows-msvc')
  Invoke-Checked $node @('scripts/portable-licenses.mjs')
  # Проверки проекта перед сборкой; журналы сохраняются, в консоли только итог.
  Invoke-Checked 'cargo.exe' @('build','--release','--locked','--bin','agents-game','--target-dir',(Join-Path $repo 'target'))
  $env:DEFOPS_REQUIRE_GAME_TESTS = '1'
  $typeLog = Join-Path $stage 'typecheck.log'
  $typeExit = Invoke-NativeLogged $npm @('run','typecheck') $typeLog
  if ($typeExit -ne 0) { Get-Content -LiteralPath $typeLog -Tail 25; throw 'Не прошла проверка TypeScript.' }
  $env:THEATRE_PYTHON = Join-Path $PythonRoot 'python.exe'
  $testLog = Join-Path $stage 'tests.log'
  $testJson = Join-Path $stage 'tests.json'
  $testExit = Invoke-NativeLogged $npm @('test','--','--maxWorkers=1','--reporter=default','--reporter=json',"--outputFile.json=$testJson") $testLog
  Get-Content -LiteralPath $testLog | Select-String 'Test Files|Tests |FAIL'
  $testAssessment = Join-Path $stage 'test-assessment.json'
  $assessmentArgs = @('scripts/portable-test-report.mjs',$testJson,$testAssessment,'--log',$testLog)
  if ($DiagnosticCandidate) { $assessmentArgs += '--allow-known-core-failures' }
  Invoke-Checked $node $assessmentArgs
  $assessment = Get-Content -LiteralPath $testAssessment -Raw | ConvertFrom-Json
  if ($testExit -ne 0 -and $assessment.status -ne 'diagnostic-candidate') { throw "Не прошли тесты; журнал $testLog" }
  $env:DEFOPS_PORTABLE_BUILD = '1'
  $env:CARGO_TARGET_DIR = if ($env:DEFOPS_BUILD_TARGET_DIR) { [IO.Path]::GetFullPath($env:DEFOPS_BUILD_TARGET_DIR) } else { Join-Path $stage 'target' }
  Invoke-Checked $npm @('run','tauri','-w','@def-ops/desktop','--','build','--target','x86_64-pc-windows-msvc','--no-bundle','--','--locked')
  # Windows resource_dir — рядом с исполняемым файлом; соответствие tauri.conf.json и main.rs.
  New-Item -ItemType Directory -Path $Output -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $env:CARGO_TARGET_DIR 'x86_64-pc-windows-msvc\release\defops-desktop.exe') -Destination (Join-Path $Output 'defops-desktop.exe')
  Copy-Item -LiteralPath (Join-Path $repo 'apps\desktop\src-tauri\binaries\node-x86_64-pc-windows-msvc.exe') -Destination (Join-Path $Output 'node.exe')
  foreach ($pair in @(@('apps\desktop\server','server'),@('apps\editor\dist','editor'),@('apps\desktop\portable','portable'))) {
    Copy-Item -LiteralPath (Join-Path $repo $pair[0]) -Destination (Join-Path $Output $pair[1]) -Recurse
  }
  New-Item -ItemType Directory -Path (Join-Path $Output 'data\packages\sim') -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $repo 'packages\sim\data') -Destination (Join-Path $Output 'data\packages\sim\data') -Recurse
  New-Item -ItemType Directory -Path (Join-Path $Output 'prerequisites') -Force | Out-Null
  Copy-Item -LiteralPath $WebViewInstaller -Destination (Join-Path $Output 'prerequisites\MicrosoftEdgeWebView2RuntimeInstallerX64.exe')
  # Реальный голос проверяется уже в конечной папке, после переноса runtime; исходящие сокеты запрещены.
  $smokeEnvironment = @{}
  foreach ($key in 'PATH','PYTHONHOME','PYTHONPATH','VIRTUAL_ENV','PYTHONNOUSERSITE','HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE','DEFOPS_VOICE_OFFLINE') { $smokeEnvironment[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
  try {
    $env:PATH = (Join-Path $Output 'portable\runtime\bin') + ';' + $env:SystemRoot + '\System32;' + $env:SystemRoot
    $env:PYTHONHOME = $null; $env:PYTHONPATH = $null; $env:VIRTUAL_ENV = $null
    $env:PYTHONNOUSERSITE = '1'; $env:HF_HUB_OFFLINE = '1'; $env:TRANSFORMERS_OFFLINE = '1'; $env:DEFOPS_VOICE_OFFLINE = '1'
  Invoke-Checked (Join-Path $Output 'portable\runtime\python\python.exe') @('-I','-B',(Join-Path $PSScriptRoot 'portable-voice-smoke.py'),'--runtime',(Join-Path $Output 'portable\runtime'),'--service',(Join-Path $Output 'server\voice-service'),'--reference',$ReferenceAudio,'--reference-text',$ReferenceText,'--output',(Join-Path $stage 'voice-smoke'))
  } finally { foreach ($key in $smokeEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key,$smokeEnvironment[$key],'Process') } }
  $launcher = @'
$ErrorActionPreference = 'Stop'
try {
  $ram = $null
  try { $ram = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1); Write-Host "Оперативная память: $ram ГБ" }
  catch { Write-Warning 'Не удалось определить RAM. Проверьте совместную память моделей; запуск продолжается.' }
  if ($null -ne $ram -and $ram -lt (__RAM__ - 1)) { Write-Warning "Обнаружено $ram ГБ RAM. Совместную память выбранных моделей нужно измерить; __RAM__ ГБ — справочный ориентир, не проверенный минимум. Запуск продолжается." }
  function Has-WebView2 {
    foreach ($hive in [Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine) {
      foreach ($view in [Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64) {
        $base = $null; $key = $null
        try {
          $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
          $key = $base.OpenSubKey('SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')
          if ($key) { $version = [version]([string]$key.GetValue('pv','0.0.0.0')); if ($version -gt [version]'0.0.0.0') { return $true } }
        } catch { } finally { if ($key) { $key.Dispose() }; if ($base) { $base.Dispose() } }
      }
    }
    return $false
  }
  if (-not (Has-WebView2)) {
    $installer = Join-Path $PSScriptRoot 'prerequisites\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
    if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne '__WEBVIEW_SHA__') { throw 'Повреждён автономный установщик WebView2.' }
    $process = Start-Process -FilePath $installer -ArgumentList '/silent','/install' -Wait -PassThru
    if ($process.ExitCode -notin @(0,3010) -or -not (Has-WebView2)) { throw "WebView2 не установлен (код $($process.ExitCode)). Проверьте ограничения учётной записи; интернет для комплектного установщика не нужен." }
  }
  Add-Type -AssemblyName System.Windows.Forms
  $screens = [System.Windows.Forms.Screen]::AllScreens.Count
  if ($screens -lt 3) { Write-Host "Экранов: $screens. Для стенда из трёх экранов выберите в Windows режим расширения рабочего стола и подключите все дисплеи." }
  Start-Process -FilePath (Join-Path $PSScriptRoot 'defops-desktop.exe') -WorkingDirectory $PSScriptRoot
} catch { Write-Host $_ -ForegroundColor Red; Read-Host 'Нажмите Enter'; exit 1 }
'@
  Write-Utf8 (Join-Path $Output 'launch.ps1') $launcher.Replace('__RAM__',[string]$MemoryWarningGB).Replace('__WEBVIEW_SHA__',$hash)
  [IO.File]::WriteAllText((Join-Path $Output 'launch.cmd'), "@echo off`r`ncd /d `"%~dp0`"`r`n`"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`" -NoProfile -ExecutionPolicy Bypass -File `"%~dp0launch.ps1`"`r`n", [Text.Encoding]::ASCII)
  Copy-Item -LiteralPath (Join-Path $repo 'docs\expo-portable-windows-build.md') -Destination (Join-Path $Output 'WINDOWS-BUILD.md')
  Copy-Item -LiteralPath $testAssessment -Destination (Join-Path $Output 'test-assessment.json')
  $inputs = [ordered]@{}
  foreach ($file in @('package-lock.json','Cargo.lock','services\voice\requirements-win.txt')) { $inputs[$file] = (Get-FileHash -LiteralPath (Join-Path $repo $file) -Algorithm SHA256).Hash.ToLowerInvariant() }
  $report = [ordered]@{ schema=1; platform='win32-x64'; format='portable-directory'; test_status=$assessment.status; clean_machine_test='required'; ram_gb=$ramGB; memory_warning_gb=$MemoryWarningGB; rustc=(& $rustc --version); node=(& $node --version); input_sha256=$inputs; webview_sha256=$hash }
  Write-Utf8 (Join-Path $Output 'build-report.json') ($report | ConvertTo-Json -Depth 5)
  $files = [ordered]@{}
  Get-ChildItem -LiteralPath $Output -File -Recurse | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($Output.Length + 1).Replace('\','/')
    $files[$relative] = [ordered]@{ size=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
  Write-Utf8 (Join-Path $Output 'manifest.json') ([ordered]@{ schema=1; platform='win32-x64'; files=$files } | ConvertTo-Json -Depth 6)
  Write-Host "Собрана папка: $Output. Реальный голос на сборочной машине проверен; приёмка Windows 10 / RTX 4060 Ti / три экрана на чистом профиле ещё требуется."
} finally {
  $env:DEFOPS_PORTABLE_BUILD = $oldPortable
  $env:DEFOPS_NODE_LICENSE = $oldLicense
  $env:CARGO_TARGET_DIR = $oldTarget
  $env:DEFOPS_REQUIRE_GAME_TESTS = $oldRequiredCore
  Pop-Location
}
