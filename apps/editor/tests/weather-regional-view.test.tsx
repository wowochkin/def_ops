// @vitest-environment happy-dom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {WeatherView,loadWeatherScenario} from '../src/modern/WeatherView';
import {simulateWeather} from '../../../packages/core/src/weather';
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();});
it('показывает региональную норму и сохраняет явный ручной ввод с возвратом к норме',async()=>{
 localStorage.clear();vi.stubGlobal('fetch',vi.fn(async()=>new Response('[]',{headers:{'content-type':'application/json'}})));
 render(<WeatherView catalog={[]}/>);
 const pressure=screen.getByLabelText('Давление, гПа') as HTMLInputElement;
 expect(pressure.value).toBe('');expect(pressure.placeholder).toBe('Региональная норма');
 fireEvent.change(pressure,{target:{value:'980'}});
 await waitFor(()=>expect(JSON.parse(localStorage.getItem('def_ops.modern.weather.scenario')!).manualFields).toContain('pressure'));
 const saved=JSON.parse(localStorage.getItem('def_ops.modern.weather.scenario')!);
 expect(simulateWeather(saved,52,13,saved.start).pressure).toBe(980);
 fireEvent.change(pressure,{target:{value:''}});
 await waitFor(()=>expect(JSON.parse(localStorage.getItem('def_ops.modern.weather.scenario')!).manualFields).not.toContain('pressure'));
});

it('не заменяет сохранённый сценарий с неизвестным профилем новым сценарием',()=>{
 localStorage.clear();
 const original=loadWeatherScenario();
 const saved={...original,climateProfileSha256:'0'.repeat(64)};
 localStorage.setItem('def_ops.modern.weather.scenario',JSON.stringify(saved));
 expect(loadWeatherScenario()).toEqual(saved);
 expect(()=>simulateWeather(loadWeatherScenario(),52,13,saved.start)).toThrow();
});
it('переключение температуры обратно на климат снимает ручной приоритет',async()=>{
 localStorage.clear();vi.stubGlobal('fetch',vi.fn(async()=>new Response('[]',{headers:{'content-type':'application/json'}})));
 render(<WeatherView catalog={[]}/>);
 fireEvent.change(screen.getByLabelText('Основа температуры'),{target:{value:'manual'}});
 fireEvent.change(screen.getByLabelText('Температура, °C'),{target:{value:'-20'}});
 fireEvent.change(screen.getByLabelText('Основа температуры'),{target:{value:'climate'}});
 await waitFor(()=>expect(JSON.parse(localStorage.getItem('def_ops.modern.weather.scenario')!).manualFields).not.toContain('temperature'));
});
