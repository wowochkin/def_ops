import { describe, expect, it, vi } from 'vitest';
import { clipPlayer, type ClipAudio } from '../src/expo/speaker';
import { VoiceClient } from '../src/voice/client';

const setVolume = vi.fn();
vi.mock('../src/expo/speaker', async (orig) => ({
  ...(await orig<typeof import('../src/expo/speaker')>()),
  expoSpeaker: () => ({ speaker: { speak: () => ({ done: Promise.resolve(), stop() {} }) }, voiced: () => false, setVolume, resume() {}, dispose() {} }),
}));

describe('громкость голоса стенда', () => {
  it('склейка идёт через узел громкости, не прямо в динамики', async () => {
    const targets: unknown[] = [];
    const vol = { name: 'громкость' };
    const a: ClipAudio = {
      currentTime: 0,
      destination: { name: 'динамики' },
      decodeAudioData: async () => ({ duration: 1 }) as AudioBuffer,
      createBufferSource: () => ({ buffer: null, onended: null, connect: (n: unknown) => targets.push(n), start() {}, stop() {} }) as unknown as AudioBufferSourceNode,
    };
    clipPlayer(() => a, async () => new ArrayBuffer(1), 60, () => vol).play([{ file: 'a.ogg', ms: 1000 }], [0]);
    await new Promise((r) => setTimeout(r, 0));
    expect(targets).toEqual([vol]);
  });

  it('живой голос: громкость задаётся до звука и меняется сразу', () => {
    const gains: { value: number; setTargetAtTime(v: number): void }[] = [];
    class FakeCtx {
      currentTime = 0; destination = {};
      createGain() { const g = { value: 1, connect() {}, gain: { value: 1, setTargetAtTime(v: number) { g.gain.value = v; } } }; gains.push(g.gain); return g; }
      createBuffer(_c: number, n: number) { const d = new Float32Array(n); return { duration: n / 24000, getChannelData: () => d }; }
      createBufferSource() { return { buffer: null, connect() {}, start() {}, onended: null }; }
      resume() { return Promise.resolve(); }
    }
    vi.stubGlobal('AudioContext', FakeCtx);
    try {
      const c = new VoiceClient();
      c.setVolume(0.4);
      const buf = new ArrayBuffer(11);
      const v = new DataView(buf);
      v.setUint8(0, 1); v.setUint32(1, 7, true); v.setUint32(5, 24000, true); v.setInt16(9, 1000, true);
      (c as unknown as { onAudio(b: ArrayBuffer): void }).onAudio(buf);
      // bus (опора эхоподавления) — без громкости, выход — 0,4
      expect(gains.map((g) => g.value)).toEqual([1, 0.4]);
      c.setVolume(0.9);
      expect(gains[1].value).toBe(0.9);
    } finally { vi.unstubAllGlobals(); }
  });

  it('смена громкости в меню оператора доходит до голоса со следующим тиком', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
    const { createStage } = await import('../src/expo/stage');
    const { initialState } = await import('../src/expo/director');
    let voice = 0.8;
    const stage = createStage({
      aiOn: () => false,
      snapshot: () => ({ state: initialState(0), model: {} as never, settings: { volume: { voice, ambient: 0.3, ambientOn: false } } }),
      dispatch() {}, onFrame() {}, count() {},
    });
    stage.tick();
    expect(setVolume).toHaveBeenLastCalledWith(0.8);
    stage.tick();
    expect(setVolume).toHaveBeenCalledTimes(1);
    voice = 0.3;
    stage.tick();
    expect(setVolume).toHaveBeenLastCalledWith(0.3);
    stage.dispose();
    vi.unstubAllGlobals();
  });
});
