import { describe, expect, it } from 'vitest';
import type { SimContext } from '@def-ops/sim';
import { modelRunner, type ModelFrame } from '../src/expo/model';
import type { ModelEnv } from '../src/expo/session';

function fakeEnv(fail = false): ModelEnv {
  let hour = 0;
  return {
    call: async (cmd, args) => {
      if (fail) throw new Error('нет ядра');
      if (cmd === 'game_start') hour = 0;
      if (cmd === 'game_turn') hour += args.hours as number;
      return { start: '1945-04-16T05:00', hqs: [], frames: Array.from({ length: hour + 1 }, () => []) };
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

  it('core failure is reported, not thrown', async () => {
    const frames: ModelFrame[] = [];
    const m = modelRunner(async () => fakeEnv(true), (f) => frames.push(f));
    await m.handle({ e: 'deal', n: 1, front: 'su_1bf' });
    expect(frames.at(-1)!.error).toMatch(/^Модель недоступна/);
  });
});
