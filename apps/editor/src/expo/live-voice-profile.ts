/** Живая озвучка стенда: одна модель, словарь и цельные реплики, как в студии предзаписи. */
import type { VoiceClient } from '../voice/client';
import type { TtsInfo } from '../voice/tts-store';
import { speakable } from '../voice/speech';
import { stressed } from './stress';
import { runtimeStress } from '../portable/stress';

export const EXPO_LIVE_ENGINE = 'qwen3-ru-stress';
export const expoSpeechText = (text: string) => stressed(speakable(text, { full: true }), EXPO_LIVE_ENGINE, runtimeStress()).said;

/** Выбор делается при подключении, до операции; подготовка ждёт подтверждения, а не синтезирует прежней моделью. */
export function expoVoiceProfile(client: Pick<VoiceClient, 'on' | 'onStatus' | 'tts' | 'status'>) {
  let selected = false;
  let failure: Error | null = null;
  const waiting = new Set<(error?: unknown) => void>();
  const settle = (error?: unknown) => { for (const finish of [...waiting]) finish(error); };
  const update = (info?: TtsInfo) => {
    selected = info?.current === EXPO_LIVE_ENGINE && info.state === 'ready' && !info.error;
    if (selected) { failure = null; settle(); return; }
    if (info?.error) { failure = new Error(info.error); settle(failure); return; }
    if (info?.state !== 'loading') client.tts('set', EXPO_LIVE_ENGINE);
  };
  const off = [
    client.on('ready', (m) => { failure = null; update(m.tts); }),
    client.on('tts_list', update),
    client.onStatus((status) => {
      if (status === 'ready') return;
      selected = false;
      failure = new Error('Нет связи с голосовым сервисом');
      settle(failure);
    }),
  ];
  return {
    ready: () => selected && client.status === 'ready',
    wait(signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (selected && client.status === 'ready') return Promise.resolve();
      if (failure) return Promise.reject(failure);
      if (client.status !== 'ready') return Promise.reject(new Error('Голосовой сервис не готов'));
      return new Promise((resolve, reject) => {
        const finish = (error?: unknown) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          waiting.delete(finish);
          if (error) reject(error); else resolve();
        };
        const abort = () => finish(signal?.reason);
        const timer = setTimeout(() => finish(new Error('Модель озвучки не загрузилась за 120 секунд')), 120_000);
        waiting.add(finish);
        signal?.addEventListener('abort', abort, { once: true });
      });
    },
    dispose() { off.forEach((f) => f()); settle(new Error('Озвучка закрыта')); },
  };
}
