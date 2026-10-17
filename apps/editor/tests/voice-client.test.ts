/** VoiceClient без браузера: разбор сообщений сервиса (звук и связь подменены). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceClient } from '../src/voice/client';

/** Клиент с «открытой» связью: что он шлёт сервису — в sent. */
function mk() {
  const c = new VoiceClient();
  const sent: unknown[] = [];
  const x = c as unknown as Record<string, any>;
  x.ws = { readyState: 1, send: (s: string) => sent.push(JSON.parse(s)) };
  x.wsState = 'open';
  return { c, x, sent, msg: (m: unknown) => x.onMessage(m) };
}

describe('VoiceClient', () => {
  it('ошибка сервиса до ready (модели не загрузились) — состояние error с причиной', () => {
    const { c, msg } = mk();
    expect(c.status).toBe('connecting');
    msg({ type: 'error', text: 'модели не загрузились: OSError: нет места' });
    expect(c.status).toBe('error');
    expect(c.errorText).toBe('модели не загрузились: OSError: нет места');
    msg({ type: 'ready', voices: [], roles: { chief: 'a', umpire: 'a' }, loaded: true });
    expect(c.status).toBe('ready');
    expect(c.errorText).toBeNull();
    // ошибка отдельного действия после ready — не «голос не запустился»
    msg({ type: 'error', text: 'нет такой роли' });
    expect(c.status).toBe('ready');
  });

  it('say-done stopped (остановил сервис) — звук фразы гасится, played не шлётся', () => {
    const { x, sent, msg } = mk();
    let stopped = 0;
    const src = { onended: null as null | (() => void), stop: () => { stopped++; } };
    x.sources = [{ src, id: 5 }];
    x.phrases.set(5, { done: true });
    const played: number[] = [];
    x.playedCbs.add((id: number) => played.push(id));
    msg({ type: 'say-done', id: 5, stopped: true });
    expect(stopped).toBe(1);
    expect(x.sources).toEqual([]);
    expect(sent).toEqual([]);
    expect(played).toEqual([]);
  });

  describe('подавление эха в сервисе (ready aec)', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    /** Подменённый микрофон: что просили у браузера — в asked; дорожки — с отметкой остановки. */
    function fakeMic() {
      const asked: MediaTrackConstraints[] = [];
      const tracks: { stopped: boolean }[] = [];
      const getUserMedia = async (c: { audio: MediaTrackConstraints }) => {
        asked.push(c.audio);
        const t = { stopped: false, stop() { t.stopped = true; } };
        tracks.push(t);
        return { getTracks: () => [t] };
      };
      vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
      return { asked, tracks };
    }
    const node = () => ({ disconnect() {}, connect() {} });

    it('сервис сказал aec: true — микрофон открывается заново без обработки браузера', async () => {
      const { asked, tracks } = fakeMic();
      const { c, x, msg } = mk();
      const old = { stopped: false, stop() { old.stopped = true; } };
      x.stream = { getTracks: () => [old] };
      x.streamAec = false;
      x.ctx = { createMediaStreamSource: node, createBiquadFilter: () => ({ ...node(), type: '', frequency: { value: 0 }, Q: { value: 0 } }) };
      x.node = { ...node(), port: { postMessage() {} } };
      msg({ type: 'ready', voices: [], roles: { chief: 'a', umpire: 'a' }, loaded: true, aec: true });
      await vi.waitFor(() => expect(asked).toHaveLength(1));
      expect(asked[0]).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
      await vi.waitFor(() => expect(old.stopped).toBe(true));
      expect(tracks[0].stopped).toBe(false);
      expect(x.streamAec).toBe(true);
      expect(c.status).toBe('ready');
    });

    it('aec не изменился — микрофон не трогается', async () => {
      const { asked } = fakeMic();
      const { x, msg } = mk();
      x.stream = { getTracks: () => [] };
      x.streamAec = false;
      msg({ type: 'ready', voices: [], roles: { chief: 'a', umpire: 'a' }, loaded: true });
      await new Promise((r) => setTimeout(r, 10));
      expect(asked).toEqual([]);
    });

    it('кадр ворклета: с опорой — двухканальный, без — только микрофон', () => {
      const { x } = mk();
      const sent: ArrayBuffer[] = [];
      x.ws = { readyState: 1, send: (b: ArrayBuffer) => sent.push(b) };
      x.onMic({ pcm: new Int16Array(512).buffer });
      x.onMic({ pcm: new Int16Array(512).buffer, ref: new Int16Array(512).buffer });
      expect(sent.map((b) => b.byteLength)).toEqual([1024, 2049]);
    });
  });
});
