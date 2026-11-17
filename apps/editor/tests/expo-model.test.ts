import { describe, expect, it, vi } from 'vitest';
import type { SimContext } from '@def-ops/sim';
import { modelRunner, type ModelFrame } from '../src/expo/model';
import type { ModelEnv } from '../src/expo/session';
import { BANK } from '../src/expo/bank';

function fakeEnv(fail = false): ModelEnv {
  let hour = 0;
  return {
    call: async (cmd, args) => {
      if (fail) throw new Error('нет ядра');
      if (cmd === 'game_start') hour = 0;
      if (cmd === 'game_turn') hour += args.hours as number;
      return { start: '1945-04-16T05:00', hqs: [], divisions: [], frames: Array.from({ length: hour + 1 }, () => []) };
    },
    ctx: { scenario: { start: '1945-04-16T05:00' } } as unknown as SimContext,
    history: { divisions: [] },
    baseHistory: null,
    placeAt: () => [13, 52],
    measure: () => ({ events: [], loss: 0 }),
  };
}

describe('ход модели по эффектам режиссёра', () => {
  it('deal starts a session, decide scrolls, newSession resets', async () => {
    const frames: ModelFrame[] = [];
    const m = modelRunner(async () => fakeEnv(), (f) => frames.push(f));
    await m.handle({ e: 'deal', n: 1, front: 'su_1uf' });
    expect(frames.at(-1)!.view!.cards).toHaveLength(3);
    await m.handle({ e: 'decide', n: 1, choice: 'delay' });
    expect(frames.some((f) => f.view?.busy)).toBe(true);
    expect(frames.at(-1)!.view).toMatchObject({ busy: false, hour: 48, time: '1945-04-18T05:00' });
    await m.handle({ e: 'deal', n: 2, front: 'su_1uf' });
    expect(frames.at(-1)!.view!.turn).toBe(2);
    await m.handle({ e: 'newSession' });
    expect(frames.at(-1)).toEqual({ view: null, error: null });
  });

  it.each([false, true])('замена из банка без ожидания ИИ (подключён smith: %s), историческая неизменна', async (withSmith) => {
    const frames: ModelFrame[] = [];
    const smith = { prefetch: vi.fn(), take: vi.fn(async () => null), reset: vi.fn() };
    const m = modelRunner(async () => fakeEnv(), (f) => frames.push(f), undefined, () => 0, withSmith ? { smith, want: 1 } : {});
    await m.handle({ e: 'deal', n: 1, front: 'su_1bf' });
    const cards = frames.at(-1)!.view!.cards;
    const own = cards.findIndex((c) => !BANK.cards.find((b) => b.id === c.id)?.historical);
    const hist = cards.findIndex((c) => BANK.cards.find((b) => b.id === c.id)?.historical);
    await m.handle({ e: 'replace', n: 1, card: own });
    const replaced = frames.at(-1)!.view!.cards;
    expect(replaced[own].source).toBe('bank');
    expect(cards.map(c => c.id)).not.toContain(replaced[own].id);
    expect(new Set(replaced.map(c => c.id)).size).toBe(3);
    expect(BANK.cards.find(c => c.id === replaced[own].id)).toMatchObject({ front: 'su_1bf', turn: 1 });
    await m.handle({ e: 'replace', n: 1, card: hist });
    expect(frames.at(-1)!.view!.cards[hist].id).toBe(cards[hist].id);
    expect(smith.prefetch).not.toHaveBeenCalled();
    expect(smith.take).not.toHaveBeenCalled();
  });

  it('core failure is reported, not thrown', async () => {
    const frames: ModelFrame[] = [];
    const m = modelRunner(async () => fakeEnv(true), (f) => frames.push(f));
    await m.handle({ e: 'deal', n: 1, front: 'su_1bf' });
    expect(frames.at(-1)!.error).toMatch(/^Модель недоступна/);
  });
});
