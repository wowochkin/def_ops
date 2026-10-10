import { describe, expect, it } from 'vitest';
import type { LngLat } from '@def-ops/core';
import { Theatre, activeBoundaries, applyActions, checkTriggers, createState, effectiveBoundaries, groupOf, addHours, lineOf, withBoundaries, sectorAt, sectorLines, sectorMap, sectorText, sectorViolations, sideOf, step, type Boundary, type FormationDef, type Scenario, type SimContext, type TheatreData } from '../src';
import { loadProfile, loadRules } from '../src/data';

/** Открытая местность 80 × 60 км: два советских фронта (север и юг) наступают на запад, против них — немецкие корпуса. */
const C: LngLat = [14.0, 52.5];
const kmX = 111.32 * Math.cos((52.5 * Math.PI) / 180), kmY = 110.57;
const ll = (x: number, y: number): LngLat => [C[0] + x / kmX, C[1] + y / kmY];
const yOf = (p: LngLat) => (p[1] - C[1]) * kmY;

const theatre: TheatreData = {
  id: 'toy', name: 'учебная', cellKm: 1, defaultTerrain: 'open',
  bbox: [ll(-40, -30)[0], ll(-40, -30)[1], ll(40, 30)[0], ll(40, 30)[1]],
  terrain: [], roads: [], rivers: [], bridges: [], areas: [], lines: [],
};

const f = (id: string, side: string, parent: string | null, x: number, y: number, extra: Partial<FormationDef> = {}): FormationDef =>
  ({ id, name: id, side, echelon: parent ? 'army' : 'front', parent, ...(parent ? { type: side === 'su' ? 'rifle_army' : 'inf_corps', position: ll(x, y), personnel: 50000, tanks: 50, guns: 500, ammo: 3, fuel: 2, posture: 'defend' as const } : {}), ...extra });

/** Линия 1 БФ / 1 УФ с востока на запад по y = 0 (1 БФ — справа, т. е. к северу), до x = −10 (дальше «оборвана»). */
const line: Boundary = { id: 'b1', kind: 'front', side: 'su', right: 'bf', left: 'uf', title: '1 БФ / 1 УФ', from: '1945-04-15T00:00', until: '1945-04-20T00:00', line: [ll(30, 0), ll(-10, 0)], places: ['А', 'Б'], inclusive: 'bf' };

const scenario = (boundaries: Boundary[] = [line]): Scenario => ({
  id: 'toy', name: 'учебный', start: '1945-04-16T00:00', end: '1945-04-20T00:00', turnHours: 24, theatre: 'toy', rules: 'ww2-draft',
  sides: [{ id: 'su', name: 'СССР', profile: 'rkka-1945', controller: 'script' }, { id: 'de', name: 'Германия', profile: 'wehrmacht-1945', controller: 'script' }],
  formations: [
    f('bf', 'su', null, 0, 0), f('uf', 'su', null, 0, 0), f('hg', 'de', null, 0, 0),
    f('bf_a1', 'su', 'bf', 20, 12), f('bf_a2', 'su', 'bf', 20, 4),
    // армия 1 УФ стоит севернее линии — в полосе 1 БФ по директиве
    f('uf_a1', 'su', 'uf', 20, 2), f('uf_a2', 'su', 'uf', 20, -12),
    f('de_c1', 'de', 'hg', -5, 8), f('de_c2', 'de', 'hg', -5, -8),
    // соединение без объединения — к единственной группе армий стороны
    { id: 'de_div', name: 'де', side: 'de', echelon: 'division', type: 'inf_corps', position: ll(-8, 0), personnel: 8000, tanks: 0, guns: 50 },
  ],
  orders: [], boundaries,
});
const units = (sc: Scenario) => sc.formations.filter((x) => x.position).map((x) => ({ id: x.id, side: x.side, at: x.position! }));

