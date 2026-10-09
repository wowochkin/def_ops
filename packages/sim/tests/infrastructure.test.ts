import { describe, expect, it } from 'vitest';
import { loadTheatre } from '../src/data';
import { applyInfrastructure, infraEffect, locatePlace, resolveInfra, type InfraRecord } from '../src/infrastructure';
import { applyOverlay, compareRoads, decodeMask, legendFromSamples, maskRle, OverlayAccumulator, overlayGrid, tilesFor, tileXY } from '../src/overlay';
import { decodeGrid, Theatre } from '../src/theatre';
import { loadProfile, loadRules, loadScenario, loadHistory } from '../src/data';
import { contextFrom } from '../src/source';

describe('сведения об инфраструктуре операции', () => {
  const data = loadTheatre('oder-berlin-1945');
  const T = new Theatre(data);

  it('пункт находится по-русски и в оригинале, с падежом', () => {
    const a = locatePlace(T, 'Зелов (Seelow)');
    expect(a?.id).toBe('Seelow');
    expect(locatePlace(T, 'Seelow')?.id).toBe('Seelow');
    expect(locatePlace(T, 'Нигдебург')).toBeNull();
    expect(locatePlace(T, 'Фюрстенвальде')?.id).toBe('Fuerstenwalde');
    expect(locatePlace(T, 'Fürstenwalde')?.id).toBe('Fuerstenwalde');
    expect(locatePlace(T, 'Франкфурта')?.id).toBe('Frankfurt');
  });

  it('разрушенный мост привязывается к мосту театра и не действует с даты', () => {
    const br = data.bridges.find((b) => (b as { river?: string }).river === 'Spree' && !b.destroyedAt)!;
    const near = T.data.areas.map((a) => ({ a, d: Math.hypot(T.area(a.id)!.center[0] - br.at[0], T.area(a.id)!.center[1] - br.at[1]) })).sort((x, y) => x.d - y.d)[0].a;
    const rec: InfraRecord = { id: 'x1', kind: 'bridge', state: 'destroyed', title: 'мост через Шпрее', place: near.name, river: 'Шпрее', from: '1945-04-22', origin: 'user' };
    const r = resolveInfra(T, rec);
    expect(r?.bridge).toBeTruthy();
    const applied = applyInfrastructure(data, [{ ...rec, ...r }]);
    expect(applied.bridges.find((b) => b.id === r!.bridge)!.destroyedAt).toBe('1945-04-22T00:00');
    expect(data.bridges.find((b) => b.id === r!.bridge)!.destroyedAt ?? null).not.toBe('1945-04-22T00:00'); // исходный не тронут
    expect(infraEffect({ ...rec, ...r })).toMatch(/не действует с 22\.04/);
  });

  it('наведённая переправа — новый мост с даты; перекрытая дорога — без дорожного темпа в сроки', () => {
    const at = T.area('Seelow')!.center;
    const out = applyInfrastructure(data, [
      { id: 'f', kind: 'crossing', state: 'built', title: 'понтонная переправа', at, from: '1945-04-18', origin: 'user' },
      { id: 'r', kind: 'road', state: 'blocked', title: 'завал', at, radiusKm: 2, from: '1945-04-17', until: '1945-04-19', origin: 'user' },
    ]);
    expect(out.bridges.find((b) => b.id === 'infra-f')?.openFrom).toBe('1945-04-18T00:00');
    const T2 = new Theatre(out);
    const i = T2.indexOf(at);
    const p = loadProfile('rkka-1945');
    const roadCell = [...Array(T2.cols * T2.rows).keys()].find((k) => T2.road[k] && T2.roadBlocked(k, '1945-04-18T00:00'));
    expect(roadCell).toBeDefined();
    expect(T2.speedKmh(roadCell!, 'motor', p, 1, '1945-04-18T00:00')).toBeLessThan(T2.speedKmh(roadCell!, 'motor', p, 1, '1945-04-20T00:00'));
    expect(T2.roadBlocked(i, '1945-04-16T00:00')).toBe(false);
    expect(loadRules('ww2-draft')).toBeTruthy();
  });
});

