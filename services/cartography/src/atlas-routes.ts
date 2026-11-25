import path from 'node:path';
import { promises as fs, createWriteStream, createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { Router, HttpError, reply, onShutdown } from '@def-ops/service-kit';
import {atlasLandcover} from './atlas-landcover';
import {atlasElevations} from './atlas-elevation';
import {resolveSources} from './atlas-sources';
import { AtlasStore, atlasStyle, validBounds, type ConvertOptions } from './atlas';
import { AtlasJobs, type AtlasInput } from './atlas-jobs';
import { deleteAtlasRegion, type DeleteAtlasItem } from './atlas-region-delete';
import { type TileStore } from './tiles';
import { ensureAssets, ohmAssetsDir, OHM_DEFAULTS } from './ohm';
const sources=[
 {id:'openfreemap',name:'OpenFreeMap — готовые векторные тайлы',url:'https://openfreemap.org/',license:'OpenStreetMap ODbL; OpenMapTiles attribution',detail:'Небольшая область: до 3000 тайлов и 50 МБ; большие пакеты — импорт MBTiles.'},
 {id:'geofabrik',name:'Geofabrik — региональные OSM PBF',url:'https://download.geofabrik.de/',license:'OpenStreetMap ODbL',detail:'Исходные объекты; преобразование выполняется локально.'},
 {id:'dem',name:'Copernicus DEM GLO-30',url:'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM',license:'Copernicus DEM license',detail:'GeoTIFF высот; модель поверхности, включая часть сооружений и растительности.'},
 {id:'landcover',name:'ESA WorldCover',url:'https://esa-worldcover.org/en/data-access',license:'CC BY 4.0',detail:'GeoTIFF классов покрова, продукт 2020/2021; не текущая растительность.'},
];
function options(o:ConvertOptions) {
 validBounds(o.bounds);if(!Number.isInteger(o.minzoom)||!Number.isInteger(o.maxzoom)||o.minzoom<0||o.maxzoom>16||o.minzoom>o.maxzoom||typeof o.name!=='string'||!o.name.trim()||o.name.length>200||typeof o.attribution!=='string'||o.attribution.length>2000)throw new HttpError(422,'invalid','Проверьте название, источник, рамку и масштабы 0–16');return o;
}
export function addAtlasRoutes(r:Router,tiles:TileStore,prefix:(c:import('@def-ops/service-kit').Ctx)=>string) {
 const store=new AtlasStore(path.join(tiles.root,'.atlas')),jobs=new AtlasJobs(path.join(tiles.root,'.atlas-jobs'),store.root);
 onShutdown(async () => jobs.stop());
 r.post('/cartography/atlas/resolve',async c=>{const b=await c.json<{kind:'osm'|'dem'|'landcover';bounds:import('@def-ops/core').BBox;minzoom?:number}>();return resolveSources(b.kind,b.bounds,b.minzoom);});
 r.get('/cartography/atlas/sources',()=>sources);
 r.get('/cartography/atlas/jobs',c=>jobs.list(c.tenant));
 r.delete('/cartography/atlas/jobs',c=>jobs.pruneFinished(c.tenant));
 r.post('/cartography/atlas/jobs/:id/cancel',c=>jobs.cancel(c.tenant,c.params.id));
 r.post('/cartography/atlas/jobs/:id/resume',async c=>{const job=(await jobs.list(c.tenant)).find(j=>j.id===c.params.id);if(!job||job.state==='running'||job.state==='done')throw new HttpError(422,'invalid','Задание нельзя продолжить');return jobs.start(c.tenant,job.input,job.id);});
 r.get('/cartography/atlas/runtime',async()=>{
  const root=fileURLToPath(new URL('../../../',import.meta.url));const local=path.join(root,process.platform==='win32'?'.venv-gis312/Scripts/python.exe':'.venv-gis312/bin/python');
  const python=process.env.GIS_PYTHON||await fs.access(local).then(()=>local).catch(()=>process.platform==='win32'?'python.exe':'python3');
  return new Promise(resolve=>{
   const p=spawn(python,['-c',"import os,sys; a=os.environ.get('GIS_ADDONS'); sys.path.insert(0,a) if a else None; import rasterio, osmium, PIL; print(rasterio.__version__)"],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1',...(process.env.GIS_ADDONS?{PYTHONPATH:process.env.GIS_ADDONS}:{})}});let error='';let completed=false;
   const finish=(ok:boolean)=>{if(completed)return;completed=true;clearTimeout(timer);resolve({ok,python,error:ok?undefined:error||'GIS-runtime не готов. Выполните npm run gis:prepare на машине сборки.',formats:['mbtiles','geojson',...(ok?['osm','dem','landcover']:[])]});};
   const timer=setTimeout(()=>{error='Проверка GIS-runtime превысила 20 секунд';p.kill();finish(false);},20000);p.stderr.on('data',d=>error=(error+d.toString()).slice(-1000));p.on('error',e=>{error=e.message;finish(false);});p.on('close',code=>finish(code===0));
  });
 });
 r.post('/cartography/atlas/fonts',async()=>ensureAssets(ohmAssetsDir(tiles),OHM_DEFAULTS));
 r.get('/cartography/atlas',c=>store.list(c.tenant));
 r.post('/cartography/atlas/download',async c=>{
  const input=await c.json<AtlasInput>();options(input.options);if(input.file)throw new HttpError(422,'invalid','Серверные пути не принимаются');
  return reply(202,await jobs.start(c.tenant,input));
 });
 r.post('/cartography/atlas/import',async c=>{
  const kind=c.query.get('kind') as AtlasInput['kind'];if(!['mbtiles','geojson','osm','dem','landcover'].includes(kind))throw new HttpError(422,'invalid','Выберите формат импорта');
  const o=options(JSON.parse(c.query.get('options')??'{}'));
  const upload=path.join(tiles.root,'.atlas-uploads');await fs.mkdir(upload,{recursive:true});const file=path.join(upload,randomUUID());
  const max=Number(process.env.ATLAS_MAX_DOWNLOAD_GB||20)*1024**3,length=Number(c.req.headers['content-length']||0);
  if(length>max)throw new HttpError(413,'too_large','Файл превышает предел импорта');
  const disk=await fs.statfs(upload);if(length&&Number(disk.bavail)*Number(disk.bsize)<length*3+128*1024**2)throw new HttpError(422,'disk_full','Недостаточно места для временного файла и карты');
  let size=0;
  try {
   await pipeline(c.req,new Transform({transform(chunk:Buffer,_enc,cb){size+=chunk.length;cb(size>max?Error('Превышен предел импорта'):null,chunk);}}),createWriteStream(file));
   return reply(202,await jobs.start(c.tenant,{kind,file,options:o}));
  }catch(e){await fs.rm(file,{force:true});throw e;}
 });
 r.post('/cartography/atlas/regions/delete',async c=>{
  const body=await c.json<{items?:DeleteAtlasItem[]}>();
  if(!body||!Array.isArray(body.items)||!body.items.length||body.items.length>256||body.items.some(item=>!item||typeof item.id!=='string'||!/^[a-f0-9]{64}$/i.test(item.sha256)))throw new HttpError(422,'invalid_region_delete','Укажите от 1 до 256 наборов с идентификаторами и SHA-256');
  if(new Set(body.items.map(item=>item.id)).size!==body.items.length)throw new HttpError(422,'duplicate_region_maps','Повтор идентификатора набора в одной операции');
  return deleteAtlasRegion(store,jobs,c.tenant,body.items);
 });
 r.post('/cartography/atlas/:id/landcover',async c=>atlasLandcover(store,c.tenant,c.params.id,(await c.json<{points:[number,number][]}>()).points));
 r.post('/cartography/atlas/:id/elevations',async c=>atlasElevations(store,c.tenant,c.params.id,(await c.json<{points:[number,number][]}>()).points));
 r.get('/cartography/atlas/:id/style',async c=>atlasStyle(await store.get(c.tenant,c.params.id),prefix(c),c.query.get('coverage')==='xyz'?'xyz':'bounds'));
 r.get('/cartography/atlas/:id/export',async c=>{await store.get(c.tenant,c.params.id);const file=store.file(c.tenant,c.params.id),st=await fs.stat(file);c.res.writeHead(200,{'content-type':'application/octet-stream','content-length':String(st.size),'content-disposition':'attachment; filename="atlas.mbtiles"'});await pipeline(createReadStream(file),c.res);});
 r.get('/cartography/atlas/:id/tiles/:z/:x/:y',async c=>{
  const t=await store.tile(c.tenant,c.params.id,Number(c.params.z),Number(c.params.x),Number(c.params.y),c.query.get('coverage')==='xyz'?'xyz':'bounds');if(!t)return reply(204,null);
  const headers:Record<string,string>={'content-type':t.format==='pbf'?'application/vnd.mapbox-vector-tile':`image/${t.format==='jpg'?'jpeg':t.format}`,'cache-control':'private, max-age=86400'};
  if(t.format==='pbf'&&t.bytes[0]===0x1f&&t.bytes[1]===0x8b)headers['content-encoding']='gzip';return reply(200,t.bytes,headers);
 });
 r.delete('/cartography/atlas/:id',async c=>{
  const current=await store.get(c.tenant,c.params.id);
  const related=await jobs.pruneForMap(c.tenant,c.params.id,current.bounds);
  if(related.running)throw new HttpError(422,'atlas_preparation_running','Сначала дождитесь завершения или отмените подготовку набора');
  await jobs.removeTileCache(c.tenant,c.params.id);await store.remove(c.tenant,c.params.id);return {ok:true};
 });
 return jobs;
}
