#!/bin/sh
set -eu
out="${1:?Укажите каталог исходных климатических данных}"
sh scripts/weather-climate-fetch.sh "$out"
"${WEATHER_CLIMATE_PYTHON:-python3}" scripts/weather-climate-normalize.py "$out"
