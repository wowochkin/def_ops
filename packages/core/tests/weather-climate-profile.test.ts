import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import profile from '../src/climate/regional-v2.json' with {type:'json'};
import {sampleRegionalClimate,REGIONAL_CLIMATE_PROFILE} from '../src/weather-climate-profile';
it('хранит нормы с проверяемым происхождением и единицами каждого поля',()=>{
 expect(profile.schemaVersion).toBe(2);expect(profile.months).toHaveLength(12);
 for(const field of ['temperature','pressure','windU','windV','cloud','precipitation','specificHumidity','soilTemperature','soilMoisture'] as const){
  const data=profile.fields[field];
  expect(data.values).toHaveLength(12*profile.lat.length*profile.longitudeCount);
  expect(data.source.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(data.source.url).toMatch(/^https:\/\//);
  expect(data.source.units).toBeTruthy();expect(data.units).toBeTruthy();
  expect(data.values.every(v=>v===null||Number.isFinite(v))).toBe(true);
 }
 expect(REGIONAL_CLIMATE_PROFILE.sha256).toBe(createHash('sha256').update(readFileSync(new URL('../src/climate/regional-v2.json',import.meta.url))).digest('hex'));
});
it('различает климат координат и возвращает физические единицы',()=>{
 const cold=sampleRegionalClimate(52,13,'2024-01-15T00:00:00Z');
 const hot=sampleRegionalClimate(0,105,'2024-01-15T00:00:00Z');
 expect(cold.temperature!).toBeLessThan(hot.temperature!);
 expect(cold.precipitation).not.toBe(hot.precipitation);
 expect(hot.pressure).toBeGreaterThan(900);expect(hot.pressure).toBeLessThan(1100);
 expect(hot.humidity).toBeGreaterThan(0);expect(hot.humidity).toBeLessThan(100);
 expect(hot.windSpeed!).toBeGreaterThanOrEqual(0);
 expect(hot.soilTemperature!).toBeGreaterThan(-100);expect(cold.soilMoisture!).toBeLessThanOrEqual(1);
});
it('не создаёт разрывов у антимеридиана и на границе года',()=>{
 const a=sampleRegionalClimate(40,180,'2024-12-31T23:59:59Z');
 const b=sampleRegionalClimate(40,-180,'2025-01-01T00:00:00Z');
 for(const field of ['temperature','pressure','windU','windV','cloud','precipitation','humidity'] as const)expect(a[field]!).toBeCloseTo(b[field]!,3);
 expect(()=>sampleRegionalClimate(91,0,'2024-01-15T00:00:00Z')).toThrow();
});

it('сохраняет отсутствие норм грунта над океаном',()=>{
 expect(sampleRegionalClimate(0,-140,'2024-01-15T00:00:00Z').soilMoisture).toBeNull();
});
