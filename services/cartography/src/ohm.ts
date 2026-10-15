/**
 * OpenHistoricalMap (OHM): загрузка исходных объектов района через Overpass OHM участками.
 *
 * Участок — один запрос (узлы с тегами, пути с геометрией, отношения — только ссылки на членов).
 * Вежливость к серверу: запросы по одному, между любыми двумя — не меньше pauseMs, честный
 * User-Agent, повтор при 429, 5xx, обрыве, таймауте, не-JSON и частичном ответе (HTTP 200 с
 * `remark` о нехватке времени или памяти) с нарастающей паузой (учитывается Retry-After);
 * прочие 4xx — ошибка сразу. Скачанный участок ложится в кэш (`_ohm/cells/{i}.json.gz`) — только
 * годный ответ; прерванную загрузку можно продолжить: участки из кэша не запрашиваются.
 * Шрифты и значки стиля OHM — общие для всех карт, скачиваются один раз.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { renameSync } from 'node:fs';
import { OHM_CELL_DEG, OHM_OVERPASS, ohmCells, type BBox, type MapSource, type OverpassJson } from '@def-ops/core';
import { CancelledError, type JobContext } from './jobs';
import { writeAtomic, type TileStore } from './tiles';
import { USER_AGENT } from './xyz';
import { http, netMessage } from './net';
import { OhmCollector, type OhmFeature } from './ohm-features';
import { tileFeatures, type VectorTiles } from './vector';

export interface OhmOptions {
  /** Адрес интерпретатора Overpass OHM. */
  overpassUrl: string;
  /** Корень файлов стиля OHM (шрифты, значки). */
  assetsUrl: string;
  /** Пауза между любыми двумя запросами к Overpass, мс. */
  pauseMs: number;
  /** Повторов при сбое. */
  retries: number;
  /** Начальная пауза перед повтором, мс (удваивается). */
  backoffMs: number;
  /** Ожидание ответа, мс. */
  timeoutMs: number;
  userAgent?: string;
}

export const OHM_DEFAULTS: OhmOptions = {
  overpassUrl: OHM_OVERPASS, assetsUrl: 'https://www.openhistoricalmap.org/map-styles',
  pauseMs: 1000, retries: 4, backoffMs: 2000, timeoutMs: 300_000,
};

/** Стеки шрифтов стиля OHM. */
export const OHM_FONTS = ['OpenHistorical', 'OpenHistorical Italic', 'OpenHistorical Bold'];
/** Диапазоны глифов: латиница, расширенная латиница, кириллица, тире и кавычки. */
export const OHM_RANGES = ['0-255', '256-511', '1024-1279', '8192-8447'];
/** Файлы значков (локальные имена). */
export const OHM_SPRITES = ['ohm.json', 'ohm.png', 'ohm@2x.json', 'ohm@2x.png'];
/** Значки, на которые ссылается стиль. */
export const OHM_ICONS = ['place_of_worship-18', 'railstation-18', 'capital-18', 'city-18', 'townhall-18'];

/** Повтор Retry-After — не дольше, с. */
const MAX_RETRY_AFTER_S = 60;

/** Запрос Overpass участка: узлы с тегами, пути с геометрией, отношения — только члены-ссылки. */
export function cellQuery(b: BBox): string {
  const [w, s, e, n] = b;
  const r = `${s},${w},${n},${e}`;
  return `[out:json][timeout:180];(node(${r})(if:count_tags()>0);way(${r}););out body geom;rel(${r});out body;`;
}

