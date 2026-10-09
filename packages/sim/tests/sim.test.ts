import { describe, expect, it } from 'vitest';
import type { LngLat } from '@def-ops/core';
import { Theatre, decodeGrid, encodeGrid, createState, step, issueOrder, frontLine, power, interp, createRng, type Scenario, type SimContext, type TheatreData, type FormationDef, type Order } from '../src';
import { loadProfile, loadRules } from '../src/data';

/**
 * Учебная местность 60 × 40 км: с севера на юг большая река (x ≈ 20 км) с одним
 * мостом посередине, лес на западе, шоссе с запада на восток через мост.
 */
const C: LngLat = [14.0, 52.5];
const kmX = 111.32 * Math.cos((52.5 * Math.PI) / 180), kmY = 110.57;
const ll = (x: number, y: number): LngLat => [C[0] + x / kmX, C[1] + y / kmY];

const theatreData: TheatreData = {
  id: 'toy', name: 'учебная', cellKm: 1, defaultTerrain: 'open',
  bbox: [ll(-30, -20)[0], ll(-30, -20)[1], ll(30, 20)[0], ll(30, 20)[1]],
  terrain: [{ class: 'forest', ring: [ll(-28, -18), ll(-12, -18), ll(-12, 18), ll(-28, 18)] }],
  roads: [{ kind: 'highway', line: [ll(-29, 0), ll(29, 0)] }],
  rivers: [{ name: 'Река', major: true, line: [ll(20, -20), ll(20, 20)] }],
  bridges: [{ id: 'b1', at: ll(20, 0), name: 'мост', destroyedAt: '1945-04-17T00:00' }],
  areas: [{ id: 'east', name: 'Восточный район', ring: [ll(24, -6), ll(30, -6), ll(30, 6), ll(24, 6)] }],
  lines: [{ id: 'pos2', name: 'вторая позиция', line: [ll(5, -20), ll(5, 20)], fortification: 2 }],
};

const ctxWith = (formations: FormationDef[], orders: Order[] = [], turnHours = 24): SimContext => {
  const scenario: Scenario = {
    id: 'toy', name: 'учебный', start: '1945-04-16T00:00', end: '1945-04-26T00:00', turnHours, theatre: 'toy', rules: 'ww2-draft',
    sides: [{ id: 'su', name: 'СССР', profile: 'rkka-1945', controller: 'human' }, { id: 'de', name: 'Германия', profile: 'wehrmacht-1945', controller: 'llm' }],
    formations, orders,
  };
  return { scenario, theatre: new Theatre(theatreData), profiles: { 'rkka-1945': loadProfile('rkka-1945'), 'wehrmacht-1945': loadProfile('wehrmacht-1945') }, rules: loadRules('ww2-draft') };
};

const su = (id: string, x: number, y: number, extra: Partial<FormationDef> = {}): FormationDef =>
  ({ id, name: id, side: 'su', echelon: 'army', type: 'rifle_army', position: ll(x, y), personnel: 80000, tanks: 150, guns: 2500, ammo: 3, fuel: 2, posture: 'defend', ...extra });
const de = (id: string, x: number, y: number, extra: Partial<FormationDef> = {}): FormationDef =>
  ({ id, name: id, side: 'de', echelon: 'corps', type: 'inf_corps', position: ll(x, y), personnel: 30000, tanks: 60, guns: 300, ammo: 2, fuel: 1, posture: 'defend', ...extra });
const order = (formation: string, task: Order['task'], target: Order['target'], issuedAt = '1945-04-15T00:00'): Order => ({ id: `${formation}-${task}`, formation, task, target, issuedAt, source: 'script' });
const xOf = (p: LngLat) => (p[0] - C[0]) * kmX;

