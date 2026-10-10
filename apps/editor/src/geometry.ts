/** Геометрические операции редактора: привязка, перемещение, точки управления. */
import type { LngLat } from '@def-ops/core';
import type { Vec2 } from '@def-ops/core';
import { add, mul, sub, dot } from '@def-ops/core';
import type { ArrowBranch, ArrowFeature, Feature, MapDocument } from '@def-ops/core';
import { Path, smoothPath, polylinePath } from '@def-ops/core';
import { createContext, isFeatureVisible } from '@def-ops/core';
import { arrowAxisPoints, arrowGeometry, scaleStyle } from '@def-ops/core';

export interface Snap {
  featureId: string;
  t: number;
  point: Vec2;
}

/** Ближайшая линия/контур (кроме exclude) в пределах порога — для привязки хвоста стрелки. */
export function findSnap(doc: MapDocument, world: Vec2, threshold: number, exclude?: string): Snap | null {
  const ctx = createContext(doc);
  let best: Snap | null = null;
  let bestD = threshold;
  for (const f of doc.features) {
    if (f.id === exclude || !isFeatureVisible(doc, f) || (f.kind !== 'line' && f.kind !== 'area')) continue;
    const p = ctx.featurePath(f.id);
    if (!p) continue;
    const n = p.nearest(world);
    if (n.d < bestD) {
      bestD = n.d;
      best = { featureId: f.id, t: n.s / p.length, point: n.point };
    }
  }
  return best;
}

/** Опорные точки объекта (в мировых координатах документа), с учётом привязки хвоста. */
export function controlPoints(doc: MapDocument, f: Feature): Vec2[] {
  const ctx = createContext(doc);
  if (f.kind === 'symbol' || f.kind === 'label') return [ctx.proj.toWorld(f.at)];
  if (f.kind === 'arrow') return arrowAxisPoints(f, ctx).pts;
  return f.points.map((p) => ctx.proj.toWorld(p));
}

/**
 * Ручки ширины стрелки: край хвоста и конец «уса» наконечника.
 * m — множитель размеров оформления на текущем масштабе (как стрелка показана).
 */
export function arrowWidthHandles(doc: MapDocument, f: ArrowFeature, m = 1): { tail: Vec2; barb: Vec2; neck: Vec2; tailN: Vec2; neckN: Vec2; neckT: Vec2 } | null {
  const ctx = createContext(doc);
  const { pts, anchorPath, anchorS } = arrowAxisPoints(f, ctx);
  const st = m === 1 ? f.style : scaleStyle(f.style, m);
  const g = arrowGeometry(pts, st, anchorPath, anchorS);
  if (!g) return null;
  const tailN = g.axis.normalAt(0, 2);
  const neckN = g.axis.normalAt(g.neckS, 2);
  const neckT = g.axis.tangentAt(g.neckS, 2);
  const tailS = Math.min(g.axis.length * 0.12, st.tailWidth);
  const neck = g.axis.pointAt(g.neckS);
  const barbC = g.axis.pointAt(g.barbS);
  return {
    tail: add(g.axis.pointAt(tailS), mul(g.axis.normalAt(tailS, 2), g.width(tailS) / 2)),
    barb: add(barbC, mul(g.axis.normalAt(g.barbS, 2), st.headWidth / 2)),
    neck, tailN, neckN, neckT,
  };
}

export function translateFeature(doc: MapDocument, f: Feature, dWorld: Vec2): Feature {
  const proj = createContext(doc).proj;
  const mv = (p: LngLat): LngLat => proj.toLngLat(add(proj.toWorld(p), dWorld));
  switch (f.kind) {
    case 'symbol':
      return { ...f, at: mv(f.at) };
    case 'label':
      return { ...f, at: mv(f.at), path: f.path ? f.path.map(mv) : f.path };
    case 'arrow': {
      const moved: ArrowFeature = { ...f, points: f.points.map(mv), ...(f.branches ? { branches: f.branches.map((b) => ({ ...b, points: b.points.map(mv) })) } : {}) };
      if (f.anchor) {
        // хвост скользит вдоль линии фронта к ближайшей точке
        const ctx = createContext(doc);
        const path = ctx.featurePath(f.anchor.featureId);
        if (path) {
          const tail = add(path.pointAt(f.anchor.t * path.length), dWorld);
          const n = path.nearest(tail);
          moved.anchor = { ...f.anchor, t: n.s / path.length };
          moved.points[0] = proj.toLngLat(n.point);
        }
      }
      return moved;
    }
    default:
      return { ...f, points: f.points.map(mv) };
  }
}

/** Ширина по положению ручки: удвоенная проекция на нормаль. */
export function widthFromHandle(center: Vec2, normal: Vec2, handle: Vec2): number {
  return Math.max(0.2, Math.abs(dot(sub(handle, center), normal)) * 2);
}


/* ───────────── ветви стрелки ───────────── */

/** Ось ствола стрелки (мировые координаты), как её строит отрисовка. */
export function arrowMainAxis(doc: MapDocument, f: ArrowFeature): Path | null {
  const { pts } = arrowAxisPoints(f, createContext(doc));
  if (pts.length < 2) return null;
  return new Path(f.style.smooth ? smoothPath(pts) : polylinePath(pts, false, 1));
}

/** Новая ветвь: от 60 % длины ствола в сторону, под углом ~35° к концу ствола, длиной в треть ствола. */
export function newBranch(doc: MapDocument, f: ArrowFeature): ArrowBranch | null {
  const axis = arrowMainAxis(doc, f);
  if (!axis) return null;
  const proj = createContext(doc).proj;
  const n = (f.branches ?? []).length;
  const t = 0.6;
  const fork = axis.pointAt(axis.length * t);
  const tg = axis.tangentAt(axis.length, 3);
  const a = (n % 2 === 0 ? 1 : -1) * (Math.PI / 5) * (1 + Math.floor(n / 2) * 0.6);
  const dir: Vec2 = [tg[0] * Math.cos(a) - tg[1] * Math.sin(a), tg[0] * Math.sin(a) + tg[1] * Math.cos(a)];
  const tip = add(fork, mul(dir, axis.length * 0.45));
  return { t, points: [proj.toLngLat(tip)] };
}

/** Ручки ветвей: точка развилки на стволе и точки ветви (мировые). */
export function branchHandles(doc: MapDocument, f: ArrowFeature): { fork: Vec2; points: Vec2[] }[] {
  const axis = arrowMainAxis(doc, f);
  if (!axis) return [];
  const proj = createContext(doc).proj;
  return (f.branches ?? []).map((b) => ({ fork: axis.pointAt(axis.length * Math.min(0.95, Math.max(0.05, b.t))), points: b.points.map((p) => proj.toWorld(p)) }));
}

/** Доля длины ствола для точки развилки, ближайшей к world. */
export function forkAt(doc: MapDocument, f: ArrowFeature, world: Vec2): number {
  const axis = arrowMainAxis(doc, f);
  if (!axis) return 0.6;
  return Math.min(0.95, Math.max(0.05, axis.nearest(world).s / axis.length));
}
