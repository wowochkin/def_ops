import {expect,it} from 'vitest';
import {regionalContext} from '../src/weather-regional-context';
import {simulateRegionalWeather} from '../src/weather-regional';
import {REGIONAL_CLIMATE_PROFILE} from '../src/weather-climate-profile';
import type {WeatherScenario} from '../src/weather';
const scenario:WeatherScenario={version:1,algorithmVersion:2,climateProfileId:REGIONAL_CLIMATE_PROFILE.id,climateProfileSha256:REGIONAL_CLIMATE_PROFILE.sha256,seed:1,start:'2024-11-01T00:00:00Z',temperatureMode:'manual',temperature:4,humidity:70,pressure:1013,windSpeed:4,windDirection:180,cloud:40,precipitation:12,variability:0,transitionHours:3,rain:{mode:'background'}};
it('сохраняет неизвестные данные и фактические идентификаторы источников',()=>{
 expect(regionalContext({elevationM:null,landcoverClass:null,demId:'dem'})).toMatchObject({elevationM:null,landcoverClass:null,sourceIds:['dem']});
 expect(()=>regionalContext({elevationM:NaN,landcoverClass:10})).toThrow();
 expect(()=>regionalContext({elevationM:0,landcoverClass:11})).toThrow();
});
it('корректирует местную температуру, давление и фазу осадков до расчёта снега',()=>{
 const low=regionalContext({elevationM:0,landcoverClass:10,demId:'dem',landcoverId:'cover'}),high=regionalContext({elevationM:1000,landcoverClass:10,demId:'dem',landcoverId:'cover'});
 const a=simulateRegionalWeather(scenario,52,13,scenario.start,low),b=simulateRegionalWeather(scenario,52,13,scenario.start,high);
 expect(a.temperature!-b.temperature!).toBeCloseTo(6.5,8);expect(b.pressure!).toBeLessThan(a.pressure!);
 expect(a.precipitationType).toBe('rain');expect(b.precipitationType).toBe('snow');
 expect(b.snowDepth!).toBeGreaterThan(a.snowDepth!);
});
it('выбранная ЦМР с пропуском даёт явное ограничение вместо вымышленной высоты',()=>{
 const state=simulateRegionalWeather(scenario,52,13,scenario.start,regionalContext({elevationM:null,landcoverClass:null,demId:'missing'}));
 expect(state.surfaceContext?.limitations.join(' ')).toContain('Недостаточно данных о высоте');
 expect(state.surfaceContext?.mode).toBe('PARTIAL');
});
it('фактический водный покров не выдаётся за грунт',()=>{
 const state=simulateRegionalWeather(scenario,52,13,scenario.start,regionalContext({elevationM:0,landcoverClass:80,demId:'dem',landcoverId:'cover'}));
 expect(state.soilMoisture).toBeNull();expect(state.snowDepth).toBeNull();
});

it('не пропускает нечисловую высоту при прямом вызове модели',()=>{
 expect(()=>simulateRegionalWeather(scenario,52,13,scenario.start,{elevationM:NaN,landcoverClass:null,sourceIds:['dem'],demId:'dem'})).toThrow();
});

it('учитывает фактически выбранную застройку в упрощённой инфильтрации',()=>{
 const at=scenario.start;
 const forest=simulateRegionalWeather(scenario,52,13,at,regionalContext({elevationM:null,landcoverClass:10,landcoverId:'cover'}));
 const urban=simulateRegionalWeather(scenario,52,13,at,regionalContext({elevationM:null,landcoverClass:50,landcoverId:'cover'}));
 expect(urban.soilMoisture!).toBeLessThan(forest.soilMoisture!);
});