it('сведения операции ложатся на театр при загрузке контекста; их нет — театр как есть', async () => {
  const at = new Theatre(loadTheatre('oder-berlin-1945')).area('Seelow')!.center;
  const rec: InfraRecord = { id: 'r', kind: 'road', state: 'mined', title: 'шоссе', at, radiusKm: 2, from: '1945-04-16', origin: 'user' };
  const get = (withInfra: boolean) => (kind: string, file: string) => {
    const id = file.replace(/\.json$/, '');
    if (kind === 'infrastructure') { if (!withInfra) throw new Error('нет'); return { id, records: [rec] }; }
    if (kind === 'scenarios') return id.endsWith('.history') ? loadHistory(id.replace('.history', '')) : loadScenario(id);
    if (kind === 'theatres') return loadTheatre(id);
    if (kind === 'profiles') return loadProfile(id);
    return loadRules(id);
  };
  const a = await contextFrom(get(true), 'berlin-1945-tasks');
  const b = await contextFrom(get(false), 'berlin-1945-tasks');
  expect(a.ctx.theatre.data.obstacles?.length).toBe(1);
  expect(b.ctx.theatre.data.obstacles ?? []).toHaveLength(0);
});

describe('исторический слой по карте', () => {
  it('легенда по образцам и маски: красные линии — дороги, синее — вода; поправка — растр дорог, современные дороги убраны', () => {
    const data = loadTheatre('oder-berlin-1945');
    const area: [number, number, number, number] = [14.0, 52.4, 14.3, 52.6];
    const grid = overlayGrid(data, area);
    const legend = legendFromSamples({ road: [[200, 40, 30]], water: [[60, 110, 220]] });
    const acc = new OverlayAccumulator(legend, grid);
    const z = 11;
    // синтетическая карта: каждая 6-я строка пикселей — красная (дороги), левая треть тайлов — синяя (вода), остальное — бумага
    const x0 = Math.floor(tileXY.lon2x(area[0], z));
    for (const t of tilesFor(grid.bbox, z)) {
      const px = new Uint8ClampedArray(256 * 256 * 4);
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const o = (y * 256 + x) * 4;
        const c = t.x === x0 ? [60, 110, 220] : y % 6 === 0 ? [200, 40, 30] : [240, 230, 205];
        px.set([...c, 255], o);
      }
      acc.addTile(px, 256, t.x, t.y, z);
    }
    const ov = acc.result({ source: 'тест', zoom: z });
    expect(ov.stats.road).toBeGreaterThan(10);
    expect(ov.stats.water).toBeGreaterThan(0);
    expect(decodeMask(maskRle(new Uint8Array([1, 1, 0, 1])), 4)).toEqual(new Uint8Array([1, 1, 0, 1]));
    const cmp = compareRoads(data, ov, { road: 'road' });
    expect(cmp.stats.map).toBe(ov.stats.road);
    expect(cmp.stats.both + cmp.stats.mapOnly).toBe(cmp.stats.map);
    expect(cmp.stats.both + cmp.stats.theatreOnly).toBe(cmp.stats.theatre);
    expect(cmp.stats.theatre).toBeGreaterThan(0);
    const { theatre, changes } = applyOverlay(data, ov, { road: 'road', water: 'water', replaceModernRoads: 'road' });
    expect(theatre.roadGrid?.rle).toMatch(/r/);
    expect(changes['клеток с дорогой карты']).toBeGreaterThan(10);
    expect(decodeGrid(theatre.terrainGrid!).length).toBe(theatre.terrainGrid!.cols * theatre.terrainGrid!.rows);
    expect(() => new Theatre(theatre)).not.toThrow();
  });
});
