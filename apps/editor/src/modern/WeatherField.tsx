import {regionalContext} from '../../../../packages/core/src/weather-regional-context';
import {simulateRegionalWeather,regionalAtmosphere} from '../../../../packages/core/src/weather-regional';
import {weatherGrid} from '../../../../packages/core/src/weather-grid';
import {weatherRenderRegion} from './weather-domain';
import {surfacePreview} from './scenario-surface';
import {useEffect,useMemo} from 'react';
import {simulateWeatherRegion,type WeatherRegion} from '../../../../packages/core/src/weather-region';
import {precipitationFrame,weatherAt,type WeatherDataset,type WeatherScenario} from '../../../../packages/core/src/weather';
import {weatherWithElevation,type ElevationWeather} from '../../../../packages/core/src/weather-elevation';
import {mapWeatherFields,weatherPointText,weatherRasters,type MapWeatherField,type WeatherOverlay} from './weather-layer';
import {useMapElevations,useMapLandcover} from './use-map-elevations';
import {weatherFieldLabels} from './environment-api';
export function WeatherField({landcover,landcoverValues,scenario,region,time,dataset,onPoint,elevations,terrain,onOverlay,field,setField,viewBounds,dem}:{landcover?:string;landcoverValues?:Map<string,number|null>;dem?:string;viewBounds?:WeatherRegion['bounds'];field:MapWeatherField;setField(f:MapWeatherField):void;scenario:WeatherScenario;region:WeatherRegion;time:string;dataset?:WeatherDataset|null;onPoint(lon:number,lat:number):void;elevations?:Map<string,number|null>;terrain?:ElevationWeather;onOverlay?(layer:WeatherOverlay):void}){
 const data=useMemo(()=>{try{if(dataset){const points=[...new Map(dataset.rows.map(r=>[`${r.lon},${r.lat}`,[r.lon,r.lat]])).values()];return {cells:points.map(([lon,lat])=>({lon,lat,state:weatherAt(dataset,lat,lon,time)})),error:''};}return {cells:scenario.algorithmVersion===2?weatherGrid(region).map(([lon,lat])=>({lon,lat,state:simulateRegionalWeather(scenario,lat,lon,time,regionalContext({elevationM:elevations?.get(`${lon},${lat}`)??null,landcoverClass:landcoverValues?.get(`${lon},${lat}`)??null,demId:dem||undefined,landcoverId:landcover||undefined,...terrain}))})):simulateWeatherRegion(scenario,region,time).cells,error:''};}catch(e){return {cells:[],error:(e as Error).message};}},[scenario,region,time,dataset,elevations,landcoverValues,landcover,dem,terrain]);
 const preview=useMemo(()=>surfacePreview(scenario,time,field),[scenario,time,field]);
 const cells=useMemo(()=>data.cells.map(c=>({...c,state:dataset||!c.state?c.state:preview(terrain&&scenario.algorithmVersion!==2?weatherWithElevation(c.state,elevations?.get(`${c.lon},${c.lat}`)??null,terrain):c.state)})),[data,terrain,elevations,dataset,preview,scenario.algorithmVersion]);
 const domain=useMemo(()=>weatherRenderRegion(dataset?.region??region,viewBounds),[dataset,region,viewBounds]);
 const detail=useMemo(()=>({bounds:region.bounds,cols:25,rows:25}),[region]);
 const adjustView=!dataset&&!!terrain&&(scenario.algorithmVersion===2||field==='temperature'||field==='pressure');
 const mapElevation=useMapElevations(onOverlay&&adjustView?dem:undefined,detail);
 const mapCover=useMapLandcover(onOverlay&&!dataset&&scenario.algorithmVersion===2?landcover:undefined,detail);
 const surface=useMemo(()=>{
  if(data.error || !onOverlay || !domain.renderBounds)return [];
  if(!dataset){
   if(field==='precipitation'){
    // Значение в каждом пикселе сохраняет естественную границу сухого участка.
    return domain.renderRegions.flatMap(bounds=>weatherRasters(region,cells,field,precipitationFrame(scenario,time),bounds));
   }
   const visible=scenario.algorithmVersion===2?weatherGrid(detail).map(([lon,lat])=>{
    const context=regionalContext({elevationM:mapElevation?.heights.get(`${lon},${lat}`)??null,landcoverClass:mapCover?.classes.get(`${lon},${lat}`)??null,demId:dem||undefined,landcoverId:landcover||undefined,...terrain});
    const sample=['visibility','snowDepth','soilTemperature','soilMoisture'].includes(field)?simulateRegionalWeather:regionalAtmosphere;
    return {lon,lat,state:sample(scenario,lat,lon,time,context)};
   }):simulateWeatherRegion(scenario,detail,time).cells;
   if(scenario.algorithmVersion!==2&&adjustView&&terrain&&mapElevation){
    for(const cell of visible)cell.state=weatherWithElevation(cell.state,mapElevation.heights.get(`${cell.lon},${cell.lat}`)??null,terrain);
   }
   return domain.renderRegions.flatMap(bounds=>weatherRasters(detail,visible.map(c=>({...c,state:preview(c.state)})),field,undefined,bounds));
  }
  const grid=dataset?dataset.region:region;
  return grid?domain.renderRegions.flatMap(bounds=>weatherRasters(grid,cells,field,undefined,bounds)):[];
 },[data.error,onOverlay,dataset,field,region,cells,detail,scenario,time,terrain,adjustView,mapElevation,mapCover,landcover,dem,preview,domain]);
 useEffect(()=>{if(!onOverlay)return;onOverlay({time,field,rasters:surface,label:`${dataset?'Архив':'Сценарий'} · ${weatherFieldLabels[field]}`,bounds:(dataset?.region??region).bounds,data:{type:'FeatureCollection',features:cells.filter(c=>c.state?.[field]!=null).map(c=>({type:'Feature',properties:{value:c.state![field],text:weatherPointText(c.state!,field),elevationM:elevations?.get(`${c.lon},${c.lat}`)??null},geometry:{type:'Point',coordinates:[c.lon,c.lat]}}))}});},[cells,field,onOverlay,region,dataset,surface,elevations,time]);
 const limitations=scenario.algorithmVersion===2&&!dataset?[...new Set(cells.flatMap(c=>c.state?.surfaceContext?.limitations??[]))]:[];
 const values=cells.map(c=>c.state?.[field]).filter((v):v is number=>v!=null),lo=Math.min(...values),hi=Math.max(...values);
 return <section className="env-panel env-weather-field"><div className="env-timeline-title"><h2>Погодное поле области</h2>{mapElevation?.error&&<p role="status">Высоты для карты недоступны. {mapElevation.error}</p>}<label>Показатель поля<select value={field} onChange={e=>setField(e.target.value as MapWeatherField)}>{mapWeatherFields.map(f=><option key={f} value={f}>{weatherFieldLabels[f]}</option>)}</select></label></div>{limitations.length>0&&<p role="status">{limitations.join('. ')}.</p>}{mapCover?.error&&<p role="status">Недостаточно данных о покрове. {mapCover.error}</p>}{data.error?<p role="alert">{data.error}</p>:<><p className="env-note">Север вверху · {cells.length} узлов. Нажмите на узел для подробностей.</p><div className="weather-field-grid" role="group" aria-label="Узлы погодного поля" style={{gridTemplateColumns:`repeat(${dataset?.region?.cols??region.cols},minmax(0,1fr))`}}>{cells.map(c=>{const v=c.state?.[field];const hue=v==null?0:205-180*(v-lo)/Math.max(.001,hi-lo);return <button key={`${c.lon}/${c.lat}`} title={`Широта ${c.lat.toFixed(5)}, долгота ${c.lon.toFixed(5)}`} onClick={()=>onPoint(c.lon,c.lat)} style={{background:v==null?'#30474f':`hsl(${hue} 40% 30%)`}}>{v==null?'—':v.toFixed(field==='soilMoisture'||field==='snowDepth'?3:1)}</button>;})}</div><p className="env-note">{values.length?`${weatherFieldLabels[field]}: ${lo.toFixed(1)}…${hi.toFixed(1)}`:'Нет значений за выбранное время'}. Число узлов — детализация отображения; оно не повышает исходное разрешение архивных данных.</p></>}</section>;
}
