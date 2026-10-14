/**
 * Поток распознавания исторической карты: тайлы локальной карты (сервис картографии) → классы пикселей по
 * легенде → доли по клеткам сетки театра → маски (дороги, вода, застройка, лес). Не тормозит страницу.
 * Режим «по современной сети»: сначала тайлы вдоль дорог театра — узнать цвет дорог и проверить отрезки,
 * затем вся область узнанными цветами — дороги того времени, которых в театре нет.
 */
import { NetworkLearner, OverlayAccumulator, riverLines, roadLines, tilesFor, type OverlayLegend, type OverlayResult, type TheatreData, type WaterCheck } from '@def-ops/sim';

type Grid = { bbox: [number, number, number, number]; cols: number; rows: number };
export type OverlayRequest =
  | { kind: 'run'; template: string; legend: OverlayLegend; grid: Grid; zoom: number; source: string }
  /**
   * Сверка по современной сети: what — дороги, вода или всё; roads / rivers — линии OpenStreetMap для охвата карты
   * вместо дорог / рек театра (уходят в результат: при сохранении заменяют театровые в охвате).
   */
  | { kind: 'network'; template: string; theatre: Pick<TheatreData, 'id' | 'name' | 'bbox' | 'cellKm' | 'roads' | 'rivers' | 'terrainGrid'>; grid: Grid; zoom: number; source: string;
      what: 'roads' | 'water' | 'all'; roads?: TheatreData['roads']; rivers?: WaterCheck['rivers'] }
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
  const T = q.theatre;
  const roadsSrc = q.roads ?? T.roads, riversSrc = q.rivers ?? T.rivers;
  const lines = [...(q.what !== 'water' ? roadLines(roadsSrc) : []), ...(q.what !== 'roads' ? riverLines(riversSrc) : [])];
  const L = new NetworkLearner(lines, q.grid.bbox, q.zoom);
  const what = q.what === 'water' ? 'рек' : q.what === 'roads' ? 'дорог' : 'дорог и рек';
  if (!L.pts.length) { post({ kind: 'error', error: `в области нет ${what} для сверки — узнавать цвет не по чему; выберите другую область` }); return; }
  const first = L.tileList(), all = tilesFor(q.grid.bbox, q.zoom), total = first.length + all.length;
  const m1 = await eachTile(q.template, q.zoom, first, (rgba, x, y) => L.addTile(rgba, 256, x, y), (done) => post({ kind: 'progress', done, total, stage: `вдоль ${what}` }));
  if (stopped) { post({ kind: 'error', error: 'остановлено' }); return; }
  if (!L.tiles) { post({ kind: 'error', error: `вдоль ${what} нет тайлов карты на этом уровне` }); return; }
  const roadCls = L.classes.filter((c) => c !== 'water');
  const roads = roadCls.length ? L.check(roadCls) : null;
  const water = L.classes.includes('water') ? L.check(['water']) : null;
  const legend = L.legend();
  if (!Object.keys(legend.pixels).length) {
    post({ kind: 'error', error: `цвет не узнан: вдоль ${what} на карте нет цвета, который встречался бы заметно чаще, чем в стороне. Проверьте привязку карты (линии должны лечь на дороги и реки карты) или возьмите образцы цвета вручную.` });
    return;
  }
  const acc = new OverlayAccumulator(legend, q.grid);
  const m2 = await eachTile(q.template, q.zoom, all, (rgba, x, y) => acc.addTile(rgba, 256, x, y, q.zoom), (done) => post({ kind: 'progress', done: first.length + done, total, stage: 'вся область узнанными цветами' }));
  if (stopped) { post({ kind: 'error', error: 'остановлено' }); return; }
  let ov = acc.result({ source: q.source, zoom: q.zoom });
  if (roads) ov = L.merge(ov, roads.state, q.roads ? { ...roads.result, roads: q.roads } : roads.result);
  if (water) ov = L.mergeWater(ov, water.state, water.result, T as TheatreData, q.rivers);
  post({ kind: 'done', result: { ...ov, legend: 'network', name: 'по современной сети' }, tiles: L.tiles + acc.tiles, missing: m1 + m2 });
}
