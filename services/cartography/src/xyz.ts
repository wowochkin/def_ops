/**
 * Загрузка тайлов внешнего XYZ-сервиса в локальное хранилище — пока сервис доступен.
 *
 * Вежливость к источнику: не больше rate запросов в секунду (по умолчанию 4),
 * не больше concurrency запросов одновременно, честный User-Agent, повтор при
 * сбоях с нарастающей паузой (учитывается Retry-After). Уже лежащие на диске тайлы
 * не запрашиваются повторно — прерванную загрузку можно продолжить тем же запросом.
 * Ответ 404/410/204 — тайла на источнике нет (считается пропущенным).
 */
import type { MapSource, XyzDownloadRequest } from '@def-ops/core';
import { tileRange, tileUrl } from '@def-ops/core';
import { CancelledError, type JobContext } from './jobs';
import { detectFormat, formatFromMime, type TileExt, type TileStore } from './tiles';

export const USER_AGENT = 'def-ops-cartography/0.2 (+offline archive)';

export interface XyzOptions {
  userAgent?: string;
  /** Одновременных запросов к источнику. */
  concurrency?: number;
  /** Повторов при сбое (сеть, 429, 5xx). */
  retries?: number;
  /** Начальная пауза перед повтором, мс (удваивается). */
  backoffMs?: number;
  /** Ожидание ответа, мс. */
  timeoutMs?: number;
}

/** Все тайлы прямоугольника на уровнях minzoom..maxzoom (по одному, без списка в памяти). */
export function* tilesOf(req: Pick<XyzDownloadRequest, 'bounds' | 'minzoom' | 'maxzoom'>): Generator<[number, number, number]> {
  for (let z = req.minzoom; z <= req.maxzoom; z++) {
    const r = tileRange(req.bounds, z);
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) yield [z, x, y];
  }
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(new CancelledError());
  const t = setTimeout(() => { signal.removeEventListener('abort', on); resolve(); }, ms);
  const on = () => { clearTimeout(t); reject(new CancelledError()); };
  signal.addEventListener('abort', on, { once: true });
});

/** Ограничитель частоты: равномерные «окна» по 1/rate секунды. */
function limiter(rate: number, signal: AbortSignal) {
  const interval = 1000 / rate;
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + interval;
    if (at > now) await sleep(at - now, signal);
  };
}

type TileResult = { kind: 'stored'; ext: TileExt; bytes: number } | { kind: 'missing' } | { kind: 'error'; message: string };

export async function downloadXyz(
  ctx: JobContext, store: TileStore, map: MapSource, req: XyzDownloadRequest, o: XyzOptions = {},
): Promise<{ message: string; failed: boolean; format?: TileExt }> {
  const retries = o.retries ?? 3, backoff = o.backoffMs ?? 500, timeout = o.timeoutMs ?? 30_000;
  const headers: Record<string, string> = { ...(req.headers ?? {}), 'User-Agent': o.userAgent ?? USER_AGENT, Accept: req.headers?.Accept ?? 'image/png,image/jpeg,image/webp,image/*;q=0.8' };
  const slot = limiter(req.rate ?? 4, ctx.signal);
  const it = tilesOf(req);
  let stored = 0, firstFormat: TileExt | undefined, lastError = '';

  const fetchTile = async (z: number, x: number, y: number): Promise<TileResult> => {
    const url = tileUrl(req.url, z, x, y, req.subdomains);
    let message = '';
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(backoff * 2 ** (attempt - 1), ctx.signal);
      await slot();
      let r: Response;
      try {
        r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(timeout)]) });
      } catch (e) {
        ctx.check();
        message = `${url}: ${(e as Error).name === 'TimeoutError' ? 'нет ответа' : (e as Error).message}`;
        continue;
      }
      if (r.status === 404 || r.status === 410 || r.status === 204) { await r.body?.cancel(); return { kind: 'missing' }; }
      if (r.status === 429 || r.status >= 500) {
        await r.body?.cancel();
        message = `${url}: HTTP ${r.status}`;
        const ra = Number(r.headers.get('retry-after'));
        if (ra > 0) await sleep(Math.min(ra, 30) * 1000, ctx.signal);
        continue;
      }
      if (!r.ok) { await r.body?.cancel(); return { kind: 'error', message: `${url}: HTTP ${r.status}` }; }
      let buf: Buffer;
      try { buf = Buffer.from(await r.arrayBuffer()); } catch (e) {
        ctx.check();
        message = `${url}: ${(e as Error).message}`;
        continue;
      }
      // формат — по сигнатуре: Content-Type источников часто неточен (image/jpeg у PNG и т.п.)
      const ext = detectFormat(buf);
      if (!ext) {
        const ct = r.headers.get('content-type');
        const hint = formatFromMime(ct) ? 'повреждённое изображение' : `тип ${ct ?? 'не указан'}`;
        return { kind: 'error', message: `${url}: ответ — не PNG/JPEG/WebP (${hint})` };
      }
      await store.write(ctx.tenant, map.id, z, x, y, ext, buf);
      return { kind: 'stored', ext, bytes: buf.length };
    }
    return { kind: 'error', message };
  };

  const worker = async () => {
    for (let n = it.next(); !n.done; n = it.next()) {
      ctx.check();
      const [z, x, y] = n.value;
      const j = ctx.job;
      if (await store.has(ctx.tenant, map.id, z, x, y, map.format)) {
        ctx.progress({ done: j.done + 1, skipped: j.skipped + 1 });
        continue;
      }
      const r = await fetchTile(z, x, y);
      if (r.kind === 'stored') { stored++; firstFormat ??= r.ext; ctx.progress({ done: j.done + 1 }); }
      else if (r.kind === 'missing') ctx.progress({ done: j.done + 1, skipped: j.skipped + 1 });
      else { lastError = r.message; ctx.progress({ done: j.done + 1, errors: j.errors + 1 }); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 3) }, worker));
  ctx.check();

  const j = ctx.job;
  const message = `Загружено ${stored}, пропущено ${j.skipped}, ошибок ${j.errors}` + (lastError ? `; последняя ошибка: ${lastError}` : '');
  return { message, failed: stored === 0 && j.errors > 0, format: firstFormat };
}
