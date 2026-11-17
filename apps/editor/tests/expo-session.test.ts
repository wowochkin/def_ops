import { historyAt } from '../src/expo/map';
import { describe, expect, it } from 'vitest';
import type { AgentTrace, EventResult, SimContext } from '@def-ops/sim';
import { BANK, turnCards } from '../src/expo/bank';
import { ExpoSession, moveDigest, refAt, timeAt, type ModelEnv, berlinDistance, tasksOf } from '../src/expo/session';

/** Поддельное ядро: запоминает вызовы, ход — кадры по часам. */
function fakeCore() {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  let hour = 0;
  // Проверка занятия цели читает дивизии и их цепочку штабов, поэтому макет
  // отдаёт полный trace: по одной дивизии каждой армии на исторической позиции.
  const trace = (): AgentTrace => ({
    scenario: 'fixture', name: 'Тест сеанса', start: '1945-04-16T05:00', hours: hour, seed: 1, fields: ['lon', 'lat'], journal: [],
    hqs: [
      { id: 'su_1bf', name: '1 БФ', side: 'su', parent: null, echelon: 'front' },
      { id: 'su_1uf', name: '1 УФ', side: 'su', parent: null, echelon: 'front' },
      { id: 'su_8gva', name: '8 гв. А', side: 'su', parent: 'su_1bf', echelon: 'army' },
      { id: 'su_13a', name: '13 А', side: 'su', parent: 'su_1uf', echelon: 'army' },
    ],
    divisions: ['su_8gva', 'su_13a'].map(hq => ({ id: `${hq}-test`, name: 'Тестовая дивизия', side: 'su', hq, kind: 'infantry', mobility: 'foot', size: 'division', quality: 1 })),
    frames: Array.from({ length: hour + 1 }, (_, h) => {
      const at = historyAt(timeAt('1945-04-16T05:00', h));
      return ['su_8gva', 'su_13a'].map(id => [...at.find(a => a.id === id)!.at]);
    }),
  });
  const call = async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === 'game_start') hour = 0;
    if (cmd === 'game_turn') hour += args.hours as number;
    return trace();
  };
  return { calls, call, hour: () => hour };
}

const ev = (id: string, historical: string, simulated: string | null, days: number | null) => ({ id, title: id, historical, simulated, days }) as unknown as EventResult;

function env(core: ReturnType<typeof fakeCore>): ModelEnv {
  return {
    call: core.call,
    ctx: { scenario: { start: '1945-04-16T05:00' } } as unknown as SimContext,
    history: { divisions: [] },
    baseHistory: null,
    placeAt: (p) => (p === 'Wriezen' ? [14.1, 52.7] : [13, 52]),
    measure: (t) => {
      const h = t.frames.length - 1;
      return { events: [ev('seelow', '1945-04-19', h >= 96 ? '1945-04-18' : null, h >= 96 ? -1 : null), ev('reichstag_taken', '1945-04-30', h >= 384 ? '1945-04-29' : null, h >= 384 ? -1 : null)], loss: h * 100 };
    },
  };
}

const first = () => 0.01;

