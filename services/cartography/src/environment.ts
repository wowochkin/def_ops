/** Архив погоды: переносимые JSON-наборы, источник и единицы сохраняются. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Router, HttpError, reply } from '@def-ops/service-kit';
import { validateWeatherDataset, weatherTime, weatherAt, importWeatherCsv, type WeatherDataset } from '../../../packages/core/src/weather';
import { writeAtomic, type TileStore } from './tiles';
import {weatherGrid,type WeatherRegion} from '../../../packages/core/src/weather-region';
import { http, netMessage } from './net';
const uuid = (s: string) => { if (!/^[a-z0-9-]{1,64}$/i.test(s)) throw new HttpError(400, 'invalid', 'Некорректный идентификатор'); return s; };
export class WeatherStore {
  constructor(readonly root: string) {}
  private dir(tenant: string) { return path.join(this.root, createHash('sha256').update(tenant).digest('hex')); }
  async save(tenant: string, input: unknown) {
    const d = validateWeatherDataset(input); d.id = randomUUID();
    await writeAtomic(path.join(this.dir(tenant), `${d.id}.json`), Buffer.from(JSON.stringify(d))); return d;
  }
  async list(tenant: string) {
    const files = await fs.readdir(this.dir(tenant)).catch(() => []);
    const out = [];
    for (const f of files.filter(f => /^[a-z0-9-]+\.json$/i.test(f))) {
      const d = await this.get(tenant, f.slice(0, -5));
      out.push({ id: d.id, name: d.name, region:d.region, source: d.source, rows: d.rows.length, start: d.rows[0].time, end: d.rows.at(-1)!.time, points: [...new Set(d.rows.map(r => `${r.lat},${r.lon}`))] });
    }
    return out;
  }
  async get(tenant: string, id: string): Promise<WeatherDataset> {
    try { return validateWeatherDataset(JSON.parse(await fs.readFile(path.join(this.dir(tenant), `${uuid(id)}.json`), 'utf8'))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'not_found', 'Погодный набор не найден'); throw e; }
  }
  async remove(tenant: string, id: string) { await fs.rm(path.join(this.dir(tenant), `${uuid(id)}.json`), { force: true }); }
}
const API_FIELDS = { temperature: 'temperature_2m', humidity: 'relative_humidity_2m', pressure: 'pressure_msl', windSpeed: 'wind_speed_10m', windDirection: 'wind_direction_10m', gust: 'wind_gusts_10m', cloud: 'cloud_cover', precipitation: 'precipitation', snowDepth: 'snow_depth', soilTemperature: 'soil_temperature_0_to_7cm', soilMoisture: 'soil_moisture_0_to_7cm' } as const;
export async function fetchArchive(b: { lat: number; lon: number; start: string; end: string }, fetcher = http.fetch, points:[number,number][]=[[b.lon,b.lat]]): Promise<WeatherDataset> {
  if (!Number.isFinite(b.lat) || Math.abs(b.lat) > 90 || !Number.isFinite(b.lon) || Math.abs(b.lon) > 180 || !/^\d{4}-\d{2}-\d{2}$/.test(b.start) || !/^\d{4}-\d{2}-\d{2}$/.test(b.end)) throw Error('Укажите координаты и даты ГГГГ-ММ-ДД');
  const start = weatherTime(`${b.start}T00:00:00Z`), end = weatherTime(`${b.end}T00:00:00Z`);
  if (b.start < '1940-01-01' || end < start || end - start > 366 * 86400000 || end > Date.now()) throw Error('ERA5: период с 1940 года, не более 367 суток за запрос, без будущих дат');
  const key = process.env.OPEN_METEO_API_KEY;
  const url = new URL(key ? 'https://customer-archive-api.open-meteo.com/v1/archive' : 'https://archive-api.open-meteo.com/v1/archive');
  const model=b.start >= '1950-01-01'?'era5_seamless':'era5';
  const p: Record<string, string> = { latitude: points.map(p=>p[1]).join(','), longitude: points.map(p=>p[0]).join(','), start_date: b.start, end_date: b.end, hourly: Object.values(API_FIELDS).join(','), timezone: 'GMT', wind_speed_unit: 'ms', temperature_unit: 'celsius', precipitation_unit: 'mm', models: model };
  if (key) p.apikey = key;
  for (const [k, v] of Object.entries(p)) url.searchParams.set(k, v);
  let response:Response|undefined;
  for(let attempt=0;attempt<3;attempt++) {
    try {
      response=await fetcher(url,{signal:AbortSignal.timeout(120000)});
      if(![429,500,502,503,504].includes(response.status)||attempt===2)break;
      await response.body?.cancel();
    } catch(e) { if(attempt===2)throw new HttpError(502,'weather_source',`Архив погоды недоступен: ${netMessage(e)}`); }
    await new Promise(resolve=>setTimeout(resolve,500*2**attempt));
  }
  if (!response)throw new HttpError(502,'weather_source','Архив погоды не ответил');
  if (!response.ok) throw new HttpError(502, 'weather_source', `Архив погоды ответил ${response.status}; проверьте период, соединение и доступ к API`);
  type ResponseData={hourly?:Record<string,unknown[]>;hourly_units?:Record<string,string>};
  const raw=await response.json() as ResponseData|ResponseData[];
  const results=Array.isArray(raw)?raw:[raw];if(results.length!==points.length)throw Error('Источник вернул неполный набор точек');
  const rows=results.flatMap((data,index)=>{
    if(!data.hourly||!Array.isArray(data.hourly.time)||!data.hourly.time.length||data.hourly.time.length>9000)throw Error('Источник не вернул допустимые почасовые данные');
    if(data.hourly_units?.temperature_2m!=='°C'||data.hourly_units?.wind_speed_10m!=='m/s')throw Error('Неожиданные единицы источника погоды');
    return data.hourly.time.map((t,i)=>({lat:points[index][1],lon:points[index][0],time:`${t}:00Z`,...Object.fromEntries(Object.entries(API_FIELDS).map(([field,api])=>[field,data.hourly![api]?.[i]??null]))}));
  });
  return validateWeatherDataset({version:1,id:randomUUID(),name:`ERA5 · ${points.length>1?`область, ${points.length} узлов`:`${b.lat}, ${b.lon}`} · ${b.start} — ${b.end}`,source:{title:model==='era5'?'Open-Meteo / ERA5 (ECMWF)':'Open-Meteo / ERA5 и ERA5-Land (ECMWF)',kind:'reanalysis',license:'CC BY 4.0; условия доступа API отдельно',url:'https://open-meteo.com/en/docs/historical-weather-api',model:model==='era5'?'ERA5':'ERA5-Seamless',spatialResolution:model==='era5'?'0,25°':'0,1° или 0,25° в зависимости от показателя',temporalResolution:'1 h'},rows});
}
export async function fetchArchiveRegion(b:{start:string;end:string;region:WeatherRegion},fetcher=http.fetch):Promise<WeatherDataset>{
 const points=weatherGrid(b.region);if(points.length>25)throw Error('Архив области: до 25 узлов за пакет');
 const d=await fetchArchive({lat:points[0][1],lon:points[0][0],start:b.start,end:b.end},fetcher,points);d.region=b.region;return validateWeatherDataset(d);
}
export function addWeatherRoutes(r: Router, tiles: TileStore) {
  const store = new WeatherStore(path.join(tiles.root, '.weather'));
  r.get('/cartography/environment/weather', c => store.list(c.tenant));
  r.post('/cartography/environment/weather/import', async c => {
    const b = await c.json<{ dataset?: unknown; csv?: string; source?: WeatherDataset['source']; name?: string }>();
    return store.save(c.tenant, b.csv !== undefined ? importWeatherCsv(b.csv, b.source!, b.name) : b.dataset);
  });
  r.post('/cartography/environment/weather/archive', async c => {const b=await c.json<{lat:number;lon:number;start:string;end:string;region?:WeatherRegion}>();return store.save(c.tenant,b.region?await fetchArchiveRegion({...b,region:b.region}):await fetchArchive(b));});
  r.get('/cartography/environment/weather/:id', c => store.get(c.tenant, c.params.id));
  r.get('/cartography/environment/weather/:id/export', async c => reply(200, await store.get(c.tenant, c.params.id), { 'content-disposition': 'attachment; filename="weather.json"' }));
  r.get('/cartography/environment/weather/:id/at', async c => weatherAt(await store.get(c.tenant, c.params.id), Number(c.query.get('lat')), Number(c.query.get('lon')), c.query.get('time') ?? ''));
  r.delete('/cartography/environment/weather/:id', async c => { await store.remove(c.tenant, c.params.id); return { ok: true }; });
}
