import {surfacePreview} from './scenario-surface';
import {useEffect,useMemo} from 'react';
import {simulateWeatherRegion,type WeatherRegion} from '../../../../packages/core/src/weather-region';
import {precipitationFrame,weatherAt,type WeatherDataset,type WeatherScenario} from '../../../../packages/core/src/weather';
import {weatherWithElevation,type ElevationWeather} from '../../../../packages/core/src/weather-elevation';
import {mapWeatherFields,weatherPointText,weatherRasters,type MapWeatherField,type WeatherOverlay} from './weather-layer';
import {useMapElevations} from './use-map-elevations';
import {weatherFieldLabels} from './environment-api';
export function WeatherField({scenario,region,time,dataset,onPoint,elevations,terrain,onOverlay,field,setField,viewBounds,dem}:{dem?:string;viewBounds?:WeatherRegion['bounds'];field:MapWeatherField;setField(f:MapWeatherField):void;scenario:WeatherScenario;region:WeatherRegion;time:string;dataset?:WeatherDataset|null;onPoint(lon:number,lat:number):void;elevations?:Map<string,number|null>;terrain?:ElevationWeather;onOverlay?(layer:WeatherOverlay):void}){
 const data=useMemo(()=>{try{if(dataset){const points=[...new Map(dataset.rows.map(r=>[`${r.lon},${r.lat}`,[r.lon,r.lat]])).values()];return {cells:points.map(([lon,lat])=>({lon,lat,state:weatherAt(dataset,lat,lon,time)})),error:''};}return {...simulateWeatherRegion(scenario,region,time),error:''};}catch(e){return {cells:[],error:(e as Error).message};}},[scenario,region,time,dataset]);
 const preview=useMemo(()=>surfacePreview(scenario,time,field),[scenario,time,field]);
 const cells=useMemo(()=>data.cells.map(c=>({...c,state:dataset||!c.state?c.state:preview(terrain?weatherWithElevation(c.state,elevations?.get(`${c.lon},${c.lat}`)??null,terrain):c.state)})),[data,terrain,elevations,dataset,preview]);
 const bounds=viewBounds??region.bounds;
 const detail=useMemo(()=>({bounds,cols:25,rows:25}),[bounds]);
 const adjustView=!dataset&&!!terrain&&(field==='temperature'||field==='pressure');
 const mapElevation=useMapElevations(onOverlay&&adjustView?dem:undefined,detail);
 const surface=useMemo(()=>{
  if(data.error || !onOverlay)return [];
  if(!dataset){
   if(field==='precipitation'){
    // Значение в каждом пикселе сохраняет естественную границу сухого участка.
    return weatherRasters({...region,bounds:detail.bounds},cells,field,precipitationFrame(scenario,time));
   }
   const visible=simulateWeatherRegion(scenario,detail,time).cells;
   if(adjustView&&terrain&&mapElevation){
    for(const cell of visible){
     cell.state=weatherWithElevation(cell.state,mapElevation.heights.get(`${cell.lon},${cell.lat}`)??null,terrain);
    }
   }
   return weatherRasters(detail,visible.map(c=>({...c,state:preview(c.state)})),field);
  }
  const grid=dataset?dataset.region:region;
  return grid?weatherRasters(grid,cells,field):[];
 },[data.error,onOverlay,dataset,field,region,cells,detail,scenario,time,terrain,adjustView,mapElevation,preview]);
 useEffect(()=>{if(!onOverlay)return;onOverlay({time,field,rasters:surface,label:`${dataset?'Архив':'Сценарий'} · ${weatherFieldLabels[field]}`,bounds:(dataset?.region??region).bounds,data:{type:'FeatureCollection',features:cells.filter(c=>c.state?.[field]!=null).map(c=>({type:'Feature',properties:{value:c.state![field],text:weatherPointText(c.state!,field),elevationM:elevations?.get(`${c.lon},${c.lat}`)??null},geometry:{type:'Point',coordinates:[c.lon,c.lat]}}))}});},[cells,field,onOverlay,region,dataset,surface,elevations,time]);
 const values=cells.map(c=>c.state?.[field]).filter((v):v is number=>v!=null),lo=Math.min(...values),hi=Math.max(...values);
 return <section className="env-panel env-weather-field"><div className="env-timeline-title"><h2>Погодное поле области</h2>{mapElevation?.error&&<p role="status">Высоты для карты недоступны. {mapElevation.error}</p>}<label>Показатель поля<select value={field} onChange={e=>setField(e.target.value as MapWeatherField)}>{mapWeatherFields.map(f=><option key={f} value={f}>{weatherFieldLabels[f]}</option>)}</select></label></div>{data.error?<p role="alert">{data.error}</p>:<><p className="env-note">Север вверху · {cells.length} узлов. Нажмите на узел для подробностей.</p><div className="weather-field-grid" role="group" aria-label="Узлы погодного поля" style={{gridTemplateColumns:`repeat(${dataset?.region?.cols??region.cols},minmax(0,1fr))`}}>{cells.map(c=>{const v=c.state?.[field];const hue=v==null?0:205-180*(v-lo)/Math.max(.001,hi-lo);return <button key={`${c.lon}/${c.lat}`} title={`Широта ${c.lat.toFixed(5)}, долгота ${c.lon.toFixed(5)}`} onClick={()=>onPoint(c.lon,c.lat)} style={{background:v==null?'#30474f':`hsl(${hue} 40% 30%)`}}>{v==null?'—':v.toFixed(field==='soilMoisture'||field==='snowDepth'?3:1)}</button>;})}</div><p className="env-note">{values.length?`${weatherFieldLabels[field]}: ${lo.toFixed(1)}…${hi.toFixed(1)}`:'Нет значений за выбранное время'}. Число узлов — детализация отображения; оно не повышает исходное разрешение архивных данных.</p></>}</section>;
}
