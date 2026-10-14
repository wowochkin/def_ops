/**
 * Поток распознавания исторической карты: тайлы локальной карты (сервис картографии) → классы пикселей по
 * легенде → доли по клеткам сетки театра → маски (дороги, вода, застройка, лес). Не тормозит страницу.
 * Режим «по современной сети»: сначала тайлы вдоль дорог театра — узнать цвет дорог и проверить отрезки,
 * затем вся область узнанными цветами — дороги того времени, которых в театре нет.
 */
import { NetworkLearner, OverlayAccumulator, tilesFor, type OverlayLegend, type OverlayResult, type TheatreData } from '@def-ops/sim';

type Grid = { bbox: [number, number, number, number]; cols: number; rows: number };
export type OverlayRequest =
  | { kind: 'run'; template: string; legend: OverlayLegend; grid: Grid; zoom: number; source: string }
  /** osm — roads в theatre взяты из OpenStreetMap для охвата карты (не дороги театра): уходят в результат. */
  | { kind: 'network'; template: string; theatre: Pick<TheatreData, 'id' | 'name' | 'bbox' | 'cellKm' | 'roads'>; grid: Grid; zoom: number; source: string; osm?: boolean }
  | { kind: 'stop' };
export type OverlayResponse = { kind: 'progress'; done: number; total: number; stage?: string } | { kind: 'done'; result: OverlayResult; tiles: number; missing: number } | { kind: 'error'; error: string };

let stopped = false;
const post = (m: OverlayResponse) => (self as unknown as Worker).postMessage(m);

/** Тайлы по списку → RGBA каждому обработчику (по шесть запросов сразу). */
async function eachTile(template: string, zoom: number, list: { x: number; y: number }[], on: (rgba: Uint8ClampedArray, x: number, y: number) => void, progress: (done: number) => void) {
  const S = 256;
  const canvas = new OffscreenCanvas(S, S);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let done = 0, missing = 0, next = 0;
  const one = async () => {
    while (next < list.length && !stopped) {
      const t = list[next++];
      try {
        const r = await fetch(template.replace('{z}', String(zoom)).replace('{x}', String(t.x)).replace('{y}', String(t.y)));
        if (!r.ok) { missing++; continue; }
        const bmp = await createImageBitmap(await r.blob());
        ctx.clearRect(0, 0, S, S);
        ctx.drawImage(bmp, 0, 0, S, S);
        bmp.close();
        on(ctx.getImageData(0, 0, S, S).data, t.x, t.y);
      } catch { missing++; }
      finally { done++; if (done % 10 === 0 || done === list.length) progress(done); }
    }
  };
  await Promise.all(Array.from({ length: 6 }, one));
  return missing;
}

self.onmessage = async (e: MessageEvent<OverlayRequest>) => {
  const q = e.data;
  if (q.kind === 'stop') { stopped = true; return; }
  stopped = false;
  try {
    if (q.kind === 'network') return await network(q);
    const acc = new OverlayAccumulator(q.legend, q.grid);
    const list = tilesFor(q.grid.bbox, q.zoom);
    const missing = await eachTile(q.template, q.zoom, list, (rgba, x, y) => acc.addTile(rgba, 256, x, y, q.zoom), (done) => post({ kind: 'progress', done, total: list.length }));
    if (stopped) { post({ kind: 'error', error: 'остановлено' }); return; }
    if (!acc.tiles) { post({ kind: 'error', error: 'в области нет тайлов карты на этом уровне' }); return; }
    post({ kind: 'done', result: acc.result({ source: q.source, zoom: q.zoom }), tiles: acc.tiles, missing });
  } catch (err) { post({ kind: 'error', error: (err as Error).message }); }
};

async function network(q: Extract<OverlayRequest, { kind: 'network' }>) {
  const L = new NetworkLearner(q.theatre as TheatreData, q.grid.bbox, q.zoom);
  if (!L.pts.length) { post({ kind: 'error', error: `в области нет ${q.osm ? 'дорог OSM' : 'дорог театра'} — узнавать цвет не по чему; выберите область с дорогами` }); return; }
  const first = L.tileList(), all = tilesFor(q.grid.bbox, q.zoom), total = first.length + all.length;
  const m1 = await eachTile(q.template, q.zoom, first, (rgba, x, y) => L.addTile(rgba, 256, x, y), (done) => post({ kind: 'progress', done, total, stage: 'вдоль дорог театра' }));
  if (stopped) { post({ kind: 'error', error: 'остановлено' }); return; }
  if (!L.tiles) { post({ kind: 'error', error: 'вдоль дорог театра нет тайлов карты на этом уровне' }); return; }
  const { state, result } = L.check();
  const legend = L.legend();
  if (!Object.keys(legend.pixels).length) {
    post({ kind: 'error', error: 'цвет дорог не узнан: вдоль дорог театра на карте нет цвета, который встречался бы заметно чаще, чем в стороне. Проверьте привязку карты (дороги театра должны лечь на дороги карты) или возьмите образцы цвета вручную.' });
    return;
  }
  const acc = new OverlayAccumulator(legend, q.grid);
  const m2 = await eachTile(q.template, q.zoom, all, (rgba, x, y) => acc.addTile(rgba, 256, x, y, q.zoom), (done) => post({ kind: 'progress', done: first.length + done, total, stage: 'вся область узнанным цветом' }));
  if (stopped) { post({ kind: 'error', error: 'остановлено' }); return; }
  const ov = L.merge(acc.result({ source: q.source, zoom: q.zoom }), state, q.osm ? { ...result, roads: q.theatre.roads } : result);
  post({ kind: 'done', result: ov, tiles: L.tiles + acc.tiles, missing: m1 + m2 });
}
