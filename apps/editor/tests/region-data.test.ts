import {expect,it} from 'vitest';
import {geoJsonExample} from '../src/modern/GeoJsonHelp';
import {regionZoom} from '../src/modern/region-layers';
import {surfacePreview} from '../src/modern/scenario-surface';
import {simulateWeather,type WeatherScenario} from '../../../packages/core/src/weather';
const s:WeatherScenario={version:1,seed:17,start:'2020-01-01T00:00:00Z',temperature:-5,humidity:60,precipitation:0,windSpeed:3,windDirection:0,pressure:1013,cloud:40,variability:0,transitionHours:3,rain:{mode:'event',startHour:1,durationHours:8,intensity:15}};
function frame(hour:number,scenario=s){
 const time=new Date(Date.parse(s.start)+hour*3600000).toISOString();
 return surfacePreview(scenario,time)(simulateWeather(scenario,0,0,time));
}
it('показывает изменения трёх слоёв в эпизоде, восстанавливает кадр при перемотке',()=>{
 const start=frame(0),middle=frame(6),later=frame(24);
 expect(middle.visibility!).toBeLessThan(start.visibility!);
 expect(middle.snowDepth!).toBeGreaterThan(start.snowDepth!);
 expect(middle.soilMoisture!).toBeGreaterThan(later.soilMoisture!);
 expect(frame(6)).toEqual(middle);
 expect(frame(6,{...s,temperature:25}).snowDepth).toBe(0);
 expect(frame(6,{...s,snowDepth:0,visibility:500,soilMoisture:.2})).toMatchObject({snowDepth:0,visibility:500,soilMoisture:.2});
 expect(frame(6,{...s,keyframes:[{hour:6,values:{soilMoisture:.32}}]}).soilMoisture).toBe(.32);
});
it('подбирает масштабы и пример объектов при пересечении антимеридиана',()=>{
 expect(regionZoom([-180,-80,180,80]).tiles).toBeLessThanOrEqual(3000);
 expect(regionZoom([179,50,-179,52]).tiles).toBeLessThanOrEqual(3000);
 expect(geoJsonExample([178,50,-179,52]).features[0].geometry).toMatchObject({coordinates:[179.5,51]});
});