describe('местность и маршрут', () => {
  it('классы местности, укрепления, районы', () => {
    const t = new Theatre(theatreData);
    expect(t.terrainAt(ll(-20, 5))).toBe('forest');
    expect(t.terrainAt(ll(0, 5))).toBe('open');
    expect(t.fortificationAt(ll(5, 10))).toBe(2);
    expect(t.area('east')!.name).toBe('Восточный район');
    expect(t.areaAt(ll(27, 0))).toBe('east');
  });

  it('техника переходит большую реку только по мосту; после разрушения моста — нет пути', () => {
    const ctx = ctxWith([]);
    const p = ctx.profiles['rkka-1945'];
    const r = ctx.theatre.route(ll(10, 15), ll(28, 15), 'tracked', p, ctx.rules, '1945-04-16T00:00')!;
    expect(r).not.toBeNull();
    // путь проходит через мост (y ≈ 0)
    expect(r.path.some((q) => Math.abs((q[1] - C[1]) * kmY) < 1.5 && Math.abs(xOf(q) - 20) < 1.5)).toBe(true);
    expect(ctx.theatre.route(ll(10, 15), ll(28, 15), 'tracked', p, ctx.rules, '1945-04-18T00:00')).toBeNull();
    // пехота переправляется где угодно, но с задержкой
    const foot = ctx.theatre.route(ll(10, 15), ll(28, 15), 'foot', p, ctx.rules, '1945-04-18T00:00')!;
    expect(foot.hours).toBeGreaterThan(ctx.rules.riverCrossHours);
  });

  it('продвижение и отход — путём войск: через реку — по мосту, а не напрямик', () => {
    const ctx = ctxWith([]);
    const T = ctx.theatre;
    const w = T.walk(ll(12, -10), ll(28, -10), 40, 'motor', ctx.profiles['rkka-1945'], ctx.rules, '1945-04-16T00:00')!;
    expect(w).toBeTruthy();
    const bridge = T.proj.toXY(ll(20, 0));
    const xy = w.trail.map((p) => T.proj.toXY(p));
    const segDist = (a: number[], b: number[]) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, k = Math.max(0, Math.min(1, ((bridge[0] - a[0]) * dx + (bridge[1] - a[1]) * dy) / L)); return Math.hypot(a[0] + dx * k - bridge[0], a[1] + dy * k - bridge[1]); };
    expect(Math.min(...xy.slice(1).map((b, i) => segDist(xy[i], b)))).toBeLessThan(1.5); // путь проходит через мост
    expect(w.km).toBeGreaterThan(16); // длиннее прямой (16 км): крюк к мосту
  });

  it('разброс путей: при routeVariety разные seed — разные пути, один seed — тот же путь', () => {
    const run = (seed: number, v: number) => {
      const ctx = ctxWith([su('a1', -28, -15, { posture: 'march' })], [order('a1', 'regroup', 'east')]);
      ctx.rules = { ...ctx.rules, routeVariety: v };
      let st = createState(ctx, seed);
      for (let k = 0; k < 3; k++) st = step(st, ctx);
      return JSON.stringify(st.formations[0].position);
    };
    const many = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((sd) => run(sd, 0.4)));
    expect(many.size).toBeGreaterThan(1);
    expect(run(3, 0.4)).toBe(run(3, 0.4));
    expect(new Set([1, 2, 3, 4].map((sd) => run(sd, 0))).size).toBe(1);
  });

  it('по шоссе быстрее, чем лесом', () => {
    const ctx = ctxWith([]);
    const p = ctx.profiles['rkka-1945'];
    const road = ctx.theatre.route(ll(-28, 0), ll(-12, 0), 'motor', p, ctx.rules, '1945-04-16T00:00')!;
    const forest = ctx.theatre.route(ll(-28, 10), ll(-12, 10), 'motor', p, ctx.rules, '1945-04-16T00:00')!;
    expect(forest.hours).toBeGreaterThan(road.hours * 2);
  });
});

describe('растр местности', () => {
  it('RLE туда и обратно', () => {
    const cells = [0, 0, 0, 1, 1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 5];
    const rle = encodeGrid(cells);
    expect(rle).toBe('3o2fm12uw');
    expect([...decodeGrid({ bbox: [0, 0, 1, 1], cols: cells.length, rows: 1, rle })]).toEqual(cells);
    expect(() => decodeGrid({ bbox: [0, 0, 1, 1], cols: 5, rows: 1, rle: '4o' })).toThrow();
  });

  it('растр ложится под контуры: восточная половина — болото, лес-контур поверх', () => {
    const [w, s, e, n] = theatreData.bbox;
    const g = { bbox: [w, s, e, n] as [number, number, number, number], cols: 2, rows: 1, rle: 'om' };
    const t = new Theatre({ ...theatreData, terrainGrid: g });
    expect(t.terrainAt(ll(10, 5))).toBe('marsh');
    expect(t.terrainAt(ll(-5, 5))).toBe('open');
    expect(t.terrainAt(ll(-20, 5))).toBe('forest');
  });
});

