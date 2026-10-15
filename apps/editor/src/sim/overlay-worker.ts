/**
 * Поток распознавания исторической карты: тайлы локальной карты (сервис картографии) → классы пикселей по
 * легенде → доли по клеткам сетки театра → маски (дороги, вода, застройка, лес). Не тормозит страницу.
 * Режим «по современной сети»: сначала тайлы вдоль дорог театра — узнать цвет дорог и проверить отрезки,
 * затем вся область узнанными цветами — дороги того времени, которых в театре нет. Болота: в первом проходе — ещё и
 * тайлы у современных болот (растр театра и OSM) — узнать цвет штриховки; итог — сверка болот карты с современными.
 */
import { combineLegends, mergeMarsh, NetworkLearner, OverlayAccumulator, riverLines, roadLines, tilesFor, WetlandLearner, type OverlayLegend, type OverlayResult, type TheatreData, type WaterCheck, type Wetland } from '@def-ops/sim';

type Grid = { bbox: [number, number, number, number]; cols: number; rows: number };
export type OverlayRequest =
  /** marsh — для легенды со штриховкой болот: современные болота (растр театра и OSM) для сверки с болотами карты. */
  | { kind: 'run'; template: string; legend: OverlayLegend; grid: Grid; zoom: number; source: string; marsh?: { terrainGrid?: TheatreData['terrainGrid']; wetlands: Wetland[] } }
  /**
   * Сверка по современной сети: what — дороги, вода, болота или всё; roads / rivers — линии OpenStreetMap для охвата
   * карты вместо дорог / рек театра (уходят в результат: при сохранении заменяют театровые в охвате); wetlands — болота
   * OSM (вместе с болотами растра театра — по ним узнаётся цвет штриховки).
   */
  | { kind: 'network'; template: string; theatre: Pick<TheatreData, 'id' | 'name' | 'bbox' | 'cellKm' | 'roads' | 'rivers' | 'terrainGrid'>; grid: Grid; zoom: number; source: string;
      what: 'roads' | 'water' | 'marsh' | 'all'; roads?: TheatreData['roads']; rivers?: WaterCheck['rivers']; wetlands?: Wetland[]; sourceName?: string }
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
    let ov = acc.result({ source: q.source, zoom: q.zoom });
    if (q.marsh && q.legend.hatch?.includes('marsh')) ov = mergeMarsh(ov, { terrainGrid: q.marsh.terrainGrid }, q.marsh.wetlands, { source: 'samples', colors: [], windows: { inside: 0, outside: 0, hatched: 0 } });
    post({ kind: 'done', result: ov, tiles: acc.tiles, missing });
  } catch (err) { post({ kind: 'error', error: (err as Error).message }); }
};

const WHAT: Record<Extract<OverlayRequest, { kind: 'network' }>['what'], string> = { roads: 'дорог', water: 'рек', marsh: 'болот', all: 'дорог, рек и болот' };

async function network(q: Extract<OverlayRequest, { kind: 'network' }>) {
  const T = q.theatre;
  const roadsSrc = q.roads ?? T.roads, riversSrc = q.rivers ?? T.rivers;
  // линии — не для одних болот; болота — для «болота» и «всё»
  const L = q.what !== 'marsh' ? new NetworkLearner([...(q.what !== 'water' ? roadLines(roadsSrc) : []), ...(q.what !== 'roads' ? riverLines(riversSrc) : [])], q.grid.bbox, q.zoom) : null;
  const W = q.what === 'marsh' || q.what === 'all' ? new WetlandLearner(T, q.wetlands ?? [], q.grid, q.zoom) : null;
  const what = WHAT[q.what];
  // первый проход: тайлы вдоль линий и у современных болот, без повторов; каждый тайл — обоим (чужие они пропускают)
  const seen = new Set<string>(), first: { x: number; y: number }[] = [];
  for (const t of [...(L?.tileList() ?? []), ...(W?.tileList() ?? [])]) { const k = `${t.x},${t.y}`; if (!seen.has(k)) { seen.add(k); first.push(t); } }
  if (!L?.pts.length && !W?.tileList().length) { post({ kind: 'error', error: `в области нет ${what} для сверки — узнавать цвет не по чему; выберите другую область` }); return; }
  const all = tilesFor(q.grid.bbox, q.zoom), total = first.length + all.length;
  const stage = q.what === 'marsh' ? 'у болот' : q.what === 'all' ? 'вдоль дорог и рек, у болот' : `вдоль ${what}`;
  let tiles1 = 0; // тайлы первого прохода, взятые хотя бы одним
  const m1 = await eachTile(q.template, q.zoom, first, (rgba, x, y) => {
    const before = (L?.tiles ?? 0) + (W?.tiles ?? 0);
    L?.addTile(rgba, 256, x, y); W?.addTile(rgba, 256, x, y);
    if ((L?.tiles ?? 0) + (W?.tiles ?? 0) > before) tiles1++;
  }, (done) => post({ kind: 'progress', done, total, stage }));
  if (stopped) { post({ kind: 'error', error: 'остановлено' }); return; }
  if (!tiles1) { post({ kind: 'error', error: `${q.what === 'marsh' ? 'у' : 'вдоль'} ${what} нет тайлов карты на этом уровне` }); return; }
  const roadCls = L ? L.classes.filter((c) => c !== 'water') : [];
  const roads = L && roadCls.length ? L.check(roadCls) : null;
  const water = L?.classes.includes('water') ? L.check(['water']) : null;
  const empty: OverlayLegend = { id: 'network', name: 'цвета по современной сети', pixels: {}, cells: [] };
  const legend = combineLegends(L?.legend() ?? empty, W?.legend() ?? empty);
  // цвет болот не узнан при узнанных дорогах или воде — прогон идёт дальше (в сводке болот — «не узнан»)
  if (!Object.keys(legend.pixels).length) {
    post({ kind: 'error', error: q.what === 'marsh'
      ? `цвет штриховки не узнан: в современных болотах на карте нет цвета штриховки, который встречался бы заметно чаще, чем в стороне (окон в болотах ${W!.inside}, в стороне ${W!.outside}; нужно не меньше 20). Проверьте привязку карты или возьмите образец «болото» вручную.`
      : `цвет не узнан: вдоль ${what} на карте нет цвета, который встречался бы заметно чаще, чем в стороне. Проверьте привязку карты (линии должны лечь на дороги и реки карты) или возьмите образцы цвета вручную.` });
    return;
  }
  const acc = new OverlayAccumulator(legend, q.grid);
  const m2 = await eachTile(q.template, q.zoom, all, (rgba, x, y) => acc.addTile(rgba, 256, x, y, q.zoom), (done) => post({ kind: 'progress', done: first.length + done, total, stage: 'вся область узнанными цветами' }));
  if (stopped) { post({ kind: 'error', error: 'остановлено' }); return; }
  let ov = acc.result({ source: q.source, zoom: q.zoom });
  const src = q.sourceName ? { source: q.sourceName } : {};
  if (L && roads) ov = L.merge(ov, roads.state, q.roads ? { ...roads.result, roads: q.roads, ...src } : roads.result);
  if (L && water) ov = L.mergeWater(ov, water.state, q.rivers ? { ...water.result, ...src } : water.result, T as TheatreData, q.rivers);
  if (W) ov = W.mergeMarsh(ov);
  post({ kind: 'done', result: { ...ov, legend: 'network', name: 'по современной сети' }, tiles: tiles1 + acc.tiles, missing: m1 + m2 });
}
