// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { displayDemSource, loadDemSurface } from '../src/modern/atlas-dem-surface';

const path = '/api/cartography/atlas/berlin/tiles/{z}/{x}/{y}';
const source = {type: 'raster-dem', encoding: 'mapbox', tiles: [path]} as const;

afterEach(() => vi.unstubAllGlobals());

it('подготавливает для рельефа только локальные тайлы Terrain-RGB', () => {
 const original = {...source, tiles: [path]};
 expect(displayDemSource(original).tiles).toEqual(['atlas-dem://' + path]);
 expect(original.tiles).toEqual([path]);
 const terrarium = {...original, encoding: 'terrarium' as const};
 expect(displayDemSource(terrarium)).toBe(terrarium);
});

it('пропускает отсутствующий тайл без декодирования изображения', async () => {
 const fetchTile = vi.fn().mockResolvedValue(new Response(null, {status: 204}));
 vi.stubGlobal('fetch', fetchTile);
 const controller = new AbortController();
 const tile = await loadDemSurface({url: 'atlas-dem://' + path}, controller);
 expect(tile.data).toEqual(new ArrayBuffer(0));
 expect(fetchTile).toHaveBeenCalledWith(path, expect.objectContaining({signal: controller.signal}));
});