/** Ответ Overpass: годен ли, а если нет — повторять ли. */
export function overpassCheck(status: number, text: string): { ok: true; json: OverpassJson } | { ok: false; retry: boolean; message: string } {
  const snippet = () => text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (status === 429 || status >= 500) return { ok: false, retry: true, message: `HTTP ${status}` };
  if (status !== 200) return { ok: false, retry: false, message: `HTTP ${status}${text ? `: ${snippet()}` : ''}` };
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { ok: false, retry: true, message: `ответ — не JSON${text ? `: ${snippet().slice(0, 80)}` : ''}` }; }
  if (!json || typeof json !== 'object' || !Array.isArray((json as OverpassJson).elements))
    return { ok: false, retry: true, message: 'в ответе нет списка объектов' };
  const remark = (json as OverpassJson).remark;
  if (remark && /runtime error|timed out|out of memory/i.test(remark)) return { ok: false, retry: true, message: `ответ неполный: ${remark}` };
  return { ok: true, json: json as OverpassJson };
}

type Plan = { bbox: BBox; step: number; cells: number };

/** Кэш сырых участков в папке карты: `plan.json` и `cells/{i}.json.gz` (файл есть — участок скачан). */
export class OhmCellCache {
  constructor(private dir: string) {}

  private file(i: number) {
    if (!Number.isInteger(i) || i < 0) throw new Error(`Недопустимый номер участка: ${i}`);
    return path.join(this.dir, 'cells', `${i}.json.gz`);
  }

  /** Начать работу с кэшем рамки; кэш другой рамки (или сетки) очищается. */
  async open(bbox: BBox, step: number, cells: number): Promise<void> {
    const plan: Plan = { bbox: [...bbox] as BBox, step, cells };
    let old: Plan | null = null;
    try { old = JSON.parse(await fs.readFile(path.join(this.dir, 'plan.json'), 'utf8')) as Plan; } catch { /* нет — новый кэш */ }
    if (old && JSON.stringify(old) === JSON.stringify(plan)) return;
    await this.clear();
    await writeAtomic(path.join(this.dir, 'plan.json'), Buffer.from(JSON.stringify(plan)));
  }

  async has(i: number): Promise<boolean> {
    return fs.access(this.file(i)).then(() => true, () => false);
  }

  async read(i: number): Promise<OverpassJson> {
    return JSON.parse(gunzipSync(await fs.readFile(this.file(i))).toString('utf8')) as OverpassJson;
  }

  /** Участок из кэша; нет — null; повреждён (gzip, JSON) — файл удаляется, null: участок скачается заново. */
  async load(i: number): Promise<OverpassJson | null> {
    let data: Buffer;
    try { data = await fs.readFile(this.file(i)); } catch { return null; }
    try {
      const json = JSON.parse(gunzipSync(data).toString('utf8')) as OverpassJson;
      if (json && typeof json === 'object' && Array.isArray(json.elements)) return json;
    } catch { /* повреждён */ }
    await fs.rm(this.file(i), { force: true });
    return null;
  }

  async write(i: number, json: OverpassJson): Promise<void> {
    await writeAtomic(this.file(i), gzipSync(Buffer.from(JSON.stringify(json))));
  }

  async clear(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(new CancelledError());
  if (ms <= 0) return resolve();
  const t = setTimeout(() => { signal.removeEventListener('abort', on); resolve(); }, ms);
  const on = () => { clearTimeout(t); reject(new CancelledError()); };
  signal.addEventListener('abort', on, { once: true });
});

/**
 * Скачать участки по порядку (участки из кэша не запрашиваются; повреждённый в кэше —
 * удаляется и скачивается заново). Ответ каждого участка (из кэша или сети) — в onCell,
 * по порядку участков. После каждого участка — ход задания `{ done, skipped, message }`.
 * Участок не скачан после всех повторов (или ответ 4xx) — ошибка «участок N из M: …»;
 * уже скачанные остаются в кэше.
 */
