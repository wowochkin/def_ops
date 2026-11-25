import type {RegionalSurfaceContext} from './weather-regional-context';
import {weatherTime,type WeatherScenario} from './weather';
import {regionalAtmosphere,regionalScenarioValue} from './weather-regional';
import {sampleRegionalClimate} from './weather-climate-profile';
export type RegionalSurfaceState={soilMoisture:number|null;snowDepth:number|null;soilTemperature:number|null;visibility:number|null};
export const REGIONAL_SURFACE_PROFILE_V2=Object.freeze({
 basis:'учебное допущение: ограниченный водный и тепловой баланс, не гидрологический прогноз',
 historyHours:72,stepHours:1,urbanInfiltrationFactor:.2,infiltrationPerMm:.0008,evaporationPerDegreeHour:.00002,
 snowDepthMPerMm:.001,meltMPerDegreeHour:.0005,thermalRelaxationPerHour:.08,
 visibilityBaseM:26000,humidityVisibilityLossM:11000,rainVisibilityLossM:12500,rainReferenceMmPerHour:12,
});
const clamp=(value:number,low:number,high:number)=>Math.min(high,Math.max(low,value));
/** Прямое интегрирование фиксированного окна местной истории; перемотка не хранит скрытое состояние. */
export function regionalSurfaceState(s:WeatherScenario,lat:number,lon:number,time:string,context?:RegionalSurfaceContext):RegionalSurfaceState{
 const p=REGIONAL_SURFACE_PROFILE_V2,t=weatherTime(time),normal=sampleRegionalClimate(lat,lon,time);
 const water=context?.landcoverId&&context.landcoverClass===80;
 let moisture=water?null:normal.soilMoisture,snow=water||normal.soilMoisture===null?null:0,soilTemperature=water?null:normal.soilTemperature;
 // Учебное допущение: инфильтрация застроенной поверхности снижена до 20%.
 const infiltration=context?.landcoverId&&context.landcoverClass===50?p.urbanInfiltrationFactor:1;
 for(let hour=-p.historyHours;hour<0;hour+=p.stepHours){
  const at=new Date(t+(hour+p.stepHours/2)*3600000).toISOString();
  const state=regionalAtmosphere(s,lat,lon,at,context);
  if(state.temperature==null||state.precipitation==null){moisture=null;snow=null;soilTemperature=null;continue;}
  const temperature=state.temperature,amount=state.precipitation;
  const snowFraction=state.precipitationType==='snow'?1:state.precipitationType==='mixed'?.5:0;
  const melting=snow===null?0:Math.min(snow,Math.max(0,temperature)*p.meltMPerDegreeHour);
  if(snow!==null)snow=clamp(snow+amount*snowFraction*p.snowDepthMPerMm-melting,0,100);
  if(moisture!==null)moisture=clamp(moisture+(amount*(1-snowFraction)+melting/p.snowDepthMPerMm)*p.infiltrationPerMm*infiltration-Math.max(0,temperature)*p.evaporationPerDegreeHour,0,1);
  if(soilTemperature!==null)soilTemperature=clamp(soilTemperature+(temperature-soilTemperature)*p.thermalRelaxationPerHour,-100,100);
 }
 const current=regionalAtmosphere(s,lat,lon,time,context),hours=(t-weatherTime(s.start))/3600000;
 const visibility=current.humidity==null||current.precipitation==null?null:clamp(p.visibilityBaseM-p.humidityVisibilityLossM*current.humidity/100-p.rainVisibilityLossM*current.precipitation/p.rainReferenceMmPerHour,0,1000000);
 return {soilMoisture:regionalScenarioValue(s,'soilMoisture',moisture,hours),snowDepth:regionalScenarioValue(s,'snowDepth',snow,hours),soilTemperature:regionalScenarioValue(s,'soilTemperature',soilTemperature,hours),visibility:regionalScenarioValue(s,'visibility',visibility,hours)};
}