describe('ход', () => {
  it('марш: формирование идёт к цели не быстрее нормы и не входит в соприкосновение без приказа на наступление', () => {
    const ctx = ctxWith([su('a1', -10, 0), de('k1', 10, 0)], [order('a1', 'regroup', ll(15, 0))]);
    const s1 = step(createState(ctx), ctx);
    const a = s1.formations.find((f) => f.id === 'a1')!;
    expect(xOf(a.position)).toBeGreaterThan(-10);
    // остановился на расстоянии соприкосновения от противника
    expect(10 - xOf(a.position)).toBeGreaterThanOrEqual(ctx.rules.contactKm - 0.5);
    expect(s1.journal.some((j) => j.kind === 'move' && j.formation === 'a1')).toBe(true);
  });

  it('задержка доведения приказа: армии — через 6 ч, корпусу вермахта — через 6 ч', () => {
    const ctx = ctxWith([su('a1', -10, 0), de('k1', 25, 10)], [], 3);
    let s = createState(ctx);
    s = issueOrder(s, order('a1', 'regroup', ll(-5, 0), '1945-04-16T00:00'));
    s = step(s, ctx); // 00–03: ещё не дошёл
    expect(s.formations.find((f) => f.id === 'a1')!.order).toBeNull();
    s = step(s, ctx); // 03–06: дошёл
    expect(s.formations.find((f) => f.id === 'a1')!.order?.task).toBe('regroup');
  });

  it('бой: наступление 3:1 даёт продвижение и потери; журнал объясняет исход', () => {
    const ctx = ctxWith([su('a1', 0, 0), su('a2', 0, 2), de('k1', 4, 1, { posture: 'attack' })], [order('a1', 'attack', 'east'), order('a2', 'attack', 'east'), order('k1', 'defend', null)]);
    const s1 = step(createState(ctx, 7), ctx);
    const combat = s1.journal.find((j) => j.kind === 'combat');
    expect(combat).toBeTruthy();
    if (combat?.kind !== 'combat') throw new Error();
    expect(combat.ratio).toBeGreaterThan(2);
    expect(combat.advanceKm).toBeGreaterThan(0);
    expect(combat.factors.map((f) => f.name)).toContain('укрепления');
    const k = s1.formations.find((f) => f.id === 'k1')!;
    expect(k.personnel).toBeLessThan(30000);
    expect(xOf(k.position)).toBeGreaterThan(4); // оттеснён на восток
  });

  it('подготовленная оборона и укрепления снижают соотношение сил', () => {
    const atk = [su('a1', 1, 0)];
    const fresh = ctxWith([...atk, de('k1', 5, 0, { posture: 'attack' })], [order('a1', 'attack', 'east'), order('k1', 'defend', null)]);
    const dug = ctxWith([...atk, de('k1', 5, 0)], [order('a1', 'attack', 'east')]); // в обороне на позиции (вторая позиция, укрепления 2)
    const r = (ctx: SimContext) => { const j = step(createState(ctx, 3), ctx).journal.find((x) => x.kind === 'combat'); return j?.kind === 'combat' ? j.ratio / j.noise : NaN; };
    expect(r(dug)).toBeLessThan(r(fresh));
  });

  it('превышение: оборона на высоте сильнее; без правила высоты не учитываются', () => {
    const data = (hDef: number): TheatreData => ({ ...theatreData, lines: [], heightGrid: { bbox: theatreData.bbox, cols: 2, rows: 1, stepM: 1, base: 0, rle: `0,${hDef}` } });
    const run = (hDef: number, rule: boolean) => {
      const ctx = ctxWith([su('a1', -3, 0), de('k1', 2, 0, { posture: 'attack' })], [order('a1', 'attack', 'east'), order('k1', 'defend', null)]);
      ctx.theatre = new Theatre(data(hDef));
      if (rule) ctx.rules = { ...ctx.rules, heightAdvantage: { perM: 50, bonus: 0.1, max: 0.3 } };
      const j = step(createState(ctx, 3), ctx).journal.find((x) => x.kind === 'combat');
      if (j?.kind !== 'combat') throw new Error('нет боя');
      return { r: j.ratio / j.noise, f: j.factors.map((x) => x.name) };
    };
    expect(run(100, true).r).toBeLessThan(run(0, true).r);
    expect(run(100, true).f.some((n) => n.startsWith('превышение'))).toBe(true);
    expect(run(100, false).r).toBeCloseTo(run(0, false).r, 6);
  });

  it('детерминирован при одном seed и различается при разных', () => {
    const ctx = ctxWith([su('a1', 0, 0), de('k1', 4, 0)], [order('a1', 'attack', 'east')]);
    const run = (seed: number) => { let s = createState(ctx, seed); for (let i = 0; i < 3; i++) s = step(s, ctx); return JSON.stringify(s.formations); };
    expect(run(1)).toBe(run(1));
    expect(run(1)).not.toBe(run(2));
  });

  it('«удерживать любой ценой»: не отходит, несёт потери и теряет боеспособность', () => {
    const ctx = ctxWith([su('a1', 0, 0, { personnel: 120000, tanks: 300, guns: 3000 }), de('k1', 4, 0, { personnel: 20000, tanks: 0, guns: 100, type: 'volkssturm' })],
      [order('a1', 'attack', ll(4, 0)), order('k1', 'hold', null)]);
    const s1 = step(createState(ctx, 5), ctx);
    expect(xOf(s1.formations.find((f) => f.id === 'k1')!.position)).toBeCloseTo(4, 3);
    let s = s1;
    for (let i = 0; i < 9; i++) s = step(s, ctx);
    expect(s.journal.some((j) => j.kind === 'destroyed' && j.formation === 'k1')).toBe(true);
  });

  it('снабжение: горючее расходуется на марше, при нуле — запись в журнале', () => {
    const ctx = ctxWith([su('t1', -25, 0, { type: 'tank_army', fuel: 0.5 })], [order('t1', 'regroup', ll(10, 0))]);
    let s = createState(ctx);
    for (let i = 0; i < 3; i++) s = step(s, ctx);
    expect(s.formations[0].fuel).toBe(0);
    expect(s.journal.some((j) => j.kind === 'supply' && j.what === 'fuel')).toBe(true);
  });
});

