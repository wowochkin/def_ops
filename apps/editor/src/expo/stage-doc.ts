/**
 * Карта стенда — документ полного режима по ходу ядра сеанса: те же `agentsToRun` → `runToDocument`, что у переигровки
 * агентной модели, и те же слои, что у экрана «Командование» (реки театра, линии фронта, войска уровней «Фронт»
 * и «Корпус», бои, котлы, крепости, полосы), без слоёв истории и тыла. Уровень знаков сцена выбирает `withLevel`,
 * как в полном режиме. Зоны влияния сторон — снимками по суткам (`zonesOf`), картинкой под знаками.
 * Поверх — стрелки приказа карточки и пути армий на итоге (знаки атласа), кадр камеры по рамке.
 */
import { createFeature, DEFAULT_SIZING, type Feature, type LngLat, type MapDocument, type SymbolFeature } from '@def-ops/core';
import { agentsHistory, agentsToRun, runToDocument, snapshotZones, type AgentHistory, type AgentTrace, type History, type SimContext, type ZoneGrid } from '@def-ops/sim';
import type { Arrow } from './map';

/** Слои карты стенда (как у «Командования»); историческая линия фронта и положения армий по истории — скрыты. */
export const STAGE_LAYERS = [
  'rivers', 'theatre', 'sim-front-start', 'sim-front-prev', 'sim-front', 'sim-pockets', 'sim-fortress', 'sim-corps', 'sim-enemy', 'sim-own',
  'sim-combat', 'sim-bounds', 'hist-front', 'lvl-op-hist', 'lvl-op-units', 'lvl-op-moves', 'lvl-op-bounds',
];
const HIDDEN = new Set(['hist-front', 'lvl-op-hist']);
export const ORDERS_LAYER = 'expo-orders';

/** Рамка [запад, юг, восток, север]. */
export type Bbox4 = [number, number, number, number];

/** Шаг снимков карты, ч: армии идут по положениям ядра через столько часов (между ними — плавно). */
export const STAGE_STEP_H = 3;

/** Зоны влияния на момент `time`: снимок хода ядра; значения — обычным массивом (документ идёт окнам через JSON). */
export interface ZoneFrame { time: string; grid: ZoneGrid }

/** Знак реки театра (большие — толще), как на карте «Командования». */
const river = (rv: { name?: string; major?: boolean; line: LngLat[] }): Feature => {
  const f = createFeature('line', 'inf.river', { points: rv.line, layerId: 'rivers' }, rv.major ? 1.3 : 0.7);
  f.name = rv.name;
  return f;
};

export function stageDoc(base: SimContext, trace: AgentTrace, history: AgentHistory, baseHistory: History | null): { doc: MapDocument; zones: ZoneFrame[] } {
  const { ctx, run } = agentsToRun(base, trace, STAGE_STEP_H);
  const doc = runToDocument(ctx, run, agentsHistory(history, baseHistory), { name: 'Стенд', frontCombine: 'max' });
  const keep = new Set(STAGE_LAYERS);
  const rivers = ctx.theatre.data.rivers.filter((rv) => rv.line.length > 1).map(river);
  const layers = [{ id: 'rivers', name: 'Театр: реки', role: 'base' as const, visible: true, locked: true, opacity: 0.85 }, ...doc.layers];
  return {
    doc: {
      ...doc,
      paper: '#efe4c8',
      // размер знаков — как у карты полного режима по умолчанию: растут с картой не больше чем в полтора раза
      sizing: DEFAULT_SIZING,
      declutter: true,
      layers: [
        ...layers.filter((l) => keep.has(l.id)).map((l) => ({ ...l, visible: l.visible && !HIDDEN.has(l.id), locked: true })),
        { id: ORDERS_LAYER, name: 'Приказ', role: 'custom', visible: true, locked: true, opacity: 1 },
      ],
      features: [...rivers, ...doc.features.filter((f) => keep.has(f.layerId)).map(quiet)],
    },
    zones: zonesOf(ctx, run.snapshots),
  };
}

/** Дивизии на уровне «Корпус» — без номеров: подписи у контуров корпусов, на экране стенда номера дивизий слипаются. */
const UNNAMED = new Set(['sim-own', 'sim-enemy']);
const quiet = (f: Feature): Feature => (f.kind === 'symbol' && UNNAMED.has(f.layerId) && f.style.text ? { ...f, style: { ...f.style, text: '' } } : f);

