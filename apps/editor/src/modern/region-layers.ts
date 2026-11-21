import {tileCount,type BBox} from '../../../../packages/core/src/cartography';
import type {AtlasMeta} from '../../../../services/cartography/src/atlas';
import type {AtlasJob} from '../../../../services/cartography/src/atlas-jobs';
import {coversView} from './environment-region';

export const layerNames:Record<string,string>={water:'Водоёмы',water_name:'Названия водоёмов',waterway:'Реки и каналы',roads:'Автомобильные дороги',railways:'Железнодорожные объекты',structures:'Сооружения',transportation:'Дороги и транспорт',transportation_name:'Названия дорог',building:'Здания',landcover:'Покров территории',landuse:'Использование земли',place:'Населённые пункты',poi:'Объекты на карте',park:'Парки',boundary:'Границы',housenumber:'Номера домов',aeroway:'Аэродромы',aerodrome_label:'Названия аэродромов',mountain_peak:'Горные вершины'};

export const mapKinds=['openfreemap','dem','landcover','osm'] as const;
export type MapKind=typeof mapKinds[number];
export type RegionLayer=MapKind|'weather';
export const layerInfo:Record<RegionLayer,{name:string;credit:string}>={
  openfreemap:{name:'Базовая карта',credit:'© OpenMapTiles © OpenStreetMap contributors; ODbL'},
  osm:{name:'Дополнительные объекты OSM',credit:'© OpenStreetMap contributors; Geofabrik, ODbL'},
  dem:{name:'Рельеф и высоты',credit:'Copernicus DEM GLO-30 · Copernicus DEM license'},
  landcover:{name:'Наземный покров',credit:'ESA WorldCover 2021 · CC BY 4.0'},
  weather:{name:'Архивная погода',credit:'Open-Meteo · ERA5 / ERA5-Land'},
};

export function layerForArea(kind:MapKind,bounds:BBox,maps:AtlasMeta[],jobs:AtlasJob[]){
  const completed=new Map(jobs.filter(j=>j.state==='done'&&j.result).map(j=>[j.result!.id,j]));
  const coverage=(m:AtlasMeta)=>{
    const job=completed.get(m.id);
    return job && job.input.kind!=='mbtiles' ? job.input.options.bounds??m.bounds : m.bounds;
  };
  const exact=(m:AtlasMeta)=>coverage(m).every((v,i)=>v===bounds[i]);
  return maps.filter(m=>{
    const job=completed.get(m.id);
    if(!coversView(coverage(m),bounds))return false;
    if(job&&mapKinds.some(k=>k===job.input.kind))return job.input.kind===kind;
    if(kind==='dem')return m.kind==='terrain';
    if(kind==='landcover')return m.thematic||/worldcover/i.test(m.attribution);
    if(kind==='osm')return m.kind==='vector'&&/geofabrik/i.test([m.source,m.attribution].join(' '));
    return m.kind==='vector'&&(/openmaptiles|openfreemap/i.test(m.attribution)||['water','transportation','place'].every(k=>m.layers.some(l=>l.id===k)));
  }).sort((a,b)=>Number(exact(b))-Number(exact(a))||(b.importedAt??'').localeCompare(a.importedAt??''))[0];
}

// Выбираем масштаб, который помещается в одну региональную выгрузку.
export function regionZoom(bounds:BBox){
  const [w,s,e,n]=bounds;
  const boxes:BBox[]=w>e?[[w,s,180,n],[-180,s,e,n]]:[bounds];
  let maxzoom=13;
  const tiles=(z:number)=>boxes.reduce((total,b)=>total+tileCount(b,Math.max(0,z-5),z),0);
  while(maxzoom>0&&tiles(maxzoom)>3000)maxzoom--;
  return {minzoom:Math.max(0,maxzoom-5),maxzoom,tiles:tiles(maxzoom)};
}
