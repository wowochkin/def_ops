#!/usr/bin/env bash
# Образцы голоса начальника штаба из записи рассказа о Берлинской операции (mp3, 1:39, чистый голос без гула).
# Границы кусков — по паузам между фразами этой записи; громкость выравнивается, как у образцов Жукова.
#   ./prepare_chief.sh путь/к/записи.mp3
set -euo pipefail
cd "$(dirname "$0")"
src="${1:?укажите mp3 с записью}"
command -v ffmpeg >/dev/null || { echo "нужен ffmpeg: brew install ffmpeg"; exit 1; }
mkdir -p ref
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src")
awk -v d="$dur" 'BEGIN { if (d < 97 || d > 101) { print "длительность " d " с — не та запись (ждём ~99 с), границы кусков не подойдут"; exit 1 } }'

norm="loudnorm=I=-20:TP=-2:LRA=11"
cut() { # $1 начало, $2 конец, $3 имя
  ffmpeg -loglevel error -y -i "$src" -ss "$1" -to "$2" -ac 1 -af "$norm" -ar 24000 "ref/$3.wav"
}
cut 64.53 75.60 chief-10s
cut 49.44 64.50 chief-15s
cut 76.00 94.40 chief-18s
ls -la ref/chief-*.wav
