import { describe, expect, it } from 'vitest';
import type { EventResult, SimContext } from '@def-ops/sim';
import { BANK } from '../src/expo/bank';
import { ExpoSession, refAt, timeAt, type ModelEnv } from '../src/expo/session';

/** Поддельное ядро: запоминает вызовы, ход — кадры по часам. */
function fakeCore() {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  let hour = 0;
  const trace = () => ({ start: '1945-04-16T05:00', hqs: [{ id: 'su_8gva', parent: 'su_1bf', echelon: 'army' }, { id: 'su_13a', parent: 'su_1uf', echelon: 'army' }], frames: Array.from({ length: hour + 1 }, () => []) });
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

  it('own card sends orders to armies at theatre places, released at the next turn', async () => {
    const core = fakeCore();
    const s = new ExpoSession(env(core), BANK, 'su_1bf', first);
    await s.start();
    s.deal(1);
    s.view.cards = [{ id: 'bf1-north', title: '', lines: [] }, ...s.view.cards.slice(1)];
    await s.decide(1, 0);
    const turn = core.calls.at(-1)!;
    expect(turn.args.orders).toEqual([
      { hq: 'su_2gta', kind: 'attack', target: [14.1, 52.7], note: 'Обход высот с севера', form: 'order' },
      { hq: 'su_1gta', kind: 'attack', target: [14.1, 52.7], note: 'Обход высот с севера', form: 'order' },
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

  it('replace swaps an own card for an unshown one, never the historical', async () => {
    const s = new ExpoSession(env(fakeCore()), BANK, 'su_1uf', first);
    s.deal(2);
    const hist = s.view.cards.findIndex((c) => c.id === 'uf2-hist');
    expect(s.replace(hist)).toBe(false);
    const own = [0, 1, 2].find((i) => i !== hist)!;
    const before = s.view.cards.map((c) => c.id);
    expect(s.replace(own)).toBe(true);
    expect(before).not.toContain(s.view.cards[own].id);
    expect(s.replace(own)).toBe(false);
  });

  it('time and reference helpers', () => {
    expect(timeAt('1945-04-16T05:00', 48)).toBe('1945-04-18T05:00');
    expect(refAt([0, 100, 300], 36)).toBe(200);
    expect(refAt([0, 100], 100)).toBe(100);
    expect(refAt(undefined, 10)).toBeNull();
  });
});
