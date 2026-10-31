import { describe, expect, it } from 'vitest';
import { voiceQueue, type Speaker } from '../src/expo/voice-queue';

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
  it('не говорит поверх себя и идёт по приоритету', async () => {
    const f = fakeSpeaker();
    const q = voiceQueue(f.speaker);
    q.push({ text: 'событие', priority: 'event', source: 's' });
    q.push({ text: 'фон', priority: 'ambient', source: 's' });
    q.push({ text: 'таймер', priority: 'timer', source: 's' });
    q.push({ text: 'ответ', priority: 'action', source: 's' });
    expect(f.said).toEqual(['событие']);
    await f.finishOne();
    await f.finishOne();
    await f.finishOne();
    expect(f.said).toEqual(['событие', 'ответ', 'таймер', 'фон']);
  });

  it('важная фраза мягко прерывает фоновую, фоновая не прерывает', () => {
    const f = fakeSpeaker();
    const q = voiceQueue(f.speaker);
    q.push({ text: 'фон', priority: 'ambient', source: 's' });
    q.push({ text: 'фон 2', priority: 'ambient', source: 's' });
    expect(f.stopped).toEqual([]);
    q.push({ text: 'таймер', priority: 'timer', source: 's' });
    expect(f.stopped).toEqual(['фон']);
    expect(f.said).toEqual(['фон', 'таймер']);
  });

  it('пауза заполняется фоновой фразой; clear глушит всё', async () => {
    const f = fakeSpeaker();
    const lines: (string | null)[] = [];
    const q = voiceQueue(f.speaker, { ambient: () => ({ text: 'рассказ', priority: 'ambient', source: 'база' }), onLine: (l) => lines.push(l?.text ?? null) });
    q.fill();
    expect(f.said).toEqual(['рассказ']);
    q.fill();
    expect(f.said).toEqual(['рассказ']);
    q.push({ text: 'событие', priority: 'event', source: 's' });
    q.clear();
    expect(q.current()).toBeNull();
    expect(lines.at(-1)).toBeNull();
  });

  it('сбой речи не останавливает очередь', async () => {
    const said: string[] = [];
    const q = voiceQueue({ speak: (t) => { said.push(t); if (t === 'a') throw new Error('нет голоса'); return { done: Promise.resolve(), stop() {} }; } });
    q.push({ text: 'a', priority: 'event', source: 's' });
    q.push({ text: 'b', priority: 'event', source: 's' });
    await new Promise((r) => setTimeout(r, 0));
    expect(said).toEqual(['a', 'b']);
  });
});
