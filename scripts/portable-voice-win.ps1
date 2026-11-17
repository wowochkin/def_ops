# Сборочный компьютер: Windows x64, подготовленные venv/wheels и веса из services/voice/setup.ps1.
# PythonRoot — полная автономная CPython 3.12 x64 (python-build-standalone), НЕ venv.
# FFmpegDirectory — распакованная автономная сборка с ffmpeg.exe и всеми её DLL/лицензиями.
# Пример: .\scripts\portable-voice-win.ps1 -PythonRoot C:\build\python -VoiceVenv C:\build\voice-venv `
#   -ModelsDirectory C:\build\voice-models -FFmpegDirectory C:\build\ffmpeg -Output D:\stage\runtime
# Требуются dumpbin из Visual Studio Build Tools и NVIDIA GPU для проверки CUDA.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$PythonRoot,
  [Parameter(Mandatory=$true)][string]$VoiceVenv,
  [Parameter(Mandatory=$true)][string]$ModelsDirectory,
  [Parameter(Mandatory=$true)][string]$FFmpegDirectory,
  [Parameter(Mandatory=$true)][string]$Output,
  [string]$SourceLock
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-python.ps1')
if ($env:OS -ne 'Windows_NT' -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') { throw 'Нужна Windows x64' }
if (Test-Path -LiteralPath $Output) { throw 'Выходной каталог уже существует; выберите новый' }
$dumpbin = (Get-Command dumpbin.exe -ErrorAction SilentlyContinue).Source
if (-not $dumpbin) { throw 'Нужен dumpbin из Visual Studio Build Tools для проверки DLL' }
$PythonRoot = (Resolve-Path -LiteralPath $PythonRoot).Path
$VoiceVenv = (Resolve-Path -LiteralPath $VoiceVenv).Path
$ModelsDirectory = (Resolve-Path -LiteralPath $ModelsDirectory).Path
$FFmpegDirectory = (Resolve-Path -LiteralPath $FFmpegDirectory).Path
$sourcePython = Join-Path $PythonRoot 'python.exe'
if (Test-Path -LiteralPath (Join-Path $PythonRoot 'pyvenv.cfg')) { throw 'PythonRoot должен быть полной автономной CPython, не venv' }
Invoke-PythonScript -Python $sourcePython -Code 'import sys,struct; assert sys.version_info[:2]==(3,12) and struct.calcsize("P")==8'
if ($LASTEXITCODE -ne 0) { throw 'Нужна полная Python 3.12 x64' }
$ffmpeg = Get-ChildItem -LiteralPath $FFmpegDirectory -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
if (-not $ffmpeg) { throw 'Нет ffmpeg.exe' }
New-Item -ItemType Directory -Path $Output -Force | Out-Null
$Output = (Resolve-Path -LiteralPath $Output).Path
Copy-Item -LiteralPath $PythonRoot -Destination (Join-Path $Output 'python') -Recurse
$site = Join-Path $Output 'python\Lib\site-packages'
if (Test-Path -LiteralPath $site) { Remove-Item -LiteralPath $site -Recurse -Force }
Copy-Item -LiteralPath (Join-Path $VoiceVenv 'Lib\site-packages') -Destination $site -Recurse
Copy-Item -LiteralPath $FFmpegDirectory -Destination (Join-Path $Output 'ffmpeg-distribution') -Recurse
New-Item -ItemType Directory -Path (Join-Path $Output 'bin'),(Join-Path $Output 'models'),(Join-Path $Output 'licenses') -Force | Out-Null
Get-ChildItem -LiteralPath $ffmpeg.Directory.FullName -File | Copy-Item -Destination (Join-Path $Output 'bin')
Copy-VoiceNativeLibraries -VoiceVenv $VoiceVenv -Output $Output
$redist = $env:VCToolsRedistDir
if (-not $redist) { throw 'Нет VCToolsRedistDir. Запустите сборку из среды Visual Studio x64.' }
$crt = Get-ChildItem -LiteralPath (Join-Path $redist 'x64') -Directory -Filter 'Microsoft.VC*.CRT' | Sort-Object Name -Descending | Select-Object -First 1
if (-not $crt) { throw 'Не найден распространяемый Microsoft C++ runtime x64' }
# На машине может быть старый Build Tools и более новый установленный redist.
$crtDirectory = @($crt.FullName,(Join-Path $env:SystemRoot 'System32')) | Where-Object {
  $dir = $_
  @('msvcp140.dll','msvcp140_1.dll','vcruntime140.dll','vcruntime140_1.dll' | Where-Object { !(Test-Path -LiteralPath (Join-Path $dir $_)) }).Count -eq 0
} | Sort-Object { $v = (Get-Item -LiteralPath (Join-Path $_ 'msvcp140.dll')).VersionInfo; [version]("{0}.{1}.{2}.{3}" -f $v.FileMajorPart,$v.FileMinorPart,$v.FileBuildPart,$v.FilePrivatePart) } -Descending | Select-Object -First 1
if (!$crtDirectory) { throw 'Не найден полный Microsoft C++ runtime' }
$crtVersion = (Get-Item -LiteralPath (Join-Path $crtDirectory 'msvcp140.dll')).VersionInfo
if ([version]("{0}.{1}" -f $crtVersion.FileMajorPart,$crtVersion.FileMinorPart) -lt [version]'14.40') { throw 'Для ONNX Runtime нужен Microsoft C++ runtime 14.40 или новее' }
Write-Host "Microsoft runtime: $crtDirectory / $($crtVersion.FileVersion)"
Complete-VoiceNativeRuntime -CrtDirectory $crtDirectory -Output $Output
Copy-Item -LiteralPath $ModelsDirectory -Destination (Join-Path $Output 'models\voice') -Recurse
Get-ChildItem -LiteralPath $Output -Directory -Recurse -Filter '__pycache__' | Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath (Join-Path $Output 'models') -Directory -Recurse -Force -Filter '.cache' | Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $Output -File -Recurse -Filter '*.pyc' | Remove-Item -Force
# Ни установленный Python, ни Homebrew/пользовательский кэш в проверке не участвуют.
$env:PYTHONHOME = $null; $env:PYTHONPATH = $null; $env:VIRTUAL_ENV = $null
$env:PYTHONDONTWRITEBYTECODE = '1'; $env:PYTHONNOUSERSITE = '1'
$env:HF_HUB_OFFLINE = '1'; $env:TRANSFORMERS_OFFLINE = '1'; $env:DEFOPS_VOICE_OFFLINE = '1'
$env:PATH = (Join-Path $Output 'bin') + ';' + $env:SystemRoot + '\System32;' + $env:SystemRoot
$runtimePython = Join-Path $Output 'python\python.exe'
Invoke-PythonScript -Python $runtimePython -Code 'import ctypes,pathlib,sys; tbb=ctypes.CDLL(str(pathlib.Path(sys.executable).parent / "tbb12.dll")); assert tbb.TBB_runtime_interface_version() >= 12060; import numba.np.ufunc.tbbpool; print("Numba/TBB: OK")'
Invoke-PythonScript -Python $runtimePython -Code 'import ssl,sqlite3,numpy,torch,torchaudio,qwen_tts,gigaam,onnxruntime,silero_vad,livekit,fastapi,uvicorn,soundfile; assert torch.cuda.is_available(), "CUDA недоступна"; print(torch.cuda.get_device_name(0))'
if ($LASTEXITCODE -ne 0) { throw 'Не прошёл импорт автономного стека/CUDA' }
$audioCheck = @'
import pathlib, tempfile, wave, torchaudio
assert "soundfile" in torchaudio.list_audio_backends(), "Нет SoundFile backend"
with tempfile.TemporaryDirectory() as tmp:
 p=pathlib.Path(tmp)/"probe.wav"
 with wave.open(str(p),"wb") as f:
  f.setnchannels(1); f.setsampwidth(2); f.setframerate(16000); f.writeframes(bytes(3200))
 audio,sr=torchaudio.load(str(p))
 assert sr==16000 and audio.shape==(1,1600)
print("Torchaudio/SoundFile: OK")
'@
Invoke-PythonScript -Python $runtimePython -Code $audioCheck
& $runtimePython -B (Join-Path $PSScriptRoot '..\services\voice\prepare_models.py') --check --models-dir (Join-Path $Output 'models\voice')
if ($LASTEXITCODE -ne 0) { throw 'Не прошла проверка весов' }
& (Join-Path $Output 'bin\ffmpeg.exe') -v error -f lavfi -i 'anullsrc=r=16000:cl=mono' -t 0.1 -f null -
if ($LASTEXITCODE -ne 0) { throw 'Не прошла проверка FFmpeg' }
& (Join-Path $Output 'bin\ffmpeg.exe') -hide_banner -L | Set-Content -LiteralPath (Join-Path $Output 'licenses\ffmpeg-license.txt') -Encoding UTF8
& (Join-Path $Output 'bin\ffmpeg.exe') -version | Set-Content -LiteralPath (Join-Path $Output 'licenses\ffmpeg-build.txt') -Encoding UTF8
# dumpbin остаётся сборочным инструментом. API-set и Windows/NVIDIA DLL поставляет ОС/драйвер.
$dllNames = @{}
Get-ChildItem -LiteralPath $Output -File -Recurse -Filter '*.dll' | ForEach-Object { $dllNames[$_.Name.ToLowerInvariant()] = $true }
$imports = [ordered]@{}
Get-ChildItem -LiteralPath $Output -File -Recurse | Where-Object { $_.Extension -in '.dll','.pyd','.exe' } | ForEach-Object {
  $file = $_
  $lines = & $dumpbin /DEPENDENTS $file.FullName
  if ($LASTEXITCODE -ne 0) { throw "Не удалось проверить PE: $($file.FullName)" }
  $deps = @($lines | Where-Object { $_ -match '^\s+([a-zA-Z0-9_.-]+\.dll)\s*$' } | ForEach-Object { $_.Trim().ToLowerInvariant() })
  foreach ($dep in $deps) {
    if (-not $dllNames.ContainsKey($dep) -and $dep -notmatch '^(api-ms-win-|ext-ms-win-)' -and
        -not (Test-Path -LiteralPath (Join-Path ($env:SystemRoot + '\System32') $dep))) {
      throw "Невключённая DLL: $dep нужна $($file.FullName)"
    }
    if ($dep -match '^(vcruntime|msvcp|concrt)' -and -not $dllNames.ContainsKey($dep)) { throw "В комплекте отсутствует Microsoft runtime DLL: $dep" }
  }
  $imports[$file.FullName.Substring($Output.Length+1).Replace('\','/')] = $deps
}
$imports | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Output 'licenses\pe-imports.json') -Encoding UTF8
# Пакеты сохраняют dist-info/LICENSE; полный перечень, хеши исходников и лицензий — в манифесте.
$finalize = @'
import hashlib,importlib.metadata,json,pathlib,sys
root=pathlib.Path(sys.argv[1]); lock=pathlib.Path(sys.argv[2]) if len(sys.argv)>2 and sys.argv[2] else None
packages=[]
for d in sorted(importlib.metadata.distributions(),key=lambda d:d.metadata.get('Name','').lower()):
 packages.append({'name':d.metadata.get('Name'),'version':d.version,'license':d.metadata.get('License-Expression') or d.metadata.get('License','')})
report={'status':'requires-redistribution-review','platform':'win32-x64','packages':packages,'pending':['Проверить и приложить лицензии Python, Microsoft runtime DLL, CUDA, cuDNN, Torch, FFmpeg и всех моделей.','Соответствующие исходники и условия GPL/LGPL FFmpeg зависят от выбранной сборки.','Реальный синтез, распознавание, подавление эха и запуск без сети на чистом профиле обязательны; импорт CUDA не заменяет эти проверки.']}
(root/'licenses/redistribution-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
entries={}
for p in sorted(root.rglob('*')):
 if p.is_symlink(): raise RuntimeError('Символическая ссылка в runtime: '+str(p))
 if not p.is_file(): continue
 with p.open('rb') as f: sha=hashlib.file_digest(f,'sha256').hexdigest()
 entries[p.relative_to(root).as_posix()]={'size':p.stat().st_size,'sha256':sha}
if lock:
 old=json.loads(lock.read_text(encoding='utf-8-sig'))
 if old['files']!=entries: raise RuntimeError('Runtime отличается от SourceLock')
(root/'manifest.json').write_text(json.dumps({'schema':1,'platform':'win32-x64','engine':'qwen3-ru-stress','files':entries},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'ok':True,'files':len(entries),'bytes':sum(i['size'] for i in entries.values()),'real_voice_test':'required'}))
'@
Invoke-PythonScript -Python $runtimePython -Code $finalize -ScriptArguments @($Output, $SourceLock)
if ($LASTEXITCODE -ne 0) { throw 'Не удалось проверить манифест/SourceLock' }
Write-Host 'Подготовлен runtime. До выпуска обязательна отдельная проверка реального голоса без сети в пути с пробелами/кириллицей и чистом профиле.'
