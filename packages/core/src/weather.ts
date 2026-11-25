/** Автономная сценарная погода и архивы. Единицы: °C, %, hPa, m/s, градусы, mm/h, m. */
import {simulateRegionalWeather,regionalPrecipitationFrame} from './weather-regional';
import {REGIONAL_CLIMATE_PROFILE} from './weather-climate-profile';
import {episodeIntensity,rainEpisode,validateRainSchedule,type RainSchedule} from './weather-episodes';
import {showerIntensity} from './weather-showers';
import {climateAt} from './weather-climate';
import {weatherGrid,type WeatherRegion} from './weather-grid';
export const WEATHER_FIELDS = ['temperature', 'humidity', 'pressure', 'windSpeed', 'windDirection', 'gust', 'cloud', 'precipitation', 'visibility', 'snowDepth', 'soilTemperature', 'soilMoisture'] as const;
export type WeatherField = typeof WEATHER_FIELDS[number];
export type WeatherValues = Partial<Record<WeatherField, number | null>>;
export interface WeatherSource { title: string; kind: 'observation' | 'reanalysis' | 'synthetic'; license: string; spatialResolution: string; temporalResolution: string; url?: string; model?: string }
export interface WeatherRow extends WeatherValues { lat: number; lon: number; time: string }
export interface WeatherDataset { version: 1; id: string; name: string; source: WeatherSource; rows: WeatherRow[]; region?:WeatherRegion }
export const surfaceFields=['visibility','snowDepth','soilTemperature','soilMoisture'] as const;
export type SurfaceField=typeof surfaceFields[number];
export type ScenarioField = SurfaceField|'temperature'|'humidity'|'pressure'|'windSpeed'|'windDirection'|'cloud'|'precipitation';
export interface WeatherKeyframe { hour:number; values:Partial<Record<ScenarioField,number>> }
export interface WeatherScenario extends Partial<Record<SurfaceField,number>> {
  algorithmVersion?:1|2; climateProfileId?:string; climateProfileSha256?:string; manualFields?:readonly ScenarioField[];
  rain?:RainSchedule;
  version: 1; temperatureMode?: 'climate'|'manual'; seed: number; start: string; temperature: number; humidity: number; pressure: number;
  windSpeed: number; windDirection: number; cloud: number; precipitation: number; variability: number; transitionHours: number; keyframes?: WeatherKeyframe[]; durationHours?: number;
}
export interface WeatherState extends WeatherValues { surfaceContext?: import('./weather-regional-context').RegionalContextStatus; temperatureReferenceM?: number; provenance: 'observation' | 'reanalysis' | 'synthetic' | 'interpolated'; precipitationType?: 'none' | 'rain' | 'snow' | 'mixed' }
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const mod = (x: number, n: number) => ((x % n) + n) % n;
export function weatherTime(value: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw Error('Время погоды должно быть в UTC: ГГГГ-ММ-ДДTчч:мм:ссZ');
  const t = Date.parse(value);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 19) !== value.slice(0, 19)) throw Error('Некорректная дата погоды');
  return t;
}
function point(lat: number, lon: number) {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) throw Error('Координаты вне диапазона WGS84');
}
const LIMITS: Record<WeatherField, [number, number]> = {
  temperature: [-100, 70], humidity: [0, 100], pressure: [100, 1100], windSpeed: [0, 150], windDirection: [0, 360], gust: [0, 200], cloud: [0, 100], precipitation: [0, 2000], visibility: [0, 1000000], snowDepth: [0, 100], soilTemperature: [-100, 100], soilMoisture: [0, 1],
};
export function validateWeatherDataset(input: unknown): WeatherDataset {
  if (!input || typeof input !== 'object') throw Error('Ожидается погодный набор JSON');
  const d = input as WeatherDataset;
  if (d.version !== 1 || typeof d.id !== 'string' || !d.id || typeof d.name !== 'string' || !d.name.trim()) throw Error('Не указаны версия, идентификатор или название набора');
  if (!d.source || !['observation', 'reanalysis', 'synthetic'].includes(d.source.kind) || ['title', 'license', 'spatialResolution', 'temporalResolution'].some(k => typeof d.source[k as keyof WeatherSource] !== 'string' || !d.source[k as keyof WeatherSource]?.trim())) throw Error('Укажите источник, лицензию и детализацию данных');
  if (!Array.isArray(d.rows) || !d.rows.length || d.rows.length > 1000000) throw Error('Набор должен содержать от 1 до 1 000 000 наблюдений');
  const keys = new Set<string>();
  const rows = d.rows.map(r => {
    point(r.lat, r.lon); const t = weatherTime(r.time); const key = `${r.lat}/${r.lon}/${t}`;
    if (keys.has(key)) throw Error('Повтор координат и времени в погодном наборе'); keys.add(key);
    const row: WeatherRow = { lat: r.lat, lon: r.lon, time: new Date(t).toISOString() };
    for (const f of WEATHER_FIELDS) {
      const v = r[f]; const [lo, hi] = LIMITS[f];
      if (v != null && (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi)) throw Error(`Недопустимое значение ${f}`);
      row[f] = v ?? null;
    }
    return row;
  });
  if(d.region)weatherGrid(d.region);
  return { ...(d.region?{region:d.region}:{}), version: 1, id: d.id, name: d.name, source: { ...d.source }, rows: rows.sort((a, b) => a.time.localeCompare(b.time)) };
}
function blend(a: number, b: number, t: number, direction = false) { return direction ? mod(a + (mod(b - a + 180, 360) - 180) * t, 360) : a + (b - a) * t; }
/** В точке архива — интерполяция по времени. Вне точек нет молчаливой пространственной экстраполяции. */
export function weatherAt(d: WeatherDataset, lat: number, lon: number, time: string): WeatherState | null {
  point(lat, lon); const t = weatherTime(time);
  const rows = d.rows.filter(r => Math.abs(r.lat - lat) < 1e-7 && Math.abs(mod(r.lon - lon + 180, 360) - 180) < 1e-7);
  let a: WeatherRow | undefined, b: WeatherRow | undefined;
  for (const r of rows) { const rt = Date.parse(r.time); if (rt <= t && (!a || rt > Date.parse(a.time))) a = r; if (rt >= t && (!b || rt < Date.parse(b.time))) b = r; }
  if (!a || !b) return null;
  const dt = Date.parse(b.time) - Date.parse(a.time), u = dt ? (t - Date.parse(a.time)) / dt : 0;
  const result: WeatherState = { provenance: dt ? 'interpolated' : d.source.kind };
  for (const f of WEATHER_FIELDS) result[f] = a[f] == null || b[f] == null ? null : blend(a[f]!, b[f]!, u, f === 'windDirection');
  return result;
}
export function weatherDuration(s:WeatherScenario):number { const duration=s.durationHours??168; if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(Date.parse(s.start)+duration*3600000)||Date.parse(s.start)+duration*3600000>Date.parse('9999-12-31T23:59:59Z'))throw Error('Задайте положительную длительность в пределах календаря до 9999 года'); return duration; }
export function validateWeatherScenario(s: WeatherScenario): WeatherScenario {
  if (s.version !== 1 || !Number.isSafeInteger(s.seed)) throw Error('Неверная версия сценария или зерно'); weatherTime(s.start);
  if(s.algorithmVersion!==undefined&&s.algorithmVersion!==1&&s.algorithmVersion!==2)throw Error('Неизвестная версия алгоритма погоды');
  if(s.algorithmVersion===2&&(s.climateProfileId!==REGIONAL_CLIMATE_PROFILE.id||s.climateProfileSha256!==REGIONAL_CLIMATE_PROFILE.sha256))throw Error('Неизвестный или изменённый климатический профиль');
  if(s.manualFields!==undefined&&(!Array.isArray(s.manualFields)||s.manualFields.some(f=>!['temperature','humidity','pressure','windSpeed','windDirection','cloud','precipitation',...surfaceFields].includes(f))))throw Error('Неизвестное ручное поле погоды');
  if(s.temperatureMode !== undefined && s.temperatureMode !== 'manual' && s.temperatureMode !== 'climate') throw Error('Неизвестный режим температуры');
  for (const f of ['temperature', 'humidity', 'pressure', 'windSpeed', 'windDirection', 'cloud', 'precipitation'] as const) {
    if (!Number.isFinite(s[f]) || s[f] < LIMITS[f][0] || s[f] > LIMITS[f][1]) throw Error(`Недопустимый параметр ${f}`);
  }
  if (!Number.isFinite(s.transitionHours) || s.transitionHours < .25 || !Number.isFinite(s.transitionHours * 3600000) || !Number.isFinite(s.variability) || s.variability < 0 || s.variability > 3) throw Error('Переход: от 0,25 ч; изменчивость: 0–3');
  if(s.rain!==undefined)validateRainSchedule(s.rain);
  for(const k of surfaceFields){
    const v=s[k];
    if(v!==undefined&&(!Number.isFinite(v)||v<LIMITS[k][0]||v>LIMITS[k][1]))throw Error(`Недопустимый параметр ${k}`);
  }
  const duration=weatherDuration(s);
  if (s.keyframes !== undefined) {
    if (!Array.isArray(s.keyframes) || s.keyframes.length > 128) throw Error('Не более 128 ключевых состояний');
    let previous = 0;
    for (const frame of s.keyframes) {
      if (!Number.isFinite(frame.hour) || frame.hour <= previous || frame.hour > duration || !frame.values || typeof frame.values !== 'object') throw Error('Ключевые состояния: уникальные возрастающие часы в пределах длительности сценария');
      for (const [k,v] of Object.entries(frame.values)) { if (!['temperature','humidity','pressure','windSpeed','windDirection','cloud','precipitation',...surfaceFields].includes(k) || !Number.isFinite(v) || v < LIMITS[k as WeatherField][0] || v > LIMITS[k as WeatherField][1]) throw Error('Недопустимое ключевое состояние'); }
      previous=frame.hour;
    }
  }
  return s;
}
function random(seed: number, index: number) {
  let h = (seed ^ Math.imul(index, 0x45d9f3b)) | 0; h = Math.imul(h ^ h >>> 16, 0x45d9f3b); h = Math.imul(h ^ h >>> 16, 0x45d9f3b); return ((h ^ h >>> 16) >>> 0) / 4294967295 * 2 - 1;
}
export const surfaceDefaults={visibility:15000,snowDepth:0,soilTemperature:10,soilMoisture:.25} as const;
function scenarioBaseline(s:WeatherScenario,hours:number,temperature:number) {
  let baseline: Record<ScenarioField,number> = {visibility:s.visibility??surfaceDefaults.visibility,snowDepth:s.snowDepth??surfaceDefaults.snowDepth,soilTemperature:s.soilTemperature??temperature,soilMoisture:s.soilMoisture??surfaceDefaults.soilMoisture,temperature,humidity:s.humidity,pressure:s.pressure,windSpeed:s.windSpeed,windDirection:s.windDirection,cloud:s.cloud,precipitation:s.precipitation};
  let from=0;
  for (const frame of s.keyframes ?? []) {
    const next={...baseline,...frame.values};
    if(hours < frame.hour) { const ratio=clamp((hours-from)/(frame.hour-from),0,1); for(const k of Object.keys(baseline) as ScenarioField[]) baseline[k]=blend(baseline[k],next[k],ratio,k==='windDirection'); break; }
    baseline=next; from=frame.hour;
  }

  return baseline;
}

