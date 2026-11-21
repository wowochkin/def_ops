import {describe,expect,it} from 'vitest';
import {weatherGrid,type WeatherRegion} from '../../../packages/core/src/weather-grid';
import {weatherPointText,weatherRasters} from '../src/modern/weather-layer';

const region:WeatherRegion={bounds:[10,40,12,41],cols:3,rows:2};
function cells(r:WeatherRegion,amounts:(number|null)[]){
 return weatherGrid(r).map(([lon,lat],i)=>({lon,lat,state:{provenance:'reanalysis' as const,precipitation:amounts[i]}})).reverse();
}
describe('Площадной слой осадков',()=>{
 it('интерполирует внутри рамки независимо от порядка наблюдений',()=>{
  const [a]=weatherRasters(region,cells(region,[0,2,10,0,2,10]),'precipitation');
  expect(a.coordinates).toEqual([[10,41],[12,41],[12,40],[10,40]]);
  const color=(x:number)=>Array.from(a.pixels.slice(x*4,x*4+4));
  expect(color(10)[3]).toBeGreaterThan(0);
  expect(color(10)[3]).toBeLessThan(color(40)[3]);
  expect(color(10)).not.toEqual(color(40));
  expect(color(40)).not.toEqual(color(90));
 });
 it('оставляет прозрачной ячейку с пропуском, сохраняя соседнюю',()=>{
  const [a]=weatherRasters(region,cells(region,[null,2,2,0,2,2]),'precipitation');
  expect(a.pixels[3]).toBe(0);
  expect(a.pixels[a.size*4-1]).toBe(255);
 });
 it('оставляет сухой район прозрачным',()=>{
  const [a]=weatherRasters(region,cells(region,Array(6).fill(0)),'precipitation');
  expect(a.pixels.some(x=>x!==0)).toBe(false);
  expect(weatherPointText({provenance:'synthetic',precipitation:0},'precipitation')).toBe('Сухо');
 });
 it('разделяет слой на линии перемены дат',()=>{
  const r:WeatherRegion={...region,bounds:[179,-1,-179,1]};
  const rasters=weatherRasters(r,cells(r,Array(6).fill(4)),'precipitation');
  expect(rasters.map(a=>[a.coordinates[0][0],a.coordinates[1][0]])).toEqual([[179,180],[-180,-179]]);
  expect(rasters.every(a=>a.pixels[3]===255)).toBe(true);
 });
 it('выводит вид осадков только при наличии данных',()=>{
  expect(weatherPointText({provenance:'synthetic',precipitation:2,precipitationType:'snow'},'precipitation')).toBe('2 · снег');
  expect(weatherPointText({provenance:'reanalysis',precipitation:2},'precipitation')).toBe('2');
 });
});
