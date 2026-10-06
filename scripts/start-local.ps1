# Запуск всей платформы на своём компьютере (Windows, PowerShell): PostgreSQL + PostGIS,
# сервисы и редактор в Docker Desktop. Первый запуск собирает образы (нужен интернет,
# 5–10 минут); дальше — за секунды и без интернета.
#
#   .\scripts\start-local.ps1            запустить (http://localhost:8080)
#   .\scripts\start-local.ps1 stop       остановить (данные сохраняются)
#   .\scripts\start-local.ps1 reset      удалить ВСЕ данные (карты, реестр, тайлы)
#   .\scripts\start-local.ps1 logs       журналы сервисов
#   $env:PORT=9000; .\scripts\start-local.ps1   на другом порту
param([string]$Command = "up")
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not $env:PORT) { $env:PORT = "8080" }
$port = $env:PORT

function Die($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Die "Не найден Docker. Установите Docker Desktop: https://www.docker.com/products/docker-desktop/" }
docker compose version *> $null; if ($LASTEXITCODE -ne 0) { Die "Нужен Docker Compose v2. Обновите Docker Desktop." }
docker info *> $null; if ($LASTEXITCODE -ne 0) { Die "Docker не запущен. Откройте Docker Desktop и дождитесь, пока он стартует." }

switch ($Command) {
  "stop"  { docker compose stop; Write-Host "Остановлено. Данные сохранены."; exit 0 }
  "reset" { $a = Read-Host "Удалить все карты, реестр и тайлы? [y/N]"; if ($a -match '^[yY]') { docker compose down -v; Write-Host "Всё удалено." }; exit 0 }
  "logs"  { docker compose logs -f --tail=100; exit 0 }
  "up"    { }
  default { Die "Неизвестная команда: $Command (up | stop | reset | logs)" }
}

docker image inspect defops/gateway:latest *> $null
if ($LASTEXITCODE -eq 0 -and $env:REBUILD -ne "1") { Write-Host "Запуск платформы…"; docker compose up -d }
else { Write-Host "Сборка образов и запуск (первый раз — несколько минут)…"; docker compose up -d --build }
if ($LASTEXITCODE -ne 0) { Die "docker compose завершился с ошибкой" }

Write-Host "Ожидание готовности сервисов…"
for ($i = 0; $i -lt 120; $i++) {
  try {
    $h = Invoke-RestMethod -Uri "http://localhost:$port/api/health" -TimeoutSec 3
    if ($h.status -eq "ok") {
      Write-Host "Готово: http://localhost:$port/" -ForegroundColor Green
      Write-Host "  справочник знаков:  http://localhost:$port/library.html"
      Write-Host "  остановить:         .\scripts\start-local.ps1 stop"
      Start-Process "http://localhost:$port/"
      exit 0
    }
  } catch { }
  Start-Sleep -Seconds 2
}
docker compose ps
Die "Сервисы не поднялись за 4 минуты. Журналы: .\scripts\start-local.ps1 logs"