/** Один момент для всего растрового кадра, тот же расчёт, что и у контрольной точки. */
export function precipitationFrame(s:WeatherScenario,time:string) {
  validateWeatherScenario(s);
  if(s.algorithmVersion===2){const frame=regionalPrecipitationFrame(s,time);return (lon:number,lat:number)=>frame(lon,lat)??NaN;}
  const hours=(weatherTime(time)-weatherTime(s.start))/3600000;
  const base=scenarioBaseline(s,hours,s.temperature);
  const intensity=Math.max(base.precipitation,episodeIntensity(rainEpisode(s,hours),hours));
  return (lon:number,lat:number)=>showerIntensity(intensity,s.variability,s.seed,lat,lon,hours,base.windSpeed,base.windDirection);
}
/** Прямой расчёт по времени: не требует предыдущих кадров и скрытого генераторного состояния. */
export function simulateWeather(s: WeatherScenario, lat: number, lon: number, time: string, context?:import('./weather-regional-context').RegionalSurfaceContext): WeatherState {
  validateWeatherScenario(s); point(lat, lon);
  if(s.algorithmVersion===2)return simulateRegionalWeather(s,lat,lon,time,context);
  const t = weatherTime(time), hours = (t - weatherTime(s.start)) / 3600000, elapsed = hours / s.transitionHours;
  const climate = s.temperatureMode === 'climate' ? climateAt(lat, lon, t) : undefined;
  const baseline=scenarioBaseline(s,hours,climate?.temperature??s.temperature);
  // Периодическая зависимость от долготы непрерывна через антимеридиан.
  const rad = Math.PI / 180, x = Math.cos(lat * rad) * Math.cos(lon * rad), y = Math.cos(lat * rad) * Math.sin(lon * rad), z = Math.sin(lat * rad);
  const field = (n: number, phase = elapsed) => {
    const i = Math.floor(phase), u0 = phase - i, u = u0 * u0 * (3 - 2 * u0);
    const at = (k: number) => .7 * random(s.seed + n * 997, k) + .3 * Math.sin(x * 7 + y * 5 + z * 3 + random(s.seed + n, k) * 2);
    return blend(at(i), at(i + 1), u) * s.variability;
  };
  const localHour = mod(t / 3600000 + lon / 15, 24);
  const temperature = clamp(baseline.temperature + (climate ? 3 * field(1, hours / Math.max(24, s.transitionHours)) : field(1) * 6) + Math.cos((localHour - 14) * Math.PI / 12) * 2 * s.variability, -90, 65);
  const intensity=Math.max(baseline.precipitation,episodeIntensity(rainEpisode(s,hours),hours));
  const wet = field(2), precipitation = showerIntensity(intensity,s.variability,s.seed,lat,lon,hours,baseline.windSpeed,baseline.windDirection);
  const humidity = clamp(baseline.humidity + wet * 15 + (precipitation > 0 ? 10 : 0), 0, 100);
  const windSpeed = clamp(baseline.windSpeed + field(3) * 3, 0, 120);
  return { provenance: 'synthetic', ...(climate ? {temperatureReferenceM:climate.heightM} : {}), temperature, humidity, pressure: clamp(baseline.pressure + field(4) * 10, 100, 1100),
    windSpeed, windDirection: mod(baseline.windDirection + field(5) * 40, 360), gust: windSpeed + Math.abs(field(6)) * 4,
    cloud: clamp(Math.max(precipitation > 0 ? 75 : 0, baseline.cloud + wet * 20), 0, 100), precipitation,
    precipitationType: precipitation <= .001 ? 'none' : temperature < -1 ? 'snow' : temperature > 2 ? 'rain' : 'mixed',
    visibility:baseline.visibility, snowDepth:baseline.snowDepth, soilTemperature:baseline.soilTemperature, soilMoisture:baseline.soilMoisture };
}
export function importWeatherCsv(text: string, source: WeatherSource, name = 'Импорт погоды'): WeatherDataset {
  const lines: string[][] = []; let row: string[] = [], cell = '', quote = false;
  const input = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i <= input.length; i++) {
    const c = input[i] ?? '\n';
    if (c === '"') { if (quote && input[i + 1] === '"') { cell += '"'; i++; } else quote = !quote; }
    else if (!quote && (c === ',' || c === '\n')) { row.push(cell.trim()); cell = ''; if (c === '\n') { if (row.some(Boolean)) lines.push(row); row = []; } }
    else cell += c;
  }
  if (quote) throw Error('Незакрытая кавычка CSV');
  const header = lines.shift() ?? [];
  if (new Set(header).size !== header.length || ['lat', 'lon', 'time'].some(k => !header.includes(k))) throw Error('CSV: обязательны уникальные столбцы lat,lon,time');
  const rows = lines.map(cells => {
    if (cells.length !== header.length) throw Error('CSV: число значений не совпадает с заголовком');
    const obj = Object.fromEntries(header.map((h, i) => [h, cells[i]]));
    if (!obj.lat || !obj.lon || !obj.time) throw Error('CSV: пустые координаты или время');
    const r: WeatherRow = { lat: Number(obj.lat), lon: Number(obj.lon), time: obj.time };
    for (const f of WEATHER_FIELDS) r[f] = obj[f] == null || obj[f] === '' ? null : Number(obj[f]);
    return r;
  });
  return validateWeatherDataset({ version: 1, id: `csv-${Date.now()}`, name, source, rows });
}
