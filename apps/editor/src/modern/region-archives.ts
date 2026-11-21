import type {WeatherDataset,WeatherSource} from '../../../../packages/core/src/weather';
import type {WeatherRegion} from '../../../../packages/core/src/weather-grid';
import {environmentApi} from './environment-api';
import {centerOf} from './environment-region';
import {historicalWindow} from './weather-analogue';

export interface ArchiveItem {id:string;name:string;source:WeatherSource;region?:WeatherRegion;start:string;end:string;points:string[]}

export function archivePlan(items:ArchiveItem[],region:WeatherRegion,lastYear:number,count:number,month:number,duration:number){
  if(!Number.isInteger(lastYear)||lastYear-count+1<1940||lastYear>=new Date().getUTCFullYear())throw Error('Выберите завершившиеся годы начиная с 1940.');
  return Array.from({length:count},(_,n)=>{
    const year=lastYear-count+1+n,range=historicalWindow(year,month,duration);
    if(Date.parse(range.end)-Date.parse(range.start)>366*86400000||Date.parse(range.end)+86400000>Date.now())throw Error('Для такой длительности выберите более ранний год или локальный архив.');
    const known=items.find(i=>i.region?.cols===3&&i.region.rows===3&&i.region.bounds.every((v,k)=>v===region.bounds[k])&&
      i.source.model===(year<1950?'ERA5':'ERA5-Seamless')&&i.start.slice(0,10)<=range.start&&i.end.slice(0,10)>=range.end);
    return {...range,year,id:known?.id};
  });
}

export async function readRegionArchives(region:WeatherRegion,plan:ReturnType<typeof archivePlan>,signal:AbortSignal,
  report:(message:string)=>void,cache=new Map<string,WeatherDataset>()){
  const sets:WeatherDataset[]=[];
  for(const entry of plan){
    const key=JSON.stringify([region.bounds,entry.start,entry.end]);
    let d=cache.get(key);
    if(!d){
      report(`${entry.id?'Открываем':'Загружаем'} ${entry.year} · ${sets.length+1} из ${plan.length}`);
      d=entry.id?await environmentApi<WeatherDataset>(`/environment/weather/${entry.id}`,{signal}):
        await environmentApi<WeatherDataset>('/environment/weather/archive',{method:'POST',signal,body:JSON.stringify({
          ...centerOf(region.bounds),start:entry.start,end:entry.end,region:{bounds:region.bounds,cols:3,rows:3}})});
      cache.set(key,d);
    }
    const since=Date.parse(entry.start),until=Date.parse(entry.end)+86400000;
    sets.push({...d,rows:d.rows.filter(r=>{const t=Date.parse(r.time);return t>=since&&t<until;})});
  }
  return sets;
}
