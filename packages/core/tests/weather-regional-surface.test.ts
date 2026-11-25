import {expect,it} from 'vitest';
import {regionalSurfaceState,REGIONAL_SURFACE_PROFILE_V2} from '../src/weather-regional-surface';
import {simulateWeather,type WeatherScenario} from '../src/weather';
import {REGIONAL_CLIMATE_PROFILE} from '../src/weather-climate-profile';
const base:WeatherScenario={version:1,algorithmVersion:2,climateProfileId:REGIONAL_CLIMATE_PROFILE.id,climateProfileSha256:REGIONAL_CLIMATE_PROFILE.sha256,seed:42,start:'2024-11-01T00:00:00Z',temperatureMode:'manual',temperature:10,humidity:70,pressure:1013,windSpeed:4,windDirection:180,cloud:40,precipitation:0,variability:0,transitionHours:3,durationHours:168,rain:{mode:'background'}};
it('прошлый дождь меняет грунт при одинаковой текущей сухой погоде',()=>{
 const wet={...base,rain:{mode:'event' as const,startHour:0,durationHours:24,intensity:24}};
 const at='2024-11-02T06:00:00Z';
 expect(simulateWeather(wet,52,13,at).precipitation).toBe(0);
 expect(simulateWeather(base,52,13,at).precipitation).toBe(0);
 expect(regionalSurfaceState(wet,52,13,at).soilMoisture!).toBeGreaterThan(regionalSurfaceState(base,52,13,at).soilMoisture!);
});
it('накапливает местный снег и воспроизводит его после перемотки',()=>{
 const snow={...base,temperature:-10,rain:{mode:'event' as const,startHour:0,durationHours:24,intensity:12}};
 const at='2024-11-02T06:00:00Z',state=regionalSurfaceState(snow,52,13,at);
 expect(state.snowDepth!).toBeGreaterThan(0);
 expect(state).toEqual(regionalSurfaceState(JSON.parse(JSON.stringify(snow)),52,13,at));
 expect(simulateWeather(snow,52,13,at)).toMatchObject(state);
});
it('сохраняет ручные поверхностные значения и ключи',()=>{
 const s={...base,soilMoisture:.7,snowDepth:2,soilTemperature:15,visibility:1000,keyframes:[{hour:2,values:{soilMoisture:.9,snowDepth:4}}]};
 expect(simulateWeather(s,52,13,'2024-11-01T01:00:00Z')).toMatchObject({soilMoisture:.8,snowDepth:3,soilTemperature:15,visibility:1000});
});
it('не заполняет неизвестную влажность грунта над океаном',()=>{
 expect(regionalSurfaceState(base,0,-140,base.start).soilMoisture).toBeNull();
});
it('ограничивает баланс диапазонами и явно помечает учебные коэффициенты',()=>{
 const s={...base,temperature:-70,rain:{mode:'event' as const,startHour:0,durationHours:72,intensity:200}};
 const state=regionalSurfaceState(s,52,13,'2024-11-03T23:00:00Z');
 expect(state.snowDepth!).toBeGreaterThanOrEqual(0);expect(state.soilMoisture!).toBeGreaterThanOrEqual(0);expect(state.soilMoisture!).toBeLessThanOrEqual(1);
 expect(REGIONAL_SURFACE_PROFILE_V2.historyHours).toBe(72);
 expect(REGIONAL_SURFACE_PROFILE_V2.basis).toContain('учебное допущение');
});
