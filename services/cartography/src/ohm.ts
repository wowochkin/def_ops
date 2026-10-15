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
import { OHM_OVERPASS, type BBox, type OverpassJson } from '@def-ops/core';
import { CancelledError, type JobContext } from './jobs';
import { writeAtomic } from './tiles';
import { USER_AGENT } from './xyz';

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
 * Скачать участки по порядку (участки из кэша не запрашиваются). После каждого участка —
 * ход задания `{ done, skipped, message }`. Участок не скачан после всех повторов (или ответ
 * 4xx) — ошибка «участок N из M: …»; уже скачанные остаются в кэше.
 */
export async function downloadCells(
  ctx: JobContext, cells: BBox[], cache: OhmCellCache, o: OhmOptions,
): Promise<{ fetched: number; cached: number; elements: number }> {
  const headers = { 'User-Agent': o.userAgent ?? USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  const total = cells.length;
  let fetched = 0, cached = 0, elements = 0;
  let last = -Infinity; // окончание предыдущего запроса к Overpass

  const report = (i: number) => ctx.progress({ done: ctx.job.done + 1, message: `участок ${i + 1} из ${total}, объектов ${elements}` });

  for (let i = 0; i < total; i++) {
    ctx.check();
    if (await cache.has(i)) {
      cached++;
      elements += (await cache.read(i)).elements?.length ?? 0;
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
        const r = await fetch(o.overpassUrl, { method: 'POST', headers, body, signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(o.timeoutMs)]) });
        status = r.status;
        retryAfter = Number(r.headers.get('retry-after')) || 0;
        text = await r.text();
      } catch (e) {
        last = Date.now();
        ctx.check();
        message = (e as Error).name === 'TimeoutError' ? `нет ответа за ${Math.round(o.timeoutMs / 1000)} с` : (e as Error).message;
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
        const r = await fetch(url, { headers: { 'User-Agent': o.userAgent ?? USER_AGENT }, signal: AbortSignal.any([signal, AbortSignal.timeout(o.timeoutMs)]) });
        if (r.ok) { data = Buffer.from(await r.arrayBuffer()); break; }
        await r.body?.cancel();
        message = `HTTP ${r.status}`;
        if (r.status !== 429 && r.status < 500) break;
      } catch (e) {
        if (signal.aborted) throw new CancelledError();
        message = (e as Error).name === 'TimeoutError' ? 'нет ответа' : (e as Error).message;
      }
    }
    if (!data) throw new Error(`Шрифты и значки OpenHistoricalMap: ${url}: ${message}`);
    await writeAtomic(file, data);
    fetched++;
  }
  return { fetched };
}
