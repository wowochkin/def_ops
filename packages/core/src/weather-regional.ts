import {regionalContext,regionalContextStatus,type RegionalSurfaceContext} from './weather-regional-context';
import {regionalSurfaceState} from './weather-regional-surface';
import {weatherTime,validateWeatherScenario,type WeatherScenario,type WeatherState,type ScenarioField} from './weather';
import {sampleRegionalClimate} from './weather-climate-profile';
import {regionalRainFrame} from './weather-regional-episodes';
import {episodeIntensity} from './weather-episodes';
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));
const wrap=(v:number)=>(v%360+360)%360;
/** Ручная база и ключи сохраняют приоритет; неизвестная норма остаётся неизвестной. */
export function regionalScenarioValue(s:WeatherScenario,key:ScenarioField,normal:number|null,hour:number):number|null{
 const manual=s.manualFields?.includes(key)||key==='temperature'&&s.temperatureMode==='manual'||['visibility','snowDepth','soilMoisture','soilTemperature'].includes(key)&&s[key]!==undefined;
 let value=manual?s[key]??null:normal,from=0;
 for(const frame of s.keyframes??[]){
  const next=frame.values[key];if(next===undefined)continue;
  if(hour<frame.hour){if(value===null)return null;const f=clamp((hour-from)/(frame.hour-from),0,1);return key==='windDirection'?wrap(value+((next-value+540)%360-180)*f):value+(next-value)*f;}
  value=next;from=frame.hour;
 }
 return value;
}
export function regionalPrecipitationFrame(s:WeatherScenario,time:string):(lon:number,lat:number)=>number|null{
 const hour=(weatherTime(time)-weatherTime(s.start))/3600000;
 if(s.rain?.mode==='background'||s.manualFields?.includes('precipitation')||s.keyframes?.some(f=>f.values.precipitation!==undefined)){
  const value=regionalScenarioValue({...s,manualFields:[...(s.manualFields??[]),'precipitation']},'precipitation',s.precipitation,hour);
  return ()=>value;
 }
 if(s.rain?.mode==='event'){const value=episodeIntensity(s.rain,hour);return ()=>value;}
 const rain=regionalRainFrame(s,time);return (lon,lat)=>rain(lat,lon).intensity;
}
/** Атмосфера без истории поверхности: безопасный порт для интегрирования по времени. */
export function regionalAtmosphere(s:WeatherScenario,lat:number,lon:number,time:string,context?:RegionalSurfaceContext):WeatherState{
 validateWeatherScenario(s);
 if(context)context=regionalContext(context);
 const t=weatherTime(time),hour=(t-weatherTime(s.start))/3600000;
 const n=sampleRegionalClimate(lat,lon,time),r=Math.PI/180;
 lon=(lon%360+540)%360-180;
 // Общая гладкая синоптическая поправка для давления, ветра, облачности и влажности.
 const phase=hour/Math.max(24,s.transitionHours)+lon*r+2*Math.sin(lat*r)+s.seed*.731;
 const wave=Math.sin(phase)*s.variability,solar=Math.cos((t/3600000+lon/15-14)*Math.PI/12)*s.variability;
 const field=(key:ScenarioField,base:number|null,delta=0,lo=-Infinity,hi=Infinity)=>{
  const value=regionalScenarioValue(s,key,base,hour);
  return value===null?null:clamp(value+(s.manualFields?.includes(key)||key==='temperature'&&s.temperatureMode==='manual'||s.keyframes?.some(f=>f.values[key]!==undefined)?0:delta),lo,hi);
 };
 let temperature=field('temperature',n.temperature,2*wave+solar,-100,70),pressure=field('pressure',n.pressure,-4*wave,100,1100);
 const status=regionalContextStatus(context);
 if(context?.demId&&context.elevationM!==null){
  const temperatureRef=s.temperatureMode==='manual'?context.referenceM??0:n.heightM;
  const pressureRef=s.manualFields?.includes('pressure')?context.referenceM??0:n.heightM;
  const before=temperature;
  if(temperature!==null&&temperatureRef!==null)temperature-=((context.lapseKPerKm??6.5)/1000)*(context.elevationM-temperatureRef);
  else status.limitations.push('Недостаточно данных об опорной высоте температуры');
  if(pressure!==null&&pressureRef!==null&&before!==null&&temperature!==null){const meanK=(before+temperature)/2+273.15;pressure*=Math.exp(-9.80665*.0289644*(context.elevationM-pressureRef)/(8.314462618*meanK));}
  else status.limitations.push('Недостаточно данных об опорной высоте давления');
  if(status.limitations.length)status.mode='PARTIAL';
 }
 const windSpeed=field('windSpeed',n.windSpeed,Math.abs(wave),0,150);
 const direction=field('windDirection',n.windDirection,10*wave);
 const precipitation=regionalPrecipitationFrame(s,time)(lon,lat);

 const humidity=field('humidity',n.humidity,4*wave+(precipitation===null?0:Math.min(10,precipitation)),0,100);
 const cloud=field('cloud',n.cloud,8*wave+(precipitation===null?0:Math.min(20,precipitation*2)),0,100);
 return {provenance:'synthetic',surfaceContext:status,...(n.heightM===null?{}:{temperatureReferenceM:n.heightM}),temperature,pressure,windSpeed,windDirection:direction===null?null:wrap(direction),gust:windSpeed===null?null:windSpeed+Math.abs(wave)*2,humidity,cloud,precipitation,precipitationType:precipitation===null||temperature===null?undefined:precipitation<=.001?'none':temperature< -1?'snow':temperature>2?'rain':'mixed',soilTemperature:field('soilTemperature',n.soilTemperature),soilMoisture:field('soilMoisture',n.soilMoisture),snowDepth:s.snowDepth??null,visibility:s.visibility??null};
}
export function simulateRegionalWeather(s:WeatherScenario,lat:number,lon:number,time:string,context?:RegionalSurfaceContext):WeatherState{return {...regionalAtmosphere(s,lat,lon,time,context),...regionalSurfaceState(s,lat,lon,time,context)};}
