import { parentPort, workerData } from 'node:worker_threads';
import { promises as fs, createWriteStream, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { tileCount, tileRange, type BBox } from '@def-ops/core';
import { AtlasStore, convertGeoJson, validBounds } from './atlas';
import { http, netMessage } from './net';
import { ensureAssets, OHM_DEFAULTS } from './ohm';
import type { AtlasInput } from './atlas-jobs';
const d=workerData as {root:string;work:string;tenant:string;input:AtlasInput}, input=d.input;
const abort=new AbortController();parentPort!.on('message',m=>{if(m==='cancel')abort.abort();});
const progress=(stage:string,done=0,total=0)=>parentPort!.postMessage({stage,done,total});
function allowed(url:string) {
 const u=new URL(url);const h=u.hostname;
 if(u.protocol!=='https:'||u.username||u.password||u.port||!(/^(?:download\.geofabrik\.de|(?:tiles|download)\.openfreemap\.org|(?:copernicus-dem-30m|esa-worldcover)\.s3\.[a-z0-9-]+\.amazonaws\.com)$/.test(h))) throw Error('Скачивание разрешено с официальных Geofabrik, OpenFreeMap и S3-наборов Copernicus DEM / ESA WorldCover. Другие источники импортируйте файлом.');
 return u;
}
async function request(url:string,headers:Record<string,string>={},allowMissing=false,depth=0):Promise<Response> {
 if(depth>5)throw Error('Слишком много перенаправлений источника');
 allowed(url);let r:Response|undefined;
 for(let attempt=0;attempt<4;attempt++) {
  abort.signal.throwIfAborted();
  try {
   r=await http.fetch(url,{headers:{'User-Agent':'DefOps-Atlas/1.0 (offline regional geography)',...headers},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(3600000)]),redirect:'manual'});
   if(![429,500,502,503,504].includes(r.status)||attempt===3)break;
   await r.body?.cancel();
  } catch(e) { if(abort.signal.aborted)throw e;if(attempt===3)throw Error(`Источник ${new URL(url).hostname}: ${netMessage(e)}`); }
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{abort.signal.removeEventListener('abort',cancel);resolve();},500*2**attempt);const cancel=()=>{clearTimeout(timer);reject(Error('Загрузка отменена'));};abort.signal.addEventListener('abort',cancel,{once:true});});
 }
 if(!r)throw Error('Не удалось получить ответ источника');
 if([301,302,303,307,308].includes(r.status)){const location=r.headers.get('location');if(!location)throw Error('Пустое перенаправление');await r.body?.cancel();return request(new URL(location,url).href,headers,allowMissing,depth+1);}
 if(allowMissing&&r.status===404)return r;
 if(!r.ok)throw Error(`Источник ответил ${r.status}`);return r;
}
async function download(url:string,file:string) {
 const part=file+'.part',tagFile=part+'.etag';let offset=(await fs.stat(part).catch(()=>({size:0}))).size;
 const etag=await fs.readFile(tagFile,'utf8').catch(()=>'');
 if(!etag)offset=0;
 let r=await request(url,offset?{Range:`bytes=${offset}-`,'If-Range':etag}:{});
 if(r.status!==206)offset=0;
 else if(!r.headers.get('content-range')?.startsWith(`bytes ${offset}-`))throw Error('Источник вернул неправильный диапазон файла');
 const bytes=Number(r.headers.get('content-length')||0),max=Number(process.env.ATLAS_MAX_DOWNLOAD_GB||20)*1024**3;
 if(!r.body||bytes+offset>max)throw Error('Файл превышает установленный предел загрузки');
 const disk=await fs.statfs(d.work);if(bytes&&Number(disk.bavail)*Number(disk.bsize)<bytes*2+128*1024**2)throw Error('Недостаточно места для загрузки и установки карты');
 const newTag=r.headers.get('etag');if(newTag)await fs.writeFile(tagFile,newTag);else await fs.rm(tagFile,{force:true});
 let done=offset,last=0;
 const monitor=new Transform({transform(chunk:Buffer,_e,cb){done+=chunk.length;if(done>max)return cb(Error('Превышен предел размера загрузки'));if(Date.now()-last>250){progress('Скачивание',done,offset+bytes);last=Date.now();}cb(null,chunk);}});
 await pipeline(Readable.fromWeb(r.body as Parameters<typeof Readable.fromWeb>[0]),monitor,createWriteStream(part,{flags:offset?'a':'w'}),{signal:abort.signal});
 if(bytes&&done!==offset+bytes)throw Error('Файл скачан не полностью');
 await fs.rename(part,file);return file;
}
async function python(file:string,out:string,files?:string[]) {
 const source=import.meta.url.endsWith('.ts')?fileURLToPath(new URL('../tools/convert.py',import.meta.url)):fileURLToPath(new URL('../gis/convert.py',import.meta.url));
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const local=path.join(root,process.platform==='win32'?'.venv-gis312/Scripts/python.exe':'.venv-gis312/bin/python');
 const executable=process.env.GIS_PYTHON||await fs.access(local).then(()=>local).catch(()=>process.platform==='win32'?'python.exe':'python3');
 const bootstrap="import os,sys,runpy; addons=os.environ.get('GIS_ADDONS'); sys.path.insert(0,addons) if addons else None; sys.argv=sys.argv[1:];runpy.run_path(sys.argv[0],run_name='__main__')";
 const args=['-u','-c',bootstrap,source,file,out,'--kind',input.kind,'--bbox',input.options.bounds.join(','),'--minzoom',String(input.options.minzoom),'--maxzoom',String(input.options.maxzoom),'--name',input.options.name,'--attribution',input.options.attribution];
 if(files&&files.length>1){const manifest=path.join(d.work,'input-files.json');await fs.writeFile(manifest,JSON.stringify(files));args.push('--inputs-json',manifest);}
 await new Promise<void>((resolve,reject)=>{
  const env={...process.env,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',...(process.env.GIS_ADDONS?{PYTHONPATH:process.env.GIS_ADDONS+(process.env.PYTHONPATH?path.delimiter+process.env.PYTHONPATH:'')}:{})};
  const p=spawn(executable,args,{env,signal:abort.signal,windowsHide:true});let err='',buffer='';
  p.stdout.on('data',b=>{buffer+=b.toString();let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const m=JSON.parse(line);progress(m.stage,m.done,m.total);}catch{/* не строка прогресса */}}});
  p.stderr.on('data',b=>{err=(err+b.toString()).slice(-3000);});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error(`Не удалось подготовить геоданные: ${err||`код ${code}`}. Проверьте GIS-runtime в настройках модуля.`)));
 });
}
async function smallArea(out:string) {
 const o=input.options;validBounds(o.bounds);
 const boxes:BBox[]=o.bounds[0]>o.bounds[2]?[[o.bounds[0],o.bounds[1],180,o.bounds[3]],[-180,o.bounds[1],o.bounds[2],o.bounds[3]]]:[o.bounds];
 const total=boxes.reduce((n,b)=>n+tileCount(b,o.minzoom,o.maxzoom),0);
 const cache=path.join(d.work,'source-tiles.mbtiles'),db=new DatabaseSync(cache);let done=0;
 try {
  db.exec('create table if not exists metadata(name text primary key,value text);create table if not exists tiles(zoom_level integer,tile_column integer,tile_row integer,tile_data blob);create unique index if not exists tile_index on tiles(zoom_level,tile_column,tile_row)');
  const previous=db.prepare("select value from metadata where name='source_tilejson'").get() as {value:string}|undefined;
  const info=previous?JSON.parse(previous.value):await (await request('https://tiles.openfreemap.org/planet')).json() as {tiles:string[];vector_layers:unknown[];maxzoom:number};
  if(!info.tiles?.[0]||!Array.isArray(info.vector_layers))throw Error('Не получено описание OpenFreeMap');
  if(o.maxzoom>info.maxzoom)throw Error(`Максимальный масштаб источника: ${info.maxzoom}`);
  const meta={name:o.name,format:'pbf',bounds:o.bounds.join(','),minzoom:String(o.minzoom),maxzoom:String(o.maxzoom),attribution:'© OpenMapTiles © OpenStreetMap contributors; ODbL',json:JSON.stringify({vector_layers:info.vector_layers}),source_tilejson:JSON.stringify(info)};
  const putMeta=db.prepare('insert or replace into metadata values(?,?)');for(const [k,v]of Object.entries(meta))putMeta.run(k,v);
  const cached=db.prepare('select 1 from tiles where zoom_level=? and tile_column=? and tile_row=?');
 const put=db.prepare('insert or replace into tiles values(?,?,?,?)');
  for(let z=o.minzoom;z<=o.maxzoom;z++)for(const b of boxes){const r=tileRange(b,z);for(let x=r.x0;x<=r.x1;x++)for(let y=r.y0;y<=r.y1;y++){
   abort.signal.throwIfAborted();if(cached.get(z,x,2**z-1-y)){progress('Тайлы OpenFreeMap · локальный кэш',++done,total);continue;}const url=info.tiles[0].replace('{z}',String(z)).replace('{x}',String(x)).replace('{y}',String(y));
   const response=await request(url,{},true);if(response.status===404){put.run(z,x,2**z-1-y,Buffer.alloc(0));progress('Тайлы OpenFreeMap',++done,total);continue;}const tile=Buffer.from(await response.arrayBuffer());
   if(tile.length)put.run(z,x,2**z-1-y,tile);progress('Тайлы OpenFreeMap',++done,total);
  }}
 } finally {db.close();}
 await fs.copyFile(cache,out);
}
async function run() {
 await fs.mkdir(d.work,{recursive:true});const result=path.join(d.work,'result.mbtiles');await fs.rm(result,{force:true});await fs.rm(result+'.tmp',{force:true});let file=input.file;
 if(!['mbtiles','geojson','osm','dem','landcover','openfreemap'].includes(input.kind))throw Error('Неизвестный формат');
 validBounds(input.options.bounds);if(!Number.isInteger(input.options.minzoom)||!Number.isInteger(input.options.maxzoom)||input.options.minzoom<0||input.options.maxzoom>16||input.options.minzoom>input.options.maxzoom)throw Error('Масштабы подготовки 0–16');
 if(input.url){file=path.join(d.work,input.kind==='osm'?'source.osm.pbf':input.kind==='dem'||input.kind==='landcover'?'source.tif':'source.mbtiles');await download(input.url,file);}
 const inputs:string[]=[];
 if(input.urls){
  if(!['osm','dem','landcover'].includes(input.kind)||!Array.isArray(input.urls)||!input.urls.length||input.urls.length>64)throw Error('Недопустимый набор исходников');
  let size=0;for(const [i,url]of [...new Set(input.urls)].entries()){const item=path.join(d.work,`source-${i}.${input.kind==='osm'?'osm.pbf':'tif'}`);progress(`Исходный файл ${i+1} из ${input.urls.length}`);if(!await fs.access(item).then(()=>true,()=>false))await download(url,item);size+=(await fs.stat(item)).size;if(size>Number(process.env.ATLAS_MAX_DOWNLOAD_GB||20)*1024**3)throw Error('Суммарный размер исходников превышает предел');inputs.push(item);}file=inputs[0];
 }
 if(input.expectedSha256){if(!file||!/^[a-f0-9]{64}$/i.test(input.expectedSha256))throw Error('Неверная контрольная сумма');const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);if(h.digest('hex')!==input.expectedSha256.toLowerCase())throw Error('Контрольная сумма источника не совпала');}
 if(input.kind==='openfreemap')await smallArea(result);
 else if(!file)throw Error('Нет исходного файла');
 else if(input.kind==='mbtiles')await fs.copyFile(file,result);
 else if(input.kind==='geojson'||input.kind==='osm') {
  let geo=file;if(input.kind==='osm'){geo=path.join(d.work,'source.geojson');await python(file,geo,inputs);}
  if((await fs.stat(geo)).size>512*1024*1024)throw Error('GeoJSON больше 512 МБ; уменьшите область');
  await convertGeoJson(JSON.parse(await fs.readFile(geo,'utf8')),result,input.options,(done,total)=>progress('Векторные тайлы',done,total));
 } else await python(file,result,inputs);
 abort.signal.throwIfAborted();progress('Проверка и установка');
 const store=new AtlasStore(d.root);const meta=await store.importFile(d.tenant,result,input.urls?.join(' · ')??input.url??'Локальный импорт');
 progress('Подготовка локальных шрифтов');
 // Шрифты не являются условием сохранности карты: ошибка явно отражается в результате.
 let warning='';try{await ensureAssets(path.join(path.dirname(d.root),'.ohm-assets'),OHM_DEFAULTS,abort.signal);}catch(e){warning=`. Геометрия готова; шрифты не скачаны: ${(e as Error).message}`;}
 parentPort!.postMessage({state:'done',result:meta,stage:'Готово'+warning,done:1,total:1});
 await fs.rm(result,{force:true});if(input.file)await fs.rm(input.file,{force:true});
 if(input.url && file)await fs.rm(file,{force:true});for(const item of inputs)await fs.rm(item,{force:true});
 await fs.rm(path.join(d.work,'source.geojson'),{force:true});
}
run().catch(e=>parentPort!.postMessage({state:abort.signal.aborted?'cancelled':'error',stage:'Операция остановлена',error:(e as Error).message})).finally(()=>parentPort!.close());