describe('сеанс модели', () => {
  it('starts in intent mode, historical card sends no orders', async () => {
    const core = fakeCore();
    const s = new ExpoSession(env(core), BANK, 'su_1bf', first);
    await s.start();
    expect(core.calls[0]).toMatchObject({ cmd: 'game_start', args: { mode: 'intent', enemy: 'intent', player: 'su', takeover: 0 } });
    s.deal(1);
    expect(s.view.cards).toHaveLength(3);
    const slot = s.view.cards.findIndex((c) => c.id === 'bf1-hist');
    await s.decide(1, slot);
    expect(core.calls.at(-1)).toMatchObject({ cmd: 'game_turn', args: { orders: [], hours: 96 } });
    expect(s.view.reveal?.text).toBe('Именно так поступил Жуков');
    expect(s.view.time).toBe('1945-04-20T05:00');
    expect(s.view.feed).toEqual(['18 апреля — seelow (в истории — 19 апреля)']);
  });

  it('historical decision does not count a later event as already missed', async () => {
    const core = fakeCore();
    const s = new ExpoSession({
      ...env(core),
      measure: (t) => {
        const h = t.frames.length - 1;
        return {
          events: [
            ev('spremberg', '1945-04-16', h >= 48 ? '1945-04-16' : null, h >= 48 ? 0 : null),
            ev('pocket', '1945-04-16', null, null),
          ],
          loss: 2159,
        };
      },
    }, BANK, 'su_1uf', first);
    await s.start();
    s.deal(1);
    await s.decide(1, s.view.cards.findIndex((c) => c.id === 'uf1-hist'));
    expect(s.view.time.slice(0, 10)).toBe('1945-04-18');
    expect(s.view.scales.axes.days).toBe(0);
    expect(s.view.scales.axes.lossRatio).toBeCloseTo(1, 2);
    expect(s.view.scales.notes.cost).toBe('как в истории');
    expect(s.view.tasks.find((t) => t.id === 'pocket')!.due > '1945-04-18').toBe(true);
  });

  it('own card uses the precise bank place before the theatre fallback, orders are released next turn', async () => {
    const core = fakeCore();
    const s = new ExpoSession(env(core), BANK, 'su_1bf', first);
    await s.start();
    s.deal(1);
    s.view.cards = [{ id: 'bf1-north', title: '', lines: [] }, ...s.view.cards.slice(1)];
    await s.decide(1, 0);
    const turn = core.calls.at(-1)!;
    expect(turn.args.orders).toEqual([
      { hq: 'su_2gta', kind: 'attack', target: [14.133, 52.717], note: 'Обход высот с севера', form: 'order' },
      { hq: 'su_1gta', kind: 'attack', target: [14.133, 52.717], note: 'Обход высот с севера', form: 'order' },
    ]);
    expect(s.view.reveal?.text).toBe('Жуков решил иначе — вот как');
    expect(s.view.reveal?.historical.id).toBe('bf1-hist');
    s.deal(2);
    await s.decide(2, s.view.cards.findIndex((c) => c.id === 'bf2-hist'));
    expect(core.calls.filter((c) => c.cmd === 'game_release').map((c) => c.args.id)).toEqual(['su_2gta', 'su_1gta']);
  });

  it('delay takes the front from history until the next decision; third turn runs to the end', async () => {
    const core = fakeCore();
    const s = new ExpoSession(env(core), BANK, 'su_1bf', first);
    await s.start();
    s.deal(1);
    await s.decide(1, 'delay');
    expect(core.calls.at(-2)).toEqual({ cmd: 'game_take', args: { hq: 'su_1bf' } });
    expect(core.calls.at(-1)!.args.orders).toEqual([{ hq: 'su_8gva', kind: 'hold', target: null, note: 'промедление: распоряжений фронта нет', form: 'order' }]);
    expect(s.view.reveal?.text).toMatch(/^Промедление/);
    s.deal(2);
    await s.decide(2, s.view.cards.findIndex((c) => c.id === 'bf2-hist'));
    expect(core.calls.some((c) => c.cmd === 'game_release' && c.args.id === 'su_1bf')).toBe(true);
    s.deal(3);
    await s.decide(3, s.view.cards.findIndex((c) => c.id === 'bf3-hist'));
    expect(core.hour()).toBe(BANK.end);
    expect(s.view.final).toMatchObject({ matches: 2, forecast: 'Берлин пал бы 29 апреля — на день раньше истории' });
    expect(s.view.final?.rank).toBeTruthy();
  });

  it('replace can return an earlier card, keeps three distinct cards and never replaces history', async () => {
    const s = new ExpoSession(env(fakeCore()), BANK, 'su_1uf', first);
    s.deal(2);
    const hist = s.view.cards.findIndex((c) => c.id === 'uf2-hist');
    expect(s.replace(hist)).toBe(false);
    const own = [0, 1, 2].find((i) => i !== hist)!;
    const before = s.view.cards.map((c) => c.id);
    expect(s.replace(own)).toBe(true);
    expect(before).not.toContain(s.view.cards[own].id);
    const ownCount = turnCards(BANK, 'su_1uf', 2).filter(c => !c.historical).length;
    const seen = new Set([...before, s.view.cards[own].id]);
    let returned = false;
    for (let i = 0; i < ownCount * 2; i++) {
      const previous = s.view.cards[own].id;
      expect(s.replace(own)).toBe(true);
      const next = s.view.cards[own].id;
      expect(next).not.toBe(previous);
      expect(new Set(s.view.cards.map(c => c.id)).size).toBe(3);
      expect(s.view.cards[hist].id).toBe('uf2-hist');
      expect(s.view.spare).toBe(ownCount - 2);
      returned ||= seen.has(next);
      seen.add(next);
    }
    expect(returned).toBe(true);
  });

  it('time and reference helpers', () => {
    expect(timeAt('1945-04-16T05:00', 48)).toBe('1945-04-18T05:00');
    expect(refAt([0, 100, 300], 36)).toBe(200);
    expect(refAt([0, 100], 100)).toBe(100);
    expect(refAt(undefined, 10)).toBeNull();
  });

  it('map: armies before and after the scroll, new events flash, front path grows; cards carry arrows', async () => {
    const core = fakeCore();
    const s = new ExpoSession(env(core), BANK, 'su_1bf', first);
    await s.start();
    expect(s.view.map.armies.some((a) => a.id === 'su_8gva')).toBe(true);
    s.deal(1);
    const hist = s.view.cards.find((c) => c.id === 'bf1-hist')!;
    expect(hist.arrows!.length).toBeGreaterThan(0);
    s.view.cards = [{ id: 'bf1-north', title: '', lines: [] }, ...s.view.cards.slice(1)];
    await s.decide(1, 0);
    const m = s.view.map;
    expect(m.prev?.time).toBe('1945-04-16T05:00');
    expect(m.prev!.armies.find((a) => a.id === 'su_8gva')!.at).not.toEqual(m.armies.find((a) => a.id === 'su_8gva')!.at);
    expect(m.flashes.map((f) => f.id)).toEqual(['seelow']);
    expect(m.path.su_8gva).toHaveLength(2);
    expect(m.path.su_13a).toBeUndefined();
    expect(s.view.reveal?.historical.arrows?.length).toBeGreaterThan(0);
  });
});

