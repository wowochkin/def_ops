/**
 * Поток распознавания исторической карты: тайлы локальной карты (сервис картографии) → классы пикселей по
 * легенде → доли по клеткам сетки театра → маски (дороги, вода, застройка, лес). Не тормозит страницу.
 */
import { OverlayAccumulator, tilesFor, type OverlayLegend, type OverlayResult } from '@def-ops/sim';

export type OverlayRequest = { kind: 'run'; template: string; legend: OverlayLegend; grid: { bbox: [number, number, number, number]; cols: number; rows: number }; zoom: number; source: string } | { kind: 'stop' };
export type OverlayResponse = { kind: 'progress'; done: number; total: number } | { kind: 'done'; result: OverlayResult; tiles: number; missing: number } | { kind: 'error'; error: string };

let stopped = false;
const post = (m: OverlayResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<OverlayRequest>) => {
  const q = e.data;
  if (q.kind === 'stop') { stopped = true; return; }
  stopped = false;
  try {
    const acc = new OverlayAccumulator(q.legend, q.grid);
    const list = tilesFor(q.grid.bbox, q.zoom);
    const S = 256;
    const canvas = new OffscreenCanvas(S, S);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    let done = 0, missing = 0, next = 0;
    const one = async () => {
      while (next < list.length && !stopped) {
        const t = list[next++];
        try {
          const r = await fetch(q.template.replace('{z}', String(q.zoom)).replace('{x}', String(t.x)).replace('{y}', String(t.y)));
          if (!r.ok) { missing++; continue; }
          const bmp = await createImageBitmap(await r.blob());
          ctx.clearRect(0, 0, S, S);
          ctx.drawImage(bmp, 0, 0, S, S);
          bmp.close();
          acc.addTile(ctx.getImageData(0, 0, S, S).data, S, t.x, t.y, q.zoom);
        } catch { missing++; }
        finally { done++; if (done % 10 === 0 || done === list.length) post({ kind: 'progress', done, total: list.length }); }
      }
    };
    await Promise.all(Array.from({ length: 6 }, one));
    if (stopped) { post({ kind: 'error', error: 'остановлено' }); return; }
    if (!acc.tiles) { post({ kind: 'error', error: 'в области нет тайлов карты на этом уровне' }); return; }
    post({ kind: 'done', result: acc.result({ source: q.source, zoom: q.zoom }), tiles: acc.tiles, missing });
  } catch (err) { post({ kind: 'error', error: (err as Error).message }); }
};
