"""Обзорный справочник Natural Earth (public domain). Для пересборки нужен shapely."""
import json
from pathlib import Path
from urllib.request import urlopen
from shapely.geometry import shape

BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/'
def features(layer):
    with urlopen(BASE + layer + '.geojson') as response:
        return json.load(response)['features']

def encode_ring(coords):
    # Дельты тысячных долей градуса в формате encoded polyline (долгота, широта).
    previous = [0, 0]
    encoded = []
    for point in coords:
        for axis, value in enumerate(point[:2]):
            value = round(value * 1000)
            delta = value - previous[axis]
            previous[axis] = value
            bits = (delta << 1) ^ (delta >> 31)
            while bits >= 32:
                encoded.append(chr(63 + (bits & 31) + 32))
                bits >>= 5
            encoded.append(chr(63 + bits))
    return ''.join(encoded)

def polygons(items):
    rows = []
    for item in items:
        props = item['properties']
        geom = shape(item['geometry']).simplify(.025, preserve_topology=True)
        parts = geom.geoms if geom.geom_type == 'MultiPolygon' else [geom]
        for part in parts:
            rings = []
            for ring in [part.exterior, *part.interiors]:
                rings.append(encode_ring(ring.coords))
            rows.append([props.get('name_ru') or props['name'], props.get('adm0_a3',''),
                         [round(v, 3) for v in part.bounds], rings, part.area])
    # Вложенные моря и заливы имеют приоритет перед океанами.
    rows.sort(key=lambda r:r[-1])
    return [row[:-1] for row in rows]

def save(book):
    out=Path(__file__).resolve().parents[1]/'apps/editor/src/modern/geography/names.json'
    out.write_text(json.dumps(book,ensure_ascii=False,separators=(',',':'))+'\n')

def build(towns,regions,seas,countries):
    places=[]
    for f in towns:
        p=f['properties']
        places.append([p.get('NAME_RU') or p['NAME'],p['ADM0_A3'],
                       *[round(v,3) for v in f['geometry']['coordinates'][:2]]])
    return {'places':places,'regions':polygons(regions),'seas':polygons(seas),
            'countries':{f['properties']['ADM0_A3']:f['properties']['NAME_RU'] for f in countries}}
if __name__=='__main__':
    save(build(*(features(n) for n in ['ne_10m_populated_places','ne_10m_admin_1_states_provinces',
                                       'ne_50m_geography_marine_polys','ne_110m_admin_0_countries'])))
