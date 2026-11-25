// @vitest-environment happy-dom
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import type {StyleSpecification} from 'maplibre-gl';
import type {AtlasMeta} from '../../../services/cartography/src/atlas';
import {ReplayAreaMap} from '../src/modern/replay/ReplayAreaMap';
import {ReplayView} from '../src/modern/replay/ReplayView';
import {areaKey} from '../src/modern/atlas-place-name';

vi.mock('../src/modern/replay/archive', async importOriginal => ({
  ...await importOriginal<typeof import('../src/modern/replay/archive')>(),
  listSessions: async () => [],
}));

const map = vi.hoisted(() => ({
  setStyle: vi.fn<(style: StyleSpecification) => void>(),
  remove: vi.fn(),
}));
vi.mock('maplibre-gl', () => ({
  addProtocol: vi.fn(),
  Map: class {
    setStyle = map.setStyle;
    remove = map.remove;
    on() {}
    addControl() {}
    fitBounds() {}
    resize() {}
  },
  NavigationControl: class {},
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const berlin: AtlasMeta['bounds'] = [13.30, 52.45, 13.50, 52.60];
const paris: AtlasMeta['bounds'] = [2.25, 48.80, 2.42, 48.92];
function dataset(id: string, bounds: AtlasMeta['bounds']): AtlasMeta {
  return {id, name: id, kind: 'vector', format: 'pbf', minzoom: 0, maxzoom: 14,
    bounds, attribution: 'OpenMapTiles © OpenStreetMap', bytes: 12546,
    layers: [{id: 'water'}, {id: 'landcover'}, {id: 'place'}]};
}
function localService(datasets: AtlasMeta[], styleStatus = 200) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), location.origin).pathname;
    if (path === '/api/cartography/atlas') return Response.json(datasets);
    if (path === '/api/cartography/atlas/jobs') return Response.json([]);
    const item = datasets.find(d => path === `/api/cartography/atlas/${d.id}/style`);
    if (!item) return new Response(null, {status: 404});
    const style: StyleSpecification = {
      version: 8,
      sources: {atlas: {type: 'vector', tiles: [`/api/cartography/atlas/${item.id}/tiles/{z}/{x}/{y}.pbf`]}},
      layers: [{id: 'layer-0-fill', type: 'fill', source: 'atlas', 'source-layer': 'water'}],
    };
    return Response.json(style, {status: styleStatus});
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

it('личная карта рисует скачанную область по координатам, даже если у набора другое название', async () => {
  const fetch = localService([dataset('autre', paris), dataset('spree', berlin)]);
  render(<ReplayAreaMap name="Центр города" bounds={[13.34, 52.48, 13.45, 52.54]}/>);
  await waitFor(() => {
    const sources = Object.values(map.setStyle.mock.lastCall?.[0].sources ?? {});
    expect(sources.some(source => source.type === 'vector'
      && source.tiles?.includes('/api/cartography/atlas/spree/tiles/{z}/{x}/{y}.pbf'))).toBe(true);
    expect(sources.flatMap(source => 'tiles' in source ? source.tiles ?? [] : [])
      .some(url => /^https?:\/\//.test(url))).toBe(false);
    expect(map.setStyle.mock.lastCall?.[0].layers.some(layer =>
      'source-layer' in layer && layer['source-layer'] === 'water')).toBe(true);
  });
  expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain('/api/cartography/atlas/autre/style');
});

it('при переходе в область без покрытия убирает скачанную карту предыдущего района', async () => {
  localService([dataset('spree', berlin)]);
  const view = render(<ReplayAreaMap name="Берлин" bounds={berlin}/>);
  await waitFor(() => expect(map.setStyle.mock.calls.some(([style]) =>
    Object.values(style.sources).some(source => source.type === 'vector'))).toBe(true));
  view.rerender(<ReplayAreaMap name="Париж" bounds={paris}/>);
  await waitFor(() => expect(map.remove).toHaveBeenCalled());
  expect(await screen.findByText(/Natural Earth/)).toBeTruthy();
  expect(screen.getByText('Париж')).toBeTruthy();
});

it('при ошибке чтения локального стиля сохраняет обзор местности и сообщает об ошибке атласа', async () => {
  localService([dataset('spree', berlin)], 503);
  render(<ReplayAreaMap name="Берлин" bounds={berlin}/>);
  expect(await screen.findByText(/Атлас недоступен.*Natural Earth/)).toBeTruthy();
  expect(screen.getByRole('img', {name: /Обзорная карта области «Берлин»/})).toBeTruthy();
  expect(map.remove).toHaveBeenCalled();
});

it('на стартовом экране берёт текущую область из атласа и оставляет пример свёрнутым', async () => {
  localStorage.setItem('def_ops.modern.weather.region', JSON.stringify({bounds: paris, cols: 5, rows: 5}));
  localStorage.setItem('defops.atlas.regionNames', JSON.stringify({[areaKey(paris)]: 'Берега Сены'}));
  localService([dataset('seine', paris)]);
  render(<ReplayView/>);
  expect(screen.getByRole('heading', {name: 'Берега Сены'})).toBeTruthy();
  expect(await screen.findByText('Локальный атлас')).toBeTruthy();
  await waitFor(() => expect(map.setStyle.mock.calls.some(([style]) =>
    Object.values(style.sources).some(source => source.type === 'vector'
      && source.tiles?.includes('/api/cartography/atlas/seine/tiles/{z}/{x}/{y}.pbf')))).toBe(true));
  const example = screen.getByText('Начать пример').closest('details');
  expect(example?.open).toBe(false);
});