export async function downloadCells(
  ctx: JobContext, cells: BBox[], cache: OhmCellCache, o: OhmOptions, onCell?: (i: number, json: OverpassJson) => void,
): Promise<{ fetched: number; cached: number; elements: number }> {
  const headers = { 'User-Agent': o.userAgent ?? USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  const total = cells.length;
  let fetched = 0, cached = 0, elements = 0;
  let last = -Infinity; // окончание предыдущего запроса к Overpass

  const report = (i: number) => ctx.progress({ done: ctx.job.done + 1, message: `участок ${i + 1} из ${total}, объектов ${elements}` });

  for (let i = 0; i < total; i++) {
    ctx.check();
    const hit = await cache.load(i);
    if (hit) {
      cached++;
      elements += hit.elements?.length ?? 0;
      onCell?.(i, hit);
      ctx.progress({ done: ctx.job.done + 1, skipped: ctx.job.skipped + 1, message: `участок ${i + 1} из ${total}, объектов ${elements}` });
      continue;
    }
    const body = new URLSearchParams({ data: cellQuery(cells[i]) }).toString();
    let message = '', wait = 0;
    let json: OverpassJson | null = null;
    for (let attempt = 0; attempt <= o.retries && !json; attempt++) {
      await sleep(Math.max(last + o.pauseMs, Date.now() + wait) - Date.now(), ctx.signal);
      let status: number, text: string, retryAfter = 0;
      try {
        const r = await http.fetch(o.overpassUrl, { method: 'POST', headers, body, signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(o.timeoutMs)]) });
        status = r.status;
        retryAfter = Number(r.headers.get('retry-after')) || 0;
        text = await r.text();
      } catch (e) {
        last = Date.now();
        ctx.check();
        message = (e as Error).name === 'TimeoutError' ? `нет ответа за ${Math.round(o.timeoutMs / 1000)} с` : netMessage(e);
        wait = o.backoffMs * 2 ** attempt;
        continue;
      }
      last = Date.now();
      const v = overpassCheck(status, text);
      if (v.ok) { json = v.json; break; }
      message = v.message;
      if (!v.retry) break;
      wait = Math.max(o.backoffMs * 2 ** attempt, Math.min(retryAfter, MAX_RETRY_AFTER_S) * 1000);
    }
    if (!json) throw new Error(`участок ${i + 1} из ${total}: ${message}`);
    ctx.check();
    await cache.write(i, json);
    fetched++;
    elements += json.elements?.length ?? 0;
    onCell?.(i, json);
    report(i);
  }
  return { fetched, cached, elements };
}

/** Файлы стиля OHM: локальный путь (от папки шрифтов и значков) → путь на сервере стиля. */
function assetList(): [string, string][] {
  const out: [string, string][] = [];
  for (const stack of OHM_FONTS)
    for (const range of OHM_RANGES) out.push([path.join('fonts', stack, `${range}.pbf`), `fonts/${encodeURIComponent(stack)}/${range}.pbf`]);
  for (const name of OHM_SPRITES) out.push([path.join('sprites', name), `historical/${name.replace(/^ohm/, 'historical_spritesheet')}`]);
  return out;
}

/**
 * Шрифты и значки стиля OHM в dir (`{TILES_DIR}/.ohm-assets`): `fonts/{стек}/{диапазон}.pbf`,
 * `sprites/{имя}`. Файл есть — не запрашивается.
 */
export async function ensureAssets(dir: string, o: OhmOptions, signal: AbortSignal = new AbortController().signal): Promise<{ fetched: number }> {
  const base = o.assetsUrl.replace(/\/+$/, '');
  let fetched = 0;
  for (const [local, remote] of assetList()) {
    const file = path.join(dir, local);
    if (await fs.access(file).then(() => true, () => false)) continue;
    const url = `${base}/${remote}`;
    let message = '', data: Buffer | null = null;
    for (let attempt = 0; attempt <= o.retries && !data; attempt++) {
      if (attempt) await sleep(o.backoffMs * 2 ** (attempt - 1), signal);
      try {
        const r = await http.fetch(url, { headers: { 'User-Agent': o.userAgent ?? USER_AGENT }, signal: AbortSignal.any([signal, AbortSignal.timeout(o.timeoutMs)]) });
        if (r.ok) { data = Buffer.from(await r.arrayBuffer()); break; }
        await r.body?.cancel();
        message = `HTTP ${r.status}`;
        if (r.status !== 429 && r.status < 500) break;
      } catch (e) {
        if (signal.aborted) throw new CancelledError();
        message = (e as Error).name === 'TimeoutError' ? 'нет ответа' : netMessage(e);
      }
    }
    if (!data) throw new Error(`Шрифты и значки OpenHistoricalMap: ${url}: ${message}`);
    await writeAtomic(file, data);
    fetched++;
  }
  return { fetched };
}

