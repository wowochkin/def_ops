# Запускается PowerShell на любой ОС; настоящие DLL проверяет Windows-сборка.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-python.ps1')
$root = Join-Path ([IO.Path]::GetTempPath()) ('defops-native-test-' + [guid]::NewGuid().ToString('N'))
try {
  $venv = Join-Path $root 'venv'
  $runtime = Join-Path $root 'runtime'
  $bin = Join-Path $venv 'Library/bin'
  New-Item -ItemType Directory -Path $bin,(Join-Path $runtime 'python'),(Join-Path $venv 'Library/share/doc/tbb') -Force | Out-Null
  foreach ($name in 'tbb12.dll','libhwloc-15.dll','tcm.dll','tcm_debug.dll') {
    Set-Content -LiteralPath (Join-Path $bin $name) -Value $name
  }
  Set-Content -LiteralPath (Join-Path $venv 'Library/share/doc/tbb/license.txt') -Value 'license'
  Copy-VoiceNativeLibraries -VoiceVenv $venv -Output $runtime
  $crt = Join-Path $root 'CRT'
  New-Item -ItemType Directory -Path $crt -Force | Out-Null
  foreach ($name in 'msvcp140.dll','msvcp140_1.dll','vcruntime140.dll','vcruntime140_1.dll') { Set-Content (Join-Path $crt $name) $name }
  Set-Content (Join-Path $crt 'kernel32.dll') 'system dll must not be copied'
  Set-Content (Join-Path $crt 'msvcp140d.dll') 'debug must not be copied'
  $torio = Join-Path $runtime 'python/Lib/site-packages/torio/lib'
  New-Item -ItemType Directory -Path $torio -Force | Out-Null
  foreach ($name in '_torio_ffmpeg4.pyd','libtorio_ffmpeg6.pyd','keep.pyd') { Set-Content (Join-Path $torio $name) $name }
  Complete-VoiceNativeRuntime -CrtDirectory $crt -Output $runtime
  if ((Test-Path (Join-Path $runtime 'python/kernel32.dll')) -or (Test-Path (Join-Path $runtime 'python/msvcp140d.dll'))) { throw 'Скопирована системная или debug DLL' }
  if (!(Test-Path (Join-Path $runtime 'python/msvcp140_1.dll'))) { throw 'Потерян Microsoft runtime' }
  if (Test-Path (Join-Path $torio 'libtorio_ffmpeg6.pyd')) { throw 'Остался несовместимый FFmpeg backend' }
  if (!(Test-Path (Join-Path $torio 'keep.pyd'))) { throw 'Удалён посторонний модуль' }
  foreach ($name in 'tbb12.dll','libhwloc-15.dll','tcm.dll') {
    if ((Get-FileHash (Join-Path $bin $name)).Hash -ne (Get-FileHash (Join-Path $runtime "python/$name")).Hash) { throw "Не перенесена DLL: $name" }
  }
  if (Test-Path (Join-Path $runtime 'python/tcm_debug.dll')) { throw 'Включён отладочный runtime Microsoft' }
  if (!(Test-Path (Join-Path $runtime 'licenses/venv-native/tbb/license.txt'))) { throw 'Потеряна лицензия' }
  Copy-VoiceNativeLibraries -VoiceVenv $venv -Output $runtime
  Set-Content -LiteralPath (Join-Path $runtime 'python/tbb12.dll') -Value 'different'
  $rejected = $false
  try { Copy-VoiceNativeLibraries -VoiceVenv $venv -Output $runtime } catch { $rejected = $true }
  if (!$rejected) { throw 'Не отклонён конфликт DLL' }
  Remove-Item -LiteralPath (Join-Path $bin 'tbb12.dll')
  $rejected = $false
  try { Copy-VoiceNativeLibraries -VoiceVenv $venv -Output $runtime } catch { $rejected = $true }
  if (!$rejected) { throw 'Не отклонена отсутствующая TBB' }
  Write-Host 'OK: DLL, лицензии, повторный вызов, конфликты и обязательная TBB'
} finally { Remove-Item -LiteralPath $root -Recurse -Force }
