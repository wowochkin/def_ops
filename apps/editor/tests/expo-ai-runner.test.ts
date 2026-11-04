import { describe, expect, it } from 'vitest';
import { aiRunner, parseSpeech, type AiFrame } from '../src/expo/ai-runner';
import { voiceQueue, type Line } from '../src/expo/voice-queue';
import type { DirectorEvent } from '../src/expo/director';

function setup(ask: (() => Promise<string>) | null, listen?: () => Promise<string | null>) {
  const said: Line[] = [];
  const queue = { push: (l: Line) => said.push(l), clear: () => (said.length = 0), scene() {}, sceneNow: () => 'turn-1-scroll', current: () => null, busy: () => false } as unknown as ReturnType<typeof voiceQueue>;
  const frames: AiFrame[] = [];
  const events: DirectorEvent[] = [];
  const counts: string[] = [];
  const r = aiRunner({
    queue, ask: () => (ask ? async () => ask() : null), facts: () => ({ text: '', vars: { marshal: 'Жуков', date: '20 апреля', title: 'Обход' } }),
    dispatch: (e) => events.push(e), listen, onFrame: (f) => frames.push(f), answerMs: 50, commentMs: 50, count: (k) => counts.push(k),
  });
  return { r, said, frames, events, counts };
}
const tick = () => new Promise((res) => setTimeout(res, 0));

describe('исполнитель голоса и ИИ', () => {
  it('эффекты say режиссёра звучат заготовкой; newSession глушит', () => {
    const s = setup(null);
    for (const key of ['timer-warn', 'delay', 'offer-decide', 'voice-soon']) s.r.handle({ e: 'say', key, priority: 'timer' });
    expect(s.said).toHaveLength(4);
    s.r.handle({ e: 'newSession' });
    expect(s.said).toHaveLength(0);
    expect(s.frames.at(-1)).toEqual({ line: null, said: null, answer: null, thinking: null, ear: 'idle' });
  });

  it('ответ звучит, даже если за время ожидания сцена уже сменилась', async () => {
    let release: (s: string) => void = () => {};
    const said: string[] = [];
    const q = voiceQueue({ speak: (t) => { said.push(t); return { done: Promise.resolve(), stop() {} }; } });
    q.scene('turn-1-explain');
    const r = aiRunner({
      queue: q,
      ask: () => () => new Promise<string>((res) => { release = res; }),
      facts: () => ({ text: '', vars: {} }),
      dispatch: () => {},
      onFrame: () => {},
      answerMs: 5000,
    });
    void r.ask('проверка связи');
    q.scene('turn-1-choose');
    release('Связь работает.');
    await tick();
    expect(said).toContain('Связь работает.');
  });

  it('вопрос без ИИ — готовый ответ с источником', async () => {
    const s = setup(null);
    s.r.handle({ e: 'ask', q: 'Какой вариант лучше?' });
    await tick();
    expect(s.frames.at(-1)!.answer).toMatchObject({ source: 'prepared' });
    expect(s.said.at(-1)!.priority).toBe('action');
    const kept = s.frames.at(-1)!.answer;
    s.r.handle({ e: 'deal', n: 2, front: 'su_1bf' });
    expect(s.frames.at(-1)!.answer).toEqual(kept);
  });

  it('ИИ медлит — мысль на экране, потом заготовка; учёт вовремя/заменено', async () => {
    const s = setup(() => new Promise(() => {}));
    const p = s.r.ask('Почему Зееловские высоты так важны?');
    expect(s.frames.at(-1)!.thinking).toBeTruthy();
    await p;
    expect(s.frames.at(-1)!.answer!.source).toBe('prepared');
    expect(s.counts).toEqual(['aiFallback']);
    const t = setup(async () => 'Высоты прикрывали путь.');
    await t.r.ask('почему');
    expect(t.counts).toEqual(['aiOnTime']);
  });

  it('голосом: команда сеанса — событие режиссёру, иное — вопрос', async () => {
    const s = setup(null, async () => 'выбираю второй');
    s.r.handle({ e: 'listen' });
    await tick();
    expect(s.events).toEqual([{ t: 'choose', card: 1 }]);
    expect(parseSpeech('Начать заново')).toEqual({ t: 'restart' });
    expect(parseSpeech('карточка 3')).toEqual({ t: 'choose', card: 2 });
    expect(parseSpeech('сколько было танков')).toEqual({ ask: 'сколько было танков' });
  });

  it('комментарий выбора без ИИ — заготовка события', async () => {
    const s = setup(null);
    await s.r.decided('own');
    expect(s.said.at(-1)).toMatchObject({ priority: 'action', source: 'prepared' });
    expect(s.said.at(-1)!.voice).toBeUndefined();
    expect(s.said.at(-1)!.scene).toBeUndefined();
  });
});
