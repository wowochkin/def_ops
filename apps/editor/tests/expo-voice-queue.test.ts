import { describe, expect, it } from 'vitest';
import { attractLoopDue, attractShown, voiceQueue, type Line, type Speaker } from '../src/expo/voice-queue';

function fakeSpeaker() {
  const said: string[] = [];
  const stopped: string[] = [];
  const pending: (() => void)[] = [];
  const speaker: Speaker = {
    speak(text) {
      said.push(text);
      let finish = () => {};
      const done = new Promise<void>((r) => (finish = r));
      pending.push(finish);
      return { done, stop: () => { stopped.push(text); finish(); } };
    },
  };
  const finishOne = async () => { pending.shift()?.(); await new Promise((r) => setTimeout(r, 0)); };
  return { speaker, said, stopped, finishOne };
}

describe('очередь голоса', () => {
  it('не говорит поверх себя: предупреждение таймера ждёт конца фразы сцены', async () => {
    const f = fakeSpeaker();
    const q = voiceQueue(f.speaker);
    q.scene('turn-1-choose');
    q.push({ text: 'сцена', priority: 'scene', source: 's', scene: 'turn-1-choose' });
    q.push({ text: 'таймер', priority: 'timer', source: 's', scene: 'turn-1-choose' });
    expect(f.said).toEqual(['сцена']);
    expect(f.stopped).toEqual([]);
    await f.finishOne();
    expect(f.said).toEqual(['сцена', 'таймер']);
  });

  it('ответ на действие обрывает начатую фразу и звучит сразу', () => {
    const f = fakeSpeaker();
    const q = voiceQueue(f.speaker);
    q.scene('briefing-0');
    q.push({ text: 'пункт', priority: 'scene', source: 's', scene: 'briefing-0' });
    q.push({ text: 'ответ', priority: 'action', source: 's', scene: 'briefing-0' });
    expect(f.stopped).toEqual(['пункт']);
    expect(f.said).toEqual(['пункт', 'ответ']);
  });

  it('смена сцены: фраза ушедшей сцены обрывается и не договаривается, её очередь — прочь', async () => {
    const f = fakeSpeaker();
    const done: string[] = [];
    const q = voiceQueue(f.speaker, { onDone: (l) => done.push(l.text) });
    q.scene('briefing-0');
    q.push({ text: 'пункт 1', priority: 'scene', source: 's', scene: 'briefing-0' });
    q.push({ text: 'ещё о пункте 1', priority: 'scene', source: 's', scene: 'briefing-0' });
    q.scene('briefing-1');
    expect(f.stopped).toEqual(['пункт 1']);
    q.push({ text: 'пункт 2', priority: 'scene', source: 's', scene: 'briefing-1' });
    await f.finishOne();
    await f.finishOne();
    expect(f.said).toEqual(['пункт 1', 'пункт 2']);
    // оборванная фраза не считается договорённой (пункт по ней не сменится)
    expect(done).toEqual(['пункт 2']);
  });

  it('фразы чужой сцены не принимаются; переходная фраза без сцены живёт до конца', () => {
    const f = fakeSpeaker();
    const q = voiceQueue(f.speaker);
    q.scene('turn-1-scroll');
    q.push({ text: 'запоздалый комментарий', priority: 'action', source: 's', scene: 'turn-1-choose' });
    expect(f.said).toEqual([]);
    q.push({ text: 'решаю за вас', priority: 'scene', source: 's' });
    q.scene('turn-2-explain');
    expect(f.stopped).toEqual([]);
    expect(q.current()?.text).toBe('решаю за вас');
  });

  it('без фонового рассказа: тишина, пока нечего сказать; clear глушит всё', () => {
    const f = fakeSpeaker();
    const lines: (string | null)[] = [];
    const q = voiceQueue(f.speaker, { onLine: (l) => lines.push(l?.text ?? null) });
    expect(q.busy()).toBe(false);
    q.push({ text: 'сцена', priority: 'scene', source: 's' });
    q.clear();
    expect(q.current()).toBeNull();
    expect(lines.at(-1)).toBeNull();
    expect('fill' in q).toBe(false);
  });

  it('сбой речи не останавливает очередь', async () => {
    const said: string[] = [];
    const q = voiceQueue({ speak: (t) => { said.push(t); if (t === 'a') throw new Error('нет голоса'); return { done: Promise.resolve(), stop() {} }; } });
    q.push({ text: 'a', priority: 'scene', source: 's' });
    q.push({ text: 'b', priority: 'scene', source: 's' });
    await new Promise((r) => setTimeout(r, 0));
    expect(said).toEqual(['a', 'b']);
  });

  it('следующая фраза ждёт, пока доиграет эта', async () => {
    const said: string[] = [];
    let releaseSynth = () => {};
    const pending: (() => void)[] = [];
    const q = voiceQueue({
      speak(text) {
        said.push(text);
        let finish = () => {};
        let synth = () => {};
        if (text === 'первая') releaseSynth = () => synth();
        const done = new Promise<void>((r) => (finish = r));
        pending.push(finish);
        return { done, stop() { finish(); }, synth: new Promise<void>((r) => (synth = r)) };
      },
    });
    q.scene('result');
    const line = (text: string): Line => ({ text, priority: 'scene', source: 's', scene: 'result', voice: 'zhukov' });
    q.push(line('первая'));
    q.push(line('вторая'));
    expect(said).toEqual(['первая']);
    releaseSynth();
    await new Promise((r) => setTimeout(r, 0));
    // синтез второй уже идёт, пока первая ещё звучит
    expect(said).toEqual(['первая', 'вторая']);
    expect(q.current()?.text).toBe('первая');
    pending[0]?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(q.current()?.text).toBe('вторая');
  });

  it('доклад следующего шага не перебивает комментарий, пока тот звучит', async () => {
    const said: string[] = [];
    let releaseSynth = () => {};
    const pending: (() => void)[] = [];
    const q = voiceQueue({
      speak(text) {
        said.push(text);
        let finish = () => {};
        let synth = () => {};
        if (text === 'комментарий') releaseSynth = () => synth();
        const done = new Promise<void>((r) => (finish = r));
        pending.push(finish);
        return { done, stop() { finish(); }, synth: new Promise<void>((r) => (synth = r)) };
      },
    });
    q.scene('turn-2-scroll');
    q.push({ text: 'комментарий', priority: 'action', source: 'now' });
    q.scene('turn-3-explain');
    q.push({ text: 'доклад обстановки', priority: 'scene', source: 'prepared', scene: 'turn-3-explain' });
    releaseSynth();
    await new Promise((r) => setTimeout(r, 0));
    expect(said).toEqual(['комментарий']);
    pending[0]?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(said).toEqual(['комментарий', 'доклад обстановки']);
  });

  it('смена выбора обрывает фразу этой сцены и сразу говорит новую', () => {
    const f = fakeSpeaker();
    const lines: (string | null)[] = [];
    const q = voiceQueue(f.speaker, { onLine: (l) => lines.push(l?.text ?? null) });
    q.scene('welcome');
    q.push({ text: 'приглашение', priority: 'scene', source: 'prepared', scene: 'welcome' });
    q.push({ text: 'Жуков', priority: 'scene', source: 'prepared', scene: 'welcome', replace: true });
    expect(f.stopped).toEqual(['приглашение']);
    expect(f.said).toEqual(['приглашение', 'Жуков']);
    expect(lines.at(-1)).toBe('Жуков');
    q.push({ text: 'Конев', priority: 'scene', source: 'prepared', scene: 'welcome', replace: true });
    expect(f.said).toEqual(['приглашение', 'Жуков', 'Конев']);
    expect(lines.at(-1)).toBe('Конев');
  });
});

