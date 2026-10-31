import { describe, expect, it } from 'vitest';
import type { SimContext } from '@def-ops/sim';
import { modelRunner, type ModelFrame } from '../src/expo/model';
import type { ModelEnv } from '../src/expo/session';
import { cardSmith } from '../src/expo/ai';
import { BANK, cardErrors } from '../src/expo/bank';

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

  it('замена: карточка ИИ, составленная заранее; без ИИ — из банка; историческую не заменяют', async () => {
    const frames: ModelFrame[] = [];
    const reply = (c: { armies: string[]; places: string[] }) => JSON.stringify({
      title: 'Вариант ИИ', lines: ['Строка один', 'Строка два', 'Строка три', 'Строка четыре'],
      orders: [{ army: c.armies[0], kind: 'attack', place: c.places[0] }],
    });
    let ctxSeen: { armies: string[]; places: string[] } | null = null;
    const smith = cardSmith({
      ask: () => async () => reply(ctxSeen!),
      check: (c) => cardErrors(c, new Set(ctxSeen!.armies), new Set(ctxSeen!.places)),
      perCardMs: 1000, wait: 1000,
    });
    const hooked = { ...smith, prefetch: (k: string, c: Parameters<typeof smith.prefetch>[1], w: number) => { ctxSeen = c; smith.prefetch(k, c, w); } };
    const m = modelRunner(async () => fakeEnv(), (f) => frames.push(f), undefined, () => 0, { smith: hooked, want: 1 });
    await m.handle({ e: 'deal', n: 1, front: 'su_1bf' });
    const cards = frames.at(-1)!.view!.cards;
    const own = cards.findIndex((c) => !BANK.cards.find((b) => b.id === c.id)?.historical);
    const hist = cards.findIndex((c) => BANK.cards.find((b) => b.id === c.id)?.historical);
    await m.handle({ e: 'replace', n: 1, card: own });
    expect(frames.at(-1)!.view!.cards[own]).toMatchObject({ title: 'Вариант ИИ', source: 'now' });
    await m.handle({ e: 'replace', n: 1, card: hist });
    expect(frames.at(-1)!.view!.cards[hist].id).toBe(cards[hist].id);
    const plain = modelRunner(async () => fakeEnv(), (f) => frames.push(f), undefined, () => 0);
    await plain.handle({ e: 'deal', n: 1, front: 'su_1bf' });
    await plain.handle({ e: 'replace', n: 1, card: own });
    expect(frames.at(-1)!.view!.cards[own].source).toBe('bank');
  });

  it('core failure is reported, not thrown', async () => {
    const frames: ModelFrame[] = [];
    const m = modelRunner(async () => fakeEnv(true), (f) => frames.push(f));
    await m.handle({ e: 'deal', n: 1, front: 'su_1bf' });
    expect(frames.at(-1)!.error).toMatch(/^Модель недоступна/);
  });
});
