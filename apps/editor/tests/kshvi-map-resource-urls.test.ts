// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { annotationFont, snapshotStyleUrls } from '../src/modern/kshvi/preparation/InitialMapCanvas';

it('проводит ресурсы живого картографического сервиса через API, сохраняя уже готовые адреса', () => {
  const style = { version: 8, glyphs: '/cartography/fonts/{fontstack}/{range}.pbf', sprite: '/cartography/sprites/ohm',
    sources: { dem: { type: 'raster-dem', tiles: ['/cartography/atlas/actual/tiles/{z}/{x}/{y}'] },
      frozen: { type: 'raster', tiles: ['/kshvi/environment/snapshots/hash/atlas/id/tiles/{z}/{x}/{y}'] },
      ready: { type: 'vector', tiles: ['/api/cartography/atlas/ready/tiles/{z}/{x}/{y}'] } }, layers: [] };
  const converted = snapshotStyleUrls(style);
  expect(converted.sources.dem.tiles).toEqual(['/api/cartography/atlas/actual/tiles/{z}/{x}/{y}']);
  expect(converted.glyphs).toBe('/api/cartography/fonts/{fontstack}/{range}.pbf');
  expect(converted.sprite).toBe('/api/cartography/sprites/ohm');
  expect(converted.sources.frozen.tiles[0]).toBe('/api/kshvi/environment/snapshots/hash/atlas/id/tiles/{z}/{x}/{y}');
  expect(converted.sources.ready.tiles[0]).toBe('/api/cartography/atlas/ready/tiles/{z}/{x}/{y}');
  expect(snapshotStyleUrls(converted)).toEqual(converted);
  expect(style.sources.dem.tiles[0]).toBe('/cartography/atlas/actual/tiles/{z}/{x}/{y}');
});


it('подписи используют шрифт из снимка вместо отсутствующего стандартного стека MapLibre', () => {
  const style = { version: 8 as const, glyphs: '/api/kshvi/environment/snapshots/hash/resources/glyphs/{fontstack}/{range}.pbf', sources: {}, layers: [
    { id: 'actual-labels', type: 'symbol' as const, source: 'atlas', layout: { 'text-font': ['OpenHistorical'] } },
  ] };
  expect(annotationFont(style)).toEqual(['OpenHistorical']);
  expect(annotationFont({ version: 8, sources: {}, layers: [] })).toBeNull();
});