describe('круг фраз на заставке', () => {
  const pauseMs = 8_000;
  it('первая фраза — после короткой паузы, следующая — после заданной', () => {
    expect(attractLoopDue({ now: 1_000, quietSince: 0, pauseMs: 1_500, on: true, busy: false })).toBe(false);
    expect(attractLoopDue({ now: 1_500, quietSince: 0, pauseMs: 1_500, on: true, busy: false })).toBe(true);
    expect(attractLoopDue({ now: 7_000, quietSince: 0, pauseMs, on: true, busy: false })).toBe(false);
    expect(attractLoopDue({ now: 8_000, quietSince: 0, pauseMs, on: true, busy: false })).toBe(true);
  });
  it('выключен или голос занят — молчит', () => {
    expect(attractLoopDue({ now: 99_000, quietSince: 0, pauseMs, on: false, busy: false })).toBe(false);
    expect(attractLoopDue({ now: 99_000, quietSince: 0, pauseMs, on: true, busy: true })).toBe(false);
  });
  it('скрытое или неактивное окно круг не продолжает', () => {
    expect(attractShown({ hidden: false, focused: true })).toBe(true);
    expect(attractShown({ hidden: true, focused: true })).toBe(false);
    expect(attractShown({ hidden: false, focused: false })).toBe(false);
  });
});
