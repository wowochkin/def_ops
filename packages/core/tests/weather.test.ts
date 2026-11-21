import { describe, it, expect } from 'vitest';
import { simulateWeather, weatherAt, validateWeatherDataset, importWeatherCsv, type WeatherDataset, type WeatherScenario } from '../src/weather';
const dataset = (): WeatherDataset => ({ version: 1, id: 'example', name: 'Архив', source: { title: 'Станция', kind: 'observation', license: 'test', spatialResolution: 'точка', temporalResolution: '1 h' }, rows: [
  { lat: 52, lon: 13, time: '2020-01-01T00:00:00Z', temperature: 0, windDirection: 350, windSpeed: 2 },
  { lat: 52, lon: 13, time: '2020-01-01T01:00:00Z', temperature: 10, windDirection: 10, windSpeed: 4 },
] });
const scenario: WeatherScenario = { version: 1, seed: 42, start: '2020-01-01T00:00:00Z', temperature: 5, humidity: 70, pressure: 1013, windSpeed: 4, windDirection: 350, cloud: 50, precipitation: 0, variability: 1, transitionHours: 3 };
describe('погода', () => {
  it('линейное время и направление через север, без экстраполяции', () => {
    expect(weatherAt(dataset(), 52, 13, '2020-01-01T00:30:00Z')).toMatchObject({ temperature: 5, windDirection: 0, windSpeed: 3, provenance: 'interpolated' });
    expect(weatherAt(dataset(), 52, 13, '2019-12-31T23:00:00Z')).toBeNull();
    expect(weatherAt(dataset(), 51, 13, '2020-01-01T00:00:00Z')).toBeNull();
  });
  it('пропущенная величина остаётся пропуском, точное измерение не теряется', () => {
    const d = dataset(); d.rows[1].temperature = null;
    expect(weatherAt(d, 52, 13, '2020-01-01T00:30:00Z')?.temperature).toBeNull();
    expect(weatherAt(d, 52, 13, d.rows[0].time)?.temperature).toBe(0);
  });
  it('не принимает невозможные даты, координаты, величины и дубликаты', () => {
    for (const patch of [{ lat: 91 }, { humidity: 101 }, { time: '2020-02-30T00:00:00Z' }, { windSpeed: -1 }]) {
      const d = dataset(); Object.assign(d.rows[0], patch); expect(() => validateWeatherDataset(d)).toThrow();
    }
    const d = dataset(); d.rows.push({ ...d.rows[0] }); expect(() => validateWeatherDataset(d)).toThrow();
  });
  it('CSV сохраняет UTC, пропуски, кавычки и происхождение', () => {
    const d = importWeatherCsv('lat,lon,time,temperature,humidity\n52,13,"2020-01-01T00:00:00Z",5,\n', { title: 'Мой архив', kind: 'observation', license: 'собственные данные', spatialResolution: 'точка', temporalResolution: '1 h' });
    expect(d.rows[0]).toMatchObject({ temperature: 5, humidity: null });
    expect(d.source.title).toBe('Мой архив');
    expect(() => importWeatherCsv('lat,lon,time,temperature\n52,13,вчера,5', d.source)).toThrow();
  });
  it('сценарий воспроизводим после сохранения и скачков времени; не зависит от кадров', () => {
    const restored = JSON.parse(JSON.stringify(scenario));
    const a = simulateWeather(scenario, 52, 13, '2020-01-01T12:15:00Z');
    for (let i = 0; i < 60; i++) simulateWeather(scenario, 52, 13, new Date(Date.parse(scenario.start) + i * 1000).toISOString());
    expect(simulateWeather(restored, 52, 13, '2020-01-01T12:15:00Z')).toEqual(a);
    expect(simulateWeather({ ...scenario, seed: 43 }, 52, 13, '2020-01-01T12:15:00Z')).not.toEqual(a);
  });
  it('поле пространственно и временно непрерывно, физические границы соблюдены', () => {
    const a = simulateWeather(scenario, 52, 13, '2020-01-01T12:15:00Z');
    const b = simulateWeather(scenario, 52.0001, 13.0001, '2020-01-01T12:15:01Z');
    expect(Math.abs(a.temperature! - b.temperature!)).toBeLessThan(.01);
    for (let i = 0; i < 100; i++) {
      const s = simulateWeather({ ...scenario, temperature: -40, humidity: 100, precipitation: 10 }, i % 90, i, new Date(Date.parse(scenario.start) + i * 3600000).toISOString());
      expect(s.humidity).toBeLessThanOrEqual(100); expect(s.windSpeed).toBeGreaterThanOrEqual(0); expect(s.precipitation).toBeGreaterThanOrEqual(0); expect(s.precipitationType).toBe('snow');
    }
    expect(() => simulateWeather({ ...scenario, transitionHours: 0 }, 52, 13, scenario.start)).toThrow();
  });
});
it('ручные погодные состояния интерполируются и сохраняются после последнего ключа',()=>{
 const scripted={...scenario,variability:0,keyframes:[{hour:2,values:{temperature:-10,precipitation:4}}]};
 expect(simulateWeather(scripted,52,13,'2020-01-01T01:00:00Z')).toMatchObject({temperature:-2.5,precipitation:2});
 expect(simulateWeather(scripted,52,13,'2020-01-01T03:00:00Z')).toMatchObject({temperature:-10,precipitation:4,precipitationType:'snow'});
 expect(()=>simulateWeather({...scenario,keyframes:[{hour:2,values:{humidity:200}}]},52,13,scenario.start)).toThrow();
});

it('норма температуры учитывает сезон, координаты и сохраняется на стыке месяцев',()=>{
 const seasonal={...scenario,temperatureMode:'climate' as const,variability:0};
 const t=(lat:number,lon:number,time:string)=>simulateWeather(seasonal,lat,lon,time).temperature!;
 const november=t(50,30,'2024-11-15T00:00:00Z');
 expect(november).toBeGreaterThan(-5);expect(november).toBeLessThan(10);
 expect(t(50,30,'2024-07-15T00:00:00Z')).toBeGreaterThan(november+10);
 expect(t(-33,151,'2024-07-15T00:00:00Z')).toBeLessThan(t(-33,151,'2024-01-15T00:00:00Z'));
 expect(t(50,30,'2024-12-31T23:59:59Z')).toBeCloseTo(t(50,30,'2025-01-01T00:00:00Z'),4);
 expect(t(20,180,'2024-11-15T00:00:00Z')).toBe(t(20,-180,'2024-11-15T00:00:00Z'));
});

it('длительный эпизод занимает несколько часов в одной точке, растр и точка дают одинаковые показания',async()=>{
 const {precipitationFrame}=await import('../src/weather');
 const s:WeatherScenario={...scenario,rain:{mode:'event',startHour:2,durationHours:8,intensity:18},variability:0,visibility:0,soilTemperature:-2,soilMoisture:.29,snowDepth:.2,keyframes:[{hour:8,values:{soilMoisture:.41}}]};
 for(const h of [0,2,3,4,5,6,7,8,9,10,11]){
   const time=new Date(Date.parse(s.start)+h*3600000).toISOString(),state=simulateWeather(s,52,13,time);
   expect(state.precipitation).toBe(h>=3&&h<=9?18:0);
   expect(precipitationFrame(s,time)(13,52)).toBe(state.precipitation);
   expect(state).toMatchObject({visibility:0,soilTemperature:-2,snowDepth:.2});
   expect(state.soilMoisture).toBeCloseTo(.29+.12*Math.min(1,h/8));
 }
});
