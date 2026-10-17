#!/usr/bin/env bash
# Окружения испытания (Mac на Apple Silicon): .venv-tts — синтез (mlx-audio), .venv-stt — распознавание
# (mlx-audio, GigaAM на PyTorch, T-one на ONNX). Модели скачиваются с Hugging Face при первом запуске.
set -euo pipefail
cd "$(dirname "$0")"
[ "$(uname -m)" = arm64 ] || { echo "нужен Mac на Apple Silicon"; exit 1; }
command -v uv >/dev/null || { echo "нужен uv: brew install uv"; exit 1; }
command -v ffmpeg >/dev/null || { echo "нужен ffmpeg: brew install ffmpeg"; exit 1; }

uv venv -q --python 3.12 .venv-tts
uv pip install -q --python .venv-tts/bin/python "mlx-audio[all]==0.5.9"

uv venv -q --python 3.12 .venv-stt
uv pip install -q --python .venv-stt/bin/python "mlx-audio[stt]==0.5.9" sounddevice \
  "gigaam[torch] @ git+https://github.com/salute-developers/GigaAM"
# T-one тянет KenLM (собирается из исходников: нужны cmake и boost — brew install cmake boost)
uv pip install -q --python .venv-stt/bin/python "tone @ git+https://github.com/voicekit-team/T-one" \
  || echo "T-one не установился (KenLM) — испытание пройдёт без него: --engines whisper-turbo,parakeet-v3,gigaam-rnnt,gigaam-e2e"
echo "готово"