describe('сводка хода', () => {
  it('задачи фронта — из событий хода, без них — по истории; до Берлина — сейчас и по истории', () => {
    const t = tasksOf(['seelow', 'ring'], [{ id: 'seelow', title: 'Прорыв', historical: '1945-04-19T12:00', simulated: '1945-04-18T09:00', days: -1, at: null }]);
    expect(t[0]).toMatchObject({ simulated: '1945-04-18', days: -1, historical: '1945-04-19' });
    expect(t[1]).toMatchObject({ id: 'ring', simulated: null, historical: '1945-04-25' });
    const d = berlinDistance('su_1bf', historyAt('1945-04-16T05:00'), '1945-04-16T05:00');
    expect(d!.now).toBe(d!.history);
    expect(d!.now).toBeGreaterThan(40);
    expect(d!.now).toBeLessThan(90);
  });

  it('сводка хода делит продвижение, переправы и сдвиг противника', () => {
    const prev = [
      { id: 'a', label: '8 гв. А', side: 'su' as const, front: 'su_1bf' as const, at: [14.5, 52.5] as [number, number] },
      { id: 'e', label: '9 А', side: 'de' as const, front: null, at: [14.2, 52.5] as [number, number] },
    ];
    const now = [
      { ...prev[0], at: [14.3, 52.5] as [number, number] },
      { ...prev[1], at: [14.2, 52.55] as [number, number] },
    ];
    const d = moveDigest('su_1bf', prev, now, 70, 58, [
      { title: '1 УФ форсировал Шпрее у Шпремберга' },
      { title: 'Прорыв Зееловских высот: советские войска у Мюнхеберга' },
    ]);
    expect(d.advanceKm).toBeGreaterThan(5);
    expect(d.closerKm).toBe(12);
    expect(d.crossings).toEqual(['1 УФ форсировал Шпрее у Шпремберга']);
    expect(d.taken).toEqual(['Прорыв Зееловских высот: советские войска у Мюнхеберга']);
    expect(d.enemy).toMatch(/исторический замысел/);
  });
});

it('стрелки готовых решений используют пункты банка, даже если в театре нет одноимённого района', async () => {
  const core = fakeCore();
  const bank = { ...BANK, cards: BANK.cards.map(c => c.front === 'su_1bf' && c.turn === 1 && !c.historical ? { ...c, orders: [{ army: 'su_8gva', kind: 'attack' as const, place: 'Wriezen' }] } : c) };
  const s = new ExpoSession({ ...env(core), placeAt: () => null }, bank, 'su_1bf', first);
  await s.start(); s.deal(1);
  const alternatives = s.view.cards.filter(c => c.id !== 'bf1-hist');
  expect(alternatives.length).toBeGreaterThan(0);
  expect(alternatives.every(c => (c.arrows?.length ?? 0) > 0)).toBe(true);
});