describe('линия фронта и арбитр', () => {
  it('линия фронта проходит между сторонами', () => {
    const ctx = ctxWith([su('a1', -10, -10), su('a2', -10, 10), de('k1', 10, -10), de('k2', 10, 10)]);
    const s = createState(ctx);
    const lines = frontLine(ctx.theatre, s.formations, ['su', 'de'], (f) => power(f, ctx.profiles[f.side === 'su' ? 'rkka-1945' : 'wehrmacht-1945'], ctx.rules).total);
    expect(lines.length).toBeGreaterThan(0);
    // на участке между группировками линия лежит между сторонами (на флангах загибается вокруг слабого)
    const mid = lines.flat().filter((q) => Math.abs((q[1] - C[1]) * kmY) <= 10).map(xOf);
    expect(mid.length).toBeGreaterThan(3);
    expect(Math.min(...mid)).toBeGreaterThan(-10);
    expect(Math.max(...mid)).toBeLessThan(10);
  });

  it('таблицы: интерполяция по соотношению сил, генератор — равномерный', () => {
    const t: [number, number][] = [[1, 0], [4, 10]];
    expect(interp(t, 2)).toBeCloseTo(5, 5); // логарифмическая шкала: 2 — середина между 1 и 4
    const r = createRng(42);
    const xs = Array.from({ length: 2000 }, () => r.next());
    expect(Math.abs(xs.reduce((a, b) => a + b) / xs.length - 0.5)).toBeLessThan(0.03);
  });
});

