import { describe, expect, it } from 'vitest';
import { loadTheatre } from '../src/data';
import { cropTheatre, layerCounts, layerGeoJSON, recipeFor, theatreToDocument } from '../src/theatre-io';
import { decodeGrid, Theatre } from '../src/theatre';

describe('театр: просмотр, обрезка по области, выгрузка слоёв', () => {
  const T = loadTheatre('oder-berlin-1945');
  const b: [number, number, number, number] = [13.0, 52.4, 13.8, 52.7];

  it('фрагмент: растры местности и дорог обрезаны по клеткам, объекты — задевающие область; движок его принимает', () => {
    const f = cropTheatre(T, b, 'berlin-area');
    expect(f.id).toBe('berlin-area');
    const g = f.terrainGrid!;
    expect(g.bbox[0]).toBeLessThanOrEqual(b[0]); expect(g.bbox[2]).toBeGreaterThanOrEqual(b[2]);
    expect(decodeGrid(g).length).toBe(g.cols * g.rows);
    expect(f.roadGrid?.rle).toMatch(/^[0-9nrh]+$/);
    expect(f.areas.length).toBeGreaterThan(0);
    expect(f.areas.length).toBeLessThan(T.areas.length);
    expect(() => new Theatre(f)).not.toThrow();
    const c = layerCounts(T, b);
    expect(c.rivers).toBe(f.rivers.length);
  });

  it('слои в GeoJSON, документ карты, рецепт сборщика', () => {
    const rivers = layerGeoJSON(T, 'rivers', b);
    expect(rivers.features.length).toBeGreaterThan(0);
    expect(rivers.features[0].geometry.type).toBe('LineString');
    const areas = layerGeoJSON(T, 'areas', b);
    expect(areas.features[0].properties.title).toBeTruthy();
    const doc = theatreToDocument(T);
    expect(doc.layers.map((l) => l.id)).toContain('th-rivers');
    expect(doc.features.length).toBeGreaterThan(100);
    const r = recipeFor({ id: 'x', name: 'X', bbox: b, cellKm: 1 });
    expect((r.grid as { dLat: number }).dLat).toBeCloseTo(1 / 111.32, 4);
    expect((r.areas as { fromOsm: object }).fromOsm).toBeTruthy();
    expect((r.rivers as { autoMajorKm: number }).autoMajorKm).toBeGreaterThan(0);
  });
});