describe('полосы фронтов и разграничительные линии', () => {
  const T = new Theatre(theatre);

  it('сторона линии: справа, слева, за концами', () => {
    const l = [T.proj.toXY(ll(30, 0)), T.proj.toXY(ll(-10, 0))];
    expect(sideOf(l, T.proj.toXY(ll(0, 5)))).toBe(1); // идём на запад — север справа
    expect(sideOf(l, T.proj.toXY(ll(0, -5)))).toBe(-1);
    expect(sideOf(l, T.proj.toXY(ll(-30, 3)))).toBe(0); // западнее конца линии
  });

  it('объединения: фронт для армий, соединение без подчинения — к единственной группе армий', () => {
    const g = groupOf(scenario());
    expect(g.get('bf_a1')).toBe('bf');
    expect(g.get('uf_a2')).toBe('uf');
    expect(g.get('de_div')).toBe('hg');
  });

  it('директива делит полосы по линии; за её концом — по ближайшим войскам', () => {
    const sc = scenario();
    const m = sectorMap(T, sc, units(sc), 'su', '1945-04-16T00:00');
    expect(m.groups).toEqual(['bf', 'uf']);
    // у армии 1 УФ, стоящей севернее линии, полоса по директиве — 1 БФ
    expect(sectorAt(T, m, ll(20, 2))).toEqual({ group: 'bf', historical: true });
    expect(sectorAt(T, m, ll(10, -6))?.group).toBe('uf');
    // без директивы та же клетка — 1 УФ (ближайшие войска)
    const m0 = sectorMap(T, scenario([]), units(sc), 'su', '1945-04-16T00:00');
    expect(sectorAt(T, m0, ll(20, 2))).toEqual({ group: 'uf', historical: false });
    // западнее конца линии — расчётно
    expect(sectorAt(T, m, ll(-25, 1))?.historical).toBe(false);
  });

  it('сроки действия линии', () => {
    expect(activeBoundaries(scenario(), '1945-04-16T00:00').map((b) => b.id)).toEqual(['b1']);
    expect(activeBoundaries(scenario(), '1945-04-21T00:00')).toEqual([]);
    expect(activeBoundaries(scenario(), '1945-04-16T00:00', 'de')).toEqual([]);
  });

  it('линия на карте — по директиве; выходы в полосу соседа', () => {
    const sc = scenario();
    const m = sectorMap(T, sc, units(sc), 'su', '1945-04-16T00:00');
    const ls = sectorLines(T, m, { depthKm: 60 });
    const hist = ls.find((l) => l.historical >= 0.5)!;
    expect(hist.pair).toEqual(['bf', 'uf']);
    // по самой линии директивы (y = 0)
    expect(hist.points.every((p) => Math.abs(yOf(p)) < 0.5)).toBe(true);
    const v = sectorViolations(T, sc, units(sc), '1945-04-16T00:00');
    expect(v).toEqual([{ formation: 'uf_a1', group: 'uf', in: 'bf', time: '1945-04-16T00:00', boundary: 'b1' }]);
    const txt = sectorText(T, sc, units(sc), 'su', '1945-04-16T00:00');
    expect(txt[0]).toMatch(/bf \/ uf — по директиве.*А — Б.*включительно — для bf/);
    expect(txt.some((x) => /В полосе соседа: uf_a1 \(в полосе bf\)/.test(x))).toBe(true);
    expect(sectorText(T, sc, units(sc), 'de', '1945-04-16T00:00')[0]).toMatch(/одним объединением/);
  });

  it('выбор пути: армия идёт к цели своей полосой, а не через полосу соседа', () => {
    // армия 1 УФ южнее линии идёт на запад к точке у линии с юга; прямой путь не пересекает линию — и не должен
    const sc = scenario();
    sc.formations = sc.formations.filter((x) => !x.id.startsWith('de'));
    const target = ll(-5, -2);
    sc.orders = [{ id: 'o', formation: 'uf_a1', task: 'regroup', target, issuedAt: '1945-04-15T00:00', source: 'script' }];
    // армия стоит севернее линии (y = 2) — в полосе 1 БФ: выходит к себе в полосу кратчайшим путём, дальше идёт к югу от линии
    const ctx = (rules: SimContext['rules']): SimContext => ({ scenario: sc, theatre: T, profiles: { 'rkka-1945': loadProfile('rkka-1945'), 'wehrmacht-1945': loadProfile('wehrmacht-1945') }, rules });
    const run = (k: number) => {
      const c = ctx({ ...loadRules('ww2-draft'), routeVariety: 0, sectors: { foreign: k } });
      const s = step(createState(c, 1), c);
      const mv = s.journal.find((j) => j.kind === 'move' && j.formation === 'uf_a1');
      return mv && mv.kind === 'move' ? (mv.path ?? [mv.from, mv.to]) : [];
    };
    const north = (path: LngLat[]) => path.filter((p) => yOf(p) > 0.6).length / Math.max(1, path.length);
    expect(north(run(3))).toBeLessThan(north(run(0)));
  });
});

