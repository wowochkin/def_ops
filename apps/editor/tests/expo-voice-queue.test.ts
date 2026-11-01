import { describe, expect, it } from 'vitest';
import { attractCallDue, voiceQueue, type Speaker } from '../src/expo/voice-queue';

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
});

describe('призыв на заставке', () => {
  const call = { on: true, minutes: 2 };
  it('не чаще раза в заданные минуты и не сразу после входа в заставку', () => {
    expect(attractCallDue({ now: 60_000, since: 0, last: 0, call, busy: false })).toBe(false);
    expect(attractCallDue({ now: 120_000, since: 0, last: 0, call, busy: false })).toBe(true);
    expect(attractCallDue({ now: 180_000, since: 0, last: 120_000, call, busy: false })).toBe(false);
  });
  it('выключен или голос занят — молчит', () => {
    expect(attractCallDue({ now: 999_000, since: 0, last: 0, call: { on: false, minutes: 2 }, busy: false })).toBe(false);
    expect(attractCallDue({ now: 999_000, since: 0, last: 0, call, busy: true })).toBe(false);
  });
});
