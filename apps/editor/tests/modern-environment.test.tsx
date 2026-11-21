// @vitest-environment happy-dom
import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WeatherView } from '../src/modern/WeatherView';
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();});
it('сценарная погода меняется по времени, сохраняет зерно и явно отделена от архива', async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('[]',{status:200})));
 render(<WeatherView/>);
 expect(screen.getByRole('heading',{name:'Погода'})).toBeTruthy();
 expect(screen.getByText(/Синтетическая погода/)).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Зерно сценария'),{target:{value:'123'}});
 expect(JSON.parse(localStorage.getItem('def_ops.modern.weather.scenario')!).seed).toBe(123);
 fireEvent.change(screen.getByLabelText('Время сценария, часы'),{target:{value:'12'}});
 expect(screen.getByText(/12:00:00/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Архив погоды'}));
 expect(screen.getByLabelText('Начало периода')).toBeTruthy();
 expect(screen.getByText(/1940/)).toBeTruthy();
});
it('длительность задаётся в сутках, шкала длиннее недели; узлы поля доступны для просмотра',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('[]',{status:200})));
 render(<WeatherView/>);
 fireEvent.change(screen.getByLabelText('Длительность сценария'),{target:{value:'30'}});
 expect(screen.getByLabelText('Время сценария, часы').getAttribute('max')).toBe('720');
 expect(JSON.parse(localStorage.getItem('def_ops.modern.weather.scenario')!).durationHours).toBe(720);
 const field=screen.getByRole('group',{name:'Узлы погодного поля'});
 expect(field.querySelectorAll('button')).toHaveLength(25);
 fireEvent.click(field.querySelector('button')!);
 expect((screen.getByLabelText('Широта') as HTMLInputElement).value).toBe('52.6');
});
