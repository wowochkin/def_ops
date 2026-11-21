/** Подбор официальных исходников по охвату, без скачивания самих карт. */
import {validBounds} from './atlas';
import {http,netMessage} from './net';
import type {BBox} from '@def-ops/core';
export interface SourceFile {name:string;url:string;bytes?:number}
const split=(b:BBox):BBox[]=>b[0]>b[2]?[[b[0],b[1],180,b[3]],[-180,b[1],b[2],b[3]]]:[b];
function lat(n:number){return `${n<0?'S':'N'}${String(Math.abs(n)).padStart(2,'0')}`;}
function lon(n:number){return `${n<0?'W':'E'}${String(Math.abs(n)).padStart(3,'0')}`;}
export function rasterSources(kind:'dem'|'landcover',bounds:BBox):SourceFile[]{
 validBounds(bounds);const files=new Map<string,SourceFile>(),step=kind==='dem'?1:3;
 for(const b of split(bounds))for(let y=Math.floor(b[1]/step)*step;y<b[3];y+=step)for(let x=Math.floor(b[0]/step)*step;x<b[2];x+=step){
  const name=kind==='dem'?`Copernicus_DSM_COG_10_${lat(y)}_00_${lon(x)}_00_DEM`:`ESA_WorldCover_10m_2021_v200_${lat(y)}${lon(x)}_Map`;
  files.set(name,{name,url:kind==='dem'?`https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/${name}/${name}.tif`:`https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/${name}.tif`});
  if(files.size>64)throw Error('Область содержит более 64 листов. Разбейте её на части.');
 }return [...files.values()];
}
interface Extract {properties:{id:string;name:string;urls?:{pbf?:string}};geometry:{type:string;coordinates:number[][][]|number[][][][]}}
function inside(p:number[],ring:number[][]){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function contains(poly:number[][][],b:BBox){
 const corners=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]];
 if(!corners.every(p=>inside(p,poly[0])&&!poly.slice(1).some(h=>inside(p,h))))return false;
 const cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 for(const ring of poly)for(let i=1;i<ring.length;i++){
  const a=ring[i-1],d=ring[i];if(a[0]>b[0]&&a[0]<b[2]&&a[1]>b[1]&&a[1]<b[3])return false;
  for(let j=0;j<4;j++){const c=corners[j],e=corners[(j+1)%4];if(cross(a,d,c)*cross(a,d,e)<0&&cross(c,e,a)*cross(c,e,d)<0)return false;}
 }return true;
}
export function chooseExtracts(index:{features:Extract[]},bounds:BBox):SourceFile[]{
 validBounds(bounds);const chosen=new Map<string,SourceFile>();
 for(const b of split(bounds)){
  const matches=index.features.flatMap(f=>{
   const url=f.properties.urls?.pbf;if(!url)return[];const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates as number[][][]]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates as number[][][][]:[];
   if(!polys.some(p=>contains(p,b)))return[];
   const all=polys.flat(2),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);let loX=Infinity,hiX=-Infinity,loY=Infinity,hiY=-Infinity;for(let i=0;i<xs.length;i++){loX=Math.min(loX,xs[i]);hiX=Math.max(hiX,xs[i]);loY=Math.min(loY,ys[i]);hiY=Math.max(hiY,ys[i]);}
   return[{file:{name:f.properties.name,url},size:(hiX-loX)*(hiY-loY)}];
  }).sort((a,b)=>a.size-b.size);
  if(!matches.length)throw Error('Нет одной региональной выгрузки Geofabrik, целиком покрывающей область. Выберите меньшую область или используйте импорт.');
  chosen.set(matches[0].file.url,matches[0].file);
 }return [...chosen.values()];
}
async function sourceRequest(url:string,method:string,signal:AbortSignal,depth=0):Promise<Response>{
 const stage=method==='HEAD'?'Проверка исходного файла':'Чтение каталога';
 const host=new URL(url).hostname;
 const failed=(reason:string)=>new Error(`${stage} (${host}): ${reason}`);
 if(depth>5)throw failed('слишком много перенаправлений');
 for(let attempt=0;;attempt++){
  const timeout=AbortSignal.timeout(30000);
  let response:Response;
  try{
   response=await http.fetch(url,{method,signal:AbortSignal.any([signal,timeout]),redirect:'manual',headers:{'User-Agent':'DefOps-Atlas/1.0 (regional offline import)'}});
  }catch(error){
   if(signal.aborted||attempt===2){
    if(signal.aborted||timeout.aborted)throw failed('истекло время ожидания ответа');
    throw failed(netMessage(error));
   }
   await new Promise(r=>setTimeout(r,500*2**attempt));
   continue;
  }
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('location');
   await response.body?.cancel();
   if(!location)throw failed('сервер вернул перенаправление без адреса');
   let next:URL;
   try{next=new URL(location,url);}catch{throw failed('сервер вернул некорректный адрес перенаправления');}
   if(next.protocol!=='https:'||next.hostname!==host)throw failed('сервер перенаправил запрос на адрес вне разрешённого источника');
   return sourceRequest(next.href,method,signal,depth+1);
  }
  if(![429,500,502,503,504].includes(response.status)||attempt===2)return response;
  await response.body?.cancel();
  await new Promise(r=>setTimeout(r,500*2**attempt));
 }
}
let cached:{at:number;data:{features:Extract[]}}|undefined;
export async function resolveSources(kind:'osm'|'dem'|'landcover',bounds:BBox){
 validBounds(bounds);const signal=AbortSignal.timeout(90000);let files:SourceFile[];
 if(kind==='osm'){
  if(!cached||Date.now()-cached.at>86400000){const r=await sourceRequest('https://download.geofabrik.de/index-v1.json','GET',signal);if(!r.ok)throw Error(`Индекс Geofabrik недоступен (${r.status})`);const data=await r.json() as {features:Extract[]};if(!Array.isArray(data.features))throw Error('Некорректный индекс источников');cached={at:Date.now(),data};}
  files=chooseExtracts(cached.data,bounds);
 }else if(kind==='dem'||kind==='landcover')files=rasterSources(kind,bounds);else throw Error('Автоподбор доступен для OSM, DEM и WorldCover');
 const available:SourceFile[]=[],missing:string[]=[];
 for(let offset=0;offset<files.length;offset+=4)await Promise.all(files.slice(offset,offset+4).map(async f=>{
  const u=new URL(f.url);if(u.protocol!=='https:'||!['download.geofabrik.de','copernicus-dem-30m.s3.eu-central-1.amazonaws.com','esa-worldcover.s3.eu-central-1.amazonaws.com'].includes(u.hostname))throw Error('Каталог вернул непредусмотренный адрес');
  const r=await sourceRequest(u.href,'HEAD',signal);if(r.status===404){missing.push(f.name);return;}if(!r.ok)throw Error(`Файл источника недоступен (${r.status})`);available.push({...f,url:r.url||f.url,bytes:Number(r.headers.get('content-length'))||undefined});
 }));
 if(!available.length)throw Error('Источник не содержит данных для выбранной области');
 return {files:available,missing,bytes:available.reduce((n,f)=>n+(f.bytes??0),0),note:kind==='osm'?'Geofabrik отдаёт целую региональную выгрузку, которая может быть значительно больше выбранной области. В тайлы попадёт только выбранная область.':'Скачиваются исходные листы целиком; затем из них готовится выбранная область.'};
}
