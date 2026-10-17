#!/usr/bin/env bash
# Образцы голоса из архивной записи пресс-конференции о Берлинской операции (mp3, 1:56).
# Границы кусков найдены по паузам этой записи; гул ниже 80 Гц (громче речи) снимается фильтром.
#   ./prepare_ref.sh путь/к/записи.mp3
set -euo pipefail
cd "$(dirname "$0")"
src="${1:?укажите mp3 с записью}"
command -v ffmpeg >/dev/null || { echo "нужен ffmpeg: brew install ffmpeg"; exit 1; }
mkdir -p ref
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src")
awk -v d="$dur" 'BEGIN { if (d < 114 || d > 118) { print "длительность " d " с — не та запись (ждём ~116 с), границы кусков не подойдут"; exit 1 } }'

hp="highpass=f=80:poles=2,highpass=f=80:poles=2,highpass=f=80"
norm="loudnorm=I=-20:TP=-2:LRA=11"
cut() { # $1 начало, $2 конец, $3 имя, $4 фильтры
  ffmpeg -loglevel error -y -i "$src" -ss "$1" -to "$2" -ac 1 -af "$4" -ar 24000 "ref/$3.wav"
}
cut 9.80 24.76 zhukov-14s "$hp,$norm"
cut 84.86 94.84 zhukov-10s "$hp,$norm"
cut 63.02 84.86 zhukov-22s "$hp,$norm"
cut 9.80 24.76 zhukov-14s-raw "$norm"

# шумоподавление DeepFilterNet (MLX) — если окружение синтеза уже собрано
if [ -x .venv-tts/bin/python ]; then
  ffmpeg -loglevel error -y -i "$src" -ss 9.80 -to 24.76 -ac 1 -af "$hp" -ar 48000 ref/_hp48.wav
  .venv-tts/bin/python - <<'EOF'
from mlx_audio.sts.models.deepfilternet import DeepFilterNetModel
DeepFilterNetModel.from_pretrained(version=3).enhance_file("ref/_hp48.wav", "ref/_dfn48.wav")
EOF
  ffmpeg -loglevel error -y -i ref/_dfn48.wav -af "$norm" -ar 24000 ref/zhukov-14s-dfn.wav
  rm -f ref/_hp48.wav ref/_dfn48.wav
else
  echo "(вариант zhukov-14s-dfn пропущен: сначала ./setup.sh)"
fi
ls -la ref
