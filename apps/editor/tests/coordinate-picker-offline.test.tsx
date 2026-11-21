// @vitest-environment happy-dom
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import type {StyleSpecification} from 'maplibre-gl';
import {CoordinatePicker} from '../src/modern/CoordinatePicker';

const mock = vi.hoisted(() => ({
  setStyle: vi.fn<(style: StyleSpecification) => void>(),
  setData: vi.fn<(data: GeoJSON.FeatureCollection) => void>(),
}));
vi.mock('maplibre-gl', () => ({
  Map: class {
    loaded?: () => void;
    getCanvas() { return document.createElement('canvas'); }
    fitBounds() {}
    addControl() {}
    addSource() {}
    addLayer() {}
    remove() {}
    on() {}
    off() {}
    once(event: string, handler: () => void) { if (event === 'style.load') this.loaded = handler; }
    setStyle(style: StyleSpecification) { mock.setStyle(style); this.loaded?.(); }
    getSource(id: string) { if (id === 'geography') return {setData: mock.setData}; }
    getZoom() { return 6; }
    getBounds() { return {getWest: () => 12, getSouth: () => 51, getEast: () => 14, getNorth: () => 53}; }
  },
  NavigationControl: class {},
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('показывает встроенные контуры и подписи без сетевых карт, списков и шрифтов', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<CoordinatePicker mode="bounds" offline value={[13.3, 52.45, 13.5, 52.6]} onChange={vi.fn()} onClose={vi.fn()}/>);
  await waitFor(() => expect(mock.setData).toHaveBeenCalled());
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByText('Встроенная карта · Natural Earth')).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getAllByRole('button').every(button => button.getAttribute('type') === 'button')).toBe(true);
  const style = mock.setStyle.mock.calls[0][0];
  expect(style.glyphs).toBeUndefined();
  expect(Object.values(style.sources).map(source => source.type)).toEqual(['geojson']);
  const {features} = mock.setData.mock.calls[0][0];
  expect(features.some(f => f.geometry.type === 'Polygon')).toBe(true);
  expect(features.some(f => f.properties?.name === 'Берлин')).toBe(true);
});

it('сохраняет стандартный выбор подложки при открытии из атласа', async () => {
  const fetch = vi.fn(async () => new Response('[]'));
  vi.stubGlobal('fetch', fetch);
  render(<CoordinatePicker mode="point" value={[13.4, 52.5]} onChange={vi.fn()} onClose={vi.fn()}/>);
  await waitFor(() => expect(mock.setStyle).toHaveBeenCalled());
  expect(fetch).toHaveBeenCalledOnce();
  expect(screen.getByRole('combobox')).toBeTruthy();
  expect(mock.setStyle.mock.calls[0][0].sources.overview.type).toBe('raster');
});
