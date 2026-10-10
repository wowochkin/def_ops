import { describe, expect, it } from 'vitest';
import { createFeature, emptyDocument, renderDocument, type SymbolFeature } from '../src';

const unit = (at: [number, number], text: string, rank: number) => {
  const f = createFeature('symbol', 'std.unitOval', { at, layerId: 'base' }, 1, 'own') as SymbolFeature;
  f.labelRank = rank;
  f.style = { ...f.style, text };
  return f;
};

describe('разрежение подписей', () => {
  const doc = emptyDocument([14, 52.5], 9);
  doc.features = [unit([14, 52.5], '5 егерская дивизия', 2), unit([14.002, 52.5], '8 гв. А', 4), unit([14.5, 52.5], '33 А', 4)];
  const text = (r: ReturnType<typeof renderDocument>, id: string) => r.features.find((f) => f.id === id)!.svg.includes('<text');

  it('на экране: у знаков, лежащих друг на друге, — подпись верхнего; далёкие не трогаются', () => {
    const r = renderDocument({ ...doc, declutter: true }, { view: { zoom: 9 } });
    expect(text(r, doc.features[1].id)).toBe(true);
    expect(text(r, doc.features[0].id)).toBe(false);
    expect(text(r, doc.features[2].id)).toBe(true);
  });
  it('длинная подпись младшего, заходящая под соседний знак, снимается; подпись старшего остаётся', () => {
    const d = emptyDocument([14, 52.5], 9);
    d.features = [unit([14.03, 52.5], '20 танко-гренадерская дивизия', 2), unit([14, 52.5], '8 гв. А', 4)];
    const r = renderDocument({ ...d, declutter: true }, { view: { zoom: 9 } });
    expect(text(r, d.features[1].id)).toBe(true);
    expect(text(r, d.features[0].id)).toBe(false);
  });
  it('без разрежения и при экспорте (без вида) — все подписи', () => {
    const r = renderDocument(doc, { view: { zoom: 9 } });
    expect(doc.features.every((f) => text(r, f.id))).toBe(true);
    const e = renderDocument({ ...doc, declutter: true });
    expect(doc.features.every((f) => text(e, f.id))).toBe(true);
  });
});
