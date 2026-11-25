import profile from './climate/regional-v2.json' with {type:'json'};
import manifest from './climate/regional-v2-manifest.json' with {type:'json'};
export const REGIONAL_CLIMATE_PROFILE=Object.freeze({id:profile.id,sha256:manifest.sha256});
export type RegionalClimateNormal={temperature:number|null;pressure:number|null;windU:number|null;windV:number|null;windSpeed:number|null;windDirection:number|null;cloud:number|null;precipitation:number|null;humidity:number|null;soilTemperature:number|null;soilMoisture:number|null;heightM:number|null};
/** Месячные средние NOAA: интерполяция между серединами месяцев, без заполнения пропусков. */
export function sampleRegionalClimate(lat:number,lon:number,time:string):RegionalClimateNormal{
 const at=Date.parse(time);
 if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>180||!Number.isFinite(at))throw new Error('Недопустимые координаты или время климатической нормы');
 const x=((lon%360+360)%360)/profile.longitudeStep;
 const west=Math.floor(x),east=(west+1)%profile.longitudeCount,fx=x-west;
 let north=0;const last=profile.lat.length-1;
 while(north<last-1&&profile.lat[north+1]>lat)north++;
 const south=north+1,fy=Math.max(0,Math.min(1,(profile.lat[north]-lat)/(profile.lat[north]-profile.lat[south])));
 const date=new Date(at),middle=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),15);
 const next=new Date(middle);next.setUTCMonth(next.getUTCMonth()+(at<middle?-1:1));
 const fraction=(at-middle)/(next.getTime()-middle);
 const month=date.getUTCMonth(),neighbor=next.getUTCMonth(),stride=profile.lat.length*profile.longitudeCount;
 const combine=(items:[number|null,number][])=>{
  let value=0;for(const [v,weight] of items){if(weight<=1e-12)continue;if(v===null)return null;value+=v*weight;}return value;
 };
 const grid=(values:(number|null)[],offset=0)=>combine([
  [values[offset+north*profile.longitudeCount+west],(1-fx)*(1-fy)],
  [values[offset+north*profile.longitudeCount+east],fx*(1-fy)],
  [values[offset+south*profile.longitudeCount+west],(1-fx)*fy],
  [values[offset+south*profile.longitudeCount+east],fx*fy],
 ]);
 const field=(name:keyof typeof profile.fields)=>combine([[grid(profile.fields[name].values,month*stride),1-fraction],[grid(profile.fields[name].values,neighbor*stride),fraction]]);
 const temperature=field('temperature'),pressure=field('pressure'),q=field('specificHumidity'),windU=field('windU'),windV=field('windV');
 const humidity=temperature===null||pressure===null||q===null?null:Math.max(0,Math.min(100,100*(q*pressure/(.622+.378*q))/(6.112*Math.exp(17.67*temperature/(temperature+243.5)))));
 return {temperature,pressure,windU,windV,windSpeed:windU===null||windV===null?null:Math.hypot(windU,windV),windDirection:windU===null||windV===null?null:(Math.atan2(-windU,-windV)*180/Math.PI+360)%360,cloud:field('cloud'),precipitation:field('precipitation'),humidity,soilTemperature:field('soilTemperature'),soilMoisture:field('soilMoisture'),heightM:grid(profile.heights)};
}
