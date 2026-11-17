// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { expoSpeaker, turnstile, type VoiceProgress } from '../src/expo/speaker';
import { VoiceClient } from '../src/voice/client';
import { EXPO_LIVE_ENGINE, expoSpeechText } from '../src/expo/live-voice-profile';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(recorded: string[] = []) {
  vi.stubGlobal('WebSocket', { OPEN: 1 });
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => String(url).endsWith('/expo-debrief/manifest.json')
    ? Response.json({ version: 1, voices: { marshal: Object.fromEntries(recorded.map(text => [text, { file: 'aabbccdd.ogg', ms: 900 }])) } })
    : new Response('', { status: 404 })));
  vi.spyOn(VoiceClient.prototype, 'connect').mockImplementation(() => {});
  const options = { temperature: 0.2, batchSize: 4 as 1 | 2 | 4 };
  const beforePrepare = vi.fn(async () => {});
  const voice = expoSpeaker({ aiOn: () => true, gate: turnstile(), synthesis: () => ({ ...options }), beforePrepare });
  const raw = voice.input as unknown as Record<string, any>;
  const sent: any[] = [];
  raw.ws = { readyState: 1, send: (s: string) => sent.push(JSON.parse(s)), close() {} };
  raw.wsState = 'open';
  const message = (m: unknown) => raw.onMessage(m);
  message({ type: 'ready', voices: [], roles: {}, loaded: true, capabilities: { prepare_batch: true, tts_temperature: true }, tts: { engines: [], current: EXPO_LIVE_ENGINE, state: 'ready', managed: true, resident: true } });
  return { voice, options, beforePrepare, sent, message };
}
it('синтезирует только недостающие реплики и учитывает готовые записи в прогрессе', async () => {
  const f = setup(['Готовая реплика.']);
  try {
    const progress: VoiceProgress[] = [];
    const ready = f.voice.prepare(['Готовая реплика.'], 'marshal', undefined, p => progress.push(p));
    await flush();
    expect(f.beforePrepare).not.toHaveBeenCalled();
    expect(f.sent).toEqual([]);
    await ready;
    const pending = f.voice.prepare(['Готовая реплика.', 'Свой удар.'], 'marshal', undefined, p => progress.push(p));
    await flush();
    expect(f.sent).toEqual([expect.objectContaining({ type: 'prepare-batch', texts: [expoSpeechText('Свой удар.')] })]);
    expect(progress.at(-1)).toEqual({ done: 1, total: 2, stage: 'synthesis' });
    f.message({ type: 'prepared-batch', id: 1, done: 1, total: 1 });
    await pending;
    expect(progress.at(-1)).toEqual({ done: 2, total: 2, stage: 'synthesis' });
  } finally { f.voice.dispose(); }
});
it('восемь фраз ждут два пакета, затем say переиспользует их с той же температурой и без повторного GPU handoff', async () => {
  const f = setup();
  try {
    const texts = Array.from({ length: 8 }, (_, i) => `Результат ${i + 1}.`);
    const progress: VoiceProgress[] = [];
    let prepared = false;
    const pending = f.voice.prepare(texts, 'marshal', undefined, p => progress.push(p)).then(() => { prepared = true; });
    await flush();
    expect(f.sent).toEqual([{ type: 'prepare-batch', id: 1, role: 'chief', texts: texts.map(expoSpeechText), voice_id: 'marshal', temperature: 0.2, batch_size: 4 }]);
    expect(f.beforePrepare).toHaveBeenCalledTimes(1);
    f.message({ type: 'prepared-batch', id: 1, done: 4, total: 8 });
    await flush();
    expect(prepared).toBe(false);
    expect(progress.at(-1)).toEqual({ done: 4, total: 8, stage: 'synthesis' });
    f.options.temperature = 0.9;
    f.message({ type: 'prepared-batch', id: 1, done: 8, total: 8 });
    await pending;
    // Stage freezes the callback throughout result, as separately verified by lifecycle tests.
    f.options.temperature = 0.2;
    for (const text of texts) {
      const handle = f.voice.speaker.speak(text, { text, voice: 'marshal', source: 'now', priority: 'scene', scene: 'result' });
      await flush();
      const say = f.sent.at(-1);
      expect(say).toMatchObject({ type: 'say', text: expoSpeechText(text), temperature: 0.2, voice_id: 'marshal' });
      f.message({ type: 'say-done', id: say.id });
      await handle.done;
    }
    expect(f.beforePrepare).toHaveBeenCalledTimes(1);
    expect(f.sent.filter(m => m.type === 'prepare')).toEqual([]);
    expect(progress.at(-1)).toEqual({ done: 8, total: 8, stage: 'synthesis' });
  } finally { f.voice.dispose(); }
});
it('комментарий захватывает температуру до ожидания подготовки модели', async () => {
  const f = setup();
  try {
    let release!: () => void;
    f.beforePrepare.mockImplementation(() => new Promise<void>(r => { release = r; }));
    const text = 'Ваше решение сохранило резервы.';
    const handle = f.voice.speaker.speak(text, { text, voice: 'marshal', source: 'now', priority: 'action' });
    await flush();
    f.options.temperature = 0.8;
    release(); await flush();
    const prepare = f.sent.at(-1);
    expect(prepare).toMatchObject({ type: 'prepare', temperature: 0.2 });
    f.message({ type: 'prepared', id: prepare.id });
    await flush();
    const say = f.sent.at(-1);
    expect(say).toMatchObject({ type: 'say', temperature: 0.2 });
    f.message({ type: 'say-done', id: say.id });
    await handle.done;
  } finally { f.voice.dispose(); }
});
