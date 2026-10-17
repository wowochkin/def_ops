#!/usr/bin/env bash
# Окружение сервиса голоса (Mac на Apple Silicon): .venv на Python 3.12 — mlx-audio, GigaAM, Silero VAD, числа словами,
# веб-сервер и pytest. Модели скачиваются с Hugging Face при первом запуске, не здесь.
set -euo pipefail
cd "$(dirname "$0")"
[ "$(uname -m)" = arm64 ] || { echo "нужен Mac на Apple Silicon"; exit 1; }
command -v uv >/dev/null || { echo "нужен uv: brew install uv"; exit 1; }
command -v ffmpeg >/dev/null || { echo "нужен ffmpeg: brew install ffmpeg"; exit 1; }
step() { echo; echo "▶ $*"; }

step "1/2 окружение .venv (Python 3.12)"
uv venv --allow-existing --python 3.12 .venv
step "2/2 mlx-audio со всеми моделями (~1–3 мин), GigaAM, Silero VAD, числа словами, веб-сервер, pytest"
uv pip install --python .venv/bin/python "mlx-audio[all]==0.5.9"
uv pip install --python .venv/bin/python "gigaam[torch] @ git+https://github.com/salute-developers/GigaAM" silero-vad num2words \
  fastapi uvicorn pytest
echo; echo "готово"
