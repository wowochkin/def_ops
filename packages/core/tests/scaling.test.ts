import { describe, expect, it } from 'vitest';
import {
  createFeature, emptyDocument, renderDocument, sizeFactor, inScaleRange, visibleAtScale, scaleRangeLabel,
  DEFAULT_SIZING, type MapDocument,
} from '../src';

const lineWidth = (svg: string) => Math.max(...[...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => +m[1]));

describe('размер знаков при зуме', () => {
  it('внутри коридора — как нарисовано, за пределами — постоянный экранный размер', () => {
    const f = { scale: 1 };
    expect(sizeFactor(f, 10, 10, DEFAULT_SIZING)).toBe(1);
    expect(sizeFactor(f, 10, 10.5, DEFAULT_SIZING)).toBe(1); // ×1,41 — в коридоре
    // зум +3: на экране было бы ×8, ограничено ×1,5 → стиль ×1,5/8
    expect(sizeFactor(f, 10, 13, DEFAULT_SIZING)).toBeCloseTo(1.5 / 8);
    // зум −2: было бы ×0,25 → не меньше ×0,5 → стиль ×2
    expect(sizeFactor(f, 10, 8, DEFAULT_SIZING)).toBeCloseTo(2);
    expect(sizeFactor(f, 10, 13, { min: 0, max: null })).toBe(1);
    expect(sizeFactor(f, 10, 13, { min: 1, max: 1 })).toBeCloseTo(1 / 8);
  });

  it('коридор считается от зума, на котором знак нарисован (sizeRef), а не от ручного масштаба', () => {
    // нарисован на зуме 12 при refZoom 10: sizeRef = 1/4; вручную увеличен вдвое: scale = 1/2
    expect(sizeFactor({ scale: 0.5, sizeRef: 0.25 }, 10, 12, DEFAULT_SIZING)).toBe(1);
    expect(sizeFactor({ scale: 0.5, sizeRef: 0.25 }, 10, 15, DEFAULT_SIZING)).toBeCloseTo(1.5 / 8);
  });

  it('createFeature запоминает sizeRef', () => {
    expect(createFeature('arrow', 'inf.attack', { points: [[0, 0], [1, 1]] }, 0.25).sizeRef).toBe(0.25);
  });

  it('renderDocument с видом уменьшает толщины при сильном приближении, геометрию не трогает', () => {
    const doc: MapDocument = emptyDocument();
    const line = createFeature('line', 'inf.fortification', { points: [[13, 52], [14, 52.5]], layerId: 'front' }, 1);
    doc.features.push(line);
    const plain = renderDocument(doc).features[0].svg;
    const near = renderDocument(doc, { view: { zoom: doc.refZoom + 4 } }).features[0].svg;
    expect(lineWidth(near)).toBeCloseTo(lineWidth(plain) * 1.5 / 16, 2);
    const same = renderDocument(doc, { view: { zoom: doc.refZoom } }).features[0].svg;
    expect(same).toBe(plain);
  });
});

describe('видимость по масштабу', () => {
  it('диапазоны слоя и знака', () => {
    expect(inScaleRange(null, 1e6)).toBe(true);
    const r = { from: 200_000, to: 2_000_000 };
    expect(inScaleRange(r, 1_000_000)).toBe(true);
    expect(inScaleRange(r, 100_000)).toBe(false);
    expect(inScaleRange(r, 5_000_000)).toBe(false);
    expect(inScaleRange(r, 198_000)).toBe(true); // допуск
    expect(visibleAtScale({ scales: { from: 50_000 } }, { scales: r }, 300_000)).toBe(true);
    expect(visibleAtScale({ scales: { to: 100_000 } }, { scales: r }, 300_000)).toBe(false);
    expect(scaleRangeLabel(r)).toBe('1:200 000 – 1:2 000 000');
    expect(scaleRangeLabel({ to: 500_000 })).toBe('1:500 000 и крупнее');
  });

  it('renderDocument скрывает знаки и слои вне масштаба только при заданном виде', () => {
    const doc: MapDocument = emptyDocument();
    doc.features.push(createFeature('line', 'inf.fortification', { points: [[13, 52], [14, 52.5]], layerId: 'front' }, 1));
    doc.features.push({ ...createFeature('line', 'inf.fortification', { points: [[13, 52], [14, 52.6]], layerId: 'front' }, 1), scales: { to: 100_000 } });
    doc.layers = doc.layers.map((l) => (l.id === 'base' ? { ...l, scales: { from: 1_000_000 } } : l));
    doc.features.push(createFeature('line', 'inf.fortification', { points: [[13, 52], [14, 52.7]], layerId: 'base' }, 1));
    expect(renderDocument(doc).features).toHaveLength(3);
    expect(renderDocument(doc, { view: { zoom: 8, denominator: 500_000 } }).features).toHaveLength(1);
    expect(renderDocument(doc, { view: { zoom: 6, denominator: 2_000_000 } }).features).toHaveLength(2);
    expect(renderDocument(doc, { view: { zoom: 11, denominator: 50_000 } }).features).toHaveLength(2);
  });
});
