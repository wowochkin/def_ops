import { describe, expect, it } from 'vitest';
import { featureFilter, type FilterSpecification, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { ohmYear, type MapSource } from '@def-ops/core';
import { absolutize, BASE_PREFIX, dateFilter, vectorBase, withDate } from '../src/engine/vector-basemap';
import { basemapDate, localBasemapSpec } from '../src/engine/basemaps';

const passes = (f: FilterSpecification, properties: Record<string, unknown>) =>
  featureFilter(f, 'filter').filter({ zoom: 14 }, { type: 1, properties } as never);

describe('dateFilter — показ на дату (Review Focus 4)', () => {
  const Y = ohmYear('1945-04-16T05:00:00+03:00')!;
  const f = dateFilter(Y);
  it('пропускает объекты без дат, начатые раньше, кончающиеся в сам день и позже', () => {
    expect(passes(f, {})).toBe(true);
    expect(passes(f, { from: 1900 })).toBe(true);
    expect(passes(f, { to: Y })).toBe(true);
    expect(passes(f, { from: Y })).toBe(true);
    expect(passes(f, { to: 1946 })).toBe(true);
  });
  it('не пропускает будущие, кончившиеся раньше и с from > to', () => {
    expect(passes(f, { from: 1950 })).toBe(false);
    expect(passes(f, { to: 1945.0 })).toBe(false);
    expect(passes(f, { from: 1950, to: 1940 })).toBe(false);
  });
});

describe('withDate', () => {
  const f: FilterSpecification = ['==', ['get', 'class'], 'primary'];
  it('оборачивает фильтр слоя', () => {
    expect(withDate(f, 1945)).toEqual(['all', dateFilter(1945), f]);
    const w = withDate(f, 1945)!;
    expect(passes(w, { class: 'primary', from: 1900 })).toBe(true);
    expect(passes(w, { class: 'primary', from: 1950 })).toBe(false);
    expect(passes(w, { class: 'secondary' })).toBe(false);
  });
  it('без года — фильтр как есть', () => expect(withDate(f, null)).toBe(f));
  it('слой без фильтра — только дата', () => {
    expect(withDate(undefined, 1945)).toEqual(dateFilter(1945));
    expect(passes(withDate(undefined, 1945)!, { from: 1950 })).toBe(false);
    expect(passes(withDate(undefined, 1945)!, {})).toBe(true);
    expect(withDate(undefined, null)).toBeUndefined();
  });
});

describe('absolutize', () => {
  const base = 'http://127.0.0.1:5173/api/cartography/maps/x/style?v=1';
  it('путь от корня — от origin, без кодирования {…}', () => {
    expect(absolutize('/api/cartography/fonts/{fontstack}/{range}.pbf', base)).toBe('http://127.0.0.1:5173/api/cartography/fonts/{fontstack}/{range}.pbf');
  });
  it('абсолютный — как есть', () => expect(absolutize('https://a/b', base)).toBe('https://a/b'));
  it('относительный — от папки стиля', () => expect(absolutize('tiles/{z}.pbf', base)).toBe('http://127.0.0.1:5173/api/cartography/maps/x/tiles/{z}.pbf'));
});

describe('vectorBase', () => {
  const fillFilter: FilterSpecification = ['==', ['get', 'class'], 'forest'];
  const style: StyleSpecification = {
    version: 8,
    glyphs: '/api/cartography/fonts/{fontstack}/{range}.pbf',
    sprite: '/api/cartography/sprites/ohm',
    sources: { ohm: { type: 'vector', tiles: ['/api/cartography/maps/x/tiles/{z}/{x}/{y}.pbf?v=1'], maxzoom: 16 } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
      { id: 'landuse', type: 'fill', source: 'ohm', 'source-layer': 'landuse', filter: fillFilter, paint: { 'fill-color': '#0f0', 'fill-opacity': 0.8 } },
      { id: 'place', type: 'symbol', source: 'ohm', 'source-layer': 'places', layout: { 'text-field': ['get', 'name'] } },
    ],
  };
  const v = vectorBase(style, { opacity: 0.5, year: 1945, base: 'http://127.0.0.1:5173/api/cartography/maps/x/style?v=1' });
  it('слои с префиксом, без фона, прозрачность умножена', () => {
    expect(v.layers.map((l) => l.id)).toEqual([`${BASE_PREFIX}landuse`, `${BASE_PREFIX}place`]);
    for (const l of v.layers) expect((l as { source: string }).source).toBe('base-ohm');
    const fill = v.layers[0] as { paint: Record<string, unknown> };
    expect(fill.paint['fill-opacity']).toBeCloseTo(0.4);
    expect(fill.paint['fill-color']).toBe('#0f0');
    const sym = v.layers[1] as { paint: Record<string, unknown> };
    expect(sym.paint['text-opacity']).toBeCloseTo(0.5);
    expect(sym.paint['icon-opacity']).toBeCloseTo(0.5);
  });
  it('фильтры обёрнуты датой, исходные — в filters', () => {
    expect((v.layers[0] as { filter: unknown }).filter).toEqual(['all', dateFilter(1945), fillFilter]);
    expect((v.layers[1] as { filter: unknown }).filter).toEqual(dateFilter(1945));
    expect(v.filters).toEqual({ 'base-landuse': fillFilter, 'base-place': undefined });
  });
  it('адреса абсолютны', () => {
    expect((v.sources['base-ohm'] as { tiles: string[] }).tiles[0]).toBe('http://127.0.0.1:5173/api/cartography/maps/x/tiles/{z}/{x}/{y}.pbf?v=1');
    expect(v.glyphs).toBe('http://127.0.0.1:5173/api/cartography/fonts/{fontstack}/{range}.pbf');
    expect(v.sprite).toBe('http://127.0.0.1:5173/api/cartography/sprites/ohm');
  });
  it('исходный стиль не меняется', () => {
    expect((style.layers[1] as { paint: Record<string, unknown> }).paint['fill-opacity']).toBe(0.8);
    expect(style.layers[1].id).toBe('landuse');
  });
});

describe('localBasemapSpec и basemapDate', () => {
  const common = { minzoom: 0, bounds: [13, 52, 14, 53] as MapSource['bounds'], attribution: 'src' };
  const vector = { ...common, id: 'v1', name: 'OHM', kind: 'vector', format: 'pbf', tileSize: 512, maxzoom: 16 } as MapSource;
  const raster = { ...common, id: 'r1', name: 'Скан', date: '1944', kind: 'xyz', format: 'png', tileSize: 256, maxzoom: 17 } as MapSource;
  const urls = { tiles: 'http://h/tiles/{z}/{x}/{y}.png', style: 'http://h/style?v=1' };
  it('векторная — стиль и «на дату»', () => {
    const s = localBasemapSpec(vector, urls);
    expect(s).toMatchObject({ id: 'local-v1', name: 'OHM', tiles: [], style: urls.style, dated: true, attribution: 'src', maxzoom: 19 });
  });
  it('растровая — тайлы, без dated', () => {
    const s = localBasemapSpec(raster, urls);
    expect(s).toMatchObject({ id: 'local-r1', name: 'Скан (1944)', tiles: [urls.tiles], tileSize: 256, maxzoom: 17 });
    expect(s.dated).toBeUndefined();
    expect(s.style).toBeUndefined();
  });
  it('дата показа', () => {
    const vs = localBasemapSpec(vector, urls), rs = localBasemapSpec(raster, urls);
    expect(basemapDate(vs, null, 1945)).toBe('1945-01-01');
    expect(basemapDate(vs, undefined, 1950)).toBe('1950-01-01');
    expect(basemapDate(vs, '1945-04-16T05:00:00+03:00', 1945)).toBe('1945-04-16T05:00:00+03:00');
    expect(basemapDate(rs, '1945-04-16T05:00:00+03:00', 1945)).toBeNull();
    expect(basemapDate(null, '1945-04-16', 1945)).toBeNull();
  });
});
