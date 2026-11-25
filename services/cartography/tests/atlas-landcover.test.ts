import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import sharp from 'sharp';
import {AtlasStore} from '../src/atlas';
import {atlasLandcover} from '../src/atlas-landcover';
it('читает точный класс из легенды, сохраняя неизвестный цвет, прозрачность и внешнюю точку',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'landcover-'));
 try{
  const file=join(dir,'source.mbtiles'),db=new DatabaseSync(file);
  db.exec('create table metadata(name text,value text);create table tiles(zoom_level integer,tile_column integer,tile_row integer,tile_data blob)');
  const put=db.prepare('insert into metadata values(?,?)');
  for(const [k,v] of Object.entries({format:'png',minzoom:'0',maxzoom:'0',bounds:'-10,-10,10.7,10',landcover_legend:JSON.stringify({10:[0,100,0],20:[255,187,34]})}))put.run(k,v);
  const raw=Buffer.alloc(256*256*4);
  raw.set([0,100,0,255],(127*256+128)*4);
  raw.set([0,100,0,255],(127*256+135)*4);
  raw.set([1,2,3,255],(127*256+129)*4);
  const png=await sharp(raw,{raw:{width:256,height:256,channels:4}}).png().toBuffer();
  db.prepare('insert into tiles values(0,0,0,?)').run(png);db.close();
  const store=new AtlasStore(join(dir,'store')),meta=await store.importFile('t',file);
  expect(await atlasLandcover(store,'t',meta.id,[[.25,.25],[2.25,.25],[4,.25],[20,.25],[10.8,.25]])).toEqual({source:meta.id,values:[{lon:.25,lat:.25,classCode:10},{lon:2.25,lat:.25,classCode:null},{lon:4,lat:.25,classCode:null},{lon:20,lat:.25,classCode:null},{lon:10.8,lat:.25,classCode:null}]});
  await expect(atlasLandcover(store,'t',meta.id,[[0,90]])).rejects.toThrow();
 }finally{await rm(dir,{recursive:true,force:true});}
});
