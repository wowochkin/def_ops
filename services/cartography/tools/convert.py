"""Локальная подготовка OSM PBF и GeoTIFF. Только публичные географические объекты.
Вход и выход задаются аргументами без shell. stdout: NDJSON ход работы.
"""
from contextlib import ExitStack
import argparse
import json
import math
import os
import sqlite3
import sys
from pathlib import Path


def progress(stage, done=0, total=0):
    print(json.dumps(dict(stage=stage, done=done, total=total), ensure_ascii=False), flush=True)


def overlaps(coords, b):
    if isinstance(coords[0], (int, float)):
        return b[0] <= coords[0] <= b[2] and b[1] <= coords[1] <= b[3]
    flat = []
    def visit(c):
        if isinstance(c[0], (int, float)):
            flat.append(c)
        else:
            for x in c:
                visit(x)
    visit(coords)
    return flat and max(c[0] for c in flat) >= b[0] and min(c[0] for c in flat) <= b[2] and max(c[1] for c in flat) >= b[1] and min(c[1] for c in flat) <= b[3]


def osm(input_file, output_file, boxes):
    import osmium
    factory = osmium.geom.GeoJSONFactory()
    count = 0
    seen = set()
    out = open(output_file, 'w', encoding='utf-8')
    out.write('{"type":"FeatureCollection","features":[')
    def category(tags):
        if 'building' in tags: return 'buildings'
        if 'highway' in tags: return 'roads'
        if 'railway' in tags: return 'railways'
        if 'waterway' in tags or tags.get('natural') in ('water', 'bay') or 'water' in tags: return 'water'
        if 'place' in tags: return 'places'
        if 'boundary' in tags: return 'boundaries'
        if 'landuse' in tags or 'landcover' in tags or 'natural' in tags: return 'landcover'
        if 'power' in tags: return 'power'
        if 'aeroway' in tags: return 'aeroways'
        if 'man_made' in tags: return 'structures'
        if any(k in tags for k in ('amenity', 'shop', 'tourism', 'leisure', 'office', 'historic')): return 'pois'
        return None
    def emit(obj, geometry):
        nonlocal count
        key=(type(obj).__name__,obj.id)
        if key in seen: return
        tags = dict(obj.tags)
        layer = category(tags)
        if not layer or not any(overlaps(geometry['coordinates'], b) for b in boxes): return
        seen.add(key)
        count += 1
        if count > 1000000 or out.tell() > 512 * 1024 * 1024:
            raise ValueError('Слишком много объектов. Возьмите меньшую область, предел 1 млн объектов / 512 МБ GeoJSON')
        if count > 1: out.write(',')
        out.write(json.dumps(dict(type='Feature', geometry=geometry, properties={**tags, 'layer': layer, 'osm_id': str(obj.id)}), ensure_ascii=False))
        if count % 10000 == 0: progress('Объекты OSM', count)
    class Handler(osmium.SimpleHandler):
        def node(self, n):
            if category(dict(n.tags)) and n.location.valid():
                emit(n, dict(type='Point', coordinates=[n.location.lon, n.location.lat]))
        def way(self, w):
            tags = dict(w.tags)
            if not category(tags): return
            # Площади закрытых путей/отношений обрабатываются callback area с отверстиями.
            area_keys = ('building', 'landuse', 'landcover', 'amenity', 'leisure', 'water')
            if w.is_closed() and (any(k in tags for k in area_keys) or tags.get('natural') in ('water','wood','scrub','wetland')) and tags.get('area') != 'no': return
            try: geometry = json.loads(factory.create_linestring(w))
            except osmium.InvalidLocationError: return
            emit(w, geometry)
        def area(self, a):
            if not category(dict(a.tags)): return
            try: geometry = json.loads(factory.create_multipolygon(a))
            except (osmium.InvalidLocationError, RuntimeError): return
            emit(a, geometry)
    try:
        progress('Чтение OSM; подготовка координат и площадей')
        for source in input_file if isinstance(input_file,list) else [input_file]:
            with open(source,'rb') as raw:
                xml = raw.read(128).lstrip().startswith(b'<')
            cache=str(output_file)+'.node-cache'
            disk_index='sparse_file_array' in osmium.index.map_types()
            if not disk_index and Path(source).stat().st_size>256*1024*1024: raise ValueError('Для крупного OSM нужен дисковый индекс координат; возьмите меньшую выгрузку')
            try:
                Handler().apply_file(osmium.io.File(str(source), 'xml' if xml else 'pbf'), locations=True,idx=('sparse_file_array,'+cache) if disk_index else 'flex_mem')
            finally:
                if os.path.exists(cache): os.remove(cache)
        out.write(']}')
        if not count: raise ValueError('В выбранной области нет поддерживаемых объектов OSM')
        progress('Объекты OSM готовы', count, count)
    finally:
        out.close()


COLORS = {10: (0,100,0), 20: (255,187,34), 30: (255,255,76), 40: (240,150,255), 50: (250,0,0), 60: (180,180,180), 70: (240,240,240), 80: (0,100,200), 90: (0,150,160), 95: (0,207,117), 100: (250,230,160)}


