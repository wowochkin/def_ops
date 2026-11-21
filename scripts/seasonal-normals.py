"""Собирает месячные нормы NOAA в равномерную обзорную сетку 5°. Требует h5py и numpy."""
import base64
import hashlib
import json
import sys
from pathlib import Path

import h5py
import numpy as np

root = Path(__file__).resolve().parents[1]
folder = Path(sys.argv[1])
base = 'https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis'
files = {
    'soilw': '.derived/surface_gauss/soilw.0-10cm.mon.ltm.1991-2020.nc',
    'runof': '.derived/surface_gauss/runof.sfc.mon.ltm.1991-2020.nc',
    'land': '/surface_gauss/land.sfc.gauss.nc',
}
sources = {}
data = {}
for key, path in files.items():
    local = folder / f'atlas-{key}.nc'
    sources[key] = {'url': base + path, 'sha256': hashlib.sha256(local.read_bytes()).hexdigest()}
    with h5py.File(local) as ds:
        data[key] = ds[key][:]
        lat, lon = ds['lat'][:], ds['lon'][:]
air = json.loads((root / 'packages/core/src/climate/monthly-air.json').read_text())
assert np.allclose(air['lat'], lat, atol=.001) and np.allclose(lon, np.arange(192)*1.875)
sources['air'] = {k: air[k] for k in ('url', 'sha256')}
data['air'] = np.asarray(air['months']).reshape(12, len(lat), len(lon)) / 10
# Формат: месяц, широта с севера на юг, долгота с запада на восток. 255 — нет данных.
layers = {k: np.full((12, 36, 72), 255, dtype=np.uint8) for k in ('soil', 'runoff', 'ice')}
xcell = np.floor(((lon + 180) % 360) / 5).astype(int)
ycell = np.floor((90-lat) / 5).astype(int)
for y in range(36):
    for x in range(72):
        iy, ix = np.where((ycell == y)[:, None] & (xcell == x)[None, :])
        land = data['land'][0, iy, ix] == 1
        if not land.any():
            continue
        iy, ix = iy[land], ix[land]
        def series(field):
            raw = data[field][:, iy, ix]
            return np.ma.average(np.ma.masked_where(abs(raw) > 1e8, raw), axis=1,
                                 weights=np.cos(np.deg2rad(lat[iy]))).filled(np.nan)
        soil, runoff, temp = (series(k) for k in ('soilw', 'runof', 'air'))
        valid = np.isfinite(soil)
        layers['soil'][valid, y, x] = np.rint(soil[valid]*100)
        if np.isfinite(runoff).all():
            layers['runoff'][:, y, x] = np.rint(100*runoff/runoff.max()) if runoff.max() > 0 else 0
        # Иллюстративный год для условного пресного водоёма: сглаживаем температуру воздуха.
        # Переход через ноль задаёт фазу, а не фактические сроки льда на конкретном озере.
        smoothed = (2*temp + np.roll(temp, 1))/3
        cold = smoothed < 0
        before = np.roll(cold, 1)
        layers['ice'][:, y, x] = np.select([cold & ~before, cold & before, ~cold & before], [1, 2, 3], default=0)

output = {'step': 5, 'period': '1991–2020', 'sources': sources}
output.update({k: base64.b64encode(v.tobytes()).decode() for k, v in layers.items()})
(root/'apps/editor/src/modern/climate/seasonal.json').write_text(json.dumps(output, separators=(',', ':'))+'\n')
