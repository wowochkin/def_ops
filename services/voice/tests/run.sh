#!/bin/sh
# Тесты сервиса голоса: питон из .venv, иначе $VOICE_PYTHON, иначе пропуск.
cd "$(dirname "$0")/.." || exit 1
if [ -x .venv/bin/python ]; then PY=.venv/bin/python
elif [ -n "$VOICE_PYTHON" ]; then PY="$VOICE_PYTHON"
else echo "окружение голоса не установлено — тесты пропущены"; exit 0
fi
exec "$PY" -m pytest -q tests "$@"
