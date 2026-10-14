/**
 * Знак под курсором на карте просмотра (переигровка, игра, театр): ближайший к точке экрана знак, надпись или
 * линия видимых слоёв в момент времени. Общий код подсказки при наведении (MapHover) и щелчка по знаку
 * соединения (карточки в переигровке и игре). Ищется по геометрии: слои просмотра закрыты, событий знаков нет.
 */
import { documentAt, type Feature, type LngLat, type MapDocument, type TimeInstant } from '@def-ops/core';

export type Project = (p: LngLat) => [number, number] | number[];

const segDist = (p: [number, number], a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

/** Объекты, нарисованные в момент t: видимые слои (кроме skip), не скрытые, с названием. */
export function shownFeatures(doc: MapDocument, t: TimeInstant | null, skip: string[] = []): Feature[] {
  const shown = documentAt(doc, t, { visibleOnly: true });
  const vis = new Set(shown.layers.filter((l) => l.visible && !skip.includes(l.id)).map((l) => l.id));
  return shown.features.filter((f) => vis.has(f.layerId) && !f.hidden && f.name);
}

/**
 * Ближайший к точке p (пиксели экрана) объект не дальше radius: у знака расстояние считается от края (центр − 6 px),
 * у надписи — центр − 10 px, у стрелки и линии — до ближайшего отрезка. Знаки важнее линий: при почти равном
 * расстоянии берётся знак. lines: false — только знаки и надписи; filter — какие объекты вообще годятся.
 */
export function nearestFeature(feats: Feature[], project: Project, p: [number, number], o: { radius?: number; lines?: boolean; filter?: (f: Feature) => boolean } = {}): Feature | null {
  const { radius = 14, lines = true, filter } = o;
  let best: Feature | null = null, bd = radius;
  for (const f of feats) {
    if (filter && !filter(f)) continue;
    let d = Infinity;
    if (f.kind === 'symbol' || f.kind === 'label') { const q = project(f.at); d = Math.hypot(q[0] - p[0], q[1] - p[1]) - (f.kind === 'symbol' ? 6 : 10); }
    else if (lines && 'points' in f && f.points.length > 1) {
      const pts = f.points.map((x) => project(x) as [number, number]);
      for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1], pts[i]) - (f.kind === 'arrow' ? 6 : 2));
    }
    if (d < bd || (best && d <= bd + 2 && f.kind === 'symbol' && best.kind !== 'symbol')) { bd = d; best = f; }
  }
  return best;
}

/** Знак соединения расчёта под точкой: только знаки и надписи с формированием (ref), без исторических слоёв. */
export function unitAt(feats: Feature[], project: Project, p: [number, number]): (Feature & { ref: string }) | null {
  return nearestFeature(feats, project, p, { lines: false, filter: (f) => !!f.ref && !f.layerId.startsWith('hist') }) as (Feature & { ref: string }) | null;
}

/** Где нарисован знак формирования ref в момент t (первый найденный среди видимых), иначе null. */
export function unitPlace(feats: Feature[], ref: string): LngLat | null {
  const f = feats.find((x) => x.ref === ref && (x.kind === 'symbol' || x.kind === 'label') && !x.layerId.startsWith('hist'));
  return f && (f.kind === 'symbol' || f.kind === 'label') ? f.at : null;
}

/** Щелчок по элементам управления поверх карты (панели, плеер, кнопки) — не по карте. */
export const OVER_MAP = '.rp-tools, .legend, .player, .scalebar, .maplibregl-ctrl, .ag-panel, .cmd-notice, .pick-hint, button, select';