/** Подпись векторной карты OHM. */
export const OHM_ATTRIBUTION = '© участники OpenHistoricalMap, CC0';

/** Шрифты и значки стиля OHM — общие для всех организаций (`{TILES_DIR}/.ohm-assets`). */
export const ohmAssetsDir = (store: TileStore) => path.join(store.root, '.ohm-assets');
/** Файл MBTiles векторной карты. */
export const ohmFile = (store: TileStore, tenant: string, mapId: string) => path.join(store.mapDir(tenant, mapId), 'ohm.mbtiles');

const mb = (bytes: number) => (bytes / 1048576).toFixed(1).replace('.', ',');

/**
 * Задание карты OHM: шрифты и значки → участки (кэш `_ohm`; refresh — кэш очищается в начале)
 * → объекты → нарезка в `ohm.mbtiles.tmp` → читатель прежнего файла закрывается, файл заменяется
 * → кэш удаляется. До замены показывается прежняя карта (отмена и сбой её не трогают).
 * Итог — поля карты (patch) и сообщение задания.
 */
export async function buildOhm(
  ctx: JobContext, store: TileStore, vectors: VectorTiles, map: MapSource, bbox: BBox, o: OhmOptions & { refresh?: boolean },
): Promise<{ patch: Partial<MapSource>; message: string }> {
  ctx.progress({ message: 'шрифты и значки' });
  await ensureAssets(ohmAssetsDir(store), o, ctx.signal);
  ctx.check();

  const cells = ohmCells(bbox);
  const cache = new OhmCellCache(path.join(store.mapDir(ctx.tenant, map.id), '_ohm'));
  if (o.refresh) await cache.clear();
  await cache.open(bbox, OHM_CELL_DEG, cells.length);

  // сырые ответы участков не копятся: объекты сразу уходят в сборщик (без лишних полей)
  let collector: OhmCollector | null = new OhmCollector();
  await downloadCells(ctx, cells, cache, o, (_i, json) => collector!.add(json));
  const fetchedAt = new Date().toISOString();

  ctx.progress({ message: 'сборка объектов' });
  const features: OhmFeature[] = collector.features();
  collector = null; // объекты участков отпускаются до нарезки
  const count = features.length;
  ctx.progress({ message: `сборка объектов: ${count}` });
  const description = `OpenHistoricalMap: ${count} объектов, участков ${cells.length}`;

  const file = ohmFile(store, ctx.tenant, map.id);
  const tmp = `${file}.tmp`;
  let out: Awaited<ReturnType<typeof tileFeatures>>;
  try {
    out = await tileFeatures(ctx, features, bbox, tmp, { name: map.name, description });
    ctx.check();
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
  // замена: читатель прежнего файла закрывается и файл заменяется без уступки циклу событий
  vectors.close(file);
  renameSync(tmp, file);
  await cache.clear();

  return {
    patch: {
      kind: 'vector', format: 'pbf', tileSize: 512, minzoom: 0, maxzoom: 16, bounds: [...bbox] as BBox,
      attribution: OHM_ATTRIBUTION, description, stats: { tiles: out.tiles, bytes: out.bytes },
      ohm: { bbox: [...bbox] as BBox, cells: cells.length, features: count, layers: out.layers, fetchedAt },
    },
    message: `Объектов ${count}, тайлов ${out.tiles}, ${mb(out.bytes)} МБ`,
  };
}
