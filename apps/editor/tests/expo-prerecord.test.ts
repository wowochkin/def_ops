import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINES, allLines, fillParts, pickFilled, templateUnits, type Vars } from '../src/expo/lines';
import { WHOLE_MAX, clipPlan, expand, joinGap, parseManifest, stageDomains, voiceTexts, type Domains, type VoiceManifest } from '../src/expo/prerecord';
import { clipPlayer, stageSpeaker, turnstile, type ClipAudio, type LiveVoice } from '../src/expo/speaker';
import { PRERECORD_MISSING, setPrerecord, startupVerdict } from '../src/expo/health';
import { aiRunner } from '../src/expo/ai-runner';
import type { Line, voiceQueue } from '../src/expo/voice-queue';
import { EXPO_DEFAULTS } from '../src/expo/settings';
import { cer, heardOk, heardText, msOk, wer, werOk } from '../../../scripts/expo-voice';

const D: Domains = stageDomains('1945-04-16T05:00', 384);
const manifestOf = (texts: string[]): VoiceManifest => ({
  version: 1, voice: 'chief', engine: 'qwen3',
  clips: Object.fromEntries(texts.map((t, i) => [t, { file: `${i.toString(16).padStart(8, '0')}.ogg`, ms: 1000 + t.length * 60 }])),
});
const FULL = manifestOf(voiceTexts(D));

