/**
 * OpenHistoricalMap (OHM): загрузка исходных объектов района через Overpass OHM участками.
 *
 * Участок — один запрос (узлы с тегами, пути с геометрией, отношения — только ссылки на членов).
 * Вежливость к серверу: запросы по одному, между любыми двумя — не меньше pauseMs, честный
 * User-Agent, повтор при 429, 5xx, обрыве, таймауте, не-JSON и частичном ответе (HTTP 200 с
 * `remark` о нехватке времени или памяти) с нарастающей паузой (учитывается Retry-After);
 * прочие 4xx — ошибка сразу. Скачанный участок ложится в кэш (`_ohm/cells/{i}.json.gz`) — только
 * годный ответ; прерванную загрузку можно продолжить: участки из кэша не запрашиваются.
 * Ответ больше maxResponseBytes (256 МиБ) обрывается, участок — ошибка сразу (без повтора):
 * память службы не должна зависеть от того, что пришлёт сервер.
 * Шрифты и значки стиля OHM — общие для всех карт, скачиваются один раз.
 *
 * Сборка объектов и нарезка идут в отдельном потоке (`ohm-worker`): они занимают процессор
 * на минуту и дольше, а служба тем временем отдаёт тайлы и отвечает на запросы; отмена
 * останавливает поток сразу.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { gunzipSync, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { OHM_CELL_DEG, OHM_OVERPASS, ohmCells, type BBox, type MapSource, type OverpassJson } from '@def-ops/core';
import { CancelledError, type JobContext } from './jobs';
import { writeAtomic, type TileStore } from './tiles';
import { USER_AGENT } from './xyz';
import { http, netMessage } from './net';
import type { VectorTiles } from './vector';
import type { WorkerIn, WorkerOut } from './ohm-worker';

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
  /** Наибольший ответ Overpass на участок, байт (по умолчанию 256 МиБ); больше — участок не скачан. */
  maxResponseBytes?: number;
  userAgent?: string;
}

export const OHM_DEFAULTS: OhmOptions = {
  overpassUrl: OHM_OVERPASS, assetsUrl: 'https://www.openhistoricalmap.org/map-styles',
  pauseMs: 1000, retries: 4, backoffMs: 2000, timeoutMs: 300_000, maxResponseBytes: 256 * 1024 * 1024,
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

/** Предел ответа для сообщения: «256 МиБ», «4 КиБ». */
export function responseLimitText(bytes: number): string {
  const f = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ','));
  return bytes >= 1048576 ? `${f(bytes / 1048576)} МиБ` : bytes >= 1024 ? `${f(bytes / 1024)} КиБ` : `${bytes} Б`;
}

class TooLargeError extends Error {}

/** Текст ответа не больше limit байт (по заголовку и по счёту байт потока); больше — поток обрывается, TooLargeError. */
async function readCapped(r: Response, limit: number): Promise<string> {
  const tooLarge = () => new TooLargeError(`ответ Overpass больше ${responseLimitText(limit)} — загрузка участка прервана, чтобы не переполнить память службы`);
  const declared = Number(r.headers.get('content-length'));
  if (declared > limit) { await r.body?.cancel().catch(() => {}); throw tooLarge(); }
  if (!r.body) return '';
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  const parts: string[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > limit) { await reader.cancel().catch(() => {}); throw tooLarge(); }
    parts.push(dec.decode(value, { stream: true }));
  }
  parts.push(dec.decode());
  return parts.join('');
}

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
const gzipAsync = promisify(gzip);