describe('директивы в игре', () => {
  const T = new Theatre(theatre);
  const ctxOf = (sc: Scenario): SimContext => ({ scenario: sc, theatre: T, profiles: { 'rkka-1945': loadProfile('rkka-1945'), 'wehrmacht-1945': loadProfile('wehrmacht-1945') }, rules: loadRules('ww2-draft') });
  // вторая линия пары — с условием: войска 1 УФ в 5 км от точки (−5, −8)
  const later: Boundary = { ...line, id: 'b2', title: '1 БФ / 1 УФ (вторая)', from: '1945-04-17T00:00', until: null, line: [ll(30, 0), ll(-30, 0)], trigger: { group: 'uf', at: ll(15, -10), radiusKm: 5, text: 'армия 1 УФ у точки' }, delayHours: 6 };
  const first: Boundary = { ...line, until: '1945-04-17T00:00' };

  it('по расписанию (переигровка) — сроки сценария; в игре — только вступившие, прежняя действует до новой', () => {
    const sc = scenario([first, later]);
    expect(effectiveBoundaries(sc).map((b) => [b.id, b.from, b.until])).toEqual([['b1', first.from, '1945-04-17T00:00'], ['b2', later.from, null]]);
    const game = { directives: { conditional: true, activated: {} as Record<string, string> } };
    expect(effectiveBoundaries(sc, game).map((b) => [b.id, b.until])).toEqual([['b1', null]]);
    game.directives.activated.b2 = '1945-04-18T06:00';
    expect(effectiveBoundaries(sc, game).map((b) => [b.id, b.from, b.until])).toEqual([['b1', first.from, '1945-04-18T06:00'], ['b2', '1945-04-18T06:00', null]]);
  });

  it('условие вступления: войска объединения в радиусе — через delayHours', () => {
    const sc = scenario([first, later]);
    const s0 = { ...createState(ctxOf(sc)), directives: { conditional: true, activated: {} } };
    expect(checkTriggers(T, sc, s0, '1945-04-16T00:00', addHours)).toEqual({});
    const s1 = { ...s0, formations: s0.formations.map((f) => (f.id === 'uf_a2' ? { ...f, position: ll(14, -9) } : f)) };
    expect(checkTriggers(T, sc, s1, '1945-04-16T00:00', addHours)).toEqual({ b2: '1945-04-16T06:00' });
  });

  it('линия армий (игрок) и директива (Ставка): кто справа — по войскам, срок — задержка доведения', () => {
    const sc = scenario([line]);
    sc.formations = sc.formations.map((f) => (f.id === 'uf_a1' ? { ...f, position: ll(20, -2) } : f));
    const ctx = ctxOf(sc), s = createState(ctx);
    // линия армий 1 БФ (bf_a1 севернее, bf_a2 южнее) с востока на запад по y = 8
    const act = { kind: 'boundary' as const, side: 'su', a: 'bf_a2', b: 'bf_a1', line: [ll(30, 8), ll(-10, 8)], issuedAt: s.time };
    const b = lineOf(ctx, s, act);
    expect(typeof b).not.toBe('string');
    if (typeof b === 'string') return;
    expect([b.right, b.left, b.kind, b.issuedBy]).toEqual(['bf_a1', 'bf_a2', 'army', 'player']);
    expect(b.from > s.time).toBe(true);
    expect(lineOf(ctx, s, { ...act, b: 'uf_a1' })).toMatch(/разных фронтов/);
    const r = applyActions(ctx, s, [act, { kind: 'directive', side: 'su', a: 'bf', b: 'uf', line: [ll(30, -1), ll(-20, -1)], delayHours: 4, issuedAt: s.time }]);
    expect(r.results.every((x) => x.ok)).toBe(true);
    expect(r.state.boundaries!.map((x) => [x.kind, x.issuedBy])).toEqual([['army', 'player'], ['front', 'stavka']]);
    // директива Ставки той же пары — сменяет линию сценария со своего срока
    const eff = withBoundaries(sc, r.state).boundaries!.filter((x) => x.kind === 'front' && x.side === 'su');
    expect(eff.map((x) => [x.issuedBy ?? 'scenario', x.until])).toEqual([['scenario', '1945-04-16T04:00'], ['stavka', null]]);
    expect(activeBoundaries(withBoundaries(sc, r.state), '1945-04-17T00:00').map((x) => x.issuedBy).sort()).toEqual(['player', 'stavka']);
  });
});
