import { it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WeatherStore, fetchArchive } from '../src/environment';
it('архив сохраняется после перезапуска, изолирован по организации, проверяет импорт', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'weather-'));
  try {
    const store = new WeatherStore(dir);
    const d = await store.save('t1', { version: 1, id: 'input', name: 'Тест', source: { title: 'Тест', kind: 'observation', license: 'test', spatialResolution: 'точка', temporalResolution: 'час' }, rows: [{ lat: 0, lon: 0, time: '2020-01-01T00:00:00Z', temperature: 0 }] });
    expect((await new WeatherStore(dir).get('t1', d.id)).rows[0].temperature).toBe(0);
    expect(await store.list('t2')).toEqual([]);
    await expect(store.save('t1', {})).rejects.toThrow();
    expect(await store.list('t1')).toHaveLength(1);
    await expect(store.get('t1', '../../secret')).rejects.toThrow();
    await store.remove('t1', d.id); expect(await store.list('t1')).toHaveLength(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('Open-Meteo: нулевые значения и пропуски, UTC, реанализ и единицы', async () => {
  let url = '';
  const fake = (async (input: string | URL | Request) => { url = String(input); return new Response(JSON.stringify({ hourly_units: { temperature_2m: '°C', relative_humidity_2m: '%', pressure_msl: 'hPa', wind_speed_10m: 'm/s', wind_direction_10m: '°', wind_gusts_10m: 'm/s', cloud_cover: '%', precipitation: 'mm' }, hourly: { time: ['2020-01-01T00:00'], temperature_2m: [0], wind_speed_10m: [null] } })); }) as typeof fetch;
  const d = await fetchArchive({ lat: 52, lon: 13, start: '2020-01-01', end: '2020-01-01' }, fake);
  expect(url).toContain('wind_speed_unit=ms'); expect(url).toContain('models=era5');
  expect(d.rows[0]).toMatchObject({ lat: 52, lon: 13, time: '2020-01-01T00:00:00.000Z', temperature: 0, windSpeed: null });
  expect(d.source.kind).toBe('reanalysis');
  await expect(fetchArchive({ lat: 91, lon: 0, start: '2020-01-01', end: '2020-01-01' }, fake)).rejects.toThrow();
  await expect(fetchArchive({ lat: 0, lon: 0, start: '1939-01-01', end: '1940-01-01' }, fake)).rejects.toThrow();
});
it('короткий сетевой сбой архива повторяет запрос, без потери результата',async()=>{
 let attempts=0;
 const fake=(async()=>{if(++attempts===1)throw TypeError('fetch failed');return new Response(JSON.stringify({hourly_units:{temperature_2m:'°C',wind_speed_10m:'m/s'},hourly:{time:['2020-01-01T00:00'],temperature_2m:[5],wind_speed_10m:[2]}}));}) as typeof fetch;
 expect((await fetchArchive({lat:0,lon:0,start:'2020-01-01',end:'2020-01-01'},fake)).rows).toHaveLength(1);
 expect(attempts).toBe(2);
});
it('область архива запрашивается пакетом точек и сохраняет географическую сетку',async()=>{
 const {fetchArchiveRegion}=await import('../src/environment');let url='';
 const fake=(async(input:unknown)=>{url=String(input);return new Response(JSON.stringify(Array.from({length:4},()=>({hourly_units:{temperature_2m:'°C',wind_speed_10m:'m/s'},hourly:{time:['2020-01-01T00:00'],temperature_2m:[5],wind_speed_10m:[2]}}))));}) as typeof fetch;
 const d=await fetchArchiveRegion({start:'2020-01-01',end:'2020-01-01',region:{bounds:[12,51,14,53],cols:2,rows:2}},fake);
 expect(d.region?.bounds).toEqual([12,51,14,53]);expect(d.rows).toHaveLength(4);expect(new URL(url).searchParams.get('latitude')).toBe('53,53,51,51');
});
