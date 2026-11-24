import { it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtlasStore, inspectAtlas, atlasStyle, convertGeoJson } from '../src/atlas';
it('произвольные векторные слои, XYZ/TMS, сохранение, повреждённый импорт', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'atlas-'));
 try {
  const file = join(dir, 'a.mbtiles'), db = new DatabaseSync(file);
  db.exec('create table metadata(name text,value text); create table tiles(zoom_level integer,tile_column integer,tile_row integer,tile_data blob)');
  const ins = db.prepare('insert into metadata values (?,?)');
  for (const [k,v] of Object.entries({name:'Карта',format:'pbf',minzoom:'1',maxzoom:'2',bounds:'12,51,14,53',attribution:'OSM',json:JSON.stringify({ vector_layers:[{id:'transportation'},{id:'water'},{id:'places'}] })})) ins.run(k,v);
  db.prepare('insert into tiles values(1,1,0,?)').run(Buffer.from([1,2,3])); db.close();
  expect(inspectAtlas(file).layers.map(l=>l.id)).toEqual(['transportation','water','places']);
  const store = new AtlasStore(join(dir,'catalog'));
  const a = await store.importFile('t',file);
  expect((await store.tile('t',a.id,1,1,1))?.bytes).toEqual(Buffer.from([1,2,3]));
  expect(await store.tile('t',a.id,1,1,0)).toBeNull();
  expect(await new AtlasStore(store.root).list('t')).toHaveLength(1);
  expect(await store.list('other')).toEqual([]);
  const style = atlasStyle(a, '/api');
  expect(JSON.stringify(style)).not.toContain('https://');
  expect(style.layers.some(l=>l.type==='symbol')).toBe(true);
  await writeFile(join(dir,'bad'), 'invalid'); await expect(store.importFile('t',join(dir,'bad'))).rejects.toThrow();
  expect(await store.list('t')).toHaveLength(1);
  await expect(store.tile('t','../bad',0,0,0)).rejects.toThrow();
 } finally { await rm(dir,{recursive:true,force:true}); }
});
it.each(['vector','raster','terrain'] as const)('стиль набора %s сохраняет точную рамку области', kind => {
 const meta:Parameters<typeof atlasStyle>[0]={id:'area',name:'Область',format:kind==='vector'?'pbf':'png',kind,minzoom:0,maxzoom:0,bounds:[12,51,14,53],attribution:'test',layers:[],bytes:1};
 expect(atlasStyle(meta,'/api').sources.atlas).toMatchObject({bounds:meta.bounds});
});

it('существующий растровый MBTiles обрезается по точной рамке, включая крайние тайлы', async () => {
 const sharp=(await import('sharp')).default;
 const dir=await mkdtemp(join(tmpdir(),'atlas-clipped-'));
 try {
  const file=join(dir,'input.mbtiles'),db=new DatabaseSync(file);
  db.exec('create table metadata(name text,value text);create table tiles(zoom_level integer,tile_column integer,tile_row integer,tile_data blob)');
  const insert=db.prepare('insert into metadata values(?,?)');
  for(const [k,v]of Object.entries({name:'Область',format:'png',minzoom:'0',maxzoom:'0',bounds:'12,51,14,53',attribution:'test'}))insert.run(k,v);
  const red=await sharp({create:{width:256,height:256,channels:4,background:{r:255,g:0,b:0,alpha:1}}}).png().toBuffer();
  db.prepare('insert into tiles values(0,0,0,?)').run(red);db.close();
  const store=new AtlasStore(join(dir,'store')),meta=await store.importFile('t',file),tile=await store.tile('t',meta.id,0,0,0);
  expect(tile).not.toBeNull();
  const {data,info}=await sharp(tile!.bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const alpha=(lon:number,lat:number)=>{
   const x=Math.floor((lon+180)/360*info.width),y=Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*info.height);
   return data[(y*info.width+x)*4+3];
  };
  expect(alpha(13,52)).toBe(255);
  expect(alpha(-13,52)).toBe(0);
  expect(alpha(13,20)).toBe(0);
 } finally {await rm(dir,{recursive:true,force:true});}
});

