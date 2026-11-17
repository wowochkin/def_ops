import { describe, expect, it, vi } from 'vitest';
import { VoiceClient } from '../src/voice/client';
import { expoVoiceProfile, expoSpeechText } from '../src/expo/live-voice-profile';

function setup() {
  const client = new VoiceClient();
  const raw = client as unknown as Record<string, any>;
  const tts = vi.spyOn(client, 'tts').mockImplementation(() => {});
  raw.wsState = 'open';
  const profile = expoVoiceProfile(client);
  const message = (m: unknown) => raw.onMessage(m);
  return { profile, tts, message };
}
const info = (current: string, state = 'ready', error?: string) => ({ current, state, engines: [], ...(error ? { error } : {}) });

describe('профиль живой озвучки выставки', () => {
  it('при подключении выбирает qwen3-ru-stress и ждёт подтверждения загрузки', async () => {
    const { profile, tts, message } = setup();
    message({ type: 'ready', tts: info('fish-s2-pro') });
    expect(tts).toHaveBeenCalledWith('set', 'qwen3-ru-stress');
    expect(profile.ready()).toBe(false);
    let ready = false;
    const waiting = profile.wait().then(() => { ready = true; });
    message({ type: 'tts_list', ...info('fish-s2-pro', 'loading') });
    await Promise.resolve();
    expect(ready).toBe(false);
    message({ type: 'tts_list', ...info('qwen3-ru-stress') });
    await waiting;
    expect(profile.ready()).toBe(true);
    profile.dispose();
  });
  it('не переключает уже выбранную модель, сохраняет acute ударения словаря', async () => {
    const { profile, tts, message } = setup();
    message({ type: 'ready', tts: info('qwen3-ru-stress') });
    await profile.wait();
    expect(tts).not.toHaveBeenCalled();
    expect(expoSpeechText('Хальбе и Торгау.')).toBe('Ха́льбе и Торга́у.');
    profile.dispose();
  });
  it('при отказе модели не выдаёт чужой движок за готовую озвучку', async () => {
    const { profile, message, tts } = setup();
    message({ type: 'ready', tts: info('fish-s2-pro') });
    const waiting = expect(profile.wait()).rejects.toThrow('нет весов');
    message({ type: 'tts_list', ...info('fish-s2-pro', 'ready', 'нет весов') });
    await waiting;
    expect(profile.ready()).toBe(false);
    expect(tts).toHaveBeenCalledTimes(1);
    profile.dispose();
  });
  it('отмена ожидания не начинает синтез после поздней загрузки модели', async () => {
    const { profile, message } = setup();
    message({ type: 'ready', tts: info('fish-s2-pro') });
    const abort = new AbortController();
    const waiting = expect(profile.wait(abort.signal)).rejects.toThrow();
    abort.abort();
    await waiting;
    message({ type: 'tts_list', ...info('qwen3-ru-stress') });
    expect(profile.ready()).toBe(true);
    profile.dispose();
  });
});

import { stageSpeaker, turnstile } from '../src/expo/speaker';
import type { SpeakerDeps } from '../src/expo/speaker';