/** Зоны влияния советской стороны по снимкам хода: раз в сутки от начала и последний снимок (как у «Переигровки»). */
function zonesOf(ctx: SimContext, sn: ReturnType<typeof agentsToRun>['run']['snapshots']): ZoneFrame[] {
  try {
    if (!sn.length) return [];
    const side = (ctx.scenario.sides.find((x) => x.id === 'su') ?? ctx.scenario.sides[0]).id;
    const t0 = Date.parse(`${sn[0].time}Z`);
    const picked: typeof sn = [];
    for (let k = 0; ; k++) {
      const s = sn.find((x) => Date.parse(`${x.time}Z`) >= t0 + k * 86_400_000);
      if (!s) break;
      if (!picked.includes(s)) picked.push(s);
    }
    if (!picked.includes(sn[sn.length - 1])) picked.push(sn[sn.length - 1]);
    return picked.map((s) => {
      const g = snapshotZones(ctx, s, side);
      return { time: s.time, grid: { ...g, v: Array.from(g.v, (x) => Math.round(x)) } };
    });
  } catch {
    return [];
  }
}

/** Положение армии (знака уровня фронта) по ключевым кадрам на момент `t` (ISO); null — знака нет. */
function armyAt(f: SymbolFeature, t: string): LngLat | null {
  const k = f.keyframes;
  if (!k?.length) return f.at;
  let best: LngLat | null = null;
  for (const x of k) if (x.t <= t && x.at) best = x.at as LngLat;
  return best ?? (k[0].at as LngLat | undefined) ?? f.at;
}

/** Суточные точки пути армий (знаки слоя `layer` с `ref` из `ids`) от начала до `until`, по 20:00 и последней. */
export function dailyPaths(doc: MapDocument, ids: string[], until: string, layer = 'lvl-op-units'): Record<string, LngLat[]> {
  const start = doc.timeline?.start ?? until;
  const days: string[] = [];
  for (let t = Date.parse(`${start}:00Z`); ; t += 86_400_000) {
    const iso = new Date(t).toISOString().slice(0, 16);
    if (iso >= until) break;
    days.push(iso);
  }
  days.push(until);
  const out: Record<string, LngLat[]> = {};
  for (const f of doc.features) {
    if (f.kind !== 'symbol' || f.layerId !== layer || !f.ref || !ids.includes(f.ref)) continue;
    const pts = days.map((d) => armyAt(f, d)).filter((p): p is LngLat => !!p);
    const uniq = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.01);
    if (uniq.length > 1) out[f.ref] = [...(out[f.ref] ?? []), ...uniq];
  }
  return out;
}

const k = (doc: MapDocument, zoom: number) => Math.pow(2, doc.refZoom - zoom);

/** Стрелки приказа карточки — знаки атласа: танковые армии — танковой стрелкой, прочие — стрелкой удара. */
export function orderFeatures(doc: MapDocument, arrows: Arrow[], zoom: number, tanks: (army: string) => boolean): Feature[] {
  return arrows.map((a) => {
    const mid: LngLat = [(a.from[0] + a.to[0]) / 2 + (a.to[1] - a.from[1]) * 0.12, (a.from[1] + a.to[1]) / 2 - (a.to[0] - a.from[0]) * 0.12];
    const preset = a.kind === 'hold' || a.kind === 'defend' ? 'atlas.reached' : tanks(a.army) ? 'atlas.tank' : 'atlas.p2';
    return { ...createFeature('arrow', preset, { points: [a.from, mid, a.to], layerId: ORDERS_LAYER }, k(doc, zoom), 'own'), id: `order-${a.army}` };
  });
}

/** Пути армий на итоге: сеанса — тонкой стрелкой атласа, исторический — контурной (полой). */
export function pathFeatures(doc: MapDocument, own: Record<string, LngLat[]>, history: Record<string, LngLat[]>, zoom: number): Feature[] {
  const s = k(doc, zoom) * 0.18;
  return [
    ...Object.entries(history).map(([id, pts]) => ({ ...createFeature('arrow', 'atlas.hollow', { points: pts, layerId: ORDERS_LAYER }, s, 'own'), id: `hist-${id}` })),
    ...Object.entries(own).map(([id, pts]) => ({ ...createFeature('arrow', 'atlas.thin', { points: pts, layerId: ORDERS_LAYER }, k(doc, zoom) * 0.8, 'own'), id: `path-${id}` })),
  ];
}

/** Вид карты, вмещающий рамку [запад, юг, восток, север] в окно w×h с полями `pad` (доля), веб-Меркатор, тайл 512. */
export function fitView(b: [number, number, number, number], w: number, h: number, pad = 0.08): { center: LngLat; zoom: number; bearing: number } {
  const x = (lng: number) => (lng + 180) / 360;
  const y = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
  const dx = Math.max(1e-6, x(b[2]) - x(b[0])), dy = Math.max(1e-6, y(b[1]) - y(b[3]));
  const zoom = Math.log2(Math.min((w * (1 - 2 * pad)) / (dx * 512), (h * (1 - 2 * pad)) / (dy * 512)));
  const cy = (y(b[1]) + y(b[3])) / 2;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * cy))) * 180) / Math.PI;
  return { center: [(b[0] + b[2]) / 2, lat], zoom: Math.min(11, zoom), bearing: 0 };
}

/** Рамка точек [запад, юг, восток, север]. */
export function bboxOf(pts: LngLat[]): [number, number, number, number] {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
