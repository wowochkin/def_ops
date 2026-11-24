import { expect, it } from 'vitest';
import type { AtlasMeta } from '../../../services/cartography/src/atlas';
import { openAtlasRegion, resolveOverview, type AtlasRegionState, type RegionGroup } from '../src/modern/atlas-region-state';

const vector = { id: 'vector', kind: 'vector', name: 'Основа' } as AtlasMeta;
const terrain = { id: 'terrain', kind: 'terrain', name: 'Рельеф' } as AtlasMeta;
const otherVector = { id: 'other-vector', kind: 'vector', name: 'Другая основа' } as AtlasMeta;
const group: RegionGroup = { key: 'area', bounds: [35, 49, 37, 51], maps: [vector, terrain] };
const initial: AtlasRegionState = { regionKey: '', selected: [], disabled: [], terrainId: null, showOverview: null, byRegion: {} };

it('открытие области с одной локальной основой выбирает её и выключает OSM', () => {
  const next = openAtlasRegion(initial, group);
  expect(next.regionKey).toBe('area');
  expect(next.selected).toEqual(['vector']);
  expect(next.showOverview).toBe(false);
});

it('восстанавливает сохранённый набор именно этой области', () => {
  const saved: AtlasRegionState = { ...initial, byRegion: { area: { selected: ['terrain'], disabled: ['terrain/raster'], terrainId: 'terrain' } } };
  const next = openAtlasRegion(saved, group);
  expect(next.selected).toEqual(['terrain']);
  expect(next.disabled).toEqual(['terrain/raster']);
  expect(next.terrainId).toBe('terrain');
});

it('не выбирает молча одну из нескольких векторных основ', () => {
  const next = openAtlasRegion(initial, { ...group, maps: [vector, otherVector] });
  expect(next.selected).toEqual([]);
  expect(next.showOverview).toBeNull();
});

it('OSM является ручным выбором и не зависит от камеры', () => {
  expect(resolveOverview({ requested: null })).toBe(false);
  expect(resolveOverview({ requested: true })).toBe(true);
  expect(resolveOverview({ requested: false })).toBe(false);
});
