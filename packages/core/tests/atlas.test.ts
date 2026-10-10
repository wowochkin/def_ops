import { describe, it, expect } from 'vitest';
import { createFeature, emptyDocument, makeProjection, renderDocument, type ArrowFeature, type SymbolFeature } from '@def-ops/core';
import { arrowParts } from '../src/render/arrow';
import { createContext } from '../src/render';

const doc = () => { const d = emptyDocument([13.4, 52.5], 7.4); return d; };
const llOf = (d: ReturnType<typeof doc>) => { const p = makeProjection(d.origin, d.refZoom); return (x: number, y: number) => p.toLngLat([x, y]); };
const svgOf = (d: ReturnType<typeof doc>) => renderDocument(d).features.map((f) => f.svg).join('');

describe('графика атласа: стрелки', () => {
  it('разветвлённая стрелка: ствол и ветвь, у каждой — своё острие и дата', () => {
    const d = doc(); const ll = llOf(d);
    const f = { ...(createFeature('arrow', 'atlas.fork', { layerId: d.layers[0].id, points: [ll(0, 0), ll(150, 0), ll(300, -60)] }) as ArrowFeature),
      branches: [{ t: 0.5, points: [ll(300, 80)], text: '26.4' }], tipText: '25.4' };
    const parts = arrowParts(f, createContext(d));
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.text)).toEqual(['25.4', '26.4']);
    // острия — в концах осей ствола и ветви
    const tipOf = (k: number) => parts[k].g.outline.reduce((a, b) => (b[0] > a[0] ? b : a));
    expect(tipOf(0)[1]).toBeLessThan(-30);
    expect(tipOf(1)[1]).toBeGreaterThan(40);
    d.features = [f];
    const svg = svgOf(d);
    expect(svg).toContain('>25.4<');
    expect(svg).toContain('>26.4<');
  });

  it('окончание «рубеж достигнут» — поперечная черта вместо острия', () => {
    const d = doc(); const ll = llOf(d);
    const f = createFeature('arrow', 'atlas.reached', { layerId: d.layers[0].id, points: [ll(0, 0), ll(150, 0), ll(300, 0)] }) as ArrowFeature;
    expect(f.style.tip).toBe('bar');
    const g = arrowParts(f, createContext(d))[0].g;
    // у черты нет точки острия: контур у конца — вертикальный отрезок шире тела
    const end = g.outline.filter((p) => p[0] > 290);
    expect(end.length).toBeGreaterThan(0);
    const span = Math.max(...end.map((p) => p[1])) - Math.min(...end.map((p) => p[1]));
    expect(span).toBeGreaterThan(f.style.neckWidth);
  });
});

describe('графика атласа: знаки', () => {
  const sym = (preset: string) => { const d = doc(); const ll = llOf(d); const f = createFeature('symbol', preset, { layerId: d.layers[0].id, at: ll(0, 0) }) as SymbolFeature; f.style.text = '8 гв'; d.features = [f]; return svgOf(d); };
  it('штриховка: на марше — половина знака, формируется — весь знак', () => {
    const half = sym('atlas.armyMoving'), full = sym('atlas.armyForming');
    expect(half).toMatch(/clip-path="url\(#hatch/);
    expect(full).toMatch(/clip-path="url\(#hatch/);
    // штриховка под подписью: подпись остаётся читаемой
    expect(half.indexOf('clip-path')).toBeLessThan(half.indexOf('<text'));
  });
  it('перечёркивание: разбит — одна черта, уничтожен — крест', () => {
    const lines = (s: string) => (s.match(/<path d="M[^"]*L[^"]*" stroke="[^"]*" stroke-width="[^"]*" stroke-linecap="round"/g) ?? [])[0]?.match(/M/g)?.length;
    expect(lines(sym('atlas.enemyRouted'))).toBe(1);
    expect(lines(sym('atlas.enemyDestroyed'))).toBe(2);
  });
});
