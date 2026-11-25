import {expect,it} from 'vitest';
import {weatherRenderRegion} from '../src/modern/weather-domain';
import {weatherRasters} from '../src/modern/weather-layer';
import {simulateWeatherRegion,type WeatherRegion} from '../../../packages/core/src/weather-region';
import type {WeatherScenario} from '../../../packages/core/src/weather';
const region:WeatherRegion={bounds:[35,49,37,51],cols:3,rows:3};
const scenario:WeatherScenario={version:1,seed:42,start:'2020-01-01T00:00:00Z',temperature:10,humidity:70,pressure:1013,windSpeed:4,windDirection:180,cloud:40,precipitation:0,variability:1,transitionHours:3,durationHours:24,keyframes:[]};
it('сохраняет модельную область и ограничивает отображение пересечением',()=>{
 expect(weatherRenderRegion(region,[-180,-85,180,85])).toMatchObject({modelBounds:[35,49,37,51],renderBounds:[35,49,37,51]});
 expect(weatherRenderRegion(region,[36,49.5,36.5,50]).renderBounds).toEqual([36,49.5,36.5,50]);
 expect(weatherRenderRegion(region,[0,0,1,1]).renderBounds).toBeNull();
 expect(weatherRenderRegion(region,undefined).renderBounds).toEqual(region.bounds);
});
it('обрезает растр по камере, сохраняя координаты интерполяции исходной сетки',()=>{
 const cells=simulateWeatherRegion(scenario,region,scenario.start).cells;
 const all=weatherRasters(region,cells,'temperature');
 const cropped=weatherRasters(region,cells,'temperature',undefined,[36,49.5,36.5,50]);
 expect(all[0].coordinates).toEqual([[35,51],[37,51],[37,49],[35,49]]);
 expect(cropped[0].coordinates).toEqual([[36,50],[36.5,50],[36.5,49.5],[36,49.5]]);
 expect(cropped[0].pixels.some((v,i)=>i%4===3&&v>0)).toBe(true);
 expect(weatherRasters(region,cells,'temperature',undefined,[0,0,1,1])).toEqual([]);
 expect(weatherRasters(region,cells,'temperature',undefined,null)).toEqual([]);
 expect(weatherRasters(region,cells,'temperature')[0].pixels).toEqual(all[0].pixels);
});
it('учитывает антимеридиан и повтор мира камеры',()=>{
 const wrapped={...region,bounds:[170,-10,-170,10] as WeatherRegion['bounds']};
 expect(weatherRenderRegion(wrapped,[175,-5,-175,5]).renderBounds).toEqual([175,-5,-175,5]);
 expect(weatherRenderRegion(region,[395,49,397,51]).renderBounds).toEqual([35,49,37,51]);
 const cells=simulateWeatherRegion(scenario,wrapped,scenario.start).cells;
 const raster=weatherRasters(wrapped,cells,'temperature',undefined,[175,-5,-175,5]);
 expect(raster.map(r=>r.coordinates)).toEqual([[[175,5],[180,5],[180,-5],[175,-5]],[[-180,5],[-175,5],[-175,-5],[-180,-5]]]);
});
it('не переносит видимый участок мировой модели в соседний оборот долготы',()=>{
 const world:WeatherRegion={bounds:[-180,-80,180,80],cols:3,rows:3};
 const cells=simulateWeatherRegion(scenario,world,scenario.start).cells;
 const raster=weatherRasters(world,cells,'temperature',undefined,[35,49,37,51]);
 expect(raster[0].coordinates).toEqual([[35,51],[37,51],[37,49],[35,49]]);
});


it('режим обзорной OSM использует всю видимую карту, а не рамку выбранной области',()=>{
 expect(weatherRenderRegion(region,[10,48,12,51],true)).toMatchObject({modelBounds:[10,48,12,51],renderBounds:[10,48,12,51],renderRegions:[[10,48,12,51]]});
 expect(weatherRenderRegion(region,undefined,true).modelBounds).toEqual([-180,-85.05112878,180,85.05112878]);
 expect(weatherRenderRegion(region,[10,48,12,51],false).modelBounds).toEqual(region.bounds);
});