/** Все сочетания значений подстановок шаблона (по фронтам). */
function combos(t: string): Vars[] {
  const slots = [...new Set([...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
  return D.fronts.flatMap((f) => {
    let out: Vars[] = [{}];
    for (const s of slots) {
      const v = (f as unknown as Record<string, unknown>)[s] ?? (D as unknown as Record<string, unknown>)[s];
      out = out.flatMap((c) => (Array.isArray(v) ? v : [v]).map((x) => ({ ...c, [s]: x as string })));
    }
    return out;
  });
}

describe('предзапись: тексты и склейка', () => {
  it('значения подстановок — из данных стенда', () => {
    expect(D.date[0]).toBe('16 апреля');
    expect(D.date.at(-1)).toBe('2 мая');
    expect(D.fronts.map((f) => f.marshal)).toEqual(['Жуков', 'Конев']);
    expect(D.fronts[0].turn).toHaveLength(3);
    expect(D.event.length).toBeGreaterThan(5);
  });

  it('у каждой заготовки при любых значениях подстановок есть клипы', () => {
    for (const t of allLines()) {
      for (const v of combos(t)) {
        const f = fillParts(t, v)!;
        const plan = clipPlan(FULL, f.text, f.parts);
        expect(plan, f.text).not.toBeNull();
        // немного сочетаний — целая фраза, иначе — куски по предложениям
        expect(plan!.length).toBe(expand(t, D).length <= WHOLE_MAX ? 1 : templateUnits(t).length);
      }
    }
  });

  it('куски склейки — предложения шаблона; подставленные «гв.» шаблон не режут', () => {
    expect(templateUnits('Вы выбрали: «{title}». Маршал {marshal} решил иначе.')).toEqual(['Вы выбрали: «{title}».', 'Маршал {marshal} решил иначе.']);
    expect(fillParts('В ходе операции: {event}. Дальше.', { event: '3 гв. ТА у Цоссена' })!.parts).toEqual(['В ходе операции: 3 гв. ТА у Цоссена.', 'Дальше.']);
  });

  it('нет клипа одного куска — фраза не озвучена; пауза по знаку', () => {
    const m = manifestOf(['А.', 'Б.']);
    expect(clipPlan(m, 'А. Б.', ['А.', 'Б.'])).toHaveLength(2);
    expect(clipPlan(m, 'А. В.', ['А.', 'В.'])).toBeNull();
    expect(clipPlan(null, 'А.')).toBeNull();
    expect(joinGap('Решайте.')).toBeGreaterThan(joinGap('Итак:'));
    expect(joinGap('Думаю…')).toBeGreaterThan(joinGap('Решайте.'));
  });

  it('выбор заготовки — из озвученных, если такие есть', () => {
    const vars = { title: 'Карточка ИИ, которой нет в банке', marshal: 'Жуков', date: '20 апреля' };
    const voiced = (f: { text: string; parts?: string[] }) => clipPlan(FULL, f.text, f.parts) !== null;
    for (let i = 0; i < 20; i++) expect(pickFilled(LINES.comment.own, vars, Math.random, voiced)!.text).toMatch(/^Вы выбрали свой вариант/);
    expect(pickFilled(['Без {x}'], {}, Math.random, voiced)).toBeNull();
  });

  it('манифест чужой формы не принимается', () => {
    expect(parseManifest(FULL)).toBe(FULL);
    expect(parseManifest({ version: 2, clips: {} })).toBeNull();
    expect(parseManifest({ version: 1, clips: { a: { file: '../x.ogg', ms: 1 } } })).toBeNull();
  });
});

/** Подмена AudioContext: запоминает, что и когда поставлено в звук. */
function fakeAudio() {
  const started: { dur: number; at: number }[] = [];
  const nodes: { onended: (() => void) | null; stop: () => void }[] = [];
  const a: ClipAudio = {
    currentTime: 10,
    destination: {},
    decodeAudioData: async (b) => ({ duration: new Uint8Array(b)[0] / 10 }) as AudioBuffer,
    createBufferSource: () => {
      const n = { buffer: null as AudioBuffer | null, onended: null as (() => void) | null, connect() {}, start(at: number) { started.push({ dur: n.buffer!.duration, at }); }, stop() {} };
      nodes.push(n);
      return n as unknown as AudioBufferSourceNode;
    },
  };
  return { a, started, nodes };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('предзапись: звук', () => {
  it('клипы встык с паузой по знаку, конец фразы — по концу последнего', async () => {
    const f = fakeAudio();
    const p = clipPlayer(() => f.a, async (file) => new Uint8Array([file.startsWith('1') ? 20 : 15]).buffer);
    let done = false;
    const h = p.play([{ file: '1.ogg', ms: 2000 }, { file: '2.ogg', ms: 1500 }], [0.3, 0]);
    void h.done.then(() => (done = true));
    await flush();
    expect(f.started).toEqual([{ dur: 2, at: 10.02 }, { dur: 1.5, at: 10.02 + 2 + 0.3 }]);
    expect(done).toBe(false);
    f.nodes[1].onended!();
    await flush();
    expect(done).toBe(true);
  });

  it('декодированное держится в пределах бюджета; вытесненное декодируется заново', async () => {
    const f = fakeAudio();
    const loads: string[] = [];
    const p = clipPlayer(() => f.a, async (file) => { loads.push(file); return new Uint8Array([20]).buffer; }, 3);
    await p.preload([{ file: 'a.ogg', ms: 2000 }, { file: 'b.ogg', ms: 2000 }]);
    expect(loads).toEqual(['a.ogg']); // второй сверх бюджета — не заранее
    p.play([{ file: 'b.ogg', ms: 2000 }], [0]);
    await flush();
    p.play([{ file: 'a.ogg', ms: 2000 }], [0]);
    await flush();
    expect(loads).toEqual(['a.ogg', 'b.ogg', 'a.ogg']);
  });

  const manifest = manifestOf(['Готовая фраза.', 'Ответ из заготовок.']);
  function speakerWith(o: { live?: Partial<LiveVoice> | null; aiOn?: boolean; manifest?: VoiceManifest | null } = {}) {
    const played: string[][] = [];
    const swaps: Line[] = [];
    const player = { preload: async () => {}, play: (cs: { file: string }[]) => { played.push(cs.map((c) => c.file)); return { done: Promise.resolve(), stop() {} }; } };
    const said: string[] = [];
    const live: LiveVoice | null = o.live === null ? null : {
      ready: () => true,
      say: (t) => { said.push(t); return { synthDone: Promise.resolve(), done: Promise.resolve(), stop() {} }; },
      ...o.live,
    };
    const sp = stageSpeaker({
      manifest: () => (o.manifest === undefined ? manifest : o.manifest), player: player as unknown as ReturnType<typeof clipPlayer>,
      aiOn: () => o.aiOn ?? true, live, gate: turnstile(), liveStartMs: 50, onSwap: (l) => swaps.push(l),
    });
    return { sp, played, swaps, said };
  }
  const nowLine: Line = { text: 'Ответ ИИ сейчас.', priority: 'action', source: 'now', fallback: { text: 'Ответ из заготовок.' } };

  it('заготовка — всегда из предзаписи, даже когда живой голос готов', () => {
    const s = speakerWith();
    s.sp.speak('Готовая фраза.', { text: 'Готовая фраза.', priority: 'event', source: 'prepared' });
    expect(s.played).toHaveLength(1);
    expect(s.said).toEqual([]);
  });

  it('текст ИИ — живым голосом «С ИИ»; без ИИ или без сервиса — замена из предзаписи', async () => {
    const a = speakerWith();
    a.sp.speak(nowLine.text, nowLine);
    await flush();
    expect(a.said).toEqual(['Ответ ИИ сейчас.']);
    for (const s of [speakerWith({ aiOn: false }), speakerWith({ live: { ready: () => false } }), speakerWith({ live: null })]) {
      s.sp.speak(nowLine.text, nowLine);
      expect(s.played).toHaveLength(1);
      expect(s.swaps.at(-1)).toMatchObject({ text: 'Ответ из заготовок.', source: 'prepared' });
      expect(s.said).toEqual([]);
    }
  });

  it('живой голос занят моделью дольше срока — звучит замена, синтез потом не начинается', async () => {
    const gate = turnstile();
    let freeModel = () => {};
    void gate.run(() => new Promise<void>((r) => (freeModel = r)));
    const said: string[] = [];
    const played: string[][] = [];
    const sp = stageSpeaker({
      manifest: () => manifest, aiOn: () => true, gate, liveStartMs: 20,
      player: { preload: async () => {}, play: (cs: { file: string }[]) => { played.push(cs.map((c) => c.file)); return { done: Promise.resolve(), stop() {} }; } } as unknown as ReturnType<typeof clipPlayer>,
      live: { ready: () => true, say: (t) => { said.push(t); return { synthDone: Promise.resolve(), done: Promise.resolve(), stop() {} }; } },
    });
    const h = sp.speak(nowLine.text, nowLine);
    await new Promise((r) => setTimeout(r, 40));
    expect(played).toHaveLength(1);
    freeModel();
    await h.done;
    await flush();
    expect(said).toEqual([]);
  });

  afterEach(() => vi.useRealTimers());
  it('предзаписи нет — молчание с субтитром на время чтения; проверка запуска говорит об этом', async () => {
    vi.useFakeTimers();
    const s = speakerWith({ manifest: null, live: null });
    let done = false;
    void s.sp.speak('Готовая фраза.', { text: 'Готовая фраза.', priority: 'event', source: 'prepared' }).done.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(done).toBe(true);
    setPrerecord('missing');
    const states = { core: 'ok', voice: 'ok', model: 'ok', windows: 'ok' } as const;
    expect(startupVerdict(states, EXPO_DEFAULTS).note).toBe(PRERECORD_MISSING);
    setPrerecord('ready');
    expect(startupVerdict(states, EXPO_DEFAULTS).note).toBeNull();
  });
});

describe('исполнитель: куски склейки и замена для текста ИИ', () => {
  it('say — с кусками; ответ ИИ — с заменой из готовых ответов', async () => {
    const said: Line[] = [];
    const queue = { push: (l: Line) => said.push(l), clear() {}, fill() {}, current: () => null, busy: () => false } as unknown as ReturnType<typeof voiceQueue>;
    const r = aiRunner({
      queue, ask: () => async () => 'Высоты прикрывали Берлин.', facts: () => ({ text: '', vars: { turn: 'Нейсе' } }),
      dispatch() {}, onFrame() {}, answerMs: 50, voiced: (f) => clipPlan(FULL, f.text, f.parts) !== null,
    });
    r.handle({ e: 'say', key: 'explain', priority: 'event' });
    expect(said[0]).toMatchObject({ text: expect.stringMatching(/^Перелом: Нейсе\./), parts: expect.any(Array) });
    await r.ask('Почему Зееловские высоты так важны?');
    expect(said.at(-1)).toMatchObject({ source: 'now', fallback: { text: LINES.answers[0].a } });
  });
});

describe('команда подготовки: автопроверка клипа', () => {
  it('доля ошибок по словам, допуск и длительность', () => {
    expect(wer('Осталось десять секунд.', 'осталось десять секунд')).toBe(0);
    expect(wer('Ход досчитан до второго мая.', 'ход досчитан до второго')).toBeCloseTo(0.2);
    expect(werOk('Осталось десять секунд.', 1 / 3)).toBe(true);
    expect(werOk('Ход досчитан до второго мая и далее вперёд.', 3 / 8)).toBe(false);
    expect(msOk('Осталось десять секунд.', 1400)).toBe(true);
    expect(msOk('Осталось десять секунд.', 100)).toBe(false);
    expect(msOk('Есть.', 9000)).toBe(false);
    // слитно или раздельно распознанное слово и «2,5 млн» — не ошибка озвучки
    const said = 'В ходе операции: Александерплац.';
    const heard = heardText('В ходе операции Александр Плац.');
    expect(werOk(said, wer(said, heard))).toBe(false);
    expect(heardOk(said, wer(said, heard), cer(said, heard))).toBe(true);
    expect(heardText('около 2,5 млн человек')).toBe('около двух с половиной миллионов человек');
    expect(heardOk('Осталось десять секунд.', 1, 1)).toBe(false);
  });
});
