import sharp from 'sharp';
import {AtlasStore} from './atlas';
/** Точечное чтение числовой высоты из локального Terrain-RGB. Не по яркости отмывки. */
export async function atlasElevations(store:AtlasStore,tenant:string,id:string,points:[number,number][]){
 if(!Array.isArray(points)||!points.length||points.length>626||points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>85.05112878))throw Error('До 626 точек WGS84 в пределах веб-карты');
 const meta=await store.get(tenant,id);if(meta.kind!=='terrain')throw Error('Нужен числовой набор Terrain-RGB, а не обычная растровая карта');
 const cache=new Map<string,Awaited<ReturnType<typeof decode>>|null>();
 async function decode(z:number,x:number,y:number){const tile=await store.tile(tenant,id,z,x,y);return tile?sharp(tile.bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true}):null;}
 const values=[];
 for(const [lon,lat]of points){let height:number|null=null;
  for(let z=meta.maxzoom;z>=meta.minzoom;z--){const n=2**z,tx=((lon+180)/360*n+n)%n,ty=Math.min(n-1e-9,Math.max(0,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n)),x=Math.floor(tx),y=Math.floor(ty),key=`${z}/${x}/${y}`;if(!cache.has(key))cache.set(key,await decode(z,x,y));const image=cache.get(key);if(!image)continue;const px=Math.min(image.info.width-1,Math.floor((tx-x)*image.info.width)),py=Math.min(image.info.height-1,Math.floor((ty-y)*image.info.height)),offset=(py*image.info.width+px)*4;if(image.data[offset+3]===0)continue;height=-10000+(image.data[offset]*65536+image.data[offset+1]*256+image.data[offset+2])*.1;break;}
  values.push({lon,lat,elevationM:height});
 }return {source:id,values};
}
