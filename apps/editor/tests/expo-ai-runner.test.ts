import { describe, expect, it } from 'vitest';
import { aiRunner, parseSpeech, type AiFrame } from '../src/expo/ai-runner';
import { debriefCursor, debriefUtterances, operationDebrief, resultBeat } from '../src/expo/debrief';
import { LINES, templateUnits } from '../src/expo/lines';
import { voiceQueue, type Line } from '../src/expo/voice-queue';
import type { DirectorEvent } from '../src/expo/director';
import type { ModelView } from '../src/expo/session';
import { INTRO_CUES, INTRO_KEYS } from '../src/expo/intro-story';

function setup(ask: (() => Promise<string>) | null, listen?: () => Promise<string | null>) {
  const said: Line[] = [];
  const queue = { push: (l: Line) => said.push(l), clear: () => (said.length = 0), scene() {}, sceneNow: () => 'turn-1-scroll', current: () => null, busy: () => false } as unknown as ReturnType<typeof voiceQueue>;
  const frames: AiFrame[] = [];
  const events: DirectorEvent[] = [];
  const counts: string[] = [];
  const r = aiRunner({
    queue, ask: () => (ask ? async () => ask() : null), facts: () => ({ text: '', vars: { marshal: 'Жуков', date: '20 апреля', title: 'Обход' } }),
    dispatch: (e) => events.push(e), listen, onFrame: (f) => frames.push(f), answerMs: 50, count: (k) => counts.push(k),
  });
  return { r, said, frames, events, counts };
}
const tick = () => new Promise((res) => setTimeout(res, 0));

describe('исполнитель голоса и ИИ', () => {
  it('вход в итог очищает комментарий и незавершённый ответ прежней сцены', async () => {
    let finish!: (text: string) => void;
    const s = setup(() => new Promise<string>(r => { finish = r; }));
    s.r.onLine({ text: 'Войска идут к Торгау.', source: 'now', priority: 'scene' });
    const pending = s.r.ask('Что произошло?');
    s.r.handle({ e: 'scene', key: 'result' });
    expect(s.r.frame()).toMatchObject({ line: null, said: null, answer: null, thinking: null, ear: 'idle' });
    finish('Старый ответ.'); await pending;
    expect(s.said).toEqual([]);
    expect(s.r.frame().said).toBeNull();
  });

  it('интро сохраняет все 13 сцен, реальные сроки клипов и общий момент начала', () => {
    const said: Line[] = [];
    const queue = { push: (l: Line) => { said.push(l); return Promise.resolve(); }, scene() {} } as unknown as ReturnType<typeof voiceQueue>;
    const r = aiRunner({ queue, ask: () => null, facts: () => ({ text: '', vars: {} }), dispatch() {}, onFrame() {},
      voiced: (f) => f.text === LINES.say['intro-2'][0], now: () => 7500,
      duration: (f) => f.text === LINES.say['intro-2'][0] ? 24_000 : null });
    r.handle({ e: 'scene', key: 'intro' });
    for (const key of INTRO_KEYS) r.handle({ e: 'say', key, priority: 'scene', scene: 'intro' });
    expect(said).toHaveLength(13);
    expect(said.map(line => line.mark)).toEqual(INTRO_KEYS);
    expect(said[1]).toMatchObject({ source: 'prepared', mark: 'intro-13', durationMs: INTRO_CUES[1].durationMs });
    expect(said.find(line => line.mark === 'intro-10')).toMatchObject({ source: 'prepared', durationMs: INTRO_CUES.find(cue => cue.key === 'intro-10')!.durationMs });
    expect(said.find(line => line.mark === 'intro-2')).toMatchObject({ source: 'prepared', durationMs: 24_000 });
    expect(said[2]).toMatchObject({ source: 'prepared', mark: 'intro-11', durationMs: INTRO_CUES[2].durationMs });
    r.onLine(said[2]);
    expect(r.frame()).toMatchObject({ introLine: 3, introCueStartedAt: 7500, introCueDurationMs: INTRO_CUES[2].durationMs });
    r.onLine(null);
    expect(r.frame().introLine).toBe(3);
    r.handle({ e: 'scene', key: 'welcome' });
    expect(r.frame().introLine).toBeUndefined();
  });

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

  it('микрофон отправляет сказанное вопросом и держит таймер до окончания ответа', async () => {
    const events: DirectorEvent[] = [];
    let finishPlayback = () => {};
    const queue = voiceQueue({ speak: () => ({ done: new Promise<void>(r => { finishPlayback = r; }), stop() { finishPlayback(); } }) });
    const r = aiRunner({
      queue, ask: () => async () => 'Второй вариант требует сохранить резерв.', facts: () => ({ text: '', vars: {} }),
      listen: async () => 'выбираю второй', dispatch: e => events.push(e), onFrame() {},
    });
    r.handle({ e: 'listen' });
    await tick();
    expect(r.frame().answer).toEqual({ q: 'выбираю второй', text: 'Второй вариант требует сохранить резерв.', source: 'now' });
    expect(queue.current()?.text).toBe('Второй вариант требует сохранить резерв.');
    expect(events).toEqual([{ t: 'timerHold' }]);
    finishPlayback();
    await tick();
    expect(events).toEqual([{ t: 'timerHold' }, { t: 'timerRelease' }]);
  });

  it('отдельный разбор команды распознаёт варианты и обычные вопросы', () => {
    expect(parseSpeech('Начать заново')).toEqual({ t: 'restart' });
    expect(parseSpeech('карточка 3')).toEqual({ t: 'choose', card: 2 });
    expect(parseSpeech('сколько было танков')).toEqual({ ask: 'сколько было танков' });
  });

  it('комментарий выбора без ИИ — заготовка события', async () => {
    const s = setup(null);
    await s.r.decided('own');
    expect(s.said.at(-1)).toMatchObject({ priority: 'scene', source: 'prepared' });
    expect(s.said.at(-1)!.voice).toBeUndefined();
    expect(s.said.at(-1)!.scene).toBe('turn-1-scroll');
  });
});

