# Исправление существующего комплекта; payload содержит только закреплённые файлы.
[CmdletBinding()]
param([string]$KitRoot = 'D:\k')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$KitRoot = (Resolve-Path -LiteralPath $KitRoot).Path
$payload = Join-Path $PSScriptRoot 'payload'
$patch = Get-Content -LiteralPath (Join-Path $payload 'repair-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$manifestPath = Join-Path $KitRoot 'kit-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schema -ne 1 -or $manifest.kind -ne 'windows-build-kit') { throw 'Неизвестный формат комплекта' }
$wheelPath = Join-Path $KitRoot 'inputs/wheels/manifest.json'
$wheels = Get-Content -LiteralPath $wheelPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($wheels.version -ne 1 -or $wheels.python -ne '3.12-x64') { throw 'Неизвестный формат wheelhouse' }
$wheelEntry = @($manifest.files | Where-Object { $_.path -eq 'inputs/wheels/manifest.json' })
if ($wheelEntry.Count -ne 1 -or (Get-FileHash -LiteralPath $wheelPath).Hash.ToLowerInvariant() -ne $wheelEntry[0].sha256) {
  throw 'Контрольная сумма манифеста wheels не совпадает'
}
# Сначала проверяем весь патч и затрагиваемые исходники, затем меняем файлы.
foreach ($entry in $patch.files) {
  if ($entry.path -match '(^/|\\|:|(^|/)\.\.(/|$))') { throw 'Небезопасный путь в патче' }
  $source = Join-Path $payload $entry.path
  if ((Get-FileHash -LiteralPath $source).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "Повреждён патч: $($entry.path)" }
  $target = Join-Path $KitRoot $entry.path
  if (Test-Path -LiteralPath $target) {
    $actual = (Get-FileHash -LiteralPath $target).Hash.ToLowerInvariant()
    if ($actual -ne $entry.sha256 -and $actual -ne $entry.previous_sha256) { throw "Неизвестная версия файла: $($entry.path)" }
  } elseif ($entry.previous_sha256) { throw "Отсутствует исходный файл: $($entry.path)" }
}
foreach ($file in $manifestPath,$wheelPath) {
  if (!(Test-Path -LiteralPath "$file.before-tbb-fix")) { Copy-Item -LiteralPath $file -Destination "$file.before-tbb-fix" }
}
function Update-KitEntry([string]$RelativePath) {
  $file = Get-Item -LiteralPath (Join-Path $KitRoot $RelativePath)
  $newEntry = [PSCustomObject]@{path=$RelativePath;size=$file.Length;sha256=(Get-FileHash -LiteralPath $file.FullName).Hash.ToLowerInvariant()}
  $script:manifest.files = @($script:manifest.files | Where-Object { $_.path -ne $RelativePath }) + @($newEntry)
}
foreach ($entry in $patch.files) {
  $target = Join-Path $KitRoot $entry.path
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  if ((Test-Path -LiteralPath $target) -and !(Test-Path -LiteralPath "$target.before-tbb-fix")) { Copy-Item -LiteralPath $target -Destination "$target.before-tbb-fix" }
  Copy-Item -LiteralPath (Join-Path $payload $entry.path) -Destination $target -Force
  Update-KitEntry $entry.path
  if ($entry.path -like 'inputs/wheels/*.whl') {
    $wheels.files | Add-Member -MemberType NoteProperty -Name ([IO.Path]::GetFileName($entry.path)) -Value $entry.sha256 -Force
  }
}
$wheels.requirements_sha256 = (Get-FileHash -LiteralPath (Join-Path $KitRoot 'source/services/voice/requirements-win.txt')).Hash.ToLowerInvariant()
$wheels | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$wheelPath.tmp" -Encoding UTF8
Move-Item -LiteralPath "$wheelPath.tmp" -Destination $wheelPath -Force
Update-KitEntry 'inputs/wheels/manifest.json'
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$manifestPath.tmp" -Encoding UTF8
Move-Item -LiteralPath "$manifestPath.tmp" -Destination $manifestPath -Force
Write-Host 'Исправление TBB установлено. Проверка DLL остаётся включённой.'
Write-Host "Теперь запустите $KitRoot\BUILD-WINDOWS.cmd."