it('готовый клип итогового разбора звучит в обоих режимах, пропуск записи без синтеза остаётся текстом', async () => {
  vi.useFakeTimers();
  try {
    const clip = { file: 'expo-debrief/clips/abcd1234.ogg', ms: 1500 };
    const say = vi.fn(() => ({ done: Promise.resolve(), synthDone: Promise.resolve(), stop() {} }));
    const play = vi.fn(() => ({ done: Promise.resolve(), stop() {} }));
    const speaker = stageSpeaker({ aiOn: () => true, gate: turnstile(), manifest: () => null,
      debriefClip: (text: string, voice: string) => text === 'Готовый итог.' && voice === 'zhukov' ? clip : null,
      player: { play } as unknown as SpeakerDeps['player'], live: { ready: () => true, say },
    });
    const line = { scene: 'result', voice: 'zhukov', source: 'now', priority: 'scene' as const, text: 'Готовый итог.' };
    await speaker.speak(line.text, line).done;
    await speaker.speak(line.text, { ...line, prerecordOnly: true }).done;
    const missing = speaker.speak('Другой исход.', { ...line, text: 'Другой исход.', prerecordOnly: true });
    await vi.runAllTimersAsync();
    await missing.done;
    expect(play.mock.calls).toHaveLength(2);
    expect(play).toHaveBeenNthCalledWith(1, [clip], [0]);
    expect(say).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

function speaking(prepare: NonNullable<SpeakerDeps['prepare']>) {
  const say = vi.fn(() => ({ done: Promise.resolve(), synthDone: Promise.resolve(), stop() {} }));
  const play = vi.fn(() => ({ done: Promise.resolve(), stop() {} }));
  const speaker = stageSpeaker({ aiOn: () => true, gate: turnstile(), prepare,
    manifest: () => ({ version: 1, voice: 'chief', engine: 'qwen3-ru-stress', clips: { 'Готовый ответ.': { file: 'abcd1234.ogg', ms: 1500 } } }),
    player: { play } as unknown as SpeakerDeps['player'], live: { ready: () => true, say },
  });
  const line = { source: 'now', priority: 'action' as const, text: 'Хальбе и Торгау.', fallback: { text: 'Готовый ответ.' } };
  return { say, play, start: () => speaker.speak(line.text, line) };
}

it('живая реплика подготовлена и воспроизведена с одним текстом словаря', async () => {
  const prepare = vi.fn<NonNullable<SpeakerDeps['prepare']>>(async () => {});
  const voice = speaking(prepare);
  await voice.start().done;
  expect(prepare.mock.calls[0][0]).toBe('Ха́льбе и Торга́у.');
  expect(voice.say).toHaveBeenCalledWith('Ха́льбе и Торга́у.', undefined);
});
it('ошибка подготовки даёт готовую замену, не запускает другую озвучку и завершает очередь', async () => {
  const voice = speaking(async () => { throw new Error('Модель недоступна'); });
  const handle = voice.start();
  await handle.done;
  await handle.synth;
  expect(voice.say).not.toHaveBeenCalled();
  expect(voice.play).toHaveBeenCalledTimes(1);
});
it('stop прерывает подготовку живой реплики', async () => {
  let signal: AbortSignal | undefined;
  const voice = speaking(async (_text, _id, s) => { signal = s; await new Promise<void>((_, reject) => s!.addEventListener('abort', () => reject(s!.reason), { once: true })); });
  const handle = voice.start();
  await Promise.resolve();
  handle.stop();
  await handle.done;
  expect(signal?.aborted).toBe(true);
  expect(voice.say).not.toHaveBeenCalled();
});
it('подключённый сервис с загружающейся Qwen ждёт модель и не подменяет комментарий предзаписью', async () => {
  let ready = false;
  let loaded!: () => void;
  const prepare = vi.fn(async () => { await new Promise<void>(r => { loaded = r; }); ready = true; });
  const say = vi.fn(() => ({ done: Promise.resolve(), synthDone: Promise.resolve(), stop() {} }));
  const play = vi.fn(() => ({ done: Promise.resolve(), stop() {} }));
  const speaker = stageSpeaker({ aiOn: () => true, gate: turnstile(), prepare,
    manifest: () => ({ version: 1, voice: 'chief', engine: 'qwen3-ru-stress', clips: { 'Готовый ответ.': { file: 'abcd1234.ogg', ms: 1500 } } }),
    player: { play } as unknown as SpeakerDeps['player'],
    live: { ready: () => ready, available: () => true, say },
  });
  const line = { text: 'Командующий оценивает результат решения.', voice: 'zhukov-14s', source: 'now', priority: 'scene' as const, fallback: { text: 'Готовый ответ.' } };
  const handle = speaker.speak(line.text, line);
  await Promise.resolve();
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(play).not.toHaveBeenCalled();
  expect(say).not.toHaveBeenCalled();
  loaded(); await handle.done;
  expect(say).toHaveBeenCalledWith(expoSpeechText(line.text), 'zhukov-14s');
  expect(play).not.toHaveBeenCalled();
});

it('управляемый профиль выбирается логически без преждевременной загрузки весов', async () => {
  const { profile, tts, message } = setup();
  message({ type: 'ready', tts: { ...info('qwen3-ru-stress'), managed: true, resident: false } });
  await profile.wait();
  expect(profile.ready()).toBe(true);
  expect(tts).not.toHaveBeenCalled();
  profile.dispose();
});

it('prepare возвращает выбранную температуру и say сохраняет её после ожидания', async () => {
  let finish!: (temperature: number) => void;
  const voice = speaking(() => new Promise<number>(resolve => { finish = resolve; }));
  const handle = voice.start();
  await Promise.resolve();
  finish(0);
  await handle.done;
  expect(voice.say).toHaveBeenCalledWith('Ха́льбе и Торга́у.', undefined, 0);
});
