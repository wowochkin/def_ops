import { afterEach, expect, it, vi } from 'vitest';
import { VoiceClient } from '../src/voice/client';
import { liveVoice } from '../src/expo/speaker';

afterEach(() => vi.useRealTimers());
function setup() {
  const client = new VoiceClient();
  const raw = client as unknown as Record<string, any>;
  vi.spyOn(client, 'say').mockImplementation(() => {});
  vi.spyOn(client, 'resume').mockImplementation(() => {});
  const stop = vi.spyOn(client, 'stop').mockImplementation(() => {});
  const voice = liveVoice(client, { ready: () => true });
  const handle = voice.say('Докладываю.');
  const id = vi.mocked(client.say).mock.calls[0][0];
  return { client, raw, voice, handle, id, stop, message: (m: unknown) => raw.onMessage(m) };
}
it('say-done без PCM завершает и воспроизведение, и синтез без блокировки следующей реплики', async () => {
  vi.useFakeTimers();
  const { message, id, handle, voice } = setup();
  let done = false, synth = false;
  void handle.done.then(() => { done = true; });
  void handle.synthDone.then(() => { synth = true; });
  message({ type: 'say-done', id });
  await Promise.resolve();
  expect(done).toBe(true);
  expect(synth).toBe(true);
  voice.dispose();
});
it('say-done завершает только синтез: конец звука ждёт onended последнего источника', async () => {
  vi.useFakeTimers();
  const { raw, message, id, handle, voice } = setup();
  raw.sources = [{ id, src: {} }];
  raw.phrases.set(id, { done: false });
  let done = false, synth = false;
  void handle.done.then(() => { done = true; });
  void handle.synthDone.then(() => { synth = true; });
  message({ type: 'say-done', id });
  await Promise.resolve();
  expect(synth).toBe(true);
  expect(done).toBe(false);
  raw.sources = [];
  raw.checkPlayed(id);
  await handle.done;
  expect(done).toBe(true);
  voice.dispose();
});
it('долгая генерация не обрывает реплику по таймеру в 120 секунд', async () => {
  vi.useFakeTimers();
  const { handle, voice, stop } = setup();
  let done = false;
  void handle.done.then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(180000);
  expect(stop).not.toHaveBeenCalled();
  expect(done).toBe(false);
  handle.stop(); await handle.done;
  voice.dispose();
});
it('разрыв соединения завершает ожидающую реплику без тайм-аута', async () => {
  vi.useFakeTimers();
  const { raw, handle, voice } = setup();
  let done = false;
  void handle.done.then(() => { done = true; });
  raw.statusCbs.forEach((cb: (s: string) => void) => cb('offline'));
  await Promise.resolve();
  expect(done).toBe(true);
  voice.dispose();
});
