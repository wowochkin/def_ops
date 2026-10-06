/**
 * Линии: фронт, рубежи, укрепления, позиции подразделений, ж/д.
 * Линия — набор параллельных слоёв штриха со смещением от оси;
 * у слоя могут быть зубцы (укрепления), пунктир, засечки на концах.
 */
import { type Vec2, add, mul, rotate } from '../vec';
import { Path, smoothPath, polylinePath, pathD } from '../curve';
import type { LineFeature, StrokeLayer } from '../model';
import { type RenderContext, f2 } from './context';

export function linePath(points: Vec2[], smooth: boolean, closed: boolean): Path {
  return new Path(smooth ? smoothPath(points, closed) : polylinePath(points, closed, 1), closed);
}

export function renderStrokeLayers(path: Path, layers: StrokeLayer[], closed: boolean): string {
  let out = '';
  for (const ly of layers) out += renderStrokeLayer(path, ly, closed);
  return out;
}

export function renderStrokeLayer(path: Path, ly: StrokeLayer, closed: boolean): string {
  let out = '';
  const pts = ly.offset ? path.offset(ly.offset, 3) : path.pts;
  if (ly.width > 0) {
    let a = `fill="none" stroke="${ly.color}" stroke-width="${f2(ly.width)}" stroke-linejoin="round" stroke-linecap="${ly.cap || 'butt'}"`;
    if (ly.opacity < 1) a += ` stroke-opacity="${ly.opacity}"`;
    if (ly.dash && ly.dash.length) a += ` stroke-dasharray="${ly.dash.map(f2).join(' ')}"`;
    out += `<path d="${pathD(pts, closed)}" ${a}/>`;
  }
  if (ly.ticks && ly.ticks.spacing > 0) out += renderTicks(path, ly, closed);
  if (ly.endTicks && !closed && path.length > 0) {
    const e = ly.endTicks;
    let d = '';
    for (const s of [0, path.length]) {
      const n = path.normalAt(s, 3);
      const p = add(path.pointAt(s), mul(n, ly.offset));
      const q = add(p, mul(n, e.side * e.length));
      d += pathD([p, q]);
    }
    out += `<path d="${d}" fill="none" stroke="${ly.color}" stroke-width="${f2(e.width)}" stroke-linecap="butt"${ly.opacity < 1 ? ` stroke-opacity="${ly.opacity}"` : ''}/>`;
  }
  return out;
}

function renderTicks(path: Path, ly: StrokeLayer, closed: boolean): string {
  const t = ly.ticks!;
  const L = path.length;
  const color = t.color || ly.color;
  const n = closed ? Math.max(1, Math.round(L / t.spacing)) : Math.max(1, Math.floor(L / t.spacing));
  const step = closed ? L / n : t.spacing;
  const start = closed ? step / 2 : (L - (n - 1) * step) / 2;
  const ang = ((t.angle || 0) * Math.PI) / 180;
  const sides: (1 | -1)[] = t.side === 0 ? [1, -1] : [t.side];
  let d = '';
  let tri = '';
  for (let i = 0; i < n; i++) {
    const s = start + i * step;
    if (s < 0 || s > L) continue;
    const nrm = path.normalAt(s, 3);
    const tan = path.tangentAt(s, 3);
    const c = add(path.pointAt(s), mul(nrm, ly.offset));
    for (const side of sides) {
      const dir = rotate(mul(nrm, side), ang * side);
      const p0 = add(c, mul(dir, ly.width / 2 - 0.2));
      const p1 = add(c, mul(dir, ly.width / 2 + t.length));
      if (t.shape === 'triangle') {
        const hw = t.width / 2;
        tri += pathD([add(p0, mul(tan, -hw)), p1, add(p0, mul(tan, hw))], true);
      } else d += pathD([p0, p1]);
    }
  }
  let out = '';
  if (d) out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f2(t.width)}" stroke-linecap="butt"${ly.opacity < 1 ? ` stroke-opacity="${ly.opacity}"` : ''}/>`;
  if (tri) out += `<path d="${tri}" fill="${color}"${ly.opacity < 1 ? ` fill-opacity="${ly.opacity}"` : ''}/>`;
  return out;
}

export function renderLine(f: LineFeature, ctx: RenderContext): string {
  if (f.points.length < 2) return '';
  const path = linePath(f.points.map((p) => ctx.proj.toWorld(p)), f.style.smooth, !!f.closed);
  return renderStrokeLayers(path, f.style.layers, !!f.closed);
}
