import { describe, expect, it } from 'vitest';
import { createFeature, createRenderCache, emptyDocument, renderDocument, type ArrowFeature, type Feature } from '../src';

describe('кэш отрисовки знаков', () => {
  const unit = createFeature('symbol', 'std.unitOval', { at: [14, 52.5], layerId: 'base' }, 1, 'own');
  const line = createFeature('line', 'std.border', { points: [[13.9, 52.4], [14.1, 52.6], [14.2, 52.5]], layerId: 'base' }, 1, 'own');
  const arrow = createFeature('arrow', 'inf.attack', { points: [[14.1, 52.6], [14.3, 52.7]], layerId: 'base' }, 1, 'own') as ArrowFeature;
  arrow.anchor = { featureId: line.id, t: 0.5 };
  const doc = emptyDocument([14, 52.5], 9);
  doc.features = [unit, line, arrow];
  const strip = (s: string) => s.replace(/-c?[0-9a-z]+(?=["')])/g, '');

  it('та же картинка, что без кэша; неподвижные знаки во второй раз берутся из кэша', () => {
    const cache = createRenderCache();
    const plain = renderDocument(doc, { view: { zoom: 9 } });
    const a = renderDocument(doc, { view: { zoom: 9 }, cache });
    expect(a.features.map((f) => strip(f.svg))).toEqual(plain.features.map((f) => strip(f.svg)));
    expect(cache.map.has(unit)).toBe(true);
    expect(cache.map.has(line)).toBe(true);
    // привязанная стрелка зависит от другого знака — не кэшируется
    expect(cache.map.has(arrow)).toBe(false);
    const b = renderDocument(doc, { view: { zoom: 9 }, cache });
    expect(b.features[0].svg).toBe(a.features[0].svg);
    expect(b.defs).toBe(a.defs);
  });
  it('изменённый знак (новый объект) и другой размер оформления перерисовываются', () => {
    const cache = createRenderCache();
    renderDocument(doc, { view: { zoom: 9 }, cache });
    const moved: Feature = { ...unit, at: [14.2, 52.5] } as Feature;
    const r = renderDocument({ ...doc, features: [moved, line] }, { view: { zoom: 9 }, cache });
    expect(r.features[0].svg).toBe(renderDocument({ ...doc, features: [moved] }, { view: { zoom: 9 } }).features[0].svg);
    const z = renderDocument(doc, { view: { zoom: 11 }, cache });
    expect(strip(z.features[0].svg)).toBe(strip(renderDocument(doc, { view: { zoom: 11 } }).features[0].svg));
  });
});
