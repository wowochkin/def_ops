#!/usr/bin/env bash
# Окружения испытания (Mac на Apple Silicon): .venv-tts — синтез (mlx-audio), .venv-stt — распознавание
# (mlx-audio, GigaAM на PyTorch; T-one на ONNX — по флагу --tone, он собирает KenLM из исходников).
# Модели скачиваются с Hugging Face при первом запуске испытаний, не здесь.
#   ./setup.sh [--tone]
set -euo pipefail
cd "$(dirname "$0")"
[ "$(uname -m)" = arm64 ] || { echo "нужен Mac на Apple Silicon"; exit 1; }
command -v uv >/dev/null || { echo "нужен uv: brew install uv"; exit 1; }
command -v ffmpeg >/dev/null || { echo "нужен ffmpeg: brew install ffmpeg"; exit 1; }
step() { echo; echo "▶ $*"; }

step "1/4 окружение синтеза .venv-tts (Python 3.12)"
uv venv --allow-existing --python 3.12 .venv-tts
step "2/4 mlx-audio со всеми моделями синтеза (~1–3 мин)"
uv pip install --python .venv-tts/bin/python "mlx-audio[all]==0.5.9"
step "2b/4 стенд разговора: GigaAM, Silero VAD, числа словами (в то же окружение)"
uv pip install --python .venv-tts/bin/python "gigaam[torch] @ git+https://github.com/salute-developers/GigaAM" silero-vad num2words

step "3/4 окружение распознавания .venv-stt: mlx-audio, GigaAM и PyTorch (PyTorch ~1 ГБ, 2–5 мин)"
uv venv --allow-existing --python 3.12 .venv-stt
uv pip install --python .venv-stt/bin/python "mlx-audio[stt]==0.5.9" sounddevice \
  "gigaam[torch] @ git+https://github.com/salute-developers/GigaAM"

if [ "${1:-}" = "--tone" ]; then
  step "4/4 T-one (собирает KenLM: нужны cmake и boost — brew install cmake boost; 5–10 мин)"
  uv pip install --python .venv-stt/bin/python "tone @ git+https://github.com/voicekit-team/T-one" \
    || echo "T-one не установился — испытание распознавания пройдёт без него"
else
  step "4/4 T-one пропущен (поставить: ./setup.sh --tone)"
fi
echo; echo "готово"
