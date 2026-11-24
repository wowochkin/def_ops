/** Независимый каталог современных MBTiles. Ни один импорт не меняет историческую карту. */
import { DatabaseSync } from 'node:sqlite';
import { promises as fs, createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { tileRange, tileCount, type BBox } from '@def-ops/core';
import { clipRasterTile } from '@def-ops/raster-tiles';
import { railwayFilter, railwaySources } from '../../../packages/core/src/railway-style';
import { writeAtomic } from './tiles';
import type { StyleSpecification, LayerSpecification, FilterSpecification } from '@maplibre/maplibre-gl-style-spec';
export interface AtlasMeta { thematic?:boolean; id: string; name: string; format: 'pbf' | 'png' | 'jpg' | 'webp'; kind: 'vector' | 'raster' | 'terrain'; minzoom: number; maxzoom: number; bounds: BBox; attribution: string; layers: { id: string; fields?: Record<string,string> }[]; bytes: number; sha256?: string; importedAt?: string; source?: string }
export function validId(id: string) { if (!/^[a-z0-9-]{1,64}$/i.test(id)) throw Error('Недопустимый идентификатор набора'); return id; }
export function validBounds(b: unknown): BBox {
 if (!Array.isArray(b) || b.length!==4 || !b.every(Number.isFinite) || Math.abs(b[0])>180 || Math.abs(b[2])>180 || Math.abs(b[1])>85.05112878 || Math.abs(b[3])>85.05112878 || b[1]>=b[3] || b[0]===b[2]) throw Error('Рамка: запад,юг,восток,север; широта Web Mercator до ±85.05112878°');
 return b as BBox;
}
export function inspectAtlas(file: string): AtlasMeta {
 const db=new DatabaseSync(file,{readOnly:true});
 try {
  const check=db.prepare('pragma quick_check(1)').get() as Record<string,unknown>;
  if (Object.values(check)[0]!=='ok') throw Error('Повреждённая база MBTiles');
  const metadata=Object.fromEntries((db.prepare('select name,value from metadata').all() as {name:string;value:string}[]).map(r=>[r.name,r.value]));
  const ranges=db.prepare('select min(zoom_level) lo,max(zoom_level) hi from tiles').get() as {lo:number|null;hi:number|null};
  if (ranges.lo===null || ranges.hi===null) throw Error('В MBTiles нет тайлов');
  const format=metadata.format==='jpeg'?'jpg':metadata.format;
  if (!['pbf','png','jpg','webp'].includes(format)) throw Error('Поддерживаются MBTiles PBF/PNG/JPG/WebP');
  const lo=Number(metadata.minzoom??ranges.lo), hi=Number(metadata.maxzoom??ranges.hi);
  if (!Number.isInteger(lo)||!Number.isInteger(hi)||lo<0||hi>22||hi<lo) throw Error('Масштабы MBTiles должны быть 0–22');
  const bounds=validBounds((metadata.bounds??'-180,-85,180,85').split(',').map(Number));
  const layers: AtlasMeta['layers']=format==='pbf'?JSON.parse(metadata.json??'{}').vector_layers:[];
  if (!Array.isArray(layers)||layers.length>256||layers.some(l=>typeof l.id!=='string'||!l.id||l.id.length>200)||new Set(layers.map(l=>l.id)).size!==layers.length||format==='pbf'&&!layers.length) throw Error('Векторный MBTiles должен описывать уникальные vector_layers');
  return {id:'',...(metadata.landcover_legend?{thematic:true}:{}),name:metadata.name||'Импорт карты',format:format as AtlasMeta['format'],kind:metadata.encoding==='mapbox'?'terrain':format==='pbf'?'vector':'raster',minzoom:lo,maxzoom:hi,bounds,attribution:metadata.attribution||'Источник и лицензия не указаны в пакете',layers:layers.map(l=>({id:l.id,...(l.fields?{fields:l.fields}:{})})),bytes:0};
 } finally {db.close();}
}
export class AtlasStore {
 constructor(readonly root:string) {}
 dir(tenant:string) {return path.join(this.root,createHash('sha256').update(tenant).digest('hex'));}
 file(tenant:string,id:string) {return path.join(this.dir(tenant),`${validId(id)}.mbtiles`);}
 async list(tenant:string):Promise<AtlasMeta[]> {
  const dir=this.dir(tenant), files=await fs.readdir(dir).catch(()=>[]), out:AtlasMeta[]=[];
  for(const file of files.filter(n=>/^[a-z0-9-]+\.json$/i.test(n))) out.push(JSON.parse(await fs.readFile(path.join(dir,file),'utf8')));
  return out;
 }
 async get(tenant:string,id:string) {return JSON.parse(await fs.readFile(path.join(this.dir(tenant),`${validId(id)}.json`),'utf8')) as AtlasMeta;}
 async importFile(tenant:string,input:string,source?:string) {
  const info=inspectAtlas(input), id=randomUUID(), dest=this.file(tenant,id); await fs.mkdir(this.dir(tenant),{recursive:true});
  const tmp=`${dest}.tmp`; await fs.copyFile(input,tmp);
  try {
   const hash=createHash('sha256'); for await(const chunk of createReadStream(tmp)) hash.update(chunk);
   const meta:AtlasMeta={...info,id,bytes:(await fs.stat(tmp)).size,sha256:hash.digest('hex'),importedAt:new Date().toISOString(),source};
   await fs.rename(tmp,dest); await writeAtomic(path.join(this.dir(tenant),`${id}.json`),Buffer.from(JSON.stringify(meta))); return meta;
  } catch(e) {await fs.rm(tmp,{force:true});await fs.rm(dest,{force:true});throw e;}
 }
 async tile(tenant:string,id:string,z:number,x:number,y:number) {
  if (![z,x,y].every(Number.isInteger)||z<0||z>22||x<0||y<0||x>=2**z||y>=2**z) throw Error('Недопустимый адрес тайла');
  const m=await this.get(tenant,id), db=new DatabaseSync(this.file(tenant,id),{readOnly:true});
  try {const r=db.prepare('select tile_data d from tiles where zoom_level=? and tile_column=? and tile_row=? limit 1').get(z,x,2**z-1-y) as {d:Uint8Array}|undefined;
   if(!r?.d.length)return null;
   if(m.format==='pbf')return {bytes:Buffer.from(r.d),format:m.format};
   return clipRasterTile({bytes:Buffer.from(r.d),format:m.format,bounds:m.bounds,z,x,y});
  } finally {db.close();}
 }
 async remove(tenant:string,id:string) {await fs.rm(this.file(tenant,id),{force:true});await fs.rm(path.join(this.dir(tenant),`${id}.json`),{force:true});}
}
/** Универсальный локальный стиль: сохранён каждый source-layer, тип геометрии не предполагается по имени. */
export function atlasStyle(m:AtlasMeta,prefix:string):StyleSpecification {
 const tiles=`${prefix}/cartography/atlas/${m.id}/tiles/{z}/{x}/{y}`, base={tiles:[tiles],minzoom:m.minzoom,maxzoom:m.maxzoom,bounds:m.bounds,attribution:m.attribution};
 const layers:LayerSpecification[]=[{id:'background',type:'background',paint:{'background-color':'#ede8d8'}}];
 if(m.kind==='vector') {
  const color=(id:string)=>/water/i.test(id)?'#9ecad0':/building/i.test(id)?'#bdb4a4':/landcover|landuse|park|forest/i.test(id)?'#bdcbb0':/road|transport|rail/i.test(id)?'#b39872':'#9ca9a2';
  const priority=(id:string)=>/landcover|landuse|park/i.test(id)?0:/water/i.test(id)?1:/building/i.test(id)?2:/boundary/i.test(id)?3:/transport|road|rail/i.test(id)?4:5;
  const ordered=m.layers.map((l,i)=>({l,i})).sort((a,b)=>priority(a.l.id)-priority(b.l.id));
  const hasTransportGeometry=m.layers.some(l=>l.id==='transportation');
  for(const {i,l} of ordered) {
   const source={source:'atlas','source-layer':l.id}; const id=`layer-${i}`;
   layers.push({id:`${id}-fill`,type:'fill',...source,filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':color(l.id),'fill-opacity':.65}});
   const line:FilterSpecification=['==',['geometry-type'],'LineString'];
   const rail=railwaySources.includes(l.id)?railwayFilter(l.id):false;
   if(rail!==true)layers.push({id:`${id}-line`,type:'line',...source,filter:rail?['all',line,['!',rail]]:line,paint:{'line-color':color(l.id),'line-width':['interpolate',['linear'],['zoom'],4,.4,16,2]}});
   if(rail!==false && (l.id!=='transportation_name'||!hasTransportGeometry)){
    const filter:FilterSpecification=rail===true?line:['all',line,rail];
    layers.push({id:`${id}-rail-base`,type:'line',...source,filter,layout:{'line-join':'round'},paint:{
     'line-color':'#707070','line-width':['interpolate',['linear'],['zoom'],6,.8,11,1.2,13,3,18,4],
    }},{id:`${id}-rail-dashes`,type:'line',...source,filter,minzoom:12,layout:{'line-join':'round','line-cap':'butt'},paint:{
     'line-color':'#ffffff','line-width':['interpolate',['linear'],['zoom'],12,.8,14,1.4,18,2],
     'line-dasharray':[6,6],
    }});
   }
   layers.push({id:`${id}-point`,type:'circle',...source,filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':2,'circle-color':'#53685d'}});
  }
  for(const [i,l] of m.layers.entries()) layers.push({id:`layer-${i}-label`,type:'symbol',source:'atlas','source-layer':l.id,minzoom:/place|label/i.test(l.id)?0:12,layout:{'text-field':['coalesce',['get','name:ru'],['get','name'],['get','name:en'],''],'text-font':['OpenHistorical'],'text-size':13,'text-max-width':9},paint:{'text-color':'#31423b','text-halo-color':'#faf8ee','text-halo-width':1.5}});
  return {version:8,glyphs:`${prefix}/cartography/fonts/{fontstack}/{range}.pbf`,sources:{atlas:{type:'vector',...base}},layers};
 }
 if(m.kind==='terrain') {layers.push({id:'terrain-shade',type:'hillshade',source:'atlas',paint:{'hillshade-exaggeration':.5}});return {version:8,sources:{atlas:{type:'raster-dem',...base,tileSize:256,encoding:'mapbox'}},layers};}
 layers.push({id:'raster',type:'raster',source:'atlas'}); return {version:8,sources:{atlas:{type:'raster',...base,tileSize:256}},layers};
}
export interface ConvertOptions {bounds:BBox;minzoom:number;maxzoom:number;name:string;attribution:string}
export async function convertGeoJson(data:GeoJSON.FeatureCollection,file:string,o:ConvertOptions,progress:(done:number,total:number)=>void) {
 validBounds(o.bounds);
 if(!Number.isInteger(o.minzoom)||!Number.isInteger(o.maxzoom)||o.minzoom<0||o.maxzoom>16||o.minzoom>o.maxzoom) throw Error('Конвертация GeoJSON: масштабы 0–16');
 if(data.type!=='FeatureCollection'||!Array.isArray(data.features)||data.features.length>1000000) throw Error('Нужен GeoJSON FeatureCollection до 1 млн объектов');
 const boxes:BBox[]=o.bounds[0]>o.bounds[2]?[[o.bounds[0],o.bounds[1],180,o.bounds[3]],[-180,o.bounds[1],o.bounds[2],o.bounds[3]]]:[o.bounds];
 const total=boxes.reduce((n,b)=>n+tileCount(b,o.minzoom,o.maxzoom),0); if(total>100000) throw Error('Слишком много тайлов: уменьшите район/масштабы (предел 100 000)');
 const groups=new Map<string,GeoJSON.Feature[]>();
 for(const f of data.features) {const layer=String(f.properties?.layer??'objects');if(layer.length>200||groups.size>=256&&!groups.has(layer)) throw Error('Слишком много слоёв GeoJSON');const g=groups.get(layer)??[];g.push(f);groups.set(layer,g);}
 const indices=[...groups].map(([name,features])=>({name,index:new GeoJSONVT({type:'FeatureCollection',features},{maxZoom:o.maxzoom,indexMaxZoom:Math.min(o.maxzoom,5),extent:4096})}));
 const db=new DatabaseSync(file); let done=0, count=0;
 try {
  db.exec('pragma journal_mode=off; create table metadata(name text,value text);create table tiles(zoom_level integer,tile_column integer,tile_row integer,tile_data blob);create unique index tile_index on tiles(zoom_level,tile_column,tile_row)');
  const meta={name:o.name,format:'pbf',minzoom:String(o.minzoom),maxzoom:String(o.maxzoom),bounds:o.bounds.join(','),attribution:o.attribution,json:JSON.stringify({vector_layers:[...groups.keys()].map(id=>({id,fields:{name:'String'}}))})};
  const ins=db.prepare('insert into metadata values(?,?)');for(const [k,v] of Object.entries(meta)) ins.run(k,v);
  const put=db.prepare('insert or replace into tiles values(?,?,?,?)');
  for(let z=o.minzoom;z<=o.maxzoom;z++) for(const b of boxes) {
   const range=tileRange(b,z);for(let x=range.x0;x<=range.x1;x++) for(let y=range.y0;y<=range.y1;y++) {
    const layers:Record<string,NonNullable<ReturnType<GeoJSONVT['getTile']>>>={};for(const i of indices) {const tile=i.index.getTile(z,x,y);if(tile?.features.length)layers[i.name]=tile;}
    if(Object.keys(layers).length) {put.run(z,x,2**z-1-y,gzipSync(fromGeojsonVt(layers,{version:2,extent:4096})));count++;}
    if(++done%100===0) {progress(done,total);await new Promise<void>(r=>setImmediate(r));}
   }
  }
  if(!count) throw Error('В выбранной области нет объектов'); progress(total,total);
 } catch(e) {db.close();await fs.rm(file,{force:true});throw e;} db.close();
}
