#!/usr/bin/env python3
"""Месячные нормы NOAA PSL: проверяемые источники и единицы, без заполнения пропусков."""
import hashlib
import json
import sys
from pathlib import Path
import h5py
import numpy as np

BASE = 'https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived/surface_gauss'
FIELDS = {
 'temperature': ('air.2m', 'air', '°C', -273.15, 1),
 'pressure': ('pres.sfc', 'pres', 'hPa', 0, .01),
 'precipitation': ('prate.sfc', 'prate', 'mm/h', 0, 3600),
 'specificHumidity': ('shum.2m', 'shum', 'kg/kg', 0, .001),
 'windU': ('uwnd.10m', 'uwnd', 'm/s', 0, 1),
 'windV': ('vwnd.10m', 'vwnd', 'm/s', 0, 1),
 'soilTemperature': ('skt.sfc', 'skt', '°C', 0, 1),
 'soilMoisture': ('soilw.0-10cm', 'soilw', 'm³/m³', 0, 1),
 'cloud': ('tcdc.eatm', 'tcdc', '%', 0, 1),
}

def unpack(dataset):
    raw = np.array(dataset, dtype=float)
    missing = ~np.isfinite(raw)
    for attr in ['missing_value', '_FillValue']:
        for value in np.array(dataset.attrs.get(attr, [])).flatten():
            missing |= raw == value
    raw = raw * float(np.array(dataset.attrs.get('scale_factor', 1)).item()) + float(np.array(dataset.attrs.get('add_offset', 0)).item())
    raw[missing] = np.nan
    return raw

def main():
    source = Path(sys.argv[1])
    target = Path(sys.argv[2] if len(sys.argv)>2 else 'packages/core/src/climate/regional-v2.json')
    normals = json.loads(Path('packages/core/src/climate/monthly-air.json').read_text())
    lat = np.array(normals['lat'])
    count = round(360 / normals['longitudeStep'])
    result = {'schemaVersion': 2, 'id': 'noaa-psl-regional-v2', 'license': 'NOAA PSL: свободно доступные данные; указывать NOAA PSL, Boulder, Colorado, USA', 'resolution': {'latitude': 'Gaussian 94 широтных узла', 'longitudeDegrees': 1.875, 'time': 'месячные климатические нормы'}, 'interpolation': 'Билинейная по координатам, линейная между 15-ми числами месяцев; периодическая долгота; у полюсов ближайшая широта; любой значимый пропуск сохраняется null', 'surfaceTemperatureLimitation': 'skt — температура поверхности, учебное приближение температуры грунта; не измерение на глубине', 'months': list(range(1,13)), 'lat': normals['lat'], 'longitudeStep': normals['longitudeStep'], 'longitudeCount': count, 'heights': normals['heights'], 'heightSource': {'url': normals.get('heightUrl', normals['url']), 'sha256': normals['heightSha256'], 'description': 'Высота поверхности исходной климатической сетки monthly-air.json'}, 'fields': {}}
    for field, (stem, variable, units, offset, factor) in FIELDS.items():
        cloud = field == 'cloud'
        filename = stem + ('.mon.1981-2010.ltm.nc' if cloud else '.mon.ltm.1991-2020.nc')
        file = source / filename
        with h5py.File(file) as dataset:
            raw = unpack(dataset[variable]).squeeze()
            source_lat = np.array(dataset['lat']); source_lon = np.array(dataset['lon'])
            # Все используемые Gaussian-файлы должны иметь ту же сетку, без скрытого ресэмплинга.
            if raw.shape != (12,len(lat),count) or not np.allclose(source_lat,lat,atol=.0001) or not np.allclose(source_lon,np.arange(count)*normals['longitudeStep'],atol=.0001):
                raise ValueError(f'{filename}: сетка не совпадает с monthly-air.json')
            values = np.round((raw * factor + offset), 5)
            original_units = dataset[variable].attrs['units']
            if isinstance(original_units, bytes): original_units=original_units.decode()
        url = ('https://psl.noaa.gov/thredds/fileServer/Datasets/ncep.reanalysis/Monthlies/other_gauss/' if cloud else BASE+'/')+filename
        result['fields'][field]={'units':units, 'values':[float(v) if np.isfinite(v) else None for v in values.flatten()], 'source':{'url':url, 'sha256':hashlib.sha256(file.read_bytes()).hexdigest(), 'period':'1981–2010' if cloud else '1991–2020','variable':variable,'units':str(original_units)}, 'conversion':{'factor':factor,'offset':offset}}
    payload=json.dumps(result,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n'
    digest=hashlib.sha256(payload.encode()).hexdigest()
    target.write_text(payload)
    target.with_name(target.stem+'-manifest.json').write_text(json.dumps({'id':result['id'],'sha256':digest},separators=(',',':'))+'\n')
    print(f'Климатический профиль: {target}, SHA-256 {digest}')

if __name__ == '__main__': main()
