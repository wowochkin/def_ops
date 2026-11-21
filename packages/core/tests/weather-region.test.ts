import {it,expect} from 'vitest';
import {weatherGrid,simulateWeatherRegion} from '../src/weather-region';
import {simulateWeather,validateWeatherScenario,type WeatherScenario} from '../src/weather';
const s:WeatherScenario={version:1,seed:42,start:'2020-01-01T00:00:00Z',temperature:10,humidity:70,pressure:1013,windSpeed:4,windDirection:180,cloud:40,precipitation:0,variability:1,transitionHours:3,durationHours:24*90,keyframes:[{hour:24*60,values:{temperature:0}}]};
it('срок больше недели задаётся сценарием, ключи и длительные переходы допустимы',()=>{expect(()=>validateWeatherScenario({...s,transitionHours:24*30})).not.toThrow();expect(simulateWeather(s,52,13,'2020-03-01T00:00:00Z').temperature).toBeTypeOf('number');expect(()=>validateWeatherScenario({...s,durationHours:0})).toThrow();});
it('сетка области сохраняет охват и корректно пересекает антимеридиан',()=>{const grid=weatherGrid({bounds:[170,40,-170,50],cols:3,rows:3});expect(grid).toHaveLength(9);expect(grid[0]).toEqual([170,50]);expect(grid[1][0]).toBe(-180);expect(grid[8]).toEqual([-170,40]);expect(()=>weatherGrid({bounds:[0,50,1,40],cols:3,rows:3})).toThrow();});
it('в каждой ячейке — та же погода, что в точечном запросе; сетка не меняет поле',()=>{const region={bounds:[12,51,14,53] as [number,number,number,number],cols:3,rows:3};const data=simulateWeatherRegion(s,region,s.start);expect(data.cells).toHaveLength(9);expect(data.cells[4].state).toEqual(simulateWeather(s,52,13,s.start));});
it('поле осадков содержит сухие и влажные участки, меняется во времени и повторяется при перемотке',()=>{
 const region={bounds:[12,51,14,53] as [number,number,number,number],cols:25,rows:25};
 const frame=(t:string)=>simulateWeatherRegion(s,region,t).cells.map(c=>c.state.precipitation!);
 const a=frame(s.start),b=frame('2020-01-01T00:10:00Z');
 expect(Math.min(...a)).toBe(0);
 expect(Math.max(...a)).toBeGreaterThan(1);
 expect(b).not.toEqual(a);
 expect(frame(s.start)).toEqual(a);
});
