import {useEffect, useState} from 'react';
import {weatherGrid, type WeatherRegion} from '../../../../packages/core/src/weather-grid';
import {environmentApi} from './environment-api';

type Height = {lon:number; lat:number; elevationM:number|null};
type Result = {source:string; grid:WeatherRegion; heights:Map<string,number|null>; error?:string};

export function useMapElevations(source:string|undefined, grid:WeatherRegion) {
  const [result,setResult]=useState<Result>();
  useEffect(()=>{
    if(!source)return;
    const controller=new AbortController();
    const points=weatherGrid(grid).filter(([,lat])=>Math.abs(lat)<=85.05112878);
    if(!points.length)return;
    void environmentApi<{values:Height[]}>(`/atlas/${source}/elevations`,{
      method:'POST',signal:controller.signal,body:JSON.stringify({points}),
    }).then(({values})=>{
      if(!controller.signal.aborted)setResult({source,grid,heights:new Map(values.map(v=>[`${v.lon},${v.lat}`,v.elevationM]))});
    }).catch((cause:Error)=>{
      if(!controller.signal.aborted)setResult({source,grid,heights:new Map(),error:cause.message});
    });
    return ()=>controller.abort();
  },[source,grid]);
  return result?.grid===grid&&result.source===source?result:undefined;
}
