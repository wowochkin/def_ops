# Windows x64 / Python 3.12. Подготовка wheels требует интернета; установка -Wheelhouse автономна.
# .\setup.ps1 -PrepareWheelhouse D:\DefOpsKit\voice-wheels
# .\setup.ps1 -Wheelhouse D:\DefOpsKit\voice-wheels
# Веса отдельно: .venv\Scripts\python.exe prepare_models.py --models-dir D:\DefOps\models\voice
[CmdletBinding()]
param(
  [string]$Python = "py",
  [string]$VenvPath = (Join-Path $PSScriptRoot ".venv"),
  [string]$Wheelhouse,
  [string]$PrepareWheelhouse
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot '..\..\scripts\windows-python.ps1')
if ($env:OS -ne "Windows_NT") { throw "Этот скрипт запускается на Windows x64" }
if ($Wheelhouse -and $PrepareWheelhouse) { throw "Выберите либо -Wheelhouse, либо -PrepareWheelhouse" }
$gigaCommit = "7447938d791c4f3e643386ee22c33777004293a5"
$requirements = Join-Path $PSScriptRoot "requirements-win.txt"
$pythonArgs = @()
if ([IO.Path]::GetFileNameWithoutExtension($Python) -eq "py") { $pythonArgs = @("-3.12") }
Invoke-PythonScript -Python $Python -PythonArguments $pythonArgs -Code "import struct,sys; assert sys.version_info[:2]==(3,12) and struct.calcsize('P')==8, 'Нужен Python 3.12 x64'"
if ($LASTEXITCODE -ne 0) { throw "Нужен установленный Python 3.12 x64" }
& $Python @pythonArgs -m venv $VenvPath
if ($LASTEXITCODE -ne 0) { throw "Не удалось создать окружение $VenvPath" }
$voicePython = Join-Path $VenvPath "Scripts\python.exe"
function Invoke-Pip([string[]]$PipArgs) {
  & $voicePython -m pip @PipArgs
  if ($LASTEXITCODE -ne 0) { throw "Ошибка pip (код $LASTEXITCODE)" }
}

if (-not $Wheelhouse) {
  $target = if ($PrepareWheelhouse) { $PrepareWheelhouse } else { Join-Path $PSScriptRoot ".wheelhouse-win" }
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  $target = (Resolve-Path -LiteralPath $target).Path
  Write-Host "Подготовка Windows wheels; требуется интернет"
  Get-ChildItem -LiteralPath $target -File -Filter "gigaam-*.whl" | ForEach-Object { Remove-Item -LiteralPath $_.FullName }
  Invoke-Pip -PipArgs @("wheel", "--no-deps", "--wheel-dir", $target,
    "https://github.com/salute-developers/GigaAM/archive/$gigaCommit.zip")
  $gigaWheel = Get-ChildItem -LiteralPath $target -File -Filter "gigaam-0.2.0-*.whl" | Select-Object -First 1
  if (-not $gigaWheel) { throw "Не собран закреплённый wheel GigaAM" }
  Invoke-Pip -PipArgs @("wheel", "--prefer-binary", "--wheel-dir", $target, "--find-links", $target,
    "--extra-index-url", "https://download.pytorch.org/whl/cu128", $gigaWheel.FullName, "-r", $requirements)
  $files = [ordered]@{}
  Get-ChildItem -LiteralPath $target -File -Filter "*.whl" | Sort-Object Name | ForEach-Object {
    $files[$_.Name] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  $manifest = [ordered]@{ version = 1; python = "3.12-x64"; gigaam_commit = $gigaCommit;
    requirements_sha256 = (Get-FileHash -LiteralPath $requirements -Algorithm SHA256).Hash.ToLowerInvariant(); files = $files }
  $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $target "manifest.json") -Encoding UTF8
  if ($PrepareWheelhouse) { Write-Host "Комплект wheels готов: $target. Веса готовятся отдельно."; exit 0 }
  $Wheelhouse = $target
}

$Wheelhouse = (Resolve-Path -LiteralPath $Wheelhouse).Path
$manifest = Get-Content -LiteralPath (Join-Path $Wheelhouse "manifest.json") -Raw | ConvertFrom-Json
if ($manifest -isnot [PSCustomObject] -or $manifest.version -ne 1 -or $manifest.python -ne "3.12-x64" -or $manifest.gigaam_commit -ne $gigaCommit -or
    $manifest.requirements_sha256 -ne (Get-FileHash -LiteralPath $requirements -Algorithm SHA256).Hash.ToLowerInvariant()) {
  throw "Комплект wheels не соответствует requirements-win.txt; подготовьте его заново"
}
if ($manifest.files -isnot [PSCustomObject]) { throw "В manifest.json отсутствует список wheels" }
$entries = @($manifest.files.PSObject.Properties)
$wheelNames = @(Get-ChildItem -LiteralPath $Wheelhouse -File -Force -Filter "*.whl" | ForEach-Object { $_.Name })
if ($entries.Count -eq 0 -or $entries.Count -ne $wheelNames.Count) {
  throw "Набор wheels не совпадает с manifest.json; подготовьте комплект заново"
}
foreach ($entry in $entries) {
  if ($entry.Name -ne [IO.Path]::GetFileName($entry.Name) -or $entry.Name -notlike "*.whl" -or
      $entry.Value -isnot [string] -or $entry.Value -cnotmatch '^[0-9a-f]{64}$') {
    throw "Некорректная запись wheel в manifest.json"
  }
  if ($wheelNames -notcontains $entry.Name) { throw "Набор wheels не совпадает с manifest.json: $($entry.Name)" }
  $file = Join-Path $Wheelhouse $entry.Name
  if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or
      (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) {
    throw "Повреждён или отсутствует wheel: $($entry.Name)"
  }
}
Write-Host "Автономная установка из $Wheelhouse"
Invoke-Pip -PipArgs @("install", "--no-index", "--only-binary=:all:", "--find-links", $Wheelhouse, "-r", $requirements)
Invoke-Pip -PipArgs @("check")
Invoke-PythonScript -Python $voicePython -Code "import torch,qwen_tts,gigaam,onnxruntime,silero_vad,livekit; print('CUDA:',torch.cuda.is_available()); print('GPU:',torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'нет')"
if ($LASTEXITCODE -ne 0) { throw "Не удалось импортировать голосовой стек" }
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { Write-Warning "Добавьте ffmpeg.exe в PATH до запуска сервиса" }
Write-Host "Окружение готово. Наличие CUDA, память, качество голоса и полный offline-прогон нужно проверить на целевом ПК."