describe('куски разбора', () => {
  it('соседние короткие предложения одного абзаца звучат вместе', () => {
    const a = 'Первое предложение. Второе предложение. Третье предложение.';
    const b = 'Уже другой абзац, и он тоже короткий.';
    const u = debriefUtterances([a, b]);
    expect(u.at(-1)).toBe(b);
    expect(u.slice(0, -1).join(' ')).toBe(a);
    expect(debriefCursor(['Первое предложение.', 'Второе предложение.', 'Третье предложение.'], u[0])).toEqual({ from: 0, at: u[0].split('. ').length - 1 });
    const long = Array.from({ length: 8 }, (_, i) => `Предложение номер ${i} про ход операции на берлинском направлении.`).join(' ');
    const parts = debriefUtterances([long]);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(' ')).toBe(long);
    expect(parts.every((x) => x.length <= 220)).toBe(true);
  });

  it('кусок из нескольких предложений ведёт карту по всему куску', () => {
    const v = {
      front: 'su_1uf',
      time: '1945-04-29T18:00',
      decisions: [{ n: 1, choice: 'delay', historical: 'delay' }],
      final: {
        forecast: 'Берлин пал бы 29 апреля — на день раньше истории',
        rank: 'генерал армии',
        matches: 1,
        scales: { notes: { speed: 'быстрее', cost: 'дешевле', intent: 'выполнено 2 из 5' } },
      },
    } as ModelView;
    const d = operationDebrief(v)!;
    const chunk = debriefUtterances(d.paragraphs).find((t) => templateUnits(t).length > 1)!;
    const para = d.paragraphs.find((p) => p.includes(templateUnits(chunk)[0]))!;
    const beat = resultBeat(v, chunk);
    expect(beat.span[1] - beat.span[0]).toBeCloseTo(templateUnits(chunk).length / templateUnits(para).length);
    const close = debriefUtterances(d.paragraphs).slice(-5);
    expect(close).toEqual([
      'Берлин пал бы 29 апреля, на день раньше истории.',
      'По темпу быстрее.',
      'По цене операции дешевле.',
      'Замысел: выполнено 2 из 5.',
      'По такому ходу звание — генерал армии.',
    ]);
    expect(resultBeat(v, close[3])).toMatchObject({ phase: 'close', span: [3 / 5, 4 / 5] });
  });
});
