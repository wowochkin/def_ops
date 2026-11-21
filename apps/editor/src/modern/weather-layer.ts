import {weatherGrid, type WeatherRegion} from '../../../../packages/core/src/weather-grid';
import type {WeatherField, WeatherState} from '../../../../packages/core/src/weather';

export const mapWeatherFields = ['precipitation','temperature','windSpeed','pressure','cloud','humidity','visibility','snowDepth','soilTemperature','soilMoisture'] as const;
export type MapWeatherField = typeof mapWeatherFields[number];
type Stop = readonly [number,string];
const scales: Record<MapWeatherField, readonly Stop[]> = {
  precipitation: [[0,'#203658'],[0.1,'#37588a'],[0.5,'#5184bf'],[2,'#70bbeb'],[5,'#4ed3b9'],[10,'#e4bd67'],[20,'#b96394']],
  pressure:[[950,'#67538c'],[990,'#799dc0'],[1013,'#c3d4bf'],[1030,'#dba464'],[1060,'#ae5a52']],
  visibility:[[0,'#655989'],[1000,'#8c80a0'],[5000,'#c0a9bb'],[10000,'#d8d5c3'],[25000,'#9dcad1']],
  soilTemperature:[[-20,'#505c93'],[-5,'#759eb8'],[0,'#aed4d8'],[10,'#d4c485'],[25,'#c98953'],[40,'#99514e']],
  soilMoisture:[[0,'#d7b477'],[.15,'#d2c594'],[.3,'#98bdab'],[.45,'#528d99'],[.6,'#385c7d']],
  snowDepth:[[0,'#c9d9e5'],[.1,'#8fc4dc'],[.5,'#4b91b7'],[1,'#665da3'],[2,'#984b96']],
  temperature: [[-30,'#4e51aa'],[-10,'#4689cc'],[0,'#85cbd4'],[15,'#e9d477'],[30,'#df824c'],[40,'#b44742']],
  windSpeed: [[0,'#b9ddd1'],[5,'#65b5b5'],[15,'#447cac'],[30,'#73509c']],
  humidity: [[0,'#e4cb93'],[30,'#adcba8'],[70,'#53acae'],[100,'#326c9a']],
  cloud: [[0,'#cdeafa'],[30,'#b6cbd4'],[70,'#8592a3'],[100,'#525d77']],
};
export function weatherScale(field: MapWeatherField) {return scales[field];}
type Coordinates = [[number,number],[number,number],[number,number],[number,number]];
export interface WeatherRaster {coordinates: Coordinates; pixels: Uint8ClampedArray<ArrayBuffer>; size:number}
export interface WeatherOverlay {
  time?:string;
  data:GeoJSON.FeatureCollection; field:MapWeatherField; label:string; bounds:WeatherRegion['bounds']; rasters:WeatherRaster[];
}
interface Cell {lon:number;lat:number;state:WeatherState|null}
const key = (lon:number,lat:number) => [lon===180?-180:lon,lat].map(n=>n.toFixed(6)).join('/');
const mercator = (deg:number) => Math.asinh(Math.tan(deg*Math.PI/180));

// Interpolate only within a source grid square with four known observations.
export function weatherRasters(region:WeatherRegion, cells:Cell[], field:MapWeatherField, sample?:(lon:number,lat:number)=>number):WeatherRaster[] {
  if (!cells.length) return [];
  const byPosition = new Map(cells.map(c=>[key(c.lon,c.lat),c.state?.[field]]));
  const values = weatherGrid(region).map(([lon,lat])=>byPosition.get(key(lon,lat))??NaN);
  const {cols,rows,bounds:[west,south,east,north]} = region;
  const end = east<west?east+360:east;
  const top = Math.min(85.05112878,north), bottom = Math.max(-85.05112878,south);
  if (top<=bottom || end<=west || (!sample&&!values.some(Number.isFinite))) return [];
  const stops = scales[field].map(([v,color])=>({v,rgb:[1,3,5].map(i=>parseInt(color.slice(i,i+2),16))}));
  const rasters:WeatherRaster[]=[];
  const size=sample?256:128, mTop=mercator(top), mBottom=mercator(bottom);
  for(let left=west;left<end;){
    const right=Math.min(left+120,end,left<180?180:end);
    const offset=left>=180?360:0;
    const pixels=new Uint8ClampedArray(size*size*4);
    for(let py=0;py<size;py++){
      const lat=Math.atan(Math.sinh(mTop+(mBottom-mTop)*(py+.5)/size))*180/Math.PI;
      const y=(north-lat)/(north-south)*(rows-1), row=Math.min(rows-2,Math.max(0,Math.floor(y))), fy=y-row;
      for(let px=0;px<size;px++){
        const lon=left+(right-left)*(px+.5)/size;
        const x=(lon-west)/(end-west)*(cols-1), col=Math.min(cols-2,Math.floor(x)), fx=x-col;
        const i=row*cols+col;
        const upper=values[i]*(1-fx)+values[i+1]*fx,lower=values[i+cols]*(1-fx)+values[i+cols+1]*fx;
        const v=sample?sample(lon>180?lon-360:lon,lat):upper*(1-fy)+lower*fy;
        if(!Number.isFinite(v) || ((field==='precipitation'&&v<=.001||field==='snowDepth'&&v<=0))) continue;
        let j=1;
        while(j<stops.length-1 && v>stops[j].v) j++;
        const a=stops[j-1],b=stops[j],t=Math.min(1,Math.max(0,(v-a.v)/(b.v-a.v)));
        const p=4*(py*size+px);
        for(let k=0;k<3;k++) pixels[p+k]=a.rgb[k]+(b.rgb[k]-a.rgb[k])*t;
        pixels[p+3]=field==='precipitation' ? 255*Math.min(1,Math.sqrt(v)) : 255;
      }
    }
    rasters.push({size,pixels,coordinates:[[left-offset,top],[right-offset,top],[right-offset,bottom],[left-offset,bottom]]});
    left=right;
  }
  return rasters;
}

export function weatherPointText(state:WeatherState,field:WeatherField) {
  const text=state[field]!.toLocaleString('ru-RU',{maximumFractionDigits:field==='soilMoisture'||field==='snowDepth'?3:1});
  if(field!=='precipitation') return text;
  if(state.precipitation!<=.001) return 'Сухо';
  const phase=state.precipitationType;
  const label=phase==='rain'?'дождь':phase==='snow'?'снег':phase==='mixed'?'дождь со снегом':'';
  return [text,label].filter(Boolean).join(' · ');
}
