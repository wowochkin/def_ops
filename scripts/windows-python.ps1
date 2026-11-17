# PowerShell 5.1 теряет кавычки в аргументе Python -c. Передаём код отдельным файлом.
function Invoke-PythonScript {
  param([string]$Python, [string]$Code, [string[]]$ScriptArguments = @(), [string[]]$PythonArguments = @())
  $scriptFile = Join-Path ([IO.Path]::GetTempPath()) ("defops-python-" + [guid]::NewGuid().ToString('N') + '.py')
  [IO.File]::WriteAllText($scriptFile, $Code, [Text.UTF8Encoding]::new($false))
  try {
    & $Python @PythonArguments -I -B $scriptFile @ScriptArguments
    if ($LASTEXITCODE -ne 0) { throw "Python завершился с кодом $LASTEXITCODE" }
  } finally { Remove-Item -LiteralPath $scriptFile -Force -ErrorAction SilentlyContinue }
}

# Wheel .data/data/Library/bin устанавливается рядом с Lib, а не в site-packages.
# DLL рядом с python.exe доступны загрузчику Windows без глобального PATH.
function Copy-VoiceNativeLibraries {
  param([string]$VoiceVenv, [string]$Output)
  $native = Join-Path $VoiceVenv 'Library/bin'
  foreach ($name in 'tbb12.dll','libhwloc-15.dll') {
    if (!(Test-Path -LiteralPath (Join-Path $native $name) -PathType Leaf)) {
      throw "Нет нативной библиотеки $name. В wheelhouse должны входить tbb и tcmlib."
    }
  }
  $destination = Join-Path $Output 'python'
  Get-ChildItem -LiteralPath $native -File -Filter '*.dll' | Where-Object { $_.Name -notlike '*_debug.dll' } | ForEach-Object {
    $target = Join-Path $destination $_.Name
    if (Test-Path -LiteralPath $target) {
      if ((Get-FileHash -LiteralPath $target).Hash -ne (Get-FileHash -LiteralPath $_.FullName).Hash) {
        throw "Конфликт нативных библиотек: $target"
      }
    } else { Copy-Item -LiteralPath $_.FullName -Destination $target }
  }
  $docs = Join-Path $VoiceVenv 'Library/share/doc'
  if (Test-Path -LiteralPath $docs) {
    $licenses = Join-Path $Output 'licenses/venv-native'
    New-Item -ItemType Directory -Path $licenses -Force | Out-Null
    Get-ChildItem -LiteralPath $docs | Copy-Item -Destination $licenses -Recurse -Force
  }
}

function Complete-VoiceNativeRuntime {
  param([string]$CrtDirectory, [string]$Output)
  foreach ($name in 'msvcp140.dll','msvcp140_1.dll','vcruntime140.dll','vcruntime140_1.dll') {
    if (!(Test-Path -LiteralPath (Join-Path $CrtDirectory $name))) { throw "Нет Microsoft runtime: $name" }
  }
  # Только распространяемый release CRT: System32 также содержит системные и debug DLL.
  foreach ($name in 'msvcp140.dll','msvcp140_1.dll','msvcp140_2.dll','msvcp140_atomic_wait.dll','msvcp140_codecvt_ids.dll','vcruntime140.dll','vcruntime140_1.dll','vcruntime140_threads.dll','concrt140.dll') {
    $file = Join-Path $CrtDirectory $name
    if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination (Join-Path $Output 'python') -Force }
  }
  # В комплекте FFmpeg CLI; Torchaudio читает WAV через SoundFile.
  # Эти необязательные адаптеры требуют три других версии shared FFmpeg.
  $torio = Join-Path $Output 'python/Lib/site-packages/torio/lib'
  foreach ($version in 4,5,6) {
    foreach ($name in "_torio_ffmpeg$version.pyd","libtorio_ffmpeg$version.pyd") {
      $file = Join-Path $torio $name
      if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
  }
}
