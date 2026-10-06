#!/usr/bin/env bash
# Запуск всей платформы на своём компьютере (macOS / Linux): PostgreSQL + PostGIS,
# сервисы и редактор в Docker. Первый запуск собирает образы (нужен интернет,
# 5–10 минут); дальше — за секунды и без интернета.
#
#   ./scripts/start-local.sh            запустить (http://localhost:8080)
#   ./scripts/start-local.sh stop       остановить (данные сохраняются)
#   ./scripts/start-local.sh reset      остановить и удалить ВСЕ данные (карты, реестр, тайлы)
#   ./scripts/start-local.sh logs       журналы сервисов
#   PORT=9000 ./scripts/start-local.sh  на другом порту
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8080}"
export PORT

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "Не найден Docker. Установите Docker Desktop: https://www.docker.com/products/docker-desktop/"
docker compose version >/dev/null 2>&1 || die "Нужен Docker Compose v2 (команда «docker compose»). Обновите Docker Desktop."
docker info >/dev/null 2>&1 || die "Docker не запущен. Откройте Docker Desktop и дождитесь, пока он стартует."

case "${1:-up}" in
  stop)  docker compose stop; say "Остановлено. Данные сохранены; запуск снова: ./scripts/start-local.sh"; exit 0 ;;
  reset) read -r -p "Удалить все карты, реестр и тайлы? [y/N] " a; [[ "$a" == [yY]* ]] || exit 0
         docker compose down -v; say "Всё удалено."; exit 0 ;;
  logs)  exec docker compose logs -f --tail=100 ;;
  up)    ;;
  *)     die "Неизвестная команда: $1 (up | stop | reset | logs)" ;;
esac

if docker image inspect defops/gateway:latest >/dev/null 2>&1 && [[ "${REBUILD:-}" != 1 ]]; then
  say "Запуск платформы…"
  docker compose up -d
else
  say "Сборка образов и запуск (первый раз — несколько минут)…"
  docker compose up -d --build
fi

say "Ожидание готовности сервисов…"
for i in $(seq 1 120); do
  if curl -fsS "http://localhost:${PORT}/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
    say "Готово: http://localhost:${PORT}/"
    echo "  справочник знаков:  http://localhost:${PORT}/library.html"
    echo "  остановить:         ./scripts/start-local.sh stop"
    (command -v open >/dev/null && open "http://localhost:${PORT}/") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:${PORT}/" >/dev/null 2>&1) || true
    exit 0
  fi
  sleep 2
done
docker compose ps
die "Сервисы не поднялись за 4 минуты. Журналы: ./scripts/start-local.sh logs"
