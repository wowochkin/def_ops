#!/usr/bin/env bash
# Офлайн-комплект для закрытого контура: все образы платформы + конфигурация в
# одном архиве. Собирается на машине с интернетом, разворачивается без него.
#
#   ./scripts/offline-bundle.sh                 → defops-offline-ГГГГММДД.tar.gz
#   (на целевой машине)
#   tar xzf defops-offline-*.tar.gz && cd defops-offline && ./install.sh
#
# Локальные карты (тайлы) переносятся отдельно — пакетами карт (.tar) из панели
# «Локальные карты» или через API /cartography/maps/{id}/package.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="defops-offline"
STAMP="$(date +%Y%m%d)"
IMAGES=(defops/documents defops/render defops/registry defops/cartography defops/gateway postgis/postgis:16-3.4-alpine)

echo "Сборка образов…"
docker compose build
docker image inspect postgis/postgis:16-3.4-alpine >/dev/null 2>&1 || docker pull postgis/postgis:16-3.4-alpine

rm -rf "$OUT" && mkdir -p "$OUT/scripts" "$OUT/deploy/extra-ca"
echo "Сохранение образов (несколько минут)…"
docker save "${IMAGES[@]}" | gzip > "$OUT/images.tar.gz"
cp docker-compose.yml "$OUT/"
cp deploy/Dockerfile "$OUT/deploy/"
touch "$OUT/deploy/extra-ca/.gitkeep"
cp scripts/start-local.sh scripts/start-local.ps1 "$OUT/scripts/"
cat > "$OUT/install.sh" <<'INNER'
#!/usr/bin/env bash
# Установка без интернета: загрузить образы и запустить платформу.
set -euo pipefail
cd "$(dirname "$0")"
echo "Загрузка образов в Docker…"
gunzip -c images.tar.gz | docker load
exec ./scripts/start-local.sh
INNER
cat > "$OUT/install.ps1" <<'INNER'
# Установка без интернета (Windows): загрузить образы и запустить платформу.
Set-Location $PSScriptRoot
Write-Host "Загрузка образов в Docker…"
docker load -i images.tar.gz
if ($LASTEXITCODE -ne 0) { Write-Host "docker load завершился с ошибкой" -ForegroundColor Red; exit 1 }
& .\scripts\start-local.ps1
INNER
chmod +x "$OUT/install.sh" "$OUT/scripts/start-local.sh"
tar czf "defops-offline-$STAMP.tar.gz" "$OUT"
rm -rf "$OUT"
echo "Готово: defops-offline-$STAMP.tar.gz ($(du -h "defops-offline-$STAMP.tar.gz" | cut -f1))"
