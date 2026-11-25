#!/bin/sh
set -eu
out="${1:?Укажите каталог исходных климатических данных}"
mkdir -p "$out"
base='https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived/surface_gauss'
for file in air.2m.mon.ltm.1991-2020.nc pres.sfc.mon.ltm.1991-2020.nc prate.sfc.mon.ltm.1991-2020.nc shum.2m.mon.ltm.1991-2020.nc uwnd.10m.mon.ltm.1991-2020.nc vwnd.10m.mon.ltm.1991-2020.nc skt.sfc.mon.ltm.1991-2020.nc soilw.0-10cm.mon.ltm.1991-2020.nc; do
  curl --fail --location --silent --show-error --retry 3 --max-time 120 --output "$out/$file.tmp" "$base/$file"
  mv "$out/$file.tmp" "$out/$file"
done
file='tcdc.eatm.mon.1981-2010.ltm.nc'
curl --fail --location --silent --show-error --retry 3 --max-time 120 --output "$out/$file.tmp" "https://psl.noaa.gov/thredds/fileServer/Datasets/ncep.reanalysis/Monthlies/other_gauss/$file"
mv "$out/$file.tmp" "$out/$file"
