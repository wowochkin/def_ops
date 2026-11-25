import {DatabaseSync} from 'node:sqlite';
import sharp from 'sharp';
import type {AtlasStore} from './atlas';
const codes=new Set([10,20,30,40,50,60,70,80,90,95,100]);
/** Числовой класс только по точному RGB легенды исходного MBTiles, без подбора ближайшего цвета. */
export async function atlasLandcover(store:AtlasStore,tenant:string,id:string,points:[number,number][]){
 if(!Array.isArray(points)||!points.length||points.length>626||points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>85.05112878))throw Error('До 626 точек WGS84 в пределах веб-карты');
 const meta=await store.get(tenant,id);if(meta.kind!=='raster'||!meta.thematic)throw Error('Нужен набор покрова с легендой классов');
 const db=new DatabaseSync(store.file(tenant,id),{readOnly:true});
 let legend:unknown;
 try{const row=db.prepare("select value from metadata where name='landcover_legend'").get() as {value:string}|undefined;legend=JSON.parse(row?.value??'null');}finally{db.close();}
 if(!legend||typeof legend!=='object'||Array.isArray(legend))throw Error('В наборе нет корректной легенды покрова');
 const colors=new Map<string,number>();
 for(const [code,rgb] of Object.entries(legend))if(codes.has(Number(code))&&Array.isArray(rgb)&&rgb.length===3&&rgb.every(v=>Number.isInteger(v)&&v>=0&&v<=255))colors.set(rgb.join(','),Number(code));
 const cache=new Map<string,Awaited<ReturnType<typeof decode>>>();
 async function decode(z:number,x:number,y:number){const tile=await store.tile(tenant,id,z,x,y);return tile?sharp(tile.bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true}):null;}
 const values=[];
 for(const [lon,lat] of points){
  const [w,s,e,n]=meta.bounds;
  if(lat<s||lat>n||(w<=e?(lon<w||lon>e):(lon<w&&lon>e))){values.push({lon,lat,classCode:null});continue;}
  let classCode:number|null=null;
  for(let z=meta.maxzoom;z>=meta.minzoom;z--){
   const n=2**z,tx=((lon+180)/360*n+n)%n,ty=Math.min(n-1e-9,Math.max(0,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n)),x=Math.floor(tx),y=Math.floor(ty),key=`${z}/${x}/${y}`;
   if(!cache.has(key))cache.set(key,await decode(z,x,y));const image=cache.get(key);if(!image)continue;
   const px=Math.min(image.info.width-1,Math.floor((tx-x)*image.info.width)),py=Math.min(image.info.height-1,Math.floor((ty-y)*image.info.height)),offset=(py*image.info.width+px)*4;
   // Прозрачность или неизвестный цвет существующего пикселя не заполняются грубым масштабом.
   if(image.data[offset+3]===255)classCode=colors.get([...image.data.subarray(offset,offset+3)].join(','))??null;
   break;
  }
  values.push({lon,lat,classCode});
 }
 return {source:id,values};
}
