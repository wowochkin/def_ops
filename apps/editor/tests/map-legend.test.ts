import { describe, expect, it } from 'vitest';
import type { Feature, MapDocument } from '@def-ops/core';
import { findLegendItem, LEGEND_ITEMS, legendFor, legendText, presentItems, withHidden } from '../src/map-legend';

const f = (id: string, layerId: string, kind: Feature['kind'], preset: string, side: 'own' | 'enemy' | 'neutral' = 'own', style: object = {}): Feature =>
  ({ id, layerId, kind, preset, side, style } as unknown as Feature);
const doc = (features: Feature[]): MapDocument => ({ layers: [], features, overlays: [] } as unknown as MapDocument);

describe('легенда по уровням', () => {
  it('на уровне показывает только нарисованное на нём', () => {
    const ids = (l: Parameters<typeof legendFor>[0]) => legendFor(l).map((x) => x.id);
    expect(ids('stavka')).toContain('front-start');
    expect(ids('stavka')).not.toContain('front-prev');
    expect(ids('stavka')).not.toContain('ghosts');
    expect(ids('stavka')).not.toContain('fortress');
    expect(ids('army')).not.toContain('defense');
    expect(ids('army')).not.toContain('ghosts');
    expect(ids('army')).toContain('bounds-army');
    expect(ids('division')).toEqual(expect.arrayContaining(['combat', 'crossings', 'front-prev', 'destroyed']));
    expect(ids('division')).not.toContain('blow');
    expect(ids('corps')).not.toContain('combat');
    expect(ids('corps')).toContain('corps');
    expect(ids('division')).not.toContain('corps');
    expect(legendFor('corps').length).toBeLessThanOrEqual(15);
    expect(legendFor('front', { command: true }).some((x) => x.id === 'rivers')).toBe(false);
  });
  it('в легенде — только то, что есть на карте в этот час', () => {
    const d = doc([
      { ...f('p', 'sim-pockets', 'area', 'atlas.encircled'), time: { from: '1945-04-20T00:00', to: null } } as Feature,
      f('s', 'lvl-st-moves', 'arrow', 'atlas.p2'),
    ]);
    const ids = (t: string) => presentItems(legendFor('stavka', { command: true }), 'stavka', d, t, new Set(['zones-own'])).map((x) => x.id);
    expect(ids('1945-04-18T17:00')).toEqual(['blow', 'zones-own']);
    expect(ids('1945-04-21T05:00')).toEqual(['blow', 'pockets', 'zones-own']);
  });
  it('элементы командования — только на экране командования', () => {
    expect(legendFor('front').some((x) => x.id === 'zones-own')).toBe(false);
    expect(legendFor('front', { command: true }).some((x) => x.id === 'zones-own')).toBe(true);
  });
  it('id элементов не повторяются, подпись есть на каждом уровне элемента', () => {
    expect(new Set(LEGEND_ITEMS.map((x) => x.id)).size).toBe(LEGEND_ITEMS.length);
    for (const it of LEGEND_ITEMS) for (const l of it.levels) expect(legendText(it, l)).not.toBe('');
  });
});

describe('скрыть элемент', () => {
  const feats = [
    f('a', 'lvl-st-moves', 'arrow', 'atlas.p2'),
    f('b', 'lvl-st-moves', 'arrow', 'atlas.german', 'enemy'),
    f('c', 'lvl-st-moves', 'arrow', 'atlas.p2', 'own', { tip: 'bar' }),
    f('d', 'lvl-st-moves', 'arrow', 'atlas.thin'),
    f('e', 'lvl-st-units', 'label', 'atlas.front'),
    f('g', 'lvl-st-units', 'label', 'atlas.enemyUnit', 'enemy'),
    f('h', 'lvl-st-units', 'symbol', 'atlas.town', 'neutral'),
    f('k', 'sim-front-start', 'line', 'atlas.frontGlow'),
    f('m', 'sim-own', 'symbol', 'std.unitOval', 'own', { cross: { mode: 'x' } }),
  ];
  const left = (hidden: string[], level: 'stavka' | 'division' = 'stavka') => withHidden(doc(feats), level, new Set(hidden)).features.map((x) => x.id);
  it('удары противника — отдельно от своих, остановленный удар — отдельно', () => {
    expect(left(['blow-enemy'])).toEqual(['a', 'c', 'd', 'e', 'g', 'h', 'k', 'm']);
    expect(left(['blow'])).toEqual(['b', 'c', 'd', 'e', 'g', 'h', 'k', 'm']);
    expect(left(['halted', 'retreat'])).toEqual(['a', 'b', 'e', 'g', 'h', 'k', 'm']);
  });
  it('войска стороны — без пунктов', () => {
    expect(left(['enemy'])).toEqual(['a', 'b', 'c', 'd', 'e', 'h', 'k', 'm']);
    expect(left(['own'])).toEqual(['a', 'b', 'c', 'd', 'g', 'h', 'k']);
    expect(left(['towns'])).not.toContain('h');
  });
  it('скрытый элемент чужого уровня на этом уровне не действует', () => {
    expect(left(['front-start'])).not.toContain('k');
    expect(left(['blow'], 'division')).toContain('a');
    expect(left(['destroyed'], 'division')).not.toContain('m');
  });
});

describe('найти элемент по названию', () => {
  it('по словам подписи', () => {
    const items = legendFor('stavka');
    expect(findLegendItem('отход', items, 'stavka')?.id).toBe('retreat');
    expect(findLegendItem('удары противника', items, 'stavka')?.id).toBe('blow-enemy');
    expect(findLegendItem('немецкие войска', items, 'stavka')?.id).toBe('enemy');
    expect(findLegendItem('населённые пункты', items, 'stavka')?.id).toBe('towns');
    expect(findLegendItem('что-то иное', items, 'stavka')).toBeNull();
  });
});
