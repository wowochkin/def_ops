"""Синтетические данные: проверяем координаты, классы и код высот, не только факт создания файла."""
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT=Path(__file__).with_name('convert.py')
class ConversionTest(unittest.TestCase):
 def test_raster_and_dem(self):
  import numpy as np
  import rasterio
  from rasterio.transform import from_bounds
  from PIL import Image
  from io import BytesIO
  with tempfile.TemporaryDirectory(prefix='карта ') as directory:
   d=Path(directory); source=d/'источник.tif'
   for kind,value in [('dem',123),('landcover',10)]:
    with rasterio.open(source,'w',driver='GTiff',width=64,height=64,count=1,dtype='float32',crs='EPSG:4326',transform=from_bounds(12,51,14,53,64,64),nodata=-9999) as raster: raster.write(np.full((1,64,64),value,dtype='float32'))
    output=d/(kind+'.mbtiles')
    result=subprocess.run([sys.executable,str(SCRIPT),str(source),str(output),'--kind',kind,'--bbox','12,51,14,53','--minzoom','6','--maxzoom','6'],capture_output=True,text=True)
    self.assertEqual(result.returncode,0,result.stderr)
    with sqlite3.connect(output) as db:
     data=db.execute('select tile_data from tiles limit 1').fetchone()[0]
     image=np.array(Image.open(BytesIO(data))); valid=image[:,:,3]>0; self.assertTrue(valid.any()); pixel=image[valid][0]
     if kind=='dem': self.assertAlmostEqual(-10000+(int(pixel[0])*65536+int(pixel[1])*256+int(pixel[2]))*.1,123,places=1)
     else: self.assertEqual(list(pixel[:3]),[0,100,0])
 def test_multiple_rasters(self):
  import numpy as np
  import rasterio
  from rasterio.transform import from_bounds
  from PIL import Image
  from io import BytesIO
  with tempfile.TemporaryDirectory() as directory:
   d=Path(directory);files=[]
   for index,height in enumerate([100,200]):
    f=d/(str(index)+'.tif');files.append(str(f))
    with rasterio.open(f,'w',driver='GTiff',width=64,height=64,count=1,dtype='float32',crs='EPSG:4326',transform=from_bounds(12+index,51,13+index,53,64,64),nodata=-9999) as raster:raster.write(np.full((1,64,64),height,dtype='float32'))
   manifest=d/'inputs.json';manifest.write_text(json.dumps(files));output=d/'result.mbtiles'
   result=subprocess.run([sys.executable,str(SCRIPT),files[0],str(output),'--kind','dem','--inputs-json',str(manifest),'--bbox','12,51,14,53','--minzoom','6','--maxzoom','6'],capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stderr);values=set()
   with sqlite3.connect(output) as db:
    for (blob,) in db.execute('select tile_data from tiles'):
     image=np.array(Image.open(BytesIO(blob)));valid=image[image[:,:,3]>0].astype('int64');heights=-10000+(valid[:,0]*65536+valid[:,1]*256+valid[:,2])*.1;values.update(heights.round().tolist())
   self.assertIn(100,values);self.assertIn(200,values)
 def test_osm(self):
  with tempfile.TemporaryDirectory() as directory:
   d=Path(directory); source=d/'upload-without-extension'
   source.write_text('<?xml version="1.0"?><osm version="0.6"><node id="1" lat="52" lon="13"><tag k="place" v="village"/><tag k="name" v="Тест"/></node><node id="2" lat="52.001" lon="13.001"/><way id="3"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way></osm>',encoding='utf-8')
   output=d/'result.json'
   result=subprocess.run([sys.executable,str(SCRIPT),str(source),str(output),'--kind','osm','--bbox','12,51,14,53'],capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stderr)
   data=json.loads(output.read_text(encoding='utf-8'))
   self.assertEqual({f['properties']['layer'] for f in data['features']},{'places','roads'})
if __name__=='__main__':unittest.main()
