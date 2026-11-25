import {tileBBox, tileRange, type BBox} from './cartography';

export interface SourceFile {name:string;url:string;bytes?:number}

export function isAtlasLandCover(meta:{thematic?:boolean;name:string;source?:string;attribution:string}){
 return !!meta.thematic || /worldcover/i.test([meta.name,meta.source,meta.attribution].join(' '));
}

const split=(b:BBox):BBox[]=>b[0]>b[2]?[[b[0],b[1],180,b[3]],[-180,b[1],b[2],b[3]]]:[b];
function lat(n:number){return `${n<0?'S':'N'}${String(Math.abs(n)).padStart(2,'0')}`;}
function lon(n:number){return `${n<0?'W':'E'}${String(Math.abs(n)).padStart(3,'0')}`;}
export function rasterSources(kind:'dem'|'landcover',bounds:BBox,minzoom?:number):SourceFile[]{
 if(minzoom!==undefined&&(!Number.isInteger(minzoom)||minzoom<0||minzoom>16))throw Error('Масштаб подготовки должен быть от 0 до 16');
 // Каждый более подробный тайл входит в один из тайлов начального масштаба.
 const boxes=split(bounds).map((box):BBox=>{
  if(minzoom===undefined)return box;
  const {x0,x1,y0,y1}=tileRange(box,minzoom);
  const [west,,,north]=tileBBox(x0,y0,minzoom);
  const [,south,east]=tileBBox(x1,y1,minzoom);
  return [west,south,east,north];
 });
 const files=new Map<string,SourceFile>(),step=kind==='dem'?1:3;
 for(const b of boxes)for(let y=Math.floor(b[1]/step)*step;y<b[3];y+=step)for(let x=Math.floor(b[0]/step)*step;x<b[2];x+=step){
  const name=kind==='dem'?`Copernicus_DSM_COG_10_${lat(y)}_00_${lon(x)}_00_DEM`:`ESA_WorldCover_10m_2021_v200_${lat(y)}${lon(x)}_Map`;
  files.set(name,{name,url:kind==='dem'?`https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/${name}/${name}.tif`:`https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/${name}.tif`});
  if(files.size>64)throw Error('Для покрытия требуется более 64 листов. Увеличьте начальный масштаб или уменьшите область.');
 }return [...files.values()];
}
