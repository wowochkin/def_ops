import type {Map as AtlasMap, ImageSource} from 'maplibre-gl';
import normals from './climate/seasonal.json';
import type {WeatherRegion} from '../../../../packages/core/src/weather-grid';

export const seasonalNames = {mud:'Распутица · увлажнение почвы', ice:'Ледостав · типовой водоём', flood:'Половодье · сезон стока'} as const;
export type Season = keyof typeof seasonalNames;
export const seasonKeys = Object.keys(seasonalNames) as Season[];
export const seasonColors = {mud:'#bb7845', ice:'#7bbfdc', flood:'#8386d0'};
export const months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
export const seasonDetails = {
  mud:'Объёмная влажность верхних 10 см почвы, %. Чем больше значение, тем влажнее грунт.',
  ice:'Тепловая фаза условного пресного водоёма по месячным температурам. Глубина и течение конкретного озера в модель не входят.',
  flood:'Средний сток месяца относительно самого многоводного месяца в этой ячейке. Русла, уровень рек и границы разлива требуют местных данных.',
};
const icePhases=['Тёплая фаза','Переход к ледоставу','Холодная фаза','Переход к вскрытию'];
const palettes:Record<Season,string[]> = {
  mud:['#f3e7cd','#dbb886','#bb7845','#804a31','#59301e'],
  ice:['#ecd694','#9ccfd7','#538dbf','#8dbcb0'],
  flood:['#e8e6f0','#c4bfdc','#9997d3','#6b77bd','#464696'],
};
export const scaleText:Record<Season,string[]> = {
  mud:['0','12,5','25','37,5','50 %'],ice:icePhases,flood:['0','25','50','75','100 %'],
};
export function seasonLegend(kind:Season){return palettes[kind].map((color,i)=>({color,text:scaleText[kind][i]}));}
const cols=360/normals.step,rows=180/normals.step;
const decode=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const fields={mud:decode(normals.soil),ice:decode(normals.ice),flood:decode(normals.runoff)};
export function seasonValue(kind:Season,month:number,lon:number,lat:number){
  const x=Math.floor(((lon+180)%360+360)%360/normals.step);
  const y=Math.max(0,Math.min(rows-1,Math.floor((90-lat)/normals.step)));
  const v=fields[kind][(month*rows+y)*cols+x];
  return v===255?null:v;
}
export function regionSeason(kind:Season,month:number,[w,s,e,n]:WeatherRegion['bounds']){
  const counts=[0,0,0,0],rad=Math.PI/180;
  let sum=0,weight=0;
  const end=e<w?e+360:e;
  for(let y=Math.floor((90-n)/normals.step);y<Math.ceil((90-s)/normals.step);y++){
    const top=90-y*normals.step,bottom=top-normals.step;
    const band=Math.sin(Math.min(n,top)*rad)-Math.sin(Math.max(s,bottom)*rad);
    for(let x=Math.floor((w+180)/normals.step);x<Math.ceil((end+180)/normals.step);x++){
      const left=x*normals.step-180;
      const v=seasonValue(kind,month,left+normals.step/2,top-normals.step/2);
      if(v==null)continue;
      const a=band*(Math.min(end,left+normals.step)-Math.max(w,left));
      sum+=a*v;weight+=a;
      if(kind==='ice')counts[v]+=a;
    }
  }
  if(!weight)return 'Нет данных по суше';
  if(kind==='ice')return icePhases[counts.indexOf(Math.max(...counts))];
  return Math.round(sum/weight)+' %';
}
const colors = (kind:Season)=>palettes[kind].map(hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
const drawn = new WeakMap<ImageSource,number>();
const northLimit=Math.atan(Math.sinh(Math.PI))*180/Math.PI;
function stripPixels(kind:Season,month:number,west:number){
  const size=120, image=new ImageData(size,size),rgb=colors(kind);
  for(let y=0;y<size;y++){
    const lat=Math.atan(Math.sinh(Math.PI*(1-2*(y+.5)/size)))*180/Math.PI;
    for(let x=0;x<size;x++){
      const v=seasonValue(kind,month,west+x+.5,lat);
      if(v===null)continue;
      const scale=kind==='ice'?v:Math.min(4,4*v/(kind==='mud'?50:100));
      const lo=Math.floor(scale),hi=Math.min(lo+1,rgb.length-1),i=(y*size+x)*4;
      for(let k=0;k<3;k++)image.data[i+k]=rgb[lo][k]+(scale-lo)*(rgb[hi][k]-rgb[lo][k]);
      image.data[i+3]=255;
    }
  }
  return image;
}
export function drawSeasons(map:AtlasMap,enabled:readonly Season[],month:number,opacity:(f:Season)=>number){
  for(const kind of seasonKeys){
    for(let i=0;i<3;i++){
      const id='season-'+kind+'-'+i;
      if(!enabled.includes(kind)){
        if(map.getLayer(id))map.removeLayer(id);
        if(map.getSource(id))map.removeSource(id);
        continue;
      }
      const w=-180+i*120,e=w+120;
      const coordinates:[[number,number],[number,number],[number,number],[number,number]]=[[w,northLimit],[e,northLimit],[e,-northLimit],[w,-northLimit]];
      if(!map.getSource(id)){
        map.addSource(id,{type:'image',coordinates});
        const before=map.getStyle().layers.find(l=>['line','symbol','circle'].includes(l.type))?.id;
        map.addLayer({id,type:'raster',source:id,paint:{'raster-fade-duration':0,'raster-resampling':'nearest'}},before);
      }
      const source=map.getSource(id) as ImageSource;
      if(drawn.get(source)!==month){source.updateImage({image:stripPixels(kind,month,w),coordinates});drawn.set(source,month);}
      map.setPaintProperty(id,'raster-opacity',opacity(kind));
    }
  }
}
