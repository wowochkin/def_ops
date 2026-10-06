import { describe, it, expect } from 'vitest';
import { Path, smoothPath, removeLoops } from '@def-ops/core';
import { makeProjection } from '@def-ops/core';
import { arrowGeometry } from '@def-ops/core';
import { baseArrow, scaleStyle, PRESETS } from '@def-ops/core';
import { createFeature } from '@def-ops/core';
import { emptyDocument } from '@def-ops/core';
import { renderDocument, exportSVG } from '@def-ops/core';
import type { Vec2 } from '@def-ops/core';

describe('проекция', () => {
  it('туда-обратно без потери точности', () => {
    const p = makeProjection([13.4, 52.5], 7.4);
    const ll: [number, number] = [14.55, 52.34];
    const back = p.toLngLat(p.toWorld(ll));
    expect(back[0]).toBeCloseTo(ll[0], 9);
    expect(back[1]).toBeCloseTo(ll[1], 9);
    expect(p.toWorld([13.4, 52.5])).toEqual([0, 0]);
  });
});

describe('кривые', () => {
  it('сплайн проходит через опорные точки', () => {
    const pts: Vec2[] = [[0, 0], [100, 50], [200, 0]];
    const s = smoothPath(pts);
    for (const p of pts) expect(s.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6)).toBe(true);
  });
  it('параметризация по длине и ближайшая точка', () => {
    const path = new Path([[0, 0], [100, 0]]);
    expect(path.length).toBe(100);
    expect(path.pointAt(25)).toEqual([25, 0]);
    const n = path.nearest([40, 10]);
    expect(n.s).toBeCloseTo(40);
    expect(n.d).toBeCloseTo(10);
  });
  it('удаление петель эквидистанты', () => {
    const loop: Vec2[] = [[0, 0], [10, 0], [10, 10], [5, -5], [20, -5]];
    const r = removeLoops(loop);
    expect(r.length).toBeLessThan(loop.length);
  });
});

describe('стрелка', () => {
  const line = new Path(smoothPath([[0, -100], [0, 0], [0, 100]]));
  it('хвост привязанной стрелки лежит на линии фронта', () => {
    const st = baseArrow({ tailWidth: 30, neckWidth: 10, anchorOverlap: 0 });
    const g = arrowGeometry([line.pointAt(100), [-80, 0], [-200, 10]], st, line, 100)!;
    expect(g.anchored).toBe(true);
    // начало и конец контура (края основания) — на линии x = 0
    expect(Math.abs(g.outline[0][0])).toBeLessThan(1e-6);
    const lastStrokePt = g.strokeOutline[g.strokeOutline.length - 1];
    expect(Math.abs(lastStrokePt[0])).toBeLessThan(1e-6);
    // ширина основания вдоль линии ≈ ширине хвоста
    expect(Math.abs(g.outline[0][1] - lastStrokePt[1])).toBeCloseTo(30, 0);
  });
  it('острие — в последней точке оси', () => {
    const st = baseArrow();
    const g = arrowGeometry([[0, 0], [100, 0], [300, 0]], st)!;
    const tip = g.outline.reduce((a, b) => (b[0] > a[0] ? b : a));
    expect(tip[0]).toBeCloseTo(300, 3);
    expect(tip[1]).toBeCloseTo(0, 3);
  });
});

describe('пресеты', () => {
  it('масштабирование меняет размеры, но не доли и прозрачность', () => {
    const st = scaleStyle(baseArrow(), 2);
    expect(st.tailWidth).toBe(48);
    expect(st.fill[0].opacity).toBe(1);
    expect(st.taper).toBe(1);
  });
  it('все пресеты рендерятся без ошибок', () => {
    const doc = emptyDocument([13.4, 52.5], 7.4);
    const p = makeProjection(doc.origin, doc.refZoom);
    const ll = (x: number, y: number) => p.toLngLat([x, y]);
    for (const [kind, table] of Object.entries(PRESETS)) {
      for (const id of Object.keys(table)) {
        const geom = kind === 'symbol' || kind === 'label'
          ? { at: ll(0, 0), text: 'Тест' }
          : { points: [ll(0, 0), ll(100, -30), ll(200, 20)] };
        doc.features.push(createFeature(kind as never, id, geom));
      }
    }
    const r = renderDocument(doc);
    expect(r.features.length).toBe(doc.features.length);
    for (const f of r.features) expect(f.svg.length).toBeGreaterThan(20);
    expect(exportSVG(doc)).toMatch(/^<svg/);
  });
});