it('GeoJSON превращается в настоящие MVT с независимыми слоями', async () => {
 const dir=await mkdtemp(join(tmpdir(),'atlas-geo-'));
 try {
  const file=join(dir,'geo.mbtiles');
  await convertGeoJson({ type:'FeatureCollection',features:[{type:'Feature',properties:{layer:'buildings',name:'Дом'},geometry:{type:'Polygon',coordinates:[[[13,52],[13.001,52],[13.001,52.001],[13,52.001],[13,52]]]}}]},file,{bounds:[12.99,51.99,13.01,52.01],minzoom:10,maxzoom:12,name:'Тест',attribution:'собственные данные'},()=>{});
  expect(inspectAtlas(file).layers[0].id).toBe('buildings');
  const db=new DatabaseSync(file,{readOnly:true}); expect(Number((db.prepare('select count(*) n from tiles').get() as {n:number}).n)).toBeGreaterThan(0); db.close();
 } finally {await rm(dir,{recursive:true,force:true});}
});

it('прерванное задание можно повторить; завершение не теряется при чтении статуса', async()=>{
 const { AtlasJobs }=await import('../src/atlas-jobs');
 const { OHM_FONTS,OHM_RANGES,OHM_SPRITES }=await import('../src/ohm');
 const { mkdir }=await import('node:fs/promises');
 const dir=await mkdtemp(join(tmpdir(),'atlas-jobs-'));
 try {
  // Локальные фикстуры файлов ресурсов исключают сеть из теста lifecycle.
  for(const font of OHM_FONTS)for(const range of OHM_RANGES){const p=join(dir,'.ohm-assets/fonts',font);await mkdir(p,{recursive:true});await writeFile(join(p,range+'.pbf'),'fixture');}
  await mkdir(join(dir,'.ohm-assets/sprites'),{recursive:true});for(const name of OHM_SPRITES)await writeFile(join(dir,'.ohm-assets/sprites',name),'fixture');
  const file=join(dir,'input.json');await writeFile(file,JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{layer:'places',name:'Тест'},geometry:{type:'Point',coordinates:[13,52]}}]}));
  const jobs=new AtlasJobs(join(dir,'jobs'),join(dir,'.atlas'));
  const options={bounds:[12.9,51.9,13.1,52.1] as [number,number,number,number],minzoom:8,maxzoom:9,name:'Тест',attribution:'test'};
  const job=await jobs.start('t',{kind:'geojson',file,options});
  await jobs.cancel('t',job.id);
  await new Promise(r=>setTimeout(r,1700));
  await jobs.start('t',{kind:'geojson',file,options},job.id);
  let state='running';
  for(let i=0;i<100&&state==='running';i++){await new Promise(r=>setTimeout(r,50));state=(await jobs.list('t'))[0].state;}
  expect(state).toBe('done');
  await new Promise(r=>setTimeout(r,100));expect((await jobs.list('t'))[0].state).toBe('done');
  const bad=await jobs.start('t',{kind:'mbtiles',url:'http://127.0.0.1/private',options});
  for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,50));const j=(await jobs.list('t')).find(j=>j.id===bad.id)!;if(j.state!=='running'){expect(j.state).toBe('error');expect(j.error).toContain('Скачивание разрешено');break;}if(i===99)throw Error('Задание не завершилось');}
  jobs.stop();
 }finally{await rm(dir,{recursive:true,force:true});}
},15000);
it('читает числовую высоту из Terrain-RGB, не из отмывки',async()=>{
 const sharp=(await import('sharp')).default;const {atlasElevations}=await import('../src/atlas-elevation');
 const dir=await mkdtemp(join(tmpdir(),'height-'));try{const input=join(dir,'h.mbtiles'),db=new DatabaseSync(input);db.exec('create table metadata(name text,value text);create table tiles(zoom_level integer,tile_column integer,tile_row integer,tile_data blob)');const insert=db.prepare('insert into metadata values(?,?)');for(const [k,v]of Object.entries({format:'png',encoding:'mapbox',minzoom:'0',maxzoom:'0'}))insert.run(k,v);const value=Math.round((123+10000)*10);const png=await sharp({create:{width:256,height:256,channels:4,background:{r:value>>16&255,g:value>>8&255,b:value&255,alpha:1}}}).png().toBuffer();db.prepare('insert into tiles values(0,0,0,?)').run(png);db.close();const store=new AtlasStore(join(dir,'store'));const meta=await store.importFile('t',input);expect((await atlasElevations(store,'t',meta.id,[[13,52]])).values[0].elevationM).toBeCloseTo(123,1);}finally{await rm(dir,{recursive:true,force:true});}
});