/** Кэш сырых участков в папке карты: `plan.json` и `cells/{i}.json.gz` (файл есть — участок скачан). */
export class OhmCellCache {
  constructor(readonly dir: string) {}

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
    await writeAtomic(this.file(i), await gzipAsync(Buffer.from(JSON.stringify(json))));
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
 * Куда идут участки при загрузке. cached — участок из кэша: число объектов; нет или повреждён
 * (файл удалён) — null, участок скачается заново. fetched — участок скачан и уже лежит в кэше.
 */
export interface CellSink {
  cached(i: number): Promise<number | null>;
  fetched(i: number, json: OverpassJson): Promise<void> | void;
}

/**
 * Скачать участки по порядку (участки из кэша не запрашиваются; повреждённый в кэше —
 * удаляется и скачивается заново). Участки (из кэша или сети) — в sink по порядку; функция
 * вместо sink — ответ каждого участка в неё (участок из кэша читается здесь же). После каждого
 * участка — ход задания: скачанный — done + 1, из кэша — skipped + 1 (done + skipped не больше
 * total), и сообщение. Участок не скачан после всех повторов (или ответ 4xx, или ответ больше
 * maxResponseBytes) — ошибка «участок N из M: …»; уже скачанные остаются в кэше.
 */
export async function downloadCells(
  ctx: JobContext, cells: BBox[], cache: OhmCellCache, o: OhmOptions, sink?: CellSink | ((i: number, json: OverpassJson) => void),
): Promise<{ fetched: number; cached: number; elements: number }> {
  const headers = { 'User-Agent': o.userAgent ?? USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  const limit = o.maxResponseBytes ?? OHM_DEFAULTS.maxResponseBytes!;
  const onCell = typeof sink === 'function' ? sink : undefined;
  const to: CellSink = typeof sink === 'object' ? sink : {
    async cached(i) {
      const json = await cache.load(i);
      if (json) onCell?.(i, json);
      return json ? json.elements?.length ?? 0 : null;
    },
    fetched: (i, json) => onCell?.(i, json),
  };
  const total = cells.length;
  let fetched = 0, cached = 0, elements = 0;
  let last = -Infinity; // окончание предыдущего запроса к Overpass

  const report = (i: number) => ctx.progress({ done: ctx.job.done + 1, message: `участок ${i + 1} из ${total}, объектов ${elements}` });

  for (let i = 0; i < total; i++) {
    ctx.check();
    const hit = await to.cached(i);
    if (hit !== null) {
      cached++;
      elements += hit;
      ctx.progress({ skipped: ctx.job.skipped + 1, message: `участок ${i + 1} из ${total}, объектов ${elements}` });
      continue;
    }
    ctx.check();
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
        text = await readCapped(r, limit);
      } catch (e) {
        last = Date.now();
        ctx.check();
        if (e instanceof TooLargeError) { message = e.message; break; } // тот же участок пришлёт то же — без повтора
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
    await to.fetched(i, json);
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

type Built = Extract<WorkerOut, { t: 'built' }>;

/**
 * Поток сборки и нарезки (`ohm-worker`): запросы по одному с ответом, ход — в onProgress.
 * Поток упал (в том числе нехватка памяти) — все ожидающие запросы получают ошибку; stop() —
 * поток останавливается (ожидающие — CancelledError), его файлы закрыты.
 */
export class OhmWorker {
  private w: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (m: WorkerOut) => void; reject: (e: Error) => void }>();
  private dead: Error | null = null;

  constructor(cacheDir: string, onProgress: (p: { done?: number; message?: string }) => void) {
    this.w = spawnWorker({ cacheDir });
    this.w.on('message', (m: WorkerOut) => {
      if (m.t === 'progress') { onProgress(m.done === undefined ? { message: m.message } : m.message === undefined ? { done: m.done } : { done: m.done, message: m.message }); return; }
      const p = m.id === undefined ? undefined : this.pending.get(m.id);
      if (m.t === 'error') { const e = Object.assign(new Error(m.message), { stack: m.stack }); if (p) { this.pending.delete(m.id!); p.reject(e); } else this.fail(e); return; }
      if (p) { this.pending.delete(m.id); p.resolve(m); }
    });
    this.w.on('error', (e: Error & { code?: string }) => this.fail(e.code === 'ERR_WORKER_OUT_OF_MEMORY'
      ? new Error('Не хватило памяти на сборку и нарезку карты — разделите район на части') : e));
    this.w.on('exit', (code) => this.fail(new Error(`Поток сборки и нарезки остановился (код ${code})`)));
  }

  private fail(e: Error) {
    this.dead ??= e;
    for (const p of this.pending.values()) p.reject(this.dead);
    this.pending.clear();
  }

  private ask(m: Omit<Extract<WorkerIn, { t: 'cell' }>, 'id'> | Omit<Extract<WorkerIn, { t: 'build' }>, 'id'>): Promise<WorkerOut> {
    if (this.dead) return Promise.reject(this.dead);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.w.postMessage({ ...m, id });
    });
  }

  /** Участок из кэша — в сборщик потока: число объектов; нет или повреждён (файл удалён) — null. */
  async cell(i: number): Promise<number | null> {
    return (await this.ask({ t: 'cell', i }) as Extract<WorkerOut, { t: 'cell' }>).elements;
  }

  /** Признаки и нарезка в file. */
  async build(a: Omit<Extract<WorkerIn, { t: 'build' }>, 't' | 'id'>): Promise<Built> {
    return await this.ask({ t: 'build', ...a }) as Built;
  }

  /** Остановить поток (отмена, конец задания); ждёт, пока поток закроет свои файлы. */
  async stop(): Promise<void> {
    this.fail(new CancelledError());
    this.w.removeAllListeners('exit');
    await this.w.terminate();
  }
}

/**
 * Поток из исходника рядом с этим файлом. В сборке настольного приложения — ohm-worker.mjs рядом
 * со службой. В разработке (tsx, vitest) — ohm-worker.ts: загрузчик tsx службы в поток не
 * переходит, поэтому поток начинается с регистрации tsx и уже затем загружает исходник.
 */
function spawnWorker(data: { cacheDir: string }): Worker {
  if (!import.meta.url.endsWith('.ts')) return new Worker(new URL('./ohm-worker.mjs', import.meta.url), { workerData: data });
  const tsx = path.join(path.dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'esm', 'api', 'index.mjs');
  const boot = `import { register } from ${JSON.stringify(pathToFileURL(tsx).href)}; register(); `
    + `await import(${JSON.stringify(new URL('./ohm-worker.ts', import.meta.url).href)});`;
  return new Worker(new URL(`data:text/javascript,${encodeURIComponent(boot)}`), { workerData: data });
}

/**
 * Задание карты OHM: шрифты и значки → участки (кэш `_ohm`; refresh — кэш очищается в начале)
 * → объекты → нарезка в `ohm.mbtiles.tmp` (объекты и нарезка — в потоке `ohm-worker`) → читатель
 * прежнего файла закрывается, файл заменяется (не вышло — временный файл удаляется, ошибка; кэш
 * участков остаётся) → кэш удаляется. До замены показывается прежняя карта (отмена и сбой её не
 * трогают). Итог — поля карты (patch) и сообщение задания.
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

  const file = ohmFile(store, ctx.tenant, map.id);
  const tmp = `${file}.tmp`;
  // сырые ответы участков не копятся: поток читает участок из кэша и сразу отдаёт объекты сборщику
  const worker = new OhmWorker(cache.dir, (p) => ctx.progress(p));
  const stop = () => { void worker.stop(); };
  ctx.signal.addEventListener('abort', stop, { once: true });
  let fetchedAt = '', out: Built | null = null;
  try {
    await downloadCells(ctx, cells, cache, o, {
      cached: (i) => worker.cell(i),
      async fetched(i) {
        if ((await worker.cell(i)) === null) throw new Error(`участок ${i + 1} из ${cells.length}: не прочитан из кэша`);
      },
    });
    fetchedAt = new Date().toISOString();
    out = await worker.build({ bbox, file: tmp, name: map.name, cells: cells.length, done: ctx.job.done });
  } finally {
    ctx.signal.removeEventListener('abort', stop);
    await worker.stop(); // поток закрыл файл нарезки — его можно удалить или заменить
    if (!out || ctx.signal.aborted) await fs.rm(tmp, { force: true }); // сбой, отмена
  }
  ctx.check();
  const count = out.features;
  // замена: читатель прежнего файла закрывается и файл заменяется без уступки циклу событий;
  // не вышло (Windows: файл открыт выгрузкой пакета — EPERM) — временный файл удаляется, кэш
  // участков остаётся: «продолжить» нарежет заново без загрузки
  vectors.close(file);
  try {
    renameSync(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    const code = (e as NodeJS.ErrnoException).code;
    throw new Error(`Не удалось заменить файл карты${code ? ` (${code})` : ''}: он занят — например, идёт выгрузка пакета. Нажмите «продолжить», когда выгрузка закончится: участки возьмутся из кэша`);
  }
  await cache.clear();

  return {
    patch: {
      kind: 'vector', format: 'pbf', tileSize: 512, minzoom: 0, maxzoom: 16, bounds: [...bbox] as BBox,
      attribution: OHM_ATTRIBUTION, description: out.description, stats: { tiles: out.tiles, bytes: out.bytes },
      ohm: { bbox: [...bbox] as BBox, cells: cells.length, features: count, layers: out.layers, fetchedAt },
    },
    message: `Объектов ${count}, тайлов ${out.tiles}, ${mb(out.bytes)} МБ`,
  };
}
