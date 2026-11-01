/**
 * Мини-карта стенда (карточки фронтов и приказов) — вид того же документа, что у карты полного режима: те же знаки
 * атласа и та же отрисовка (`renderDocument`), уровень знаков — `withLevel`, кадр — рамка участка. Это картинка
 * без MapLibre и без подложки: отдельный экземпляр карты на каждую карточку окну стенда не по силам.
 */
import { memo, useMemo } from 'react';
import { renderDocument, type Feature, type MapDocument } from '@def-ops/core';
import { withLevel } from '../map-levels';
import type { LevelId } from '../map-level-scale';
import { fitView, type Bbox4 } from './stage-doc';

export interface StageMiniProps {
  doc: MapDocument | null;
  time: string;
  bbox: Bbox4;
  extra?: Feature[];
  level?: LevelId;
  /** Размер картинки на холсте стенда, px: по нему — размер знаков (как на карте этого размера). */
  width: number;
  height: number;
  label: string;
  className?: string;
  /** Размер знаков против карты полного режима (крупнее — для карточки фронта во всю ширину). */
  symbols?: number;
}

let seq = 0;

export const StageMini = memo(function StageMini({ doc, time, bbox, extra, level = 'front', width, height, label, className = '', symbols = 1 }: StageMiniProps) {
  const id = useMemo(() => `mini${(seq++).toString(36)}`, []);
  const svg = useMemo(() => {
    if (!doc) return null;
    const [w, s, e, n] = bbox;
    const mx = (e - w) * 0.25, my = (n - s) * 0.25;
    const inBox = (p: readonly number[]) => p[0] > w - mx && p[0] < e + mx && p[1] > s - my && p[1] < n + my;
    const near = (f: Feature) => (f.kind === 'symbol' || f.kind === 'label' ? inBox(f.at) || !!f.keyframes?.length : 'points' in f ? f.points.some(inBox) : true);
    const d = withLevel({ ...doc, sizing: { min: 0.9 * symbols, max: 1.2 * symbols }, features: [...doc.features.filter(near), ...(extra ?? [])] }, level);
    const v = fitView(bbox, width, height, 0.04);
    const r = renderDocument(d, { idPrefix: id, time, view: { zoom: v.zoom } });
    const half = [width / 2, height / 2].map((x) => x / Math.pow(2, v.zoom - doc.refZoom));
    const c = r.proj.toWorld(v.center);
    const box = [c[0] - half[0], c[1] - half[1], half[0] * 2, half[1] * 2].map((x) => x.toFixed(1)).join(' ');
    const body = r.layers.map((l) => `<g${l.opacity < 1 ? ` opacity="${l.opacity}"` : ''}>${l.features.map((f) => f.svg).join('')}</g>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" preserveAspectRatio="xMidYMid slice"><defs>${r.defs}</defs><rect x="-1e6" y="-1e6" width="2e6" height="2e6" fill="${doc.paper}"/>${body}</svg>`;
  }, [doc, time, bbox, extra, level, width, height, id, symbols]);
  return <span className={`expo-mini ${className}`} role="img" aria-label={label} dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />;
});
