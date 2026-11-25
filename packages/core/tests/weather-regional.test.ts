import {expect,it} from 'vitest';
import {simulateWeather,validateWeatherScenario,precipitationFrame,type WeatherScenario} from '../src/weather';
import {simulateRegionalWeather,regionalAtmosphere} from '../src/weather-regional';
import {regionalRainAt} from '../src/weather-regional-episodes';
import {REGIONAL_CLIMATE_PROFILE,sampleRegionalClimate} from '../src/weather-climate-profile';
const legacy:WeatherScenario={version:1,seed:42,start:'2020-01-01T00:00:00Z',temperature:10,humidity:70,pressure:1013,windSpeed:4,windDirection:180,cloud:40,precipitation:0,variability:1,transitionHours:3,durationHours:48};
const regional=():WeatherScenario=>({...legacy,algorithmVersion:2,climateProfileId:REGIONAL_CLIMATE_PROFILE.id,climateProfileSha256:REGIONAL_CLIMATE_PROFILE.sha256});
it('сохраняет численный эталон старого алгоритма без версии и с версией 1',()=>{
 const expected={provenance:'synthetic',temperature:11.076281164193432,humidity:78.86242180398855,pressure:1013.6041778291685,windSpeed:5.545444267424111,windDirection:167.26141436430726,gust:6.0313449827915395,cloud:51.81656240531808,precipitation:0,precipitationType:'none',visibility:15000,snowDepth:0,soilTemperature:10,soilMoisture:.25};
 expect(simulateWeather(legacy,52,13,legacy.start)).toEqual(expected);
 expect(simulateWeather({...legacy,algorithmVersion:1},52,13,legacy.start)).toEqual(expected);
});
it('берёт атмосферную базу из местных норм и воспроизводит сохранённый сценарий',()=>{
 const s={...regional(),variability:0,rain:{mode:'background' as const}};
 const a=regionalAtmosphere(s,52,13,s.start),normal=sampleRegionalClimate(52,13,s.start);
 for(const key of ['temperature','humidity','pressure','windSpeed','windDirection','cloud'] as const)expect(a[key]).toBeCloseTo(normal[key]!,8);
 expect(simulateWeather(s,52,13,s.start)).toEqual(simulateRegionalWeather(s,52,13,s.start));
 expect(simulateWeather(JSON.parse(JSON.stringify(s)),52,13,s.start)).toEqual(simulateWeather(s,52,13,s.start));
 expect(simulateWeather(s,-6.2,106.8,s.start).temperature).not.toBe(a.temperature);
});
it('автоматические эпизоды имеют местные ключи, сухие интервалы и разные хронологии',()=>{
 const s=regional();
 const berlin=[],jakarta=[];
 for(let h=0;h<=48;h++){
  const time=new Date(Date.parse(s.start)+h*3600000).toISOString();
  const b=regionalRainAt(s,52,13,time),j=regionalRainAt(s,-6.2,106.8,time);
  expect(b).toEqual(regionalRainAt(s,52,13,time));
  berlin.push(b.intensity);jakarta.push(j.intensity);
 }
 expect(berlin.some(v=>v!==null&&v>0)).toBe(true);expect(berlin.some(v=>v===0)).toBe(true);
 expect(berlin).not.toEqual(jakarta);
});
it('растровая выборка осадков совпадает с точечным расчётом',()=>{
 const s=regional(),time='2020-01-01T12:00:00Z';
 expect(precipitationFrame(s,time)(13,52)).toBe(simulateWeather(s,52,13,time).precipitation);
});
it('ручные поля и ключевые состояния имеют приоритет над климатом',()=>{
 const s={...regional(),temperatureMode:'manual' as const,temperature:-10,humidity:12,pressure:950,variability:0,manualFields:['humidity','pressure'] as const,rain:{mode:'background' as const},keyframes:[{hour:2,values:{temperature:-20,humidity:22}}]};
 expect(simulateWeather(s,52,13,'2020-01-01T01:00:00Z')).toMatchObject({temperature:-15,humidity:17,pressure:950});
});
it('отклоняет неизвестный алгоритм и подменённый профиль вместо молчаливой смены модели',()=>{
 expect(()=>validateWeatherScenario({...regional(),manualFields:['gust']} as never)).toThrow();
 expect(()=>validateWeatherScenario({...regional(),algorithmVersion:3} as never)).toThrow();
 expect(()=>validateWeatherScenario({...regional(),climateProfileSha256:'0'.repeat(64)})).toThrow();
 expect(()=>validateWeatherScenario({...regional(),climateProfileId:undefined})).toThrow();
});
it('поля непрерывны через антимеридиан и соседние моменты',()=>{
 const s=regional(),time='2020-01-01T12:00:00Z';
 const a=regionalAtmosphere(s,10,180,time),b=regionalAtmosphere(s,10,-180,time);
 expect(a).toEqual(b);
 const c=regionalAtmosphere(s,10,179.99999,'2020-01-01T12:00:01Z');
 for(const key of ['temperature','humidity','pressure','windSpeed','cloud','precipitation'] as const)expect(a[key]!).toBeCloseTo(c[key]!,2);
});
