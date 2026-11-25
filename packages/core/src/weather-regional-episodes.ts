import type {WeatherScenario} from './weather';
import {weatherTime} from './weather';
import {sampleRegionalClimate} from './weather-climate-profile';
export type RegionalRainEpisode=Readonly<{id:string;cellId:string;center:[number,number];radiusKm:number;startHour:number;durationHours:number;intensity:number|null;driftKmPerHour:number;directionDeg:number}>;
export type RegionalRainSample=Readonly<{episode:RegionalRainEpisode|null;intensity:number|null}>;
const rad=Math.PI/180,period=48,cache=new Map<string,RegionalRainEpisode>();
const wrap=(n:number)=>(n%360+540)%360-180;
function random(key:string){let h=2166136261;for(const c of key)h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0)/4294967296;}
function episode(s:WeatherScenario,row:number,col:number,cycle:number):RegionalRainEpisode{
 const cellId=`${row}/${col}`,id=`${s.seed}/${s.start}/${s.climateProfileSha256}/${cellId}/${cycle}`;
 const prior=cache.get(id);if(prior)return prior;
 const draw=(tag:string)=>random(id+'/'+tag);
 const center:[number,number]=[-175+col*10+(draw('x')-.5)*3,-85+row*10+(draw('y')-.5)*3];
 const startHour=cycle*period+2+draw('start')*22;
 const normal=sampleRegionalClimate(center[1],center[0],new Date(weatherTime(s.start)+startHour*3600000).toISOString());
 const result:RegionalRainEpisode={id,cellId,center,radiusKm:450+draw('radius')*250,startHour,durationHours:6+draw('duration')*10,intensity:normal.precipitation===null?null:Math.min(60,normal.precipitation*24*(.5+draw('intensity'))),driftKmPerHour:Math.min(5,(normal.windSpeed??0)*.5),directionDeg:normal.windDirection??0};
 if(cache.size>=2048)cache.delete(cache.keys().next().value!);cache.set(id,result);return result;
}
function distanceKm(lon:number,lat:number,x:number,y:number){const a=Math.sin((lat-y)*rad/2)**2+Math.cos(lat*rad)*Math.cos(y*rad)*Math.sin(wrap(lon-x)*rad/2)**2;return 12742*Math.asin(Math.sqrt(Math.min(1,a)));}
type ActiveEpisode={episode:RegionalRainEpisode;x:number;y:number;envelope:number};
const frames=new Map<string,(lat:number,lon:number)=>RegionalRainSample>();
/** Общие параметры кадра готовятся один раз; каждый пиксель считает только расстояния. */
export function regionalRainFrame(s:WeatherScenario,time:string):(lat:number,lon:number)=>RegionalRainSample{
 const key=`${s.seed}/${s.start}/${s.climateProfileSha256}/${time}`;
 const saved=frames.get(key);if(saved)return saved;
 const hours=(weatherTime(time)-weatherTime(s.start))/3600000,cycle=Math.floor(hours/period);
 const candidates=new Map<string,ActiveEpisode[]>();
 const sample=(lat:number,lon:number):RegionalRainSample=>{
  const row=Math.min(17,Math.max(0,Math.floor((lat+90)/10))),col=Math.min(35,Math.floor((wrap(lon)+180)/10));
  // Ширина берётся по полярной границе ячейки, одинаково для всех её пикселей.
  const polar=Math.min(90,Math.max(Math.abs(row*10-90),Math.abs(row*10-80)));
  const width=Math.min(18,Math.ceil(900/(1110*Math.max(.01,Math.cos(polar*rad))))+1);
  const cell=`${row}/${col}`;
  let active=candidates.get(cell);
  if(!active){
   active=[];const seen=new Set<number>();
   for(let dc=-width;dc<=width;dc++){
    const c=(col+dc+36)%36;if(seen.has(c))continue;seen.add(c);
    for(let r=Math.max(0,row-2);r<=Math.min(17,row+2);r++)for(const cy of [cycle-1,cycle]){
     const e=episode(s,r,c,cy),age=hours-e.startHour;
     if(age<=0||age>=e.durationHours)continue;
     const direction=e.directionDeg*rad,km=age*e.driftKmPerHour;
     active.push({episode:e,y:Math.max(-90,Math.min(90,e.center[1]+km*Math.cos(direction)/111)),x:wrap(e.center[0]+km*Math.sin(direction)/(111*Math.max(.01,Math.cos(e.center[1]*rad)))),envelope:Math.sin(Math.PI*age/e.durationHours)**2});
    }
   }
   if(candidates.size>=64)candidates.delete(candidates.keys().next().value!);
   candidates.set(cell,active);
  }
  let intensity=0,dominant:RegionalRainEpisode|null=null,largest=0;
  for(const {episode:e,x,y,envelope} of active){
   const spatial=Math.max(0,1-distanceKm(lon,lat,x,y)/e.radiusKm);
   if(!spatial)continue;if(e.intensity===null)return {episode:e,intensity:null};
   const local=e.intensity*envelope*spatial**2;
   intensity+=local;if(local>largest){largest=local;dominant=e;}
  }
  return {episode:dominant,intensity};
 };
 if(frames.size>=128)frames.delete(frames.keys().next().value!);frames.set(key,sample);return sample;
}
/** Воспроизводимые местные очаги со сглаживанием между климатическими ячейками. */
export function regionalRainAt(s:WeatherScenario,lat:number,lon:number,time:string):RegionalRainSample{return regionalRainFrame(s,time)(lat,lon);}