describe('цели, снабжение, окружение', () => {
  const withSupply = (ctx: SimContext, su: (LngLat | string)[], de: (LngLat | string)[]): SimContext => ({ ...ctx, scenario: { ...ctx.scenario, supply: { su: { sources: su }, de: { sources: de } } } });

  it('цель — формирование противника: идёт к нему и входит в соприкосновение', () => {
    const ctx = ctxWith([su('a1', -25, 10), de('k1', 0, 10)], [order('a1', 'attack', { formation: 'k1' })]);
    const a = step(step(createState(ctx), ctx), ctx).formations.find((f) => f.id === 'a1')!;
    expect(xOf(a.position)).toBeGreaterThan(-25);
    expect(-xOf(a.position)).toBeLessThanOrEqual(ctx.rules.contactKm);
  });

  it('кольцо зон влияния противника отрезает от снабжения; есть коридор — не отрезано', () => {
    const ring = [su('n', 0, 7), su('s', 0, -7), su('w', -7, 0)];
    const closed = withSupply(ctxWith([...ring, su('e', 7, 0), de('k1', 0, 0)]), [ll(-28, 0)], [ll(28, 0)]);
    const open = withSupply(ctxWith([...ring, de('k1', 0, 0)]), [ll(-28, 0)], [ll(28, 0)]);
    // окружение — после двух ходов подряд без подвоза
    const cut = (ctx: SimContext) => step(step(createState(ctx), ctx), ctx).journal.some((j) => j.kind === 'encircled' && j.formation === 'k1' && j.cut);
    expect(cut(closed)).toBe(true);
    expect(cut(open)).toBe(false);
  });

  it('отрезанные не пополняются, снабжаемые — пополняются', () => {
    const ctx = withSupply(ctxWith([su('a1', -20, 15, { ammo: 1 }), de('k1', 20, -15, { ammo: 0.5 })]), [ll(-28, 15)], [ll(28, -15)]);
    const s1 = step(createState(ctx), ctx);
    expect(s1.formations.find((f) => f.id === 'a1')!.ammo).toBeGreaterThan(1 - 0.3);
  });

  it('обороняющийся отходит к своим тылам, а не просто прочь от наступающих', () => {
    const ctx = withSupply(ctxWith([su('a1', 0, 4, { personnel: 200000, tanks: 600, guns: 5000 }), de('k1', 0, 0, { posture: 'attack', personnel: 15000, tanks: 10, guns: 50 })],
      [order('a1', 'attack', ll(0, -20)), order('k1', 'withdraw', null)]), [ll(-28, 15)], [ll(28, 0)]);
    const s1 = step(createState(ctx, 3), ctx);
    const k = s1.formations.find((f) => f.id === 'k1')!;
    const c = s1.journal.find((j) => j.kind === 'combat');
    if (c?.kind === 'combat' && c.advanceKm > 1) expect(xOf(k.position)).toBeGreaterThan(0.5);
  });
});

describe('территория — сплошная полоса', () => {
  const noTerr = (ctx: SimContext): SimContext => ({ ...ctx, rules: { ...ctx.rules, territory: undefined } });
  it('по территории противника марш медленнее; пройденные клетки переходят к своей стороне', () => {
    // немцы далеко на юго-востоке: их тыл (восток) — их территория, пока по нему никто не прошёл
    const ctx = ctxWith([su('t1', -25, 10, { type: 'tank_army' }), de('k1', 15, -15)], [order('t1', 'regroup', ll(18, 10))], 18);
    const s1 = step(createState(ctx), ctx);
    const s0 = step(createState(noTerr(ctx)), noTerr(ctx));
    const x = (s: typeof s1) => xOf(s.formations.find((f) => f.id === 't1')!.position);
    expect(x(s1)).toBeLessThan(x(s0));
    const T = ctx.theatre, terr = s1.territory!;
    expect(terr[T.indexOf(ll(-25, 10))]).toBe(0); // исходная — своя
    expect(terr[T.indexOf(ll(x(s1) - 2, 10))]).toBe(0); // пройденная — своя
    expect(terr[T.indexOf(ll(25, -15))]).toBe(1); // немецкий тыл не тронут
  });
  it('подвоз — только по своей территории: прорвавшийся вперёд снабжается по пробитому коридору', () => {
    const ctx = ctxWith([su('t1', -25, 0, { type: 'tank_army' }), de('k1', 25, 15)], [order('t1', 'regroup', ll(15, 0))]);
    const sup = { ...ctx, scenario: { ...ctx.scenario, supply: { su: { sources: [ll(-29, 0)] }, de: { sources: [ll(29, 15)] } } } };
    let st = createState(sup);
    for (let k = 0; k < 3; k++) st = step(st, sup);
    expect(st.formations.find((f) => f.id === 't1')!.cutOff ?? false).toBe(false);
  });
});