def raster(input_file, output_file, boxes, lo, hi, kind, name, attribution):
    import numpy as np
    import rasterio
    from rasterio.warp import reproject, Resampling
    from rasterio.transform import from_bounds
    from PIL import Image
    from io import BytesIO
    def ranges(b,z):
        n=2**z
        def xy(lon,lat):
            tx=int((lon+180)/360*n)
            ty=int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n)
            return min(n-1,max(0,tx)), min(n-1,max(0,ty))
        x0,y1=xy(b[0],b[1]); x1,y0=xy(b[2],b[3]);return range(x0,x1+1),range(y0,y1+1)
    total=sum(len(xs)*len(ys) for z in range(lo,hi+1) for b in boxes for xs,ys in [ranges(b,z)])
    if total>100000: raise ValueError('Слишком много тайлов: предел 100 000, уменьшите район/масштабы')
    db=sqlite3.connect(output_file)
    db.executescript('create table metadata(name text,value text);create table tiles(zoom_level integer,tile_column integer,tile_row integer,tile_data blob);create unique index tile_index on tiles(zoom_level,tile_column,tile_row);')
    meta=dict(name=name, format='png', minzoom=str(lo), maxzoom=str(hi), bounds=','.join(map(str,[boxes[0][0],boxes[0][1],boxes[-1][2],boxes[0][3]])), attribution=attribution)
    if kind=='dem': meta['encoding']='mapbox'
    else: meta['landcover_legend']=json.dumps(COLORS)
    db.executemany('insert into metadata values(?,?)',meta.items())
    done=0; written=0
    with ExitStack() as stack:
        sources=[stack.enter_context(rasterio.open(f)) for f in (input_file if isinstance(input_file,list) else [input_file])]
        if any(not src.crs for src in sources): raise ValueError('У GeoTIFF нет системы координат')
        for z in range(lo,hi+1):
            for b in boxes:
                xs,ys=ranges(b,z)
                for x in xs:
                    for y in ys:
                        extent=20037508.342789244; size=2*extent/(2**z)
                        transform=from_bounds(-extent+x*size,extent-(y+1)*size,-extent+(x+1)*size,extent-y*size,256,256)
                        dest=np.full((256,256),np.nan,dtype='float32')
                        for src in sources:
                            chunk=np.full((256,256),np.nan,dtype='float32')
                            reproject(source=rasterio.band(src,1),destination=chunk,src_transform=src.transform,src_crs=src.crs,src_nodata=src.nodata,dst_transform=transform,dst_crs='EPSG:3857',dst_nodata=np.nan,resampling=Resampling.bilinear if kind=='dem' else Resampling.nearest,num_threads=1,warp_mem_limit=64)
                            np.copyto(dest,chunk,where=np.isfinite(chunk))
                        mask=np.isfinite(dest)
                        rgba=np.zeros((256,256,4),dtype='uint8')
                        if kind=='dem':
                            encoded=np.clip(np.round((np.nan_to_num(dest,nan=0)+10000)*10),0,16777215).astype('uint32')
                            rgba[:,:,0]=(encoded>>16)&255;rgba[:,:,1]=(encoded>>8)&255;rgba[:,:,2]=encoded&255;rgba[:,:,3]=mask*255
                        else:
                            for code,color in COLORS.items():
                                selected=mask & (dest==code);rgba[selected,:3]=color;rgba[selected,3]=255
                        if np.any(rgba[:,:,3]):
                            stream=BytesIO();Image.fromarray(rgba).save(stream,format='PNG')
                            db.execute('insert or replace into tiles values(?,?,?,?)',(z,x,2**z-1-y,stream.getvalue()));written+=1
                        done+=1
                        if done%10==0: progress('Рельеф' if kind=='dem' else 'Покров земли',done,total)
        if not written: raise ValueError('Нет растровых данных в выбранной области')
    db.commit();db.close();progress('Тайлы готовы',total,total)


def main():
    p=argparse.ArgumentParser()
    p.add_argument('input');p.add_argument('output');p.add_argument('--kind',choices=['osm','dem','landcover'],required=True)
    p.add_argument('--inputs-json');p.add_argument('--bbox',required=True);p.add_argument('--minzoom',type=int,default=0);p.add_argument('--maxzoom',type=int,default=12)
    p.add_argument('--name',default='Карта');p.add_argument('--attribution',default='Источник не указан')
    a=p.parse_args();b=list(map(float,a.bbox.split(',')))
    if len(b)!=4 or not all(math.isfinite(x) for x in b) or not(-180<=b[0]<=180 and -180<=b[2]<=180 and -85.05112878<=b[1]<b[3]<=85.05112878) or b[0]==b[2] or not(0<=a.minzoom<=a.maxzoom<=16): raise ValueError('Некорректная рамка или масштабы')
    boxes=[b] if b[0]<b[2] else [[b[0],b[1],180,b[3]],[-180,b[1],b[2],b[3]]]
    temporary=a.output+'.tmp'
    if os.path.exists(temporary): os.remove(temporary)
    Path(a.output).parent.mkdir(parents=True,exist_ok=True)
    try:
        inputs=json.loads(Path(a.inputs_json).read_text(encoding='utf-8')) if a.inputs_json else a.input
        if isinstance(inputs,list) and (not inputs or len(inputs)>64): raise ValueError('От 1 до 64 исходных файлов')
        if a.kind=='osm': osm(inputs,temporary,boxes)
        else: raster(inputs,temporary,boxes,a.minzoom,a.maxzoom,a.kind,a.name,a.attribution)
        os.replace(temporary,a.output)
    finally:
        if os.path.exists(temporary): os.remove(temporary)

if __name__=='__main__':
    try: main()
    except Exception as e:
        print(str(e),file=sys.stderr);sys.exit(1)
