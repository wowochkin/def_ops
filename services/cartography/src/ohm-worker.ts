/**
 * Поток сборки и нарезки карты OpenHistoricalMap (node:worker_threads).
 *
 * Основной поток службы скачивает участки и шлёт сюда номера готовых: участок читается из кэша
 * (`_ohm/cells/{i}.json.gz`) и уходит в сборщик. По команде build — признаки и нарезка в MBTiles;
 * ход — сообщениями progress. Цикл событий службы всё это время свободен: тайлы и /health
 * отвечают, отмена останавливает поток (worker.terminate) сразу.
 *
 * Сборка настольного приложения кладёт этот файл рядом со службой (`ohm-worker.mjs`).
 */
import { parentPort, workerData } from 'node:worker_threads';
import type { BBox, MapJob } from '@def-ops/core';
import type { JobContext } from './jobs';
import { OhmCellCache } from './ohm';
import { ohmDescription, OhmCollector, type OhmLayer } from './ohm-features';
import { tileFeatures } from './vector';

/** Сообщения основного потока. */
export type WorkerIn =
  | { t: 'cell'; id: number; i: number }
  | { t: 'build'; id: number; bbox: BBox; file: string; name: string; cells: number; done: number };

/** Сообщения потока: ответ на запрос (id), ход, сбой. */
export type WorkerOut =
  | { t: 'cell'; id: number; elements: number | null }
  | { t: 'built'; id: number; features: number; description: string; tiles: number; bytes: number; layers: Record<OhmLayer, number> }
  | { t: 'progress'; done?: number; message?: string }
  | { t: 'error'; id?: number; message: string; stack?: string };

/** Данные потока при запуске. */
export interface WorkerData { cacheDir: string }

if (parentPort) {
  const port = parentPort;
  const post = (m: WorkerOut) => port.postMessage(m);
  const cache = new OhmCellCache((workerData as WorkerData).cacheDir);
  let collector: OhmCollector | null = new OhmCollector();
  // запросы — строго по одному, в порядке прихода
  let queue = Promise.resolve();

  const handle = async (m: WorkerIn) => {
    if (m.t === 'cell') {
      if (!collector) throw new Error('Участок после начала сборки');
      const json = await cache.load(m.i);
      if (json) collector.add(json);
      post({ t: 'cell', id: m.id, elements: json ? json.elements?.length ?? 0 : null });
      return;
    }
    post({ t: 'progress', message: 'сборка объектов' });
    const features = collector!.features();
    collector = null; // объекты участков отпускаются до нарезки
    const count = features.length;
    const description = ohmDescription(count, m.cells);
    post({ t: 'progress', message: `сборка объектов: ${count}` });
    const job = { done: m.done } as MapJob;
    const ctx: JobContext = {
      job, tenant: '', signal: new AbortController().signal,
      progress: (p) => {
        Object.assign(job, p);
        post({ t: 'progress', done: job.done, message: p?.message });
      },
      check: () => {}, // отмена — остановкой потока
    };
    const out = await tileFeatures(ctx, features, m.bbox, m.file, { name: m.name, description });
    post({ t: 'built', id: m.id, features: count, description, ...out });
  };

  port.on('message', (m: WorkerIn) => {
    queue = queue.then(() => handle(m)).catch((e: Error) => post({ t: 'error', id: m.id, message: e?.message ?? String(e), stack: e?.stack }));
  });
}
